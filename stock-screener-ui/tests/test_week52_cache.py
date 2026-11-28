"""cache.week52 is a thin consumer of the canonical trading.week52 package."""
from __future__ import annotations

import pytest

import cache.week52 as cache_week52
from trading.week52 import config as canonical_config
from trading.week52 import keys as canonical_keys
from trading.week52 import ranges as canonical_ranges

TTL_ENV = "SCREENER_52W_CACHE_TTL"


@pytest.fixture(autouse=True)
def _clear_ttl_env(monkeypatch):
    monkeypatch.delenv(TTL_ENV, raising=False)


class TestResolveTtl:
    def test_default_is_24h(self):
        assert cache_week52.resolve_ttl() == 86400

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv(TTL_ENV, "600")
        assert cache_week52.resolve_ttl() == 600

    @pytest.mark.parametrize("bad", ["not-a-number", "-5", "-0.5", ""])
    def test_invalid_or_negative_env_falls_back(self, monkeypatch, bad):
        monkeypatch.setenv(TTL_ENV, bad)
        assert cache_week52.resolve_ttl() == 86400

    def test_explicit_ttl_wins_over_env(self, monkeypatch):
        monkeypatch.setenv(TTL_ENV, "600")
        assert cache_week52.resolve_ttl(30) == 30

    def test_explicit_ttl_is_coerced_and_clamped(self):
        assert cache_week52.resolve_ttl("45") == 45
        assert cache_week52.resolve_ttl(-10) == 0

    def test_reader_is_the_canonical_config_function(self):
        assert cache_week52.cache_ttl_sec is canonical_config.cache_ttl_sec

    def test_delegates_to_canonical_reader(self, monkeypatch):
        monkeypatch.setattr(cache_week52, "cache_ttl_sec", lambda: 777)
        assert cache_week52.resolve_ttl() == 777

    def test_falls_back_to_canonical_default(self, monkeypatch):
        def boom():
            raise RuntimeError("config unavailable")

        monkeypatch.setattr(cache_week52, "cache_ttl_sec", boom)
        assert cache_week52.resolve_ttl() == canonical_keys.RANGE_TTL == 86400


class TestStore52wRanges:
    @staticmethod
    def _capture_cache_set(monkeypatch):
        calls = {}

        def fake_cache_set(key, value, ttl=None):
            calls.update(key=key, value=value, ttl=ttl)
            return True

        monkeypatch.setattr("cache.redis_client.cache_set", fake_cache_set)
        monkeypatch.setattr(cache_week52, "_db_updated_at_stamps", lambda: {})
        return calls

    def test_writes_bulk_key_with_resolved_ttl(self, monkeypatch):
        calls = self._capture_cache_set(monkeypatch)
        monkeypatch.setenv(TTL_ENV, "600")

        result = cache_week52.store_52w_ranges(
            {"AAA": {"high": 2, "low": 1, "close": 1.5}, "BAD": {"high": "x"}},
            clear_paper_cache=False,
        )

        assert calls["key"] == canonical_keys.BULK
        assert calls["ttl"] == 600
        assert calls["value"] == result
        assert "AAA" in result
        assert "BAD" not in result

    def test_explicit_ttl_reaches_the_bulk_write(self, monkeypatch):
        calls = self._capture_cache_set(monkeypatch)

        cache_week52.store_52w_ranges({}, ttl=120, clear_paper_cache=False)

        assert calls["ttl"] == 120

    def test_stamps_entries_from_db(self, monkeypatch):
        calls = self._capture_cache_set(monkeypatch)
        monkeypatch.setattr(
            cache_week52,
            "_db_updated_at_stamps",
            lambda: {"AAA": "2026-01-01T00:00:00"},
        )

        result = cache_week52.store_52w_ranges(
            {"AAA": {"high": 2, "low": 1, "close": 1.5}},
            clear_paper_cache=False,
        )

        assert result["AAA"]["updated_at"] == "2026-01-01T00:00:00"
        assert calls["value"] == result

    def test_clears_paper_cache_and_recreates_dir(self, monkeypatch, tmp_path):
        calls = self._capture_cache_set(monkeypatch)
        monkeypatch.setattr(cache_week52, "_PROJECT_ROOT", tmp_path)
        paper_dir = tmp_path / canonical_keys.PAPER_52W_CACHE_DIR
        paper_dir.mkdir(parents=True)
        stale = paper_dir / "stale.json"
        stale.write_text("stale")

        cache_week52.store_52w_ranges({"AAA": {"high": 2, "low": 1, "close": 1.5}})

        assert calls["key"] == canonical_keys.BULK
        assert not stale.exists()
        assert paper_dir.is_dir()

    def test_paper_cache_untouched_when_disabled(self, monkeypatch, tmp_path):
        self._capture_cache_set(monkeypatch)
        monkeypatch.setattr(cache_week52, "_PROJECT_ROOT", tmp_path)
        paper_dir = tmp_path / canonical_keys.PAPER_52W_CACHE_DIR
        paper_dir.mkdir(parents=True)
        stale = paper_dir / "stale.json"
        stale.write_text("stale")

        cache_week52.store_52w_ranges({}, clear_paper_cache=False)

        assert stale.read_text() == "stale"


class TestLoad52wRanges:
    def test_reads_the_bulk_key(self, monkeypatch):
        payload = {"AAA": {"high": 2.0, "low": 1.0, "close": 1.5}}
        monkeypatch.setattr(
            "cache.redis_client.cache_get", lambda key: payload if key == canonical_keys.BULK else None
        )

        assert cache_week52.load_52w_ranges() == payload

    def test_bad_payload_yields_empty_dict(self, monkeypatch):
        monkeypatch.setattr("cache.redis_client.cache_get", lambda key: ["not", "a", "dict"])

        assert cache_week52.load_52w_ranges() == {}


class TestSanitizerAliases:
    def test_aliases_are_the_canonical_functions(self):
        assert cache_week52.sanitize_entry is canonical_ranges.sanitize_entry
        assert cache_week52.sanitize_bulk is canonical_ranges.sanitize_bulk

    def test_entry_output_matches_canonical(self):
        info = {
            "high": "100",
            "low": 50,
            "close": 75.5,
            "days_ago": "3",
            "updated_at": "2026-01-01T00:00:00",
        }

        expected = {
            "high": 100.0,
            "low": 50.0,
            "close": 75.5,
            "days_ago": 3,
            "updated_at": "2026-01-01T00:00:00",
        }
        assert cache_week52.sanitize_entry(info) == expected
        assert canonical_ranges.sanitize_entry(info) == expected

    def test_bulk_output_matches_canonical(self):
        data = {
            "AAA": {"high": 2, "low": 1, "close": 1.5},
            "BAD": {"high": "x", "low": 1, "close": 1.5},
        }

        assert cache_week52.sanitize_bulk(data) == canonical_ranges.sanitize_bulk(data) == {
            "AAA": {"high": 2.0, "low": 1.0, "close": 1.5}
        }

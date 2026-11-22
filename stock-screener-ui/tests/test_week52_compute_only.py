"""Compute-only 52W runner: JSON payload contract and catch-up no-op exit.

These tests never touch the network, the DB or Redis: the Upstox client is
replaced with a stub module, symbol loading and range computation are patched,
and any DB/Redis call is an assertion failure.
"""
import gzip
import json
import sys
from datetime import datetime
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config
from scripts import compute_52w_ranges_upstox as batch

#: Runs before the runner imports it, so no token file / HTTP client is touched.
UPSTOX_MODULE = "upstox_trader.config_and_utils.upstox_api"


class _FakeUpstoxAPI:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class _ExplodingSession:
    def query(self, *args, **kwargs):
        raise AssertionError("compute-only run must not open a DB session")


def _forbid(name):
    def _fail(*args, **kwargs):
        raise AssertionError(f"compute-only run must not call {name}")

    return _fail


@pytest.fixture
def compute_only_env(monkeypatch, tmp_path):
    stub = ModuleType(UPSTOX_MODULE)
    stub.UpstoxAPI = _FakeUpstoxAPI
    monkeypatch.setitem(sys.modules, UPSTOX_MODULE, stub)
    monkeypatch.setattr(config, "UPSTOX_API_KEY", "test-key")
    monkeypatch.setattr(config, "UPSTOX_API_SECRET", "test-secret")
    monkeypatch.setattr(batch, "SessionLocal", _ExplodingSession)
    monkeypatch.setattr(batch, "persist_ranges", _forbid("persist_ranges"))
    for name in (
        "get_job_status",
        "start_job",
        "update_job_progress",
        "finish_job",
        "fail_job",
    ):
        monkeypatch.setattr(batch, name, _forbid(name))
    return tmp_path


def _run(monkeypatch, argv):
    monkeypatch.setattr(sys, "argv", ["compute_52w_ranges_upstox", *argv])
    batch.main()


class TestComputeOnlyJson:
    def test_payload_schema_and_compact_serialisation(self, monkeypatch, compute_only_env):
        ranges = {
            "HIGH": {"high": 120.5, "low": 80.0, "close": 110.25, "days_ago": 12},
            "LOW": {"high": 10.0, "low": 5.0, "close": 7.5},
        }
        monkeypatch.setattr(
            batch, "fetch_range_for_symbol", lambda api, symbol, to_date: ranges[symbol]
        )
        out = compute_only_env / "52w" / "2026-11-21.json"

        _run(
            monkeypatch,
            [
                "--source", "json",
                "--symbol", "HIGH",
                "--symbol", "LOW",
                "--to-date", "2026-11-21",
                "--output-json", str(out),
            ],
        )

        raw = out.read_text(encoding="utf-8")
        assert "\n" not in raw, "payload must be compact (single line)"
        payload = json.loads(raw)
        assert payload["as_of"] == "2026-11-21"
        assert payload["count"] == 2
        assert payload["symbols"] == {
            "HIGH": {"high": 120.5, "low": 80.0, "close": 110.25, "days_ago": 12},
            "LOW": {"high": 10.0, "low": 5.0, "close": 7.5, "days_ago": None},
        }
        assert not list(out.parent.glob("*.tmp")), "atomic write must leave no temp file"

    def test_gzip_output_is_readable_and_reproducible(self, monkeypatch, compute_only_env):
        monkeypatch.setattr(
            batch,
            "fetch_range_for_symbol",
            lambda api, symbol, to_date: {"high": 2.0, "low": 1.0, "close": 1.5, "days_ago": 1},
        )
        out = compute_only_env / "2026-11-21.json.gz"
        argv = [
            "--source", "json",
            "--symbol", "AAA",
            "--to-date", "2026-11-21",
            "--output-json", str(out),
        ]

        _run(monkeypatch, argv)
        first = out.read_bytes()
        _run(monkeypatch, argv)

        assert out.read_bytes() == first
        assert json.loads(gzip.decompress(first))["symbols"]["AAA"]["close"] == 1.5

    def test_max_symbols_aliases_limit(self, monkeypatch, compute_only_env):
        monkeypatch.setattr(
            batch,
            "fetch_range_for_symbol",
            lambda api, symbol, to_date: {"high": 2.0, "low": 1.0, "close": 1.5, "days_ago": 1},
        )
        out = compute_only_env / "smoke.json"

        _run(
            monkeypatch,
            [
                "--source", "json",
                "--symbol", "AAA",
                "--symbol", "BBB",
                "--max-symbols", "1",
                "--output-json", str(out),
            ],
        )

        payload = json.loads(out.read_text(encoding="utf-8"))
        assert payload["count"] == 1
        assert list(payload["symbols"]) == ["AAA"]

    def test_runner_never_imports_the_api_app(self):
        source = Path(batch.__file__).read_text(encoding="utf-8")
        assert "api_server_fastapi" not in source

    def test_run_summary_reports_fetch_outcomes(self, monkeypatch, compute_only_env):
        def fetch(api, symbol, to_date):
            if symbol == "BAD":
                raise RuntimeError("boom")
            return {"high": 2.0, "low": 1.0, "close": 1.5}

        monkeypatch.setattr(batch, "fetch_range_for_symbol", fetch)
        out = compute_only_env / "52w" / "2026-11-21.json"
        summary = compute_only_env / "52w" / "2026-11-21.summary.json"

        _run(
            monkeypatch,
            [
                "--source", "json",
                "--symbol", "GOOD",
                "--symbol", "BAD",
                "--to-date", "2026-11-21",
                "--output-json", str(out),
                "--summary-json", str(summary),
            ],
        )

        assert json.loads(summary.read_text(encoding="utf-8")) == {
            "as_of": "2026-11-21",
            "ok": 1,
            "failed": 1,
            "skipped": 0,
            "total": 2,
        }


class _FreshRange:
    symbol = "AAA"
    updated_at = datetime.now(config.IST).replace(tzinfo=None)


class _FakeSession:
    def query(self, *args, **kwargs):
        return self

    def all(self):
        return [_FreshRange()]

    def close(self):
        pass


class TestCatchUpNoOp:
    def test_zero_remaining_symbols_exits_zero_with_allow_empty(
        self, monkeypatch, compute_only_env
    ):
        monkeypatch.setattr(batch, "load_symbols", lambda *a, **k: ["AAA"])
        monkeypatch.setattr(batch, "SessionLocal", lambda: _FakeSession())
        monkeypatch.setattr(batch, "fetch_range_for_symbol", _forbid("fetch_range_for_symbol"))
        # No key set: reaching the API stage would exit 1 with a config error.
        monkeypatch.setattr(config, "UPSTOX_API_KEY", "")
        monkeypatch.setattr(config, "UPSTOX_API_SECRET", "")

        _run(
            monkeypatch,
            ["--source", "json", "--skip-updated-today", "--allow-empty", "--no-redis"],
        )

        assert batch.JOB_STATUS_ENABLED is False

    def test_zero_remaining_symbols_still_fails_without_allow_empty(
        self, monkeypatch, compute_only_env
    ):
        monkeypatch.setattr(batch, "load_symbols", lambda *a, **k: ["AAA"])
        monkeypatch.setattr(batch, "SessionLocal", lambda: _FakeSession())
        monkeypatch.setattr(batch, "fetch_range_for_symbol", _forbid("fetch_range_for_symbol"))
        monkeypatch.setattr(config, "UPSTOX_API_KEY", "")
        monkeypatch.setattr(config, "UPSTOX_API_SECRET", "")

        with pytest.raises(SystemExit) as excinfo:
            _run(monkeypatch, ["--source", "json", "--skip-updated-today", "--no-redis"])

        assert excinfo.value.code == 1


class TestWeek52CacheModule:
    def test_bulk_store_defaults_to_24h_ttl(self, monkeypatch):
        import cache.week52 as week52

        calls = {}
        monkeypatch.delenv(week52.TTL_ENV, raising=False)
        monkeypatch.setattr(
            "cache.redis_client.cache_set",
            lambda key, value, ttl=None: calls.update(key=key, value=value, ttl=ttl),
        )

        week52.store_52w_ranges(
            {"AAA": {"high": 2.0, "low": 1.0, "close": 1.5}},
            stamp_from_db=False,
            clear_paper_cache=False,
        )

        assert calls["key"] == "52w_range:all"
        assert calls["ttl"] == 24 * 60 * 60
        assert calls["value"]["AAA"] == {"high": 2.0, "low": 1.0, "close": 1.5}

    def test_ttl_is_configurable_by_env(self, monkeypatch):
        import cache.week52 as week52

        monkeypatch.setenv(week52.TTL_ENV, "600")
        assert week52.resolve_ttl() == 600
        assert week52.resolve_ttl(30) == 30

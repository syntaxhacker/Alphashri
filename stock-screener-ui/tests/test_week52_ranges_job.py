"""Tests for trading.week52.ranges + trading.week52.job (consolidated homes).

Covers sanitize guards, Redis→DB fallback, and job-status lifecycle, plus
parity with the legacy modules the new homes replace.
"""
from unittest.mock import patch

import pytest


class TestSanitizeRangeEntry:
    def test_valid_entry(self):
        from trading.week52.ranges import _sanitize_52w_range_entry

        assert _sanitize_52w_range_entry({"high": 100, "low": 50, "close": 75}) == {
            "high": 100.0,
            "low": 50.0,
            "close": 75.0,
        }

    @pytest.mark.parametrize(
        "entry",
        [
            None,
            "notadict",
            {},
            {"high": 100, "low": 50},
            {"high": None, "low": 50, "close": 75},
            {"high": "x", "low": 50, "close": 75},
            {"high": float("inf"), "low": 50, "close": 75},
        ],
    )
    def test_invalid_entry_returns_none(self, entry):
        from trading.week52.ranges import _sanitize_52w_range_entry

        assert _sanitize_52w_range_entry(entry) is None

    def test_days_ago_int_coerced(self):
        from trading.week52.ranges import _sanitize_52w_range_entry

        out = _sanitize_52w_range_entry({"high": 1, "low": 1, "close": 1, "days_ago": "3"})
        assert out["days_ago"] == 3

    def test_negative_days_ago_clamped(self):
        from trading.week52.ranges import _sanitize_52w_range_entry

        out = _sanitize_52w_range_entry({"high": 1, "low": 1, "close": 1, "days_ago": -5})
        assert out["days_ago"] == 0

    def test_parity_with_legacy(self):
        from trading.week52.ranges import _sanitize_52w_range_entry as new
        from trading.week52_range_lookup import _sanitize_52w_range_entry as old

        sample = {"high": 10, "low": 1, "close": 5, "days_ago": 2}
        assert old(sample) == new(sample)


class TestSanitizeBulk:
    def test_drops_invalid_keeps_valid(self):
        from trading.week52.ranges import _sanitize_52w_ranges_bulk

        out = _sanitize_52w_ranges_bulk(
            {
                "AAA": {"high": 1, "low": 1, "close": 1},
                "BBB": {"high": None, "low": 1, "close": 1},
                "CCC": "garbage",
            }
        )
        assert set(out.keys()) == {"AAA"}

    def test_non_dict_returns_empty(self):
        from trading.week52.ranges import _sanitize_52w_ranges_bulk

        assert _sanitize_52w_ranges_bulk(None) == {}


class TestGet52wRange:
    def test_redis_hit_short_circuits_db(self):
        from trading.week52 import ranges

        with patch("cache.redis_client.cache_get", return_value={"high": 5, "low": 1, "close": 3}) as cg, patch(
            "trading.week52.ranges.SessionLocal"
        ) as sl:
            assert ranges.get_52w_range("AAA") == {"high": 5.0, "low": 1.0, "close": 3.0}
            cg.assert_called_once()
            sl.assert_not_called()

    def test_redis_miss_uses_db_row(self):
        from trading.week52 import ranges

        class _Row:
            high_52w, low_52w, close = 10.0, 4.0, 7.0

        class _Query:
            def filter(self, *a, **k):
                return self

            def first(self):
                return _Row()

        class _DB:
            def query(self, *a, **k):
                return _Query()

            def close(self):
                pass

        with patch("cache.redis_client.cache_get", return_value=None), patch(
            "trading.week52.ranges.SessionLocal", return_value=_DB()
        ):
            out = ranges.get_52w_range("AAA")
        assert out == {"high": 10.0, "low": 4.0, "close": 7.0}

    def test_redis_miss_and_no_db_row_returns_none(self):
        from trading.week52 import ranges

        class _Query:
            def filter(self, *a, **k):
                return self

            def first(self):
                return None

        class _DB:
            def query(self, *a, **k):
                return _Query()

            def close(self):
                pass

        with patch("cache.redis_client.cache_get", return_value=None), patch(
            "trading.week52.ranges.SessionLocal", return_value=_DB()
        ):
            assert ranges.get_52w_range("NOPE") is None


class TestLoadAllRanges:
    def test_redis_bulk_hit_returns_sanitized(self):
        from trading.week52 import ranges

        bulk = {"AAA": {"high": 2, "low": 1, "close": 1.5}, "BAD": {"high": None}}
        with patch("cache.redis_client.cache_get", return_value=bulk):
            out = ranges.load_all_52w_ranges()
        assert set(out.keys()) == {"AAA"}


class TestJobStatus:
    def test_start_job_fields(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value=None
        ):
            job.start_job(10, skip_existing=True)
        fields = cs.call_args[0][1]
        assert fields["status"] == "running"
        assert fields["total"] == 10
        assert fields["skip_existing"] is True

    def test_update_progress_pct(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value={}
        ):
            job.update_job_progress(5, 10, last_symbol="INFY")
        fields = cs.call_args[0][1]
        assert fields["progress_pct"] == 50.0
        assert fields["last_symbol"] == "INFY"

    def test_update_progress_zero_total_no_div_error(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value={}
        ):
            job.update_job_progress(0, 0)
        assert cs.call_args[0][1]["progress_pct"] == 0.0

    def test_finish_job_completed(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value={}
        ):
            job.finish_job(ok=9, failed=1, skipped=0, total=10, elapsed_sec=12.34)
        fields = cs.call_args[0][1]
        assert fields["status"] == "completed"
        assert fields["elapsed_sec"] == 12.3

    def test_finish_job_failed_when_error(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value={}
        ):
            job.finish_job(ok=0, failed=1, skipped=0, total=1, elapsed_sec=1.0, error="boom")
        assert cs.call_args[0][1]["status"] == "failed"


class TestIsJobStale:
    def test_non_running_never_stale(self):
        from trading.week52.job import is_job_stale

        assert is_job_stale({"status": "completed"}) is False
        assert is_job_stale(None) is False

    def test_old_running_is_stale(self):
        from trading.week52.job import is_job_stale

        job = {"status": "running", "updated_at": "2020-01-01T00:00:00+05:30"}
        assert is_job_stale(job) is True

    def test_running_without_timestamp_not_stale(self):
        from trading.week52.job import is_job_stale

        assert is_job_stale({"status": "running"}) is False

    def test_parity_with_legacy(self):
        from trading.week52.job import is_job_stale as new
        from trading.week52_job_status import is_job_stale as old

        sample = {"status": "running", "updated_at": "2020-01-01T00:00:00+05:30"}
        assert old(sample) == new(sample)

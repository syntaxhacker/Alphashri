"""Tests for the canonical trading.week52.ranges and trading.week52.job homes.

Covers bulk-key reads, sanitization (including updated_at), Redis→DB fallback
and the job-status lifecycle. No legacy-module parity assertions.
"""
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from trading.week52 import keys


class TestSanitizeEntry:
    def test_valid_entry(self):
        from trading.week52.ranges import sanitize_entry

        assert sanitize_entry({"high": 100, "low": 50, "close": 75}) == {
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
        from trading.week52.ranges import sanitize_entry

        assert sanitize_entry(entry) is None

    def test_days_ago_int_coerced(self):
        from trading.week52.ranges import sanitize_entry

        out = sanitize_entry({"high": 1, "low": 1, "close": 1, "days_ago": "3"})
        assert out["days_ago"] == 3

    def test_negative_days_ago_clamped(self):
        from trading.week52.ranges import sanitize_entry

        out = sanitize_entry({"high": 1, "low": 1, "close": 1, "days_ago": -5})
        assert out["days_ago"] == 0

    def test_updated_at_string_and_datetime_kept(self):
        from trading.week52.ranges import sanitize_entry

        stamp = "2026-11-27T09:15:00+05:30"
        out = sanitize_entry({"high": 1, "low": 1, "close": 1, "updated_at": stamp})
        assert out["updated_at"] == stamp

        when = datetime(2026, 11, 27, 9, 15, tzinfo=timezone.utc)
        out = sanitize_entry({"high": 1, "low": 1, "close": 1, "updated_at": when})
        assert out["updated_at"] == when.isoformat()

    @pytest.mark.parametrize("stamp", ["", None, 123, object()])
    def test_unusable_updated_at_dropped(self, stamp):
        from trading.week52.ranges import sanitize_entry

        out = sanitize_entry({"high": 1, "low": 1, "close": 1, "updated_at": stamp})
        assert "updated_at" not in out

    def test_underscore_name_is_public_alias(self):
        from trading.week52.ranges import _sanitize_52w_range_entry, sanitize_entry

        assert _sanitize_52w_range_entry is sanitize_entry


class TestSanitizeBulk:
    def test_drops_invalid_keeps_valid_and_updated_at(self):
        from trading.week52.ranges import sanitize_bulk

        out = sanitize_bulk(
            {
                "AAA": {"high": 1, "low": 1, "close": 1, "updated_at": "2026-11-27"},
                "BBB": {"high": None, "low": 1, "close": 1},
                "CCC": "garbage",
            }
        )
        assert out == {"AAA": {"high": 1.0, "low": 1.0, "close": 1.0, "updated_at": "2026-11-27"}}

    def test_non_dict_returns_empty(self):
        from trading.week52.ranges import sanitize_bulk

        assert sanitize_bulk(None) == {}

    def test_underscore_name_is_public_alias(self):
        from trading.week52.ranges import _sanitize_52w_ranges_bulk, sanitize_bulk

        assert _sanitize_52w_ranges_bulk is sanitize_bulk


class TestGet52wRange:
    def test_bulk_key_is_read_first_and_short_circuits_db(self):
        from trading.week52 import ranges

        bulk = {
            "AAA": {"high": 5, "low": 1, "close": 3},
            "BBB": {"high": 500, "low": 1, "close": 300},
        }
        with patch("cache.redis_client.cache_get", return_value=bulk) as cg, patch(
            "trading.week52.ranges.SessionLocal"
        ) as sl:
            out = ranges.get_52w_range("AAA")
        assert out == {"high": 5.0, "low": 1.0, "close": 3.0}
        cg.assert_called_once_with(keys.BULK)
        sl.assert_not_called()

    def test_bulk_entry_updated_at_survives(self):
        from trading.week52 import ranges

        stamp = "2026-11-27T09:15:00+05:30"
        bulk = {"AAA": {"high": 5, "low": 1, "close": 3, "updated_at": stamp}}
        with patch("cache.redis_client.cache_get", return_value=bulk) as cg, patch(
            "trading.week52.ranges.SessionLocal"
        ) as sl:
            out = ranges.get_52w_range("AAA")
        assert out == {"high": 5.0, "low": 1.0, "close": 3.0, "updated_at": stamp}
        cg.assert_called_once_with(keys.BULK)
        sl.assert_not_called()

    def test_invalid_bulk_entry_falls_through_to_db(self):
        from trading.week52 import ranges

        when = datetime(2026, 11, 26, 10, 0, tzinfo=timezone.utc)

        class _Row:
            high_52w, low_52w, close = 10.0, 4.0, 7.0
            updated_at = when

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

        with patch("cache.redis_client.cache_get", return_value={"AAA": {"high": None}}), patch(
            "trading.week52.ranges.SessionLocal", return_value=_DB()
        ):
            out = ranges.get_52w_range("AAA")
        assert out == {"high": 10.0, "low": 4.0, "close": 7.0, "updated_at": when.isoformat()}

    def test_no_bulk_uses_db_row_with_updated_at(self):
        from trading.week52 import ranges

        when = datetime(2026, 11, 26, 10, 0, tzinfo=timezone.utc)

        class _Row:
            high_52w, low_52w, close = 10.0, 4.0, 7.0
            updated_at = when

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

        with patch("cache.redis_client.cache_get", return_value=None) as cg, patch(
            "trading.week52.ranges.SessionLocal", return_value=_DB()
        ):
            out = ranges.get_52w_range("AAA")
        cg.assert_called_once_with(keys.BULK)
        assert out == {"high": 10.0, "low": 4.0, "close": 7.0, "updated_at": when.isoformat()}

    def test_no_bulk_and_no_db_row_returns_none(self):
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
    def test_bulk_key_hit_returns_sanitized(self):
        from trading.week52 import ranges

        stamp = "2026-11-27"
        bulk = {"AAA": {"high": 2, "low": 1, "close": 1.5, "updated_at": stamp}, "BAD": {"high": None}}
        with patch("cache.redis_client.cache_get", return_value=bulk) as cg, patch(
            "trading.week52.ranges.SessionLocal"
        ) as sl:
            out = ranges.load_all_52w_ranges()
        assert out == {"AAA": {"high": 2.0, "low": 1.0, "close": 1.5, "updated_at": stamp}}
        cg.assert_called_once_with(keys.BULK)
        sl.assert_not_called()

    def test_db_fallback_when_bulk_empty(self):
        from trading.week52 import ranges

        class _Row:
            symbol = "AAA"
            high_52w, low_52w, close = 10.0, 4.0, 7.0
            updated_at = None

        class _Query:
            def all(self):
                return [_Row()]

        class _DB:
            def query(self, *a, **k):
                return _Query()

            def close(self):
                pass

        with patch("cache.redis_client.cache_get", return_value={}), patch(
            "trading.week52.ranges.SessionLocal", return_value=_DB()
        ) as sl:
            out = ranges.load_all_52w_ranges()
        assert out == {"AAA": {"high": 10.0, "low": 4.0, "close": 7.0}}
        sl.assert_called_once()


class TestJobStatus:
    def test_public_names_use_canonical_keys(self):
        from trading.week52 import job

        assert job.JOB_STATUS_KEY == keys.JOB_STATUS
        assert job.JOB_STATUS_TTL == keys.JOB_TTL
        assert job.STALE_DEFAULT_SEC == 1800

    def test_get_job_status_none_for_non_dict(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_get", return_value="garbage"):
            assert job.get_job_status() is None

    def test_set_job_status_uses_job_ttl(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value=None
        ):
            job.set_job_status(status="running")
        assert cs.call_args.kwargs["ttl"] == keys.JOB_TTL

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

    def test_complete_job_marks_completed(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value={}
        ):
            job.complete_job(ok=3, failed=0, skipped=1, total=4, elapsed_sec=2.0)
        fields = cs.call_args[0][1]
        assert fields["status"] == "completed"
        assert fields["processed"] == 4
        assert fields["ok"] == 3

    def test_fail_job_marks_failed(self):
        from trading.week52 import job

        with patch("cache.redis_client.cache_set") as cs, patch(
            "cache.redis_client.cache_get", return_value={}
        ):
            job.fail_job("crashed")
        fields = cs.call_args[0][1]
        assert fields["status"] == "failed"
        assert fields["error"] == "crashed"

    def test_stale_threshold_delegates_to_config(self):
        from trading.week52 import job

        with patch("trading.week52.job.job_stale_sec", return_value=42) as reader:
            assert job.get_stale_threshold_sec() == 42
        reader.assert_called_once_with()


class TestIsJobStale:
    def test_non_running_never_stale(self):
        from trading.week52.job import is_job_stale

        assert is_job_stale({"status": "completed"}) is False
        assert is_job_stale(None) is False

    def test_old_running_is_stale(self):
        from trading.week52.job import is_job_stale

        job = {"status": "running", "updated_at": "2020-01-01T00:00:00+05:30"}
        assert is_job_stale(job) is True

    def test_fresh_running_is_not_stale(self):
        from trading.week52.job import is_job_stale

        job = {"status": "running", "updated_at": "2999-01-01T00:00:00+05:30"}
        assert is_job_stale(job) is False

    def test_running_without_timestamp_not_stale(self):
        from trading.week52.job import is_job_stale

        assert is_job_stale({"status": "running"}) is False

    def test_job_age_uses_updated_at_then_started_at(self):
        from trading.week52.job import job_age_sec

        stamp = datetime(2020, 1, 1, 0, 0, tzinfo=timezone.utc)
        updated = job_age_sec({"status": "running", "updated_at": stamp.isoformat(), "started_at": "bad"})
        started = job_age_sec({"status": "running", "started_at": stamp.isoformat()})
        assert updated is not None and started is not None
        assert abs(updated - started) < 1

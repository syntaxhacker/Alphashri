"""Unit tests for 52W range batch stale-job detection.

Pure dict-level tests over trading.week52_job_status helpers — no Redis access.
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import config
from trading.week52_job_status import (
    get_stale_threshold_sec,
    is_job_stale,
    job_age_sec,
)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _now() -> datetime:
    return datetime.now(config.IST)


def _running_job(age_sec: float) -> dict:
    ts = _iso(_now() - timedelta(seconds=age_sec))
    return {
        "status": "running",
        "processed": 2050,
        "total": 2670,
        "started_at": ts,
        "updated_at": ts,
        "last_symbol": "SALASAR",
    }


class TestJobAgeSec:
    def test_none_job_returns_none(self):
        assert job_age_sec(None) is None

    def test_missing_timestamps_returns_none(self):
        assert job_age_sec({"status": "running"}) is None

    def test_unparseable_timestamp_returns_none(self):
        assert job_age_sec({"status": "running", "updated_at": "not-a-date"}) is None

    def test_recent_job_small_age(self):
        job = _running_job(60)
        age = job_age_sec(job)
        assert age is not None
        assert 0 <= age < 300

    def test_falls_back_to_started_at(self):
        job = {"status": "running", "started_at": _iso(_now() - timedelta(hours=2))}
        age = job_age_sec(job)
        assert age is not None
        assert age > 3600


class TestIsJobStale:
    def test_fresh_running_not_stale(self):
        assert is_job_stale(_running_job(60), stale_sec=1800) is False

    def test_old_running_is_stale(self):
        # Mirrors the stuck 2026-09-29 batch: running for ~6 days.
        assert is_job_stale(_running_job(6 * 86400), stale_sec=1800) is True

    def test_completed_never_stale(self):
        job = _running_job(6 * 86400)
        job["status"] = "completed"
        assert is_job_stale(job, stale_sec=1800) is False

    def test_failed_never_stale(self):
        job = _running_job(6 * 86400)
        job["status"] = "failed"
        assert is_job_stale(job, stale_sec=1800) is False

    def test_idle_never_stale(self):
        assert is_job_stale({"status": "idle"}, stale_sec=1800) is False

    def test_no_timestamp_not_stale(self):
        assert is_job_stale({"status": "running"}, stale_sec=1800) is False

    def test_boundary(self):
        assert is_job_stale(_running_job(1799), stale_sec=1800) is False
        assert is_job_stale(_running_job(1801), stale_sec=1800) is True

    def test_uses_env_threshold_by_default(self):
        os.environ["SCREENER_52W_STALE_SEC"] = "3600"
        try:
            assert is_job_stale(_running_job(2000)) is False
            assert is_job_stale(_running_job(4000)) is True
        finally:
            del os.environ["SCREENER_52W_STALE_SEC"]


class TestStaleThreshold:
    def test_default(self):
        os.environ.pop("SCREENER_52W_STALE_SEC", None)
        assert get_stale_threshold_sec() == 1800

    def test_env_override(self):
        os.environ["SCREENER_52W_STALE_SEC"] = "600"
        try:
            assert get_stale_threshold_sec() == 600
        finally:
            del os.environ["SCREENER_52W_STALE_SEC"]

    def test_bad_env_falls_back(self):
        os.environ["SCREENER_52W_STALE_SEC"] = "not-a-number"
        try:
            assert get_stale_threshold_sec() == 1800
        finally:
            del os.environ["SCREENER_52W_STALE_SEC"]

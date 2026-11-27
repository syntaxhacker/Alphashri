"""REDIS_DISABLED short-circuit and single-warning degradation."""
import logging
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import redis as redis_module

import cache.redis_client as rc


def _forbid_from_url(*args, **kwargs):
    pytest.fail("redis.from_url must not be called when Redis is disabled")


@pytest.fixture(autouse=True)
def _reset_redis_state(monkeypatch):
    rc._redis_client = None
    rc._redis_available = False
    rc._redis_unavailable_until = 0.0
    rc._unavailable_warned = False
    rc._CONSECUTIVE_FAILURES = 0
    monkeypatch.delenv("REDIS_DISABLED", raising=False)
    yield
    rc._redis_client = None
    rc._redis_available = False
    rc._redis_unavailable_until = 0.0
    rc._unavailable_warned = False
    rc._CONSECUTIVE_FAILURES = 0


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "Yes"])
def test_disabled_returns_none_without_from_url(monkeypatch, caplog, value):
    monkeypatch.setattr(redis_module, "from_url", _forbid_from_url)
    monkeypatch.setenv("REDIS_DISABLED", value)
    with caplog.at_level(logging.WARNING, logger="cache.redis"):
        assert rc.get_redis_client() is None
    assert "Redis unavailable" not in caplog.text


def test_flag_is_read_at_call_time(monkeypatch):
    monkeypatch.setattr(
        redis_module, "from_url", lambda *a, **k: MagicMock(ping=lambda: None)
    )
    monkeypatch.setenv("REDIS_DISABLED", "1")
    assert rc.get_redis_client() is None
    monkeypatch.delenv("REDIS_DISABLED")
    assert rc.get_redis_client() is not None


def test_cache_helpers_degrade_without_redis(monkeypatch):
    monkeypatch.setattr(redis_module, "from_url", _forbid_from_url)
    monkeypatch.setenv("REDIS_DISABLED", "1")
    assert rc.cache_get("52w_range:all") is None
    assert rc.cache_set("52w_range:all", {"A": 1}) is False


def test_unavailable_warns_once_and_does_not_retry_per_call(monkeypatch, caplog):
    calls = []

    def failing_client(*args, **kwargs):
        calls.append(args)
        error = OSError("Error 111 connecting to localhost:6379")
        return MagicMock(ping=MagicMock(side_effect=error))

    monkeypatch.setattr(redis_module, "from_url", failing_client)
    with caplog.at_level(logging.WARNING, logger="cache.redis"):
        results = [rc.get_redis_client() for _ in range(5)]
    assert results == [None] * 5
    assert len(calls) == 1, "one failure must not turn into a 5s retry loop per cache call"
    assert caplog.text.count("Redis unavailable, caching disabled") == 1
    assert rc.is_cache_available() is False


def test_reconnect_after_cooldown_stays_quiet(monkeypatch, caplog):
    calls = []

    def failing_client(*args, **kwargs):
        calls.append(args)
        return MagicMock(ping=MagicMock(side_effect=OSError("Error 111")))

    monkeypatch.setattr(redis_module, "from_url", failing_client)
    with caplog.at_level(logging.WARNING, logger="cache.redis"):
        rc.get_redis_client()
        rc._redis_unavailable_until = 0.0
        assert rc.get_redis_client() is None
    assert len(calls) == 2
    assert caplog.text.count("Redis unavailable, caching disabled") == 1

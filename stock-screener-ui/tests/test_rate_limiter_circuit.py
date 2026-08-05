"""Unit tests for the Upstox 429 circuit breaker (rate_limiter.py).

The circuit breaker is Redis-backed and shared across bot processes so a
Cloudflare/Upstox 429 block pauses all bots together instead of hammering.
These tests use a fake Redis-like client so no real Redis is required.
"""
import sys
from pathlib import Path

# upstox_trader lives in the workspace root (parent of stock-screener-ui).
_UI_DIR = Path(__file__).resolve().parent.parent
_ROOT = _UI_DIR.parent
for _p in (str(_ROOT), str(_UI_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import time
import pytest

from upstox_trader.rate_limiter import (
    UpstoxRateLimiter,
    CIRCUIT_FAIL_THRESHOLD,
    CIRCUIT_COOLDOWN_SECONDS,
)


class FakeRedis:
    """Minimal in-memory stand-in for the redis client methods used."""

    def __init__(self):
        self._store = {}
        self._counters = {}

    def get(self, key):
        val = self._store.get(key)
        if val is None:
            return None
        return val

    def set(self, key, value, ex=None):
        self._store[key] = value
        if ex is not None:
            self._store[f"__exp_{key}"] = time.time() + ex

    def delete(self, *keys):
        for k in keys:
            self._store.pop(k, None)
            self._store.pop(f"__exp_{k}", None)
            self._counters.pop(k, None)

    def incr(self, key):
        self._counters[key] = self._counters.get(key, 0) + 1
        return self._counters[key]

    def expire(self, key, seconds):
        return True

    def ping(self):
        return True

    def zcount(self, key, start, end):
        return 0

    def zremrangebyscore(self, key, start, end):
        return 0


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture
def limiter(fake_redis):
    return UpstoxRateLimiter(redis_client=fake_redis)


def test_circuit_closed_initially(limiter):
    assert limiter.circuit_seconds_to_wait() == 0


def test_failures_under_threshold_do_not_open_circuit(limiter):
    for _ in range(CIRCUIT_FAIL_THRESHOLD - 1):
        limiter.record_failure()
    assert limiter.circuit_seconds_to_wait() == 0


def test_threshold_failures_open_circuit(limiter, fake_redis):
    for _ in range(CIRCUIT_FAIL_THRESHOLD):
        limiter.record_failure()
    wait = limiter.circuit_seconds_to_wait()
    assert 0 < wait <= CIRCUIT_COOLDOWN_SECONDS
    assert fake_redis.get("upstox:circuit:fails") is None  # counter reset


def test_success_resets_failure_counter(limiter, fake_redis):
    for _ in range(CIRCUIT_FAIL_THRESHOLD - 1):
        limiter.record_failure()
    limiter.record_success()
    assert fake_redis.get("upstox:circuit:fails") is None
    assert limiter.circuit_seconds_to_wait() == 0


def test_remaining_minute_budget_with_fake_redis(limiter, fake_redis):
    # FakeRedis reports 0 hits in the window -> full budget
    assert limiter.remaining_minute_budget() == 500

"""Unit tests for scripts/upstox_rate.py — fake clock, no sleeps, no network."""
import pytest

from scripts.upstox_rate import UpstoxRateLimiter

pytestmark = pytest.mark.unit


class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.sleeps: list[float] = []

    def clock(self):
        return self.now

    def sleep(self, seconds: float):
        self.sleeps.append(seconds)
        self.now += seconds


def _limiter(per_second=5, per_minute=10):
    fake = FakeClock()
    lim = UpstoxRateLimiter(per_second=per_second, per_minute=per_minute,
                            clock=fake.clock, sleep=fake.sleep)
    return lim, fake


def test_defaults_match_docs():
    lim = UpstoxRateLimiter()
    assert lim.per_second == 50
    assert lim.per_minute == 500
    assert lim.per_30_min == 2000


def test_thirty_minute_cap_binds_when_second_and_minute_allow():
    fake = FakeClock()
    lim = UpstoxRateLimiter(per_second=1000, per_minute=1000, per_30_min=3,
                            clock=fake.clock, sleep=fake.sleep)
    assert all(lim.try_acquire() for _ in range(3))
    assert lim.try_acquire() is False
    # one token per 30 min / 3 = 600 s
    assert lim.wait_time() == pytest.approx(600.0, abs=1e-9)
    fake.now += 600.0
    assert lim.try_acquire() is True
    assert lim.try_acquire() is False


def test_burst_then_throttle_per_second():
    lim, fake = _limiter(per_second=5, per_minute=1000)
    assert all(lim.try_acquire() for _ in range(5))
    assert lim.try_acquire() is False
    assert lim.wait_time() == pytest.approx(0.2, abs=1e-9)
    fake.now += 0.2
    assert lim.try_acquire() is True


def test_per_minute_cap_binds_first():
    lim, fake = _limiter(per_second=1000, per_minute=4)
    assert all(lim.try_acquire() for _ in range(4))
    assert lim.try_acquire() is False
    assert lim.wait_time() == pytest.approx(15.0, abs=1e-9)


def test_refill_over_time():
    lim, fake = _limiter(per_second=2, per_minute=1000)
    assert lim.try_acquire() and lim.try_acquire()
    assert lim.try_acquire() is False
    fake.now += 1.0  # 2 tokens regenerated
    assert lim.try_acquire() and lim.try_acquire()
    assert lim.try_acquire() is False


def test_acquire_blocks_via_fake_sleep():
    lim, fake = _limiter(per_second=2, per_minute=1000)
    lim.acquire()
    lim.acquire()
    assert lim.try_acquire() is False
    assert lim.acquire() is True  # consumes fake sleep instead of wall time
    assert fake.sleeps and all(s >= 0 for s in fake.sleeps)
    assert fake.now > 1000.0


def test_denied_request_consumes_nothing():
    lim, fake = _limiter(per_second=1, per_minute=1000)
    assert lim.try_acquire() is True
    assert lim.try_acquire() is False
    fake.now += 1.0
    # exactly one token regenerated — a denied attempt must not double-spend
    assert lim.try_acquire() is True
    assert lim.try_acquire() is False


def test_invalid_caps_rejected():
    with pytest.raises(ValueError):
        UpstoxRateLimiter(per_second=0)
    with pytest.raises(ValueError):
        UpstoxRateLimiter(per_minute=-1)

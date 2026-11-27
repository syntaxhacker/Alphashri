"""Both options routes share one lazy, fail-open limiter per consumer."""

import pytest

from api.reports_api import _rate_limit, options_recorder, options_report


@pytest.fixture(autouse=True)
def _clean_limiters():
    _rate_limit.reset_rate_limiter()
    yield
    _rate_limit.reset_rate_limiter()


def test_limiter_is_lazy_and_cached_per_consumer(monkeypatch):
    instances = []

    class FakeLimiter:
        def __init__(self, consumer=None):
            self.consumer = consumer
            instances.append(self)

    monkeypatch.setattr("upstox_trader.rate_limiter.UpstoxRateLimiter", FakeLimiter)

    limiter = _rate_limit.get_rate_limiter("options")
    assert limiter is _rate_limit.get_rate_limiter("options")
    assert len(instances) == 1
    assert limiter.consumer == "options"

    other = _rate_limit.get_rate_limiter("api")
    assert other is not limiter
    assert other.consumer == "api"
    assert len(instances) == 2


def test_failed_construction_is_cached_as_none(monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("trader package unavailable")

    monkeypatch.setattr("upstox_trader.rate_limiter.UpstoxRateLimiter", unavailable)

    assert _rate_limit.get_rate_limiter("options") is None
    assert _rate_limit.get_rate_limiter("options") is None


def test_report_and_recorder_share_the_options_limiter(monkeypatch):
    consumers = []

    class FakeLimiter:
        def __init__(self, consumer=None):
            self.consumer = consumer
            consumers.append(consumer)

    monkeypatch.setattr("upstox_trader.rate_limiter.UpstoxRateLimiter", FakeLimiter)

    assert options_report._rate_limiter().consumer == "options"
    assert options_recorder._rate_limiter().consumer == "options"
    assert consumers == ["options"]


def test_recorder_reset_drops_the_cached_limiter(monkeypatch):
    instances = []

    class FakeLimiter:
        def __init__(self, consumer=None):
            instances.append(self)

    monkeypatch.setattr("upstox_trader.rate_limiter.UpstoxRateLimiter", FakeLimiter)

    options_recorder._rate_limiter()
    options_recorder._reset_state()
    options_recorder._rate_limiter()
    assert len(instances) == 2

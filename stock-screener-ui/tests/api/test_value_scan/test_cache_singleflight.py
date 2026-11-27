"""Cold-cache single-flight regression tests for the Deep Value cache.

A market scan can take ~40s while the old loser bound was 5s, so concurrent
cold requests used to time out and each recompute the same market. These tests
pin that concurrent cold callers coalesce onto a single upstream fetch.
"""

import threading
import time

import pytest

from api.value_scan import cache as cache_module


@pytest.fixture(autouse=True)
def _clean_flights():
    # Each test starts with an empty in-process flight registry.
    cache_module._inflight.clear()
    yield
    cache_module._inflight.clear()


def _row(symbol):
    """Minimal scored-frame row; enough for frame_summary and scoring."""
    return {
        "name": f"NSE:{symbol}",
        "description": f"{symbol} Ltd",
        "type": "stock",
        "sector": "Energy",
        "exchange": "NSE",
        "currency": "INR",
        "close": 100.0,
        "market_cap_basic": 5e9,
        "free_cash_flow_ttm": 5e7,
        "price_earnings_ttm": 12.0,
        "price_sales_ratio": 1.5,
        "price_book_fq": 1.2,
        "return_on_equity_fq": 15.0,
        "score": 70.0,
    }


@pytest.fixture
def fake_redis():
    import fakeredis

    fake = fakeredis.FakeRedis(decode_responses=True)
    # cache.py captured these helpers at import time; they all delegate to
    # cache.redis_client's module globals, so pointing those at fakeredis is
    # enough to exercise the real redis-cold path without a server.
    import cache.redis_client as rc

    rc._redis_client = fake
    rc._redis_available = True
    yield fake
    rc._redis_client = None
    rc._redis_available = False


def _run_concurrently(n, fn):
    barrier = threading.Barrier(n)
    results, errors = [], []
    results_lock = threading.Lock()

    def worker():
        try:
            barrier.wait(timeout=5)
            outcome = fn()
            with results_lock:
                results.append(outcome)
        except BaseException as exc:  # pragma: no cover - surfaced below
            with results_lock:
                errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(n)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    assert not errors, errors
    assert not any(t.is_alive() for t in threads), "a worker hung"
    assert len(results) == n
    return results


class _FastClock:
    """A cache-module clock whose sleeps advance time instantly.

    Used to model a scan that outlives the *old* 5s loser bound without making
    the test actually wait 5s. Against the old implementation every loser's
    poll loop exhausts its deadline immediately and starts a duplicate fetch,
    so ``calls`` would contain more than one entry and this test would fail.
    The new implementation has no time-based loser loop — in-process followers
    wait on a threading.Event — so the accelerated clock is inert here.
    """

    def __init__(self):
        self.now = 1000.0

    def time(self):
        return self.now

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def test_concurrent_cold_requests_fetch_once(fake_redis, monkeypatch):
    """N simultaneous cold callers must trigger exactly one upstream fetch."""
    calls = []
    release = threading.Event()
    entered = threading.Event()
    release_lock = threading.Lock()

    def slow_fetch(market):
        with release_lock:
            calls.append(market)
        entered.set()
        # Hold the compute until every worker has had a chance to join the
        # in-process flight. The accelerated clock below makes this behave like
        # a >40s scan for any time-based loser loop, with no real waiting.
        assert release.wait(timeout=10), "test never released the fetch"
        return [_row("RELIANCE")]

    monkeypatch.setattr(cache_module, "fetch_frame", slow_fetch)
    monkeypatch.setattr(cache_module, "is_cache_available", lambda: True)
    monkeypatch.setattr(cache_module, "get_redis_client", lambda: fake_redis)
    monkeypatch.setattr(cache_module, "time", _FastClock())

    n = 8

    def call():
        return cache_module.get_scored_frame("india")

    # Release the leader only after the other workers have joined the flight.
    def release_when_ready():
        assert entered.wait(timeout=5), "leader never entered fetch_frame"
        time.sleep(0.3)
        release.set()

    releaser = threading.Thread(target=release_when_ready)
    releaser.start()
    try:
        results = _run_concurrently(n, call)
    finally:
        release.set()
        releaser.join(timeout=5)

    assert calls == ["india"], f"expected one fetch, got {len(calls)}: {calls}"

    # Exactly one leader reports cached=False (it computed); every coalesced
    # follower sees cached=True, matching the response shape from before.
    cached_flags = sorted(meta["cached"] for _, meta in results)
    assert cached_flags == [False] + [True] * (n - 1)
    for rows, meta in results:
        assert len(rows) == 1
        assert rows[0]["name"] == "NSE:RELIANCE"
        assert meta["scanned"] == 1
        assert set(meta) == {"as_of", "cached", "age_seconds", "scanned",
                             "fields_complete", "warnings"}


def test_concurrent_cold_requests_fetch_once_without_redis(monkeypatch):
    """The redis-down path must coalesce too (no shared lock there)."""
    calls = []
    release = threading.Event()
    entered = threading.Event()

    def slow_fetch(market):
        calls.append(market)
        entered.set()
        assert release.wait(timeout=10), "test never released the fetch"
        return [_row("INFY")]

    monkeypatch.setattr(cache_module, "fetch_frame", slow_fetch)
    monkeypatch.setattr(cache_module, "is_cache_available", lambda: False)
    monkeypatch.setattr(cache_module, "get_redis_client", lambda: None)

    def release_when_ready():
        assert entered.wait(timeout=5)
        time.sleep(0.3)
        release.set()

    releaser = threading.Thread(target=release_when_ready)
    releaser.start()
    try:
        results = _run_concurrently(6, lambda: cache_module.get_scored_frame("usa"))
    finally:
        release.set()
        releaser.join(timeout=5)

    assert calls == ["usa"], f"expected one fetch, got {len(calls)}: {calls}"
    for rows, meta in results:
        assert len(rows) == 1
        assert meta["cached"] is False
        assert "cache_unavailable" in meta["warnings"]


def test_second_wave_uses_the_cached_frame(fake_redis, monkeypatch):
    """After the leader stores the frame, later callers never fetch again."""
    calls = []

    def fetch(market):
        calls.append(market)
        return [_row("TCS")]

    monkeypatch.setattr(cache_module, "fetch_frame", fetch)
    monkeypatch.setattr(cache_module, "is_cache_available", lambda: True)
    monkeypatch.setattr(cache_module, "get_redis_client", lambda: fake_redis)

    rows, meta = cache_module.get_scored_frame("india")
    assert meta["cached"] is False
    rows, meta = cache_module.get_scored_frame("india")
    assert meta["cached"] is True
    assert calls == ["india"]

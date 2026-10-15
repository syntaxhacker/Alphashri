"""Unit tests for QueuedRateLimiter throughput tuning.

All HTTP is stubbed at the ``requests.Session.request`` layer and the
Redis-backed ``UpstoxRateLimiter`` is replaced with an in-memory stub, so
these tests never touch the live Upstox API (currently in shared 429
back-off) and need no Redis.
"""
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# upstox_trader lives in the workspace root (parent of stock-screener-ui).
_UI_DIR = Path(__file__).resolve().parent.parent
_ROOT = _UI_DIR.parent
for _p in (str(_ROOT), str(_UI_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pytest
import requests

from upstox_trader.queued_rate_limiter import (
    DEFAULT_MAX_WORKERS,
    RATE_BUDGET_PER_SECOND,
    CircuitOpenError,
    QueuedRateLimiter,
    estimated_rps,
    resolve_max_workers,
    within_rate_budget,
)


class FakeResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


class StubRL:
    """Stand-in for UpstoxRateLimiter: always grants a slot, circuit closed."""

    def __init__(self):
        self.cancelled = 0
        self.failures = 0
        self.successes = 0

    def acquire(self, timeout=3.0):
        return True

    def cancel_last(self):
        self.cancelled += 1

    def record_failure(self):
        self.failures += 1

    def record_success(self):
        self.successes += 1

    def circuit_seconds_to_wait(self):
        return 0


@pytest.fixture
def stub_rls(monkeypatch):
    """Route every worker's thread-local RL to a shared StubRL."""
    stub = StubRL()
    monkeypatch.setattr(QueuedRateLimiter, "_thread_rl", lambda self: stub)
    return stub


def _stub_session_request(monkeypatch, latency=0.0, status=200, tracker=None):
    """Stub Session.request with a fake sleep; optionally track concurrency."""
    state = {"in_flight": 0, "max_in_flight": 0, "sessions": set(), "calls": 0}
    lock = threading.Lock()

    def fake_request(session_self, method, url, **kwargs):
        with lock:
            state["in_flight"] += 1
            state["max_in_flight"] = max(state["max_in_flight"], state["in_flight"])
            state["sessions"].add(id(session_self))
            state["calls"] += 1
        try:
            if latency:
                time.sleep(latency)
            return FakeResponse(status)
        finally:
            with lock:
                state["in_flight"] -= 1

    monkeypatch.setattr(requests.Session, "request", fake_request)
    if tracker is not None:
        tracker.update(state)
    return state


# --- worker-count resolution ---

def test_default_max_workers_is_20(monkeypatch):
    monkeypatch.delenv("UPSTOX_RL_MAX_WORKERS", raising=False)
    assert resolve_max_workers() == 20
    assert DEFAULT_MAX_WORKERS == 20
    rl = QueuedRateLimiter()
    try:
        assert rl.max_workers == 20
    finally:
        rl.shutdown()


def test_max_workers_env_override(monkeypatch):
    monkeypatch.setenv("UPSTOX_RL_MAX_WORKERS", "7")
    assert resolve_max_workers() == 7
    rl = QueuedRateLimiter()
    try:
        assert rl.max_workers == 7
    finally:
        rl.shutdown()


def test_max_workers_invalid_env_falls_back(monkeypatch):
    for bad in ("", "0", "-3", "abc"):
        monkeypatch.setenv("UPSTOX_RL_MAX_WORKERS", bad)
        assert resolve_max_workers() == DEFAULT_MAX_WORKERS
    rl = QueuedRateLimiter(max_workers=3)
    try:
        assert rl.max_workers == 3  # explicit arg wins over env
    finally:
        rl.shutdown()


# --- utilisation budget guard ---

def test_default_pool_stays_under_limiter_budget():
    # 20 workers × ~2s Upstox latency ≈ 10 req/s, comfortably under 50/s.
    assert estimated_rps(DEFAULT_MAX_WORKERS, 2.0) == pytest.approx(10.0)
    assert within_rate_budget(DEFAULT_MAX_WORKERS, 2.0)
    assert within_rate_budget(DEFAULT_MAX_WORKERS, 1.0)  # 20/s < 50/s
    # But at very low latency the same pool WOULD self-inflict a 429 —
    # the guard must actually fire so the sizing stays honest.
    assert not within_rate_budget(DEFAULT_MAX_WORKERS, 0.1)  # 200/s >= 50/s
    assert RATE_BUDGET_PER_SECOND == 50


# --- concurrency proof (mock sleeps, no live API) ---

def _run_parallel(rl, n_requests):
    """Issue n_requests executes from parallel caller threads; return elapsed."""
    start = threading.Event()

    def one(i):
        start.wait(timeout=5.0)
        return rl.execute("GET", f"http://mock/{i}")

    with ThreadPoolExecutor(max_workers=n_requests) as callers:
        futures = [callers.submit(one, i) for i in range(n_requests)]
        t0 = time.monotonic()
        start.set()
        for f in futures:
            assert f.result(timeout=30).status_code == 200
        return time.monotonic() - t0


def test_raising_workers_raises_concurrency(monkeypatch, stub_rls):
    latency = 0.3
    _stub_session_request(monkeypatch, latency=latency)
    # Module-level requests.request must NOT be used (fresh TLS handshake
    # per call); the pool must go through the persistent per-worker Session.
    monkeypatch.setattr(
        requests, "request",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("must use Session.request")),
    )

    small = QueuedRateLimiter(max_workers=2)
    try:
        t0 = time.monotonic()
        start = threading.Event()

        def one(i):
            start.wait(timeout=5.0)
            return small.execute("GET", f"http://mock/{i}")

        with ThreadPoolExecutor(max_workers=4) as callers:
            futures = [callers.submit(one, i) for i in range(4)]
            start.set()
            for f in futures:
                assert f.result(timeout=30).status_code == 200
        elapsed_small = time.monotonic() - t0
    finally:
        small.shutdown()
    # 4 × 0.3s over 2 workers ≈ 0.6s (two waves); must NOT finish in one wave.
    assert elapsed_small >= 2 * latency * 0.9

    wide = QueuedRateLimiter(max_workers=4)
    try:
        elapsed_wide = _run_parallel(wide, 4)
    finally:
        wide.shutdown()
    # 4 × 0.3s over 4 workers ≈ 0.3s (single wave) — more workers, faster.
    assert elapsed_wide < elapsed_small
    assert elapsed_wide < 2 * latency * 0.9 + 0.5


def test_workers_run_in_parallel_up_to_cap(monkeypatch, stub_rls):
    state = _stub_session_request(monkeypatch, latency=0.3)
    rl = QueuedRateLimiter(max_workers=3)
    try:
        _run_parallel(rl, 6)
    finally:
        rl.shutdown()
    assert state["max_in_flight"] == 3  # capped by the pool, fully utilised
    assert state["calls"] == 6


def test_worker_sessions_are_persistent_and_reused(monkeypatch, stub_rls):
    state = _stub_session_request(monkeypatch, latency=0.0)
    rl = QueuedRateLimiter(max_workers=2)
    try:
        for i in range(6):
            assert rl.execute("GET", f"http://mock/{i}").status_code == 200
    finally:
        rl.shutdown()
    assert state["calls"] == 6
    # 6 calls but at most 2 distinct Session objects — connections reused.
    assert 1 <= len(state["sessions"]) <= 2


# --- circuit / back-pressure semantics unchanged ---

def test_saturated_limiter_fails_fast(monkeypatch):
    """acquire() never grants -> max_wait_time raises Timeout instead of piling up."""
    class NeverRL(StubRL):
        def acquire(self, timeout=3.0):
            return False

    monkeypatch.setattr(QueuedRateLimiter, "_thread_rl", lambda self: NeverRL())
    _stub_session_request(monkeypatch, latency=0.0)
    rl = QueuedRateLimiter(max_workers=1, max_wait_time=0.3)
    try:
        t0 = time.monotonic()
        with pytest.raises(requests.Timeout):
            rl.execute("GET", "http://mock/x")
        assert time.monotonic() - t0 < 10
    finally:
        rl.shutdown()


def test_open_circuit_raises_without_recording_failure(monkeypatch):
    rl = QueuedRateLimiter(max_workers=1)
    try:
        stub = StubRL()
        monkeypatch.setattr(QueuedRateLimiter, "_thread_rl", lambda self: stub)
        monkeypatch.setattr(
            QueuedRateLimiter, "_wait_for_circuit",
            lambda self: (_ for _ in ()).throw(CircuitOpenError("open")),
        )
        with pytest.raises(CircuitOpenError):
            rl.execute("GET", "http://mock/x")
        assert stub.failures == 0  # circuit-skip is not a fresh failure
    finally:
        rl.shutdown()


def test_429_cancels_slot_and_records_failure(monkeypatch, stub_rls):
    _stub_session_request(monkeypatch, status=429)
    rl = QueuedRateLimiter(max_workers=1)
    try:
        assert rl.execute("GET", "http://mock/x").status_code == 429
    finally:
        rl.shutdown()
    assert stub_rls.cancelled == 1
    assert stub_rls.failures == 1
    assert stub_rls.successes == 0


def test_200_records_success(monkeypatch, stub_rls):
    _stub_session_request(monkeypatch, status=200)
    rl = QueuedRateLimiter(max_workers=1)
    try:
        assert rl.execute("GET", "http://mock/x").status_code == 200
    finally:
        rl.shutdown()
    assert stub_rls.successes == 1
    assert stub_rls.failures == 0

"""The reporting backend's in-memory caches must stay bounded.

Their keys embed user-supplied windows / symbol lists / expiries, so an
unbounded dict grows with every distinct request on a long-lived server.
"""

import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.fyers_options import _CHAIN_CACHE, _CHAIN_CACHE_MAX, _cache_put  # noqa: E402
from api.reports_api import nifty  # noqa: E402
from api.reports_api import nifty_intel  # noqa: E402


def test_fyers_chain_cache_is_bounded():
    _CHAIN_CACHE.clear()
    for i in range(_CHAIN_CACHE_MAX + 20):
        _cache_put(("NIFTY", f"2026-10-{(i % 28) + 1:02d}"), (time.monotonic(), {"i": i}))
    assert len(_CHAIN_CACHE) <= _CHAIN_CACHE_MAX
    # The most recent entry is kept.
    assert _CHAIN_CACHE[("NIFTY", f"2026-10-{((_CHAIN_CACHE_MAX + 19) % 28) + 1:02d}")][1]["i"] == _CHAIN_CACHE_MAX + 19
    _CHAIN_CACHE.clear()


def test_intel_cache_is_bounded():
    nifty_intel._cache.clear()
    for i in range(nifty_intel._CACHE_MAX + 20):
        nifty_intel._cache_put(("2026-10-01", "current_week", 5), {"i": i}, 300.0)
    assert len(nifty_intel._cache) <= nifty_intel._CACHE_MAX
    nifty_intel._cache.clear()


def test_intel_flight_locks_are_bounded():
    nifty_intel._flight_locks.clear()
    for i in range(nifty_intel._CACHE_MAX + 20):
        nifty_intel._flight_lock(("2026-10-01", f"expiry-{i}", 5))
    assert len(nifty_intel._flight_locks) <= nifty_intel._CACHE_MAX
    nifty_intel._flight_locks.clear()


def test_nifty_live_cache_is_bounded_across_distinct_expiries(monkeypatch):
    # ``expiry`` is a caller-supplied query param: one ~60KB report per value
    # would grow the dict forever without the cap.
    nifty._live_cache.clear()

    async def _fake_compute(expiry, expiries=None):
        return {"spot": 1.0}

    monkeypatch.setattr(nifty, "_compute_live", _fake_compute)

    async def _sweep():
        for i in range(nifty._CACHE_MAX + 20):
            await nifty.get_cached_live(f"expiry-{i}")

    asyncio.run(_sweep())
    assert len(nifty._live_cache) <= nifty._CACHE_MAX
    nifty._live_cache.clear()


def test_nifty_candles_cache_is_bounded_across_distinct_dates(monkeypatch):
    nifty._candles_cache.clear()
    monkeypatch.setattr(nifty, "_fetch_nifty_candles", lambda day, walkback=0: [])
    for i in range(nifty._CACHE_MAX + 20):
        nifty._fetch_nifty_candles_cached(f"2027-{i % 12 + 1:02d}-{(i % 28) + 1:02d}")
    assert len(nifty._candles_cache) <= nifty._CACHE_MAX
    nifty._candles_cache.clear()


def test_nifty_ws_live_cache_put_is_bounded():
    nifty._live_ws_cache.clear()
    for i in range(nifty._CACHE_MAX + 20):
        nifty._cache_put(nifty._live_ws_cache, f"expiry-{i}", {"i": i})
    assert len(nifty._live_ws_cache) <= nifty._CACHE_MAX
    assert nifty._live_ws_cache[f"expiry-{nifty._CACHE_MAX + 19}"]["i"] == nifty._CACHE_MAX + 19
    nifty._live_ws_cache.clear()


def test_nifty_live_cache_stamps_build_completion_not_start(monkeypatch):
    # A cold build can take seconds; a start-time stamp leaves the entry
    # already stale on write, so the next poll discards it and rebuilds.
    nifty._live_cache.clear()
    real_time = time.time

    class _Clock:
        advanced = False

        def time(self):
            return real_time() + (1.0 if self.advanced else 0.0)

        def monotonic(self):
            return 0.0

    clock = _Clock()
    monkeypatch.setattr(nifty, "time", clock)

    async def _slow_compute(expiry, expiries=None):
        clock.advanced = True
        return {"spot": 1.0}

    monkeypatch.setattr(nifty, "_compute_live", _slow_compute)
    t0 = real_time()
    asyncio.run(nifty.get_cached_live("expiry-slow"))
    assert nifty._live_cache["expiry-slow"]["ts"] >= t0 + 1.0
    nifty._live_cache.clear()

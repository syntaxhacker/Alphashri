"""The reporting backend's in-memory caches must stay bounded.

Their keys embed user-supplied windows / symbol lists / expiries, so an
unbounded dict grows with every distinct request on a long-lived server.
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.fyers_options import _CHAIN_CACHE, _CHAIN_CACHE_MAX, _cache_put  # noqa: E402
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

"""Tiny in-process token bucket for public read routes.

Only for coarse cost protection: per-process, per-client-IP, no shared state.
A Redis-backed limiter would be more accurate but is not worth a dependency
for "one public route must not amortize six upstream calls into a flood".
"""

from __future__ import annotations

import math
import threading
import time
from typing import Optional


#: Bound the per-key bucket map so a rotating client IP cannot grow it forever.
#: An entry unseen for more than this many windows has fully refilled and is
#: dropped; a hard cap also bounds a burst of distinct, all-recent keys. Neither
#: changes refill/cost semantics: a dropped bucket is recreated at ``capacity``
#: on its next sight, which is exactly what a fully-refilled bucket looks like.
_BUCKET_IDLE_WINDOWS = 3
_BUCKET_MAX_ENTRIES = 2048


class TokenBucketLimiter:
    """One bucket per key, refilling continuously at ``capacity / window_sec``.

    ``check`` both tests and consumes in one locked step, so concurrent callers
    cannot spend the same token. ``cost`` (default 1) lets one logical request
    reserve several tokens — e.g. one per upstream chain a cold build fans out
    to — so existing callers keep spending exactly one. Keep ``cost <=
    capacity``: a cost above the ceiling can never be satisfied and would
    return a permanent 429. The returned ``retry_after`` is the whole seconds
    until ``cost`` tokens are available again (never below 1).
    """

    def __init__(self, capacity: float, window_sec: float) -> None:
        self.capacity = float(capacity)
        self.window_sec = float(window_sec)
        self.refill_rate = self.capacity / self.window_sec
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def _evict_idle_locked(self, now: float, keep: str) -> None:
        """Drop idle buckets and bound the map; caller holds ``self._lock``.

        ``keep`` is the key about to be touched — reserving a slot for it prevents
        a brand-new key from pushing the map one over the cap until the next call.
        """
        cutoff = now - _BUCKET_IDLE_WINDOWS * self.window_sec
        for key in [k for k, (_, last) in self._buckets.items() if last <= cutoff]:
            self._buckets.pop(key, None)
        cap = _BUCKET_MAX_ENTRIES - (0 if keep in self._buckets else 1)
        if len(self._buckets) > cap:
            excess = len(self._buckets) - cap
            oldest = sorted(self._buckets, key=lambda k: self._buckets[k][1])[:excess]
            for key in oldest:
                self._buckets.pop(key, None)

    def check(
        self, key: str, *, now: Optional[float] = None, cost: float = 1.0
    ) -> tuple[bool, int]:
        if cost <= 0:
            raise ValueError("cost must be positive")
        t = time.monotonic() if now is None else now
        with self._lock:
            self._evict_idle_locked(t, key)
            tokens, last = self._buckets.get(key, (self.capacity, t))
            tokens = min(self.capacity, tokens + (t - last) * self.refill_rate)
            if tokens >= cost:
                self._buckets[key] = (tokens - cost, t)
                return True, 0
            self._buckets[key] = (tokens, t)
            retry_after = max(1, math.ceil((cost - tokens) / self.refill_rate))
            return False, retry_after

    def reset(self) -> None:
        """Drop all buckets (tests / configuration reload)."""
        with self._lock:
            self._buckets.clear()


#: Generous for a real desk polling one symbol; only stops a hammering client.
#: A cold analytics build fans out to one chain per requested expiry, each a
#: handful of upstream calls, so that route charges ``cost=expiries`` (1..6).
#: Capacity 30 therefore allows ~5 full-ladder (6-expiry) cold builds/minute;
#: warm cache reads are free and never call ``check`` at all.
ANALYTICS_RATE_CAPACITY = 30
ANALYTICS_RATE_WINDOW_SEC = 60.0
#: Fixed so an upstream error string can never reach a 429 response.
RATE_LIMIT_DETAIL = "Analytics request rate limit exceeded. Retry shortly."

analytics_limiter = TokenBucketLimiter(ANALYTICS_RATE_CAPACITY, ANALYTICS_RATE_WINDOW_SEC)

#: Public ``market=usa`` chart fetches hit yfinance on every cache miss. Cap
#: cold (cache-miss) calls per client IP so one caller cannot amortize arbitrary
#: symbols into an upstream flood. Kept separate from the analytics limiter so
#: tuning one never changes the other's semantics.
US_CHART_RATE_CAPACITY = 30
US_CHART_RATE_WINDOW_SEC = 60.0
#: Fixed so an upstream error string can never reach a 429 response.
US_CHART_RATE_DETAIL = "US chart request rate limit exceeded. Retry shortly."

us_chart_limiter = TokenBucketLimiter(US_CHART_RATE_CAPACITY, US_CHART_RATE_WINDOW_SEC)

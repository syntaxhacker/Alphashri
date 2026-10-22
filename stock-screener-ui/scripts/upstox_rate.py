#!/usr/bin/env python3
"""Token-bucket rate limiter shaped for Upstox's limits.

Upstox docs (``/developer/api-documentation/rate-limiting``) set **Other
Standard APIs** — holdings, positions, funds, historical candles, i.e. every
read endpoint these desk scripts touch — to **50 req/s, 500 req/min,
2000 req/30 min**. Those are the defaults here (the 20/s / 250/min figures
are *not* in the docs; pass explicit caps if your app negotiated lower ones).

All three buckets must allow a request, so a burst that is legal per-second
and per-minute still throttles once the 30-minute ceiling is reached — which
is the limit that actually bites for the desk's polling loops.

Pure logic + injectable clock/sleep: unit tests use a fake clock, so no test
ever sleeps. ``acquire()`` blocks; ``try_acquire()`` never blocks.

Usage:
    from scripts.upstox_rate import UpstoxRateLimiter, get_limiter
    limiter = UpstoxRateLimiter()          # 50/s + 500/min + 2000/30min
    limiter.acquire()                      # block until a request may fire
    if limiter.try_acquire():              # ... or poll without blocking
        fire_request()

    get_limiter().acquire()                # the process-wide shared limiter
"""

from __future__ import annotations

import threading
import time

#: Seconds in the rolling 30-minute window Upstox documents.
THIRTY_MINUTES = 30 * 60


class _Bucket:
    """Single token bucket refilled continuously at ``rate`` tokens/sec."""

    def __init__(self, rate_per_sec: float, capacity: float, now: float):
        if rate_per_sec <= 0 or capacity <= 0:
            raise ValueError("rate and capacity must be positive")
        self.rate = float(rate_per_sec)
        self.capacity = float(capacity)
        self.tokens = float(capacity)
        self.updated = float(now)

    def _refill(self, now: float) -> None:
        if now > self.updated:
            self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
            self.updated = float(now)

    def consume(self, now: float) -> bool:
        """Take one token if available."""
        self._refill(now)
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False

    def deficit_wait(self, now: float) -> float:
        """Seconds until one token is available (0 when available now)."""
        self._refill(now)
        if self.tokens >= 1.0:
            return 0.0
        return (1.0 - self.tokens) / self.rate


class UpstoxRateLimiter:
    """Triple token bucket: per-second AND per-minute AND per-30-min caps.

    Every bucket must allow the request, so the tightest window wins. A burst
    that is legal per second and per minute still throttles once the
    30-minute ceiling is reached.

    ``clock``/``sleep`` are injectable for deterministic tests.
    """

    # Upstox docs: Other Standard APIs (all our read endpoints).
    DEFAULT_PER_SECOND = 50
    DEFAULT_PER_MINUTE = 500
    DEFAULT_PER_30_MIN = 2000

    def __init__(
        self,
        per_second: float = DEFAULT_PER_SECOND,
        per_minute: float = DEFAULT_PER_MINUTE,
        per_30_min: float = DEFAULT_PER_30_MIN,
        clock=None,
        sleep=None,
    ):
        self._clock = clock or time.monotonic
        self._sleep = sleep or time.sleep
        now = float(self._clock())
        self._sec = _Bucket(per_second / 1.0, per_second, now)
        self._min = _Bucket(per_minute / 60.0, per_minute, now)
        self._30min = _Bucket(per_30_min / THIRTY_MINUTES, per_30_min, now)

    @property
    def per_second(self) -> float:
        return self._sec.capacity

    @property
    def per_minute(self) -> float:
        return self._min.capacity

    @property
    def per_30_min(self) -> float:
        return self._30min.capacity

    def try_acquire(self) -> bool:
        """Take one token from every bucket if available; never blocks."""
        now = float(self._clock())
        if (self._sec.deficit_wait(now) > 0
                or self._min.deficit_wait(now) > 0
                or self._30min.deficit_wait(now) > 0):
            # Refill all (deficit_wait already refilled) but consume none.
            return False
        self._sec.consume(now)
        self._min.consume(now)
        self._30min.consume(now)
        return True

    def wait_time(self) -> float:
        """Seconds until ``try_acquire()`` would succeed (0 when it would)."""
        now = float(self._clock())
        return max(
            self._sec.deficit_wait(now),
            self._min.deficit_wait(now),
            self._30min.deficit_wait(now),
        )

    def acquire(self) -> bool:
        """Block until every bucket allows one request; always returns True."""
        while True:
            if self.try_acquire():
                return True
            delay = self.wait_time()
            self._sleep(max(delay, 0.0))


# ---------------------------------------------------------------------------
# Process-wide shared limiter
# ---------------------------------------------------------------------------
_SHARED_LOCK = threading.Lock()
_SHARED: UpstoxRateLimiter | None = None


def get_limiter() -> UpstoxRateLimiter:
    """The repo-wide Upstox limiter (created once, shared by every client).

    Every script/module that talks to Upstox acquires a token from this one
    instance, so the 50/s + 500/min + 2000/30min budget is a *global* budget
    rather than a per-caller one.
    """
    global _SHARED
    with _SHARED_LOCK:
        if _SHARED is None:
            _SHARED = UpstoxRateLimiter()
        return _SHARED

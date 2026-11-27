"""Shared lazy Upstox rate limiter for the options report and recorder.

Both consumers draw from the same ``options`` budget slice; keeping one
lazy singleton factory here removes duplicate import/fail-open boilerplate.
"""

from __future__ import annotations

import threading
from typing import Any

_LIMITERS: dict[str, Any] = {}
_LOCK = threading.Lock()


def get_rate_limiter(consumer: str) -> Any:
    """Return the lazy ``UpstoxRateLimiter`` for ``consumer`` (None if absent).

    The import stays inside the function so API modules load without the
    trader package and tests can patch
    ``upstox_trader.rate_limiter.UpstoxRateLimiter``. A failed construction is
    cached as ``None``: callers fail open on limiter/Redis outages.
    """
    if consumer in _LIMITERS:
        return _LIMITERS[consumer]
    with _LOCK:
        if consumer not in _LIMITERS:
            try:
                from upstox_trader.rate_limiter import UpstoxRateLimiter

                _LIMITERS[consumer] = UpstoxRateLimiter(consumer=consumer)
            except Exception:
                _LIMITERS[consumer] = None
        return _LIMITERS[consumer]


def reset_rate_limiter(consumer: str | None = None) -> None:
    """Forget cached instance(s); the recorder resets this on manual restart."""
    with _LOCK:
        if consumer is None:
            _LIMITERS.clear()
        else:
            _LIMITERS.pop(consumer, None)

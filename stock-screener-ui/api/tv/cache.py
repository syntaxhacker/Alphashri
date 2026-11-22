"""Reusable, bounded TTL cache for TradingView frames.

One scan per distinct :class:`FrameDescriptor` per TTL window, with a
singleflight lock so N concurrent misses (or ``force`` requests) collapse into
one upstream :func:`api.tv.scan_frame` call. Deliberately independent of any
consumer: dashboards, reports and screens can share frames without each
growing its own private cache and lock.

Failures are never cached -- a descriptor that failed once is retried on the
next call. Auth (401/403) and delayed-feed failures self-heal once inside the
singleflight winner, so concurrent waiters share the refresh/retry. A frame
returned by :func:`scan_frame_cached` is owned by the cache;
treat it as **read-only** (or copy it before editing). Mutating it in place
corrupts every later hit for that descriptor.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Mapping as _Mapping
from dataclasses import dataclass, field
from typing import Any

import requests

from .auth import refresh_tv_cookies
from .client import scan_frame
from .status import tv_feed_status

#: Hard safety bound on cached frames. Real usage is well below this -- a
#: descriptor is one concrete query, not one per UI filter -- so the cap only
#: guards against unbounded memory growth from caller-controlled descriptors.
MAX_CACHE_ENTRIES = 64
#: How long a waiter blocks for the singleflight winner's result.
_SINGLEFLIGHT_WAIT_SEC = 60.0
#: Monotonic clock, kept as a module attribute so tests can advance it without
#: sleeping (and so wall-clock adjustments cannot extend a cache window).
_monotonic = time.monotonic


def _freeze(value: Any) -> Any:
    """Recursively turn a value into a hashable, order-stable structure.

    Mappings become ``((key, value), ...)`` sorted by key: two dicts with the
    same items in a different insertion order therefore produce one key. Sets
    sort by ``repr`` (elements are not necessarily mutually comparable).
    Sequences keep their order -- column and filter order is part of the query.
    """
    if isinstance(value, _Mapping):
        items = [(str(key), _freeze(val)) for key, val in value.items()]
        items.sort(key=lambda item: item[0])
        return tuple(items)
    if isinstance(value, (set, frozenset)):
        items = [_freeze(val) for val in value]
        items.sort(key=repr)
        return tuple(items)
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(val) for val in value)
    return value


@dataclass(frozen=True)
class FrameDescriptor:
    """The complete input to one :func:`api.tv.scan_frame` call.

    Constructor arguments mirror ``scan_frame``. Lists/dicts/sets are accepted
    and normalised to hashable tuples in ``__post_init__``; the frozen instance
    is therefore safe to use directly as a cache key.
    """

    market: str
    columns: tuple = ()
    filters: tuple = ()
    limit: int = 500
    sort: str | None = None
    order: str = "desc"
    tickers: tuple = ()
    markets: tuple = ()
    body_extra: tuple = ()

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        set_(self, "market", str(self.market).strip().lower())
        set_(self, "columns", _freeze(self.columns))
        set_(self, "filters", _freeze(self.filters))
        set_(self, "limit", int(self.limit))
        set_(self, "sort", str(self.sort) if self.sort else None)
        set_(self, "order", str(self.order) if self.order else "desc")
        set_(self, "tickers", _freeze(self.tickers))
        set_(self, "markets", _freeze(self.markets))
        set_(self, "body_extra", _freeze(self.body_extra))

    @property
    def cache_key(self) -> tuple:
        """Stable, hashable key -- no dict ordering assumptions."""
        return (
            self.market,
            self.columns,
            self.filters,
            self.limit,
            self.sort,
            self.order,
            self.tickers,
            self.markets,
            self.body_extra,
        )

    def to_scan_kwargs(self) -> dict[str, Any]:
        """Reconstruct the natural ``scan_frame`` arguments from the key form."""
        return {
            "market": self.market,
            "columns": list(self.columns) if self.columns else None,
            "filters": [dict(flt) for flt in self.filters] if self.filters else None,
            "sort": self.sort,
            "order": self.order,
            "limit": self.limit,
            "tickers": list(self.tickers) if self.tickers else None,
            "markets": list(self.markets) if self.markets else None,
            "body_extra": dict(self.body_extra) if self.body_extra else None,
        }


class _BoundedCache(dict):
    """LRU dict: insertion order is recency, oldest entry evicted at the cap."""

    def _touch(self, key) -> None:
        value = super().pop(key)
        super().__setitem__(key, value)

    def __setitem__(self, key, value) -> None:
        if key in self:
            self._touch(key)
        elif len(self) >= MAX_CACHE_ENTRIES:
            super().__delitem__(next(iter(self)))
        super().__setitem__(key, value)

    def __getitem__(self, key):
        value = super().__getitem__(key)
        self._touch(key)
        return value

    def get(self, key, default=None):
        if key not in self:
            return default
        value = super().get(key)
        self._touch(key)
        return value


@dataclass
class _Entry:
    stored_at: float
    frame: Any


@dataclass
class _Inflight:
    event: threading.Event = field(default_factory=threading.Event)
    frame: Any = None
    exc: BaseException | None = None


#: ``descriptor.cache_key -> _Entry``
_cache: _BoundedCache = _BoundedCache()
_cache_lock = threading.RLock()
#: ``descriptor.cache_key -> _Inflight``
_inflight: dict[tuple, _Inflight] = {}
_inflight_lock = threading.Lock()


def _fresh(entry: _Entry, ttl_seconds: float, now: float) -> bool:
    return now < entry.stored_at + ttl_seconds


def _dead(inf: _Inflight) -> bool:
    """A signalled failed slot must not poison later calls for the same key."""
    return inf.exc is not None and inf.event.is_set()


def _claim(key: tuple) -> tuple[_Inflight, bool]:
    """Return ``(slot, am_winner)``; discard a finished-with-error slot."""
    with _inflight_lock:
        inf = _inflight.get(key)
        if inf is not None and not _dead(inf):
            return inf, False
        _inflight.pop(key, None)
        inf = _Inflight()
        _inflight[key] = inf
        return inf, True


def _complete(key: tuple, inf: _Inflight) -> None:
    """Publish the winner's result and clear the slot.

    Pop before signalling: a caller arriving just after the pop sees the fresh
    cache entry and returns without starting a second scan.
    """
    with _inflight_lock:
        if _inflight.get(key) is inf:
            _inflight.pop(key, None)
    inf.event.set()


def _auth_failure(exc: BaseException) -> bool:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None) in (401, 403)


def _first_update_mode(frame: Any) -> str | None:
    try:
        if len(frame) and "update_mode" in frame.columns:
            value = frame["update_mode"].iloc[0]
            if value is None or (isinstance(value, float) and value != value):
                return None
            return str(value)
    except Exception:
        return None
    return None


def _scan_with_heal(scan_kwargs: dict[str, Any]):
    """One scan plus at most one auth refresh and one delayed-feed retry.

    Runs entirely inside the singleflight winner's try block, so waiters see
    either the healed frame or the final exception -- never a failed frame.
    """
    try:
        frame = scan_frame(**scan_kwargs)
    except requests.HTTPError as exc:
        if not _auth_failure(exc):
            raise
        refresh_tv_cookies()
        frame = scan_frame(**scan_kwargs)
    # Prefer this frame's own mode: the shared status can be left over from a
    # different feed (e.g. a delayed futures scan).
    mode = _first_update_mode(frame) or tv_feed_status().get("mode")
    if isinstance(mode, str) and mode.startswith("delayed"):
        refresh_tv_cookies()
        frame = scan_frame(**scan_kwargs)
    return frame


def scan_frame_cached(
    descriptor: FrameDescriptor,
    ttl_seconds: float = 60.0,
    force: bool = False,
):
    """Return the frame for ``descriptor``, scanning at most once per TTL window.

    ``force`` bypasses the freshness check (not the singleflight, so concurrent
    forces still share one scan). Exceptions are propagated to every waiter
    but never stored in the cache. The returned DataFrame is cache-owned and
    must be treated as read-only.
    """
    key = descriptor.cache_key
    now = _monotonic()
    if not force:
        with _cache_lock:
            entry = _cache.get(key)
        if entry is not None and _fresh(entry, ttl_seconds, now):
            return entry.frame

    inf, am_winner = _claim(key)
    if not am_winner:
        if not inf.event.wait(_SINGLEFLIGHT_WAIT_SEC):
            raise TimeoutError(f"TV frame singleflight timed out for {key}")
        if inf.exc is not None:
            raise inf.exc
        return inf.frame

    try:
        frame = _scan_with_heal(descriptor.to_scan_kwargs())
        with _cache_lock:
            _cache[key] = _Entry(_monotonic(), frame)
        inf.frame = frame
    except BaseException as exc:  # surface the failure, never cache it
        inf.exc = exc
        raise
    finally:
        _complete(key, inf)
    return inf.frame


def invalidate(descriptor: FrameDescriptor) -> None:
    """Drop the cached frame for one descriptor (in-flight scans are untouched)."""
    with _cache_lock:
        _cache.pop(descriptor.cache_key, None)


def clear() -> None:
    """Drop every cached frame."""
    with _cache_lock:
        _cache.clear()

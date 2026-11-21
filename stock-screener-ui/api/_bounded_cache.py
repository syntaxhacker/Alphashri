"""Bounded, TTL-aware caches for the public symbol-keyed option endpoints.

The option routes key process-level caches by caller-supplied symbols (and, for
chains/analytics, by expiry and session). Without a hard cap an anonymous caller
can grow those dicts without limit. These helpers add an entry cap, LRU recency
and an expiry sweep while leaving each call site's value shape and TTL window
untouched.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Iterable, Optional


def _default_ts(value: Any) -> float:
    return value["ts"]


class BoundedTTLCache(dict):
    """A ``dict`` capped at ``max_entries`` that sweeps expired entries on write.

    Insertion order is recency: a read moves the key to the newest end and a
    write to an existing key refreshes it in place. Before a new key is inserted
    over the cap, expired entries are swept first so a cold/expired key never
    displaces a live hot one; only then is the least-recently-used key dropped.
    Values are stored verbatim, so call sites keep their payload shape and their
    own freshness test.

    ``ts_getter``/``ttl_getter`` derive freshness from the stored value; with no
    ``ttl_getter`` this is a pure LRU cap. ``on_evict`` receives every removed
    key so a caller can drop the matching single-flight lock.
    """

    def __init__(
        self,
        max_entries: int = 512,
        *,
        ts_getter: Optional[Callable[[Any], float]] = None,
        ttl_getter: Optional[Callable[[Any], float] | float] = None,
        on_evict: Optional[Callable[[Any], None]] = None,
    ) -> None:
        super().__init__()
        self.max_entries = max_entries
        self._ts = ts_getter or _default_ts
        self._ttl = ttl_getter
        self._on_evict = on_evict
        # A worker thread builds analytics RV, so sweep/evict must be atomic.
        self._lock = threading.RLock()

    def _ttl_of(self, value: Any) -> Optional[float]:
        if self._ttl is None:
            return None
        return self._ttl(value) if callable(self._ttl) else self._ttl

    def _is_expired(self, value: Any, now: float) -> bool:
        ttl = self._ttl_of(value)
        if ttl is None:
            return False
        try:
            return now - self._ts(value) >= ttl
        except (KeyError, TypeError, IndexError, ValueError):
            return False

    def _evict(self, key: Any) -> None:
        if key not in self:
            return
        super().pop(key, None)
        if self._on_evict is not None:
            self._on_evict(key)

    def sweep(self, now: Optional[float] = None) -> int:
        """Drop expired entries; return the count removed."""
        now = time.monotonic() if now is None else now
        with self._lock:
            expired = [key for key, value in super().items() if self._is_expired(value, now)]
            for key in expired:
                self._evict(key)
            return len(expired)

    def _touch(self, key: Any) -> None:
        value = super().pop(key)
        super().__setitem__(key, value)

    def __setitem__(self, key: Any, value: Any) -> None:
        with self._lock:
            self.sweep()
            if key in self:
                self._touch(key)
            elif len(self) >= self.max_entries:
                self._evict(next(iter(self)))
            super().__setitem__(key, value)

    def __getitem__(self, key: Any) -> Any:
        with self._lock:
            value = super().__getitem__(key)
            self._touch(key)
            return value

    def get(self, key: Any, default: Any = None) -> Any:
        with self._lock:
            if key not in self:
                return default
            value = super().__getitem__(key)
            self._touch(key)
            return value

    def setdefault(self, key: Any, default: Any = None) -> Any:
        with self._lock:
            if key in self:
                return self[key]
            self[key] = default
            return default

    def pop(self, key: Any, *args: Any) -> Any:
        with self._lock:
            existed = key in self
            value = super().pop(key, *args)
            if existed and self._on_evict is not None:
                self._on_evict(key)
            return value

    def matching_keys(self, prefix: str) -> list:
        """Snapshot of keys starting with ``prefix``, taken under the lock.

        Iterating a live ``dict`` while another thread writes raises
        ``RuntimeError``; callers that need the matching keys take this copy
        first instead of walking ``self`` directly.
        """
        with self._lock:
            return [
                key
                for key in super().keys()
                if isinstance(key, str) and key.startswith(prefix)
            ]

    def pop_where(self, predicate: Callable[[Any], bool]) -> int:
        """Remove every entry whose key satisfies ``predicate``; return the count.

        The scan and the removals share the lock so a concurrent writer cannot
        resize the dict mid-iteration. ``pop`` runs the eviction callback for
        each removed key, so a matching single-flight lock is released too.
        """
        with self._lock:
            keys = [key for key in super().keys() if predicate(key)]
            for key in keys:
                self.pop(key, None)
            return len(keys)

    def clear(self) -> None:
        with self._lock:
            keys = list(super().keys())
            super().clear()
            if self._on_evict is not None:
                for key in keys:
                    self._on_evict(key)


class TrackedLock:
    """A ``threading.Lock`` that reports whether it is held.

    ``prune_locks`` spares in-flight guards via ``locked()``; plain
    ``threading.Lock`` has no such method on the supported Python versions.
    The depth is mutated only by the owning thread while it holds the lock.
    """

    __slots__ = ("_lock", "_depth")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._depth = 0

    def acquire(self, blocking: bool = True, timeout: float = -1) -> bool:
        ok = self._lock.acquire(blocking, timeout)
        if ok:
            self._depth += 1
        return ok

    def release(self) -> None:
        try:
            self._depth -= 1
        finally:
            self._lock.release()

    def locked(self) -> bool:
        return self._depth > 0

    def __enter__(self) -> "TrackedLock":
        self.acquire()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.release()


def prune_locks(locks: dict, max_entries: int, keep: Iterable[Any] = ()) -> None:
    """Bound a symbol-keyed single-flight lock dict.

    Drops the oldest idle locks past ``max_entries``; a lock that is currently
    held (or explicitly kept) stays so an in-flight fetch keeps its guard.
    """
    keep = set(keep)
    for key in list(locks):
        if len(locks) <= max_entries:
            break
        if key in keep:
            continue
        if getattr(locks[key], "locked", lambda: False)():
            continue
        locks.pop(key, None)

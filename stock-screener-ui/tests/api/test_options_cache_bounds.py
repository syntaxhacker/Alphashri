"""Public option caches are bounded: LRU cap, expiry sweep, no lock leaks.

An anonymous caller supplies the symbol for /options/underlying, /analytics,
/expiries and the RV cone, so every distinct key used to add a permanent entry.
These tests pin the cap, recency, TTL sweep and single-flight-lock cleanup while
leaving each cache's payload shape and TTL window unchanged.
"""

import asyncio
import threading
import time

import pandas as pd
import pytest

from api import options as opts
from api import options_analytics as oa
from api import options_rv as rv
from api import options_underlying as ou
from api._bounded_cache import BoundedTTLCache, prune_locks


@pytest.fixture(autouse=True)
def _clean_option_caches():
    def _clear():
        ou._cache.clear()
        ou._locks.clear()
        oa._rv_cache.clear()
        oa._rv_locks.clear()
        rv.clear_rv_cache()
        opts._expiries_cache.clear()

    _clear()
    yield
    _clear()


class TestBoundedTTLCacheHelper:
    def test_insert_past_cap_evicts_oldest(self):
        cache = BoundedTTLCache(3)
        for i in range(3):
            cache[f"k{i}"] = {"i": i}
        cache["k3"] = {"i": 3}

        assert len(cache) == 3
        assert set(cache) == {"k1", "k2", "k3"}

    def test_hot_entry_is_retained_and_refresh_moves_to_newest(self):
        cache = BoundedTTLCache(3)
        for i in range(3):
            cache[f"k{i}"] = {"i": i}

        assert cache["k0"] == {"i": 0}  # read promotes k0 to newest
        cache["k3"] = {"i": 3}  # evicts the oldest untouched key, k1
        assert "k0" in cache
        assert "k1" not in cache

        cache["k2"] = {"i": 200}  # refresh in place, no growth
        assert len(cache) == 3
        cache["k4"] = {"i": 4}  # refreshed k2 survives, k0 is now oldest
        assert cache["k2"] == {"i": 200}
        assert "k0" not in cache
        assert "k3" in cache
        assert len(cache) == 3

    def test_expired_entries_are_swept_before_cap_eviction(self):
        cache = BoundedTTLCache(3, ttl_getter=10.0)
        now = time.monotonic()
        cache["stale"] = {"ts": now - 100, "v": 1}
        for key in ("a", "b", "c"):
            cache[key] = {"ts": now, "v": 1}

        assert "stale" not in cache  # swept, so no fresh key was displaced
        assert set(cache) == {"a", "b", "c"}
        assert len(cache) == 3

        assert cache.sweep(now) == 0
        cache["stale2"] = {"ts": now - 100, "v": 2}
        assert cache.sweep(now) == 1
        assert "stale2" not in cache

    def test_per_entry_ttl_getter_and_missing_keys_never_raise(self):
        cache = BoundedTTLCache(4, ttl_getter=lambda v: v["ttl"])
        now = time.monotonic()
        cache["fresh"] = {"ts": now, "ttl": 100}
        cache["old"] = {"ts": now - 100, "ttl": 10}

        assert cache.sweep(now) == 1
        assert "fresh" in cache
        assert "old" not in cache
        assert cache.get("missing") is None
        assert cache.pop("missing", None) is None
        cache.pop("fresh")
        assert cache.get("fresh") is None

    def test_on_evict_drops_matching_lock_without_leaking(self):
        locks = {}
        cache = BoundedTTLCache(2, on_evict=locks.pop)
        for key in ("a", "b"):
            locks[key] = object()
            cache[key] = {"v": key}

        locks["c"] = object()  # the caller guards a key before caching it
        cache["c"] = {"v": "c"}
        assert set(cache) == {"b", "c"}
        assert set(locks) == {"b", "c"}  # evicted key's lock is gone

        cache.clear()
        assert locks == {}

    def test_matching_keys_and_pop_where_use_the_lock(self):
        locks = {}
        cache = BoundedTTLCache(8, on_evict=locks.pop)
        for key in ("chain:a", "chain:b", "other:c"):
            locks[key] = object()
            cache[key] = {"v": key}

        assert set(cache.matching_keys("chain:")) == {"chain:a", "chain:b"}
        assert cache.pop_where(lambda k: k.startswith("chain:")) == 2
        assert set(cache) == {"other:c"}
        assert set(locks) == {"other:c"}


class TestCacheConcurrency:
    """Threads must be able to write/evict and to race a cold RV miss safely."""

    def test_concurrent_writes_and_evictions_keep_cap(self):
        cache = BoundedTTLCache(32)
        errors = []

        def worker(n):
            try:
                for i in range(200):
                    cache[f"{n}-{i}"] = {"n": n, "i": i}
                    cache.get(f"{n}-{i}")
            except RuntimeError as exc:  # dict changed size during iteration
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert errors == []
        assert len(cache) == 32

    def test_concurrent_writes_and_pop_where_are_safe(self):
        cache = BoundedTTLCache(64)
        errors = []

        def writer(n):
            try:
                for i in range(150):
                    cache[f"chain:{n}:{i}"] = {"v": i}
            except RuntimeError as exc:
                errors.append(exc)

        def clearer():
            try:
                for _ in range(150):
                    cache.pop_where(lambda k: k.startswith("chain:"))
            except RuntimeError as exc:
                errors.append(exc)

        threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)]
        threads += [threading.Thread(target=clearer) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert errors == []
        assert len(cache) <= 64

    def test_concurrent_rv_cold_misses_fetch_once(self):
        calls = []
        barrier = threading.Barrier(8)
        closes = pd.Series([100.0 + i * 0.1 for i in range(200)])

        def fetcher(sym, lookback):
            calls.append(sym)
            time.sleep(0.02)  # widen the window for the other threads
            return closes, "2026-11-17"

        def worker():
            barrier.wait()
            rv.realized_vol_cone("TCS", tenors=(30,), fetcher=fetcher)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert calls == ["TCS"]
        assert ("TCS", 750) in rv._rv_cache

    def test_concurrent_analytics_rv_cold_misses_fetch_once(self, monkeypatch):
        calls = []
        barrier = threading.Barrier(8)
        cone = {"cone": 1, "tenors": [], "warnings": []}

        def fake_engine(module_name, func_name, *args):
            if func_name == "realized_vol_cone":
                calls.append(args[0])
                time.sleep(0.02)
                return cone
            return {"rows": []}

        monkeypatch.setattr(oa, "_engine_call", fake_engine)

        def worker():
            barrier.wait()
            result, failed = oa._rv_block("TCS", [{"date": "2026-11-17"}])
            assert not failed
            assert result["cone"] == cone

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert calls == ["TCS"]
        assert oa._rv_cache.get("TCS")[1] == cone


class TestLockPruning:
    def test_prune_locks_bounds_idle_locks_and_keeps_requested(self):
        for i in range(ou._CACHE_MAX + 10):
            ou._locks[f"K{i}"] = asyncio.Lock()

        prune_locks(ou._locks, ou._CACHE_MAX, keep=("K0",))
        assert len(ou._locks) == ou._CACHE_MAX
        assert "K0" in ou._locks
        assert "K1" not in ou._locks

    def test_prune_locks_keeps_a_held_guard(self):
        class Held:
            def locked(self):
                return True

        ou._locks["HELD"] = Held()
        for i in range(ou._CACHE_MAX + 2):
            ou._locks[f"K{i}"] = asyncio.Lock()

        prune_locks(ou._locks, ou._CACHE_MAX)
        assert "HELD" in ou._locks
        assert len(ou._locks) == ou._CACHE_MAX  # held guard survived the cap


class TestUnderlyingCacheBounds:
    def test_cap_evicts_oldest_and_drops_its_lock(self):
        now = time.monotonic()
        for i in range(ou._CACHE_MAX):
            key = f"S{i}"
            ou._locks[key] = asyncio.Lock()
            ou._cache[key] = {
                "ts": now,
                "ttl": ou.CACHE_TTL_OPEN_SEC,
                "data": {"i": i},
            }

        assert ou._cache["S0"]["data"]["i"] == 0  # S0 becomes hot
        ou._cache["NEW"] = {"ts": now, "ttl": ou.CACHE_TTL_OPEN_SEC, "data": {}}

        assert len(ou._cache) == ou._CACHE_MAX
        assert "S0" in ou._cache
        assert "S1" not in ou._cache
        assert "S1" not in ou._locks  # evicted key left no lock behind
        assert "S0" in ou._locks

    def test_real_cached_path_bounds_cache_and_locks(self):
        async def loader(key):
            return {"key": key}

        async def run():
            for i in range(ou._CACHE_MAX):
                key = f"K{i}"
                await ou._cached(key, lambda k=key: loader(k), session_state="open")
            await ou._cached("NEW", lambda: loader("NEW"), session_state="open")

        asyncio.run(run())
        assert len(ou._cache) == ou._CACHE_MAX
        assert len(ou._locks) == ou._CACHE_MAX
        assert "K0" not in ou._cache
        assert "K0" not in ou._locks
        assert ou._cache["NEW"]["data"] == {"key": "NEW"}

    def test_expired_entry_is_swept_and_refetched(self):
        now = time.monotonic()
        ou._cache["OLD"] = {"ts": now - ou.CACHE_TTL_OPEN_SEC - 1,
                            "ttl": ou.CACHE_TTL_OPEN_SEC, "data": {"v": 1}}
        ou._cache["HOT"] = {"ts": now, "ttl": ou.CACHE_TTL_OPEN_SEC, "data": {"v": 2}}
        ou._cache["NEW"] = {"ts": now, "ttl": ou.CACHE_TTL_OPEN_SEC, "data": {"v": 3}}

        assert "OLD" not in ou._cache  # swept on write, never displaces HOT
        assert ou._cache["HOT"]["data"] == {"v": 2}


class TestAnalyticsRvCacheBounds:
    def test_cap_and_hot_entry(self):
        now = time.monotonic()
        for i in range(oa.RV_CACHE_MAX):
            oa._rv_cache[f"S{i}"] = (now, {"i": i})

        assert oa._rv_cache["S0"][1] == {"i": 0}  # touch S0
        oa._rv_cache["NEW"] = (now, {})

        assert len(oa._rv_cache) == oa.RV_CACHE_MAX
        assert "S0" in oa._rv_cache
        assert "S1" not in oa._rv_cache

    def test_expired_cone_is_swept(self):
        now = time.monotonic()
        oa._rv_cache["stale"] = (now - oa.RV_CACHE_TTL_SEC - 1, {"old": True})

        assert oa._rv_cache.sweep(now) == 1
        assert "stale" not in oa._rv_cache

        oa._rv_cache["fresh"] = (now, {"new": True})
        assert oa._rv_cache["fresh"][1] == {"new": True}

    def test_cache_still_hits_a_fresh_cone(self):
        now = time.monotonic()
        oa._rv_cache["NIFTY"] = (now, {"cone": 1})
        assert oa._rv_cache.get("NIFTY")[1] == {"cone": 1}


class TestRvCacheBounds:
    def _closes(self):
        return pd.Series([100.0 + i * 0.1 for i in range(200)])

    def test_cap_evicts_oldest(self):
        now = time.monotonic()
        for i in range(rv._RV_CACHE_MAX):
            rv._rv_cache[(f"S{i}", 750)] = {"ts": now, "closes": (), "as_of": None}

        rv._rv_cache[("NEW", 750)] = {"ts": now, "closes": (), "as_of": None}
        assert len(rv._rv_cache) == rv._RV_CACHE_MAX
        assert ("S0", 750) not in rv._rv_cache
        assert ("NEW", 750) in rv._rv_cache

    def test_expired_series_is_refetched(self):
        calls = []

        def _fetch(sym, lookback):
            calls.append(sym)
            return self._closes(), "2026-11-17"

        rv.realized_vol_cone("TCS", tenors=(30,), fetcher=_fetch)
        assert calls == ["TCS"]

        key = ("TCS", 750)
        rv._rv_cache[key]["ts"] -= rv._RV_CACHE_TTL_SEC + 1
        rv.realized_vol_cone("TCS", tenors=(30,), fetcher=_fetch)
        assert calls == ["TCS", "TCS"]


class TestExpiriesCacheBounds:
    def test_cap_evicts_oldest_and_keeps_payload_shape(self):
        now = time.monotonic()
        for i in range(opts._EXPIRIES_CACHE_MAX):
            opts._expiries_cache[f"S{i}"] = {"ts": now, "expiries": [{"date": "2026-11-17"}]}

        opts._expiries_cache["NEW"] = {"ts": now, "expiries": []}
        assert len(opts._expiries_cache) == opts._EXPIRIES_CACHE_MAX
        assert "S0" not in opts._expiries_cache
        assert opts._expiries_cache["NEW"] == {"ts": now, "expiries": []}

    def test_expired_listing_is_swept(self):
        now = time.monotonic()
        opts._expiries_cache["stale"] = {
            "ts": now - opts._EXPIRIES_TTL_SEC - 1, "expiries": []
        }

        assert opts._expiries_cache.sweep(now) == 1
        assert "stale" not in opts._expiries_cache

        opts._expiries_cache["fresh"] = {"ts": now, "expiries": []}
        assert "fresh" in opts._expiries_cache

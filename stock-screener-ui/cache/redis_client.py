"""
Redis Cache Client for Alphashri

Provides caching utilities with graceful degradation when Redis is unavailable.
All functions silently return None / no-op when Redis is down.
"""

import functools
import base64
import gzip
import hashlib
import inspect
import json
import logging
import os
import threading
import time
from collections import defaultdict
from typing import Any, Callable, Optional

import config

logger = logging.getLogger("cache.redis")

_redis_client = None
_redis_available = False

_stats_lock = threading.Lock()
_domain_hits = defaultdict(int)
_domain_misses = defaultdict(int)
_global_hits = 0
_global_misses = 0

_STATS_KEY = "cache:stats"
_STATS_FLUSH_INTERVAL = 60
_last_flush_time = 0

_FIELD_GLOBAL_HITS = "global_hits"
_FIELD_GLOBAL_MISSES = "global_misses"
_DOMAIN_HIT_PREFIX = "domain_hits:"
_DOMAIN_MISS_PREFIX = "domain_misses:"

# The shared hash is an aggregate, not a snapshot: each worker tracks what it
# has already contributed and flushes only the difference with HINCRBY, so
# concurrent workers add to the same counters instead of overwriting them.
_flushed_hits = 0
_flushed_misses = 0
_flushed_domain_hits: dict[str, int] = {}
_flushed_domain_misses: dict[str, int] = {}

# Nothing subtracts a worker's contribution when it exits, so the aggregate
# also holds counters from workers that are no longer running. The admin
# endpoint therefore reports the sum of every worker seen since the last
# reset_stats(); restarting a worker starts it at zero rather than re-adding
# the totals already in the hash.

_CONSECUTIVE_FAILURES = 0
_MAX_FAILURES_BEFORE_RESET = 5


def _get_redis_url() -> str:
    return os.getenv("REDIS_URL", config.__dict__.get("REDIS_URL", "redis://localhost:6379/0"))


def _extract_domain(key: str) -> str:
    return key.split(":")[0] if ":" in key else "other"


_REDIS_HEALTH_CHECK_INTERVAL = 30  # seconds between explicit ping health checks
_last_health_check_time = 0.0

# Compute-only runs set REDIS_DISABLED before their worker pool starts. Read on
# every call so a late `os.environ` change takes effect without a module reload.
_REDIS_DISABLED_VALUES = frozenset({"1", "true", "yes"})
_redis_unavailable_until = 0.0
_REDIS_RECONNECT_COOLDOWN = 30.0
_unavailable_warned = False


def _redis_disabled() -> bool:
    return os.getenv("REDIS_DISABLED", "").strip().lower() in _REDIS_DISABLED_VALUES


def _warn_redis_unavailable(message: str, error: Exception) -> None:
    global _unavailable_warned
    if not _unavailable_warned:
        _unavailable_warned = True
        logger.warning("%s: %s", message, error)


def get_redis_client():
    global _redis_client, _redis_available, _CONSECUTIVE_FAILURES, \
        _last_health_check_time, _redis_unavailable_until

    if _redis_disabled():
        return None

    # A dead Redis used to cost a 5-second connect timeout on every cache call.
    # Back off after the first failure instead of retrying per call.
    if _redis_unavailable_until > time.monotonic():
        return None

    if _redis_client is not None:
        now = time.time()
        if now - _last_health_check_time < _REDIS_HEALTH_CHECK_INTERVAL:
            return _redis_client
        try:
            _redis_client.ping()
            _last_health_check_time = now
            return _redis_client
        except Exception as e:
            _redis_client = None
            _redis_available = False
            _CONSECUTIVE_FAILURES += 1
            _redis_unavailable_until = time.monotonic() + _REDIS_RECONNECT_COOLDOWN
            _warn_redis_unavailable("Redis connection lost, caching disabled", e)

    try:
        import redis

        url = _get_redis_url()
        _redis_client = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        _redis_client.ping()
        _redis_available = True
        _CONSECUTIVE_FAILURES = 0
        _last_health_check_time = time.time()
        logger.info("Redis connected: %s", url)
    except Exception as e:
        _redis_client = None
        _redis_available = False
        _CONSECUTIVE_FAILURES += 1
        _redis_unavailable_until = time.monotonic() + _REDIS_RECONNECT_COOLDOWN
        _warn_redis_unavailable("Redis unavailable, caching disabled", e)

    return _redis_client


def is_cache_available() -> bool:
    return _redis_available


def _serialize(value: Any) -> str:
    raw = json.dumps(value, default=str, ensure_ascii=False).encode("utf-8")
    if len(raw) > 1024:
        compressed = gzip.compress(raw)
        return "gz:" + base64.b64encode(compressed).decode("ascii")
    return raw.decode("utf-8")


def _deserialize(data: str) -> Any:
    if data.startswith("gz:"):
        compressed = base64.b64decode(data[3:])
        return json.loads(gzip.decompress(compressed).decode("utf-8"))
    return json.loads(data)


def cache_get(key: str) -> Optional[Any]:
    global _global_hits, _global_misses, _CONSECUTIVE_FAILURES
    client = get_redis_client()
    if client is None:
        return None
    try:
        data = client.get(key)
        domain = _extract_domain(key)
        with _stats_lock:
            if data is None:
                _global_misses += 1
                _domain_misses[domain] += 1
                return None
            _global_hits += 1
            _domain_hits[domain] += 1
        return _deserialize(data)
    except Exception as e:
        logger.warning("cache_get error for %s: %s", key, e)
        with _stats_lock:
            _global_misses += 1
            _domain_misses[_extract_domain(key)] += 1
        return None


def cache_set(key: str, value: Any, ttl: Optional[int] = None) -> bool:
    client = get_redis_client()
    if client is None:
        return False
    try:
        serialized = _serialize(value)
        if ttl is not None:
            client.setex(key, ttl, serialized)
        else:
            client.set(key, serialized)
        return True
    except Exception as e:
        logger.warning("cache_set error for %s: %s", key, e)
        return False


def cache_set_smart(
    key: str,
    value: Any,
    full_ttl: int,
    skim_ttl: int = 300,
    richness_check: Optional[callable] = None,
) -> bool:
    if richness_check is None:
        richness_check = lambda v: bool(
            v.get('headline') or v.get('description') or v.get('summary')
            or v.get('analysis') or v.get('sentiment_score') or v.get('items')
            or v.get('articles') or v.get('candles')
        )
    ttl = full_ttl if richness_check(value) else skim_ttl
    return cache_set(key, value, ttl=ttl)


def cache_delete(key: str) -> bool:
    client = get_redis_client()
    if client is None:
        return False
    try:
        client.delete(key)
        return True
    except Exception as e:
        logger.warning("cache_delete error for %s: %s", key, e)
        return False


def cache_delete_pattern(pattern: str) -> int:
    client = get_redis_client()
    if client is None:
        return 0
    try:
        deleted = 0
        cursor = 0
        while True:
            cursor, keys = client.scan(cursor=cursor, match=pattern, count=500)
            if keys:
                deleted += client.delete(*keys)
            if cursor == 0:
                break
        return deleted
    except Exception as e:
        logger.warning("cache_delete_pattern error for %s: %s", pattern, e)
        return 0


def make_cache_key(prefix: str, *args, **kwargs) -> str:
    parts = [prefix]
    for arg in args:
        parts.append(str(arg))
    if kwargs:
        sorted_kwargs = sorted(kwargs.items())
        for k, v in sorted_kwargs:
            parts.append(f"{k}={v}")
    raw = ":".join(parts)
    hash_suffix = hashlib.md5(raw.encode()).hexdigest()[:12]
    return f"{prefix}:{hash_suffix}"


def cached(prefix: str, ttl: Optional[int] = None, key_builder: Optional[Callable] = None):
    def decorator(func):
        if key_builder is not None:
            _build_key = key_builder
        else:
            def _build_key(*args, **kwargs):
                return make_cache_key(prefix, *args, **kwargs)

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            key = _build_key(*args, **kwargs)
            result = cache_get(key)
            if result is not None:
                logger.debug("cache HIT: %s", key)
                return result
            logger.debug("cache MISS: %s", key)
            result = func(*args, **kwargs)
            cache_set(key, result, ttl=ttl)
            return result

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            key = _build_key(*args, **kwargs)
            result = cache_get(key)
            if result is not None:
                logger.debug("cache HIT: %s", key)
                return result
            logger.debug("cache MISS: %s", key)
            result = await func(*args, **kwargs)
            cache_set(key, result, ttl=ttl)
            return result

        if inspect.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


def close_redis():
    global _redis_client, _redis_available, _redis_unavailable_until, _unavailable_warned
    _flush_stats_to_redis()
    if _redis_client is not None:
        try:
            _redis_client.close()
        except Exception:
            pass
        _redis_client = None
        _redis_available = False
    _redis_unavailable_until = 0.0
    _unavailable_warned = False


def _flush_stats_to_redis():
    global _last_flush_time, _flushed_hits, _flushed_misses, \
        _flushed_domain_hits, _flushed_domain_misses
    client = get_redis_client()
    if client is None:
        return
    now = time.time()
    if now - _last_flush_time < _STATS_FLUSH_INTERVAL:
        return
    # Keep the lock across the Redis round trip: two threads in this process
    # must not compute and send the same delta, and the baseline must describe
    # exactly the totals that were sent.
    with _stats_lock:
        deltas: dict[str, int] = {}
        hits_delta = _global_hits - _flushed_hits
        misses_delta = _global_misses - _flushed_misses
        if hits_delta > 0:
            deltas[_FIELD_GLOBAL_HITS] = hits_delta
        if misses_delta > 0:
            deltas[_FIELD_GLOBAL_MISSES] = misses_delta
        for domain, value in _domain_hits.items():
            delta = value - _flushed_domain_hits.get(domain, 0)
            if delta > 0:
                deltas[_DOMAIN_HIT_PREFIX + domain] = delta
        for domain, value in _domain_misses.items():
            delta = value - _flushed_domain_misses.get(domain, 0)
            if delta > 0:
                deltas[_DOMAIN_MISS_PREFIX + domain] = delta

        try:
            client.hset(_STATS_KEY, mapping={"updated_at": str(now)})
            if deltas:
                pipe = client.pipeline(transaction=True)
                for field, delta in deltas.items():
                    pipe.hincrby(_STATS_KEY, field, delta)
                pipe.execute()
        except Exception as e:
            logger.warning("Failed to flush stats to Redis: %s", e)
            return

        if deltas:
            _flushed_hits = _global_hits
            _flushed_misses = _global_misses
            _flushed_domain_hits = dict(_domain_hits)
            _flushed_domain_misses = dict(_domain_misses)
        _last_flush_time = now


def _load_stats_from_redis():
    """Retained for the startup hook; the aggregate is read on demand instead.

    Copying the shared totals into this process's counters would double-count
    them on the next delta flush. get_cache_stats() combines the aggregate
    with the unflushed local counters at read time.
    """
    return


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _read_shared_stats():
    client = get_redis_client()
    if client is None:
        return 0, 0, {}, {}
    try:
        raw = client.hgetall(_STATS_KEY)
    except Exception as e:
        # A limited client (e.g. an INFO-recording test double) has no HGETALL;
        # fall back to this process's own counters in that case.
        logger.debug("Shared stats read unavailable: %s", e)
        return 0, 0, {}, {}

    hits = _as_int(raw.get(_FIELD_GLOBAL_HITS))
    misses = _as_int(raw.get(_FIELD_GLOBAL_MISSES))
    domain_hits: dict[str, int] = {}
    domain_misses: dict[str, int] = {}
    for field, value in raw.items():
        if field.startswith(_DOMAIN_HIT_PREFIX):
            domain_hits[field[len(_DOMAIN_HIT_PREFIX):]] = _as_int(value)
        elif field.startswith(_DOMAIN_MISS_PREFIX):
            domain_misses[field[len(_DOMAIN_MISS_PREFIX):]] = _as_int(value)

    # Pre-delta hashes kept domains in one JSON blob; merge it so upgrading a
    # live deployment does not drop the breakdown accumulated so far.
    for field, target in (("domain_hits", domain_hits), ("domain_misses", domain_misses)):
        legacy = raw.get(field)
        if not legacy:
            continue
        try:
            parsed = json.loads(legacy)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(parsed, dict):
            for domain, value in parsed.items():
                target[domain] = target.get(domain, 0) + _as_int(value)
    return hits, misses, domain_hits, domain_misses


def get_cache_stats() -> dict:
    _flush_stats_to_redis()
    shared_hits, shared_misses, shared_d_hits, shared_d_misses = _read_shared_stats()

    with _stats_lock:
        hits = shared_hits + max(_global_hits - _flushed_hits, 0)
        misses = shared_misses + max(_global_misses - _flushed_misses, 0)
        d_hits = dict(shared_d_hits)
        d_misses = dict(shared_d_misses)
        for domain, value in _domain_hits.items():
            delta = value - _flushed_domain_hits.get(domain, 0)
            if delta > 0:
                d_hits[domain] = d_hits.get(domain, 0) + delta
        for domain, value in _domain_misses.items():
            delta = value - _flushed_domain_misses.get(domain, 0)
            if delta > 0:
                d_misses[domain] = d_misses.get(domain, 0) + delta

    client = get_redis_client()
    stats: dict[str, Any] = {
        "available": _redis_available,
        "hits": hits,
        "misses": misses,
        "total_requests": hits + misses,
        "hit_rate": round(hits / (hits + misses) * 100, 1) if (hits + misses) > 0 else 0,
        "key_count": 0,
        "used_memory_bytes": 0,
        "used_memory_human": "N/A",
        "used_memory_peak_bytes": 0,
        "used_memory_peak_human": "N/A",
        "maxmemory_policy": "N/A",
        "evicted_keys": 0,
        "expired_keys": 0,
        "keyspace_hits": 0,
        "keyspace_misses": 0,
        "mem_fragmentation_ratio": 0,
        "by_domain": {},
        "by_prefix_keys": {},
    }

    if client is None:
        return stats

    try:
        stats["key_count"] = client.dbsize()

        mem_info = client.info("memory")
        stats["used_memory_bytes"] = mem_info.get("used_memory", 0)
        stats["used_memory_human"] = mem_info.get("used_memory_human", "N/A")
        stats["used_memory_peak_bytes"] = mem_info.get("used_memory_peak", 0)
        stats["used_memory_peak_human"] = mem_info.get("used_memory_peak_human", "N/A")
        stats["maxmemory_policy"] = mem_info.get("maxmemory_policy", "N/A")
        stats["mem_fragmentation_ratio"] = round(mem_info.get("mem_fragmentation_ratio", 0), 2)

        stats_info = client.info("stats")
        stats["evicted_keys"] = stats_info.get("evicted_keys", 0)
        stats["expired_keys"] = stats_info.get("expired_keys", 0)
        stats["keyspace_hits"] = stats_info.get("keyspace_hits", 0)
        stats["keyspace_misses"] = stats_info.get("keyspace_misses", 0)

        domains = set(list(d_hits.keys()) + list(d_misses.keys()))
        for domain in domains:
            dh = d_hits.get(domain, 0)
            dm = d_misses.get(domain, 0)
            if dh + dm > 0:
                stats["by_domain"][domain] = {
                    "hits": dh,
                    "misses": dm,
                    "total": dh + dm,
                    "hit_rate": round(dh / (dh + dm) * 100, 1),
                }

        if domains:
            prefix_counts: dict[str, int] = defaultdict(int)
            try:
                for key in client.scan_iter(match="*", count=500):
                    # A key without a colon matches no "prefix:*" pattern,
                    # including the synthetic "other" domain from _extract_domain.
                    if ":" not in key:
                        continue
                    prefix = key.split(":", 1)[0]
                    if prefix in domains:
                        prefix_counts[prefix] += 1
            except Exception:
                stats["by_prefix_keys"] = {prefix: -1 for prefix in domains}
            else:
                stats["by_prefix_keys"] = {
                    prefix: prefix_counts.get(prefix, 0) for prefix in domains
                }

    except Exception as e:
        logger.warning("get_cache_stats error: %s", e)

    return stats


def reset_stats():
    global _global_hits, _global_misses, _domain_hits, _domain_misses, \
        _flushed_hits, _flushed_misses, _flushed_domain_hits, \
        _flushed_domain_misses, _last_flush_time
    with _stats_lock:
        _global_hits = 0
        _global_misses = 0
        _domain_hits = defaultdict(int)
        _domain_misses = defaultdict(int)
        _flushed_hits = 0
        _flushed_misses = 0
        _flushed_domain_hits = {}
        _flushed_domain_misses = {}
        _last_flush_time = 0
    client = get_redis_client()
    if client is not None:
        try:
            client.delete(_STATS_KEY)
        except Exception:
            pass


def get_cache_keys(prefix: Optional[str] = None, top: int = 20) -> list[dict]:
    client = get_redis_client()
    if client is None:
        return []

    pattern = f"{prefix}:*" if prefix else "*"
    keys = []
    try:
        keys = list(client.scan_iter(match=pattern, count=500))
    except Exception as e:
        logger.warning("get_cache_keys scan error: %s", e)
        return []

    if not keys:
        return []

    results = []
    try:
        pipe = client.pipeline()
        for key in keys:
            pipe.memory_usage(key)
            pipe.ttl(key)
        pipe_responses = pipe.execute()

        for key, mem_usage, ttl_val in zip(keys, pipe_responses[0::2], pipe_responses[1::2]):
            results.append({
                "key": key,
                "memory_bytes": mem_usage or 0,
                "ttl": ttl_val if ttl_val > 0 else None,
                "domain": _extract_domain(key),
            })

        results.sort(key=lambda x: x["memory_bytes"], reverse=True)
        return results[:top]
    except Exception as e:
        logger.warning("get_cache_keys pipeline error: %s", e)
        return results[:top] if results else []


def invalidate_backtest_cache(user_id: int, strategy_id: Optional[str] = None) -> int:
    if strategy_id is not None:
        return cache_delete_pattern(f"backtest:{user_id}:{strategy_id}:*")
    return cache_delete_pattern(f"backtest:{user_id}:*")


def invalidate_news_cache() -> int:
    """Invalidate all news cache entries."""
    return cache_delete_pattern("news:all:*") + cache_delete_pattern("news:recent:*") + cache_delete_pattern("news:sentiment:*") + cache_delete_pattern("news:llm:*") + cache_delete_pattern("news:article:*") + cache_delete_pattern("news:chart:*") + cache_delete_pattern("news:articles:*") + cache_delete_pattern("news:inst_articles:*")


def invalidate_screener_cache() -> int:
    deleted = cache_delete_pattern("screener:*")
    return deleted


def invalidate_value_cache() -> int:
    """Delete cached deep-value frames. Returns number of keys removed."""
    return cache_delete_pattern("value_frame:*")


def invalidate_52w_range_cache() -> int:
    """Remove Redis 52W range bulk/per-symbol keys (DB unchanged)."""
    return cache_delete_pattern("52w_range:*")


# ======
# Stale-While-Revalidate + Singleflight
# ======

def cache_ttl(key: str) -> Optional[int]:
    client = get_redis_client()
    if client is None:
        return None
    try:
        ttl = client.ttl(key)
        if ttl < 0:
            return None
        return ttl
    except Exception:
        return None


_RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""

_EXTEND_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
    return 0
end
"""


def _try_acquire_lock(key: str, lock_ttl: int = 30, token: Optional[str] = None) -> str | None:
    """Try to acquire a lock. Returns the lock token if acquired, None otherwise."""
    import uuid
    client = get_redis_client()
    if client is None:
        return None
    token = token or str(uuid.uuid4())
    try:
        if client.set(key, token, nx=True, ex=lock_ttl):
            return token
    except Exception:
        pass
    return None


def _extend_lock(key: str, token: str, lock_ttl: int) -> bool:
    """Push a held lock's expiry forward; False when the lock is no longer ours."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        script = client.register_script(_EXTEND_LOCK_LUA)
        return bool(script(keys=[key], args=[token, int(lock_ttl * 1000)]))
    except Exception:
        pass
    try:
        if client.get(key) == token:
            return bool(client.pexpire(key, int(lock_ttl * 1000)))
    except Exception:
        pass
    return False


def _release_lock(key: str, token: str) -> bool:
    """Release a lock ONLY if the value matches token (atomic check-and-delete).

    Uses a Lua script for atomicity on real Redis. Falls back to
    WATCH/MULTI/EXEC optimistic locking when Lua is unavailable
    (e.g. fakeredis in tests).
    """
    client = get_redis_client()
    if client is None:
        return False
    try:
        script = client.register_script(_RELEASE_LOCK_LUA)
        result = script(keys=[key], args=[token])
        return bool(result)
    except Exception:
        pass

    # Fallback: WATCH/MULTI/EXEC optimistic locking
    try:
        import redis as _redis
        pipe = client.pipeline()
        while True:
            try:
                pipe.watch(key)
                if pipe.get(key) == token:
                    pipe.multi()
                    pipe.delete(key)
                    pipe.execute()
                    return True
                pipe.unwatch()
                return False
            except _redis.WatchError:
                continue
    except Exception:
        return False


class CacheWarming(Exception):
    """No payload could be served: another worker owns the compute for this key.

    Callers must answer with a bounded retry (e.g. HTTP 503 + ``Retry-After``)
    instead of starting a second compute. A second sweep of a cold 52W cache is
    ~200 sequential upstream calls, so a duplicate is far worse than a 503.
    """


# Strong references to computes whose awaiter already timed out: the asyncio
# loop only keeps weak references, so an unreferenced task can be collected
# mid-flight — and then nothing would fill the cache or release the lock.
_INFLIGHT_COMPUTES: set = set()


def _retire_compute(task) -> None:
    _INFLIGHT_COMPUTES.discard(task)
    if not task.cancelled():
        task.exception()  # consumed here so an abandoned compute cannot warn at GC


def _track_compute(task) -> None:
    _INFLIGHT_COMPUTES.add(task)
    task.add_done_callback(_retire_compute)


async def stale_while_revalidate(
    key: str,
    compute_fn: Callable[[], Any],
    fresh_ttl: int = 300,
    stale_ttl: Optional[int] = None,
    lock_ttl: int = 30,
    wait_timeout: float = 15.0,
    poll_interval: float = 0.2,
    compute_timeout: float | None = None,
) -> tuple[Any, str]:
    """Serve a cached payload, computing it at most once across workers.

    The lock is released by whichever party owns the compute, and only when that
    compute has actually ended. ``compute_timeout`` bounds the *caller's* wait,
    not the compute: on timeout the work keeps running under its lock (so the
    cache still fills) and the caller gets ``CacheWarming``.
    """
    import asyncio

    if stale_ttl is None:
        stale_ttl = fresh_ttl * 2

    fresh_key = f"{key}:fresh"
    lock_key = f"{key}:lock"

    async def _compute_bounded():
        """Run the (blocking) compute off-loop, bounded in time (Redis-less path)."""
        if compute_timeout is None:
            return await asyncio.to_thread(compute_fn)
        return await asyncio.wait_for(
            asyncio.to_thread(compute_fn), timeout=compute_timeout
        )

    async def _compute_and_store(lock_token: str):
        # Heartbeat: a compute slower than lock_ttl must not let its lock expire,
        # or a second worker starts the same sweep while this one still runs.
        stop = asyncio.Event()

        async def _heartbeat():
            interval = max(0.2, lock_ttl / 3)
            while True:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=interval)
                    return
                except (asyncio.TimeoutError, TimeoutError):
                    if not await asyncio.to_thread(_extend_lock, lock_key, lock_token, lock_ttl):
                        return

        heartbeat = asyncio.create_task(_heartbeat())
        try:
            result = await asyncio.to_thread(compute_fn)
            if result is not None:
                cache_set(key, result, ttl=stale_ttl)
                cache_set(fresh_key, "1", ttl=fresh_ttl)
            return result
        finally:
            stop.set()
            heartbeat.cancel()
            try:
                await heartbeat
            except BaseException:
                pass  # cancelled on purpose; its failure must not mask the compute's
            _release_lock(lock_key, lock_token)

    async def _owned_compute(lock_token: str):
        # The compute is a separate task so a timed-out/cancelled awaiter cannot
        # stop it: cancelling the wrapper would leave the thread running while
        # the lock is already gone, which is exactly the duplicate-sweep bug.
        task = asyncio.create_task(_compute_and_store(lock_token))
        _track_compute(task)
        if compute_timeout is None:
            return await asyncio.shield(task)
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=compute_timeout)
        except (asyncio.TimeoutError, TimeoutError):
            raise CacheWarming(key) from None

    client = get_redis_client()
    if client is None:
        return await _compute_bounded(), "miss"

    try:
        is_fresh = client.exists(fresh_key) == 1
    except Exception:
        is_fresh = False

    data = cache_get(key)
    if data is not None:
        if is_fresh:
            return data, "fresh"

        lock_token = _try_acquire_lock(lock_key, lock_ttl)
        if lock_token:

            async def _background_refresh():
                # Same locked compute as the miss path: it heartbeats the lock and
                # releases it only after the compute ends.
                try:
                    await _compute_and_store(lock_token)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning("SWR background refresh failed for %s: %s", key, e)

            asyncio.ensure_future(_background_refresh())
        return data, "stale"

    lock_token = _try_acquire_lock(lock_key, lock_ttl)
    if lock_token:
        return await _owned_compute(lock_token), "miss"

    # Another worker owns the compute: wait for its result, never sweep in parallel.
    elapsed = 0.0
    while elapsed < wait_timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        # Off-loop: a wedged Redis would otherwise block the whole event loop here.
        fresh_data = await asyncio.to_thread(cache_get, key)
        if fresh_data is not None:
            return fresh_data, "coalesced"

    # The holder may have released without writing (crash or failed compute) —
    # only now may we take over. A lock still held means the compute is alive.
    lock_token = _try_acquire_lock(lock_key, lock_ttl)
    if lock_token:
        return await _owned_compute(lock_token), "miss"

    leftover = await asyncio.to_thread(cache_get, key)
    if leftover is not None:
        return leftover, "coalesced"
    raise CacheWarming(key)

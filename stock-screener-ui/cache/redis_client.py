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

_CONSECUTIVE_FAILURES = 0
_MAX_FAILURES_BEFORE_RESET = 5


def _get_redis_url() -> str:
    return os.getenv("REDIS_URL", config.__dict__.get("REDIS_URL", "redis://localhost:6379/0"))


def _extract_domain(key: str) -> str:
    return key.split(":")[0] if ":" in key else "other"


_REDIS_HEALTH_CHECK_INTERVAL = 30  # seconds between explicit ping health checks
_last_health_check_time = 0.0


def get_redis_client():
    global _redis_client, _redis_available, _CONSECUTIVE_FAILURES, _last_health_check_time

    if _redis_client is not None:
        now = time.time()
        if now - _last_health_check_time < _REDIS_HEALTH_CHECK_INTERVAL:
            return _redis_client
        try:
            _redis_client.ping()
            _last_health_check_time = now
            return _redis_client
        except Exception:
            _redis_client = None
            _redis_available = False
            _CONSECUTIVE_FAILURES += 1
            logger.warning("Redis connection lost, will attempt reconnect")

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
        _CONSECUTIVE_FAILURES += 1
        if _CONSECUTIVE_FAILURES >= _MAX_FAILURES_BEFORE_RESET:
            _redis_available = False
        logger.warning("Redis unavailable, caching disabled: %s", e)

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
    global _redis_client, _redis_available
    _flush_stats_to_redis()
    if _redis_client is not None:
        try:
            _redis_client.close()
        except Exception:
            pass
        _redis_client = None
        _redis_available = False


def _flush_stats_to_redis():
    global _last_flush_time
    client = get_redis_client()
    if client is None:
        return
    now = time.time()
    if now - _last_flush_time < _STATS_FLUSH_INTERVAL:
        return
    try:
        with _stats_lock:
            stats_payload = {
                "global_hits": _global_hits,
                "global_misses": _global_misses,
                "domain_hits": dict(_domain_hits),
                "domain_misses": dict(_domain_misses),
                "updated_at": now,
            }
            client.hset(_STATS_KEY, mapping={k: json.dumps(v) for k, v in stats_payload.items()})
            _last_flush_time = now
    except Exception as e:
        logger.warning("Failed to flush stats to Redis: %s", e)


def _load_stats_from_redis():
    global _global_hits, _global_misses, _domain_hits, _domain_misses
    client = get_redis_client()
    if client is None:
        return
    try:
        raw = client.hgetall(_STATS_KEY)
        if not raw:
            return
        with _stats_lock:
            for k, v in raw.items():
                try:
                    parsed = json.loads(v)
                except (json.JSONDecodeError, TypeError):
                    continue
                if k == "global_hits":
                    _global_hits = parsed
                elif k == "global_misses":
                    _global_misses = parsed
                elif k == "domain_hits":
                    _domain_hits.update(parsed)
                elif k == "domain_misses":
                    _domain_misses.update(parsed)
    except Exception as e:
        logger.warning("Failed to load stats from Redis: %s", e)


def get_cache_stats() -> dict:
    _flush_stats_to_redis()

    with _stats_lock:
        hits = _global_hits
        misses = _global_misses
        d_hits = dict(_domain_hits)
        d_misses = dict(_domain_misses)

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

        for domain in set(list(d_hits.keys()) + list(d_misses.keys())):
            dh = d_hits.get(domain, 0)
            dm = d_misses.get(domain, 0)
            if dh + dm > 0:
                stats["by_domain"][domain] = {
                    "hits": dh,
                    "misses": dm,
                    "total": dh + dm,
                    "hit_rate": round(dh / (dh + dm) * 100, 1),
                }

        for prefix in set(list(d_hits.keys()) + list(d_misses.keys())):
            try:
                count = sum(1 for _ in client.scan_iter(match=f"{prefix}:*", count=500))
                stats["by_prefix_keys"][prefix] = count
            except Exception:
                stats["by_prefix_keys"][prefix] = -1

    except Exception as e:
        logger.warning("get_cache_stats error: %s", e)

    return stats


def reset_stats():
    global _global_hits, _global_misses, _domain_hits, _domain_misses
    with _stats_lock:
        _global_hits = 0
        _global_misses = 0
        _domain_hits = defaultdict(int)
        _domain_misses = defaultdict(int)
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


async def stale_while_revalidate(
    key: str,
    compute_fn: Callable[[], Any],
    fresh_ttl: int = 300,
    stale_ttl: Optional[int] = None,
    lock_ttl: int = 30,
    wait_timeout: float = 15.0,
    poll_interval: float = 0.2,
) -> tuple[Any, str]:
    import asyncio

    if stale_ttl is None:
        stale_ttl = fresh_ttl * 2

    fresh_key = f"{key}:fresh"
    lock_key = f"{key}:lock"

    client = get_redis_client()
    if client is None:
        try:
            result = await asyncio.to_thread(compute_fn)
            return result, "miss"
        except Exception:
            raise

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
                try:
                    result = await asyncio.to_thread(compute_fn)
                    if result is not None:
                        cache_set(key, result, ttl=stale_ttl)
                        cache_set(fresh_key, "1", ttl=fresh_ttl)
                except Exception as e:
                    logger.warning("SWR background refresh failed for %s: %s", key, e)
                finally:
                    _release_lock(lock_key, lock_token)

            asyncio.ensure_future(_background_refresh())
        return data, "stale"

    lock_token = _try_acquire_lock(lock_key, lock_ttl)
    try:
        if lock_token:
            result = await asyncio.to_thread(compute_fn)
            if result is not None:
                cache_set(key, result, ttl=stale_ttl)
                cache_set(fresh_key, "1", ttl=fresh_ttl)
            return result, "miss"

        elapsed = 0.0
        while elapsed < wait_timeout:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            fresh_data = cache_get(key)
            if fresh_data is not None:
                return fresh_data, "coalesced"

        result = await asyncio.to_thread(compute_fn)
        if result is not None:
            cache_set(key, result, ttl=stale_ttl)
            cache_set(fresh_key, "1", ttl=fresh_ttl)
        return result, "miss"
    except Exception:
        raise
    finally:
        if lock_token:
            _release_lock(lock_key, lock_token)

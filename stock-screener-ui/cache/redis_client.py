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


def get_redis_client():
    global _redis_client, _redis_available, _CONSECUTIVE_FAILURES

    if _redis_client is not None:
        return _redis_client

    try:
        import redis

        url = _get_redis_url()
        _redis_client = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        _redis_client.ping()
        _redis_available = True
        _CONSECUTIVE_FAILURES = 0
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
        keys = list(client.scan_iter(match=pattern, count=500))
        if keys:
            return client.delete(*keys)
        return 0
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
            if result is not None:
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
            if result is not None:
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

        for domain in KNOWN_DOMAINS:
            dh = d_hits.get(domain, 0)
            dm = d_misses.get(domain, 0)
            if dh + dm > 0:
                stats["by_domain"][domain] = {
                    "hits": dh,
                    "misses": dm,
                    "total": dh + dm,
                    "hit_rate": round(dh / (dh + dm) * 100, 1),
                }

        for prefix in KNOWN_DOMAINS:
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
    return cache_delete_pattern(f"backtest:{user_id}:*")


def invalidate_news_cache() -> int:
    deleted = 0
    deleted += cache_delete_pattern("news:all:*")
    deleted += cache_delete_pattern("news:recent:*")
    deleted += cache_delete_pattern("news:sentiment:*")
    deleted += cache_delete_pattern("news:llm:*")
    deleted += cache_delete_pattern("news:article:*")
    return deleted


def invalidate_chart_cache() -> int:
    return cache_delete_pattern("chart:*")


def invalidate_screener_cache() -> int:
    deleted = cache_delete_pattern("screener:*")
    return deleted


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


def _try_acquire_lock(key: str, lock_ttl: int = 30) -> bool:
    client = get_redis_client()
    if client is None:
        return False
    try:
        return bool(client.set(key, "1", nx=True, ex=lock_ttl))
    except Exception:
        return False


def _release_lock(key: str) -> bool:
    client = get_redis_client()
    if client is None:
        return False
    try:
        return bool(client.delete(key))
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
            result = compute_fn()
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

        if _try_acquire_lock(lock_key, lock_ttl):

            async def _background_refresh():
                try:
                    result = await asyncio.to_thread(compute_fn)
                    if result is not None:
                        cache_set(key, result, ttl=stale_ttl)
                        cache_set(fresh_key, "1", ttl=fresh_ttl)
                except Exception as e:
                    logger.warning("SWR background refresh failed for %s: %s", key, e)
                finally:
                    _release_lock(lock_key)

            asyncio.ensure_future(_background_refresh())
        return data, "stale"

    acquired = _try_acquire_lock(lock_key, lock_ttl)
    if acquired:
        try:
            result = await asyncio.to_thread(compute_fn)
            if result is not None:
                cache_set(key, result, ttl=stale_ttl)
                cache_set(fresh_key, "1", ttl=fresh_ttl)
            return result, "miss"
        except Exception as e:
            raise
        finally:
            _release_lock(lock_key)

    elapsed = 0.0
    while elapsed < wait_timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        fresh_data = cache_get(key)
        if fresh_data is not None:
            return fresh_data, "coalesced"

    try:
        result = await asyncio.to_thread(compute_fn)
        if result is not None:
            cache_set(key, result, ttl=stale_ttl)
            cache_set(fresh_key, "1", ttl=fresh_ttl)
        return result, "miss"
    except Exception as e:
        raise

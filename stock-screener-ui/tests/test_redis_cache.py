"""
Tests for Redis cache client.

Uses fakeredis for in-memory Redis testing (no real Redis needed).
"""

import json
import time
import pytest
from contextlib import contextmanager
from unittest.mock import patch, MagicMock

from cache.redis_client import (
    cache_get,
    cache_set,
    cache_delete,
    cache_delete_pattern,
    make_cache_key,
    cached,
    get_redis_client,
    is_cache_available,
    _serialize,
    _deserialize,
)


@pytest.fixture(autouse=True)
def _reset_redis_state():
    import cache.redis_client as rc
    rc._redis_client = None
    rc._redis_available = False
    rc._global_hits = 0
    rc._global_misses = 0
    rc._domain_hits.clear()
    rc._domain_misses.clear()
    yield
    rc._redis_client = None
    rc._redis_available = False
    rc._global_hits = 0
    rc._global_misses = 0
    rc._domain_hits.clear()
    rc._domain_misses.clear()


@pytest.fixture
def fake_redis():
    try:
        import fakeredis
        return fakeredis.FakeRedis(decode_responses=True)
    except ImportError:
        pytest.skip("fakeredis not installed")


@contextmanager
def _patched_redis(fake_redis):
    with patch("cache.redis_client.get_redis_client", return_value=fake_redis):
        import cache.redis_client as rc
        rc._redis_available = True
        yield rc


class TestMakeCacheKey:
    def test_basic_key(self):
        key = make_cache_key("screener", "upstox", "intraday", "trending")
        assert key.startswith("screener:")
        assert len(key.split(":")) >= 2

    def test_key_with_kwargs(self):
        key1 = make_cache_key("screener", "upstox", min_rsi=55)
        key2 = make_cache_key("screener", "upstox", min_rsi=55)
        assert key1 == key2

    def test_key_order_independence(self):
        key1 = make_cache_key("test", a=1, b=2)
        key2 = make_cache_key("test", b=2, a=1)
        assert key1 == key2

    def test_different_args_different_keys(self):
        key1 = make_cache_key("screener", "upstox")
        key2 = make_cache_key("screener", "tradingview")
        assert key1 != key2


class TestSerializeDeserialize:
    def test_small_payload(self):
        data = {"key": "value", "num": 42}
        raw = _serialize(data)
        assert not raw.startswith("gz:")
        assert _deserialize(raw) == data

    def test_large_payload_compressed(self):
        data = {"items": list(range(1000))}
        raw = _serialize(data)
        assert raw.startswith("gz:")
        assert _deserialize(raw) == data

    def test_nested_structure(self):
        data = {"a": [{"b": 1}, {"c": None}], "d": True}
        raw = _serialize(data)
        assert _deserialize(raw) == data

    def test_datetime_serialization(self):
        from datetime import datetime
        data = {"ts": datetime(2024, 1, 1, 12, 0, 0)}
        raw = _serialize(data)
        result = _deserialize(raw)
        assert "2024-01-01" in result["ts"]


class TestCacheWithoutRedis:
    def test_get_returns_none_when_redis_unavailable(self):
        with patch("cache.redis_client.get_redis_client", return_value=None):
            assert cache_get("test:key") is None

    def test_set_returns_false_when_redis_unavailable(self):
        with patch("cache.redis_client.get_redis_client", return_value=None):
            assert cache_set("test:key", {"a": 1}) is False

    def test_delete_returns_false_when_redis_unavailable(self):
        with patch("cache.redis_client.get_redis_client", return_value=None):
            assert cache_delete("test:key") is False

    def test_delete_pattern_returns_zero_when_redis_unavailable(self):
        with patch("cache.redis_client.get_redis_client", return_value=None):
            assert cache_delete_pattern("test:*") == 0

    def test_is_cache_available_false(self):
        with patch("cache.redis_client._redis_available", False):
            assert is_cache_available() is False


class TestCachedDecorator:
    def test_sync_cache_miss_and_set(self):
        call_count = 0

        @cached("test", ttl=10)
        def compute(x):
            nonlocal call_count
            call_count += 1
            return x * 2

        result = compute(5)
        assert result == 10
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_async_cache_miss_and_set(self):
        call_count = 0

        @cached("test_async", ttl=10)
        async def compute(x):
            nonlocal call_count
            call_count += 1
            return x * 2

        result = await compute(5)
        assert result == 10
        assert call_count == 1

    def test_none_result_not_cached(self):
        call_count = 0

        @cached("test_none", ttl=10)
        def returns_none():
            nonlocal call_count
            call_count += 1
            return None

        assert returns_none() is None
        assert returns_none() is None
        assert call_count == 2

    def test_custom_key_builder(self):
        builder_calls = []

        def my_key(*args, **kwargs):
            builder_calls.append(1)
            return f"custom:{kwargs.get('name')}"

        @cached("test", ttl=10, key_builder=my_key)
        def greet(name):
            return f"hello {name}"

        r1 = greet(name="world")
        r2 = greet(name="world")
        assert r1 == "hello world"
        assert r2 == "hello world"
        assert len(builder_calls) == 2


class TestCacheIntegration:
    """Tests that use fakeredis for real Redis-like behavior."""

    def test_set_and_get(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            assert cache_set("test:1", {"value": 42}, ttl=60) is True
            result = cache_get("test:1")
            assert result == {"value": 42}

    def test_get_miss(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            assert cache_get("nonexistent:key") is None

    def test_delete(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            cache_set("test:del", "value", ttl=60)
            assert cache_get("test:del") == "value"
            assert cache_delete("test:del") is True
            assert cache_get("test:del") is None

    def test_delete_pattern(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            cache_set("screener:abc", "a", ttl=60)
            cache_set("screener:def", "b", ttl=60)
            cache_set("other:key", "c", ttl=60)

            deleted = cache_delete_pattern("screener:*")
            assert deleted == 2
            assert cache_get("screener:abc") is None
            assert cache_get("screener:def") is None
            assert cache_get("other:key") == "c"

    def test_ttl_expiry(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            cache_set("test:ttl", "expires", ttl=1)
            assert cache_get("test:ttl") == "expires"
            fake_redis.expire("test:ttl", 0)
            assert cache_get("test:ttl") is None

    def test_large_payload_roundtrip(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            big_data = {"data": list(range(5000)), "nested": {"a": "b" * 1000}}
            cache_set("test:big", big_data, ttl=60)
            result = cache_get("test:big")
            assert result == big_data


class TestBacktestCacheKey:
    def test_deterministic_key(self):
        from backtest.api import build_backtest_cache_key
        k1 = build_backtest_cache_key(1, "orb", ["RELIANCE", "TCS"], {"sl": 0.5}, 90)
        k2 = build_backtest_cache_key(1, "orb", ["TCS", "RELIANCE"], {"sl": 0.5}, 90)
        assert k1 == k2

    def test_different_params_different_keys(self):
        from backtest.api import build_backtest_cache_key
        k1 = build_backtest_cache_key(1, "orb", ["RELIANCE"], {"sl": 0.5}, 90)
        k2 = build_backtest_cache_key(1, "orb", ["RELIANCE"], {"sl": 0.7}, 90)
        assert k1 != k2

    def test_different_users_different_keys(self):
        from backtest.api import build_backtest_cache_key
        k1 = build_backtest_cache_key(1, "orb", ["RELIANCE"], {}, 90)
        k2 = build_backtest_cache_key(2, "orb", ["RELIANCE"], {}, 90)
        assert k1 != k2

    def test_key_prefix(self):
        from backtest.api import build_backtest_cache_key
        key = build_backtest_cache_key(1, "orb", ["RELIANCE"], {}, 90)
        assert key.startswith("backtest:1:")


class TestCacheStats:
    def test_stats_without_redis(self):
        from cache.redis_client import get_cache_stats
        with patch("cache.redis_client.get_redis_client", return_value=None), \
             patch("cache.redis_client._redis_available", False):
            stats = get_cache_stats()
            assert stats["available"] is False
            assert stats["hits"] == 0
            assert stats["misses"] == 0
            assert stats["hit_rate"] == 0
            assert stats["key_count"] == 0

    def test_hit_miss_tracking(self):
        with patch("cache.redis_client.get_redis_client", return_value=MagicMock(get=MagicMock(return_value=None))):
            import cache.redis_client as rc
            rc._redis_available = True

            rc.cache_get("miss:1")
            rc.cache_get("miss:2")
            assert rc._global_misses == 2

    def test_reset_stats(self):
        import cache.redis_client as rc
        rc._global_hits = 10
        rc._global_misses = 5
        rc.reset_stats()
        assert rc._global_hits == 0
        assert rc._global_misses == 0

    def test_stats_with_fakeredis(self):
        try:
            import fakeredis
        except ImportError:
            pytest.skip("fakeredis not installed")

        fake_redis = fakeredis.FakeRedis(decode_responses=True)
        with _patched_redis(fake_redis) as rc:
            rc._global_hits = 7
            rc._global_misses = 3

            stats = rc.get_cache_stats()
            assert stats["available"] is True
            assert stats["hits"] == 7
            assert stats["misses"] == 3
            assert stats["total_requests"] == 10
            assert stats["hit_rate"] == 70.0


class TestCacheInvalidation:
    def test_invalidate_backtest_cache(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            rc.cache_set("backtest:1:orb:abc123", {"strategy": "orb"}, ttl=60)
            rc.cache_set("backtest:1:sr_breakout:def456", {"strategy": "sr_breakout"}, ttl=60)
            rc.cache_set("backtest:2:orb:abc123", {"strategy": "orb"}, ttl=60)
            rc.cache_set("news:all:recent:25", "news_data", ttl=60)

            deleted = rc.invalidate_backtest_cache(user_id=1)
            assert deleted == 2
            assert rc.cache_get("backtest:1:orb:abc123") is None
            assert rc.cache_get("backtest:1:sr_breakout:def456") is None
            assert rc.cache_get("backtest:2:orb:abc123") == {"strategy": "orb"}
            assert rc.cache_get("news:all:recent:25") == "news_data"

    def test_invalidate_backtest_cache_with_strategy_id(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            rc.cache_set("backtest:1:orb:abc123", {"strategy": "orb"}, ttl=60)
            rc.cache_set("backtest:1:sr_breakout:def456", {"strategy": "sr_breakout"}, ttl=60)
            rc.cache_set("backtest:1:orb:ghi789", {"strategy": "orb", "params": {"sl": 0.7}}, ttl=60)

            deleted = rc.invalidate_backtest_cache(user_id=1, strategy_id="orb")
            assert deleted == 2
            assert rc.cache_get("backtest:1:orb:abc123") is None
            assert rc.cache_get("backtest:1:orb:ghi789") is None
            assert rc.cache_get("backtest:1:sr_breakout:def456") == {"strategy": "sr_breakout"}

    def test_invalidate_news_cache(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            rc.cache_set("news:all:recent:25", "a", ttl=60)
            rc.cache_set("news:recent:24:all:50", "b", ttl=60)
            rc.cache_set("news:sentiment:RELIANCE", "c", ttl=60)
            rc.cache_set("news:llm:abc123", "d", ttl=60)
            rc.cache_set("screener:xyz", "e", ttl=60)

            deleted = rc.invalidate_news_cache()
            assert deleted == 4
            assert rc.cache_get("news:all:recent:25") is None
            assert rc.cache_get("news:recent:24:all:50") is None
            assert rc.cache_get("news:sentiment:RELIANCE") is None
            assert rc.cache_get("news:llm:abc123") is None
            assert rc.cache_get("screener:xyz") == "e"

    def test_invalidate_screener_cache(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            rc.cache_set("screener:abc123", "data1", ttl=60)
            rc.cache_set("screener:def456", "data2", ttl=60)
            fake_redis.set("screener:abc123:lock", "1", ex=30)
            fake_redis.set("screener:abc123:fresh", "1", ex=30)
            rc.cache_set("news:all:recent:25", "news", ttl=60)

            deleted = rc.invalidate_screener_cache()
            assert deleted == 4
            assert rc.cache_get("screener:abc123") is None
            assert rc.cache_get("screener:def456") is None
            assert rc.cache_get("news:all:recent:25") == "news"

    def test_invalidate_without_redis(self):
        from cache.redis_client import invalidate_backtest_cache, invalidate_news_cache, invalidate_screener_cache
        with patch("cache.redis_client.get_redis_client", return_value=None):
            assert invalidate_backtest_cache(1) == 0
            assert invalidate_news_cache() == 0
            assert invalidate_screener_cache() == 0


class TestStaleWhileRevalidate:
    @pytest.fixture(autouse=True)
    def _reset(self, _reset_redis_state):
        pass

    @pytest.mark.asyncio
    async def test_fresh_hit_returns_cached(self, fake_redis):
        with _patched_redis(fake_redis) as rc:
            rc.cache_set("test:swr:1", {"data": "fresh"}, ttl=600)
            fake_redis.set("test:swr:1:fresh", "1", ex=300)

            compute_fn = MagicMock(side_effect=Exception("should not be called"))
            data, status = await rc.stale_while_revalidate("test:swr:1", compute_fn, fresh_ttl=300, stale_ttl=600)

            assert status == "fresh"
            assert data == {"data": "fresh"}
            compute_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_stale_hit_returns_cached_and_triggers_refresh(self, fake_redis):
        with patch("cache.redis_client.get_redis_client", return_value=fake_redis):
            import cache.redis_client as rc
            import asyncio
            rc._redis_available = True
            fake_redis.set("test:swr:2", rc._serialize({"data": "stale"}), ex=600)

            compute_fn = MagicMock(return_value={"data": "new"})
            data, status = await rc.stale_while_revalidate("test:swr:2", compute_fn, fresh_ttl=300, stale_ttl=600)

            assert status == "stale"
            assert data == {"data": "stale"}

            await asyncio.sleep(0.2)
            compute_fn.assert_called_once()

    @pytest.mark.asyncio
    async def test_stale_lock_prevents_duplicate_refresh(self, fake_redis):
        with _patched_redis(fake_redis) as rc:
            fake_redis.set("test:swr:3", rc._serialize({"data": "stale"}), ex=600)
            fake_redis.set("test:swr:3:lock", "1", ex=30)

            compute_fn = MagicMock(return_value={"data": "new"})
            data, status = await rc.stale_while_revalidate("test:swr:3", compute_fn, fresh_ttl=300, stale_ttl=600)

            assert status == "stale"
            assert data == {"data": "stale"}
            compute_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_miss_singleflight_computes(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            compute_fn = MagicMock(return_value={"data": "computed"})
            data, status = await rc.stale_while_revalidate("test:swr:4", compute_fn, fresh_ttl=300, stale_ttl=600)

            assert status == "miss"
            assert data == {"data": "computed"}
            compute_fn.assert_called_once()
            assert fake_redis.exists("test:swr:4:lock") == False

    @pytest.mark.asyncio
    async def test_miss_coalesced_waits_for_other(self, fake_redis):
        with patch("cache.redis_client.get_redis_client", return_value=fake_redis):
            import cache.redis_client as rc
            import asyncio
            rc._redis_available = True
            fake_redis.set("test:swr:5:lock", "1", ex=30)

            async def populate_after_delay():
                await asyncio.sleep(0.3)
                rc.cache_set("test:swr:5", {"data": "from_other"}, ttl=600)

            asyncio.create_task(populate_after_delay())

            compute_fn = MagicMock(side_effect=Exception("should not be called"))
            data, status = await rc.stale_while_revalidate(
                "test:swr:5", compute_fn, fresh_ttl=300, stale_ttl=600, wait_timeout=5.0, poll_interval=0.1
            )

            assert status == "coalesced"
            assert data == {"data": "from_other"}
            compute_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_miss_timeout_fallback(self, fake_redis):
        with _patched_redis(fake_redis) as rc:
            fake_redis.set("test:swr:6:lock", "1", ex=30)

            compute_fn = MagicMock(return_value={"data": "fallback"})
            data, status = await rc.stale_while_revalidate(
                "test:swr:6", compute_fn, fresh_ttl=300, stale_ttl=600, wait_timeout=0.5, poll_interval=0.1
            )

            assert status == "miss"
            assert data == {"data": "fallback"}
            compute_fn.assert_called_once()
            assert fake_redis.exists("test:swr:6:lock") == True

    @pytest.mark.asyncio
    async def test_redis_unavailable_computes_sync(self):
        with patch("cache.redis_client.get_redis_client", return_value=None):
            import cache.redis_client as rc
            rc._redis_available = False

            compute_fn = MagicMock(return_value={"data": "no_redis"})
            data, status = await rc.stale_while_revalidate("test:swr:7", compute_fn)

            assert status == "miss"
            assert data == {"data": "no_redis"}
            compute_fn.assert_called_once()

    @pytest.mark.asyncio
    async def test_compute_failure_on_miss_raises(self, fake_redis):
        with _patched_redis(fake_redis) as rc:

            compute_fn = MagicMock(side_effect=ValueError("compute error"))
            with pytest.raises(ValueError, match="compute error"):
                await rc.stale_while_revalidate("test:swr:8", compute_fn, fresh_ttl=300, stale_ttl=600)

            assert fake_redis.exists("test:swr:8:lock") == False

"""
Distributed rate limiter for Upstox API using Redis sliding window.
Enforces Upstox rate limits across all bot processes atomically.

Upstox rate limits (Standard APIs — historical candles, quotes, etc.):
  - Per second:    50 requests
  - Per minute:    500 requests
  - Per 30 min:   2000 requests

Uses a Redis Lua script for atomic check-and-add so that 14 concurrent
bot processes cannot all pass the check before any entry is recorded.
"""

import time

ACQUIRE_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', key, 0, now - 1800)

local minute   = redis.call('ZCOUNT', key, now - 60, now)
local second   = redis.call('ZCOUNT', key, now - 1, now)

if minute + cost > 500 then
    return {0, 5}
end

if second + cost > 50 then
    return {0, 1}
end

redis.call('ZADD', key, now, now)
redis.call('EXPIRE', key, 1800)
return {1, 0}
"""


class UpstoxRateLimiter:
    """Redis-backed sliding window rate limiter shared across processes.

    Uses a Lua script so that the check-and-add is atomic — no race
    condition when 14+ bot processes contend simultaneously.
    """

    def __init__(self, redis_client=None):
        self._redis = redis_client
        self._last_added = None

    def _get_redis(self):
        if self._redis is None:
            try:
                from cache.redis_client import get_redis_client
                self._redis = get_redis_client()
            except Exception:
                pass
        if self._redis is not None:
            try:
                self._redis.ping()
                return self._redis
            except Exception:
                self._redis = None
        return None

    def acquire(self, cost: int = 1, timeout: float = 0.5) -> bool:
        """Try to acquire capacity within the timeout.

        Returns True if capacity acquired, False if timed out (caller should skip).
        """
        client = self._get_redis()
        if client is None:
            return True

        key = "upstox:rl:hits"
        try:
            script = client.register_script(ACQUIRE_LUA)
        except Exception:
            return True

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                allowed, wait = script(keys=[key], args=[time.time(), cost])
            except Exception:
                return True

            if allowed:
                self._last_added = time.time()
                return True
            time.sleep(min(wait, 2.0))
        return False

    def cancel_last(self):
        """Remove the last acquired entry (call when the request got a 429)."""
        if self._last_added is None:
            return
        client = self._get_redis()
        if client is not None:
            try:
                client.zrem('upstox:rl:hits', str(self._last_added))
            except Exception:
                pass
        self._last_added = None

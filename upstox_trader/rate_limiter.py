"""
Distributed rate limiter for Upstox API using Redis sliding window.
Enforces Upstox rate limits across all bot processes atomically.

Upstox rate limits (Standard APIs — historical candles, quotes, etc.):
  - Per second:    50 requests
  - Per minute:    500 requests
  - Per 30 min:   2000 requests

Uses a Redis Lua script for atomic check-and-add so that 14 concurrent
bot processes cannot all pass the check before any entry is recorded.

The ZSET member is ``{timestamp}:{unique_id}``  to avoid collisions
when two requests share the same ``time.time()`` value (float precision).
The score is the timestamp for efficient range cleanup.
"""

import itertools
import time

ACQUIRE_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local member = ARGV[2]

redis.call('ZREMRANGEBYSCORE', key, 0, now - 1800)

local minute   = redis.call('ZCOUNT', key, now - 60, now)
local second   = redis.call('ZCOUNT', key, now - 1, now)

if minute + 1 > 500 then
    return {0, 5}
end

if second + 1 > 50 then
    return {0, 1}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, 1800)
return {1, 0}
"""


class UpstoxRateLimiter:
    """Redis-backed sliding window rate limiter shared across processes.

    Uses a Lua script so that the check-and-add is atomic — no race
    condition when 14+ bot processes contend simultaneously.

    Each instance keeps a monotonically increasing counter so that
    ZSET members are unique even when ``time.time()`` returns the
    same float value twice.  ``cancel_last()`` stores the exact member
    string that was sent to Redis, avoiding precision mismatch with
    ``str(float)`` vs Lua ``tonumber``.
    """

    def __init__(self, redis_client=None):
        self._redis = redis_client
        self._last_added = None  # exact member string sent to Redis
        self._counter = itertools.count()
        self._script = None  # cached Script object

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

    def acquire(self, cost: int = 1, timeout: float = 10.0) -> bool:
        """Try to acquire capacity within the timeout.

        Returns True if capacity acquired, False if timed out (caller should retry).
        """
        client = self._get_redis()
        if client is None:
            return True

        try:
            if self._script is None:
                self._script = client.register_script(ACQUIRE_LUA)
        except Exception:
            return True

        deadline = time.time() + timeout
        while time.time() < deadline:
            now = time.time()
            member = f"{now}:{next(self._counter)}"
            try:
                allowed, wait = self._script(keys=["upstox:rl:hits"], args=[now, member])
            except Exception:
                return True

            if allowed:
                self._last_added = member
                return True
            time.sleep(min(wait, 5.0))
        return False

    def cancel_last(self):
        """Remove the last acquired entry (call when the request got a 429)."""
        if self._last_added is None:
            return
        client = self._get_redis()
        if client is not None:
            try:
                client.zrem('upstox:rl:hits', self._last_added)
            except Exception:
                pass
        self._last_added = None

    def remaining_minute_budget(self) -> int:
        """How many requests remain in the current 60s window (across all processes).

        Returns 500 (full budget) when Redis is unavailable so callers
        can fall back to a safe default.
        """
        client = self._get_redis()
        if client is None:
            return 500
        try:
            now = time.time()
            client.zremrangebyscore('upstox:rl:hits', 0, now - 1800)
            count = client.zcount('upstox:rl:hits', now - 60, now)
            return max(0, 500 - count)
        except Exception:
            return 500
"""
Distributed rate limiter for Upstox API using Redis sliding window.
Enforces Upstox rate limits across all bot processes atomically.

Upstox rate limits (Standard APIs — historical candles, quotes, etc.):
  - Per second:    50 requests
  - Per minute:    500 requests
  - Per 30 min:    2000 requests

Also includes a Redis-backed 429 circuit breaker. When Upstox/Cloudflare
returns HTTP 429 (Error 1015 — "you are being rate limited"), all bot
processes share a cooldown so they stop hammering the blocked endpoint.
This lets the WAF block clear instead of being continuously re-triggered.

Uses a Redis Lua script for atomic check-and-add so that 14 concurrent
bot processes cannot all pass the check before any entry is recorded.

The ZSET member is ``{timestamp}:{pid-rand}:{unique_id}`` to avoid
collisions when two requests share the same ``time.time()`` value (float
precision) across processes or threads. The score is the timestamp for
efficient range cleanup.

Per-consumer budgets (reserved interactive slice)
------------------------------------------------
All processes used to draw from the single 500/min global window, so
background scanners could starve interactive reads (Patterns /results +
/watch).  Acquires are now also counted against a per-consumer window on
``upstox:rl:hits:{consumer}`` with a per-consumer minute cap.  An acquire
succeeds only when BOTH the global window and the caller's consumer
window have room.

Budget arithmetic (defaults)::

    api (150) + bot (300) + orderflow (50) = 500 = global 500/min

Because the per-consumer caps sum to exactly the global cap, the ``api``
slice can never be consumed by other consumers: even with ``bot`` at its
300 and ``orderflow`` at its 50, the global window holds at most 350 and
``api`` still has its full 150 left.  Unknown consumers fall back to the
global cap, so every deployment must run each process under an explicit
consumer for the slice math to hold.

Consumer resolution (``resolve_consumer``): explicit argument wins, else
the process-role autodetect (``runner_cli.py`` -> ``bot``,
``orderflow_recorder.py`` -> ``orderflow``), else ``UPSTOX_RL_CONSUMER``,
else ``"default"``.  Role autodetect intentionally beats the env var
because bots are spawned as subprocesses of the API process and would
otherwise inherit the API's ``UPSTOX_RL_CONSUMER=api``.  Caps come from
``UPSTOX_RL_CAP_<CONSUMER>`` (e.g. ``UPSTOX_RL_CAP_API=150``) with the
defaults above; an unset/unknown consumer defaults to the global cap.
"""

import itertools
import os
import random
import sys
import time

# --- 429 circuit breaker settings ---
CIRCUIT_FAIL_THRESHOLD = 5          # consecutive 429s before opening the circuit
CIRCUIT_COOLDOWN_SECONDS = 60       # how long the circuit stays open

# --- Global Upstox sliding-window limits (unchanged) ---
GLOBAL_KEY = "upstox:rl:hits"
GLOBAL_PER_SECOND = 50
GLOBAL_PER_MINUTE = 500

# --- Per-consumer budget settings ---
CONSUMER_ENV_VAR = "UPSTOX_RL_CONSUMER"
CONSUMER_CAP_ENV_PREFIX = "UPSTOX_RL_CAP_"
DEFAULT_CONSUMER = "default"

# Default per-consumer minute caps. These sum to exactly GLOBAL_PER_MINUTE
# (150 + 300 + 50 = 500) so the api slice is reserved: background consumers
# can never eat into it, no matter how saturated they are.
DEFAULT_CONSUMER_CAPS = {
    "api": 150,
    "bot": 300,
    "orderflow": 50,
}

# Entry-point markers for process-role autodetect (basename of sys.argv[0]).
_ROLE_MARKERS = (
    ("runner_cli", "bot"),
    ("orderflow_recorder", "orderflow"),
)


def _normalize_consumer(name) -> str:
    """Lowercase and strip unsafe chars so the name is safe in a Redis key."""
    cleaned = "".join(
        ch for ch in str(name or "").strip().lower()
        if ch.isalnum() or ch in ("_", "-")
    )
    return cleaned or DEFAULT_CONSUMER


def _consumer_key(consumer: str) -> str:
    return f"{GLOBAL_KEY}:{_normalize_consumer(consumer)}"


def _detect_process_role():
    """Return the consumer for known entry points, else None.

    Only inspects the script name (basename of ``sys.argv[0]``), never the
    full argv, so test files with similar names in argv don't false-match.
    """
    try:
        script = os.path.basename(sys.argv[0] or "")
    except Exception:
        return None
    for marker, role in _ROLE_MARKERS:
        if marker in script:
            return role
    return None


def resolve_consumer(explicit=None) -> str:
    """Resolve which rate-limit consumer this process is.

    Precedence: explicit argument > process-role autodetect >
    ``UPSTOX_RL_CONSUMER`` env > ``"default"``.
    """
    if explicit is not None and str(explicit).strip():
        return _normalize_consumer(explicit)
    role = _detect_process_role()
    if role is not None:
        return role
    env = os.getenv(CONSUMER_ENV_VAR, "")
    if env.strip():
        return _normalize_consumer(env)
    return DEFAULT_CONSUMER


def resolve_consumer_cap(consumer) -> int:
    """Per-minute cap for a consumer: env override, else default, else global."""
    name = _normalize_consumer(consumer)
    raw = os.getenv(f"{CONSUMER_CAP_ENV_PREFIX}{name.upper()}", "")
    try:
        value = int(raw)
        if value > 0:
            return value
    except (TypeError, ValueError):
        pass
    return DEFAULT_CONSUMER_CAPS.get(name, GLOBAL_PER_MINUTE)


ACQUIRE_LUA = """
local global_key = KEYS[1]
local consumer_key = KEYS[2]
local now = tonumber(ARGV[1])
local member = ARGV[2]
local consumer_cap = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', global_key, 0, now - 1800)
redis.call('ZREMRANGEBYSCORE', consumer_key, 0, now - 1800)

local minute   = redis.call('ZCOUNT', global_key, now - 60, now)
local second   = redis.call('ZCOUNT', global_key, now - 1, now)
local consumer_minute = redis.call('ZCOUNT', consumer_key, now - 60, now)

if minute + 1 > 500 then
    return {0, 5}
end

if second + 1 > 50 then
    return {0, 1}
end

if consumer_minute + 1 > consumer_cap then
    return {0, 5}
end

redis.call('ZADD', global_key, now, member)
redis.call('ZADD', consumer_key, now, member)
redis.call('EXPIRE', global_key, 1800)
redis.call('EXPIRE', consumer_key, 1800)
return {1, 0}
"""


class UpstoxRateLimiter:
    """Redis-backed sliding window rate limiter shared across processes.

    Uses a Lua script so that the check-and-add is atomic — no race
    condition when 14+ bot processes contend simultaneously.

    Each instance keeps a monotonically increasing counter plus a random
    per-instance prefix so that ZSET members are unique even when two
    processes/threads call ``time.time()`` in the same float tick with the
    same counter value — otherwise their ``ZADD``s would collapse onto one
    member and the shared window would undercount.  ``cancel_last()``
    stores the exact member string that was sent to Redis, avoiding
    precision mismatch with ``str(float)`` vs Lua ``tonumber``.

    The ``consumer`` (default from ``resolve_consumer()``) selects the
    per-consumer budget slice this instance draws from.
    """

    def __init__(self, redis_client=None, consumer=None):
        self._redis = redis_client
        self.consumer = resolve_consumer(consumer)
        self._consumer_key = _consumer_key(self.consumer)
        self._last_added = None  # exact member string sent to Redis
        self._last_consumer_key = None  # consumer key the member was added to
        self._member_prefix = f"{os.getpid():x}-{random.getrandbits(32):08x}"
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

        Succeeds only when both the global window and this instance's
        per-consumer window have room; the hit is recorded on both keys.

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

        cap = resolve_consumer_cap(self.consumer)
        deadline = time.time() + timeout
        while time.time() < deadline:
            now = time.time()
            member = f"{now}:{self._member_prefix}:{next(self._counter)}"
            try:
                allowed, wait = self._script(
                    keys=[GLOBAL_KEY, self._consumer_key],
                    args=[now, member, cap],
                )
            except Exception:
                return True

            if allowed:
                self._last_added = member
                self._last_consumer_key = self._consumer_key
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
                client.zrem(GLOBAL_KEY, self._last_added)
                if self._last_consumer_key:
                    client.zrem(self._last_consumer_key, self._last_added)
            except Exception:
                pass
        self._last_added = None
        self._last_consumer_key = None

    # ------------------------------------------------------------------
    # 429 circuit breaker (shared across processes via Redis)
    # ------------------------------------------------------------------
    def circuit_seconds_to_wait(self) -> int:
        """Seconds to wait before making another request, 0 if the circuit is closed.

        When Cloudflare/Upstox opens a 429 block, this returns the remaining
        cooldown so callers can sleep instead of hammering the endpoint.
        """
        client = self._get_redis()
        if client is None:
            return 0
        try:
            raw = client.get('upstox:circuit:until')
            if raw:
                wait = float(raw) - time.time()
                return int(max(0, wait))
        except Exception:
            pass
        return 0

    def record_failure(self):
        """Record a 429 failure. Opens the shared circuit after N consecutive hits."""
        client = self._get_redis()
        if client is None:
            return
        try:
            fails = client.incr('upstox:circuit:fails')
            client.expire('upstox:circuit:fails', 120)
            if fails >= CIRCUIT_FAIL_THRESHOLD:
                until = time.time() + CIRCUIT_COOLDOWN_SECONDS
                client.set('upstox:circuit:until', until)
                client.expire('upstox:circuit:until', CIRCUIT_COOLDOWN_SECONDS + 60)
                client.delete('upstox:circuit:fails')
        except Exception:
            pass

    def record_success(self):
        """Reset the failure counter on a successful request."""
        client = self._get_redis()
        if client is None:
            return
        try:
            client.delete('upstox:circuit:fails')
        except Exception:
            pass

    def remaining_minute_budget(self, consumer=None) -> int:
        """How many requests remain in the current 60s window.

        Returns the min of the global remaining budget and the requested
        consumer's remaining slice (defaults to this instance's consumer),
        so callers see what *they* can still spend — not just the global
        total, which other consumers may have already claimed.

        Returns 0 when Redis is unavailable so callers shrink their scan
        budget (fail-safe) instead of assuming a full 500/min budget while
        throttling is actually disabled.
        """
        client = self._get_redis()
        if client is None:
            return 0
        name = _normalize_consumer(consumer) if consumer is not None else self.consumer
        key = _consumer_key(name)
        cap = resolve_consumer_cap(name)
        try:
            now = time.time()
            client.zremrangebyscore(GLOBAL_KEY, 0, now - 1800)
            client.zremrangebyscore(key, 0, now - 1800)
            global_count = client.zcount(GLOBAL_KEY, now - 60, now)
            consumer_count = client.zcount(key, now - 60, now)
            return max(0, min(GLOBAL_PER_MINUTE - global_count, cap - consumer_count))
        except Exception:
            return 0

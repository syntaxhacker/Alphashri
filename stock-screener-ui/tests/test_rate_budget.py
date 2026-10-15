"""Per-consumer Upstox rate-limit budgets (reserved interactive slice).

Uses an in-memory Redis stand-in whose ``register_script`` returns a
callable implementing the same check-and-add semantics as ACQUIRE_LUA
(global 50/s + 500/min window AND the per-consumer minute cap), so these
tests never touch the live Upstox API (currently in shared 429 back-off)
and need no Redis server.
"""
import sys
import time as _time_module
from pathlib import Path

# upstox_trader lives in the workspace root (parent of stock-screener-ui).
_UI_DIR = Path(__file__).resolve().parent.parent
_ROOT = _UI_DIR.parent
for _p in (str(_ROOT), str(_UI_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pytest

from upstox_trader import rate_limiter as rlmod
from upstox_trader.rate_limiter import (
    ACQUIRE_LUA,
    GLOBAL_PER_MINUTE,
    UpstoxRateLimiter,
    resolve_consumer,
    resolve_consumer_cap,
)
from upstox_trader.queued_rate_limiter import QueuedRateLimiter


class FakeScript:
    """Executes the ACQUIRE_LUA check-and-add semantics against FakeRedis."""

    def __init__(self, redis):
        self.redis = redis
        self.calls = []  # (keys, args) per invocation, for plumbing asserts

    def __call__(self, keys=None, args=None, client=None):
        self.calls.append((list(keys), list(args)))
        global_key, consumer_key = keys[0], keys[1]
        now = float(args[0])
        member = args[1]
        consumer_cap = int(args[2])
        store = self.redis.zsets
        for key in (global_key, consumer_key):
            store.setdefault(key, {})
            store[key] = {m: s for m, s in store[key].items() if s > now - 1800}

        def _count(key, lo):
            return sum(1 for s in store[key].values() if lo <= s <= now)

        if _count(global_key, now - 60) + 1 > 500:
            return (0, 5)
        if _count(global_key, now - 1) + 1 > 50:
            return (0, 1)
        if _count(consumer_key, now - 60) + 1 > consumer_cap:
            return (0, 5)
        store[global_key][member] = now
        store[consumer_key][member] = now
        return (1, 0)


class FakeRedis:
    """Minimal in-memory stand-in for the redis client methods used."""

    def __init__(self):
        self.zsets = {}
        self.script = FakeScript(self)

    def ping(self):
        return True

    def register_script(self, lua):
        return self.script

    def zadd(self, key, score, member):
        self.zsets.setdefault(key, {})[member] = float(score)
        return 1

    def zcount(self, key, start, end):
        return sum(1 for s in self.zsets.get(key, {}).values()
                   if float(start) <= s <= float(end))

    def zremrangebyscore(self, key, start, end):
        members = self.zsets.get(key, {})
        doomed = [m for m, s in members.items()
                  if float(start) <= s <= float(end)]
        for m in doomed:
            del members[m]
        return len(doomed)

    def zrem(self, key, member):
        return 1 if self.zsets.get(key, {}).pop(member, None) is not None else 0

    def expire(self, key, seconds):
        return True

    def get(self, key):
        return None


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture
def frozen_clock(monkeypatch):
    """Freeze wall-clock; sleeps advance it instantly (no real waiting)."""
    state = {"now": 1_700_000_000.0}
    monkeypatch.setattr(_time_module, "time", lambda: state["now"])
    monkeypatch.setattr(_time_module, "sleep",
                        lambda s: state.__setitem__("now", state["now"] + s))
    return state


@pytest.fixture
def neutral_argv(monkeypatch):
    """Keep process-role autodetect out of the picture unless tested."""
    monkeypatch.setattr(sys, "argv", ["/usr/bin/pytest"])
    monkeypatch.delenv("UPSTOX_RL_CONSUMER", raising=False)


def _drain(limiter, n, clock, batch=40):
    """Acquire n slots, nudging the fake clock so ≤50 land in any one second."""
    for i in range(n):
        assert limiter.acquire(timeout=5) is True
        if i % batch == batch - 1:
            clock["now"] += 1.0


# --- isolation between consumers ---

def test_bot_cap_does_not_starve_api(fake_redis, frozen_clock, monkeypatch, neutral_argv):
    monkeypatch.setenv("UPSTOX_RL_CAP_BOT", "5")
    monkeypatch.setenv("UPSTOX_RL_CAP_API", "5")
    bot = UpstoxRateLimiter(redis_client=fake_redis, consumer="bot")
    api = UpstoxRateLimiter(redis_client=fake_redis, consumer="api")
    for _ in range(5):
        assert bot.acquire(timeout=5) is True
    assert bot.acquire(timeout=3) is False  # bot slice exhausted
    assert api.acquire(timeout=5) is True  # api slice untouched


def test_api_cap_does_not_starve_bot(fake_redis, frozen_clock, monkeypatch, neutral_argv):
    monkeypatch.setenv("UPSTOX_RL_CAP_BOT", "5")
    monkeypatch.setenv("UPSTOX_RL_CAP_API", "5")
    bot = UpstoxRateLimiter(redis_client=fake_redis, consumer="bot")
    api = UpstoxRateLimiter(redis_client=fake_redis, consumer="api")
    for _ in range(5):
        assert api.acquire(timeout=5) is True
    assert api.acquire(timeout=3) is False  # api slice exhausted
    assert bot.acquire(timeout=5) is True  # bot slice untouched


def test_global_cap_still_blocks_when_sum_hit(fake_redis, frozen_clock, monkeypatch, neutral_argv):
    monkeypatch.setenv("UPSTOX_RL_CAP_BOT", "500")
    monkeypatch.setenv("UPSTOX_RL_CAP_API", "500")
    bot = UpstoxRateLimiter(redis_client=fake_redis, consumer="bot")
    api = UpstoxRateLimiter(redis_client=fake_redis, consumer="api")
    for i in range(GLOBAL_PER_MINUTE):
        rl = bot if i % 2 == 0 else api
        assert rl.acquire(timeout=5) is True
        if i % 40 == 39:
            frozen_clock["now"] += 1.0
    # 500 global hits in the window: both consumers are now blocked globally.
    assert bot.acquire(timeout=3) is False
    assert api.acquire(timeout=3) is False
    assert bot.remaining_minute_budget() == 0


def test_global_per_second_still_enforced(fake_redis, frozen_clock, monkeypatch, neutral_argv):
    monkeypatch.setenv("UPSTOX_RL_CAP_BOT", "500")
    bot = UpstoxRateLimiter(redis_client=fake_redis, consumer="bot")
    for _ in range(50):
        assert bot.acquire(timeout=5) is True
    # 51st request inside the same fake second trips the global 50/s rule.
    # Timeout 0.5 allows exactly one attempt: the 1s second-denial wait
    # already exceeds it, so acquire fails instead of retrying past the
    # burst window (a longer timeout would legitimately succeed on retry).
    assert bot.acquire(timeout=0.5) is False


# --- reserved slice arithmetic ---

def test_remaining_budget_reflects_reserved_slice(fake_redis, frozen_clock, monkeypatch, neutral_argv):
    for var in ("UPSTOX_RL_CAP_API", "UPSTOX_RL_CAP_BOT", "UPSTOX_RL_CAP_ORDERFLOW"):
        monkeypatch.delenv(var, raising=False)
    bot = UpstoxRateLimiter(redis_client=fake_redis, consumer="bot")
    _drain(bot, 300, frozen_clock)  # bot saturates its default 300/min slice
    assert bot.acquire(timeout=3) is False
    assert bot.remaining_minute_budget() == 0
    # api slice untouched: 150 reserved even though bots maxed out.
    assert bot.remaining_minute_budget("api") == 150
    api = UpstoxRateLimiter(redis_client=fake_redis, consumer="api")
    assert api.remaining_minute_budget() == 150
    assert api.acquire(timeout=5) is True


def test_default_caps_sum_to_global_budget(monkeypatch, neutral_argv):
    for var in ("UPSTOX_RL_CAP_API", "UPSTOX_RL_CAP_BOT", "UPSTOX_RL_CAP_ORDERFLOW"):
        monkeypatch.delenv(var, raising=False)
    total = sum(resolve_consumer_cap(c) for c in ("api", "bot", "orderflow"))
    assert total == GLOBAL_PER_MINUTE


# --- plumbing ---

def test_acquire_records_on_both_keys(fake_redis, frozen_clock, neutral_argv):
    api = UpstoxRateLimiter(redis_client=fake_redis, consumer="api")
    assert api.acquire(timeout=5) is True
    keys, args = fake_redis.script.calls[-1]
    assert keys == ["upstox:rl:hits", "upstox:rl:hits:api"]
    assert args[2] == resolve_consumer_cap("api")
    assert fake_redis.zcount("upstox:rl:hits", 0, 2e9) == 1
    assert fake_redis.zcount("upstox:rl:hits:api", 0, 2e9) == 1


def test_cancel_last_removes_from_both_keys(fake_redis, frozen_clock, neutral_argv):
    api = UpstoxRateLimiter(redis_client=fake_redis, consumer="api")
    assert api.acquire(timeout=5) is True
    api.cancel_last()
    assert fake_redis.zcount("upstox:rl:hits", 0, 2e9) == 0
    assert fake_redis.zcount("upstox:rl:hits:api", 0, 2e9) == 0


def test_lua_checks_global_and_consumer_windows():
    assert "KEYS[2]" in ACQUIRE_LUA
    assert "consumer_cap" in ACQUIRE_LUA
    assert ACQUIRE_LUA.count("ZADD") == 2


# --- consumer resolution ---

def test_explicit_consumer_is_normalized(fake_redis, neutral_argv):
    assert UpstoxRateLimiter(redis_client=fake_redis, consumer="API").consumer == "api"


def test_consumer_from_env(monkeypatch, neutral_argv):
    monkeypatch.setenv("UPSTOX_RL_CONSUMER", "orderflow")
    assert resolve_consumer() == "orderflow"


def test_process_role_beats_env(monkeypatch):
    monkeypatch.setenv("UPSTOX_RL_CONSUMER", "api")
    monkeypatch.setattr(sys, "argv", ["/app/stock-screener-ui/trading/runner_cli.py",
                                      "--bot-id=1"])
    assert resolve_consumer() == "bot"
    monkeypatch.setattr(sys, "argv", ["scripts/orderflow_recorder.py"])
    assert resolve_consumer() == "orderflow"


def test_consumer_defaults_to_default(neutral_argv):
    assert resolve_consumer() == "default"
    assert resolve_consumer_cap("unknown-consumer") == GLOBAL_PER_MINUTE


def test_consumer_cap_env_override(monkeypatch, neutral_argv):
    monkeypatch.setenv("UPSTOX_RL_CAP_NEWS", "25")
    assert resolve_consumer_cap("news") == 25
    monkeypatch.setenv("UPSTOX_RL_CAP_NEWS", "bogus")
    assert resolve_consumer_cap("news") == GLOBAL_PER_MINUTE


# --- QueuedRateLimiter wiring ---

def test_queued_limiter_passes_consumer_through(monkeypatch, neutral_argv):
    q = QueuedRateLimiter(consumer="api")
    try:
        assert q.consumer == "api"
        assert q._thread_rl().consumer == "api"
    finally:
        q.shutdown()


def test_queued_limiter_consumer_from_env(monkeypatch, neutral_argv):
    monkeypatch.setattr(sys, "argv", ["/usr/bin/uvicorn"])
    monkeypatch.setenv("UPSTOX_RL_CONSUMER", "api")
    q = QueuedRateLimiter()
    try:
        assert q.consumer == "api"
    finally:
        q.shutdown()


def test_upstox_api_limiter_uses_resolved_consumer(monkeypatch, neutral_argv):
    assert rlmod.resolve_consumer("bot") == "bot"

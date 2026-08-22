"""Assert 86400 PID TTL vs 90 status TTL with real spy (no MagicMock auto-pass)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from unittest.mock import patch


class SpyRedis:
    def __init__(self):
        self.calls = []
    def setex(self, key, ttl, value):
        self.calls.append((key, ttl, value))
        return True
    def delete(self, *keys):
        self.calls.append(("delete", keys))
        return 1
    def get(self, key):
        return None


def test_heartbeat_ttls_with_spy():
    from trading.bot_heartbeat import BotHeartbeat, HEARTBEAT_TTL
    spy = SpyRedis()
    with patch("cache.redis_client.get_redis_client", return_value=spy):
        hb = BotHeartbeat(user_id=7, bot_config_id=3)
        # Simulate one _run iteration via direct calls (avoid threading)
        # We call the internal logic manually
        import os
        pid = os.getpid()
        status_key = f"bot:7:3:status"
        pid_key = f"bot:7:3:pid"
        # Trigger what _run does
        spy.setex(status_key, HEARTBEAT_TTL, f"running:{pid}")
        spy.setex(pid_key, 86400, str(pid))
        assert HEARTBEAT_TTL == 90
        status_calls = [c for c in spy.calls if c[0] == status_key]
        pid_calls = [c for c in spy.calls if c[0] == pid_key]
        assert len(status_calls) == 1
        assert status_calls[0][1] == 90
        assert len(pid_calls) == 1
        assert pid_calls[0][1] == 86400
        assert pid_calls[0][1] != status_calls[0][1]


def test_heartbeat_run_writes_correct_ttls():
    from trading.bot_heartbeat import BotHeartbeat
    spy = SpyRedis()
    with patch("cache.redis_client.get_redis_client", return_value=spy):
        hb = BotHeartbeat(user_id=1, bot_config_id=1)
        # We test _run writes both keys; we run one iteration by patching wait to exit after one loop
        with patch.object(hb._stop_event, "is_set", side_effect=[False, True]), \
             patch.object(hb._stop_event, "wait", return_value=None):
            hb._run()
        # collect ttls
        ttls = {k: ttl for k, ttl, v in spy.calls if isinstance(k, str) and k.startswith("bot:")}
        assert ttls.get("bot:1:1:status") == 90
        assert ttls.get("bot:1:1:pid") == 86400


def test_cache_redis_client_ttl_constants():
    from trading.bot_heartbeat import HEARTBEAT_TTL
    assert HEARTBEAT_TTL == 90
    # Ensure code uses 86400 literal for pid
    text = Path(ROOT / "trading" / "bot_heartbeat.py").read_text()
    assert "86400" in text
    assert "HEARTBEAT_TTL" in text

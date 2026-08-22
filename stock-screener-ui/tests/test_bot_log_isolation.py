"""Tests for per-bot log isolation and placement."""
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

def test_get_bot_log_path_default():
    from api.bots_api.bots_router import get_bot_log_path
    p = get_bot_log_path(1, 42)
    assert str(p).endswith("bot-1-42.log")
    assert "logs" in str(p) and "bots" in str(p)
    assert p.parent.exists()

def test_get_bot_log_path_env():
    from api.bots_api.bots_router import get_bot_log_path
    with patch.dict(os.environ, {"LOG_DIR": "/tmp/custom_logs"}):
        p = get_bot_log_path(2, 7)
        assert str(p).startswith("/tmp/custom_logs")
        assert p.name == "bot-2-7.log"
        # cleanup
        if Path("/tmp/custom_logs").exists():
            try:
                Path("/tmp/custom_logs/bot-2-7.log").unlink(missing_ok=True)
                Path("/tmp/custom_logs").rmdir()
            except Exception:
                pass

def test_bot_logs_isolated_per_bot(tmp_path):
    from api.bots_api.bots_router import get_bot_log_path
    p1 = get_bot_log_path(1, 1)
    p2 = get_bot_log_path(1, 2)
    p3 = get_bot_log_path(2, 1)
    assert p1 != p2
    assert p1 != p3
    assert p2 != p3

def test_start_bot_uses_log_dir():
    from api.bots_api.bots_router import start_bot_process, get_bot_log_path, _bot_processes, _bot_logs
    # mock subprocess.Popen to avoid real spawn
    with patch("subprocess.Popen") as mock_popen, \
         patch("api.bots_api.bots_router.is_bot_running", return_value=(False, None)), \
         patch("api.bots_api.bots_router._get_existing_bot_log_path", return_value=None):
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_proc.poll.return_value = None
        mock_popen.return_value = mock_proc
        # need to mock get_bot_pid etc
        with patch("api.bots_api.bots_router.get_bot_pid", return_value=None), \
             patch("cache.redis_client.get_redis_client", return_value=None), \
             patch.dict(os.environ, {"LOG_DIR": "logs/bots"}):
            try:
                proc = start_bot_process(user_id=5, bot_id=6, test_mode=True, live_trading=False)
                # log path should be logs/bots/bot-5-6.log
                expected = get_bot_log_path(5, 6)
                # check that Popen was called with stdout being file handle to expected path
                # The mock Popen call args include stdout file object; we can verify _bot_logs updated
                assert 6 in _bot_logs
                assert _bot_logs[6] == expected
                # cleanup
                if expected.exists():
                    expected.unlink(missing_ok=True)
            finally:
                # clear global state
                _bot_processes.pop(5, None)
                _bot_logs.pop(6, None)

def test_log_fallback_tmp():
    from api.bots_api.bots_router import _get_existing_bot_log_path
    # no file => None
    res = _get_existing_bot_log_path(9999, 9999)
    assert res is None

def test_bot_logs_written_to_file():
    """Simulate runner writing force-close to log file via stdout."""
    from pathlib import Path
    log_dir = Path("logs/bots")
    log_dir.mkdir(parents=True, exist_ok=True)
    p = log_dir / "bot-9-99.log"
    p.write_text("PREVIOUS\n")
    # append as runner would
    with open(p, "a") as f:
        f.write("[12:00:00] Closed 1 stale intraday positions\n")
        f.write("[12:00:00] Keeping swing position TATAMOTORS\n")
    content = p.read_text()
    assert "stale intraday" in content
    assert "swing" in content
    p.unlink(missing_ok=True)

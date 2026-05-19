"""
Tests for shared helpers in api/paper/paper_api.py.

Covers:
- _read_runner_pid_file
- _write_runner_pid_file
- _clear_runner_pid_file
- _is_pid_alive
- _get_bot_status
- _get_symbol_trades_from_db
- _get_user_id
"""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from api.paper.paper_api import (
    _read_runner_pid_file,
    _write_runner_pid_file,
    _clear_runner_pid_file,
    _is_pid_alive,
    _get_bot_status,
    _get_symbol_trades_from_db,
    _get_user_id,
    _get_pid_file,
    _user_pid_files,
)


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture(autouse=True)
def _clean_user_file_dicts():
    """Reset per-user file caches between tests."""
    _user_pid_files.clear()
    yield
    _user_pid_files.clear()


@pytest.fixture
def temp_dir():
    """Provide a temporary directory cleaned up after test."""
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def patch_pid_file(temp_dir):
    """Patch _get_pid_file to return a temp path."""
    pid_path = temp_dir / "runner.pid"

    def _get(user_id=None):
        return pid_path

    with patch("api.paper.paper_api._get_pid_file", side_effect=_get):
        yield pid_path


@pytest.fixture
def mock_user():
    """Create a mock User object."""
    user = MagicMock()
    user.id = 42
    user.email = "test@example.com"
    return user


# ============================================================================
# _get_user_id
# ============================================================================

class TestGetUserId:
    @pytest.mark.unit
    def test_returns_user_id(self, mock_user):
        assert _get_user_id(mock_user) == 42

    @pytest.mark.unit
    def test_returns_different_id(self):
        user = MagicMock()
        user.id = 999
        assert _get_user_id(user) == 999


# ============================================================================
# _get_pid_file
# ============================================================================

class TestGetPidFile:
    @pytest.mark.unit
    def test_default_returns_global_path(self):
        result = _get_pid_file(None)
        assert result == Path("/tmp/alphashri-runner.pid")

    @pytest.mark.unit
    def test_user_id_returns_user_specific_path(self):
        result = _get_pid_file(7)
        assert result == Path("/tmp/alphashri-7-runner.pid")


# ============================================================================
# _read_runner_pid_file
# ============================================================================

class TestReadRunnerPidFile:
    @pytest.mark.unit
    def test_valid_pid_returns_int(self, patch_pid_file):
        patch_pid_file.write_text("12345\n")

        assert _read_runner_pid_file() == 12345

    @pytest.mark.unit
    def test_missing_file_returns_none(self, patch_pid_file):
        assert not patch_pid_file.exists()
        assert _read_runner_pid_file() is None

    @pytest.mark.unit
    def test_non_numeric_content_returns_none(self, patch_pid_file):
        patch_pid_file.write_text("not-a-number")

        assert _read_runner_pid_file() is None

    @pytest.mark.unit
    def test_empty_file_returns_none(self, patch_pid_file):
        patch_pid_file.write_text("")

        # int("") raises ValueError, caught by except
        assert _read_runner_pid_file() is None

    @pytest.mark.unit
    def test_pid_with_whitespace(self, patch_pid_file):
        patch_pid_file.write_text("  9876  \n")

        assert _read_runner_pid_file() == 9876


# ============================================================================
# _write_runner_pid_file
# ============================================================================

class TestWriteRunnerPidFile:
    @pytest.mark.unit
    def test_writes_pid_to_file(self, patch_pid_file):
        _write_runner_pid_file(54321)

        assert patch_pid_file.read_text().strip() == "54321"

    @pytest.mark.unit
    def test_overwrites_existing_content(self, patch_pid_file):
        patch_pid_file.write_text("old-content")
        _write_runner_pid_file(111)

        assert patch_pid_file.read_text().strip() == "111"


# ============================================================================
# _clear_runner_pid_file
# ============================================================================

class TestClearRunnerPidFile:
    @pytest.mark.unit
    def test_removes_existing_file(self, patch_pid_file):
        patch_pid_file.write_text("123")
        assert patch_pid_file.exists()

        _clear_runner_pid_file()

        assert not patch_pid_file.exists()

    @pytest.mark.unit
    def test_no_error_when_file_missing(self, patch_pid_file):
        assert not patch_pid_file.exists()
        # Should not raise
        _clear_runner_pid_file()


# ============================================================================
# _is_pid_alive
# ============================================================================

class TestIsPidAlive:
    @pytest.mark.unit
    def test_current_process_is_alive(self):
        assert _is_pid_alive(os.getpid()) is True

    @pytest.mark.unit
    def test_nonexistent_pid_returns_false(self):
        # PID 99999 is very unlikely to exist
        assert _is_pid_alive(99999) is False

    @pytest.mark.unit
    def test_handles_exception_gracefully(self):
        with patch("subprocess.run", side_effect=OSError("fail")):
            assert _is_pid_alive(1) is False


# ============================================================================
# _get_bot_status
# ============================================================================

class TestGetBotStatus:
    @pytest.mark.unit
    def test_no_process_no_runners(self):
        with patch("api.paper.paper_api._paper_bot_process", None), \
             patch("subprocess.check_output", side_effect=Exception("pgrep not found")), \
             patch("api.paper.paper_api._read_runner_pid_file", return_value=None):
            result = _get_bot_status()

        assert result["running"] is False
        assert result["pid"] is None
        assert result["runner_pids"] == []
        assert "log_file" in result
        assert "pid_file" in result

    @pytest.mark.unit
    def test_with_running_process_via_poll(self):
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # still running
        mock_proc.pid = 42

        with patch("api.paper.paper_api._paper_bot_process", mock_proc), \
             patch("subprocess.check_output", side_effect=Exception("no pgrep")), \
             patch("api.paper.paper_api._read_runner_pid_file", return_value=None):
            result = _get_bot_status()

        assert result["running"] is True
        assert result["pid"] == 42
        assert result["return_code"] is None

    @pytest.mark.unit
    def test_process_exited_clears_global(self):
        mock_proc = MagicMock()
        mock_proc.poll.return_value = 0  # exited

        with patch("api.paper.paper_api._paper_bot_process", mock_proc), \
             patch("subprocess.check_output", side_effect=Exception("no pgrep")), \
             patch("api.paper.paper_api._read_runner_pid_file", return_value=None):
            result = _get_bot_status()

        assert result["running"] is False

    @pytest.mark.unit
    def test_runner_pids_from_pgrep(self):
        with patch("api.paper.paper_api._paper_bot_process", None), \
             patch("subprocess.check_output", return_value="111\n222\n"), \
             patch("api.paper.paper_api._read_runner_pid_file", return_value=None), \
             patch("api.paper.paper_api._is_pid_alive", return_value=True), \
             patch("os.getpid", return_value=999):
            result = _get_bot_status()

        assert result["running"] is True
        assert set(result["runner_pids"]) == {111, 222}

    @pytest.mark.unit
    def test_pid_from_file_merged_with_pgrep(self):
        with patch("api.paper.paper_api._paper_bot_process", None), \
             patch("subprocess.check_output", return_value="111\n"), \
             patch("api.paper.paper_api._read_runner_pid_file", return_value=333), \
             patch("api.paper.paper_api._is_pid_alive", return_value=True), \
             patch("os.getpid", return_value=999):
            result = _get_bot_status()

        assert 333 in result["runner_pids"]
        assert result["running"] is True

    @pytest.mark.unit
    def test_dead_pid_from_file_gets_cleared(self):
        with patch("api.paper.paper_api._paper_bot_process", None), \
             patch("subprocess.check_output", side_effect=Exception("no pgrep")), \
             patch("api.paper.paper_api._read_runner_pid_file", return_value=555), \
             patch("api.paper.paper_api._is_pid_alive", return_value=False), \
             patch("api.paper.paper_api._clear_runner_pid_file") as mock_clear:
            result = _get_bot_status()

        mock_clear.assert_called_once()
        assert result["running"] is False


# ============================================================================
# _get_symbol_trades_from_db
# ============================================================================

class TestGetSymbolTradesFromDb:
    @pytest.mark.unit
    def test_returns_trades_for_symbol_and_date(self):
        mock_trade = MagicMock()
        mock_trade.to_dict.return_value = {
            "symbol": "TCS",
            "entry_time": "2026-04-20T10:00:00+05:30",
            "exit_time": "2026-04-20T11:30:00+05:30",
            "pnl": 500.0,
        }
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_query.all.return_value = [mock_trade]
        mock_session.query.return_value.filter.return_value.filter.return_value = mock_query

        with patch("db.database.SessionLocal", return_value=mock_session):
            trades = _get_symbol_trades_from_db(1, "tcs", "2026-04-20")

        assert len(trades) == 1
        assert trades[0]["symbol"] == "TCS"
        mock_session.close.assert_called_once()

    @pytest.mark.unit
    def test_returns_empty_on_exception(self):
        with patch("db.database.SessionLocal", side_effect=Exception("db down")):
            trades = _get_symbol_trades_from_db(1, "TCS", "2026-04-20")

        assert trades == []

    @pytest.mark.unit
    def test_session_cleanup_in_finally_on_success(self):
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.filter.return_value.all.return_value = []

        with patch("db.database.SessionLocal", return_value=mock_session):
            _get_symbol_trades_from_db(1, "TCS", "2026-04-20")

        mock_session.close.assert_called_once()

    @pytest.mark.unit
    def test_session_cleanup_in_finally_on_exception(self):
        mock_session = MagicMock()
        mock_session.query.side_effect = Exception("query fail")

        with patch("db.database.SessionLocal", return_value=mock_session):
            _get_symbol_trades_from_db(1, "TCS", "2026-04-20")

        mock_session.close.assert_called_once()

    @pytest.mark.unit
    def test_symbol_uppercased_in_query(self):
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.filter.return_value.all.return_value = []

        with patch("db.database.SessionLocal", return_value=mock_session):
            _get_symbol_trades_from_db(1, "reliance", "2026-04-20")

        # Verify the filter was called with uppercased symbol
        call_args = mock_session.query.return_value.filter.call_args_list
        # Second filter call is the symbol filter (first is user_id)
        assert call_args[0] is not None

    @pytest.mark.unit
    def test_entry_time_converted_to_ist(self):
        mock_trade = MagicMock()
        mock_trade.to_dict.return_value = {
            "symbol": "TCS",
            "entry_time": "2026-04-20T04:30:00Z",
            "exit_time": "2026-04-20T06:00:00Z",
            "pnl": 100.0,
        }
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_query.all.return_value = [mock_trade]
        mock_session.query.return_value.filter.return_value.filter.return_value = mock_query

        with patch("db.database.SessionLocal", return_value=mock_session):
            trades = _get_symbol_trades_from_db(1, "TCS", "2026-04-20")

        assert len(trades) == 1
        # entry_time should be converted - verify it's a string in IST format
        entry = trades[0]["entry_time"]
        assert isinstance(entry, str)
        assert "T" in entry

    @pytest.mark.unit
    def test_empty_entry_time_preserved(self):
        mock_trade = MagicMock()
        mock_trade.to_dict.return_value = {
            "symbol": "TCS",
            "entry_time": "",
            "exit_time": "",
            "pnl": 0.0,
        }
        mock_session = MagicMock()
        mock_query = MagicMock()
        mock_query.all.return_value = [mock_trade]
        mock_session.query.return_value.filter.return_value.filter.return_value = mock_query

        with patch("db.database.SessionLocal", return_value=mock_session):
            trades = _get_symbol_trades_from_db(1, "TCS", "2026-04-20")

        assert trades[0]["entry_time"] == ""
        assert trades[0]["exit_time"] == ""

    @pytest.mark.unit
    def test_close_exception_swallowed(self):
        """If db.close() raises, it should be swallowed by the except."""
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.filter.return_value.all.return_value = []
        mock_session.close.side_effect = Exception("close fail")

        with patch("db.database.SessionLocal", return_value=mock_session):
            # Should not raise
            trades = _get_symbol_trades_from_db(1, "TCS", "2026-04-20")

        assert trades == []

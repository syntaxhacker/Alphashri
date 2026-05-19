"""Unit tests for telegram_notifier module."""
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch
from collections import deque

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import trading.telegram_notifier as tgn
from config import IST


# Clear global state before and after each test
@pytest.fixture(autouse=True)
def reset_telegram_state(monkeypatch):
    """Reset module-level state between tests."""
    # Replace the global deques and dicts with fresh ones
    new_send_times = deque()
    new_cooldown_keys = {}
    monkeypatch.setattr(tgn, "_send_times", new_send_times)
    monkeypatch.setattr(tgn, "_cooldown_keys", new_cooldown_keys)
    # Also reset THREAD_POOL to avoid submitting tasks
    # We'll patch submit later in specific tests
    yield
    # Post-test cleanup is handled by monkeypatch automatically


def test_is_available_when_disabled(monkeypatch):
    monkeypatch.setattr(tgn, "_ENABLED", False)
    monkeypatch.setattr(tgn, "_BOT_TOKEN", "dummy")
    monkeypatch.setattr(tgn, "_CHAT_ID", "123")
    assert tgn._is_available() is False


def test_is_available_when_no_token(monkeypatch):
    monkeypatch.setattr(tgn, "_ENABLED", True)
    monkeypatch.setattr(tgn, "_BOT_TOKEN", "")
    monkeypatch.setattr(tgn, "_CHAT_ID", "123")
    assert tgn._is_available() is False


def test_is_available_when_no_chat_id(monkeypatch):
    monkeypatch.setattr(tgn, "_ENABLED", True)
    monkeypatch.setattr(tgn, "_BOT_TOKEN", "token")
    monkeypatch.setattr(tgn, "_CHAT_ID", "")
    assert tgn._is_available() is False


def test_is_available_success(monkeypatch):
    monkeypatch.setattr(tgn, "_ENABLED", True)
    monkeypatch.setattr(tgn, "_BOT_TOKEN", "token")
    monkeypatch.setattr(tgn, "_CHAT_ID", "123")
    assert tgn._is_available() is True


class TestRateLimit:
    """Tests for _check_rate_limit."""

    def test_allows_up_to_limit(self):
        # Default _MAX_MSGS_PER_MINUTE = 25
        # We'll call _check_rate_limit 25 times, should all return True
        # Ensure _send_times is empty (from fixture)
        for _ in range(25):
            assert tgn._check_rate_limit() is True
        # 26th should be False
        assert tgn._check_rate_limit() is False

    def test_clears_old_entries(self, monkeypatch):
        # Simulate some old entries outside the 60s window
        now = time.time()
        # Manually add entries older than 60s
        old_time = now - 61
        tgn._send_times.append(old_time)
        tgn._send_times.append(old_time)
        # Next call to _check_rate_limit should pop them because they're older than 60s
        assert tgn._check_rate_limit() is True
        assert len(tgn._send_times) == 1  # only the new one
        assert tgn._send_times[0] > now - 1  # recent

    def test_race_condition_safety(self):
        """Test that the lock protects concurrent modifications (basic check)."""
        # Not a true concurrency test but verifies lock exists
        assert tgn._send_lock is not None


class TestCooldown:
    """Tests for _check_cooldown."""

    def test_first_call_allowed(self):
        assert tgn._check_cooldown("test_key") is True
        assert "test_key" in tgn._cooldown_keys

    def test_second_call_within_cooldown_blocked(self):
        tgn._check_cooldown("test_key")
        assert tgn._check_cooldown("test_key") is False

    def test_different_keys_allowed(self):
        assert tgn._check_cooldown("key1") is True
        assert tgn._check_cooldown("key2") is True

    def test_after_cooldown_period_allowed(self, monkeypatch):
        """Test that after 60s, cooldown resets."""
        tgn._check_cooldown("test_key")
        # Manipulate the stored time
        monkeypatch.setattr(tgn, "_cooldown_keys", {"test_key": time.time() - 61})
        assert tgn._check_cooldown("test_key") is True

    def test_cooldown_key_none_skipped(self):
        """If cooldown_key is None, cooldown check is skipped."""
        # _check_cooldown is not called if key is None in _send_message, but test the function itself:
        # The function doesn't treat None specially; it would store None as key. But _send_message only calls it if key provided.
        pass


class TestSendMessage:
    """Tests for _send_message internal function."""

    @patch('trading.telegram_notifier.requests')
    def test_sends_message_successfully(self, mock_requests, monkeypatch):
        """Test successful send builds correct payload."""
        # Make _is_available return True
        monkeypatch.setattr(tgn, "_is_available", lambda: True)
        # Mock thread pool to run inline
        mock_pool = MagicMock()
        submitted = []
        def capture_submit(func):
            submitted.append(func)
            # execute immediately to test logic inside _do_send
            func()
            return MagicMock()
        mock_pool.submit.side_effect = capture_submit
        monkeypatch.setattr(tgn, "_THREAD_POOL", mock_pool)

        # Mock requests.post to return success
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_requests.post.return_value = mock_resp

        tgn._send_message("Test message", cooldown_key="test")

        # Should have submitted one function
        assert len(submitted) == 1
        # The function would have called requests.post
        mock_requests.post.assert_called_once()
        args, kwargs = mock_requests.post.call_args
        assert args[0] == tgn._API_URL
        assert kwargs['json']['chat_id'] == tgn._CHAT_ID
        assert kwargs['json']['text'].startswith("Test message")
        assert kwargs['json']['parse_mode'] == "Markdown"

    @patch('trading.telegram_notifier.requests')
    def test_respects_rate_limit(self, mock_requests, monkeypatch, capsys):
        """Test that if rate limit exceeded, message is skipped."""
        monkeypatch.setattr(tgn, "_is_available", lambda: True)
        # Fill rate limit
        monkeypatch.setattr(tgn, "_send_times", deque([time.time()] * 25))
        tgn._send_message("Test")
        # Should not call requests.post
        mock_requests.post.assert_not_called()
        captured = capsys.readouterr()
        assert "Telegram: skipped (rate limit)" in captured.out or "Telegram: skipped (rate limit)" in captured.err

    @patch('trading.telegram_notifier.requests')
    def test_respects_cooldown(self, mock_requests, monkeypatch, capsys):
        """Test that if cooldown active, message is skipped."""
        monkeypatch.setattr(tgn, "_is_available", lambda: True)
        # Set cooldown for key
        monkeypatch.setattr(tgn, "_cooldown_keys", {"test": time.time()})
        tgn._send_message("Test", cooldown_key="test")
        mock_requests.post.assert_not_called()
        captured = capsys.readouterr()
        assert "Telegram: skipped (cooldown)" in captured.out or "Telegram: skipped (cooldown)" in captured.err

    @patch('trading.telegram_notifier.requests')
    def test_origin_tag_included(self, mock_requests, monkeypatch):
        """Test that origin tag is appended to message."""
        monkeypatch.setattr(tgn, "_is_available", lambda: True)
        mock_pool = MagicMock()
        submitted = []
        def capture_submit(func):
            submitted.append(func)
            func()
        mock_pool.submit.side_effect = capture_submit
        monkeypatch.setattr(tgn, "_THREAD_POOL", mock_pool)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_requests.post.return_value = mock_resp

        tgn._send_message("Test message")
        # Check that text passed to post includes origin tag
        call_kwargs = mock_requests.post.call_args[1]
        text_sent = call_kwargs['json']['text']
        assert text_sent.endswith(tgn._ORIGIN_TAG) or tgn._ORIGIN_TAG in text_sent

    @patch('trading.telegram_notifier.requests')
    def test_request_exception_handled(self, mock_requests, monkeypatch, capsys):
        """Test that exceptions in sending are caught and logged."""
        monkeypatch.setattr(tgn, "_is_available", lambda: True)
        mock_pool = MagicMock()
        def run_func(func):
            # Simulate network error in requests.post
            mock_requests.post.side_effect = Exception("Network error")
            func()
        mock_pool.submit.side_effect = run_func
        monkeypatch.setattr(tgn, "_THREAD_POOL", mock_pool)
        # Should not raise
        tgn._send_message("Test")
        captured = capsys.readouterr()
        assert "Telegram error" in captured.out or "Telegram error" in captured.err


class TestPublicSendFunctions:
    """Tests for the public send_* wrapper functions."""

    @patch.object(tgn, "_send_message")
    def test_send_trade_entry(self, mock_send):
        """Test send_trade_entry formats message and calls _send_message."""
        tgn.send_trade_entry(
            bot_name="TestBot",
            strategy_name="ORB",
            symbol="RELIANCE",
            side="BUY",
            price=2500.0,
            quantity=10,
            sl=2450.0,
            tp=2550.0,
        )
        mock_send.assert_called_once()
        msg = mock_send.call_args[0][0]
        assert "🟢" in msg
        assert "*TRADE ENTRY* — TestBot" in msg
        assert "*RELIANCE*" in msg
        assert "LONG" in msg
        assert "Entry: ₹2500.00 × 10 = ₹25,000" in msg
        assert "SL: ₹2450.00" in msg
        assert "TP: ₹2550.00" in msg
        # Check cooldown key
        assert mock_send.call_args[1]['cooldown_key'] == "entry:RELIANCE"

    @patch.object(tgn, "_send_message")
    def test_send_trade_entry_short(self, mock_send):
        """Test short side entry."""
        tgn.send_trade_entry(
            bot_name="TestBot",
            strategy_name="ORB",
            symbol="TCS",
            side="SELL",
            price=3500.0,
            quantity=5,
            sl=3550.0,
            tp=3450.0,
        )
        msg = mock_send.call_args[0][0]
        assert "🔴" in msg
        assert "SHORT" in msg

    @patch.object(tgn, "_send_message")
    def test_send_trade_exit_profit(self, mock_send):
        """Test exit message with profit."""
        entry_time = datetime.now(IST) - timedelta(hours=1)
        tgn.send_trade_exit(
            bot_name="TestBot",
            strategy_name="ORB",
            symbol="RELIANCE",
            side="BUY",
            entry_price=2500.0,
            exit_price=2600.0,
            quantity=10,
            pnl=1000.0,
            pnl_pct=4.0,
            exit_reason="TP",
            entry_time=entry_time,
            costs=50.0,
            net_pnl=950.0,
        )
        msg = mock_send.call_args[0][0]
        assert "💚" in msg
        assert "*TRADE EXIT* — TestBot" in msg
        assert "P&L: ₹+950.00 (+4.00%)" in msg
        assert "Gross: ₹+1,000.00 | Costs: ₹+50.00" in msg
        assert "Reason: *TP*" in msg
        assert "Hold:" in msg
        assert mock_send.call_args[1]['cooldown_key'] == "exit:RELIANCE"

    @patch.object(tgn, "_send_message")
    def test_send_trade_exit_loss(self, mock_send):
        """Test exit message with loss."""
        entry_time = datetime.now(IST) - timedelta(minutes=30)
        tgn.send_trade_exit(
            bot_name="TestBot",
            strategy_name="ORB",
            symbol="TCS",
            side="BUY",
            entry_price=3500.0,
            exit_price=3400.0,
            quantity=5,
            pnl=-500.0,
            pnl_pct=-2.86,
            exit_reason="SL",
            entry_time=entry_time,
            costs=25.0,
            net_pnl=-525.0,
        )
        msg = mock_send.call_args[0][0]
        assert "❌" in msg
        assert "P&L: ₹-525.00 (-2.86%)" in msg
        assert "Gross: ₹-500.00 | Costs: ₹+25.00" in msg

    @patch.object(tgn, "_send_message")
    def test_send_bot_status_started(self, mock_send):
        tgn.send_bot_status("TestBot", "started", "All systems go")
        msg = mock_send.call_args[0][0]
        assert "✅" in msg
        assert "*Bot Started* — TestBot" in msg
        assert "All systems go" in msg
        assert mock_send.call_args[1]['cooldown_key'] == "bot_status:TestBot"

    @patch.object(tgn, "_send_message")
    def test_send_bot_status_stopped(self, mock_send):
        tgn.send_bot_status("TestBot", "stopped")
        msg = mock_send.call_args[0][0]
        assert "❌" in msg
        assert "*Bot Stopped*" in msg

    @patch.object(tgn, "_send_message")
    def test_send_daily_summary_profit(self, mock_send):
        best = {"symbol": "RELIANCE", "pnl": 5.2}
        worst = {"symbol": "TCS", "pnl": -1.8}
        positions = [
            {"symbol": "RELIANCE", "unrealized_pnl": 100},
            {"symbol": "TCS", "unrealized_pnl": -50},
        ]
        tgn.send_daily_summary(
            bot_name="TestBot",
            total_pnl=25000,
            win_count=15,
            loss_count=5,
            best_trade=best,
            worst_trade=worst,
            open_positions=positions,
        )
        msg = mock_send.call_args[0][0]
        assert "📊 *Daily Summary* — TestBot" in msg
        # Numbers include sign formatting
        assert "Net P&L: ₹+25,000" in msg
        assert "Wins: 15 | Losses: 5" in msg
        assert "Win Rate: 75%" in msg
        assert "🏆 Best: RELIANCE (+5.20%)" in msg
        assert "💀 Worst: TCS (-1.80%)" in msg
        assert "Open Positions (2)" in msg
        assert "RELIANCE" in msg and "TCS" in msg
        assert mock_send.call_args[1]['cooldown_key'] == "daily_summary:TestBot"

    @patch.object(tgn, "_send_message")
    def test_send_daily_summary_loss(self, mock_send):
        tgn.send_daily_summary(bot_name="TestBot", total_pnl=-5000, win_count=3, loss_count=7)
        msg = mock_send.call_args[0][0]
        assert "📉" in msg  # loss emoji
        assert "Net P&L: ₹-5,000" in msg

    @patch.object(tgn, "_send_message")
    def test_send_risk_alert(self, mock_send):
        tgn.send_risk_alert(
            bot_name="TestBot",
            alert_type="daily_loss_approaching",
            current_value=25000,
            threshold=30000,
            message="Daily loss limit nearing",
        )
        msg = mock_send.call_args[0][0]
        assert "⚠️ Daily Loss Approaching" in msg
        assert "*TestBot*" in msg
        assert "Daily loss limit nearing" in msg
        assert "Current: ₹25,000 / Limit: ₹30,000" in msg
        assert mock_send.call_args[1]['cooldown_key'] == "risk:TestBot:daily_loss_approaching"

    @patch.object(tgn, "_send_message")
    def test_send_signal_rejected(self, mock_send):
        tgn.send_signal_rejected(
            bot_name="TestBot",
            strategy_name="ORB",
            symbol="RELIANCE",
            signal_type="LONG_ENTRY",
            reason="Insufficient capital",
        )
        msg = mock_send.call_args[0][0]
        assert "🚫 *Signal Rejected* — TestBot" in msg
        assert "*RELIANCE*" in msg
        assert "Reason: Insufficient capital" in msg
        assert mock_send.call_args[1]['cooldown_key'] == "rejected:RELIANCE"

    @patch.object(tgn, "_send_message")
    def test_send_positions_snapshot(self, mock_send):
        portfolio_status = {
            "initial_capital": 1000000,
            "cash": 800000,
            "daily_pnl": 5000,
            "total_pnl": 25000,
        }
        positions = [
            {
                "symbol": "RELIANCE",
                "side": "BUY",
                "quantity": 10,
                "entry_price": 2500,
                "current_price": 2550,
                "unrealized_pnl": 500,
            },
            {
                "symbol": "TCS",
                "side": "SELL",
                "quantity": 5,
                "entry_price": 3500,
                "current_price": 3450,
                "unrealized_pnl": 250,
            },
        ]
        tgn.send_positions_snapshot("TestBot", positions, portfolio_status)
        msg = mock_send.call_args[0][0]
        assert "📋 *Positions Snapshot* — TestBot" in msg
        assert "Capital: ₹1,000,000" in msg
        assert "Cash: ₹800,000" in msg
        assert "Daily P&L: ₹+5,000" in msg
        assert "Total P&L: ₹+25,000" in msg
        assert "*Open (2):*" in msg
        assert "RELIANCE" in msg and "TCS" in msg
        assert mock_send.call_args[1]['cooldown_key'] == "snapshot:TestBot"

    @patch.object(tgn, "_send_message")
    def test_send_positions_snapshot_empty(self, mock_send):
        tgn.send_positions_snapshot("TestBot", [], {})
        msg = mock_send.call_args[0][0]
        assert "No open positions." in msg

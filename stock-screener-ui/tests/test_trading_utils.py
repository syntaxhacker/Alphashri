"""
Tests for trading/utils.py - unified is_market_open with holiday support.
"""

import sys
from datetime import datetime, date
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from trading.timezone import IST


class TestIsMarketOpen:
    """Tests for is_market_open()."""

    @patch("trading.utils._get_cache")
    def test_returns_false_on_saturday(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 17, 10, 0, tzinfo=IST)  # Saturday
        from trading.utils import is_market_open
        assert is_market_open(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_false_on_sunday(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 18, 10, 0, tzinfo=IST)  # Sunday
        from trading.utils import is_market_open
        assert is_market_open(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_false_on_trading_holiday(self, mock_cache):
        mock_cache.return_value = {"trading": {date(2026, 1, 26)}, "clearing": set()}
        dt = datetime(2026, 1, 26, 10, 0, tzinfo=IST)  # Monday, Republic Day
        from trading.utils import is_market_open
        assert is_market_open(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_true_during_market_hours(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 10, 30, tzinfo=IST)  # Tuesday 10:30
        from trading.utils import is_market_open
        assert is_market_open(dt) is True

    @patch("trading.utils._get_cache")
    def test_returns_false_before_open(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 9, 0, tzinfo=IST)  # 09:00 - before 09:15
        from trading.utils import is_market_open
        assert is_market_open(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_false_after_close(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 15, 31, tzinfo=IST)  # 15:31 - after 15:30
        from trading.utils import is_market_open
        assert is_market_open(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_true_at_open_time(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 9, 15, tzinfo=IST)  # Exactly 09:15
        from trading.utils import is_market_open
        assert is_market_open(dt) is True

    @patch("trading.utils._get_cache")
    def test_returns_true_at_close_time(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 15, 30, tzinfo=IST)  # Exactly 15:30
        from trading.utils import is_market_open
        assert is_market_open(dt) is True

    @patch("trading.utils._get_cache")
    def test_clearing_holiday_does_not_affect_market(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": {date(2026, 2, 19)}}
        dt = datetime(2026, 2, 19, 10, 30, tzinfo=IST)  # Thursday 10:30, clearing holiday
        from trading.utils import is_market_open
        assert is_market_open(dt) is True


class TestIsTradingHours:
    """Tests for is_trading_hours()."""

    @patch("trading.utils._get_cache")
    def test_returns_true_during_trading_hours(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 10, 0, tzinfo=IST)
        from trading.utils import is_trading_hours
        assert is_trading_hours(dt) is True

    @patch("trading.utils._get_cache")
    def test_returns_false_before_or_end(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 20, 9, 30, tzinfo=IST)  # Before 09:45
        from trading.utils import is_trading_hours
        assert is_trading_hours(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_false_on_weekend(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        dt = datetime(2026, 1, 17, 10, 0, tzinfo=IST)  # Saturday
        from trading.utils import is_trading_hours
        assert is_trading_hours(dt) is False

    @patch("trading.utils._get_cache")
    def test_returns_false_on_trading_holiday(self, mock_cache):
        mock_cache.return_value = {"trading": {date(2026, 1, 26)}, "clearing": set()}
        dt = datetime(2026, 1, 26, 10, 0, tzinfo=IST)
        from trading.utils import is_trading_hours
        assert is_trading_hours(dt) is False


class TestIsForceExitTime:
    """Tests for is_force_exit_time()."""

    def test_returns_true_at_1530(self):
        from trading.utils import is_force_exit_time
        assert is_force_exit_time(datetime(2026, 1, 20, 15, 30)) is True

    def test_returns_true_after_1530(self):
        from trading.utils import is_force_exit_time
        assert is_force_exit_time(datetime(2026, 1, 20, 16, 0)) is True

    def test_returns_false_before_1530(self):
        from trading.utils import is_force_exit_time
        assert is_force_exit_time(datetime(2026, 1, 20, 15, 29)) is False


class TestIsTradingHoliday:
    """Tests for is_trading_holiday()."""

    @patch("trading.utils._get_cache")
    def test_returns_true_for_trading_holiday(self, mock_cache):
        mock_cache.return_value = {"trading": {date(2026, 1, 26)}, "clearing": set()}
        from trading.utils import is_trading_holiday
        assert is_trading_holiday(datetime(2026, 1, 26)) is True

    @patch("trading.utils._get_cache")
    def test_returns_false_for_clearing_holiday(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": {date(2026, 2, 19)}}
        from trading.utils import is_trading_holiday
        assert is_trading_holiday(datetime(2026, 2, 19)) is False

    @patch("trading.utils._get_cache")
    def test_returns_false_for_normal_day(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": set()}
        from trading.utils import is_trading_holiday
        assert is_trading_holiday(datetime(2026, 1, 20)) is False


class TestIsClearingHoliday:
    """Tests for is_clearing_holiday()."""

    @patch("trading.utils._get_cache")
    def test_returns_true_for_clearing_holiday(self, mock_cache):
        mock_cache.return_value = {"trading": set(), "clearing": {date(2026, 2, 19)}}
        from trading.utils import is_clearing_holiday
        assert is_clearing_holiday(datetime(2026, 2, 19)) is True

    @patch("trading.utils._get_cache")
    def test_returns_false_for_trading_holiday(self, mock_cache):
        mock_cache.return_value = {"trading": {date(2026, 1, 26)}, "clearing": set()}
        from trading.utils import is_clearing_holiday
        assert is_clearing_holiday(datetime(2026, 1, 26)) is False

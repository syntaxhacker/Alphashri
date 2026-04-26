"""Unit tests for portfolio_state module."""
import sys
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from trading.portfolio.portfolio_state import restore_state, restore_position, reset_daily
from trading.portfolio.portfolio_models import SharedPosition, OrderSide, StrategyAllocation
import config


class FakePortfolio:
    """A simple fake portfolio object for testing state restoration."""
    def __init__(self):
        self.cash = 1000000.0
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.day_start = date.today()
        self.positions = {}
        self.strategy_allocations = {}
        self.initial_capital = 1000000.0


@pytest.fixture
def portfolio():
    return FakePortfolio()


class TestRestoreState:
    """Tests for restore_state function."""

    def test_restores_all_fields_from_state(self, portfolio):
        state = {
            'cash': 800000.0,
            'daily_pnl': 5000.0,
            'daily_trades': 10,
        }
        restore_state(portfolio, state)
        assert portfolio.cash == 800000.0
        assert portfolio.daily_pnl == 5000.0
        assert portfolio.daily_trades == 10

    def test_uses_defaults_when_missing(self, portfolio):
        state = {}  # empty
        restore_state(portfolio, state)
        # Should default to portfolio's initial_capital for cash
        assert portfolio.cash == portfolio.initial_capital
        assert portfolio.daily_pnl == 0.0
        assert portfolio.daily_trades == 0

    def test_partial_state_update(self, portfolio):
        state = {'cash': 900000.0}
        restore_state(portfolio, state)
        assert portfolio.cash == 900000.0
        assert portfolio.daily_pnl == 0.0  # unchanged? Actually function sets daily_pnl to 0.0 if not in state
        assert portfolio.daily_trades == 0


class TestRestorePosition:
    """Tests for restore_position function."""

    def test_creates_and_adds_position(self, portfolio):
        pos_data = {
            'symbol': 'RELIANCE',
            'strategy_id': 1,
            'side': 'BUY',
            'quantity': 100,
            'entry_price': 2500.0,
            'stop_loss': 2450.0,
            'take_profit': 2550.0,
            'entry_time': '2026-04-15T10:15:00',
            'strategy_name': 'ORB',
            'strategy_type': 'ORB',
            'current_price': 2520.0,
            'peak_price': 2525.0,
            'low_price': 2495.0,
            'metadata': {'notes': 'test'},
        }
        # Set up strategy allocation
        portfolio.strategy_allocations[1] = StrategyAllocation(
            strategy_id=1,
            strategy_name='ORB',
            allocation_pct=0.5,
            max_positions=10,
            capital_used=0.0,
            positions_count=0,
        )
        restore_position(portfolio, pos_data)
        key = "1_RELIANCE"
        assert key in portfolio.positions
        pos = portfolio.positions[key]
        assert isinstance(pos, SharedPosition)
        assert pos.symbol == "RELIANCE"
        assert pos.side == OrderSide.BUY
        assert pos.quantity == 100
        assert pos.entry_price == 2500.0
        assert pos.stop_loss == 2450.0
        assert pos.take_profit == 2550.0
        assert pos.entry_time == datetime(2026, 4, 15, 10, 15)
        assert pos.strategy_id == 1
        assert pos.strategy_name == "ORB"
        assert pos.current_price == 2520.0
        assert pos.peak_price == 2525.0
        assert pos.low_price == 2495.0
        assert pos.metadata == {'notes': 'test'}
        # Check strategy allocation updates
        alloc = portfolio.strategy_allocations[1]
        assert alloc.capital_used == 250000.0  # 2500*100
        assert alloc.positions_count == 1

    def test_skips_duplicate_position(self, portfolio):
        pos_data = {
            'symbol': 'RELIANCE',
            'strategy_id': 1,
            'side': 'BUY',
            'quantity': 100,
            'entry_price': 2500.0,
            'stop_loss': 2450.0,
            'take_profit': 2550.0,
            'entry_time': '2026-04-15T10:15:00',
            'strategy_name': 'ORB',
            'strategy_type': 'ORB',
        }
        # Add an existing position
        existing_pos = SharedPosition(
            symbol='RELIANCE',
            side=OrderSide.BUY,
            quantity=50,
            entry_price=2400.0,
            stop_loss=2350.0,
            take_profit=2450.0,
            entry_time=datetime(2026, 4, 14, 10, 0, tzinfo=config.IST),
            strategy_id=1,
            strategy_name='ORB',
        )
        portfolio.positions["1_RELIANCE"] = existing_pos
        # Also strategy allocation
        portfolio.strategy_allocations[1] = StrategyAllocation(
            strategy_id=1,
            strategy_name='ORB',
            allocation_pct=0.5,
            max_positions=10,
            capital_used=120000.0,
            positions_count=1,
        )
        restore_position(portfolio, pos_data)
        # Should not overwrite existing position or alter allocation
        assert portfolio.positions["1_RELIANCE"] is existing_pos
        alloc = portfolio.strategy_allocations[1]
        assert alloc.capital_used == 120000.0
        assert alloc.positions_count == 1

    def test_defaults_missing_fields(self, portfolio):
        """Test that missing optional fields get sensible defaults."""
        pos_data = {
            'symbol': 'TCS',
            'strategy_id': 2,
            'side': 'SELL',
            'quantity': 50,
            'entry_price': 3500.0,
            'stop_loss': 3550.0,
            'take_profit': 3450.0,
            'entry_time': '2026-04-15T10:15:00',
            'strategy_name': 'SR',
            # missing: strategy_type, current_price, peak_price, low_price, metadata
        }
        portfolio.strategy_allocations[2] = StrategyAllocation(
            strategy_id=2,
            strategy_name='SR',
            allocation_pct=0.3,
            max_positions=5,
        )
        restore_position(portfolio, pos_data)
        pos = portfolio.positions["2_TCS"]
        assert pos.strategy_type == ''  # defaults to empty string
        assert pos.current_price == pos.entry_price  # defaults to entry_price
        assert pos.peak_price == pos.entry_price
        assert pos.low_price == pos.entry_price
        assert pos.metadata == {}

    def test_entry_time_parsing(self, portfolio):
        pos_data = {
            'symbol': 'INFY',
            'strategy_id': 3,
            'side': 'BUY',
            'quantity': 200,
            'entry_price': 1500.0,
            'stop_loss': 1480.0,
            'take_profit': 1520.0,
            'entry_time': '2026-04-15T10:15:00',
            'strategy_name': 'EMA',
        }
        portfolio.strategy_allocations[3] = StrategyAllocation(
            strategy_id=3, strategy_name='EMA', allocation_pct=0.2, max_positions=3
        )
        restore_position(portfolio, pos_data)
        pos = portfolio.positions["3_INFY"]
        # entry_time parsed from ISO string; naive if no tz in string
        expected_entry = datetime(2026, 4, 15, 10, 15)
        assert pos.entry_time == expected_entry

    def test_strategy_allocation_not_required(self, portfolio):
        """If strategy_id not in strategy_allocations, position is still restored but allocation not updated."""
        pos_data = {
            'symbol': 'HDFC',
            'strategy_id': 99,
            'side': 'BUY',
            'quantity': 100,
            'entry_price': 2000.0,
            'stop_loss': 1980.0,
            'take_profit': 2020.0,
            'entry_time': '2026-04-15T10:15:00',
            'strategy_name': 'Unknown',
        }
        # Don't add allocation for 99
        restore_position(portfolio, pos_data)
        key = "99_HDFC"
        assert key in portfolio.positions
        assert 99 not in portfolio.strategy_allocations


class TestResetDaily:
    """Tests for reset_daily function."""

    def test_resets_daily_counters(self, portfolio):
        portfolio.daily_pnl = 5000.0
        portfolio.daily_trades = 10
        portfolio.day_start = date(2025, 1, 1)  # arbitrary old date
        reset_daily(portfolio)
        assert portfolio.daily_pnl == 0.0
        assert portfolio.daily_trades == 0
        # day_start should be today in config.IST
        assert portfolio.day_start == datetime.now(config.IST).date()

    def test_does_not_touch_other_attributes(self, portfolio):
        # Ensure cash, positions, etc. are not affected
        portfolio.cash = 800000.0
        original_positions = portfolio.positions
        original_initial_capital = portfolio.initial_capital
        reset_daily(portfolio)
        assert portfolio.cash == 800000.0
        assert portfolio.positions is original_positions
        assert portfolio.initial_capital == original_initial_capital

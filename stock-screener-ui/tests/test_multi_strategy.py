"""
Unit tests for Multi-Strategy Trading System

Tests:
1. SharedPortfolioManager - capital allocation, position management
2. GlobalRiskManager - risk checks and validation
3. MultiStrategyRunner - strategy coordination
4. Bot API endpoints - CRUD and control
"""

import pytest
import sys
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock

# Add project path
sys.path.insert(0, str(Path(__file__).parent.parent))

from trading.shared_portfolio import (
    SharedPortfolioManager,
    StrategyAllocation,
    SharedPosition,
    OrderSide,
)
from trading.global_risk_manager import (
    GlobalRiskManager,
    GlobalRiskConfig,
)


# ============================================
# SharedPortfolioManager Tests
# ============================================

class TestSharedPortfolioManager:
    """Tests for SharedPortfolioManager class."""

    def test_initialization(self):
        """Test portfolio manager initialization."""
        portfolio = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_total_capital_pct=0.80,
            max_total_positions=10,
        )

        assert portfolio.initial_capital == 1_000_000
        assert portfolio.cash == 1_000_000
        assert portfolio.max_total_capital_pct == 0.80
        assert portfolio.max_total_positions == 10
        assert len(portfolio.strategy_allocations) == 0
        assert len(portfolio.positions) == 0

    def test_set_strategy_allocation(self):
        """Test setting strategy allocations."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)

        portfolio.set_strategy_allocation(
            strategy_id=1,
            strategy_name="ORB Conservative",
            allocation_pct=0.40,
            max_positions=3,
        )

        assert 1 in portfolio.strategy_allocations
        alloc = portfolio.strategy_allocations[1]
        assert alloc.strategy_name == "ORB Conservative"
        assert alloc.allocation_pct == 0.40
        assert alloc.max_positions == 3
        assert alloc.capital_used == 0.0

    def test_get_strategy_capital(self):
        """Test getting strategy allocated capital."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        capital = portfolio.get_strategy_capital(1)
        assert capital == 400_000

    def test_get_strategy_available_capital(self):
        """Test getting available capital for a strategy."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        # Initially full allocation available
        assert portfolio.get_strategy_available_capital(1) == 400_000

        # After using some capital
        portfolio.strategy_allocations[1].capital_used = 100_000
        assert portfolio.get_strategy_available_capital(1) == 300_000

    def test_can_open_position_success(self):
        """Test position opening validation - success case."""
        portfolio = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_total_capital_pct=0.80,
            max_total_positions=10,
        )
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )

        assert allowed is True
        assert reason == "OK"

    def test_can_open_position_max_positions_reached(self):
        """Test position opening validation - max positions reached."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 2)

        # Simulate 2 positions already open
        portfolio.strategy_allocations[1].positions_count = 2

        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )

        assert allowed is False
        assert "max positions" in reason.lower()

    def test_can_open_position_capital_exceeded(self):
        """Test position opening validation - capital limit exceeded."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.20, 3)

        # Try to use more than allocated
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=250_000,  # More than 20% allocation
        )

        assert allowed is False
        assert "capital limit" in reason.lower()

    def test_can_open_position_total_positions_limit(self):
        """Test position opening validation - total positions limit."""
        portfolio = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_total_positions=2,
        )
        portfolio.set_strategy_allocation(1, "Test1", 0.40, 3)
        portfolio.set_strategy_allocation(2, "Test2", 0.40, 3)

        # Simulate positions
        portfolio.strategy_allocations[1].positions_count = 1
        portfolio.strategy_allocations[2].positions_count = 1

        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=50_000,
        )

        assert allowed is False
        assert "positions limit" in reason.lower()

    def test_can_open_position_symbol_exposure(self):
        """Test position opening validation - symbol exposure limit."""
        portfolio = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_symbol_exposure_pct=0.20,  # Max 20% in one symbol
        )
        portfolio.set_strategy_allocation(1, "Test1", 0.40, 3)
        portfolio.set_strategy_allocation(2, "Test2", 0.40, 3)

        # Strategy 1 opens position in RELIANCE
        portfolio.open_position(
            strategy_id=1,
            strategy_name="Test1",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000,  # 200,000 value
            stop_loss=1900,
            take_profit=2200,
        )

        # Strategy 2 tries to open more RELIANCE (would exceed 20%)
        allowed, reason = portfolio.can_open_position(
            strategy_id=2,
            symbol="RELIANCE",
            trade_value=150_000,  # Would make total 350,000 > 200,000
        )

        assert allowed is False
        assert "exposure" in reason.lower()

    def test_open_position_success(self):
        """Test opening a position successfully."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="Test",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=2000,
            stop_loss=1900,
            take_profit=2200,
        )

        assert position is not None
        assert position.symbol == "RELIANCE"
        assert position.quantity == 50
        assert position.entry_price == 2000
        assert position.strategy_id == 1

        # Check cash deducted
        assert portfolio.cash == 900_000

        # Check strategy allocation updated
        assert portfolio.strategy_allocations[1].capital_used == 100_000
        assert portfolio.strategy_allocations[1].positions_count == 1

    def test_open_position_multiple_strategies_same_symbol(self):
        """Test that multiple strategies CAN trade the same symbol."""
        portfolio = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_symbol_exposure_pct=0.30,  # Allow up to 30%
        )
        portfolio.set_strategy_allocation(1, "ORB Cons", 0.40, 3)
        portfolio.set_strategy_allocation(2, "ORB Aggr", 0.40, 3)

        # Strategy 1 opens RELIANCE
        pos1 = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB Cons",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=25,
            entry_price=2000,
            stop_loss=1900,
            take_profit=2200,
        )
        assert pos1 is not None

        # Strategy 2 also opens RELIANCE (different strategy)
        pos2 = portfolio.open_position(
            strategy_id=2,
            strategy_name="ORB Aggr",
            symbol="RELIANCE",
            quantity=25,
            entry_price=2000,
            stop_loss=1900,
            take_profit=2200,
            side=OrderSide.BUY,
        )
        assert pos2 is not None

        # Both positions should exist with different keys
        assert "1_RELIANCE" in portfolio.positions
        assert "2_RELIANCE" in portfolio.positions

    def test_close_position(self):
        """Test closing a position."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        # Open position
        portfolio.open_position(
            strategy_id=1,
            strategy_name="Test",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=2000,
            stop_loss=1900,
            take_profit=2200,
        )

        # Close position at profit
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2100,
            exit_reason="TP",
            costs=100,
        )

        assert trade is not None
        assert trade.exit_price == 2100
        assert trade.exit_reason == "TP"
        assert trade.pnl == 5000  # (2100 - 2000) * 50
        assert trade.net_pnl == 4900  # 5000 - 100

        # Check position removed
        assert "1_RELIANCE" not in portfolio.positions

        # Check cash returned (entry deducted + exit value returned)
        # Entry: 100000 deducted, Exit: 105000 returned = +5000 profit
        # Note: costs are tracked separately, not deducted from cash
        assert portfolio.cash == 1_005_000  # Initial + gross P&L

    def test_get_portfolio_status(self):
        """Test getting portfolio status."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        status = portfolio.get_portfolio_status()

        assert status['initial_capital'] == 1_000_000
        assert status['cash'] == 1_000_000
        assert status['total_positions'] == 0
        assert status['strategies_count'] == 1

    def test_get_strategy_status(self):
        """Test getting strategy-specific status."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        status = portfolio.get_strategy_status(1)

        assert status['strategy_name'] == "Test"
        assert status['allocated_capital'] == 400_000
        assert status['available_capital'] == 400_000
        assert status['positions_count'] == 0

    def test_update_prices(self):
        """Test updating position prices."""
        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(1, "Test", 0.40, 3)

        portfolio.open_position(
            strategy_id=1,
            strategy_name="Test",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=2000,
            stop_loss=1900,
            take_profit=2200,
        )

        # Update prices
        portfolio.update_prices({"RELIANCE": 2100})

        pos = portfolio.positions["1_RELIANCE"]
        assert pos.current_price == 2100
        assert pos.unrealized_pnl == 5000  # (2100 - 2000) * 50


# ============================================
# GlobalRiskManager Tests
# ============================================

class TestGlobalRiskManager:
    """Tests for GlobalRiskManager class."""

    _STRATEGY_LIMITS_KWARGS = dict(
        strategy_id=1,
        strategy_name="Test",
        strategy_max_positions=3,
        strategy_allocation_pct=0.40,
        current_strategy_positions=1,
        current_strategy_capital_used=100_000,
        allocated_capital=400_000,
        trade_value=50_000,
    )

    def test_initialization(self):
        rm = GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.20,
        )

        assert rm.config.max_total_positions == 10
        assert rm.config.max_total_capital_pct == 0.80
        assert rm.config.max_symbol_exposure_pct == 0.20

    def test_check_strategy_limits_success(self):
        rm = GlobalRiskManager()
        allowed, reason = rm.check_strategy_limits(**self._STRATEGY_LIMITS_KWARGS)
        assert allowed is True
        assert reason == "OK"

    def test_check_strategy_limits_max_positions(self):
        rm = GlobalRiskManager()
        allowed, reason = rm.check_strategy_limits(
            **{**self._STRATEGY_LIMITS_KWARGS, "strategy_max_positions": 2, "current_strategy_positions": 2}
        )
        assert allowed is False
        assert "max positions" in reason.lower()

    def test_check_global_limits_success(self):
        """Test global limits check - success."""
        rm = GlobalRiskManager(max_total_capital_pct=0.80)

        allowed, reason = rm.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            trade_value=100_000,
        )

        assert allowed is True
        assert reason == "OK"

    def test_check_global_limits_capital_exceeded(self):
        """Test global limits check - capital exceeded."""
        rm = GlobalRiskManager(max_total_capital_pct=0.80)

        allowed, reason = rm.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=750_000,
            trade_value=100_000,  # Would make 850k > 800k
        )

        assert allowed is False
        assert "capital limit" in reason.lower()

    def test_check_symbol_exposure_success(self):
        """Test symbol exposure check - success."""
        rm = GlobalRiskManager(max_symbol_exposure_pct=0.20)

        allowed, reason = rm.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=100_000,
            trade_value=50_000,  # Total 150k < 200k
        )

        assert allowed is True
        assert reason == "OK"

    def test_check_symbol_exposure_exceeded(self):
        """Test symbol exposure check - exceeded."""
        rm = GlobalRiskManager(max_symbol_exposure_pct=0.20)

        allowed, reason = rm.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=180_000,
            trade_value=50_000,  # Would make 230k > 200k
        )

        assert allowed is False
        assert "exposure" in reason.lower()

    _COMMON_CAN_TRADE_KWARGS = dict(
        strategy_id=1,
        strategy_name="Test",
        symbol="RELIANCE",
        trade_value=100_000,
        total_capital=1_000_000,
        cash_available=500_000,
        current_total_positions=3,
        current_total_capital_used=300_000,
        strategy_max_positions=3,
        strategy_allocation_pct=0.40,
        current_strategy_positions=1,
        current_strategy_capital_used=100_000,
        current_symbol_exposure=0,
        daily_pnl=0,
    )

    def test_can_trade_comprehensive(self):
        """Test comprehensive can_trade check."""
        rm = GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.20,
        )

        allowed, reason = rm.can_trade(**self._COMMON_CAN_TRADE_KWARGS)

        assert allowed is True
        assert reason == "OK"

    def test_can_trade_insufficient_cash(self):
        """Test can_trade with insufficient cash."""
        rm = GlobalRiskManager()

        kwargs = {**self._COMMON_CAN_TRADE_KWARGS, 'cash_available': 50_000}
        allowed, reason = rm.can_trade(**kwargs)

        assert allowed is False
        assert "insufficient cash" in reason.lower()

    _COMMON_VALIDATE_KWARGS = dict(
        strategy_id=1,
        strategy_name="Test",
        symbol="RELIANCE",
        entry_price=2000,
        stop_loss=1900,
        side="BUY",
        total_capital=1_000_000,
        cash_available=500_000,
        current_total_positions=3,
        current_total_capital_used=300_000,
        strategy_max_positions=3,
        strategy_allocation_pct=0.40,
        current_strategy_positions=1,
        current_strategy_capital_used=100_000,
        current_symbol_exposure=0,
        daily_pnl=0,
    )

    @pytest.mark.parametrize("take_profit,expected_valid,expected_rr_ratio", [
        (2400, True, 4.0),
        (2050, False, None),
    ])
    def test_validate_trade(self, take_profit, expected_valid, expected_rr_ratio):
        rm = GlobalRiskManager()

        result = rm.validate_trade(**self._COMMON_VALIDATE_KWARGS, take_profit=take_profit)

        assert result['valid'] is expected_valid
        if expected_valid:
            assert result['shares'] > 0
            assert result['rr_ratio'] == expected_rr_ratio
        else:
            assert "risk/reward" in result['reason'].lower()

    @pytest.mark.parametrize("daily_pnl,expected_within", [
        (-20_000, True),
        (-35_000, False),
    ], ids=["within_limit", "exceeded_limit"])
    def test_daily_loss_limit(self, daily_pnl, expected_within):
        rm = GlobalRiskManager()
        rm.config.max_daily_loss_pct = 0.03

        within, reason = rm.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=daily_pnl,
        )
        assert within is expected_within
        if not expected_within:
            assert "loss limit" in reason.lower()


# ============================================
# Integration Tests
# ============================================

class TestMultiStrategyIntegration:
    """Integration tests for multi-strategy system."""

    def test_full_trading_cycle(self):
        """Test a complete trading cycle with multiple strategies."""
        # Setup
        portfolio = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_total_capital_pct=0.80,
            max_total_positions=10,
            max_symbol_exposure_pct=0.30,
        )
        risk_mgr = GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.30,
        )

        # Configure strategies
        portfolio.set_strategy_allocation(1, "ORB Conservative", 0.35, 3)
        portfolio.set_strategy_allocation(2, "ORB Aggressive", 0.35, 3)
        portfolio.set_strategy_allocation(3, "52W Chaser", 0.10, 2)

        # Strategy 1 opens position
        pos1 = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB Conservative",
            symbol="TCS",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=3500,
            stop_loss=3360,
            take_profit=3850,
        )
        assert pos1 is not None

        # Strategy 2 opens different position
        pos2 = portfolio.open_position(
            strategy_id=2,
            strategy_name="ORB Aggressive",
            symbol="INFY",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=1500,
            stop_loss=1440,
            take_profit=1650,
        )
        assert pos2 is not None

        # Both strategies can trade same symbol (within exposure limit)
        pos3 = portfolio.open_position(
            strategy_id=2,
            strategy_name="ORB Aggressive",
            symbol="TCS",
            side=OrderSide.BUY,
            quantity=30,
            entry_price=3520,
            stop_loss=3380,
            take_profit=3870,
        )
        assert pos3 is not None  # Should succeed

        # Update prices
        portfolio.update_prices({
            "TCS": 3600,
            "INFY": 1550,
        })

        # Check portfolio status
        status = portfolio.get_portfolio_status()
        assert status['total_positions'] == 3
        assert status['cash'] < 1_000_000  # Some capital used

        # Close a position
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="TCS",
            exit_price=3700,
            exit_reason="TP",
            costs=200,
        )
        assert trade is not None
        assert trade.pnl > 0  # Profit

        # Verify final state
        final_status = portfolio.get_portfolio_status()
        assert final_status['total_positions'] == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

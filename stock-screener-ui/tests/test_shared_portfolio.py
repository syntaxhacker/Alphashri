"""
Unit tests for SharedPortfolioManager.

Tests cover:
- Portfolio initialization with capital
- Strategy allocation setup and management
- Opening/closing positions (BUY and SELL)
- Position tracking across multiple strategies
- Cash and margin management
- P&L calculations (realized/unrealized)
- Capital allocation between strategies
- Portfolio summary and reporting
- Daily tracking and reset
- Edge cases and error handling
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch

import config
from trading.shared_portfolio import (
    SharedPortfolioManager,
    StrategyAllocation,
    SharedPosition,
    CompletedTrade,
    OrderSide,
)


@pytest.mark.unit
class TestOrderSide:
    """Tests for OrderSide enum."""

    def test_buy_value(self):
        assert OrderSide.BUY.value == "BUY"

    def test_sell_value(self):
        assert OrderSide.SELL.value == "SELL"


@pytest.mark.unit
class TestStrategyAllocation:
    """Tests for StrategyAllocation dataclass."""

    def test_default_values(self):
        alloc = StrategyAllocation(
            strategy_id=1,
            strategy_name="Test",
            allocation_pct=0.5,
            max_positions=5,
        )
        assert alloc.capital_used == 0.0
        assert alloc.positions_count == 0
        assert alloc.realized_pnl == 0.0

    def test_custom_values(self):
        alloc = StrategyAllocation(
            strategy_id=2,
            strategy_name="Custom",
            allocation_pct=0.3,
            max_positions=3,
            capital_used=10000.0,
            positions_count=2,
            realized_pnl=500.0,
        )
        assert alloc.capital_used == 10000.0
        assert alloc.positions_count == 2
        assert alloc.realized_pnl == 500.0


@pytest.mark.unit
class TestSharedPosition:
    """Tests for SharedPosition dataclass."""

    def test_default_values(self):
        pos = SharedPosition(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
            entry_time=datetime.now(),
            strategy_id=1,
            strategy_name="Test",
        )
        assert pos.current_price == 0.0
        assert pos.unrealized_pnl == 0.0
        assert pos.unrealized_pnl_pct == 0.0
        assert pos.peak_price == 0.0
        assert pos.low_price == float('inf')

    def test_custom_values(self):
        entry_time = datetime.now()
        pos = SharedPosition(
            symbol="TCS",
            side=OrderSide.SELL,
            quantity=50,
            entry_price=3500.0,
            stop_loss=3600.0,
            take_profit=3300.0,
            entry_time=entry_time,
            strategy_id=2,
            strategy_name="Short",
            current_price=3400.0,
            unrealized_pnl=5000.0,
            unrealized_pnl_pct=2.86,
            peak_price=3550.0,
            low_price=3350.0,
        )
        assert pos.current_price == 3400.0
        assert pos.unrealized_pnl == 5000.0
        assert pos.peak_price == 3550.0
        assert pos.low_price == 3350.0


@pytest.mark.unit
class TestCompletedTrade:
    """Tests for CompletedTrade dataclass."""

    def test_default_values(self):
        trade = CompletedTrade(
            trade_id="TRADE-000001",
            symbol="INFY",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=1500.0,
            exit_price=1600.0,
            entry_time=datetime.now(),
            exit_time=datetime.now(),
            pnl=10000.0,
            pnl_pct=6.67,
            exit_reason="TP",
        )
        assert trade.costs == 0.0
        assert trade.net_pnl == 0.0
        assert trade.strategy_id == 0
        assert trade.strategy_name == ""
        assert trade.sl_price == 0.0
        assert trade.tp_price == 0.0


@pytest.mark.unit
class TestSharedPortfolioManagerInit:
    """Tests for SharedPortfolioManager initialization."""

    def test_default_initialization(self):
        portfolio = SharedPortfolioManager()
        assert portfolio.initial_capital == 1_000_000
        assert portfolio.cash == 1_000_000
        assert portfolio.max_total_capital_pct == 0.80
        assert portfolio.max_total_positions == 10
        assert portfolio.max_symbol_exposure_pct == 0.20
        assert portfolio.user_id is None

    def test_custom_initialization(self):
        portfolio = SharedPortfolioManager(
            initial_capital=500_000,
            max_total_capital_pct=0.60,
            max_total_positions=5,
            max_symbol_exposure_pct=0.15,
            user_id=42,
        )
        assert portfolio.initial_capital == 500_000
        assert portfolio.cash == 500_000
        assert portfolio.max_total_capital_pct == 0.60
        assert portfolio.max_total_positions == 5
        assert portfolio.max_symbol_exposure_pct == 0.15
        assert portfolio.user_id == 42

    def test_initial_state(self):
        portfolio = SharedPortfolioManager()
        assert portfolio.strategy_allocations == {}
        assert portfolio.positions == {}
        assert portfolio.trades == []
        assert portfolio._trade_counter == 0
        assert portfolio.daily_pnl == 0.0
        assert portfolio.daily_trades == 0


@pytest.mark.unit
class TestStrategyAllocationMethods:
    """Tests for strategy allocation management."""

    @pytest.fixture
    def portfolio(self):
        return SharedPortfolioManager(initial_capital=1_000_000)

    def test_set_strategy_allocation(self, portfolio):
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

    def test_set_multiple_strategy_allocations(self, portfolio):
        portfolio.set_strategy_allocation(1, "ORB Conservative", 0.40, 3)
        portfolio.set_strategy_allocation(2, "ORB Aggressive", 0.40, 3)
        portfolio.set_strategy_allocation(3, "52W Chaser", 0.15, 2)

        assert len(portfolio.strategy_allocations) == 3

    def test_get_strategy_capital(self, portfolio):
        portfolio.set_strategy_allocation(1, "Test", 0.30, 5)
        capital = portfolio.get_strategy_capital(1)
        assert capital == 300_000  # 30% of 1,000,000

    def test_get_strategy_capital_unknown_strategy(self, portfolio):
        capital = portfolio.get_strategy_capital(999)
        assert capital == 0.0

    def test_get_strategy_available_capital(self, portfolio):
        portfolio.set_strategy_allocation(1, "Test", 0.30, 5)
        available = portfolio.get_strategy_available_capital(1)
        assert available == 300_000

    def test_get_strategy_available_capital_after_use(self, portfolio):
        portfolio.set_strategy_allocation(1, "Test", 0.30, 5)
        portfolio.strategy_allocations[1].capital_used = 100_000
        available = portfolio.get_strategy_available_capital(1)
        assert available == 200_000

    def test_get_strategy_available_capital_fully_used(self, portfolio):
        portfolio.set_strategy_allocation(1, "Test", 0.30, 5)
        portfolio.strategy_allocations[1].capital_used = 350_000
        available = portfolio.get_strategy_available_capital(1)
        assert available == 0  # max(0, -50000) = 0

    def test_get_total_capital_used(self, portfolio):
        portfolio.set_strategy_allocation(1, "A", 0.40, 3)
        portfolio.set_strategy_allocation(2, "B", 0.40, 3)
        portfolio.strategy_allocations[1].capital_used = 100_000
        portfolio.strategy_allocations[2].capital_used = 150_000
        assert portfolio.get_total_capital_used() == 250_000

    def test_get_total_capital_used_empty(self, portfolio):
        assert portfolio.get_total_capital_used() == 0.0


@pytest.mark.unit
class TestPositionLimits:
    """Tests for position limit checks."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_total_capital_pct=0.80,
            max_total_positions=10,
            max_symbol_exposure_pct=0.20,
        )
        p.set_strategy_allocation(1, "ORB", 0.40, 3)
        p.set_strategy_allocation(2, "Momentum", 0.30, 2)
        return p

    def test_can_open_position_allowed(self, portfolio):
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_can_open_position_unknown_strategy(self, portfolio):
        allowed, reason = portfolio.can_open_position(
            strategy_id=999,
            symbol="RELIANCE",
            trade_value=100_000,
        )
        assert allowed is False
        assert "not configured" in reason

    def test_can_open_position_strategy_limit_reached(self, portfolio):
        portfolio.strategy_allocations[1].positions_count = 3
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )
        assert allowed is False
        assert "max positions" in reason

    def test_can_open_position_strategy_capital_exceeded(self, portfolio):
        portfolio.strategy_allocations[1].capital_used = 350_000
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )
        assert allowed is False
        assert "capital limit" in reason

    def test_can_open_position_total_positions_reached(self, portfolio):
        portfolio.strategy_allocations[1].positions_count = 3
        portfolio.strategy_allocations[2].positions_count = 2
        for i in range(3, 12):
            portfolio.strategy_allocations[i] = StrategyAllocation(
                strategy_id=i, strategy_name=f"S{i}", allocation_pct=0.01, max_positions=1
            )
            portfolio.strategy_allocations[i].positions_count = 1
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=10_000,
        )
        assert allowed is False
        assert "positions" in reason.lower()

    def test_can_open_position_total_capital_exceeded(self, portfolio):
        portfolio.strategy_allocations[1].capital_used = 400_000
        portfolio.strategy_allocations[2].capital_used = 350_000
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )
        assert allowed is False
        assert "capital limit" in reason

    def test_can_open_position_insufficient_cash(self, portfolio):
        portfolio.cash = 50_000
        allowed, reason = portfolio.can_open_position(
            strategy_id=1,
            symbol="RELIANCE",
            trade_value=100_000,
        )
        assert allowed is False
        assert "Insufficient cash" in reason

    def test_can_open_position_symbol_exposure_exceeded(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 50, 2000.0, 1900.0, 2200.0)
        allowed, reason = portfolio.can_open_position(
            strategy_id=2,
            symbol="RELIANCE",
            trade_value=200_000,
        )
        assert allowed is False
        assert "exposure limit" in reason

    def test_get_symbol_exposure(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 50, 2000.0, 1900.0, 2200.0)
        exposure = portfolio.get_symbol_exposure("RELIANCE")
        assert exposure == 100_000

    def test_get_symbol_exposure_multiple_strategies(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 50, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(2, "Momentum", "RELIANCE", OrderSide.BUY, 25, 2000.0, 1900.0, 2200.0)
        exposure = portfolio.get_symbol_exposure("RELIANCE")
        assert exposure == 150_000

    def test_get_symbol_exposure_no_positions(self, portfolio):
        assert portfolio.get_symbol_exposure("UNKNOWN") == 0.0


@pytest.mark.unit
class TestOpenPosition:
    """Tests for opening positions."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "ORB", 0.40, 3)
        return p

    def test_open_buy_position(self, portfolio):
        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        assert position is not None
        assert position.symbol == "RELIANCE"
        assert position.side == OrderSide.BUY
        assert position.quantity == 100
        assert position.entry_price == 2000.0
        assert portfolio.cash == 800_000

    def test_open_sell_position(self, portfolio):
        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="TCS",
            side=OrderSide.SELL,
            quantity=50,
            entry_price=3500.0,
            stop_loss=3600.0,
            take_profit=3300.0,
        )
        assert position is not None
        assert position.side == OrderSide.SELL
        assert portfolio.cash == 825_000

    def test_open_position_updates_strategy_tracking(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        alloc = portfolio.strategy_allocations[1]
        assert alloc.capital_used == 200_000
        assert alloc.positions_count == 1

    def test_open_position_rejected_unknown_strategy(self, portfolio):
        position = portfolio.open_position(
            strategy_id=999,
            strategy_name="Unknown",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        assert position is None

    def test_open_position_rejected_duplicate(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        assert position is None

    def test_open_position_sets_peak_and_low(self, portfolio):
        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        assert position.peak_price == 2000.0
        assert position.low_price == 2000.0

    def test_get_total_positions(self, portfolio):
        portfolio.set_strategy_allocation(2, "Momentum", 0.30, 2)
        portfolio.open_position(1, "ORB", "A", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.open_position(1, "ORB", "B", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.open_position(2, "Momentum", "C", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        assert portfolio.get_total_positions() == 3


@pytest.mark.unit
class TestClosePosition:
    """Tests for closing positions."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "ORB", 0.40, 3)
        return p

    def test_close_buy_position_profit(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
        )
        assert trade is not None
        assert trade.pnl == 20_000  # (2200 - 2000) * 100
        assert trade.pnl_pct == 10.0  # 10%
        assert trade.exit_reason == "TP"
        assert trade.side == OrderSide.BUY

    def test_close_buy_position_loss(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=1900.0,
            exit_reason="SL",
        )
        assert trade.pnl == -10_000  # (1900 - 2000) * 100
        assert trade.pnl_pct == -5.0

    def test_close_sell_position_profit(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="TCS",
            side=OrderSide.SELL,
            quantity=50,
            entry_price=3500.0,
            stop_loss=3600.0,
            take_profit=3300.0,
        )
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="TCS",
            exit_price=3300.0,
            exit_reason="TP",
        )
        assert trade.pnl == 10_000  # (3500 - 3300) * 50
        assert trade.pnl_pct == pytest.approx(5.71, rel=0.01)

    def test_close_sell_position_loss(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="TCS",
            side=OrderSide.SELL,
            quantity=50,
            entry_price=3500.0,
            stop_loss=3600.0,
            take_profit=3300.0,
        )
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="TCS",
            exit_price=3600.0,
            exit_reason="SL",
        )
        assert trade.pnl == -5_000  # (3500 - 3600) * 50

    def test_close_position_with_costs(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
            costs=500.0,
        )
        assert trade.costs == 500.0
        assert trade.net_pnl == 19_500  # 20000 - 500

    def test_close_position_updates_cash(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        assert portfolio.cash == 800_000
        portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
        )
        assert portfolio.cash == 1_020_000

    def test_close_position_updates_strategy_tracking(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
            costs=500.0,
        )
        alloc = portfolio.strategy_allocations[1]
        assert alloc.capital_used == 0
        assert alloc.positions_count == 0
        assert alloc.realized_pnl == 19_500

    def test_close_position_removes_from_positions(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        assert len(portfolio.positions) == 1
        portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
        )
        assert len(portfolio.positions) == 0

    def test_close_position_adds_to_trades(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
        )
        assert len(portfolio.trades) == 1
        assert portfolio.trades[0].symbol == "RELIANCE"

    def test_close_nonexistent_position(self, portfolio):
        trade = portfolio.close_position(
            strategy_id=1,
            symbol="UNKNOWN",
            exit_price=100.0,
            exit_reason="MANUAL",
        )
        assert trade is None

    def test_close_position_updates_daily_tracking(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        portfolio.close_position(
            strategy_id=1,
            symbol="RELIANCE",
            exit_price=2200.0,
            exit_reason="TP",
        )
        assert portfolio.daily_pnl == 20_000
        assert portfolio.daily_trades == 1

    def test_trade_id_generation(self, portfolio):
        portfolio.open_position(1, "ORB", "A", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        trade1 = portfolio.close_position(1, "A", 110.0, "TP")
        portfolio.open_position(1, "ORB", "B", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        trade2 = portfolio.close_position(1, "B", 110.0, "TP")
        assert trade1.trade_id == "TRADE-000001"
        assert trade2.trade_id == "TRADE-000002"


@pytest.mark.unit
class TestUpdatePrices:
    """Tests for price updates and unrealized P&L."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "ORB", 0.40, 3)
        p.set_strategy_allocation(2, "Momentum", 0.30, 2)
        return p

    def test_update_prices_buy_position(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        portfolio.update_prices({"RELIANCE": 2100.0})
        pos = portfolio.positions["1_RELIANCE"]
        assert pos.current_price == 2100.0
        assert pos.unrealized_pnl == 10_000
        assert pos.unrealized_pnl_pct == 5.0

    def test_update_prices_sell_position(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="TCS",
            side=OrderSide.SELL,
            quantity=50,
            entry_price=3500.0,
            stop_loss=3600.0,
            take_profit=3300.0,
        )
        portfolio.update_prices({"TCS": 3400.0})
        pos = portfolio.positions["1_TCS"]
        assert pos.current_price == 3400.0
        assert pos.unrealized_pnl == 5_000  # (3500 - 3400) * 50
        assert pos.unrealized_pnl_pct == pytest.approx(2.86, rel=0.01)

    def test_update_prices_updates_peak_and_low(self, portfolio):
        portfolio.open_position(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
        )
        portfolio.update_prices({"RELIANCE": 2100.0})
        pos = portfolio.positions["1_RELIANCE"]
        assert pos.peak_price == 2100.0
        assert pos.low_price == 2000.0

        portfolio.update_prices({"RELIANCE": 1950.0})
        assert pos.peak_price == 2100.0
        assert pos.low_price == 1950.0

    def test_update_prices_multiple_positions(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(2, "Momentum", "TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        portfolio.update_prices({"RELIANCE": 2100.0, "TCS": 3600.0})
        assert portfolio.positions["1_RELIANCE"].unrealized_pnl == 10_000
        assert portfolio.positions["2_TCS"].unrealized_pnl == 5_000

    def test_update_prices_partial_update(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(2, "Momentum", "TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        portfolio.update_prices({"RELIANCE": 2100.0})
        assert portfolio.positions["1_RELIANCE"].current_price == 2100.0
        assert portfolio.positions["2_TCS"].current_price == 3500.0


@pytest.mark.unit
class TestPortfolioStatus:
    """Tests for portfolio status reporting."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "ORB", 0.40, 3)
        p.set_strategy_allocation(2, "Momentum", 0.30, 2)
        return p

    def test_get_portfolio_status_initial(self, portfolio):
        status = portfolio.get_portfolio_status()
        assert status['initial_capital'] == 1_000_000
        assert status['cash'] == 1_000_000
        assert status['capital_used'] == 0
        assert status['position_value'] == 0
        assert status['unrealized_pnl'] == 0
        assert status['realized_pnl'] == 0
        assert status['total_value'] == 1_000_000
        assert status['total_pnl'] == 0
        assert status['total_positions'] == 0
        assert status['total_trades'] == 0

    def test_get_portfolio_status_with_positions(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.update_prices({"RELIANCE": 2100.0})
        status = portfolio.get_portfolio_status()
        assert status['cash'] == 800_000
        assert status['capital_used'] == 200_000
        assert status['position_value'] == 210_000
        assert status['unrealized_pnl'] == 10_000
        assert status['total_value'] == 1_010_000

    def test_get_portfolio_status_with_trades(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.close_position(1, "RELIANCE", 2200.0, "TP")
        status = portfolio.get_portfolio_status()
        assert status['realized_pnl'] == 20_000
        assert status['total_trades'] == 1

    def test_get_strategy_status(self, portfolio):
        status = portfolio.get_strategy_status(1)
        assert status['strategy_id'] == 1
        assert status['strategy_name'] == "ORB"
        assert status['allocation_pct'] == 0.40
        assert status['allocated_capital'] == 400_000
        assert status['available_capital'] == 400_000
        assert status['positions_count'] == 0
        assert status['max_positions'] == 3

    def test_get_strategy_status_with_positions(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.update_prices({"RELIANCE": 2100.0})
        status = portfolio.get_strategy_status(1)
        assert status['capital_used'] == 200_000
        assert status['available_capital'] == 200_000
        assert status['positions_count'] == 1
        assert status['unrealized_pnl'] == 10_000

    def test_get_strategy_status_with_trades(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.close_position(1, "RELIANCE", 2200.0, "TP")
        status = portfolio.get_strategy_status(1)
        assert status['realized_pnl'] == 20_000
        assert status['trades_count'] == 1

    def test_get_strategy_status_unknown(self, portfolio):
        status = portfolio.get_strategy_status(999)
        assert status is None

    def test_get_all_strategy_statuses(self, portfolio):
        statuses = portfolio.get_all_strategy_statuses()
        assert len(statuses) == 2
        names = [s['strategy_name'] for s in statuses]
        assert "ORB" in names
        assert "Momentum" in names

    def test_get_positions_by_strategy(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(1, "ORB", "TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        portfolio.open_position(2, "Momentum", "INFY", OrderSide.BUY, 100, 1500.0, 1450.0, 1600.0)
        positions = portfolio.get_positions_by_strategy(1)
        assert len(positions) == 2
        symbols = [p['symbol'] for p in positions]
        assert "RELIANCE" in symbols
        assert "TCS" in symbols

    def test_get_all_positions(self, portfolio):
        portfolio.open_position(1, "ORB", "RELIANCE", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(2, "Momentum", "TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        positions = portfolio.get_all_positions()
        assert len(positions) == 2


@pytest.mark.unit
class TestDailyTracking:
    """Tests for daily P&L tracking."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "ORB", 0.40, 3)
        return p

    def test_daily_pnl_accumulates(self, portfolio):
        portfolio.open_position(1, "ORB", "A", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "A", 110.0, "TP")
        portfolio.open_position(1, "ORB", "B", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "B", 105.0, "MANUAL")
        assert portfolio.daily_pnl == 150.0  # 100 + 50

    def test_daily_trades_count(self, portfolio):
        portfolio.open_position(1, "ORB", "A", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "A", 110.0, "TP")
        portfolio.open_position(1, "ORB", "B", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "B", 105.0, "MANUAL")
        assert portfolio.daily_trades == 2

    def test_reset_daily(self, portfolio):
        portfolio.open_position(1, "ORB", "A", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "A", 110.0, "TP")
        assert portfolio.daily_pnl == 100.0
        assert portfolio.daily_trades == 1
        portfolio.reset_daily()
        assert portfolio.daily_pnl == 0.0
        assert portfolio.daily_trades == 0


@pytest.mark.unit
class TestMultiStrategyPositions:
    """Tests for managing positions across multiple strategies."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(
            initial_capital=1_000_000,
            max_total_positions=10,
            max_total_capital_pct=0.80,
        )
        p.set_strategy_allocation(1, "ORB Conservative", 0.40, 3)
        p.set_strategy_allocation(2, "ORB Aggressive", 0.30, 3)
        p.set_strategy_allocation(3, "52W Chaser", 0.20, 2)
        return p

    def test_same_symbol_different_strategies(self, portfolio):
        pos1 = portfolio.open_position(1, "ORB Conservative", "RELIANCE", OrderSide.BUY, 50, 2000.0, 1900.0, 2200.0)
        pos2 = portfolio.open_position(2, "ORB Aggressive", "RELIANCE", OrderSide.BUY, 25, 2000.0, 1900.0, 2200.0)
        assert pos1 is not None
        assert pos2 is not None
        assert len(portfolio.positions) == 2
        assert "1_RELIANCE" in portfolio.positions
        assert "2_RELIANCE" in portfolio.positions

    def test_strategy_capital_isolation(self, portfolio):
        portfolio.open_position(1, "ORB Conservative", "A", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(2, "ORB Aggressive", "B", OrderSide.BUY, 100, 2000.0, 1900.0, 2200.0)
        assert portfolio.strategy_allocations[1].capital_used == 200_000
        assert portfolio.strategy_allocations[2].capital_used == 200_000

    def test_strategy_position_limit_independence(self, portfolio):
        for i in range(3):
            portfolio.open_position(1, "ORB Conservative", f"SYM{i}", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        assert portfolio.strategy_allocations[1].positions_count == 3
        pos = portfolio.open_position(1, "ORB Conservative", "NEW", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        assert pos is None
        pos = portfolio.open_position(2, "ORB Aggressive", "NEW", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        assert pos is not None

    def test_close_position_for_correct_strategy(self, portfolio):
        portfolio.open_position(1, "ORB Conservative", "RELIANCE", OrderSide.BUY, 50, 2000.0, 1900.0, 2200.0)
        portfolio.open_position(2, "ORB Aggressive", "RELIANCE", OrderSide.BUY, 25, 2000.0, 1900.0, 2200.0)
        trade = portfolio.close_position(1, "RELIANCE", 2100.0, "MANUAL")
        assert trade.quantity == 50
        assert "2_RELIANCE" in portfolio.positions
        assert "1_RELIANCE" not in portfolio.positions


@pytest.mark.unit
class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "Test", 0.50, 5)
        return p

    def test_zero_quantity_position(self, portfolio):
        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="Test",
            symbol="TEST",
            side=OrderSide.BUY,
            quantity=0,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
        )
        assert position is not None
        assert position.quantity == 0

    def test_very_large_pnl(self, portfolio):
        portfolio.strategy_allocations[1].allocation_pct = 1.0
        portfolio.max_total_capital_pct = 1.0
        portfolio.max_symbol_exposure_pct = 1.0
        portfolio.open_position(1, "Test", "BIG", OrderSide.BUY, 100, 10000.0, 9500.0, 11000.0)
        trade = portfolio.close_position(1, "BIG", 20000.0, "TP")
        assert trade.pnl == 1_000_000

    def test_negative_entry_price(self, portfolio):
        position = portfolio.open_position(
            strategy_id=1,
            strategy_name="Test",
            symbol="TEST",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=-100.0,
            stop_loss=-95.0,
            take_profit=-110.0,
        )
        assert position is not None

    def test_position_key_format(self, portfolio):
        portfolio.open_position(1, "Test", "RELIANCE", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        assert "1_RELIANCE" in portfolio.positions

    def test_position_entry_time_set(self, portfolio):
        before = datetime.now(config.IST)
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        after = datetime.now(config.IST)
        pos = portfolio.positions["1_TEST"]
        assert before <= pos.entry_time <= after

    def test_trade_exit_time_set(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        before = datetime.now(config.IST)
        trade = portfolio.close_position(1, "TEST", 110.0, "TP")
        after = datetime.now(config.IST)
        assert before <= trade.exit_time <= after

    def test_allocation_exceeds_100_percent(self, portfolio):
        portfolio.set_strategy_allocation(2, "Strategy 2", 0.60, 3)
        portfolio.set_strategy_allocation(3, "Strategy 3", 0.50, 3)
        total_alloc = sum(a.allocation_pct for a in portfolio.strategy_allocations.values())
        assert total_alloc > 1.0

    def test_exhaust_all_cash(self, portfolio):
        portfolio.strategy_allocations[1].allocation_pct = 1.0
        portfolio.max_total_capital_pct = 1.0
        portfolio.max_symbol_exposure_pct = 1.0
        position = portfolio.open_position(1, "Test", "BIG", OrderSide.BUY, 5000, 200.0, 190.0, 220.0)
        assert position is not None
        assert portfolio.cash == 0
        position = portfolio.open_position(1, "Test", "SMALL", OrderSide.BUY, 1, 100.0, 95.0, 110.0)
        assert position is None

    def test_get_positions_by_strategy_empty(self, portfolio):
        positions = portfolio.get_positions_by_strategy(1)
        assert positions == []


@pytest.mark.unit
class TestPnLCalculations:
    """Tests for P&L calculation accuracy."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "Test", 0.50, 5)
        return p

    def test_buy_pnl_calculation(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        portfolio.update_prices({"TEST": 105.0})
        pos = portfolio.positions["1_TEST"]
        assert pos.unrealized_pnl == 500.0
        assert pos.unrealized_pnl_pct == 5.0

    def test_sell_pnl_calculation(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.SELL, 100, 100.0, 105.0, 95.0)
        portfolio.update_prices({"TEST": 95.0})
        pos = portfolio.positions["1_TEST"]
        assert pos.unrealized_pnl == 500.0
        assert pos.unrealized_pnl_pct == 5.0

    def test_realized_pnl_with_costs(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        trade = portfolio.close_position(1, "TEST", 110.0, "TP", costs=200.0)
        assert trade.pnl == 1000.0
        assert trade.costs == 200.0
        assert trade.net_pnl == 800.0

    def test_strategy_realized_pnl_accumulates(self, portfolio):
        portfolio.open_position(1, "Test", "A", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "A", 110.0, "TP")
        portfolio.open_position(1, "Test", "B", OrderSide.BUY, 10, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "B", 120.0, "TP")
        assert portfolio.strategy_allocations[1].realized_pnl == 300.0

    def test_total_pnl_in_status(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        portfolio.update_prices({"TEST": 110.0})
        status = portfolio.get_portfolio_status()
        assert status['unrealized_pnl'] == 1000.0
        assert status['total_pnl'] == 1000.0
        assert status['total_pnl_pct'] == 0.1

    def test_total_pnl_with_realized(self, portfolio):
        portfolio.open_position(1, "Test", "A", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        portfolio.close_position(1, "A", 110.0, "TP")
        portfolio.open_position(1, "Test", "B", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        portfolio.update_prices({"B": 105.0})
        status = portfolio.get_portfolio_status()
        assert status['realized_pnl'] == 1000.0
        assert status['unrealized_pnl'] == 500.0


class TestPositionResponseStructure:
    """Tests for position and trade response structures."""

    @pytest.fixture
    def portfolio(self):
        p = SharedPortfolioManager(initial_capital=1_000_000)
        p.set_strategy_allocation(1, "Test", 0.50, 5)
        return p

    def test_get_positions_by_strategy_structure(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        positions = portfolio.get_positions_by_strategy(1)
        assert len(positions) == 1
        pos = positions[0]
        assert 'symbol' in pos
        assert 'side' in pos
        assert 'quantity' in pos
        assert 'entry_price' in pos
        assert 'current_price' in pos
        assert 'stop_loss' in pos
        assert 'take_profit' in pos
        assert 'unrealized_pnl' in pos
        assert 'unrealized_pnl_pct' in pos
        assert 'entry_time' in pos
        assert 'strategy_id' in pos
        assert 'strategy_name' in pos

    def test_get_all_positions_structure(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        positions = portfolio.get_all_positions()
        assert len(positions) == 1
        pos = positions[0]
        assert pos['symbol'] == "TEST"
        assert pos['side'] == "BUY"
        assert pos['strategy_name'] == "Test"

    def test_trade_record_structure(self, portfolio):
        portfolio.open_position(1, "Test", "TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        trade = portfolio.close_position(1, "TEST", 110.0, "TP", costs=50.0)
        assert trade.trade_id.startswith("TRADE-")
        assert trade.symbol == "TEST"
        assert trade.side == OrderSide.BUY
        assert trade.quantity == 100
        assert trade.entry_price == 100.0
        assert trade.exit_price == 110.0
        assert trade.exit_reason == "TP"
        assert trade.costs == 50.0
        assert trade.strategy_id == 1
        assert trade.strategy_name == "Test"

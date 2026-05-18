"""
Unit tests for PaperTrader.

Tests cover:
- PaperTrader initialization (default and custom values)
- Order placement (market orders)
- Order execution simulation
- Position management (open, close, multiple positions)
- Price updates and mark-to-market
- Trade execution with SL/TP triggers
- Commission/fee calculations
- Portfolio tracking and status
- Trade history
- User-scoped instances
"""

import pytest
import tempfile
import shutil
import json
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, mock_open

from trading.paper_trader import (
    PaperTrader,
    PaperOrder,
    PaperPosition,
    PaperTrade,
    OrderSide,
    OrderStatus,
    ExitReason,
    get_paper_trader,
    reset_paper_trader,
    clear_paper_trader,
)


class TestEnumsAndDataclasses:
    """Tests for enums and dataclasses."""

    def test_order_side_values(self):
        """Test OrderSide enum values."""
        assert OrderSide.BUY.value == "BUY"
        assert OrderSide.SELL.value == "SELL"

    def test_order_status_values(self):
        """Test OrderStatus enum values."""
        assert OrderStatus.PENDING.value == "PENDING"
        assert OrderStatus.FILLED.value == "FILLED"
        assert OrderStatus.CANCELLED.value == "CANCELLED"

    def test_exit_reason_values(self):
        """Test ExitReason enum values."""
        assert ExitReason.TAKE_PROFIT.value == "TP"
        assert ExitReason.STOP_LOSS.value == "SL"
        assert ExitReason.END_OF_DAY.value == "EOD"
        assert ExitReason.MANUAL.value == "MANUAL"

    def test_paper_order_dataclass(self):
        """Test PaperOrder dataclass."""
        order = PaperOrder(
            order_id="TEST-001",
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
            timestamp=datetime.now(),
        )
        assert order.order_id == "TEST-001"
        assert order.symbol == "RELIANCE"
        assert order.side == OrderSide.BUY
        assert order.quantity == 100
        assert order.price == 2500.0
        assert order.stop_loss == 2400.0
        assert order.take_profit == 2700.0
        assert order.status == OrderStatus.PENDING
        assert order.fill_price is None
        assert order.fill_time is None

    def test_paper_position_dataclass(self):
        """Test PaperPosition dataclass."""
        position = PaperPosition(
            symbol="TCS",
            side=OrderSide.BUY,
            quantity=50,
            entry_price=3500.0,
            stop_loss=3400.0,
            take_profit=3700.0,
            entry_time=datetime.now(),
        )
        assert position.symbol == "TCS"
        assert position.quantity == 50
        assert position.entry_price == 3500.0
        assert position.current_price == 0.0
        assert position.unrealized_pnl == 0.0
        assert position.peak_price == 0.0
        assert position.low_price == float('inf')

    def test_paper_trade_dataclass(self):
        """Test PaperTrade dataclass."""
        trade = PaperTrade(
            trade_id="TRADE-001",
            symbol="INFY",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=1500.0,
            exit_price=1600.0,
            entry_time=datetime.now(),
            exit_time=datetime.now(),
            pnl=10000.0,
            pnl_pct=6.67,
            exit_reason=ExitReason.TAKE_PROFIT,
        )
        assert trade.trade_id == "TRADE-001"
        assert trade.symbol == "INFY"
        assert trade.pnl == 10000.0
        assert trade.exit_reason == ExitReason.TAKE_PROFIT
        assert trade.costs == 0.0
        assert trade.net_pnl == 0.0


class TestPaperTraderInit:
    """Tests for PaperTrader initialization."""

    def test_default_initialization(self):
        """Test default initialization with default capital."""
        trader = PaperTrader()
        assert trader.initial_capital == 1_000_000
        assert trader.cash == 1_000_000
        assert trader.margin_used == 0.0
        assert trader.positions == {}
        assert trader.pending_orders == {}
        assert trader.trades == []

    def test_custom_capital(self):
        """Test initialization with custom capital."""
        trader = PaperTrader(initial_capital=500_000)
        assert trader.initial_capital == 500_000
        assert trader.cash == 500_000

    def test_custom_cost_parameters(self):
        """Test initialization with custom cost parameters."""
        trader = PaperTrader(
            brokerage_pct=0.001,
            min_brokerage=30,
            stt_pct=0.0003,
            exchange_pct=0.00005,
            sebi_pct=0.000002,
            stamp_pct=0.00005,
            gst_pct=0.18,
        )
        assert trader.brokerage_pct == 0.001
        assert trader.min_brokerage == 30
        assert trader.stt_pct == 0.0003
        assert trader.exchange_pct == 0.00005
        assert trader.sebi_pct == 0.000002
        assert trader.stamp_pct == 0.00005
        assert trader.gst_pct == 0.18

    def test_default_cost_parameters(self):
        """Test default cost parameters are set correctly."""
        trader = PaperTrader()
        assert trader.brokerage_pct == 0.0003
        assert trader.min_brokerage == 20
        assert trader.stt_pct == 0.00025
        assert trader.exchange_pct == 0.0000297
        assert trader.sebi_pct == 0.000001
        assert trader.stamp_pct == 0.00003
        assert trader.gst_pct == 0.18

    def test_strategy_tracking(self):
        """Test strategy ID and name are set."""
        trader = PaperTrader(strategy_id=5, strategy_name="ORB Aggressive")
        assert trader.strategy_id == 5
        assert trader.strategy_name == "ORB Aggressive"

    def test_user_id_set(self):
        """Test user_id is set correctly."""
        trader = PaperTrader(user_id=123)
        assert trader.user_id == 123

    def test_daily_tracking_initial_state(self):
        """Test daily tracking initial state."""
        trader = PaperTrader()
        assert trader.daily_pnl == 0.0
        assert trader.daily_trades == 0

    def test_counters_initial_state(self):
        """Test order and trade counters initial state."""
        trader = PaperTrader()
        assert trader._order_counter == 0
        assert trader._trade_counter == 0


class TestCalculateCosts:
    """Tests for trading cost calculations."""

    @pytest.fixture
    def trader(self):
        return PaperTrader()

    def test_basic_cost_calculation(self, trader):
        """Test basic cost calculation structure."""
        costs = trader.calculate_costs(100.0, 100, OrderSide.BUY)
        assert 'brokerage' in costs
        assert 'stt' in costs
        assert 'exchange' in costs
        assert 'sebi' in costs
        assert 'stamp' in costs
        assert 'gst' in costs
        assert 'total' in costs

    def test_brokerage_minimum(self, trader):
        """Test brokerage uses minimum when calculated is lower."""
        costs = trader.calculate_costs(100.0, 10, OrderSide.BUY)
        assert costs['brokerage'] == trader.min_brokerage

    def test_brokerage_percentage(self, trader):
        """Test brokerage uses percentage for large trades."""
        large_value = 1_000_000
        costs = trader.calculate_costs(large_value, 1, OrderSide.BUY)
        expected_brokerage = large_value * trader.brokerage_pct
        assert costs['brokerage'] == round(expected_brokerage, 2)

    def test_stt_sell_side_only(self, trader):
        """Test STT is charged only on sell side."""
        buy_costs = trader.calculate_costs(100.0, 100, OrderSide.BUY)
        sell_costs = trader.calculate_costs(100.0, 100, OrderSide.SELL)
        assert buy_costs['stt'] == 0
        assert sell_costs['stt'] > 0

    def test_stamp_duty_buy_side_only(self, trader):
        """Test stamp duty is charged only on buy side."""
        buy_costs = trader.calculate_costs(100.0, 100, OrderSide.BUY)
        sell_costs = trader.calculate_costs(100.0, 100, OrderSide.SELL)
        assert buy_costs['stamp'] > 0
        assert sell_costs['stamp'] == 0

    def test_gst_on_charges(self, trader):
        """Test GST is applied on brokerage + exchange + sebi."""
        costs = trader.calculate_costs(1000.0, 100, OrderSide.BUY)
        expected_gst_base = costs['brokerage'] + costs['exchange'] + costs['sebi']
        expected_gst = expected_gst_base * trader.gst_pct
        assert abs(costs['gst'] - round(expected_gst, 2)) < 0.01

    def test_total_is_sum_of_components(self, trader):
        """Test total is sum of all components."""
        costs = trader.calculate_costs(1000.0, 100, OrderSide.BUY)
        expected_total = (
            costs['brokerage'] +
            costs['stt'] +
            costs['exchange'] +
            costs['sebi'] +
            costs['stamp'] +
            costs['gst']
        )
        assert costs['total'] == round(expected_total, 2)

    def test_costs_rounded(self, trader):
        """Test costs are properly rounded."""
        costs = trader.calculate_costs(1234.56, 78, OrderSide.SELL)
        assert isinstance(costs['brokerage'], float)
        assert isinstance(costs['total'], float)

    def test_large_trade_costs(self, trader):
        """Test costs for large trade values."""
        costs = trader.calculate_costs(10000.0, 1000, OrderSide.SELL)
        assert costs['total'] > 0
        assert costs['stt'] > 0

    def test_small_trade_costs(self, trader):
        """Test costs for small trade values."""
        costs = trader.calculate_costs(10.0, 1, OrderSide.BUY)
        assert costs['brokerage'] == trader.min_brokerage
        assert costs['total'] > 0


class TestPlaceOrder:
    """Tests for order placement."""

    @pytest.fixture
    def trader(self):
        return PaperTrader(initial_capital=1_000_000)

    def test_place_buy_order(self, trader):
        """Test placing a buy order."""
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        assert order.symbol == "RELIANCE"
        assert order.side == OrderSide.BUY
        assert order.quantity == 100
        assert order.price == 2500.0
        assert order.status == OrderStatus.FILLED

    def test_place_sell_order(self, trader):
        """Test placing a sell (short) order."""
        order = trader.place_order(
            symbol="TCS",
            side=OrderSide.SELL,
            quantity=50,
            price=3500.0,
            stop_loss=3600.0,
            take_profit=3300.0,
        )
        assert order.side == OrderSide.SELL
        assert order.status == OrderStatus.FILLED

    def test_order_deducts_cash(self, trader):
        """Test order deducts margin from cash."""
        initial_cash = trader.cash
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        expected_deduction = 100 * 2500.0
        assert trader.cash == initial_cash - expected_deduction

    def test_order_increases_margin_used(self, trader):
        """Test order increases margin used."""
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        assert trader.margin_used == 100 * 2500.0

    def test_order_creates_position(self, trader):
        """Test order creates a position."""
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        assert "RELIANCE" in trader.positions
        position = trader.positions["RELIANCE"]
        assert position.symbol == "RELIANCE"
        assert position.quantity == 100
        assert position.entry_price == 2500.0

    def test_insufficient_cash_cancels_order(self):
        """Test insufficient cash cancels order."""
        trader = PaperTrader(initial_capital=10_000)
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        assert order.status == OrderStatus.CANCELLED
        assert "RELIANCE" not in trader.positions

    def test_duplicate_position_cancels_order(self, trader):
        """Test duplicate position for same symbol cancels order."""
        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=50,
            price=2550.0,
            stop_loss=2450.0,
            take_profit=2750.0,
        )
        assert order.status == OrderStatus.CANCELLED

    def test_order_id_generation(self, trader):
        """Test order IDs are generated sequentially."""
        order1 = trader.place_order("A", OrderSide.BUY, 10, 100, 95, 110)
        order2 = trader.place_order("B", OrderSide.BUY, 10, 100, 95, 110)
        assert order1.order_id != order2.order_id
        assert "PAPER-" in order1.order_id

    def test_order_fill_price_set(self, trader):
        """Test order fill price is set."""
        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        assert order.fill_price == 2500.0
        assert order.fill_time is not None

    def test_position_strategy_tracking(self):
        """Test position inherits strategy info from trader."""
        trader = PaperTrader(strategy_id=5, strategy_name="Test Strategy")
        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        position = trader.positions["RELIANCE"]
        assert position.strategy_id == 5
        assert position.strategy_name == "Test Strategy"

    def test_position_peak_low_tracking(self, trader):
        """Test position tracks peak and low prices."""
        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        position = trader.positions["RELIANCE"]
        assert position.peak_price == 2500.0
        assert position.low_price == 2500.0


class TestUpdatePrices:
    """Tests for price updates and mark-to-market."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=1_000_000)
        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        return trader

    def test_update_price_updates_position(self, trader):
        """Test price update updates position current price."""
        trader.update_prices({"RELIANCE": 2550.0})
        assert trader.positions["RELIANCE"].current_price == 2550.0

    def test_update_price_calculates_unrealized_pnl_buy(self, trader):
        """Test unrealized P&L calculation for BUY position."""
        trader.update_prices({"RELIANCE": 2600.0})
        position = trader.positions["RELIANCE"]
        expected_pnl = (2600.0 - 2500.0) * 100
        assert position.unrealized_pnl == expected_pnl

    def test_update_price_calculates_unrealized_pnl_pct_buy(self, trader):
        """Test unrealized P&L percentage for BUY position."""
        trader.update_prices({"RELIANCE": 2600.0})
        position = trader.positions["RELIANCE"]
        expected_pct = (2600.0 - 2500.0) / 2500.0 * 100
        assert position.unrealized_pnl_pct == expected_pct

    def test_update_price_negative_pnl_buy(self, trader):
        """Test negative unrealized P&L for BUY position."""
        trader.update_prices({"RELIANCE": 2420.0})
        position = trader.positions["RELIANCE"]
        expected_pnl = (2420.0 - 2500.0) * 100
        assert position.unrealized_pnl == expected_pnl
        assert position.unrealized_pnl < 0

    def test_update_price_tracks_peak(self, trader):
        """Test peak price is tracked."""
        trader.update_prices({"RELIANCE": 2600.0})
        trader.update_prices({"RELIANCE": 2550.0})
        trader.update_prices({"RELIANCE": 2650.0})
        position = trader.positions["RELIANCE"]
        assert position.peak_price == 2650.0

    def test_update_price_tracks_low(self, trader):
        """Test low price is tracked."""
        trader.update_prices({"RELIANCE": 2450.0})
        trader.update_prices({"RELIANCE": 2550.0})
        trader.update_prices({"RELIANCE": 2420.0})
        position = trader.positions["RELIANCE"]
        assert position.low_price == 2420.0

    def test_take_profit_triggers_exit_buy(self, trader):
        """Test take profit triggers exit for BUY position."""
        trader.update_prices({"RELIANCE": 2750.0})
        assert "RELIANCE" not in trader.positions
        assert len(trader.trades) == 1
        assert trader.trades[0].exit_reason == ExitReason.TAKE_PROFIT

    def test_stop_loss_triggers_exit_buy(self, trader):
        """Test stop loss triggers exit for BUY position."""
        trader.update_prices({"RELIANCE": 2350.0})
        assert "RELIANCE" not in trader.positions
        assert len(trader.trades) == 1
        assert trader.trades[0].exit_reason == ExitReason.STOP_LOSS

    def test_price_update_missing_symbol(self, trader):
        """Test price update with missing symbol doesn't crash."""
        trader.update_prices({"TCS": 3500.0})
        assert "RELIANCE" in trader.positions

    def test_multiple_positions_update(self):
        """Test updating multiple positions at once."""
        trader = PaperTrader(initial_capital=10_000_000)
        trader.place_order("RELIANCE", OrderSide.BUY, 100, 2500.0, 2400.0, 2700.0)
        trader.place_order("TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)

        trader.update_prices({"RELIANCE": 2600.0, "TCS": 3600.0})

        assert trader.positions["RELIANCE"].current_price == 2600.0
        assert trader.positions["TCS"].current_price == 3600.0


class TestSellPosition:
    """Tests for SELL (short) positions."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=1_000_000)
        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.SELL,
            quantity=100,
            price=2500.0,
            stop_loss=2600.0,
            take_profit=2300.0,
        )
        return trader

    def test_sell_position_created(self, trader):
        """Test SELL position is created correctly."""
        position = trader.positions["RELIANCE"]
        assert position.side == OrderSide.SELL
        assert position.entry_price == 2500.0
        assert position.stop_loss == 2600.0
        assert position.take_profit == 2300.0

    def test_sell_unrealized_pnl_profit(self, trader):
        """Test SELL position P&L when price drops."""
        trader.update_prices({"RELIANCE": 2400.0})
        position = trader.positions["RELIANCE"]
        expected_pnl = (2500.0 - 2400.0) * 100
        assert position.unrealized_pnl == expected_pnl

    def test_sell_unrealized_pnl_loss(self, trader):
        """Test SELL position P&L when price rises."""
        trader.update_prices({"RELIANCE": 2550.0})
        position = trader.positions["RELIANCE"]
        expected_pnl = (2500.0 - 2550.0) * 100
        assert position.unrealized_pnl == expected_pnl

    def test_sell_take_profit_triggers(self, trader):
        """Test SELL position take profit triggers."""
        trader.update_prices({"RELIANCE": 2200.0})
        assert "RELIANCE" not in trader.positions
        assert trader.trades[0].exit_reason == ExitReason.TAKE_PROFIT

    def test_sell_stop_loss_triggers(self, trader):
        """Test SELL position stop loss triggers."""
        trader.update_prices({"RELIANCE": 2700.0})
        assert "RELIANCE" not in trader.positions
        assert trader.trades[0].exit_reason == ExitReason.STOP_LOSS


class TestClosePosition:
    """Tests for manual position closing."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=1_000_000)
        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        return trader

    def test_close_position_returns_trade(self, trader):
        """Test closing position returns trade record."""
        trade = trader.close_position("RELIANCE", 2600.0)
        assert trade is not None
        assert trade.symbol == "RELIANCE"
        assert trade.exit_price == 2600.0

    def test_close_position_removes_from_dict(self, trader):
        """Test closing position removes from positions dict."""
        trader.close_position("RELIANCE", 2600.0)
        assert "RELIANCE" not in trader.positions

    def test_close_position_adds_to_trades(self, trader):
        """Test closing position adds to trades list."""
        trader.close_position("RELIANCE", 2600.0)
        assert len(trader.trades) == 1

    def test_close_position_calculates_pnl_buy(self, trader):
        """Test P&L calculation for closing BUY position."""
        trade = trader.close_position("RELIANCE", 2600.0)
        expected_pnl = (2600.0 - 2500.0) * 100
        assert trade.pnl == round(expected_pnl, 2)

    def test_close_position_calculates_pnl_pct(self, trader):
        """Test P&L percentage calculation."""
        trade = trader.close_position("RELIANCE", 2600.0)
        expected_pct = (2600.0 - 2500.0) / 2500.0 * 100
        assert trade.pnl_pct == round(expected_pct, 2)

    def test_close_position_calculates_costs(self, trader):
        """Test trading costs are calculated."""
        trade = trader.close_position("RELIANCE", 2600.0)
        assert trade.costs > 0

    def test_close_position_calculates_net_pnl(self, trader):
        """Test net P&L includes costs."""
        trade = trader.close_position("RELIANCE", 2600.0)
        expected_net = trade.pnl - trade.costs
        assert trade.net_pnl == round(expected_net, 2)

    def test_close_position_updates_cash(self, trader):
        """Test closing position returns cash."""
        initial_cash = trader.cash
        trade = trader.close_position("RELIANCE", 2600.0)
        exit_value = 2600.0 * 100
        assert trader.cash == initial_cash + exit_value

    def test_close_position_updates_margin(self, trader):
        """Test closing position reduces margin used."""
        trader.close_position("RELIANCE", 2600.0)
        assert trader.margin_used == 0

    def test_close_nonexistent_position(self, trader):
        """Test closing nonexistent position returns None."""
        result = trader.close_position("NONEXISTENT", 100.0)
        assert result is None

    def test_close_with_exit_reason(self, trader):
        """Test exit reason is recorded."""
        trade = trader.close_position("RELIANCE", 2600.0, ExitReason.MANUAL)
        assert trade.exit_reason == ExitReason.MANUAL

    def test_close_records_peak_low(self, trader):
        """Test peak and low prices are recorded in trade."""
        trader.update_prices({"RELIANCE": 2600.0})
        trader.update_prices({"RELIANCE": 2450.0})
        trade = trader.close_position("RELIANCE", 2550.0)
        assert trade.peak_price == 2600.0
        assert trade.low_price == 2450.0

    def test_close_updates_daily_pnl(self, trader):
        """Test daily P&L is updated."""
        trader.close_position("RELIANCE", 2600.0)
        assert trader.daily_pnl != 0

    def test_close_increments_daily_trades(self, trader):
        """Test daily trades counter is incremented."""
        trader.close_position("RELIANCE", 2600.0)
        assert trader.daily_trades == 1


class TestCloseAllPositions:
    """Tests for closing all positions."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=10_000_000)
        trader.place_order("RELIANCE", OrderSide.BUY, 100, 2500.0, 2400.0, 2700.0)
        trader.place_order("TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        return trader

    def test_close_all_closes_all_positions(self, trader):
        """Test close_all_positions closes all open positions."""
        prices = {"RELIANCE": 2550.0, "TCS": 3550.0}
        trader.close_all_positions(prices)
        assert len(trader.positions) == 0

    def test_close_all_creates_trades(self, trader):
        """Test close_all_positions creates trade records."""
        prices = {"RELIANCE": 2550.0, "TCS": 3550.0}
        trader.close_all_positions(prices)
        assert len(trader.trades) == 2

    def test_close_all_with_exit_reason(self, trader):
        """Test close_all_positions with custom exit reason."""
        prices = {"RELIANCE": 2550.0, "TCS": 3550.0}
        trader.close_all_positions(prices, ExitReason.END_OF_DAY)
        for trade in trader.trades:
            assert trade.exit_reason == ExitReason.END_OF_DAY

    def test_close_all_missing_prices(self, trader):
        """Test close_all_positions with missing prices."""
        prices = {"RELIANCE": 2550.0}
        trader.close_all_positions(prices)
        assert "RELIANCE" not in trader.positions
        assert "TCS" in trader.positions


class TestGetPortfolioStatus:
    """Tests for portfolio status."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=1_000_000)
        trader.place_order("RELIANCE", OrderSide.BUY, 100, 2500.0, 2400.0, 2700.0)
        trader.update_prices({"RELIANCE": 2600.0})
        return trader

    def test_portfolio_status_structure(self, trader):
        """Test portfolio status has all fields."""
        status = trader.get_portfolio_status()
        expected_fields = [
            'initial_capital', 'cash', 'margin_used', 'position_value',
            'unrealized_pnl', 'realized_pnl', 'total_value', 'total_pnl',
            'total_pnl_pct', 'positions', 'trades', 'daily_pnl', 'daily_trades'
        ]
        for field in expected_fields:
            assert field in status

    def test_portfolio_status_initial_capital(self, trader):
        """Test initial capital in status."""
        status = trader.get_portfolio_status()
        assert status['initial_capital'] == 1_000_000

    def test_portfolio_status_cash(self, trader):
        """Test cash in status."""
        status = trader.get_portfolio_status()
        assert status['cash'] == 1_000_000 - (100 * 2500.0)

    def test_portfolio_status_margin_used(self, trader):
        """Test margin used in status."""
        status = trader.get_portfolio_status()
        assert status['margin_used'] == 100 * 2500.0

    def test_portfolio_status_position_value(self, trader):
        """Test position value in status."""
        status = trader.get_portfolio_status()
        assert status['position_value'] == 100 * 2600.0

    def test_portfolio_status_unrealized_pnl(self, trader):
        """Test unrealized P&L in status."""
        status = trader.get_portfolio_status()
        expected_pnl = (2600.0 - 2500.0) * 100
        assert status['unrealized_pnl'] == expected_pnl

    def test_portfolio_status_total_value(self, trader):
        """Test total value in status."""
        status = trader.get_portfolio_status()
        expected_total = status['cash'] + status['position_value']
        assert status['total_value'] == expected_total

    def test_portfolio_status_total_pnl(self, trader):
        """Test total P&L in status."""
        status = trader.get_portfolio_status()
        expected_pnl = status['total_value'] - status['initial_capital']
        assert status['total_pnl'] == expected_pnl

    def test_portfolio_status_total_pnl_pct(self, trader):
        """Test total P&L percentage in status."""
        status = trader.get_portfolio_status()
        expected_pct = status['total_pnl'] / status['initial_capital'] * 100
        assert status['total_pnl_pct'] == round(expected_pct, 2)

    def test_portfolio_empty(self):
        """Test portfolio status with no positions."""
        trader = PaperTrader()
        status = trader.get_portfolio_status()
        assert status['positions'] == 0
        assert status['position_value'] == 0
        assert status['unrealized_pnl'] == 0

    def test_portfolio_after_trade(self):
        """Test portfolio status after completing a trade."""
        trader = PaperTrader(initial_capital=1_000_000)
        trader.place_order("RELIANCE", OrderSide.BUY, 100, 2500.0, 2400.0, 2700.0)
        trader.close_position("RELIANCE", 2600.0)
        status = trader.get_portfolio_status()
        assert status['trades'] == 1
        assert status['realized_pnl'] != 0


class TestGetPositions:
    """Tests for getting positions."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=10_000_000)
        trader.place_order("RELIANCE", OrderSide.BUY, 100, 2500.0, 2400.0, 2700.0)
        trader.place_order("TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        return trader

    def test_get_positions_returns_list(self, trader):
        """Test get_positions returns a list."""
        positions = trader.get_positions()
        assert isinstance(positions, list)

    def test_get_positions_count(self, trader):
        """Test get_positions returns correct count."""
        positions = trader.get_positions()
        assert len(positions) == 2

    def test_get_positions_structure(self, trader):
        """Test position dict structure."""
        positions = trader.get_positions()
        pos = positions[0]
        assert 'symbol' in pos
        assert 'side' in pos
        assert 'quantity' in pos
        assert 'entry_price' in pos
        assert 'current_price' in pos
        assert 'stop_loss' in pos
        assert 'take_profit' in pos
        assert 'unrealized_pnl' in pos

    def test_get_positions_empty(self):
        """Test get_positions with no positions."""
        trader = PaperTrader()
        positions = trader.get_positions()
        assert positions == []


class TestGetTrades:
    """Tests for getting trade history."""

    @pytest.fixture
    def trader(self):
        trader = PaperTrader(initial_capital=10_000_000)
        trader.place_order("RELIANCE", OrderSide.BUY, 100, 2500.0, 2400.0, 2700.0)
        trader.close_position("RELIANCE", 2600.0)
        trader.place_order("TCS", OrderSide.BUY, 50, 3500.0, 3400.0, 3700.0)
        trader.close_position("TCS", 3400.0)
        return trader

    def test_get_trades_returns_list(self, trader):
        """Test get_trades returns a list."""
        trades = trader.get_trades()
        assert isinstance(trades, list)

    def test_get_trades_count(self, trader):
        """Test get_trades returns correct count."""
        trades = trader.get_trades()
        assert len(trades) == 2

    def test_get_trades_structure(self, trader):
        """Test trade dict structure."""
        trades = trader.get_trades()
        trade = trades[0]
        assert 'trade_id' in trade
        assert 'symbol' in trade
        assert 'side' in trade
        assert 'quantity' in trade
        assert 'entry_price' in trade
        assert 'exit_price' in trade
        assert 'pnl' in trade
        assert 'pnl_pct' in trade
        assert 'exit_reason' in trade
        assert 'costs' in trade
        assert 'net_pnl' in trade

    def test_get_trades_limit(self, trader):
        """Test get_trades respects limit."""
        trades = trader.get_trades(limit=1)
        assert len(trades) == 1

    def test_get_trades_empty(self):
        """Test get_trades with no trades."""
        trader = PaperTrader()
        trades = trader.get_trades()
        assert trades == []


class TestResetDaily:
    """Tests for daily reset."""

    def test_reset_daily_clears_pnl(self):
        """Test reset_daily clears daily P&L."""
        trader = PaperTrader()
        trader.daily_pnl = 5000.0
        trader.reset_daily()
        assert trader.daily_pnl == 0.0

    def test_reset_daily_clears_trades_counter(self):
        """Test reset_daily clears daily trades counter."""
        trader = PaperTrader()
        trader.daily_trades = 5
        trader.reset_daily()
        assert trader.daily_trades == 0

    def test_reset_daily_updates_day_start(self):
        """Test reset_daily updates day_start."""
        trader = PaperTrader()
        old_date = trader.day_start
        trader.reset_daily()
        assert trader.day_start >= old_date


class TestIDGeneration:
    """Tests for ID generation."""

    def test_order_id_format(self):
        """Test order ID format."""
        trader = PaperTrader()
        trader._order_counter = 5
        order_id = trader._generate_order_id()
        assert order_id == "PAPER-000006"

    def test_trade_id_format(self):
        """Test trade ID format."""
        trader = PaperTrader()
        trader._trade_counter = 10
        trade_id = trader._generate_trade_id()
        assert trade_id == "TRADE-000011"

    def test_order_ids_sequential(self):
        """Test order IDs are sequential."""
        trader = PaperTrader()
        id1 = trader._generate_order_id()
        id2 = trader._generate_order_id()
        assert int(id1.split('-')[1]) < int(id2.split('-')[1])

    def test_trade_ids_sequential(self):
        """Test trade IDs are sequential."""
        trader = PaperTrader()
        id1 = trader._generate_trade_id()
        id2 = trader._generate_trade_id()
        assert int(id1.split('-')[1]) < int(id2.split('-')[1])


class TestSingletonFunctions:
    """Tests for singleton instance management."""

    def setup_method(self):
        """Reset singletons before each test."""
        import trading.paper_trader as pt
        pt._paper_traders.clear()
        pt._default_paper_trader = None

    def test_get_paper_trader_default(self):
        """Test get_paper_trader returns default instance."""
        trader = get_paper_trader()
        assert trader is not None
        assert isinstance(trader, PaperTrader)

    def test_get_paper_trader_same_instance(self):
        """Test get_paper_trader returns same instance."""
        trader1 = get_paper_trader()
        trader2 = get_paper_trader()
        assert trader1 is trader2

    def test_get_paper_trader_user_specific(self):
        """Test get_paper_trader creates user-specific instance."""
        trader1 = get_paper_trader(user_id=1)
        trader2 = get_paper_trader(user_id=2)
        assert trader1 is not trader2

    def test_get_paper_trader_same_user(self):
        """Test get_paper_trader returns same instance for same user."""
        trader1 = get_paper_trader(user_id=1)
        trader2 = get_paper_trader(user_id=1)
        assert trader1 is trader2

    def test_reset_paper_trader_default(self):
        """Test reset_paper_trader creates new default instance."""
        trader1 = get_paper_trader()
        trader1.cash = 500_000
        trader2 = reset_paper_trader()
        assert trader1 is not trader2
        assert trader2.cash == 1_000_000

    def test_reset_paper_trader_custom_capital(self):
        """Test reset_paper_trader with custom capital."""
        trader = reset_paper_trader(capital=500_000)
        assert trader.initial_capital == 500_000
        assert trader.cash == 500_000

    @patch.object(PaperTrader, '_load_todays_trades_from_journal')
    def test_reset_paper_trader_user(self, mock_load):
        """Test reset_paper_trader for specific user."""
        trader1 = get_paper_trader(user_id=1)
        trader1.cash = 500_000
        trader2 = reset_paper_trader(user_id=1)
        assert trader2.cash == 1_000_000

    def test_clear_paper_trader(self):
        """Test clear_paper_trader removes user instance."""
        get_paper_trader(user_id=1)
        clear_paper_trader(1)
        import trading.paper_trader as pt
        assert 1 not in pt._paper_traders


class TestLoadTodaysTrades:
    """Tests for loading today's trades from journal."""

    def test_load_with_no_journal_file(self):
        """Test loading when journal file doesn't exist."""
        with patch('trading.paper_trader.Path') as mock_path:
            mock_path.return_value.parent.parent.__truediv__.return_value.exists.return_value = False
            trader = PaperTrader()
            assert trader.daily_pnl == 0.0

    @patch('trading.paper_trader._config_available', False)
    def test_load_handles_missing_journal_gracefully(self):
        """Test graceful handling when journal module unavailable."""
        trader = PaperTrader()
        assert trader.daily_pnl == 0.0
        assert trader.daily_trades == 0


class TestIntegrationScenarios:
    """Integration tests for realistic trading scenarios."""

    def test_full_trade_cycle_profit(self):
        """Test complete trade cycle with profit."""
        trader = PaperTrader(initial_capital=1_000_000)

        order = trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        assert order.status == OrderStatus.FILLED

        trader.update_prices({"RELIANCE": 2700.0})

        assert len(trader.trades) == 1
        trade = trader.trades[0]
        assert trade.exit_reason == ExitReason.TAKE_PROFIT
        assert trade.pnl > 0
        assert trade.pnl_pct > 0

    def test_full_trade_cycle_loss(self):
        """Test complete trade cycle with loss."""
        trader = PaperTrader(initial_capital=1_000_000)

        trader.place_order(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            price=2500.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )

        trader.update_prices({"RELIANCE": 2350.0})

        assert len(trader.trades) == 1
        trade = trader.trades[0]
        assert trade.exit_reason == ExitReason.STOP_LOSS
        assert trade.pnl < 0

    def test_multiple_trades_accumulation(self):
        """Test multiple trades accumulate correctly."""
        trader = PaperTrader(initial_capital=10_000_000)

        for symbol in ["A", "B", "C"]:
            trader.place_order(symbol, OrderSide.BUY, 100, 100.0, 95.0, 110.0)
            trader.close_position(symbol, 105.0)

        assert len(trader.trades) == 3
        status = trader.get_portfolio_status()
        assert status['trades'] == 3

    def test_trading_costs_reduce_profit(self):
        """Test trading costs reduce net profit."""
        trader = PaperTrader(initial_capital=1_000_000)

        trader.place_order("TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        trade = trader.close_position("TEST", 105.0)

        assert trade.costs > 0
        assert trade.net_pnl < trade.pnl

    def test_portfolio_tracking_through_trades(self):
        """Test portfolio tracking through multiple trades."""
        trader = PaperTrader(initial_capital=1_000_000)

        trader.place_order("A", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        trader.close_position("A", 105.0)

        trader.place_order("B", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        trader.close_position("B", 95.0)

        status = trader.get_portfolio_status()
        assert status['trades'] == 2
        assert status['realized_pnl'] != 0

    def test_exact_sl_tp_boundaries(self):
        """Test exact SL and TP price boundaries."""
        trader = PaperTrader(initial_capital=1_000_000)

        trader.place_order("TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)

        trader.update_prices({"TEST": 95.0})
        assert "TEST" not in trader.positions
        assert trader.trades[0].exit_reason == ExitReason.STOP_LOSS

    def test_price_between_sl_tp_no_exit(self):
        """Test price between SL and TP doesn't trigger exit."""
        trader = PaperTrader(initial_capital=1_000_000)

        trader.place_order("TEST", OrderSide.BUY, 100, 100.0, 95.0, 110.0)
        trader.update_prices({"TEST": 102.0})

        assert "TEST" in trader.positions
        assert len(trader.trades) == 0

    def test_short_position_full_cycle(self):
        """Test complete short position cycle."""
        trader = PaperTrader(initial_capital=1_000_000)

        trader.place_order(
            "TEST", OrderSide.SELL, 100, 100.0,
            stop_loss=105.0,
            take_profit=90.0,
        )

        trader.update_prices({"TEST": 90.0})

        assert len(trader.trades) == 1
        trade = trader.trades[0]
        assert trade.exit_reason == ExitReason.TAKE_PROFIT
        assert trade.pnl > 0


@pytest.mark.unit
class TestPaperTraderSimulations:
    """Tests for slippage and partial fill simulations in PaperTrader."""

    def test_slippage_on_entry_buy(self):
        """Test slippage is correctly applied to buy entry price."""
        # 1% slippage
        trader = PaperTrader(initial_capital=1_000_000, slippage_pct=0.01)
        order = trader.place_order("TEST", OrderSide.BUY, 100, 1000.0, 900.0, 1100.0)
        
        # Fill price should be 1000 * (1.01) = 1010
        assert order.fill_price == 1010.0
        assert trader.positions["TEST"].entry_price == 1010.0

    def test_slippage_on_entry_sell(self):
        """Test slippage is correctly applied to sell entry price."""
        # 1% slippage
        trader = PaperTrader(initial_capital=1_000_000, slippage_pct=0.01)
        order = trader.place_order("TEST", OrderSide.SELL, 100, 1000.0, 1100.0, 900.0)
        
        # Fill price should be 1000 * (0.99) = 990
        assert order.fill_price == 990.0
        assert trader.positions["TEST"].entry_price == 990.0

    def test_slippage_on_exit_buy(self):
        """Test slippage is correctly applied to buy exit price."""
        trader = PaperTrader(initial_capital=1_000_000, slippage_pct=0.01)
        trader.place_order("TEST", OrderSide.BUY, 100, 1000.0, 900.0, 1100.0)
        
        # Exit at 1050 with 1% slippage -> 1050 * 0.99 = 1039.5
        trade = trader.close_position("TEST", 1050.0)
        assert trade.exit_price == 1039.5

    def test_partial_fill_simulation(self):
        """Test partial fill simulation when max_fill_pct < 1.0."""
        # Set max_fill_pct to 0.7, so fills should be between 50% and 70%
        # (Our implementation does random.uniform(0.5, 1.0) * max_fill_pct if max_fill_pct < 1.0)
        # Wait, our implementation was: fill_pct = random.uniform(0.5, 1.0) if self.max_fill_pct < 1.0 else 1.0
        # fill_quantity = int(quantity * min(fill_pct, self.max_fill_pct))
        trader = PaperTrader(initial_capital=1_000_000, max_fill_pct=0.7, slippage_pct=0)
        order = trader.place_order("TEST", OrderSide.BUY, 100, 1000.0, 900.0, 1100.0)
        
        assert order.quantity <= 70
        assert order.quantity >= 50
        assert trader.positions["TEST"].quantity == order.quantity

    def test_fill_probability_failure(self):
        """Test order cancellation when fill probability fails."""
        # 0% fill probability
        trader = PaperTrader(initial_capital=1_000_000, fill_probability=0.0)
        order = trader.place_order("TEST", OrderSide.BUY, 100, 1000.0, 900.0, 1100.0)
        
        assert order.status == OrderStatus.CANCELLED
        assert "TEST" not in trader.positions

    def test_sell_sl_exact_boundary(self):
        """Test SELL SL triggers at exact boundary price."""
        trader = PaperTrader(initial_capital=1_000_000)
        trader.place_order(
            "TEST", OrderSide.SELL, 100, 100.0,
            stop_loss=105.0,
            take_profit=90.0,
        )
        # Price exactly at SL for SELL (>= stop_loss triggers SL)
        trader.update_prices({"TEST": 105.0})
        assert "TEST" not in trader.positions
        assert len(trader.trades) == 1
        assert trader.trades[0].exit_reason == ExitReason.STOP_LOSS


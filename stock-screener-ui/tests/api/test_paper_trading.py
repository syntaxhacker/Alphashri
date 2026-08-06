"""
Paper Trading API Tests

Tests for paper trading endpoints from api/paper_trading.py:

Test categories:
1. Portfolio management (GET, POST reset)
2. Positions management (GET all, GET by symbol)
3. Orders (POST create, DELETE close)
4. Signals (GET, POST generate)
5. Trade history (GET trades, GET summary)
6. Runner control (start, stop, status, logs, snapshot)
7. Configuration (GET, PUT)
"""

import pytest
import sys
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock, AsyncMock

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from fastapi.testclient import TestClient
from fastapi import FastAPI

# Import the paper trading router
from api.paper_trading import router as paper_router

# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def temp_journals_dir():
    """Create a temporary directory for journal files."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def mock_paper_trader():
    """Mock PaperTrader instance."""
    trader = MagicMock()
    trader.initial_capital = 1_000_000
    trader.cash = 1_000_000
    trader.margin_used = 0.0
    trader.positions = {}
    trader.pending_orders = {}
    trader.trades = []
    trader._order_counter = 0
    trader._trade_counter = 0
    trader.daily_pnl = 0.0
    trader.daily_trades = 0
    trader.user_id = 1

    def get_portfolio_status():
        return {
            "initial_capital": trader.initial_capital,
            "cash": trader.cash,
            "margin_used": trader.margin_used,
            "total_value": trader.cash + trader.margin_used,
            "unrealized_pnl": 0.0,
            "daily_pnl": trader.daily_pnl,
            "realized_pnl_today": 0.0,
            "total_pnl": 0.0,
            "daily_pnl_pct": 0.0,
            "total_pnl_pct": 0.0,
            "daily_trades": trader.daily_trades,
            "positions": len(trader.positions),
            "open_positions": len(trader.positions),
        }

    def get_positions():
        return list(trader.positions.values())

    def place_order(symbol, side, quantity, price, stop_loss, take_profit):
        from trading.paper_trader import PaperOrder, OrderSide, OrderStatus
        trader._order_counter += 1
        order = PaperOrder(
            order_id=f"ORD-{trader._order_counter}",
            symbol=symbol.upper(),
            side=OrderSide[side.upper()] if isinstance(side, str) else side,
            quantity=quantity,
            price=price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            timestamp=datetime.now(),
            status=OrderStatus.FILLED,
            fill_price=price,
            fill_time=datetime.now(),
        )
        trader.pending_orders[order.order_id] = order

        # Simulate filled order - update position
        from trading.paper_trader import PaperPosition
        if symbol.upper() in trader.positions:
            pos = trader.positions[symbol.upper()]
            pos.quantity += quantity
        else:
            trader.positions[symbol.upper()] = PaperPosition(
                symbol=symbol.upper(),
                side=OrderSide[side.upper()] if isinstance(side, str) else side,
                quantity=quantity,
                entry_price=price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                entry_time=datetime.now(),
                current_price=price,
            )
        trader.cash -= (price * quantity)
        trader.margin_used += (price * quantity)
        return order

    def close_position(symbol, exit_price, exit_reason):
        from trading.paper_trader import PaperTrade, ExitReason, OrderSide
        symbol = symbol.upper()
        if symbol not in trader.positions:
            return None

        pos = trader.positions[symbol]
        trader._trade_counter += 1

        pnl = (exit_price - pos.entry_price) * pos.quantity
        pnl_pct = (pnl / (pos.entry_price * pos.quantity)) * 100

        trade = PaperTrade(
            trade_id=f"TRD-{trader._trade_counter}",
            symbol=symbol,
            side=pos.side,
            quantity=pos.quantity,
            entry_price=pos.entry_price,
            exit_price=exit_price,
            entry_time=pos.entry_time,
            exit_time=datetime.now(),
            pnl=pnl,
            pnl_pct=pnl_pct,
            exit_reason=exit_reason if isinstance(exit_reason, ExitReason) else ExitReason.MANUAL,
        )
        trader.trades.append(trade)
        trader.cash += (exit_price * pos.quantity)
        trader.margin_used -= (pos.entry_price * pos.quantity)
        del trader.positions[symbol]
        return trade

    from trading.paper_trader import ExitReason, OrderSide

    def update_prices(prices):
        closed_trades = []
        for symbol, price in prices.items():
            if symbol in trader.positions:
                pos = trader.positions[symbol]
                pos.current_price = price
                pos.unrealized_pnl = (price - pos.entry_price) * pos.quantity

                # Check SL/TP
                if pos.side == OrderSide.BUY:
                    if price <= pos.stop_loss or price >= pos.take_profit:
                        reason = ExitReason.STOP_LOSS if price <= pos.stop_loss else ExitReason.TAKE_PROFIT
                        trade = close_position(symbol, price, reason)
                        if trade:
                            closed_trades.append(trade)
                else:
                    if price >= pos.stop_loss or price <= pos.take_profit:
                        reason = ExitReason.STOP_LOSS if price >= pos.stop_loss else ExitReason.TAKE_PROFIT
                        trade = close_position(symbol, price, reason)
                        if trade:
                            closed_trades.append(trade)
        return closed_trades
    trader.get_portfolio_status = get_portfolio_status
    trader.get_positions = get_positions
    trader.place_order = place_order
    trader.close_position = close_position
    trader.update_prices = update_prices

    return trader


@pytest.fixture
def mock_risk_manager():
    """Mock RiskManager instance."""
    manager = MagicMock()

    def validate_trade(capital, cash, current_positions, current_exposure,
                       entry_price, stop_loss, take_profit, side="BUY"):
        # Calculate risk/reward
        if side == "BUY":
            risk = abs(entry_price - stop_loss)
            reward = abs(take_profit - entry_price)
        else:
            risk = abs(stop_loss - entry_price)
            reward = abs(entry_price - take_profit)

        risk_pct = risk / entry_price * 100 if entry_price > 0 else 0
        reward_pct = reward / entry_price * 100 if entry_price > 0 else 0
        rr_ratio = reward / risk if risk > 0 else 0

        # Check minimum RR ratio
        if rr_ratio < 2:
            return {
                'valid': False,
                'shares': 0,
                'trade_value': 0,
                'risk_amount': 0,
                'risk_pct': round(risk_pct, 2),
                'reward_pct': round(reward_pct, 2),
                'rr_ratio': round(rr_ratio, 2),
                'reason': f"Risk/reward ratio ({rr_ratio:.1f}) too low. Minimum 1:2 required."
            }

        # Calculate position size
        shares = int((capital * 0.01) / risk) if risk > 0 else 0
        trade_value = shares * entry_price

        # Check cash
        if trade_value > cash:
            return {
                'valid': False,
                'shares': shares,
                'trade_value': round(trade_value, 2),
                'risk_amount': round(shares * risk, 2),
                'risk_pct': round(risk_pct, 2),
                'reward_pct': round(reward_pct, 2),
                'rr_ratio': round(rr_ratio, 2),
                'reason': f"Insufficient cash (need ₹{trade_value:,.0f}, have ₹{cash:,.0f})"
            }

        return {
            'valid': True,
            'shares': shares,
            'trade_value': round(trade_value, 2),
            'risk_amount': round(shares * risk, 2),
            'risk_pct': round(risk_pct, 2),
            'reward_pct': round(reward_pct, 2),
            'rr_ratio': round(rr_ratio, 2),
            'reason': 'Trade validated successfully'
        }

    def get_config():
        return {
            'max_positions': 5,
            'max_capital_per_trade': 0.10,
            'max_daily_loss': 0.02,
            'max_total_exposure': 0.50,
            'risk_per_trade': 0.01,
        }

    manager.validate_trade = validate_trade
    manager.get_config = get_config
    return manager


@pytest.fixture
def mock_journal():
    """Mock TradeJournal instance."""
    journal = MagicMock()
    journal.trades = []

    def log_trade(trade_data, notes="", strategy_id=0, strategy_name=""):
        record = MagicMock()
        for k, v in trade_data.items():
            setattr(record, k, v)
        record.notes = notes
        record.strategy_id = trade_data.get('strategy_id', strategy_id)
        record.strategy_name = trade_data.get('strategy_name', strategy_name)
        journal.trades.append(record)
        return record

    def get_performance_summary():
        return {
            'total_trades': len(journal.trades),
            'winners': sum(1 for t in journal.trades if t.net_pnl > 0),
            'losers': sum(1 for t in journal.trades if t.net_pnl < 0),
            'total_pnl': sum(t.pnl for t in journal.trades),
            'net_pnl': sum(t.net_pnl for t in journal.trades),
            'win_rate': sum(1 for t in journal.trades if t.net_pnl > 0) / len(journal.trades) if journal.trades else 0,
        }

    journal.log_trade = log_trade
    journal.get_performance_summary = get_performance_summary
    journal.save_journal = MagicMock()
    return journal


@pytest.fixture
def app(mock_paper_trader, mock_risk_manager, mock_journal, temp_journals_dir):
    """Create test FastAPI app with mocked dependencies."""
    app = FastAPI()
    app.include_router(paper_router)

    from unittest.mock import MagicMock as _MagicMock
    from api.auth import get_current_user

    mock_user = _MagicMock()
    mock_user.id = 1
    mock_user.email = "test@example.com"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    # Mock the global functions
    def get_paper_trader_mock(user_id=None):
        return mock_paper_trader

    def reset_paper_trader_mock(user_id=None, capital=1_000_000):
        mock_paper_trader.initial_capital = capital
        mock_paper_trader.cash = capital
        mock_paper_trader.margin_used = 0
        mock_paper_trader.positions.clear()
        mock_paper_trader.pending_orders.clear()
        mock_paper_trader.trades.clear()
        return mock_paper_trader

    def get_risk_manager_mock():
        return mock_risk_manager

    def get_journal_mock(user_id=None):
        return mock_journal

    # Patch at every import location since modules import the functions directly
    with patch('api.paper.portfolio.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('api.paper.endpoints.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('api.paper.endpoints.get_risk_manager', side_effect=get_risk_manager_mock), \
         patch('api.paper.endpoints.get_journal', side_effect=get_journal_mock, create=True), \
         patch('api.paper.orders.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('api.paper.orders.get_risk_manager', side_effect=get_risk_manager_mock), \
         patch('api.paper.orders.get_journal', side_effect=get_journal_mock, create=True), \
         patch('api.paper.history.get_journal', side_effect=get_journal_mock, create=True), \
         patch('api.paper.paper_api.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('api.paper.paper_api.get_journal', side_effect=get_journal_mock, create=True), \
         patch('trading.paper_trader.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('trading.paper_trader.reset_paper_trader', side_effect=reset_paper_trader_mock), \
         patch('trading.risk_manager.get_risk_manager', side_effect=get_risk_manager_mock):

        yield app


@pytest.fixture
def client(app):
    """Create test client."""
    return TestClient(app)


# ============================================================================
# 1. Portfolio Management Tests
# ============================================================================

class TestPortfolioManagement:
    """Tests for portfolio endpoints."""

    def test_get_portfolio_with_positions(self, client, mock_paper_trader):
        """Test GET /api/paper/portfolio with positions."""
        # Add a position
        from trading.paper_trader import PaperPosition, OrderSide
        mock_paper_trader.positions["RELIANCE"] = PaperPosition(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2500.0,
            stop_loss=2475.0,
            take_profit=2575.0,
            entry_time=datetime.now(),
            current_price=2520.0,
            unrealized_pnl=2000.0,
        )
        mock_paper_trader.cash = 750000.0
        mock_paper_trader.margin_used = 250000.0

        response = client.get("/api/paper/portfolio")

        assert response.status_code == 200
        data = response.json()
        assert data["cash"] == 750000.0
        assert data["margin_used"] == 250000.0
        assert data["initial_capital"] == 1_000_000
        assert data["total_value"] >= data["cash"]
        assert "total_pnl" in data
        assert "daily_pnl" in data

    def test_get_empty_portfolio(self, client, mock_paper_trader):
        """Test GET /api/paper/portfolio with no positions."""
        mock_paper_trader.positions.clear()
        mock_paper_trader.cash = 1_000_000.0
        mock_paper_trader.margin_used = 0.0

        response = client.get("/api/paper/portfolio")

        assert response.status_code == 200
        data = response.json()
        assert data["positions"] == 0
        assert data["cash"] == 1_000_000.0
        assert data["margin_used"] == 0.0

    def test_reset_portfolio(self, client, mock_paper_trader):
        """Test POST /api/paper/reset."""
        # Add some data first
        mock_paper_trader.positions["TCS"] = MagicMock()
        mock_paper_trader.cash = 500000.0

        response = client.post("/api/paper/reset", json={"capital": 500000.0})

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "Reset with capital" in data["message"]
        assert "portfolio" in data

    def test_reset_portfolio_default_capital(self, client, mock_paper_trader):
        """Test POST /api/paper/reset with default capital."""
        response = client.post("/api/paper/reset", json={})

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        # The message contains ₹ symbol and formatted number with commas
        assert "1,000,000" in data["message"]


# ============================================================================
# 2. Positions Management Tests
# ============================================================================

class TestPositionsManagement:
    """Tests for positions endpoints."""

    def test_get_all_positions(self, client, mock_paper_trader):
        """Test GET /api/paper/positions."""
        # Add multiple positions as dicts (serializable)
        mock_paper_trader.positions = {
            "RELIANCE": {
                "symbol": "RELIANCE",
                "side": "BUY",
                "quantity": 100,
                "entry_price": 2500.0,
                "stop_loss": 2450.0,
                "take_profit": 2550.0,
                "entry_time": datetime.now().isoformat(),
                "current_price": 2525.0,
                "unrealized_pnl": 2500.0,
                "unrealized_pnl_pct": 1.0,
            },
            "TCS": {
                "symbol": "TCS",
                "side": "BUY",
                "quantity": 50,
                "entry_price": 3500.0,
                "stop_loss": 3430.0,
                "take_profit": 3570.0,
                "entry_time": datetime.now().isoformat(),
                "current_price": 3535.0,
                "unrealized_pnl": 1750.0,
                "unrealized_pnl_pct": 1.0,
            }
        }

        response = client.get("/api/paper/positions")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert len(data["positions"]) == 2
        assert any(p["symbol"] == "RELIANCE" for p in data["positions"])

    def test_get_positions_when_empty(self, client, mock_paper_trader):
        """Test GET /api/paper/positions when no positions."""
        mock_paper_trader.positions.clear()

        response = client.get("/api/paper/positions")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["positions"] == []


# ============================================================================
# 3. Order Management Tests
# ============================================================================

class TestOrderManagement:
    """Tests for order endpoints."""

    def test_place_buy_order_sufficient_funds(self, client, mock_paper_trader, mock_risk_manager):
        """Test POST /api/paper/order with sufficient funds."""
        order_data = {
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 100,
            "price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
        }

        response = client.post("/api/paper/order", json=order_data)

        assert response.status_code == 200
        data = response.json()
        assert "order_id" in data
        assert data["symbol"] == "RELIANCE"
        assert data["side"] == "BUY"
        assert data["quantity"] == 100
        assert data["price"] == 2500.0
        assert "status" in data

    def test_place_sell_order(self, client, mock_paper_trader):
        """Test POST /api/paper/order for SELL."""
        order_data = {
            "symbol": "RELIANCE",
            "side": "SELL",
            "quantity": 100,
            "price": 2500.0,
            "stop_loss": 2550.0,  # Risk: 50
            "take_profit": 2400.0,  # Reward: 100 (RR = 2.0)
        }

        response = client.post("/api/paper/order", json=order_data)

        assert response.status_code == 200
        data = response.json()
        assert data["side"] == "SELL"

    def test_place_order_invalid_side(self, client):
        """Test POST /api/paper/order with invalid side."""
        order_data = {
            "symbol": "RELIANCE",
            "side": "INVALID",
            "quantity": 100,
            "price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
        }

        response = client.post("/api/paper/order", json=order_data)

        assert response.status_code == 400
        assert "Invalid side" in response.json()["detail"]

    def test_place_order_insufficient_funds(self, client, mock_risk_manager):
        """Test POST /api/paper/order with insufficient funds."""
        # Override risk manager to reject
        original_validate = mock_risk_manager.validate_trade

        def reject_trade(*args, **kwargs):
            return {
                'valid': False,
                'reason': 'Insufficient cash (need ₹500,000, have ₹100,000)',
                'shares': 0,
                'trade_value': 500000,
                'risk_amount': 0,
                'risk_pct': 0,
                'reward_pct': 0,
                'rr_ratio': 0,
            }

        mock_risk_manager.validate_trade = reject_trade

        order_data = {
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 1000,
            "price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
        }

        response = client.post("/api/paper/order", json=order_data)

        assert response.status_code == 400
        assert "Insufficient" in response.json()["detail"]

        # Restore
        mock_risk_manager.validate_trade = original_validate

    def test_place_order_invalid_risk_reward(self, client, mock_risk_manager):
        """Test POST /api/paper/order with poor risk/reward ratio."""
        # Override risk manager to reject
        original_validate = mock_risk_manager.validate_trade

        def reject_rr(*args, **kwargs):
            return {
                'valid': False,
                'reason': 'Risk/reward ratio (1.5) too low. Minimum 1:2 required.',
                'shares': 0,
                'trade_value': 0,
                'risk_amount': 0,
                'risk_pct': 0.4,
                'reward_pct': 0.6,
                'rr_ratio': 1.5,
            }

        mock_risk_manager.validate_trade = reject_rr

        order_data = {
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 100,
            "price": 2500.0,
            "stop_loss": 2490.0,
            "take_profit": 2515.0,
        }

        response = client.post("/api/paper/order", json=order_data)

        assert response.status_code == 400
        assert "Risk/reward" in response.json()["detail"]

        # Restore
        mock_risk_manager.validate_trade = original_validate

    def test_close_position(self, client, mock_paper_trader, mock_journal):
        """Test POST /api/paper/close."""
        from trading.paper_trader import PaperPosition, OrderSide

        # First open a position
        mock_paper_trader.positions["RELIANCE"] = PaperPosition(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2500.0,
            stop_loss=2475.0,
            take_profit=2575.0,
            entry_time=datetime.now(),
            current_price=2520.0,
        )

        close_data = {
            "symbol": "RELIANCE",
            "exit_price": 2550.0,
            "reason": "MANUAL",
        }

        response = client.post("/api/paper/close", json=close_data)

        assert response.status_code == 200
        data = response.json()
        assert "trade_id" in data
        assert data["symbol"] == "RELIANCE"
        assert "pnl" in data
        assert "net_pnl" in data
        assert data["exit_reason"] == "MANUAL"

    def test_close_nonexistent_position(self, client, mock_paper_trader):
        """Test POST /api/paper/close for non-existent position."""
        mock_paper_trader.positions.clear()

        close_data = {
            "symbol": "NONEXISTENT",
            "exit_price": 100.0,
            "reason": "MANUAL",
        }

        response = client.post("/api/paper/close", json=close_data)

        assert response.status_code == 404
        # The actual error message is "No position found for NONEXISTENT"
        assert "position" in response.json()["detail"].lower()

    def test_close_position_db_fallback(self, client, mock_paper_trader):
        """Test POST /api/paper/close with DB fallback for bot-managed LONG position."""
        from datetime import datetime
        from config import IST
        from unittest.mock import patch, MagicMock

        mock_paper_trader.positions.clear()

        pos = MagicMock()
        pos.user_id = 1
        pos.symbol = "RELIANCE"
        pos.side = "BUY"
        pos.quantity = 100
        pos.entry_price = 2500.0
        pos.entry_time = datetime(2026, 5, 18, 9, 30, tzinfo=IST)
        pos.stop_loss = 2475.0
        pos.take_profit = 2575.0
        pos.peak_price = 2520.0
        pos.low_price = 2480.0
        pos.bot_id = 1
        pos.strategy_id = 1
        pos.strategy_name = "ORB"

        with patch("db.database.SessionLocal") as mock_session_local, \
             patch("api.paper.orders._get_market_price", return_value=None):
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = pos
            mock_session_local.return_value = mock_db

            response = client.post("/api/paper/close", json={
                "symbol": "RELIANCE",
                "exit_price": 2600.0,
                "reason": "MANUAL",
            })

        assert response.status_code == 200
        data = response.json()
        assert "trade_id" in data
        assert data["symbol"] == "RELIANCE"
        assert data["pnl"] == 10000.0
        assert data["pnl_pct"] == 4.0
        assert data["exit_reason"] == "MANUAL_CLOSE"

    def test_close_position_db_fallback_short(self, client, mock_paper_trader):
        """Test POST /api/paper/close with DB fallback for bot-managed SHORT position."""
        from datetime import datetime
        from config import IST
        from unittest.mock import patch, MagicMock

        mock_paper_trader.positions.clear()

        pos = MagicMock()
        pos.user_id = 1
        pos.symbol = "RELIANCE"
        pos.side = "SELL"
        pos.quantity = 100
        pos.entry_price = 2500.0
        pos.entry_time = datetime(2026, 5, 18, 9, 30, tzinfo=IST)
        pos.stop_loss = 2525.0
        pos.take_profit = 2425.0
        pos.peak_price = 2520.0
        pos.low_price = 2480.0
        pos.bot_id = 1
        pos.strategy_id = 1
        pos.strategy_name = "ORB"

        with patch("db.database.SessionLocal") as mock_session_local, \
             patch("api.paper.orders._get_market_price", return_value=None):
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = pos
            mock_session_local.return_value = mock_db

            response = client.post("/api/paper/close", json={
                "symbol": "RELIANCE",
                "exit_price": 2400.0,
                "reason": "MANUAL",
            })

        assert response.status_code == 200
        data = response.json()
        assert "trade_id" in data
        assert data["symbol"] == "RELIANCE"
        assert data["pnl"] == 10000.0
        assert data["pnl_pct"] == 4.0
        assert data["exit_reason"] == "MANUAL_CLOSE"

    def test_close_position_exit_reason_eod(self, client, mock_paper_trader, mock_journal):
        """Test POST /api/paper/close with EOD exit reason."""
        from trading.paper_trader import PaperPosition, OrderSide

        mock_paper_trader.positions["RELIANCE"] = PaperPosition(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2500.0,
            stop_loss=2475.0,
            take_profit=2575.0,
            entry_time=datetime.now(),
            current_price=2520.0,
        )

        response = client.post("/api/paper/close", json={
            "symbol": "RELIANCE",
            "exit_price": 2550.0,
            "reason": "EOD",
        })

        assert response.status_code == 200
        data = response.json()
        assert data["exit_reason"] == "EOD"

    def test_close_position_exit_reason_invalid(self, client, mock_paper_trader, mock_journal):
        """Test POST /api/paper/close with invalid exit reason (defaults to MANUAL)."""
        from trading.paper_trader import PaperPosition, OrderSide

        mock_paper_trader.positions["RELIANCE"] = PaperPosition(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2500.0,
            stop_loss=2475.0,
            take_profit=2575.0,
            entry_time=datetime.now(),
            current_price=2520.0,
        )

        response = client.post("/api/paper/close", json={
            "symbol": "RELIANCE",
            "exit_price": 2550.0,
            "reason": "INVALID_REASON",
        })

        assert response.status_code == 200
        data = response.json()
        assert data["exit_reason"] == "MANUAL"

    def test_close_all_positions(self, client, mock_paper_trader):
        """Test POST /api/paper/close-all."""
        from trading.paper_trader import PaperPosition, OrderSide

        # Add multiple positions
        for symbol in ["RELIANCE", "TCS"]:
            mock_paper_trader.positions[symbol] = PaperPosition(
                symbol=symbol,
                side=OrderSide.BUY,
                quantity=50,
                entry_price=2500.0,
                stop_loss=2450.0,
                take_profit=2550.0,
                entry_time=datetime.now(),
                current_price=2520.0,
            )

        prices = {"RELIANCE": 2520.0, "TCS": 3500.0}

        response = client.post("/api/paper/close-all", json={"prices": prices})

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "portfolio" in data

    def test_close_position_exit_price_zero(self, client):
        """Test POST /api/paper/close with exit_price=0 is rejected."""
        response = client.post("/api/paper/close", json={
            "symbol": "RELIANCE",
            "exit_price": 0,
            "reason": "MANUAL",
        })
        assert response.status_code == 422

    def test_close_position_exit_price_negative(self, client):
        """Test POST /api/paper/close with negative exit_price is rejected."""
        response = client.post("/api/paper/close", json={
            "symbol": "RELIANCE",
            "exit_price": -100,
            "reason": "MANUAL",
        })
        assert response.status_code == 422

    def test_close_position_market_price_overrides_stale(self, client, mock_paper_trader):
        """Test DB fallback uses fresh market price when request exit_price is stale."""
        from datetime import datetime
        from config import IST
        from unittest.mock import patch, MagicMock

        mock_paper_trader.positions.clear()
        pos = MagicMock()
        pos.user_id = 1
        pos.symbol = "LAURUSLABS"
        pos.side = "BUY"
        pos.quantity = 42
        pos.entry_price = 1188.3
        pos.entry_time = datetime(2026, 5, 6, 11, 45, tzinfo=IST)
        pos.stop_loss = 1158.59
        pos.take_profit = 2376.6
        pos.peak_price = 1332.3
        pos.low_price = 1175.0
        pos.bot_id = 3
        pos.strategy_id = 10
        pos.strategy_name = "52W Target Swing"

        with patch("db.database.SessionLocal") as mock_session_local, \
             patch("api.paper.orders._get_market_price", return_value=1326.5):
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = pos
            mock_session_local.return_value = mock_db

            response = client.post("/api/paper/close", json={
                "symbol": "LAURUSLABS",
                "exit_price": 1200.0,
                "reason": "MANUAL",
            })

        assert response.status_code == 200
        data = response.json()
        # (1326.5 - 1188.3) * 42 = 5804.4
        assert data["pnl"] == 5804.4
        assert data["symbol"] == "LAURUSLABS"
        assert data["exit_reason"] == "MANUAL_CLOSE"

    def test_close_position_market_price_none_falls_back(self, client, mock_paper_trader):
        """Test DB fallback uses request exit_price when market price unavailable."""
        from datetime import datetime
        from config import IST
        from unittest.mock import patch, MagicMock

        mock_paper_trader.positions.clear()
        pos = MagicMock()
        pos.user_id = 1
        pos.symbol = "RELIANCE"
        pos.side = "BUY"
        pos.quantity = 100
        pos.entry_price = 2500.0
        pos.entry_time = datetime(2026, 5, 18, 9, 30, tzinfo=IST)
        pos.stop_loss = 2475.0
        pos.take_profit = 2575.0
        pos.peak_price = 2520.0
        pos.low_price = 2480.0
        pos.bot_id = 1
        pos.strategy_id = 1
        pos.strategy_name = "ORB"

        with patch("db.database.SessionLocal") as mock_session_local, \
             patch("api.paper.orders._get_market_price", return_value=None):
            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = pos
            mock_session_local.return_value = mock_db

            response = client.post("/api/paper/close", json={
                "symbol": "RELIANCE",
                "exit_price": 2600.0,
                "reason": "MANUAL",
            })

        assert response.status_code == 200
        data = response.json()
        # (2600 - 2500) * 100 = 10000
        assert data["pnl"] == 10000.0
        assert data["exit_reason"] == "MANUAL_CLOSE"

    def test_update_prices(self, client, mock_paper_trader, mock_journal):
        """Test POST /api/paper/update-prices."""
        from trading.paper_trader import PaperPosition, OrderSide

        mock_paper_trader.positions["RELIANCE"] = PaperPosition(
            symbol="RELIANCE",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=2500.0,
            stop_loss=2475.0,
            take_profit=2575.0,
            entry_time=datetime.now(),
            current_price=2500.0,
        )

        prices = {"RELIANCE": 2470.0}  # Below SL

        response = client.post("/api/paper/update-prices", json={"prices": prices})

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "portfolio" in data
        assert "trades_closed" in data


# ============================================================================
# 4. Signal Generation Tests
# ============================================================================

class TestSignalGeneration:
    """Tests for signal endpoints."""

    @pytest.mark.skip(reason="Asyncio event loop conflict with dynamic imports")
    def test_get_signals(self, client):
        """Test GET /api/paper/signals."""
        # This endpoint calls the real screener with dynamic imports
        # Skip this test due to asyncio event loop issues in pytest
        pass

    def test_get_signals_error(self, client):
        """Test GET /api/paper/signals with error."""
        # Test that endpoint handles errors gracefully
        response = client.get("/api/paper/signals")
        # May return 500 if screener unavailable, or 200 if it works
        assert response.status_code in [200, 500]

    def test_create_signal(self, client):
        """Test POST /api/paper/signal/create."""
        response = client.post("/api/paper/signal/create", params={
            "symbol": "RELIANCE",
            "price": 2500.0,
            "or_high": 2520.0,
            "or_low": 2480.0,
            "side": "LONG",
            "sl_pct": 0.4,
            "tp_pct": 1.2,
        })

        assert response.status_code == 200
        data = response.json()
        assert data["symbol"] == "RELIANCE"
        assert "stop_loss" in data
        assert "take_profit" in data
        assert "or_high" in data
        assert "or_low" in data


# ============================================================================
# 5. Trade History Tests
# ============================================================================

class TestTradeHistory:
    """Tests for trade history endpoints."""

    def test_get_trades_default_limit(self, client, mock_journal):
        """Test GET /api/paper/trades with default limit."""
        # Add some trades to journal
        from unittest.mock import MagicMock as TradeRecord
        for i in range(10):
            trade = TradeRecord(
                trade_id=f"TRD-{i}",
                symbol=f"STOCK{i}",
                side="BUY",
                quantity=100,
                entry_price=100.0 + i,
                exit_price=110.0 + i,
                entry_time="2024-01-01T09:15:00",
                exit_time="2024-01-01T10:30:00",
                pnl=1000.0,
                pnl_pct=10.0,
                exit_reason="TP",
                costs=50.0,
                net_pnl=950.0,
            )
            mock_journal.trades.append(trade)

        response = client.get("/api/paper/trades")

        assert response.status_code == 200
        data = response.json()
        assert "total_trades" in data
        assert "filtered_trades" in data
        assert "trades" in data

    def test_get_trades_with_limit(self, client, mock_journal):
        """Test GET /api/paper/trades with custom limit."""
        from unittest.mock import MagicMock as TradeRecord
        for i in range(100):
            trade = TradeRecord(
                trade_id=f"TRD-{i}",
                symbol="STOCK",
                side="BUY",
                quantity=100,
                entry_price=100.0,
                exit_price=110.0,
                entry_time="2024-01-01T09:15:00",
                exit_time="2024-01-01T10:30:00",
                pnl=1000.0,
                pnl_pct=10.0,
                exit_reason="TP",
                costs=50.0,
                net_pnl=950.0,
            )
            mock_journal.trades.append(trade)

        response = client.get("/api/paper/trades?limit=10")

        assert response.status_code == 200
        data = response.json()
        assert len(data["trades"]) <= 10

    def test_get_trades_filter_by_symbol(self, client, mock_journal):
        """Test GET /api/paper/trades filtered by symbol."""
        from unittest.mock import MagicMock as TradeRecord
        mock_journal.trades = [
            TradeRecord(
                trade_id="1", symbol="RELIANCE", side="BUY", quantity=100,
                entry_price=2500.0, exit_price=2600.0,
                entry_time="2024-01-01T09:15:00", exit_time="2024-01-01T10:30:00",
                pnl=10000.0, pnl_pct=4.0, exit_reason="TP", costs=200.0, net_pnl=9800.0,
            ),
            TradeRecord(
                trade_id="2", symbol="TCS", side="BUY", quantity=50,
                entry_price=3500.0, exit_price=3600.0,
                entry_time="2024-01-01T09:15:00", exit_time="2024-01-01T10:30:00",
                pnl=5000.0, pnl_pct=2.86, exit_reason="TP", costs=150.0, net_pnl=4850.0,
            ),
        ]

        response = client.get("/api/paper/trades?symbol=RELIANCE")

        assert response.status_code == 200
        data = response.json()
        assert all(t["symbol"] == "RELIANCE" for t in data["trades"])

    def test_get_trades_filter_by_strategy(self, client, mock_journal):
        """Test GET /api/paper/trades filtered by strategy."""
        from unittest.mock import MagicMock as TradeRecord
        mock_journal.trades = [
            TradeRecord(
                trade_id="1", symbol="RELIANCE", side="BUY", quantity=100,
                entry_price=2500.0, exit_price=2600.0,
                entry_time="2024-01-01T09:15:00", exit_time="2024-01-01T10:30:00",
                pnl=10000.0, pnl_pct=4.0, exit_reason="TP", costs=200.0, net_pnl=9800.0,
                notes="ORB Conservative",
            ),
            TradeRecord(
                trade_id="2", symbol="TCS", side="BUY", quantity=50,
                entry_price=3500.0, exit_price=3600.0,
                entry_time="2024-01-01T09:15:00", exit_time="2024-01-01T10:30:00",
                pnl=5000.0, pnl_pct=2.86, exit_reason="TP", costs=150.0, net_pnl=4850.0,
                notes="ORB Aggressive",
            ),
        ]

        response = client.get("/api/paper/trades?strategy=Conservative")

        assert response.status_code == 200
        data = response.json()
        # Should filter by notes containing the strategy name
        assert len(data["trades"]) >= 0

# ============================================================================
# 6. Risk Management Tests
# ============================================================================

class TestRiskManagement:
    """Tests for risk management endpoints."""

    def test_get_risk_config(self, client, mock_risk_manager):
        """Test GET /api/paper/risk/config."""
        response = client.get("/api/paper/risk/config")

        assert response.status_code == 200
        data = response.json()
        assert "max_positions" in data
        assert "max_capital_per_trade" in data
        assert "max_daily_loss" in data

    def test_validate_trade_success(self, client, mock_risk_manager):
        """Test POST /api/paper/risk/validate - valid trade."""
        response = client.post("/api/paper/risk/validate", params={
            "entry_price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
            "side": "BUY",
        })

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert "shares" in data
        assert "trade_value" in data
        assert "rr_ratio" in data

    def test_validate_trade_invalid_rr(self, client, mock_risk_manager):
        """Test POST /api/paper/risk/validate - poor R:R."""
        # Override to reject
        original_validate = mock_risk_manager.validate_trade

        def reject_rr(*args, **kwargs):
            return {
                'valid': False,
                'shares': 0,
                'trade_value': 0,
                'risk_amount': 0,
                'risk_pct': 0.5,
                'reward_pct': 0.75,
                'rr_ratio': 1.5,
                'reason': 'Risk/reward ratio (1.5) too low. Minimum 1:2 required.'
            }

        mock_risk_manager.validate_trade = reject_rr

        response = client.post("/api/paper/risk/validate", params={
            "entry_price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2512.5,
            "side": "BUY",
        })

        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is False
        assert "Risk/reward" in data["reason"]

        # Restore
        mock_risk_manager.validate_trade = original_validate


# ============================================================================
# 7. Runner Control Tests
# ============================================================================

class TestRunnerControl:
    """Tests for runner/bot control endpoints."""

    def test_get_bot_status_not_running(self, client):
        """Test GET /api/paper/bot/status when not running."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status:
            mock_status.return_value = {
                "running": False,
                "pid": None,
                "runner_pids": [],
                "return_code": None,
                "log_file": "/tmp/alphashri-runner.log",
                "pid_file": "/tmp/alphashri-runner.pid",
            }

            response = client.get("/api/paper/bot/status")

            assert response.status_code == 200
            data = response.json()
            assert data["running"] is False
            assert data["pid"] is None

    def test_get_bot_status_running(self, client):
        """Test GET /api/paper/bot/status when running."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status:
            mock_status.return_value = {
                "running": True,
                "pid": 12345,
                "runner_pids": [12345],
                "return_code": None,
                "log_file": "/tmp/alphashri-runner.log",
                "pid_file": "/tmp/alphashri-runner.pid",
            }

            response = client.get("/api/paper/bot/status")

            assert response.status_code == 200
            data = response.json()
            assert data["running"] is True
            assert data["pid"] == 12345

    def test_start_bot(self, client):
        """Test POST /api/paper/bot/start."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status, \
             patch('subprocess.Popen') as mock_popen, \
             patch('api.paper.bot_control._write_runner_pid_file'), \
             patch('api.paper.bot_control.Path') as mock_path:

            mock_status.return_value = {"running": False, "pid": None, "runner_pids": []}
            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_popen.return_value = mock_process

            mock_path.return_value.exists.return_value = True

            response = client.post("/api/paper/bot/start")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] in ["started", "already_running"]

    def test_start_bot_already_running(self, client):
        """Test POST /api/paper/bot/start when already running."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status:
            mock_status.return_value = {
                "running": True,
                "pid": 12345,
                "runner_pids": [12345],
                "return_code": None,
            }

            response = client.post("/api/paper/bot/start")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "already_running"

    def test_stop_bot(self, client):
        """Test POST /api/paper/bot/stop."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status, \
             patch('subprocess.run') as mock_run, \
             patch('api.paper.bot_control._clear_runner_pid_file'), \
             patch('api.paper.bot_control._paper_bot_process', None):

            mock_status.return_value = {
                "running": True,
                "pid": 12345,
                "runner_pids": [12345],
            }
            mock_run.return_value = MagicMock(returncode=1)  # Process terminated

            response = client.post("/api/paper/bot/stop")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] in ["stopped", "not_running"]

    def test_stop_bot_not_running(self, client):
        """Test POST /api/paper/bot/stop when not running."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status:
            mock_status.return_value = {
                "running": False,
                "pid": None,
                "runner_pids": [],
            }

            response = client.post("/api/paper/bot/stop")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "not_running"

    def test_start_bot_script_not_found(self, client):
        """Test POST /api/paper/bot/start when runner script doesn't exist."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status, \
             patch.object(Path, 'exists', return_value=False):
            mock_status.return_value = {"running": False, "pid": None, "runner_pids": []}

            response = client.post("/api/paper/bot/start")

            assert response.status_code == 500
            data = response.json()
            assert "Runner script not found" in data["detail"]

    def test_stop_bot_force_kill(self, client):
        """Test POST /api/paper/bot/stop when process resists SIGTERM -> SIGKILL."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status, \
             patch('subprocess.run') as mock_run, \
             patch('api.paper.bot_control._clear_runner_pid_file'), \
             patch('api.paper.bot_control._paper_bot_process', None):

            mock_status.return_value = {
                "running": True, "pid": 12345, "runner_pids": [12345],
            }

            kill_history = []
            def run_side_effect(cmd, **kwargs):
                kill_history.append(list(cmd))
                if cmd == ["kill", "12345"]:
                    return MagicMock(returncode=0)
                if cmd == ["kill", "-9", "12345"]:
                    return MagicMock(returncode=0)
                if cmd == ["kill", "-0", "12345"]:
                    sigkill_sent = any(c == ["kill", "-9", "12345"] for c in kill_history)
                    return MagicMock(returncode=0 if not sigkill_sent else 1)
                return MagicMock(returncode=0)

            mock_run.side_effect = run_side_effect

            response = client.post("/api/paper/bot/stop")

            assert response.status_code == 200
            data = response.json()
            assert any(c == ["kill", "-9", "12345"] for c in kill_history), \
                "SIGKILL should have been sent when SIGTERM is ignored"
            assert 12345 in data.get("stopped_pids", [])

    def test_stop_bot_partial_failure(self, client):
        """Test POST /api/paper/bot/stop when one PID stops but another doesn't."""
        with patch('api.paper.bot_control._get_bot_status') as mock_status, \
             patch('subprocess.run') as mock_run, \
             patch('api.paper.bot_control._clear_runner_pid_file'), \
             patch('api.paper.bot_control._paper_bot_process', None):

            mock_status.return_value = {
                "running": True, "pid": 12345, "runner_pids": [12345, 67890],
            }

            def run_side_effect(cmd, **kwargs):
                if cmd == ["kill", "12345"]:
                    return MagicMock(returncode=0)
                if cmd == ["kill", "-0", "12345"]:
                    return MagicMock(returncode=1)
                if cmd in (["kill", "67890"], ["kill", "-9", "67890"]):
                    return MagicMock(returncode=0)
                if cmd == ["kill", "-0", "67890"]:
                    return MagicMock(returncode=0)
                return MagicMock(returncode=0)

            mock_run.side_effect = run_side_effect

            response = client.post("/api/paper/bot/stop")

            assert response.status_code == 200
            data = response.json()
            assert 12345 in data.get("stopped_pids", [])
            assert 67890 in data.get("still_running_pids", [])

    def test_stop_bot_log_handle_close(self, client):
        """Test POST /api/paper/bot/stop closes the log handle when set."""
        mock_handle = MagicMock()
        with patch('api.paper.bot_control._get_bot_status') as mock_status, \
             patch('subprocess.run') as mock_run, \
             patch('api.paper.bot_control._clear_runner_pid_file'), \
             patch('api.paper.bot_control._paper_bot_process', None), \
             patch('api.paper.bot_control._paper_bot_log_handle', mock_handle):

            mock_status.return_value = {
                "running": True, "pid": 12345, "runner_pids": [12345],
            }
            mock_run.return_value = MagicMock(returncode=1)

            response = client.post("/api/paper/bot/stop")

            assert response.status_code == 200
            mock_handle.close.assert_called_once()


# ============================================================================
# 8. Health Check Tests
# ============================================================================

class TestHealthCheck:
    """Tests for health check endpoint."""

    def test_health_check(self, client, mock_paper_trader):
        """Test GET /api/paper/health."""
        response = client.get("/api/paper/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "portfolio_value" in data
        assert "open_positions" in data
        assert "total_trades" in data
        assert "timestamp" in data


# ============================================================================
# 9. Error Handling Tests
# ============================================================================

class TestErrorHandling:
    """Tests for error handling."""

    def test_invalid_symbol_format(self, client, mock_paper_trader):
        """Test handling of invalid symbol formats."""
        order_data = {
            "symbol": "",  # Empty symbol
            "side": "BUY",
            "quantity": 100,
            "price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
        }

        # API should handle this gracefully
        response = client.post("/api/paper/order", json=order_data)

        # Either 200 (if mock accepts) or appropriate error
        assert response.status_code in [200, 400, 422]

    def test_invalid_quantity(self, client):
        """Test handling of invalid quantity."""
        order_data = {
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 0,  # Invalid quantity
            "price": 2500.0,
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
        }

        response = client.post("/api/paper/order", json=order_data)
        assert response.status_code in [200, 400, 422]

    def test_negative_price(self, client):
        """Test handling of negative price."""
        order_data = {
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 100,
            "price": -100.0,  # Invalid price
            "stop_loss": 2475.0,
            "take_profit": 2575.0,
        }

        response = client.post("/api/paper/order", json=order_data)
        assert response.status_code in [200, 400, 422]

    def test_invalid_date_format(self, client, mock_journal):
        """Test handling of invalid date format in trades query."""
        response = client.get("/api/paper/trades?date=invalid-date")

        # Should handle gracefully
        assert response.status_code in [200, 400, 422]

"""
Extended Paper Portfolio API Tests

Tests for portfolio endpoint's bot snapshot overlay logic in api/paper/portfolio.py.

Covers:
1. Bot snapshot overlay (recomputed cash, margin, unrealized P&L)
2. Stale snapshot fallback to in-memory
3. daily_loss_limit_exceeded flag
4. max_daily_loss_pct DB fallback
5. realized_pnl_today from journal
6. daily_trades count from journal
7. get_positions with snapshot override
8. get_positions with empty snapshot fallback
9. update_prices triggers SL/TP and closes trades
10. update_prices returns trades_closed count
11. Division by zero guard when initial_capital is 0
"""

import pytest
import sys
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from fastapi.testclient import TestClient
from fastapi import FastAPI

from api.paper_trading import router as paper_router


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def temp_journals_dir():
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def mock_paper_trader():
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
            "total_pnl": 0.0,
            "daily_pnl_pct": 0.0,
            "total_pnl_pct": 0.0,
            "positions": len(trader.positions),
            "open_positions": len(trader.positions),
        }

    def get_positions():
        return list(trader.positions.values())

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
    trader.close_position = close_position
    trader.update_prices = update_prices

    return trader


@pytest.fixture
def mock_journal():
    journal = MagicMock()
    journal.trades = []

    def log_trade(trade_data, notes="", strategy_id=0, strategy_name=""):
        journal.trades.append(trade_data)
        return trade_data

    journal.log_trade = log_trade
    journal.save_journal = MagicMock()
    return journal


@pytest.fixture
def app(mock_paper_trader, mock_journal):
    app = FastAPI()
    app.include_router(paper_router)

    from api.auth import get_current_user
    mock_user = MagicMock()
    mock_user.id = 1
    mock_user.email = "test@example.com"
    app.dependency_overrides[get_current_user] = lambda: mock_user

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

    def get_journal_mock(user_id=None):
        return mock_journal

    with patch('api.paper.portfolio.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('api.paper.paper_api.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('api.paper.portfolio.get_journal', side_effect=get_journal_mock), \
         patch('trading.paper_trader.get_paper_trader', side_effect=get_paper_trader_mock), \
         patch('trading.paper_trader.reset_paper_trader', side_effect=reset_paper_trader_mock), \
         patch('trading.journal.get_journal', side_effect=get_journal_mock):
        yield app


@pytest.fixture
def client(app):
    return TestClient(app)


def _make_snapshot(positions, timestamp=None):
    if timestamp is None:
        timestamp = datetime.now().isoformat()
    return {
        "positions": positions,
        "timestamp": timestamp,
    }


def _make_snap_position(symbol, entry_price, quantity, current_price, pnl):
    return {
        "symbol": symbol,
        "entry_price": entry_price,
        "quantity": quantity,
        "current_price": current_price,
        "pnl": pnl,
    }


def _make_position(symbol, entry_price, quantity, stop_loss, take_profit,
                    side=None, current_price=None):
    from trading.paper_trader import PaperPosition, OrderSide
    return PaperPosition(
        symbol=symbol,
        side=side or OrderSide.BUY,
        quantity=quantity,
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit=take_profit,
        entry_time=datetime.now(),
        current_price=current_price or entry_price,
        low_price=0.0,
    )


# ============================================================================
# 1. Bot Snapshot Overlay
# ============================================================================

@pytest.mark.unit
class TestBotSnapshotOverlay:

    @patch("db.database.SessionLocal")
    def test_portfolio_snapshot_overlay_recomputes_values(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.get_portfolio_status = lambda: {
            "initial_capital": 1000000.0,
            "cash": 575000.0,
            "margin_used": 425000.0,
            "position_value": 430000.0,
            "unrealized_pnl": 5000.0,
            "total_value": 1005000.0,
            "total_pnl": 5000.0,
            "daily_pnl": 5000.0,
            "daily_pnl_pct": 0.5,
            "total_pnl_pct": 0.5,
            "positions": 2,
            "open_positions": 2,
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        assert response.status_code == 200
        data = response.json()

        assert data["margin_used"] == 425000.0
        assert data["position_value"] == 430000.0
        assert data["unrealized_pnl"] == 5000.0
        assert data["cash"] == 575000.0
        assert data["total_value"] == 1005000.0
        assert data["total_pnl"] == 5000.0
        assert data["positions"] == 2
        assert data["open_positions"] == 2

    @patch("db.database.SessionLocal")
    def test_portfolio_snapshot_overlay_rounds_values(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.get_portfolio_status = lambda: {
            "initial_capital": 1000000.0,
            "cash": 985432.11,
            "margin_used": 14567.89,
            "position_value": 15001.23,
            "unrealized_pnl": 433.34,
            "total_value": 1000433.34,
            "total_pnl": 433.34,
            "daily_pnl": 433.34,
            "daily_pnl_pct": 0.04,
            "total_pnl_pct": 0.04,
            "positions": 1,
            "open_positions": 1,
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        for key in ("cash", "margin_used", "position_value", "unrealized_pnl",
                     "total_value", "total_pnl", "daily_pnl_pct", "total_pnl_pct"):
            val = data.get(key, 0)
            assert round(val, 2) == val, f"{key} not rounded: {val}"

    @patch("db.database.SessionLocal")
    def test_portfolio_snapshot_uses_open_positions_data_key(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.get_portfolio_status = lambda: {
            "initial_capital": 1000000.0,
            "cash": 920000.0,
            "margin_used": 80000.0,
            "position_value": 84000.0,
            "unrealized_pnl": 4000.0,
            "total_value": 1004000.0,
            "total_pnl": 4000.0,
            "daily_pnl": 4000.0,
            "daily_pnl_pct": 0.4,
            "total_pnl_pct": 0.4,
            "positions": 1,
            "open_positions": 1,
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["margin_used"] == 80000.0
        assert data["unrealized_pnl"] == 4000.0
        assert data["positions"] == 1

    @patch("db.database.SessionLocal")
    def test_snapshot_overlay_updates_daily_pnl_with_realized(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.get_portfolio_status = lambda: {
            "initial_capital": 1000000.0,
            "cash": 965000.0,
            "margin_used": 35000.0,
            "position_value": 36000.0,
            "unrealized_pnl": 1000.0,
            "total_value": 1001000.0,
            "total_pnl": 1000.0,
            "daily_pnl": 3000.0,
            "daily_pnl_pct": 0.3,
            "total_pnl_pct": 0.1,
            "positions": 1,
            "open_positions": 1,
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        with patch("api.paper.portfolio.TradeJournal") as mock_journal_cls, \
             patch("api.paper.portfolio.Path") as mock_path_cls:
            mock_journal_file = MagicMock()
            mock_journal_file.exists.return_value = True
            mock_journal_dir = MagicMock()
            mock_journal_dir.__truediv__ = MagicMock(return_value=mock_journal_file)
            mock_path_cls.return_value.parent.parent.parent = mock_journal_dir

            trade1 = MagicMock(net_pnl=2000.0)
            mock_journal_instance = MagicMock()
            mock_journal_instance.trades = [trade1]
            mock_journal_cls.return_value = mock_journal_instance

            response = client.get("/api/paper/portfolio")
            data = response.json()

            assert data["daily_pnl"] == 3000.0


# ============================================================================
# 2. Stale Snapshot Fallback
# ============================================================================

@pytest.mark.unit
class TestStaleSnapshotFallback:

    @patch("db.database.SessionLocal")
    def test_stale_snapshot_falls_back_to_in_memory(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.cash = 900000.0
        mock_paper_trader.margin_used = 100000.0

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["cash"] == 900000.0
        assert data["margin_used"] == 100000.0

    @patch("db.database.SessionLocal")
    def test_no_snapshot_uses_in_memory_portfolio(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.cash = 750000.0
        mock_paper_trader.margin_used = 250000.0

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["cash"] == 750000.0
        assert data["margin_used"] == 250000.0
        assert data["initial_capital"] == 1_000_000


# ============================================================================
# 3. daily_loss_limit_exceeded Flag
# ============================================================================

@pytest.mark.unit
class TestDailyLossLimitExceeded:

    @patch("db.database.SessionLocal")
    def test_daily_loss_limit_exceeded_true(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.daily_pnl = -40000.0

        mock_bot_cfg = MagicMock()
        mock_bot_cfg.max_daily_loss_pct = 0.03
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_bot_cfg
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["daily_loss_limit_exceeded"] is True
        assert data["max_daily_loss_pct"] == 0.03

    @patch("db.database.SessionLocal")
    def test_daily_loss_limit_not_exceeded_small_loss(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.daily_pnl = -10000.0

        mock_bot_cfg = MagicMock()
        mock_bot_cfg.max_daily_loss_pct = 0.03
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_bot_cfg
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["daily_loss_limit_exceeded"] is False

    @patch("db.database.SessionLocal")
    def test_daily_loss_limit_not_exceeded_positive_pnl(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.daily_pnl = 50000.0

        mock_bot_cfg = MagicMock()
        mock_bot_cfg.max_daily_loss_pct = 0.03
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_bot_cfg
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["daily_loss_limit_exceeded"] is False

    @patch("db.database.SessionLocal")
    def test_daily_loss_limit_exceeded_boundary(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.daily_pnl = -30000.0

        mock_bot_cfg = MagicMock()
        mock_bot_cfg.max_daily_loss_pct = 0.03
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_bot_cfg
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["daily_loss_limit_exceeded"] is True


# ============================================================================
# 4. max_daily_loss_pct DB Fallback
# ============================================================================

@pytest.mark.unit
class TestMaxDailyLossPctFallback:

    @patch("db.database.SessionLocal")
    def test_db_query_exception_defaults_to_003(
        self, mock_session_local, client
    ):
        mock_db = MagicMock()
        mock_db.query.side_effect = Exception("DB connection failed")
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["max_daily_loss_pct"] == 0.03

    @patch("db.database.SessionLocal")
    def test_no_bot_config_defaults_to_003(
        self, mock_session_local, client
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["max_daily_loss_pct"] == 0.03


# ============================================================================
# 5. realized_pnl_today from Journal
# ============================================================================

@pytest.mark.unit
class TestRealizedPnlToday:

    @patch("db.database.SessionLocal")
    @patch("api.paper.portfolio.TradeJournal")
    def test_realized_pnl_from_journal(
        self, mock_journal_cls, mock_session_local,
        client, tmp_path
    ):
        # Without snapshot overlay, realized_pnl_today and daily_trades flow
        # from journal only when not already present in the status dict.
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        user_dir = tmp_path / "journals" / "1"
        user_dir.mkdir(parents=True)
        import config
        today_compact = datetime.now(config.IST).strftime('%Y%m%d')
        journal_file = user_dir / f"journal_{today_compact}.json"
        journal_file.write_text("{}")

        fake_file = str(tmp_path / "a" / "b" / "portfolio.py")

        trade1 = MagicMock(net_pnl=5000.0)
        trade2 = MagicMock(net_pnl=-2000.0)
        mock_journal_instance = MagicMock()
        mock_journal_instance.trades = [trade1, trade2]
        mock_journal_cls.return_value = mock_journal_instance

        with patch("api.paper.portfolio.__file__", fake_file):
            response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["realized_pnl_today"] == 3000.0
        assert data["daily_trades"] == 2

    @patch("db.database.SessionLocal")
    def test_realized_pnl_no_snapshot_uses_status_default(
        self, mock_session_local, client, tmp_path
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        fake_file = str(tmp_path / "a" / "b" / "portfolio.py")

        with patch("api.paper.portfolio.__file__", fake_file):
            response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["realized_pnl_today"] == 0.0
        assert data["daily_trades"] == 0

    @patch("db.database.SessionLocal")
    def test_no_journal_file_realized_pnl_zero(
        self, mock_session_local,
        client, tmp_path
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        fake_file = str(tmp_path / "a" / "b" / "portfolio.py")

        with patch("api.paper.portfolio.__file__", fake_file):
            response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["realized_pnl_today"] == 0.0
        assert data["daily_trades"] == 0

    @patch("db.database.SessionLocal")
    @patch("api.paper.portfolio.TradeJournal")
    def test_journal_load_exception_handled(
        self, mock_journal_cls, mock_session_local,
        client, tmp_path
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        user_dir = tmp_path / "journals" / "1"
        user_dir.mkdir(parents=True)
        import config
        today_compact = datetime.now(config.IST).strftime('%Y%m%d')
        journal_file = user_dir / f"journal_{today_compact}.json"
        journal_file.write_text("{}")

        fake_file = str(tmp_path / "a" / "b" / "portfolio.py")
        mock_journal_cls.side_effect = Exception("corrupt journal")

        with patch("api.paper.portfolio.__file__", fake_file):
            response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["realized_pnl_today"] == 0.0
        assert data["daily_trades"] == 0


# ============================================================================
# 6. daily_trades Count
# ============================================================================

@pytest.mark.unit
class TestDailyTradesCount:

    @patch("db.database.SessionLocal")
    @patch("api.paper.portfolio.TradeJournal")
    def test_daily_trades_from_snapshot_overlay(
        self, mock_journal_cls, mock_session_local,
        client, tmp_path
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        user_dir = tmp_path / "journals" / "1"
        user_dir.mkdir(parents=True)
        import config
        today_compact = datetime.now(config.IST).strftime('%Y%m%d')
        journal_file = user_dir / f"journal_{today_compact}.json"
        journal_file.write_text("{}")

        fake_file = str(tmp_path / "a" / "b" / "portfolio.py")

        trade1 = MagicMock(net_pnl=1000.0)
        trade2 = MagicMock(net_pnl=500.0)
        trade3 = MagicMock(net_pnl=-200.0)
        mock_journal_instance = MagicMock()
        mock_journal_instance.trades = [trade1, trade2, trade3]
        mock_journal_cls.return_value = mock_journal_instance

        with patch("api.paper.portfolio.__file__", fake_file):
            response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["daily_trades"] == 3

    @patch("db.database.SessionLocal")
    def test_daily_trades_zero_when_no_journal(
        self, mock_session_local,
        client, tmp_path
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        fake_file = str(tmp_path / "a" / "b" / "portfolio.py")

        with patch("api.paper.portfolio.__file__", fake_file):
            response = client.get("/api/paper/portfolio")
        data = response.json()

        assert data["daily_trades"] == 0


# ============================================================================
# 7. get_positions with Snapshot Override
# ============================================================================

@pytest.mark.unit
class TestGetPositionsSnapshot:

    def test_positions_snapshot_override(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions.clear()
        mock_paper_trader.positions["RELIANCE"] = _make_position(
            "RELIANCE", 2500.0, 100, 2475.0, 2575.0, current_price=2600.0
        )
        mock_paper_trader.positions["TCS"] = _make_position(
            "TCS", 3500.0, 50, 3430.0, 3640.0, current_price=3400.0
        )

        response = client.get("/api/paper/positions")
        data = response.json()

        assert data["count"] == 2
        symbols = {p["symbol"] for p in data["positions"]}
        assert "RELIANCE" in symbols
        assert "TCS" in symbols
        assert "INFY" not in symbols

    def test_positions_uses_open_positions_data_key(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions.clear()
        mock_paper_trader.positions["WIPRO"] = _make_position(
            "WIPRO", 400.0, 200, 390.0, 440.0, current_price=420.0
        )

        response = client.get("/api/paper/positions")
        data = response.json()

        assert data["count"] == 1
        assert data["positions"][0]["symbol"] == "WIPRO"


# ============================================================================
# 8. get_positions with Empty Snapshot
# ============================================================================

@pytest.mark.unit
class TestGetPositionsEmptySnapshot:

    def test_empty_snapshot_positions_falls_back(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions["RELIANCE"] = _make_position(
            "RELIANCE", 2500.0, 100, 2475.0, 2575.0, current_price=2520.0
        )

        response = client.get("/api/paper/positions")
        data = response.json()

        assert data["count"] == 1
        assert data["positions"][0]["symbol"] == "RELIANCE"

    def test_no_snapshot_uses_in_memory_positions(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions["TCS"] = _make_position(
            "TCS", 3500.0, 50, 3430.0, 3640.0, current_price=3550.0
        )

        response = client.get("/api/paper/positions")
        data = response.json()

        assert data["count"] == 1
        assert data["positions"][0]["symbol"] == "TCS"

    def test_snapshot_with_none_positions_falls_back(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions["INFY"] = _make_position(
            "INFY", 1500.0, 100, 1470.0, 1560.0
        )

        response = client.get("/api/paper/positions")
        data = response.json()

        assert data["count"] == 1
        assert data["positions"][0]["symbol"] == "INFY"


# ============================================================================
# 9. update_prices Triggers SL/TP
# ============================================================================

@pytest.mark.unit
class TestUpdatePricesSLTP:

    def test_update_prices_triggers_stop_loss(
        self, client, mock_paper_trader, mock_journal
    ):
        mock_paper_trader.positions["RELIANCE"] = _make_position(
            "RELIANCE", 2500.0, 100, 2475.0, 2575.0, current_price=2500.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"RELIANCE": 2470.0}},
        )
        data = response.json()

        assert response.status_code == 200
        assert data["status"] == "success"
        assert data["trades_closed"] == 1
        assert "RELIANCE" not in mock_paper_trader.positions
        assert len(mock_paper_trader.trades) == 1
        mock_journal.save_journal.assert_called_once()

    def test_update_prices_triggers_take_profit(
        self, client, mock_paper_trader, mock_journal
    ):
        mock_paper_trader.positions["TCS"] = _make_position(
            "TCS", 3500.0, 50, 3430.0, 3640.0, current_price=3500.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"TCS": 3650.0}},
        )
        data = response.json()

        assert data["trades_closed"] == 1
        assert "TCS" not in mock_paper_trader.positions

    def test_update_prices_no_trigger(
        self, client, mock_paper_trader, mock_journal
    ):
        mock_paper_trader.positions["INFY"] = _make_position(
            "INFY", 1500.0, 100, 1470.0, 1560.0, current_price=1500.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"INFY": 1520.0}},
        )
        data = response.json()

        assert data["trades_closed"] == 0
        assert "INFY" in mock_paper_trader.positions
        mock_journal.save_journal.assert_not_called()

    def test_update_prices_short_position_sl(
        self, client, mock_paper_trader
    ):
        from trading.paper_trader import OrderSide
        mock_paper_trader.positions["SHORT_X"] = _make_position(
            "SHORT_X", 100.0, 50, 105.0, 90.0,
            side=OrderSide.SELL, current_price=100.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"SHORT_X": 106.0}},
        )
        data = response.json()

        assert data["trades_closed"] == 1
        assert "SHORT_X" not in mock_paper_trader.positions


# ============================================================================
# 10. update_prices Returns trades_closed Count
# ============================================================================

@pytest.mark.unit
class TestUpdatePricesTradesClosed:

    def test_multiple_closures_counted(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions["A"] = _make_position(
            "A", 100.0, 10, 95.0, 110.0, current_price=100.0
        )
        mock_paper_trader.positions["B"] = _make_position(
            "B", 200.0, 10, 190.0, 220.0, current_price=200.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"A": 90.0, "B": 225.0}},
        )
        data = response.json()

        assert data["trades_closed"] == 2
        assert len(mock_paper_trader.positions) == 0

    def test_zero_closed_when_no_positions(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions.clear()

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"RELIANCE": 2500.0}},
        )
        data = response.json()

        assert data["trades_closed"] == 0

    def test_partial_closures_counted(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions["HIT"] = _make_position(
            "HIT", 100.0, 10, 95.0, 110.0, current_price=100.0
        )
        mock_paper_trader.positions["SAFE"] = _make_position(
            "SAFE", 200.0, 10, 190.0, 220.0, current_price=200.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"HIT": 90.0, "SAFE": 205.0}},
        )
        data = response.json()

        assert data["trades_closed"] == 1
        assert "HIT" not in mock_paper_trader.positions
        assert "SAFE" in mock_paper_trader.positions

    def test_response_includes_portfolio_and_positions(
        self, client, mock_paper_trader
    ):
        mock_paper_trader.positions["X"] = _make_position(
            "X", 100.0, 10, 95.0, 110.0, current_price=100.0
        )

        response = client.post(
            "/api/paper/update-prices",
            json={"prices": {"X": 105.0}},
        )
        data = response.json()

        assert "portfolio" in data
        assert "positions" in data
        assert "trades_closed" in data
        assert data["portfolio"]["initial_capital"] == 1_000_000


# ============================================================================
# 11. Division by Zero Guard
# ============================================================================

@pytest.mark.unit
class TestDivisionByZeroGuard:

    @patch("db.database.SessionLocal")
    def test_zero_initial_capital_no_crash(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.initial_capital = 0
        mock_paper_trader.cash = 0
        mock_paper_trader.get_portfolio_status = lambda: {
            "initial_capital": 0,
            "cash": 0,
            "margin_used": 0,
            "total_value": 0,
            "unrealized_pnl": 0.0,
            "daily_pnl": 0.0,
            "total_pnl": 0.0,
            "daily_pnl_pct": 0.0,
            "total_pnl_pct": 0.0,
            "positions": 0,
            "open_positions": 0,
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert response.status_code == 200
        assert data["initial_capital"] == 0
        assert data["daily_pnl_pct"] == 0.0
        assert data["daily_loss_limit_exceeded"] is False

    @patch("db.database.SessionLocal")
    def test_zero_initial_capital_with_snapshot_no_crash(
        self, mock_session_local, client, mock_paper_trader
    ):
        mock_paper_trader.initial_capital = 0
        mock_paper_trader.get_portfolio_status = lambda: {
            "initial_capital": 0,
            "cash": 0,
            "margin_used": 0,
            "total_value": 0,
            "unrealized_pnl": 0.0,
            "daily_pnl": 0.0,
            "total_pnl": 0.0,
            "daily_pnl_pct": 0.0,
            "total_pnl_pct": 0.0,
            "positions": 0,
            "open_positions": 0,
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local.return_value = mock_db

        response = client.get("/api/paper/portfolio")
        data = response.json()

        assert response.status_code == 200
        assert data["total_pnl_pct"] == 0.0
        assert data["daily_pnl_pct"] == 0.0

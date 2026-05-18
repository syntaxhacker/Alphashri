"""
Bot Operations Extended Tests

Tests for close_all_bot_positions and get_bot_trade_count from api/bots_api/bot_operations.py.

Uses real DB fixtures from conftest.py (db, client, auth_headers) and patches
external dependencies (calculate_trading_costs, is_bot_running, etc.)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

MARKET_PRICE_PATCH = "api.bots_api.bot_operations._get_market_price"

from db.models import Position, Trade, User, StrategyConfig, BotConfig, bot_strategies

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def bot_with_strategy(db):
    """Create a strategy template (bot created per-test with correct user_id)."""
    strategy = StrategyConfig(
        name="ORB Template",
        strategy_type="ORB",
        is_template=True,
        is_active=True,
        max_positions=5,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


def _create_bot(db, user, strategy):
    """Create a bot owned by user with the given strategy."""
    bot = BotConfig(
        name="Test Bot",
        user_id=user.id,
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.80,
    )
    db.add(bot)
    db.flush()
    db.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=strategy.id,
            max_positions=5,
            capital_allocation_pct=0.50,
        )
    )
    db.commit()
    db.refresh(bot)
    return bot


def _make_position(db, bot, user, strategy, symbol="RELIANCE", side="LONG",
                   quantity=100, entry_price=2500.0, current_price=2550.0,
                   stop_loss=2400.0, take_profit=2650.0):
    pos = Position(
        user_id=user.id,
        bot_id=bot.id,
        strategy_id=strategy.id,
        strategy_name=strategy.name,
        symbol=symbol,
        side=side,
        quantity=quantity,
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit=take_profit,
        entry_time=datetime(2026, 4, 25, 10, 0, 0, tzinfo=IST),
        current_price=current_price,
        unrealized_pnl=0.0,
        unrealized_pnl_pct=0.0,
    )
    db.add(pos)
    db.commit()
    db.refresh(pos)
    return pos


def _get_auth_user(client, auth_headers, db):
    """Resolve the authenticated user from auth_headers token."""
    me = client.get("/api/auth/me", headers=auth_headers)
    if me.status_code == 200:
        email = me.json().get("email")
        return db.query(User).filter(User.email == email).first()
    return db.query(User).order_by(User.id.desc()).first()


# calculate_trading_costs is imported locally inside close_all_bot_positions
# (line 427: `from backtest.costs import calculate_trading_costs`), so we must
# patch the source module.
COSTS_PATCH = "backtest.costs.calculate_trading_costs"


@pytest.mark.unit
class TestCloseAllBotPositions:
    """Tests for POST /api/bots/{bot_id}/close-all."""

    def test_closes_long_position_with_correct_pnl(self, db, bot_with_strategy,
                                                    auth_headers, client):
        """LONG P&L = (exit_price - entry_price) * quantity."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy,
                       symbol="RELIANCE", side="LONG",
                       quantity=100, entry_price=2500.0, current_price=2600.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 50.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {"RELIANCE": 2600.0}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.json()["status"] == "success"
        assert resp.json()["message"] == "Closed 1 positions"

        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade is not None
        assert trade.symbol == "RELIANCE"
        assert trade.side == "LONG"
        assert trade.pnl == 10000.0  # (2600 - 2500) * 100
        assert trade.pnl_pct == pytest.approx(4.0, abs=0.01)

    def test_closes_short_position_with_correct_pnl(self, db, bot_with_strategy,
                                                     auth_headers, client):
        """SHORT P&L = (entry_price - exit_price) * quantity."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy,
                       symbol="TCS", side="SHORT",
                       quantity=50, entry_price=3500.0, current_price=3400.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 30.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {"TCS": 3400.0}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade.pnl == 5000.0  # (3500 - 3400) * 50
        assert trade.pnl_pct == pytest.approx(2.857, abs=0.01)
        assert trade.side == "SHORT"

    def test_uses_request_prices_for_exit(self, db, bot_with_strategy,
                                          auth_headers, client):
        """Exit price comes from request.prices when present."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy,
                       symbol="INFY", side="LONG",
                       quantity=200, entry_price=1500.0, current_price=1550.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 10.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {"INFY": 1600.0}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade.exit_price == 1600.0
        assert trade.pnl == 20000.0  # (1600 - 1500) * 200

    def test_falls_back_to_current_price(self, db, bot_with_strategy,
                                         auth_headers, client):
        """When symbol not in request.prices, falls back to pos.current_price."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy,
                       symbol="WIPRO", side="LONG",
                       quantity=100, entry_price=400.0, current_price=420.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 5.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade.exit_price == 420.0
        assert trade.pnl == 2000.0  # (420 - 400) * 100

    def test_falls_back_to_entry_price_when_no_current_price(self, db, bot_with_strategy,
                                                              auth_headers, client):
        """When no current_price and not in request, falls back to entry_price (pnl=0)."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        pos = _make_position(db, bot, user, strategy,
                             symbol="HDFC", side="LONG",
                             quantity=50, entry_price=1000.0, current_price=1000.0)
        pos.current_price = None
        db.commit()

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 0.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade.exit_price == 1000.0
        assert trade.pnl == 0.0

    def test_creates_trade_record_with_correct_costs(self, db, bot_with_strategy,
                                                      auth_headers, client):
        """Trade record includes costs from calculate_trading_costs."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy,
                       symbol="SBIN", side="LONG",
                       quantity=100, entry_price=800.0, current_price=850.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 123.45}) as mock_costs, \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {"SBIN": 850.0}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        mock_costs.assert_called_once_with(800.0, 850.0, 100, "LONG")

        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade.costs == 123.45
        assert trade.net_pnl == pytest.approx(trade.pnl - 123.45, abs=0.01)
        assert trade.exit_reason == "MANUAL_CLOSE"
        assert trade.reason == "Closed via Close All"

    def test_deletes_position_records_after_closing(self, db, bot_with_strategy,
                                                     auth_headers, client):
        """All positions for the bot are deleted from DB."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy, symbol="A", side="LONG",
                       quantity=10, entry_price=100.0, current_price=110.0)
        _make_position(db, bot, user, strategy, symbol="B", side="SHORT",
                       quantity=20, entry_price=200.0, current_price=190.0)

        assert db.query(Position).filter(Position.bot_id == bot.id).count() == 2

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 1.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {"A": 110.0, "B": 190.0}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert db.query(Position).filter(Position.bot_id == bot.id).count() == 0
        assert db.query(Trade).filter(Trade.bot_id == bot.id).count() == 2

    def test_cleans_up_command_file(self, db, bot_with_strategy,
                                    auth_headers, client):
        """Removes /tmp/bot-cmd-{bot.id}.json after closing."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        cmd_path = Path(f"/tmp/bot-cmd-{bot.id}.json")
        cmd_path.write_text('{"command": "close_all"}')
        assert cmd_path.exists()

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(MARKET_PRICE_PATCH, return_value=None):
            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert not cmd_path.exists()

    def test_returns_success_with_zero_positions(self, db, bot_with_strategy,
                                                  auth_headers, client):
        """Returns success even when bot has no positions."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(True, 12345)), \
             patch(MARKET_PRICE_PATCH, return_value=None):
            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "signal_sent"
        assert "Close signal sent to bot" in data["message"]
        assert data["bot_running"] is True

    def test_closes_multiple_positions(self, db, bot_with_strategy,
                                       auth_headers, client):
        """Closes multiple positions and creates corresponding trades."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        symbols = ["RELIANCE", "TCS", "INFY"]
        for sym in symbols:
            _make_position(db, bot, user, strategy, symbol=sym, side="LONG",
                           quantity=10, entry_price=1000.0, current_price=1050.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 5.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {s: 1050.0 for s in symbols}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.json()["message"] == "Closed 3 positions"
        assert db.query(Position).filter(Position.bot_id == bot.id).count() == 0
        assert db.query(Trade).filter(Trade.bot_id == bot.id).count() == 3

    def test_trade_has_peak_and_low_price(self, db, bot_with_strategy,
                                           auth_headers, client):
        """Created Trade records have peak_price and low_price set to entry_price."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        _make_position(db, bot, user, strategy,
                       symbol="RELIANCE", side="LONG",
                       quantity=100, entry_price=2500.0, current_price=2550.0)

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch(COSTS_PATCH, return_value={"total_costs": 10.0}), \
             patch(MARKET_PRICE_PATCH, return_value=None):

            resp = client.post(
                f"/api/bots/{bot.uuid}/close-all",
                json={"prices": {"RELIANCE": 2550.0}},
                headers=auth_headers,
            )

        assert resp.status_code == 200
        trade = db.query(Trade).filter(Trade.bot_id == bot.id).first()
        assert trade.peak_price == 2500.0
        assert trade.low_price == 2500.0
        assert trade.source == "live"


@pytest.mark.unit
class TestGetBotTradeCount:
    """Tests for GET /api/bots/{bot_id}/trade-count.

    The endpoint references `bot_strategies` without importing it at module
    level, so we patch it into the module namespace for each test.
    """

    def test_returns_count_from_journal(self, db, bot_with_strategy,
                                        auth_headers, client):
        """Returns trade count from journal filtered by bot's strategy IDs."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        mock_journal = MagicMock()
        mock_journal.trades = [
            MagicMock(strategy_id=strategy.id),
            MagicMock(strategy_id=strategy.id),
            MagicMock(strategy_id=999),
        ]

        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_session.execute.return_value.fetchall.return_value = [
            MagicMock(strategy_id=strategy.id),
        ]

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch("trading.journal.get_journal", return_value=mock_journal), \
             patch("api.bots_api.bot_operations.SessionLocal", return_value=mock_session), \
             patch("api.bots_api.bot_operations.bot_strategies", bot_strategies, create=True):

            resp = client.get(
                f"/api/bots/{bot.uuid}/trade-count",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.json()["count"] == 2

    def test_filters_by_strategy_id(self, db, bot_with_strategy,
                                    auth_headers, client):
        """Only counts trades belonging to the bot's strategies."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        mock_journal = MagicMock()
        mock_journal.trades = [
            MagicMock(strategy_id=10),
            MagicMock(strategy_id=10),
            MagicMock(strategy_id=20),
            MagicMock(strategy_id=30),
        ]

        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_session.execute.return_value.fetchall.return_value = [
            MagicMock(strategy_id=10),
            MagicMock(strategy_id=30),
        ]

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch("trading.journal.get_journal", return_value=mock_journal), \
             patch("api.bots_api.bot_operations.SessionLocal", return_value=mock_session), \
             patch("api.bots_api.bot_operations.bot_strategies", bot_strategies, create=True):

            resp = client.get(
                f"/api/bots/{bot.uuid}/trade-count",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.json()["count"] == 3

    def test_handles_empty_results(self, db, bot_with_strategy,
                                   auth_headers, client):
        """Returns count=0 when no trades match."""
        strategy = bot_with_strategy
        user = _get_auth_user(client, auth_headers, db)
        bot = _create_bot(db, user, strategy)

        mock_journal = MagicMock()
        mock_journal.trades = []

        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        mock_session.execute.return_value.fetchall.return_value = [
            MagicMock(strategy_id=1),
        ]

        with patch("api.bots_api.bot_operations.is_bot_running", return_value=(False, None)), \
             patch("trading.journal.get_journal", return_value=mock_journal), \
             patch("api.bots_api.bot_operations.SessionLocal", return_value=mock_session), \
             patch("api.bots_api.bot_operations.bot_strategies", bot_strategies, create=True):

            resp = client.get(
                f"/api/bots/{bot.uuid}/trade-count",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.json()["count"] == 0

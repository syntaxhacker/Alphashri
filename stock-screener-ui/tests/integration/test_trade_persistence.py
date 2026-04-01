import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def test_strategy(db):
    from db.models import StrategyConfig
    s = StrategyConfig(
        name="test_persist_strategy",
        strategy_type="ORB",
        is_template=False,
        is_active=True,
        sl_pct=0.3,
        tp_pct=1.0,
        max_positions=3,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture
def test_bot(db, test_user):
    from db.models import BotConfig
    bot = BotConfig(
        user_id=test_user.id,
        name="Test Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.8,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return bot


def _make_bot(user_id, bot_id, test_mode=False):
    from trading.multi_strategy_runner import MultiStrategyRunner
    mock_config = MagicMock()
    mock_config.id = bot_id
    bot = MultiStrategyRunner.__new__(MultiStrategyRunner)
    bot.user_id = user_id
    bot.bot_config = mock_config
    bot.test_mode = test_mode
    return bot


@pytest.mark.integration
class TestTradeDBPersistence:

    def test_persist_trade_to_db(self, db, test_user, test_bot, test_strategy):
        from trading.multi_strategy_runner import MultiStrategyRunner
        from db.models import Trade as TradeModel

        mock_config = MagicMock()
        mock_config.id = test_bot.id
        mock_config.name = "Test Bot"

        runner_mock = MagicMock()
        runner_mock.strategy_id = test_strategy.id
        runner_mock.strategy_name = "ORB Conservative"

        bot = MultiStrategyRunner.__new__(MultiStrategyRunner)
        bot.user_id = test_user.id
        bot.bot_config = mock_config
        bot.test_mode = False

        trade_data = {
            "strategy_id": test_strategy.id,
            "strategy_name": "ORB Conservative",
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 50,
            "entry_price": 2000.0,
            "exit_price": 2100.0,
            "entry_time": datetime(2026, 3, 30, 10, 15, 0, tzinfo=IST),
            "exit_time": datetime(2026, 3, 30, 11, 30, 0, tzinfo=IST),
            "pnl": 5000.0,
            "pnl_pct": 2.5,
            "costs": 50.0,
            "net_pnl": 4950.0,
            "exit_reason": "TP",
            "stop_loss": 1900.0,
            "take_profit": 2200.0,
        }

        with patch.object(bot, "_get_db_session", return_value=db):
            bot._persist_trade_to_db(trade_data)

        trades = db.query(TradeModel).filter(TradeModel.symbol == "RELIANCE").all()
        assert len(trades) == 1
        assert trades[0].pnl == 5000.0
        assert trades[0].is_test is False
        assert trades[0].source == "live"

    def test_persist_position_upsert(self, db, test_user, test_bot, test_strategy):
        from db.models import Position as PositionModel

        bot = _make_bot(test_user.id, test_bot.id)

        pos_data = {
            "strategy_id": test_strategy.id,
            "strategy_name": "ORB",
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 50,
            "entry_price": 2000.0,
            "stop_loss": 1900.0,
            "take_profit": 2200.0,
            "entry_time": datetime(2026, 3, 30, 10, 15, 0, tzinfo=IST),
            "current_price": 2050.0,
        }

        with patch.object(bot, "_get_db_session", return_value=db):
            bot._persist_position_to_db(pos_data, action="upsert")

        positions = db.query(PositionModel).all()
        assert len(positions) == 1
        assert positions[0].current_price == 2050.0

        pos_data["current_price"] = 2070.0
        pos_data["unrealized_pnl"] = 3500.0
        pos_data["unrealized_pnl_pct"] = 1.75
        with patch.object(bot, "_get_db_session", return_value=db):
            bot._persist_position_to_db(pos_data, action="upsert")

        positions = db.query(PositionModel).all()
        assert len(positions) == 1
        assert positions[0].current_price == 2070.0

    def test_persist_position_delete(self, db, test_user, test_bot, test_strategy):
        from db.models import Position as PositionModel

        bot = _make_bot(test_user.id, test_bot.id)
        strategy_id = test_strategy.id

        pos_data = {
            "strategy_id": strategy_id,
            "strategy_name": "Test",
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 50,
            "entry_price": 2000.0,
            "entry_time": datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST),
        }
        with patch.object(bot, "_get_db_session", return_value=db):
            bot._persist_position_to_db(pos_data, action="upsert")
        assert db.query(PositionModel).count() == 1

        with patch.object(bot, "_get_db_session", return_value=db):
            bot._persist_position_to_db(
                {"strategy_id": strategy_id, "symbol": "RELIANCE"},
                action="delete",
            )
        assert db.query(PositionModel).count() == 0

    def test_load_positions_from_db(self, db, test_user, test_bot, test_strategy):
        from trading.multi_strategy_runner import MultiStrategyRunner
        from trading.shared_portfolio import SharedPortfolioManager
        from db.models import Position as PositionModel

        mock_config = MagicMock()
        mock_config.id = test_bot.id

        pos = PositionModel(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="ORB",
            symbol="RELIANCE",
            side="BUY",
            quantity=50,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
            entry_time=datetime(2026, 3, 30, 10, 15, 0, tzinfo=IST),
            current_price=2050.0,
        )
        db.add(pos)
        db.commit()

        portfolio = SharedPortfolioManager(initial_capital=1_000_000)
        portfolio.set_strategy_allocation(test_strategy.id, "ORB", 0.4, 3)

        bot = MultiStrategyRunner.__new__(MultiStrategyRunner)
        bot.user_id = test_user.id
        bot.bot_config = mock_config
        bot.portfolio = portfolio
        bot.test_mode = False

        with patch.object(bot, "_get_db_session", return_value=db), \
             patch.object(portfolio, "restore_position", return_value=True) as mock_restore:
            bot._load_positions_from_db()

        assert mock_restore.call_count == 1
        call_kwargs = mock_restore.call_args[1]
        assert call_kwargs["symbol"] == "RELIANCE"
        assert call_kwargs["strategy_id"] == test_strategy.id
        assert call_kwargs["quantity"] == 50
        assert call_kwargs["entry_price"] == 2000.0

    def test_persist_trade_graceful_db_failure(self, test_user, test_bot, test_strategy):
        bot = _make_bot(test_user.id, test_bot.id)

        with patch.object(bot, "_get_db_session", side_effect=Exception("DB down")):
            bot._persist_trade_to_db({
                "strategy_id": 1,
                "strategy_name": "Test",
                "symbol": "RELIANCE",
                "side": "BUY",
                "quantity": 10,
                "entry_price": 100.0,
                "entry_time": datetime.now(IST),
            })

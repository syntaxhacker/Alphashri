import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy.exc import IntegrityError

from db.models import Trade, Position

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.mark.unit
class TestTradeModel:
    def test_trade_creation(self, test_db, test_user, test_bot, test_strategy):
        trade = Trade(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="ORB Conservative",
            symbol="RELIANCE",
            side="BUY",
            quantity=50,
            entry_price=2000.0,
            exit_price=2100.0,
            entry_time=datetime(2026, 3, 30, 10, 15, 0, tzinfo=IST),
            exit_time=datetime(2026, 3, 30, 11, 30, 0, tzinfo=IST),
            pnl=5000.0,
            pnl_pct=2.5,
            costs=50.0,
            net_pnl=4950.0,
            exit_reason="TP",
            stop_loss=1900.0,
            take_profit=2200.0,
            is_test=False,
            source="live",
        )
        test_db.add(trade)
        test_db.commit()
        assert trade.id is not None
        assert trade.uuid is not None
        assert trade.symbol == "RELIANCE"

    def test_trade_defaults(self, test_db, test_user):
        trade = Trade(
            user_id=test_user.id,
            strategy_name="Test",
            symbol="HDFC",
            side="BUY",
            quantity=10,
            entry_price=1500.0,
            entry_time=datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST),
        )
        test_db.add(trade)
        test_db.commit()
        assert trade.exit_price is None
        assert trade.exit_time is None
        assert trade.pnl == 0.0
        assert trade.pnl_pct == 0.0
        assert trade.costs == 0.0
        assert trade.net_pnl == 0.0
        assert trade.exit_reason is None
        assert trade.is_test is False
        assert trade.source == "live"
        assert trade.bot_id is None
        assert trade.strategy_id is None
        assert trade.stop_loss == 0.0
        assert trade.take_profit == 0.0
        assert trade.created_at is not None

    def test_trade_to_dict(self, test_db, test_user, test_bot, test_strategy):
        trade = Trade(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="ORB",
            symbol="INFY",
            side="SELL",
            quantity=100,
            entry_price=1500.0,
            exit_price=1400.0,
            entry_time=datetime(2026, 3, 30, 9, 30, 0, tzinfo=IST),
            exit_time=datetime(2026, 3, 30, 14, 0, 0, tzinfo=IST),
            pnl=-10000.0,
            pnl_pct=-6.67,
            costs=100.0,
            net_pnl=-10100.0,
            exit_reason="SL",
        )
        test_db.add(trade)
        test_db.commit()
        d = trade.to_dict()
        assert d["id"] == trade.uuid
        assert d["trade_id"] == f"TRADE-{trade.id:06d}"
        assert d["symbol"] == "INFY"
        assert d["side"] == "SELL"
        assert d["quantity"] == 100
        assert d["entry_price"] == 1500.0
        assert d["exit_price"] == 1400.0
        assert d["pnl"] == -10000.0
        assert d["net_pnl"] == -10100.0
        assert d["exit_reason"] == "SL"
        assert d["is_test"] is False
        assert d["source"] == "live"
        assert "entry_time" in d
        assert "exit_time" in d

    def test_trade_relationships(self, test_db, test_user, test_bot):
        trade = Trade(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_name="Test",
            symbol="TCS",
            side="BUY",
            quantity=10,
            entry_price=3000.0,
            entry_time=datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST),
        )
        test_db.add(trade)
        test_db.commit()
        assert trade.user.id == test_user.id
        assert trade.bot.id == test_bot.id
        assert len(test_user.trades) == 1
        assert len(test_bot.trades) == 1


@pytest.mark.unit
class TestPositionModel:
    def test_position_creation(self, test_db, test_user, test_bot, test_strategy):
        pos = Position(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="ORB Conservative",
            symbol="RELIANCE",
            side="BUY",
            quantity=50,
            entry_price=2000.0,
            stop_loss=1900.0,
            take_profit=2200.0,
            entry_time=datetime(2026, 3, 30, 10, 15, 0, tzinfo=IST),
            current_price=2050.0,
            unrealized_pnl=2500.0,
            unrealized_pnl_pct=1.25,
            is_test=False,
        )
        test_db.add(pos)
        test_db.commit()
        assert pos.id is not None
        assert pos.uuid is not None
        assert pos.symbol == "RELIANCE"
        assert pos.current_price == 2050.0

    def test_position_defaults(self, test_db, test_user, test_bot):
        pos = Position(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_name="Test",
            symbol="HDFC",
            side="SELL",
            quantity=10,
            entry_price=1500.0,
            entry_time=datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST),
        )
        test_db.add(pos)
        test_db.commit()
        assert pos.stop_loss == 0.0
        assert pos.take_profit == 0.0
        assert pos.current_price == 0.0
        assert pos.unrealized_pnl == 0.0
        assert pos.unrealized_pnl_pct == 0.0
        assert pos.is_test is False
        assert pos.strategy_id is None
        assert pos.created_at is not None
        assert pos.updated_at is not None

    def test_position_unique_constraint(self, test_db, test_user, test_bot, test_strategy):
        pos1 = Position(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="Test",
            symbol="RELIANCE",
            side="BUY",
            quantity=50,
            entry_price=2000.0,
            entry_time=datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST),
        )
        test_db.add(pos1)
        test_db.commit()
        pos2 = Position(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="Test",
            symbol="RELIANCE",
            side="BUY",
            quantity=30,
            entry_price=2050.0,
            entry_time=datetime(2026, 3, 30, 10, 30, 0, tzinfo=IST),
        )
        test_db.add(pos2)
        with pytest.raises(IntegrityError):
            test_db.commit()

    def test_position_to_dict(self, test_db, test_user, test_bot, test_strategy):
        pos = Position(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_id=test_strategy.id,
            strategy_name="ORB",
            symbol="INFY",
            side="BUY",
            quantity=100,
            entry_price=1500.0,
            stop_loss=1400.0,
            take_profit=1700.0,
            entry_time=datetime(2026, 3, 30, 9, 30, 0, tzinfo=IST),
            current_price=1550.0,
            unrealized_pnl=5000.0,
            unrealized_pnl_pct=3.33,
        )
        test_db.add(pos)
        test_db.commit()
        d = pos.to_dict()
        assert d["id"] == pos.uuid
        assert d["symbol"] == "INFY"
        assert d["side"] == "BUY"
        assert d["quantity"] == 100
        assert d["entry_price"] == 1500.0
        assert d["current_price"] == 1550.0
        assert d["stop_loss"] == 1400.0
        assert d["take_profit"] == 1700.0
        assert d["unrealized_pnl"] == 5000.0
        assert d["unrealized_pnl_pct"] == 3.33
        assert "entry_time" in d

    def test_position_relationships(self, test_db, test_user, test_bot):
        pos = Position(
            user_id=test_user.id,
            bot_id=test_bot.id,
            strategy_name="Test",
            symbol="TCS",
            side="BUY",
            quantity=10,
            entry_price=3000.0,
            entry_time=datetime(2026, 3, 30, 10, 0, 0, tzinfo=IST),
        )
        test_db.add(pos)
        test_db.commit()
        assert pos.user.id == test_user.id
        assert pos.bot.id == test_bot.id
        assert len(test_user.positions) == 1

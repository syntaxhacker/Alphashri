import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from db.database import Base
from db.models import (
    BotConfig,
    BotRuntimeState,
    Position,
    StrategyConfig,
    StrategyRuntimeState,
    Trade,
    User,
    bot_strategies,
)
from tests.helpers.db import import_all_models

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture(scope="function")
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    import_all_models()
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture(scope="function")
def db(db_engine):
    TestSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=db_engine
    )
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def user(db):
    u = User(
        email="test@example.com",
        hashed_password="hashed",
        display_name="Test",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def strategy(db):
    s = StrategyConfig(
        name="ORB Best",
        strategy_type="ORB",
        is_template=True,
        sl_pct=1.0,
        tp_pct=1.5,
        max_positions=3,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture
def bot(db, user):
    b = BotConfig(
        name="Test Bot",
        user_id=user.id,
        max_total_positions=10,
        max_total_capital_pct=0.80,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@pytest.fixture
def bot_with_strategy(db, bot, strategy):
    db.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=strategy.id,
            max_positions=3,
            capital_allocation_pct=0.40,
        )
    )
    db.commit()
    return bot, strategy


# ============================================================================
# Group 1: DB Model Tests
# ============================================================================


class TestBotRuntimeStateModel:

    def test_create_bot_runtime_state(self, db, bot, user):
        state = BotRuntimeState(
            bot_id=bot.id,
            user_id=user.id,
            cash=800000.0,
            daily_pnl=1500.0,
            daily_trades=5,
            realized_pnl=3000.0,
            day_start="2026-04-21",
        )
        db.add(state)
        db.commit()
        db.refresh(state)

        assert state.id is not None
        assert state.bot_id == bot.id
        assert state.user_id == user.id
        assert state.cash == 800000.0
        assert state.daily_pnl == 1500.0
        assert state.daily_trades == 5
        assert state.realized_pnl == 3000.0
        assert state.day_start == "2026-04-21"
        assert state.updated_at is not None

    def test_bot_runtime_state_unique_bot_id(self, db, bot, user):
        s1 = BotRuntimeState(bot_id=bot.id, user_id=user.id, cash=500000.0)
        db.add(s1)
        db.commit()

        s2 = BotRuntimeState(bot_id=bot.id, user_id=user.id, cash=600000.0)
        db.add(s2)
        with pytest.raises(Exception):
            db.commit()


class TestStrategyRuntimeStateModel:

    def test_create_strategy_runtime_state(self, db, bot, user, strategy):
        state = StrategyRuntimeState(
            bot_id=bot.id,
            strategy_id=strategy.id,
            user_id=user.id,
            status="running",
            signals_generated=10,
            trades_executed=3,
            capital_used=50000.0,
            available_capital=270000.0,
            positions_count=1,
            realized_pnl=500.0,
        )
        db.add(state)
        db.commit()
        db.refresh(state)

        assert state.id is not None
        assert state.bot_id == bot.id
        assert state.strategy_id == strategy.id
        assert state.status == "running"
        assert state.signals_generated == 10
        assert state.trades_executed == 3
        assert state.capital_used == 50000.0
        assert state.realized_pnl == 500.0

    def test_strategy_runtime_state_unique_bot_strategy(self, db, bot, user, strategy):
        s1 = StrategyRuntimeState(
            bot_id=bot.id, strategy_id=strategy.id, user_id=user.id
        )
        db.add(s1)
        db.commit()

        s2 = StrategyRuntimeState(
            bot_id=bot.id, strategy_id=strategy.id, user_id=user.id
        )
        db.add(s2)
        with pytest.raises(Exception):
            db.commit()


class TestPositionNewColumns:

    def test_position_new_columns(self, db, user, bot, strategy):
        pos = Position(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=2500.0,
            entry_time=datetime.now(timezone.utc),
            stop_loss=2400.0,
            take_profit=2700.0,
            current_price=2550.0,
            strategy_type="ORB",
            peak_price=2600.0,
            low_price=2480.0,
            metadata_json=json.dumps({"entry_reason": "Breakout above OR high"}),
        )
        db.add(pos)
        db.commit()
        db.refresh(pos)

        assert pos.strategy_type == "ORB"
        assert pos.peak_price == 2600.0
        assert pos.low_price == 2480.0
        assert pos.metadata_json == json.dumps({"entry_reason": "Breakout above OR high"})

    def test_position_to_dict_includes_new_fields(self, db, user, bot, strategy):
        pos = Position(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=2500.0,
            entry_time=datetime.now(timezone.utc),
            current_price=2550.0,
            strategy_type="SR_BREAKOUT",
            peak_price=2620.0,
            low_price=2470.0,
            metadata_json=json.dumps({"key": "value"}),
        )
        db.add(pos)
        db.commit()
        db.refresh(pos)

        d = pos.to_dict()
        assert d["strategy_type"] == "SR_BREAKOUT"
        assert d["peak_price"] == 2620.0
        assert d["low_price"] == 2470.0


# ============================================================================
# Group 2: get_bot_state() Tests
# ============================================================================


class TestGetBotState:

    def test_get_bot_state_returns_none_for_missing_bot(self, db, user):
        from api.bot_state import get_bot_state
        result = get_bot_state(99999, user.id, db)
        assert result is None

    def test_get_bot_state_empty_bot(self, db, bot, user):
        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=None):
            result = get_bot_state(bot.id, user.id, db)

        assert result is not None
        assert result["bot_id"] == bot.id
        assert result["bot_name"] == bot.name
        assert result["running"] is True
        assert result["portfolio"]["initial_capital"] == 800000.0
        assert result["portfolio"]["cash"] == 800000.0
        assert result["portfolio"]["total_positions"] == 0
        assert result["strategies"] == {}
        assert result["positions"] == []
        assert result["scan_items"] == []

    def test_get_bot_state_with_positions(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy
        pos = Position(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=2500.0,
            entry_time=datetime.now(timezone.utc),
            current_price=2550.0,
            unrealized_pnl=500.0,
            unrealized_pnl_pct=2.0,
            strategy_type="ORB",
            peak_price=2600.0,
            low_price=2480.0,
        )
        db.add(pos)
        db.commit()

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=None):
            result = get_bot_state(bot.id, user.id, db)

        assert len(result["positions"]) == 1
        p = result["positions"][0]
        assert p["symbol"] == "RELIANCE"
        assert p["strategy_type"] == "ORB"
        assert p["peak_price"] == 2600.0
        assert p["low_price"] == 2480.0

    def test_get_bot_state_with_strategies(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=None):
            result = get_bot_state(bot.id, user.id, db)

        assert str(strategy.id) in result["strategies"]
        s = result["strategies"][str(strategy.id)]
        assert s["name"] == "ORB Best"
        assert s["status"] == "pending"
        assert s["signals_generated"] == 0
        assert s["trades_executed"] == 0
        assert s["portfolio_status"]["allocation_pct"] == 0.40
        assert s["portfolio_status"]["max_positions"] == 3

    def test_get_bot_state_portfolio_calculation(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy

        runtime = BotRuntimeState(
            bot_id=bot.id,
            user_id=user.id,
            cash=600000.0,
            daily_pnl=2000.0,
            daily_trades=3,
            realized_pnl=5000.0,
            day_start="2026-04-21",
        )
        db.add(runtime)

        pos = Position(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="TCS",
            side="BUY",
            quantity=5,
            entry_price=3800.0,
            entry_time=datetime.now(timezone.utc),
            current_price=3900.0,
            unrealized_pnl=500.0,
        )
        db.add(pos)
        db.commit()

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=None):
            result = get_bot_state(bot.id, user.id, db)

        pf = result["portfolio"]
        assert pf["cash"] == 600000.0
        assert pf["position_value"] == 3900.0 * 5
        assert pf["unrealized_pnl"] == 500.0
        assert pf["realized_pnl"] == 5000.0
        assert pf["total_value"] == 600000.0 + (3900.0 * 5)
        assert pf["daily_pnl"] == 2000.0
        assert pf["daily_trades"] == 3
        assert pf["total_positions"] == 1

    def test_get_bot_state_scan_items_from_redis(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy

        scan_items = [
            {"symbol": "RELIANCE", "strategy_id": strategy.id, "signal": "LONG"},
            {"symbol": "TCS", "strategy_id": strategy.id, "signal": "SHORT"},
        ]
        mock_redis = MagicMock()
        mock_redis.get.return_value = json.dumps(scan_items)

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=mock_redis):
            result = get_bot_state(bot.id, user.id, db)

        assert len(result["scan_items"]) == 2
        assert result["scan_items"][0]["symbol"] == "RELIANCE"
        assert str(strategy.id) in result["strategies"]
        assert len(result["strategies"][str(strategy.id)]["scan_items"]) == 2

    def test_get_bot_state_scan_items_from_db(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy

        db_scan_items = [
            {"symbol": "RELIANCE", "strategy_id": strategy.id, "signal": "LONG", "strategy_name": "ORB Best"},
            {"symbol": "TCS", "strategy_id": strategy.id, "signal": "SHORT", "strategy_name": "ORB Best"},
        ]
        bot_runtime = BotRuntimeState(
            bot_id=bot.id,
            user_id=user.id,
            cash=800000.0,
            scan_items=json.dumps(db_scan_items),
        )
        db.add(bot_runtime)
        db.commit()

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=None):
            result = get_bot_state(bot.id, user.id, db)

        assert len(result["scan_items"]) == 2
        assert result["scan_items"][0]["symbol"] == "RELIANCE"
        assert result["scan_items"][1]["symbol"] == "TCS"

    def test_get_bot_state_scan_items_redis_fallback(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy

        bot_runtime = BotRuntimeState(
            bot_id=bot.id,
            user_id=user.id,
            cash=800000.0,
            scan_items="",
        )
        db.add(bot_runtime)
        db.commit()

        redis_scan_items = [
            {"symbol": "INFY", "strategy_id": strategy.id, "signal": "LONG", "strategy_name": "ORB Best"},
        ]
        mock_redis = MagicMock()
        mock_redis.get.return_value = json.dumps(redis_scan_items)

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=mock_redis):
            result = get_bot_state(bot.id, user.id, db)

        assert len(result["scan_items"]) == 1
        assert result["scan_items"][0]["symbol"] == "INFY"

    def test_get_bot_state_scan_items_db_takes_priority_over_redis(self, db, user, bot_with_strategy):
        bot, strategy = bot_with_strategy

        db_scan_items = [
            {"symbol": "RELIANCE", "strategy_id": strategy.id, "signal": "LONG", "strategy_name": "ORB Best"},
        ]
        bot_runtime = BotRuntimeState(
            bot_id=bot.id,
            user_id=user.id,
            cash=800000.0,
            scan_items=json.dumps(db_scan_items),
        )
        db.add(bot_runtime)
        db.commit()

        redis_scan_items = [
            {"symbol": "TCS", "strategy_id": strategy.id, "signal": "SHORT", "strategy_name": "ORB Best"},
        ]
        mock_redis = MagicMock()
        mock_redis.get.return_value = json.dumps(redis_scan_items)

        from api.bot_state import get_bot_state
        with patch("api.bot_state.get_redis_client", return_value=mock_redis):
            result = get_bot_state(bot.id, user.id, db)

        assert len(result["scan_items"]) == 1
        assert result["scan_items"][0]["symbol"] == "RELIANCE"
        mock_redis.get.assert_not_called()


# ============================================================================
# Group 3: persist_state() Integration Tests
# ============================================================================


class TestPersistState:

    def _make_runner(self, bot, user_id):
        from trading.runner_core import MultiStrategyRunner

        bot_id = bot.id
        bot_name = bot.name
        max_pos = bot.max_total_positions
        max_cap = bot.max_total_capital_pct

        mock_config = MagicMock()
        mock_config.id = bot_id
        mock_config.name = bot_name
        mock_config.max_total_positions = max_pos
        mock_config.max_total_capital_pct = max_cap

        with patch("trading.runner_core.SharedPortfolioManager"), \
             patch("trading.runner_core.GlobalRiskManager"), \
             patch("trading.runner_core.SessionLocal"):
            runner = MultiStrategyRunner(bot_config=mock_config, user_id=user_id)
            runner.test_mode = True
        return runner

    def test_persist_state_creates_bot_runtime(self, db, user, bot):
        bot_id = bot.id
        runner = self._make_runner(bot, user.id)
        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 800000.0,
            "cash": 750000.0,
            "daily_pnl": 1000.0,
            "daily_trades": 2,
            "realized_pnl": 2000.0,
        }
        mock_portfolio.get_all_strategy_statuses.return_value = []
        mock_portfolio.get_strategy_status.return_value = {
            "capital_used": 0.0,
            "available_capital": 0.0,
            "positions_count": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.day_start = None
        runner.portfolio = mock_portfolio
        runner.strategies = {}

        with patch("db.database.SessionLocal", return_value=db):
            runner.persist_state()

        bot_state = db.query(BotRuntimeState).filter(
            BotRuntimeState.bot_id == bot_id
        ).first()
        assert bot_state is not None
        assert bot_state.cash == 750000.0
        assert bot_state.daily_pnl == 1000.0
        assert bot_state.daily_trades == 2
        assert bot_state.realized_pnl == 2000.0

    def test_persist_state_creates_strategy_runtimes(self, db, user, bot, strategy):
        bot_id = bot.id
        strategy_id = strategy.id
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot_id,
                strategy_id=strategy_id,
                max_positions=3,
                capital_allocation_pct=0.40,
            )
        )
        db.commit()

        runner = self._make_runner(bot, user.id)
        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 800000.0,
            "cash": 750000.0,
            "daily_pnl": 0.0,
            "daily_trades": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "capital_used": 25000.0,
            "available_capital": 295000.0,
            "positions_count": 1,
            "realized_pnl": 500.0,
        }
        mock_portfolio.day_start = None
        runner.portfolio = mock_portfolio

        sr = MagicMock()
        sr.strategy_id = strategy_id
        sr.status = "running"
        sr.signals_generated = 8
        sr.trades_executed = 3
        sr.last_scan_time = None
        sr.last_scan_items = []
        runner.strategies = {strategy_id: sr}

        with patch("db.database.SessionLocal", return_value=db):
            runner.persist_state()

        s_state = db.query(StrategyRuntimeState).filter(
            StrategyRuntimeState.bot_id == bot_id,
            StrategyRuntimeState.strategy_id == strategy_id,
        ).first()
        assert s_state is not None
        assert s_state.status == "running"
        assert s_state.signals_generated == 8
        assert s_state.trades_executed == 3
        assert s_state.capital_used == 25000.0

    def test_persist_state_updates_cash(self, db, user, bot):
        bot_id = bot.id
        runner = self._make_runner(bot, user.id)

        existing = BotRuntimeState(
            bot_id=bot_id,
            user_id=user.id,
            cash=700000.0,
            daily_pnl=500.0,
        )
        db.add(existing)
        db.commit()

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 800000.0,
            "cash": 680000.0,
            "daily_pnl": -2000.0,
            "daily_trades": 1,
            "realized_pnl": -2000.0,
        }
        mock_portfolio.get_all_strategy_statuses.return_value = []
        mock_portfolio.get_strategy_status.return_value = {
            "capital_used": 0.0,
            "available_capital": 0.0,
            "positions_count": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.day_start = None
        runner.portfolio = mock_portfolio
        runner.strategies = {}

        with patch("db.database.SessionLocal", return_value=db):
            runner.persist_state()

        updated = db.query(BotRuntimeState).filter(
            BotRuntimeState.bot_id == bot_id
        ).first()
        assert updated.cash == 680000.0
        assert updated.daily_pnl == -2000.0

    def test_persist_state_writes_scan_items_to_redis(self, db, user, bot, strategy):
        bot_id = bot.id
        strategy_id = strategy.id
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot_id,
                strategy_id=strategy_id,
                max_positions=3,
                capital_allocation_pct=0.40,
            )
        )
        db.commit()

        runner = self._make_runner(bot, user.id)
        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 800000.0,
            "cash": 800000.0,
            "daily_pnl": 0.0,
            "daily_trades": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.get_all_strategy_statuses.return_value = []
        mock_portfolio.get_strategy_status.return_value = {
            "capital_used": 0.0,
            "available_capital": 0.0,
            "positions_count": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.day_start = None
        runner.portfolio = mock_portfolio

        sr = MagicMock()
        sr.strategy_id = strategy_id
        sr.strategy_name = "ORB Best"
        sr.status = "running"
        sr.signals_generated = 0
        sr.trades_executed = 0
        sr.last_scan_time = None
        sr.last_scan_items = [
            {"symbol": "RELIANCE", "signal": "LONG_ENTRY"},
            {"symbol": "TCS", "signal": "SHORT_ENTRY"},
        ]
        runner.strategies = {strategy_id: sr}

        mock_redis = MagicMock()
        with patch("db.database.SessionLocal", return_value=db), \
             patch("cache.redis_client.get_redis_client", return_value=mock_redis):
            runner.persist_state()

        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args
        assert call_args[0][0] == f"bot:{bot_id}:scan_items"
        assert call_args[0][1] == 300
        parsed = json.loads(call_args[0][2])
        assert len(parsed) == 2
        assert parsed[0]["symbol"] == "RELIANCE"
        assert parsed[0]["strategy_name"] == "ORB Best"
        assert parsed[0]["strategy_id"] == strategy_id

    def test_persist_state_writes_scan_items_to_db(self, db, user, bot, strategy):
        bot_id = bot.id
        strategy_id = strategy.id
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot_id,
                strategy_id=strategy_id,
                max_positions=3,
                capital_allocation_pct=0.40,
            )
        )
        db.commit()

        runner = self._make_runner(bot, user.id)
        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 800000.0,
            "cash": 800000.0,
            "daily_pnl": 0.0,
            "daily_trades": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.get_all_strategy_statuses.return_value = []
        mock_portfolio.get_strategy_status.return_value = {
            "capital_used": 0.0,
            "available_capital": 0.0,
            "positions_count": 0,
            "realized_pnl": 0.0,
        }
        mock_portfolio.day_start = None
        runner.portfolio = mock_portfolio

        sr = MagicMock()
        sr.strategy_id = strategy_id
        sr.strategy_name = "ORB Best"
        sr.status = "running"
        sr.signals_generated = 0
        sr.trades_executed = 0
        sr.last_scan_time = None
        sr.last_scan_items = [
            {"symbol": "RELIANCE", "signal": "LONG_ENTRY"},
            {"symbol": "TCS", "signal": "SHORT_ENTRY"},
        ]
        runner.strategies = {strategy_id: sr}

        with patch("db.database.SessionLocal", return_value=db), \
             patch("cache.redis_client.get_redis_client", return_value=MagicMock()):
            runner.persist_state()

        bot_state = db.query(BotRuntimeState).filter(
            BotRuntimeState.bot_id == bot_id
        ).first()
        assert bot_state is not None
        parsed = json.loads(bot_state.scan_items)
        assert len(parsed) == 2
        assert parsed[0]["symbol"] == "RELIANCE"
        assert parsed[0]["strategy_name"] == "ORB Best"
        assert parsed[0]["strategy_id"] == strategy_id
        assert parsed[1]["symbol"] == "TCS"


# ============================================================================
# Group 4: Position Restore Tests
# ============================================================================


class TestPositionRestore:

    def test_restore_position_from_db_with_new_columns(self, db, user, bot, strategy):
        bot_id = bot.id
        strategy_id = strategy.id
        pos = Position(
            user_id=user.id,
            bot_id=bot_id,
            strategy_id=strategy_id,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=2500.0,
            entry_time=datetime.now(timezone.utc),
            stop_loss=2400.0,
            take_profit=2700.0,
            current_price=2550.0,
            strategy_type="ORB",
            peak_price=2620.0,
            low_price=2470.0,
            metadata_json=json.dumps({"entry_reason": "Breakout above OR high", "or_range_pct": 1.2}),
        )
        db.add(pos)
        db.commit()

        from trading.runner_core import MultiStrategyRunner

        mock_config = MagicMock()
        mock_config.id = bot_id
        mock_config.name = bot.name
        mock_config.max_total_positions = 10
        mock_config.max_total_capital_pct = 0.80

        with patch("trading.runner_core.GlobalRiskManager"), \
             patch("db.database.SessionLocal", return_value=db):
            runner = MultiStrategyRunner(bot_config=mock_config, user_id=user.id)
            runner.test_mode = True
            runner._load_positions_from_db()

        key = f"{strategy_id}_RELIANCE"
        assert key in runner.portfolio.positions
        restored_pos = runner.portfolio.positions[key]
        assert restored_pos.symbol == "RELIANCE"
        assert restored_pos.strategy_type == "ORB"
        assert restored_pos.peak_price == 2620.0
        assert restored_pos.low_price == 2470.0
        assert restored_pos.metadata["entry_reason"] == "Breakout above OR high"
        assert restored_pos.metadata["or_range_pct"] == 1.2

    def test_persist_position_includes_new_columns(self, db, user, bot, strategy):
        bot_id = bot.id
        strategy_id = strategy.id
        from trading.runner_core import MultiStrategyRunner

        mock_config = MagicMock()
        mock_config.id = bot_id
        mock_config.name = bot.name
        mock_config.max_total_positions = 10
        mock_config.max_total_capital_pct = 0.80

        pos_data = {
            "strategy_id": strategy_id,
            "strategy_name": "ORB Best",
            "symbol": "RELIANCE",
            "side": "BUY",
            "quantity": 10,
            "entry_price": 2500.0,
            "entry_time": datetime.now(timezone.utc).isoformat(),
            "current_price": 2550.0,
            "stop_loss": 2400.0,
            "take_profit": 2700.0,
            "unrealized_pnl": 500.0,
            "unrealized_pnl_pct": 2.0,
            "peak_price": 2620.0,
            "low_price": 2470.0,
            "strategy_type": "SR_BREAKOUT",
            "metadata": {"entry_reason": "Pivot breakout", "pivot_type": "classic"},
        }

        with patch("db.database.SessionLocal", return_value=db):
            runner = MultiStrategyRunner(bot_config=mock_config, user_id=user.id)
            runner.test_mode = True
            runner._persist_position_to_db(pos_data)

        saved = db.query(Position).filter(
            Position.bot_id == bot_id,
            Position.symbol == "RELIANCE",
        ).first()
        assert saved is not None
        assert saved.strategy_type == "SR_BREAKOUT"
        assert saved.peak_price == 2620.0
        assert saved.low_price == 2470.0
        assert saved.metadata_json == json.dumps({"entry_reason": "Pivot breakout", "pivot_type": "classic"})


# ============================================================================
# Group 5: Close All Direct DB Tests
# ============================================================================


class TestCloseAllDirectDB:

    @pytest.fixture
    def app_client(self, db_engine, user):
        from db.database import get_db
        from api.bots import router as bots_router
        from api.auth import get_current_user
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from sqlalchemy.orm import sessionmaker

        app = FastAPI()
        app.include_router(bots_router)

        TestSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=db_engine
        )

        def override_get_db():
            session = TestSessionLocal()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = lambda: user

        with TestClient(app) as client:
            yield client

        app.dependency_overrides.clear()

    def test_close_all_closes_positions_in_db(self, db, user, bot, strategy, app_client):
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy.id,
                max_positions=3,
                capital_allocation_pct=0.40,
            )
        )
        db.commit()

        pos1 = Position(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=2500.0,
            entry_time=datetime.now(timezone.utc),
            current_price=2550.0,
            stop_loss=2400.0,
            take_profit=2700.0,
        )
        pos2 = Position(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="TCS",
            side="BUY",
            quantity=5,
            entry_price=3800.0,
            entry_time=datetime.now(timezone.utc),
            current_price=3900.0,
            stop_loss=3600.0,
            take_profit=4100.0,
        )
        db.add(pos1)
        db.add(pos2)
        db.commit()

        with patch("api.bots.is_bot_running", return_value=(False, None)), \
             patch("backtest.costs.calculate_trading_costs", return_value={"total_costs": 50.0}):
            resp = app_client.post(
                f"/api/bots/{bot.id}/close-all",
                json={"prices": {"RELIANCE": 2600.0, "TCS": 4000.0}},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "Closed 2 positions" in data["message"]

        remaining_positions = db.query(Position).filter(Position.bot_id == bot.id).all()
        assert len(remaining_positions) == 0

        trades = db.query(Trade).filter(Trade.bot_id == bot.id).all()
        assert len(trades) == 2
        for t in trades:
            assert t.exit_reason == "MANUAL_CLOSE"
            assert t.reason == "Closed via Close All"


# ============================================================================
# Group 6: History Config Shadowing Tests
# ============================================================================


class TestHistoryConfigShadowing:

    def test_fetch_trades_with_strategy_id_no_config_shadowing(self, db, user, bot, strategy):
        from db.database import SessionLocal
        from db.models import Trade as TradeModel

        trade = TradeModel(
            user_id=user.id,
            bot_id=bot.id,
            strategy_id=strategy.id,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=2500.0,
            exit_price=2600.0,
            entry_time=datetime.now(timezone.utc) - timedelta(hours=2),
            exit_time=datetime.now(timezone.utc),
            stop_loss=2400.0,
            take_profit=2700.0,
            pnl=1000.0,
            pnl_pct=4.0,
            costs=50.0,
            net_pnl=950.0,
            exit_reason="MANUAL_CLOSE",
            source="live",
        )
        db.add(trade)
        db.commit()

        from api.paper.history import _get_trades_from_db

        with patch("db.database.SessionLocal", return_value=db):
            trades = _get_trades_from_db(
                user_id=user.id,
                bot_id=str(bot.id),
                symbol=None,
                strategy_id=strategy.id,
                from_date=None,
                to_date=None,
                days_back=7,
                limit=50,
            )

        assert len(trades) == 1
        assert trades[0]["symbol"] == "RELIANCE"

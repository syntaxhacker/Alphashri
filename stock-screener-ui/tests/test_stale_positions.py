"""Tests for stale position purge edge cases — multiple scenarios."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
from db.models import BotConfig, Position, StrategyConfig, User, bot_strategies
from tests.helpers.db import import_all_models

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture(scope="function")
def eng():
    e = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    import_all_models()
    Base.metadata.create_all(bind=e)
    yield e
    Base.metadata.drop_all(bind=e)
    e.dispose()


@pytest.fixture(scope="function")
def db(eng):
    S = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    s = S()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


@pytest.fixture
def user(db):
    u = User(email="edge@test.com", hashed_password="h", display_name="Edge")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def bot(db, user):
    b = BotConfig(name="EdgeBot", user_id=user.id, max_total_positions=10, max_total_capital_pct=0.80)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def _make_strategy(db, stype, name):
    s = StrategyConfig(name=name, strategy_type=stype, is_template=True, sl_pct=1.0, tp_pct=1.5)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _add_pos(db, bot, user, strat, symbol, strat_type, entry_time, is_test=False):
    p = Position(
        user_id=user.id, bot_id=bot.id, strategy_id=strat.id, strategy_name=strat.name,
        symbol=symbol, side="BUY", quantity=10, entry_price=100.0,
        entry_time=entry_time, current_price=105.0, strategy_type=strat_type,
        is_test=is_test, peak_price=105.0, low_price=100.0,
    )
    db.add(p)
    db.commit()
    return p


def _make_runner(bot, user, db):
    from trading.runner_core import MultiStrategyRunner
    from trading.portfolio.portfolio_core import SharedPortfolioManager
    mock_cfg = MagicMock()
    mock_cfg.id = bot.id
    mock_cfg.name = bot.name
    mock_cfg.max_total_positions = bot.max_total_positions
    mock_cfg.max_total_capital_pct = bot.max_total_capital_pct
    # Patch all heavy deps and prevent _load_strategies from hitting real DB
    with patch("trading.runner_core.GlobalRiskManager"), \
         patch("trading.runner_core.BotHeartbeat"), \
         patch.object(MultiStrategyRunner, "_load_strategies", lambda self: None):
        with patch("trading.runner_core._get_shared_portfolio", return_value=SharedPortfolioManager):
            runner = MultiStrategyRunner(bot_config=mock_cfg, user_id=user.id)
            runner.test_mode = False
            runner._get_data_fetcher = MagicMock(return_value=None)
            # also patch _db_session to use our in-memory db
            # runner._db_session will be patched via _get_db_session
            runner._get_db_session = MagicMock(return_value=db)
            # make _db_session contextmanager yield db
            from contextlib import contextmanager
            @contextmanager
            def _fake_db_session():
                yield db
                # mimic commit handled outside
            runner._db_session = _fake_db_session
            return runner


def _add_runner_strategy(runner, strat, stype):
    """Inject a StrategyRunner into runner.strategies for testing."""
    from trading.strategy_runner import StrategyRunner
    sr = StrategyRunner(
        strategy_id=strat.id,
        strategy_name=strat.name,
        strategy_type=stype,
        config={"strategy_type": stype},
        max_positions=5,
        capital_allocation_pct=0.5,
    )
    # also set portfolio allocation
    runner.portfolio.set_strategy_allocation(strat.id, strat.name, 0.5, 5)
    runner.strategies[strat.id] = sr
    return sr


class TestStaleIntraday:

    def test_intraday_yesterday_is_force_closed(self, db, user, bot):
        """Intraday positions with entry_date < today must be purged."""
        strat = _make_strategy(db, "ORB", "ORB-1")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        yesterday = datetime.now(IST) - timedelta(days=1)
        yesterday = yesterday.replace(hour=10, minute=0, second=0, microsecond=0)
        _add_pos(db, bot, user, strat, "RELIANCE", "ORB", yesterday)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "ORB")
        runner._ist_now = lambda: datetime.now(IST)
        with patch.object(runner, '_get_data_fetcher', return_value=None), \
             patch.object(runner, '_persist_trade_to_db') as mock_trade, \
             patch.object(runner, '_persist_position_to_db') as mock_pos:
            runner._load_positions_from_db()
            assert len(runner.portfolio.positions) == 0
            mock_trade.assert_called_once()
            assert mock_trade.call_args[0][0]['exit_reason'] == "FORCE_CLOSE"

    def test_swing_yesterday_not_closed(self, db, user, bot):
        """Swing positions must survive overnight."""
        strat = _make_strategy(db, "52W_CHASER", "52W-1")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        yesterday = datetime.now(IST) - timedelta(days=1)
        yesterday = yesterday.replace(hour=10, minute=0, second=0, microsecond=0)
        _add_pos(db, bot, user, strat, "TATAMOTORS", "52W_CHASER", yesterday)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "52W_CHASER")
        runner._ist_now = lambda: datetime.now(IST)
        with patch.object(runner, '_persist_trade_to_db') as mock_trade:
            runner._load_positions_from_db()
            assert len(runner.portfolio.positions) == 1
            mock_trade.assert_not_called()

    def test_swing_two_days_ago_not_closed(self, db, user, bot):
        strat = _make_strategy(db, "VOLUME_SURGE", "VOL-1")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        two_days = datetime.now(IST) - timedelta(days=2)
        two_days = two_days.replace(hour=10, minute=0)
        _add_pos(db, bot, user, strat, "INFY", "VOLUME_SURGE", two_days)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "VOLUME_SURGE")
        runner._ist_now = lambda: datetime.now(IST)
        with patch.object(runner, '_persist_trade_to_db') as mock_trade:
            runner._load_positions_from_db()
            assert len(runner.portfolio.positions) == 1
            mock_trade.assert_not_called()

    def test_intraday_today_not_closed(self, db, user, bot):
        strat = _make_strategy(db, "SR_BREAKOUT", "SR-1")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        today = datetime.now(IST).replace(hour=9, minute=30, second=0, microsecond=0)
        _add_pos(db, bot, user, strat, "HDFC", "SR_BREAKOUT", today)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "SR_BREAKOUT")
        runner._ist_now = lambda: today + timedelta(hours=1)
        with patch.object(runner, '_persist_trade_to_db') as mock_trade:
            runner._load_positions_from_db()
            assert len(runner.portfolio.positions) == 1
            mock_trade.assert_not_called()

    def test_empty_strategy_type_uses_runner_config(self, db, user, bot):
        """If Position.strategy_type is empty, fallback to runner config (swing) should protect."""
        strat = _make_strategy(db, "ADX_TREND", "ADX-1")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        yesterday = datetime.now(IST) - timedelta(days=1)
        _add_pos(db, bot, user, strat, "ADANI", "", yesterday)  # empty type
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "ADX_TREND")
        runner._ist_now = lambda: datetime.now(IST)
        with patch.object(runner, '_persist_trade_to_db') as mock_trade:
            runner._load_positions_from_db()
            assert len(runner.portfolio.positions) == 1
            mock_trade.assert_not_called()

    def test_multiple_bots_isolation(self, db, user, bot):
        bot2 = BotConfig(name="Bot2", user_id=user.id, max_total_positions=10, max_total_capital_pct=0.80)
        db.add(bot2)
        db.commit()
        db.refresh(bot2)
        strat = _make_strategy(db, "ORB", "ORB-X")
        for b in (bot, bot2):
            db.execute(bot_strategies.insert().values(bot_id=b.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        yesterday = datetime.now(IST) - timedelta(days=1)
        _add_pos(db, bot, user, strat, "RELIANCE", "ORB", yesterday)
        _add_pos(db, bot2, user, strat, "RELIANCE", "ORB", yesterday)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "ORB")
        runner._ist_now = lambda: datetime.now(IST)
        runner._load_positions_from_db()
        remaining = db.query(Position).filter(Position.bot_id == bot2.id).all()
        assert len(remaining) == 1
        assert len(runner.portfolio.positions) == 0

    def test_is_test_not_purged_for_live(self, db, user, bot):
        strat = _make_strategy(db, "ORB", "ORB-T")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        yesterday = datetime.now(IST) - timedelta(days=1)
        _add_pos(db, bot, user, strat, "TST", "ORB", yesterday, is_test=True)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "ORB")
        runner._ist_now = lambda: datetime.now(IST)
        runner._load_positions_from_db()
        assert len(runner.portfolio.positions) == 0

    def test_entry_time_none_not_crash(self, db, user, bot):
        strat = _make_strategy(db, "ORB", "ORB-NONE")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        today = datetime.now(IST)
        _add_pos(db, bot, user, strat, "NULLTEST", "ORB", today)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "ORB")
        runner._ist_now = lambda: datetime.now(IST)
        try:
            runner._load_positions_from_db()
        except Exception as e:
            pytest.fail(f"Should not crash on None entry_time: {e}")

    def test_corrupted_metadata_json_not_crash(self, db, user, bot):
        strat = _make_strategy(db, "ORB", "ORB-CORRUPT")
        db.execute(bot_strategies.insert().values(bot_id=bot.id, strategy_id=strat.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        p = _add_pos(db, bot, user, strat, "CORRUPT", "ORB", datetime.now(IST))
        p.metadata_json = "{not json"
        db.commit()
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, strat, "ORB")
        runner._ist_now = lambda: datetime.now(IST)
        runner._load_positions_from_db()
        key = f"{strat.id}_CORRUPT"
        assert key in runner.portfolio.positions

    def test_mixed_intraday_swing_same_bot(self, db, user, bot):
        s1 = _make_strategy(db, "ORB", "ORB-MIX")
        s2 = _make_strategy(db, "52W_CHASER", "52W-MIX")
        for s in (s1, s2):
            db.execute(bot_strategies.insert().values(bot_id=s.id, strategy_id=s.id, max_positions=5, capital_allocation_pct=0.5))
        db.commit()
        yesterday = datetime.now(IST) - timedelta(days=1)
        _add_pos(db, bot, user, s1, "ORB_SYM", "ORB", yesterday)
        _add_pos(db, bot, user, s2, "SWING_SYM", "52W_CHASER", yesterday)
        runner = _make_runner(bot, user, db)
        _add_runner_strategy(runner, s1, "ORB")
        _add_runner_strategy(runner, s2, "52W_CHASER")
        runner._ist_now = lambda: datetime.now(IST)
        with patch.object(runner, '_persist_trade_to_db') as mt:
            runner._load_positions_from_db()
            assert len(runner.portfolio.positions) == 1
            assert f"{s2.id}_SWING_SYM" in runner.portfolio.positions
            assert f"{s1.id}_ORB_SYM" not in runner.portfolio.positions
            assert mt.call_count == 1


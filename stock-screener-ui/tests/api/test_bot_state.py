"""
Bot State API Tests

Tests for api/bot_state.py — get_bot_state() and related logic.

Test categories:
1. Bot not found → returns None
2. Bot found with positions in DB → full state dict
3. Bot found with no positions → empty positions
4. Strategy runtime state aggregation
5. Scan items from DB first, Redis fallback
6. Portfolio value calculations
7. daily_loss_limit_exceeded logic
8. max_daily_loss_pct from strategy configs
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from sqlalchemy.orm import Session

from api.bot_state import get_bot_state
from db.models import (
    BotConfig, StrategyConfig, BotRuntimeState, StrategyRuntimeState,
    Position, bot_strategies,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_bot(db: Session, user_id: int = 1, name: str = "Test Bot",
              max_total_capital_pct: float = 0.8) -> BotConfig:
    bot = BotConfig(
        user_id=user_id,
        name=name,
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=max_total_capital_pct,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    return bot


def _make_strategy(db: Session, name: str = "ORB",
                   strategy_type: str = "orb_breakout",
                   max_daily_loss_pct: float = 0.02) -> StrategyConfig:
    s = StrategyConfig(
        name=name,
        strategy_type=strategy_type,
        is_active=True,
        max_daily_loss_pct=max_daily_loss_pct,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _link_bot_strategy(db: Session, bot_id: int, strategy_id: int,
                       max_positions: int = 3,
                       capital_allocation_pct: float = 0.25):
    db.execute(
        bot_strategies.insert().values(
            bot_id=bot_id,
            strategy_id=strategy_id,
            max_positions=max_positions,
            capital_allocation_pct=capital_allocation_pct,
        )
    )
    db.commit()


def _make_bot_runtime(db: Session, bot_id: int, user_id: int = 1,
                      cash: float = 800_000, daily_pnl: float = 0.0,
                      daily_trades: int = 0, realized_pnl: float = 0.0,
                      scan_items: str = "", watchlist: str = "") -> BotRuntimeState:
    rt = BotRuntimeState(
        bot_id=bot_id,
        user_id=user_id,
        cash=cash,
        daily_pnl=daily_pnl,
        daily_trades=daily_trades,
        realized_pnl=realized_pnl,
        scan_items=scan_items,
        watchlist=watchlist,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(rt)
    db.commit()
    db.refresh(rt)
    return rt


def _make_strategy_runtime(db: Session, bot_id: int, strategy_id: int,
                           user_id: int = 1, status: str = "running",
                           signals_generated: int = 5, trades_executed: int = 3,
                           capital_used: float = 50_000,
                           realized_pnl: float = 1000.0,
                           last_scan_time: datetime | None = None) -> StrategyRuntimeState:
    rt = StrategyRuntimeState(
        bot_id=bot_id,
        strategy_id=strategy_id,
        user_id=user_id,
        status=status,
        signals_generated=signals_generated,
        trades_executed=trades_executed,
        capital_used=capital_used,
        realized_pnl=realized_pnl,
        last_scan_time=last_scan_time or datetime.now(timezone.utc),
    )
    db.add(rt)
    db.commit()
    db.refresh(rt)
    return rt


def _make_position(db: Session, bot_id: int, user_id: int = 1,
                   strategy_id: int | None = None, symbol: str = "TCS",
                   side: str = "BUY", quantity: int = 10,
                   entry_price: float = 3500.0,
                   current_price: float = 3550.0,
                   unrealized_pnl: float = 500.0,
                   is_test: bool = False) -> Position:
    p = Position(
        user_id=user_id,
        bot_id=bot_id,
        strategy_id=strategy_id,
        strategy_name="ORB",
        symbol=symbol,
        side=side,
        quantity=quantity,
        entry_price=entry_price,
        current_price=current_price,
        unrealized_pnl=unrealized_pnl,
        unrealized_pnl_pct=round(unrealized_pnl / (entry_price * quantity) * 100, 2),
        stop_loss=entry_price * 0.99,
        take_profit=entry_price * 1.02,
        entry_time=datetime.now(timezone.utc),
        is_test=is_test,
        strategy_type="orb_breakout",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# ============================================================================
# Tests — Bot not found
# ============================================================================

@pytest.mark.unit
class TestBotNotFound:

    def test_returns_none_for_nonexistent_bot(self, db: Session):
        result = get_bot_state(bot_id=999, user_id=1, db=db)
        assert result is None

    def test_returns_none_for_wrong_user(self, db: Session):
        bot = _make_bot(db, user_id=1)
        result = get_bot_state(bot_id=bot.id, user_id=2, db=db)
        assert result is None


# ============================================================================
# Tests — Bot with no positions
# ============================================================================

@pytest.mark.unit
class TestBotWithNoPositions:

    def test_returns_state_with_empty_positions(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id, cash=800_000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result is not None
        assert result['positions'] == []
        assert result['portfolio']['total_positions'] == 0

    def test_portfolio_defaults_without_runtime(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result is not None
        assert result['portfolio']['cash'] == 0.8 * 1_000_000
        assert result['portfolio']['initial_capital'] == 0.8 * 1_000_000
        assert result['portfolio']['position_value'] == 0
        assert result['portfolio']['unrealized_pnl'] == 0
        assert result['portfolio']['realized_pnl'] == 0
        assert result['portfolio']['total_value'] == 0.8 * 1_000_000
        assert result['portfolio']['total_pnl'] == 0
        assert result['portfolio']['daily_pnl'] == 0
        assert result['portfolio']['daily_trades'] == 0

    def test_excludes_test_positions(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id)
        _make_position(db, bot_id=bot.id, symbol="TEST", is_test=True)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result is not None
        assert len(result['positions']) == 0


# ============================================================================
# Tests — Bot with positions
# ============================================================================

@pytest.mark.unit
class TestBotWithPositions:

    def test_returns_positions_list(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db)
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id, cash=800_000)
        _make_position(db, bot_id=bot.id, strategy_id=strat.id,
                       symbol="TCS", quantity=10, entry_price=3500,
                       current_price=3550, unrealized_pnl=500)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result is not None
        assert len(result['positions']) == 1
        pos = result['positions'][0]
        assert pos['symbol'] == 'TCS'
        assert pos['quantity'] == 10
        assert pos['unrealized_pnl'] == 500

    def test_multiple_positions(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id)
        _make_position(db, bot_id=bot.id, symbol="TCS", quantity=10,
                       entry_price=3500, current_price=3550, unrealized_pnl=500)
        _make_position(db, bot_id=bot.id, symbol="INFY", quantity=20,
                       entry_price=1500, current_price=1480, unrealized_pnl=-400)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert len(result['positions']) == 2
        symbols = {p['symbol'] for p in result['positions']}
        assert symbols == {"TCS", "INFY"}

    def test_position_has_strategy_type_and_peak_low(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id)
        pos = _make_position(db, bot_id=bot.id, symbol="RELIANCE")

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        p = result['positions'][0]
        assert 'strategy_type' in p
        assert 'peak_price' in p
        assert 'low_price' in p


# ============================================================================
# Tests — Strategy aggregation
# ============================================================================

@pytest.mark.unit
class TestStrategyAggregation:

    def test_strategy_with_runtime_state(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db, name="ORB", strategy_type="orb_breakout")
        _link_bot_strategy(db, bot.id, strat.id, max_positions=5,
                           capital_allocation_pct=0.3)
        _make_bot_runtime(db, bot_id=bot.id, cash=800_000)
        _make_strategy_runtime(
            db, bot_id=bot.id, strategy_id=strat.id,
            status="running", signals_generated=10, trades_executed=4,
            capital_used=60_000, realized_pnl=2500.0,
        )

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        strategies = result['strategies']
        assert str(strat.id) in strategies
        s = strategies[str(strat.id)]
        assert s['name'] == 'ORB'
        assert s['status'] == 'running'
        assert s['signals_generated'] == 10
        assert s['trades_executed'] == 4
        ps = s['portfolio_status']
        assert ps['allocation_pct'] == 0.3
        assert ps['allocated_capital'] == 800_000 * 0.3
        assert ps['capital_used'] == 60_000
        assert ps['available_capital'] == 800_000 * 0.3 - 60_000
        assert ps['realized_pnl'] == 2500.0
        assert ps['max_positions'] == 5

    def test_strategy_without_runtime_defaults(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db, name="EMA Cross")
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id, cash=500_000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        s = result['strategies'][str(strat.id)]
        assert s['status'] == 'pending'
        assert s['signals_generated'] == 0
        assert s['trades_executed'] == 0
        assert s['last_scan_time'] is None

    def test_strategy_without_bot_runtime(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db)
        _link_bot_strategy(db, bot.id, strat.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        s = result['strategies'][str(strat.id)]
        ps = s['portfolio_status']
        assert ps['allocated_capital'] == 0
        assert ps['capital_used'] == 0
        assert ps['available_capital'] == 0

    def test_strategy_unrealized_pnl_from_positions(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db)
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id)
        _make_position(db, bot_id=bot.id, strategy_id=strat.id,
                       symbol="TCS", unrealized_pnl=300)
        _make_position(db, bot_id=bot.id, strategy_id=strat.id,
                       symbol="INFY", unrealized_pnl=-100)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        s = result['strategies'][str(strat.id)]
        assert s['portfolio_status']['unrealized_pnl'] == 200
        assert s['portfolio_status']['positions_count'] == 2

    def test_multiple_strategies(self, db: Session):
        bot = _make_bot(db)
        s1 = _make_strategy(db, name="ORB")
        s2 = _make_strategy(db, name="EMA")
        _link_bot_strategy(db, bot.id, s1.id, capital_allocation_pct=0.6)
        _link_bot_strategy(db, bot.id, s2.id, capital_allocation_pct=0.4)
        _make_bot_runtime(db, bot_id=bot.id, cash=1_000_000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert len(result['strategies']) == 2
        assert result['portfolio']['strategies_count'] == 2
        assert str(s1.id) in result['strategies']
        assert str(s2.id) in result['strategies']

    def test_strategy_linked_but_config_missing(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id)
        # Link to a strategy_id that doesn't exist in strategy_configs
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id, strategy_id=9999,
                max_positions=3, capital_allocation_pct=0.5,
            )
        )
        db.commit()

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # The missing strategy should be skipped
        assert '9999' not in result['strategies']
        assert result['portfolio']['strategies_count'] == 0


# ============================================================================
# Tests — Scan items (DB first, Redis fallback)
# ============================================================================

@pytest.mark.unit
class TestScanItems:

    def test_scan_items_from_db(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db)
        _link_bot_strategy(db, bot.id, strat.id)
        scan_data = json.dumps([
            {"symbol": "TCS", "strategy_id": strat.id, "price": 3500},
        ])
        _make_bot_runtime(db, bot_id=bot.id, scan_items=scan_data)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert len(result['scan_items']) == 1
        assert result['scan_items'][0]['symbol'] == 'TCS'
        # Scan item should be distributed to the strategy
        assert len(result['strategies'][str(strat.id)]['scan_items']) == 1

    @patch("api.bot_state.get_redis_client")
    def test_scan_items_redis_fallback(self, mock_redis, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db)
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id, scan_items="")

        redis_data = json.dumps([
            {"symbol": "INFY", "strategy_id": strat.id, "price": 1500},
        ])
        mock_client = MagicMock()
        mock_client.get.return_value = redis_data
        mock_redis.return_value = mock_client

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert len(result['scan_items']) == 1
        assert result['scan_items'][0]['symbol'] == 'INFY'
        mock_client.get.assert_called_once_with(f"bot:{bot.id}:scan_items")

    @patch("api.bot_state.get_redis_client")
    def test_scan_items_db_takes_precedence(self, mock_redis, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db)
        _link_bot_strategy(db, bot.id, strat.id)
        db_scan = json.dumps([{"symbol": "TCS", "strategy_id": strat.id}])
        _make_bot_runtime(db, bot_id=bot.id, scan_items=db_scan)

        redis_scan = json.dumps([{"symbol": "INFY", "strategy_id": strat.id}])
        mock_client = MagicMock()
        mock_client.get.return_value = redis_scan
        mock_redis.return_value = mock_client

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # DB data wins — Redis should not be queried
        assert result['scan_items'][0]['symbol'] == 'TCS'
        mock_client.get.assert_not_called()

    @patch("api.bot_state.get_redis_client")
    def test_scan_items_no_redis_client(self, mock_redis, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id, scan_items="")
        mock_redis.return_value = None

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['scan_items'] == []

    @patch("api.bot_state.get_redis_client")
    def test_scan_items_redis_exception(self, mock_redis, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id, scan_items="")
        mock_redis.side_effect = Exception("Redis down")

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['scan_items'] == []

    def test_scan_items_distributed_to_strategies(self, db: Session):
        bot = _make_bot(db)
        s1 = _make_strategy(db, name="ORB")
        s2 = _make_strategy(db, name="EMA")
        _link_bot_strategy(db, bot.id, s1.id)
        _link_bot_strategy(db, bot.id, s2.id)
        scan_data = json.dumps([
            {"symbol": "TCS", "strategy_id": s1.id},
            {"symbol": "INFY", "strategy_id": s2.id},
            {"symbol": "RELIANCE", "strategy_id": s1.id},
        ])
        _make_bot_runtime(db, bot_id=bot.id, scan_items=scan_data)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert len(result['strategies'][str(s1.id)]['scan_items']) == 2
        assert len(result['strategies'][str(s2.id)]['scan_items']) == 1


# ============================================================================
# Tests — Portfolio calculations
# ============================================================================

@pytest.mark.unit
class TestPortfolioCalculations:

    def test_position_value_calculation(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id, cash=700_000)
        _make_position(db, bot_id=bot.id, symbol="TCS",
                       quantity=10, current_price=3500)
        _make_position(db, bot_id=bot.id, symbol="INFY",
                       quantity=20, current_price=1500)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # position_value = 10*3500 + 20*1500 = 65000
        assert result['portfolio']['position_value'] == 65_000
        # total_value = 700_000 + 65_000
        assert result['portfolio']['total_value'] == 765_000

    def test_total_pnl_calculation(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)
        _make_bot_runtime(db, bot_id=bot.id, cash=790_000)
        _make_position(db, bot_id=bot.id, symbol="TCS",
                       quantity=10, current_price=3500, entry_price=3000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        initial = 0.8 * 1_000_000  # 800_000
        position_value = 10 * 3500  # 35_000
        total_value = 790_000 + position_value  # 825_000
        total_pnl = total_value - initial  # 25_000
        assert result['portfolio']['total_pnl'] == total_pnl
        assert result['portfolio']['total_pnl_pct'] == pytest.approx(total_pnl / initial * 100)

    def test_capital_used_from_strategies(self, db: Session):
        bot = _make_bot(db)
        s1 = _make_strategy(db, name="ORB")
        s2 = _make_strategy(db, name="EMA")
        _link_bot_strategy(db, bot.id, s1.id, capital_allocation_pct=0.5)
        _link_bot_strategy(db, bot.id, s2.id, capital_allocation_pct=0.3)
        _make_bot_runtime(db, bot_id=bot.id, cash=1_000_000)
        _make_strategy_runtime(db, bot_id=bot.id, strategy_id=s1.id,
                               capital_used=100_000)
        _make_strategy_runtime(db, bot_id=bot.id, strategy_id=s2.id,
                               capital_used=50_000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['capital_used'] == 150_000

    def test_cash_from_runtime(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id, cash=650_000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['cash'] == 650_000

    def test_realized_pnl_from_runtime(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id, realized_pnl=5000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['realized_pnl'] == 5000


# ============================================================================
# Tests — Daily loss limit
# ============================================================================

@pytest.mark.unit
class TestDailyLossLimit:

    def test_daily_loss_not_exceeded(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)
        strat = _make_strategy(db, max_daily_loss_pct=0.03)
        _link_bot_strategy(db, bot.id, strat.id)
        # daily_pnl = -1000, initial_capital=800_000, limit=800_000*0.03=24_000
        _make_bot_runtime(db, bot_id=bot.id, daily_pnl=-1000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['daily_loss_limit_exceeded'] is False

    def test_daily_loss_exceeded(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)
        strat = _make_strategy(db, max_daily_loss_pct=0.03)
        _link_bot_strategy(db, bot.id, strat.id)
        # daily_pnl = -30000, limit = 800_000*0.03 = 24_000
        _make_bot_runtime(db, bot_id=bot.id, daily_pnl=-30_000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['daily_loss_limit_exceeded'] is True

    def test_daily_loss_exactly_at_limit(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)
        strat = _make_strategy(db, max_daily_loss_pct=0.03)
        _link_bot_strategy(db, bot.id, strat.id)
        limit = 800_000 * 0.03  # 24_000
        _make_bot_runtime(db, bot_id=bot.id, daily_pnl=-limit)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # abs(daily_pnl) >= initial * max_daily_loss_pct → True
        assert result['portfolio']['daily_loss_limit_exceeded'] is True

    def test_positive_daily_pnl_not_exceeded(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)
        strat = _make_strategy(db, max_daily_loss_pct=0.03)
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id, daily_pnl=5000)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['daily_loss_limit_exceeded'] is False

    def test_no_runtime_daily_loss_false(self, db: Session):
        bot = _make_bot(db, max_total_capital_pct=0.8)
        strat = _make_strategy(db, max_daily_loss_pct=0.03)
        _link_bot_strategy(db, bot.id, strat.id)
        # No BotRuntimeState created

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['daily_loss_limit_exceeded'] is False


# ============================================================================
# Tests — max_daily_loss_pct aggregation
# ============================================================================

@pytest.mark.unit
class TestMaxDailyLossPct:

    def test_default_max_daily_loss_pct(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # No strategies → default 0.03
        assert result['portfolio']['max_daily_loss_pct'] == 0.03

    def test_max_daily_loss_pct_from_strategy(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db, max_daily_loss_pct=0.05)
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['max_daily_loss_pct'] == 0.05

    def test_max_daily_loss_pct_picks_highest(self, db: Session):
        bot = _make_bot(db)
        s1 = _make_strategy(db, name="ORB", max_daily_loss_pct=0.02)
        s2 = _make_strategy(db, name="EMA", max_daily_loss_pct=0.07)
        _link_bot_strategy(db, bot.id, s1.id)
        _link_bot_strategy(db, bot.id, s2.id)
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['max_daily_loss_pct'] == 0.07

    def test_max_daily_loss_pct_floor_at_default(self, db: Session):
        bot = _make_bot(db)
        strat = _make_strategy(db, max_daily_loss_pct=0.01)
        _link_bot_strategy(db, bot.id, strat.id)
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # 0.01 < 0.03 default → max keeps 0.03
        assert result['portfolio']['max_daily_loss_pct'] == 0.03


# ============================================================================
# Tests — Watchlist
# ============================================================================

@pytest.mark.unit
class TestWatchlist:

    def test_watchlist_from_runtime(self, db: Session):
        bot = _make_bot(db)
        wl = json.dumps(["TCS", "INFY", "RELIANCE"])
        _make_bot_runtime(db, bot_id=bot.id, watchlist=wl)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['watchlist'] == ["TCS", "INFY", "RELIANCE"]

    def test_watchlist_empty_when_no_runtime(self, db: Session):
        bot = _make_bot(db)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['watchlist'] == []


# ============================================================================
# Tests — Top-level response shape
# ============================================================================

@pytest.mark.unit
class TestResponseShape:

    def test_top_level_keys(self, db: Session):
        bot = _make_bot(db)
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        expected_keys = {
            'timestamp', 'bot_id', 'bot_name', 'running',
            'watchlist', 'strategy_watchlists', 'portfolio', 'strategies', 'positions', 'scan_items',
        }
        assert set(result.keys()) == expected_keys

    def test_bot_id_and_name(self, db: Session):
        bot = _make_bot(db, name="Alpha Bot")
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['bot_id'] == bot.id
        assert result['bot_name'] == "Alpha Bot"
        assert result['running'] is True

    def test_timestamp_from_runtime(self, db: Session):
        bot = _make_bot(db)
        now = datetime.now(timezone.utc)
        _make_bot_runtime(db, bot_id=bot.id)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        # Should be a valid ISO timestamp string
        assert 'T' in result['timestamp']
        assert result['timestamp'] is not None

    def test_total_trades_aggregated(self, db: Session):
        bot = _make_bot(db)
        s1 = _make_strategy(db, name="ORB")
        s2 = _make_strategy(db, name="EMA")
        _link_bot_strategy(db, bot.id, s1.id)
        _link_bot_strategy(db, bot.id, s2.id)
        _make_bot_runtime(db, bot_id=bot.id)
        _make_strategy_runtime(db, bot_id=bot.id, strategy_id=s1.id,
                               trades_executed=5)
        _make_strategy_runtime(db, bot_id=bot.id, strategy_id=s2.id,
                               trades_executed=3)

        result = get_bot_state(bot_id=bot.id, user_id=1, db=db)

        assert result['portfolio']['total_trades'] == 8

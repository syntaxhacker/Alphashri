"""Column-projection regressions for the non-agri trade analytics reads.

Each endpoint is executed twice against the same in-memory database: once with
the production projection and once with a session wrapper that forces the old
full-row ``query(Trade)`` shape. The payloads must be identical. No wall-clock
assertions live here; timing is reported by ``scripts/perf/db_query_bench.py``.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import config

pytestmark = pytest.mark.unit

_REPO = Path(__file__).resolve().parents[2]
MODULE_PATHS = (
    "api/strategy_performance.py",
    "api/paper/dashboard_analytics.py",
    "api/paper/analytics.py",
    "api/paper/aggregated.py",
)
USER_ID = 7
OTHER_USER_ID = 8
N_TRADES = 2400
SYMBOLS = ("RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "WIPRO", "BHARTIARTL", "KOTAK", "ASIANPAINT", "MARUTI", "TITAN")
# Columns that no aggregator consumes; fetching them is the cost being removed.
HEAVY_COLUMNS = frozenset({
    "notes", "reason", "quantity", "entry_price", "exit_price", "source",
    "stop_loss", "take_profit", "peak_price", "low_price", "created_at", "is_test", "uuid",
})


@pytest.fixture(scope="module")
def seeded_engine():
    """Fresh in-memory SQLite DB with >2k trades and realistic noise rows."""
    from db.database import Base
    from db.models import User, Trade, BotConfig, StrategyConfig
    from db.models.bot import bot_strategies
    from tests.helpers.db import import_all_models

    import_all_models()
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)

    now = datetime.now(config.IST).replace(tzinfo=None)
    with engine.begin() as conn:
        conn.execute(User.__table__.insert(), [
            {"id": USER_ID, "email": "proj-user@example.test", "hashed_password": "x", "is_active": 1},
            {"id": OTHER_USER_ID, "email": "proj-other@example.test", "hashed_password": "x", "is_active": 1},
        ])
        conn.execute(BotConfig.__table__.insert(), [
            {"id": bid, "uuid": f"proj-bot-{bid}", "user_id": uid, "name": f"Bot{bid}",
             "created_at": now, "updated_at": now}
            for bid, uid in ((1, USER_ID), (2, USER_ID), (3, USER_ID), (4, OTHER_USER_ID))
        ])
        conn.execute(StrategyConfig.__table__.insert(), [
            {"id": sid, "uuid": f"proj-strategy-{sid}", "name": f"Strategy{sid}",
             "strategy_type": "ORB", "created_at": now, "updated_at": now}
            for sid in range(1, 5)
        ])
        conn.execute(bot_strategies.insert(), [
            {"bot_id": bid, "strategy_id": sid, "max_positions": 3, "capital_allocation_pct": 0.2}
            for bid, sids in ((1, (1, 2)), (2, (2, 3)), (3, (3, 4))) for sid in sids
        ])

        trade_rows = []
        for i in range(N_TRADES):
            if i % 17 == 0:
                # Today's exit: exercises the aggregated dashboard's day bounds.
                exit_at = now - timedelta(seconds=(i % 500) + 1, microseconds=i)
            else:
                exit_at = now - timedelta(days=i % 120, minutes=i % 60, seconds=i % 60, microseconds=i)
            entry_at = exit_at - timedelta(minutes=30 + (i % 90))
            net = round(25.0 + (i % 41) * 3.5 - 70.0, 2)
            trade_rows.append({
                "uuid": f"proj-trade-{i:06d}",
                "user_id": USER_ID if i % 11 else OTHER_USER_ID,
                "bot_id": None if i % 61 == 0 else (i % 3) + 1,
                "strategy_id": None if i % 29 == 0 else (i % 4) + 1,
                "strategy_name": "" if i % 19 == 0 else f"Strategy{(i % 4) + 1}",
                "symbol": SYMBOLS[i % len(SYMBOLS)],
                "side": "BUY" if i % 2 else "SELL",
                "quantity": 1 + (i % 9),
                "entry_price": 100.0 + (i % 50),
                "entry_time": entry_at,
                "created_at": entry_at,
                "is_test": i % 23 == 0,
                "exit_time": exit_at,
                "pnl": round(30.0 + (i % 41) * 3.5, 2),
                "pnl_pct": 0.5 + (i % 7),
                "costs": 2.5 + (i % 5),
                "net_pnl": net,
                "exit_reason": "" if i % 13 == 0 else ("TP" if i % 2 else "SL"),
                "source": "live",
            })
        conn.execute(Trade.__table__.insert(), trade_rows)
    yield engine
    engine.dispose()


class _RecordingSession:
    """Records query shapes and can force the legacy full-row read for a reference run."""

    def __init__(self, session, trade_model, calls, force_full_rows):
        self._session = session
        self._trade = trade_model
        self.calls = calls
        self.force_full_rows = force_full_rows

    def query(self, *columns):
        self.calls.append(columns)
        if self.force_full_rows and any(
            getattr(column, "class_", None) is self._trade for column in columns
        ):
            return self._session.query(self._trade)
        return self._session.query(*columns)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return self._session.__exit__(*exc)

    def __getattr__(self, name):
        return getattr(self._session, name)


def _session_factory(engine, trade_model, calls, force_full_rows):
    maker = sessionmaker(bind=engine)
    return lambda: _RecordingSession(maker(), trade_model, calls, force_full_rows)


def _projected_and_full(run, module, engine, trade_model, patch_target=None):
    projected_calls, reference_calls = [], []
    target = patch_target or f"{module.__name__}.SessionLocal"
    with patch(target, _session_factory(engine, trade_model, projected_calls, False)):
        projected = run()
    with patch(target, _session_factory(engine, trade_model, reference_calls, True)):
        reference = run()

    trade_calls = [
        columns for columns in projected_calls
        if any(getattr(column, "class_", None) is trade_model for column in columns)
    ]
    assert trade_calls, "trade read did not happen"
    assert all(len(columns) > 1 for columns in trade_calls), "a full-row trade read remains"
    projected_columns = {getattr(column, "key", None) for columns in trade_calls for column in columns}
    assert not projected_columns & HEAVY_COLUMNS, projected_columns
    return projected, reference, trade_calls


class TestStrategyPerformanceProjection:
    def test_matches_full_row_aggregates(self, seeded_engine):
        from db.models import Trade
        from api import strategy_performance

        def run():
            return strategy_performance.get_strategy_performance(
                days=400, user=SimpleNamespace(id=USER_ID)
            )

        projected, reference, _ = _projected_and_full(
            run, strategy_performance, seeded_engine, Trade
        )
        assert projected == reference
        assert projected["total_trades"] > 1000
        assert projected["strategies"]


class TestDashboardAnalyticsProjection:
    @pytest.mark.parametrize("preset", ["ALL", "30D", "90D"])
    def test_matches_full_row_aggregates(self, seeded_engine, preset):
        from db.models import Trade
        from api.paper import dashboard_analytics

        def run():
            return dashboard_analytics.get_dashboard_analytics(
                preset=preset, from_date=None, to_date=None, bot_id=None,
                user=SimpleNamespace(id=USER_ID),
            )

        projected, reference, _ = _projected_and_full(
            run, dashboard_analytics, seeded_engine, Trade
        )
        assert projected == reference
        assert projected["period"]["trade_count"] > 0
        assert projected["bot_rankings"] and projected["biggest_winners"]


class TestAnalyticsProjection:
    def test_matches_full_row_aggregates(self, seeded_engine):
        from db.models import Trade
        from api.paper import analytics

        def run():
            return analytics.get_analytics(days_back=400, user=SimpleNamespace(id=USER_ID))

        projected, reference, _ = _projected_and_full(
            run, analytics, seeded_engine, Trade, patch_target="db.database.SessionLocal"
        )
        assert projected == reference
        assert projected["summary"]["total_trades"] > 1000
        assert projected["daily_pnl"] and projected["symbol_performance"]


class TestAggregatedProjection:
    def test_matches_full_row_aggregates(self, seeded_engine):
        from db.models import Trade
        from api.paper import aggregated

        positions = [
            {"symbol": "A", "strategy_id": 1, "pnl": 1.5, "current_price": 100.0, "quantity": 2},
            {"symbol": "B", "strategy_id": 2, "pnl": -0.5, "current_price": 50.0, "quantity": 3},
        ]

        def run():
            with patch("trading.paper_trader.get_paper_trader") as get_trader, patch.object(
                aggregated, "Path"
            ) as mock_path:
                get_trader.return_value.get_positions.return_value = positions
                mock_path.return_value.exists.return_value = False
                return aggregated.get_aggregated_dashboard(user=SimpleNamespace(id=USER_ID))

        projected, reference, _ = _projected_and_full(
            run, aggregated, seeded_engine, Trade
        )
        assert projected == reference
        assert projected["summary"]["total_daily_pnl"] != 0
        assert len(projected["bots"]) == 3


class TestNoFullRowTradeReads:
    @pytest.mark.parametrize("relative_path", MODULE_PATHS)
    def test_module_selects_only_needed_trade_columns(self, relative_path):
        source = (_REPO / relative_path).read_text(encoding="utf-8")
        assert not re.search(r"\.query\(\s*Trade(?:Model)?\s*\)", source), relative_path
        assert not re.search(r"\bselect\(\s*Trade(?:Model)?\s*\)", source), relative_path
        assert re.search(r"\.query\(\s*Trade(?:Model)?\.\w+", source), relative_path
        assert "is_test == False" in source, relative_path
        assert "exit_time" in source, relative_path

    def test_all_preset_stays_unbounded(self):
        source = (_REPO / "api/paper/dashboard_analytics.py").read_text(encoding="utf-8")
        bounds = source.split("def _period_bounds", 1)[1].split("def _profit_factor", 1)[0]
        assert re.search(r'if preset_key == "ALL":.*?return None, end', bounds, re.S)

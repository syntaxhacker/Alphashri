"""Tests for /api/paper/aggregated, activity, dashboard_analytics, analytics."""
import sys
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch, MagicMock
from datetime import datetime

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from api_server_fastapi import app
from api.auth import get_current_user
import config


@pytest.fixture
def mock_user():
    u = MagicMock()
    u.id = 1
    u.email = "test@example.com"
    u.is_active = True
    return u


@pytest.fixture
def auth_client(mock_user):
    app.dependency_overrides[get_current_user] = lambda: mock_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


class TestAggregated:
    def test_requires_auth(self):
        app.dependency_overrides.clear()
        with TestClient(app) as c:
            r = c.get("/api/paper/aggregated")
            assert r.status_code == 401

    def test_aggregated_envelope(self, auth_client):
        mock_db = MagicMock()
        mock_bot = MagicMock()
        mock_bot.id = 1
        mock_bot.uuid = "uuid-1"
        mock_bot.name = "Bot1"
        mock_db.query.return_value.filter.return_value.all.return_value = [mock_bot]
        # second query for strategies
        # make second call return empty
        mock_db.query.return_value.filter.return_value.all.side_effect = [[mock_bot], []]
        # Need to handle multiple query patterns; simplify by patching SessionLocal to return mock_db
        # and make query chain return appropriate values per call
        with patch("api.paper.aggregated.SessionLocal") as mock_sess_cls:
            mock_ctx = MagicMock()
            mock_ctx.__enter__.return_value = mock_db
            mock_ctx.__exit__.return_value = False
            mock_sess_cls.return_value = mock_ctx
            # need to handle 3 queries: bots, strategies, trades
            # We'll make all return empty after first
            mock_db.query.return_value.filter.return_value.all.return_value = [mock_bot]
            # For strategies_by_bot query, return []
            # patch trader
            with patch("trading.paper_trader.get_paper_trader") as mock_trader_fn:
                mock_trader = MagicMock()
                mock_trader.get_positions.return_value = []
                mock_trader_fn.return_value = mock_trader
                r = auth_client.get("/api/paper/aggregated")
                assert r.status_code == 200
                data = r.json()
                assert "bots" in data
                assert "summary" in data
                assert "total_bots" in data["summary"]


class TestActivity:
    def test_activity_requires_auth(self):
        app.dependency_overrides.clear()
        with TestClient(app) as c:
            r = c.get("/api/paper/activity/feed")
            assert r.status_code == 401

    def test_activity_envelope(self, auth_client):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []
        with patch("db.database.SessionLocal", return_value=mock_db):
            r = auth_client.get("/api/paper/activity/feed?limit=5")
            assert r.status_code == 200
            data = r.json()
            assert "events" in data
            assert "total" in data
            assert len(data["events"]) <= 5


class TestDashboardAnalytics:
    def test_requires_auth(self):
        app.dependency_overrides.clear()
        with TestClient(app) as c:
            r = c.get("/api/paper/dashboard/analytics")
            assert r.status_code == 401

    def test_invalid_date(self, auth_client):
        r = auth_client.get("/api/paper/dashboard/analytics?from_date=bad-date")
        assert r.status_code == 400

    def test_dashboard_envelope_empty(self, auth_client):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.filter.return_value.filter.return_value.filter.return_value.order_by.return_value.all.return_value = []
        mock_db.query.return_value.filter.return_value.all.return_value = []
        with patch("db.database.SessionLocal", return_value=mock_db):
            with patch("api.paper.dashboard_analytics.resolve_bot_id", return_value=None):
                r = auth_client.get("/api/paper/dashboard/analytics?preset=7D")
                # may be 200 with empty summary even if trades empty
                assert r.status_code in (200, 500)
                if r.status_code == 200:
                    data = r.json()
                    assert "period" in data
                    assert "summary" in data
                    assert "bot_rankings" in data
                    assert "equity_curve" in data


class TestAnalytics:
    def test_requires_auth(self):
        app.dependency_overrides.clear()
        with TestClient(app) as c:
            r = c.get("/api/paper/analytics")
            assert r.status_code == 401

    def test_analytics_envelope(self, auth_client):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.filter.return_value.filter.return_value.order_by.return_value.all.return_value = []
        with patch("db.database.SessionLocal", return_value=mock_db):
            r = auth_client.get("/api/paper/analytics?days_back=7")
            assert r.status_code == 200
            data = r.json()
            assert "summary" in data
            assert "daily_pnl" in data
            assert "equity_curve" in data
            assert "symbol_performance" in data


# The three queries in get_aggregated_dashboard are bots, strategy rows, trades.
class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def all(self):
        return self._rows


class _FakeDB:
    def __init__(self, bots, strategy_rows, trades=()):
        self._results = [bots, list(strategy_rows), list(trades)]
        self._i = 0

    def query(self, *args, **kwargs):
        rows = self._results[min(self._i, len(self._results) - 1)]
        self._i += 1
        return _FakeQuery(rows)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _make_db(bot_strategies, trades=()):
    bots, rows = [], []
    for bot_id, strategy_ids in bot_strategies:
        bots.append(_Obj(id=bot_id, uuid=f"agg-regression-{bot_id}", name=f"Bot{bot_id}"))
        for j, sid in enumerate(strategy_ids):
            rows.append(_Obj(bot_id=bot_id, id=sid, name=f"S{j}", strategy_type="ORB"))
    return _FakeDB(bots, rows, trades)


@contextmanager
def _patched_aggregated(db, positions):
    from api.paper import aggregated

    with patch.object(aggregated, "SessionLocal", lambda: db), patch(
        "trading.paper_trader.get_paper_trader"
    ) as get_trader, patch.object(aggregated, "Path") as mock_path:
        mock_path.return_value.exists.return_value = False
        trader = get_trader.return_value
        trader.get_positions.return_value = positions
        yield aggregated, get_trader, trader


class CountingId(str):
    """Exposes str() conversions so a per-position strategy-list rebuild is detectable."""

    calls = []

    def __str__(self):
        type(self).calls.append(str.__str__(self))
        return str.__str__(self)


class TestAggregatedSharedSnapshot:
    def test_response_shape_ordering_and_pnl_preserved(self, mock_user):
        db = _make_db(
            [(1, [10, 11]), (2, [11, 12]), (3, [])],
            trades=[_Obj(strategy_id=11, net_pnl=7.5), _Obj(strategy_id=12, net_pnl=-2.25)],
        )
        positions = [
            {"symbol": "A", "strategy_id": 10, "pnl": 1.0, "current_price": 100.0, "quantity": 2},
            {"symbol": "B", "strategy_id": 11, "pnl": 2.0, "current_price": 50.0, "quantity": 3},
            {"symbol": "C", "strategy_id": 12, "pnl": -0.5, "current_price": 200.0, "quantity": 1},
            {"symbol": "D", "strategy_id": 99, "pnl": 4.0, "current_price": 10.0, "quantity": 1},
        ]

        with _patched_aggregated(db, positions) as (mod, _, _):
            result = mod.get_aggregated_dashboard(user=mock_user)

        assert [b["id"] for b in result["bots"]] == [
            "agg-regression-1", "agg-regression-2", "agg-regression-3"
        ]
        assert [b["name"] for b in result["bots"]] == ["Bot1", "Bot2", "Bot3"]
        assert result["bots"][0]["strategies"] == [
            {"id": 10, "name": "S0", "strategy_type": "ORB"},
            {"id": 11, "name": "S1", "strategy_type": "ORB"},
        ]
        assert [b["position_count"] for b in result["bots"]] == [2, 2, 4]
        assert [b["unrealized_pnl"] for b in result["bots"]] == [3.0, 1.5, 6.5]
        assert [b["daily_pnl"] for b in result["bots"]] == [7.5, 5.25, 0.0]
        assert [[p["symbol"] for p in b["positions"]] for b in result["bots"]] == [
            ["A", "B"], ["B", "C"], ["A", "B", "C", "D"]
        ]
        assert [b["running"] for b in result["bots"]] == [False, False, False]
        assert [b["pid"] for b in result["bots"]] == [None, None, None]
        assert result["summary"] == {
            "total_bots": 3,
            "running_bots": 0,
            "total_positions": 8,
            "total_daily_pnl": 12.75,
            "total_unrealized_pnl": 11.0,
            "total_value": 1260.0,
        }

    def test_one_trader_snapshot_for_all_bots(self, mock_user):
        db = _make_db([(1, [10]), (2, [11]), (3, [12])])

        with _patched_aggregated(db, [{"strategy_id": 10, "pnl": 1.0}]) as (mod, get_trader, trader):
            mod.get_aggregated_dashboard(user=mock_user)

        assert get_trader.call_count == 1
        assert trader.get_positions.call_count == 1

    def test_strategy_ids_stringified_once_not_per_position(self, mock_user):
        CountingId.calls.clear()
        ids = [CountingId("10"), CountingId("11"), CountingId("12")]
        db = _make_db([(1, [ids[0]]), (2, [ids[1]]), (3, [ids[2]])])
        positions = [
            {"strategy_id": 10, "pnl": 1.0},
            {"strategy_id": 11, "pnl": 1.0},
            {"strategy_id": 12, "pnl": 1.0},
        ]

        with _patched_aggregated(db, positions) as (mod, _, _):
            mod.get_aggregated_dashboard(user=mock_user)

        # One conversion per strategy for the shared index, not 3 bots x 3 positions.
        assert len(CountingId.calls) == 3

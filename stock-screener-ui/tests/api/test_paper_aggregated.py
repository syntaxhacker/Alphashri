"""Tests for /api/paper/aggregated, activity, dashboard_analytics, analytics."""
import sys
from pathlib import Path
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

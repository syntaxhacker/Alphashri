"""Tests for notifications_api — surge POST/GET, auth, no leaked errors."""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from api_server_fastapi import app
from api.auth import get_current_user


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_client():
    user = MagicMock()
    user.id = 1
    user.email = "qa@test.com"
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


class TestNotificationsApi:
    def test_post_surge_ok(self, auth_client):
        mock_db = MagicMock()
        mock_db.add.return_value = None
        mock_db.commit.return_value = None
        mock_db.close.return_value = None

        def fake_add(obj):
            obj.id = 42

        mock_db.add.side_effect = fake_add
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = auth_client.post("/api/notifications/surge", json={
                "symbol": "RELIANCE",
                "move_pct": 5.0,
                "direction": "up",
                "price": 100.0,
                "screener_id": "test",
                "screen_label": "Test"
            })
            assert r.status_code == 200
            data = r.json()
            assert data["status"] == "ok"
            assert data["id"] == 42

    def test_post_surge_symbol_uppercase(self, auth_client):
        captured = {}
        mock_db = MagicMock()

        def fake_add(obj):
            captured["symbol"] = obj.symbol
            obj.id = 1

        mock_db.add.side_effect = fake_add
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = auth_client.post("/api/notifications/surge", json={
                "symbol": "tcs",
                "move_pct": 2.0,
                "direction": "up",
                "screener_id": "s1",
                "screen_label": "L1"
            })
            assert r.status_code == 200
            assert captured["symbol"] == "TCS"

    def test_get_surges_pagination(self, auth_client):
        e1 = MagicMock()
        e1.to_dict.return_value = {"symbol": "A", "id": 1}
        e2 = MagicMock()
        e2.to_dict.return_value = {"symbol": "B", "id": 2}
        mock_db = MagicMock()
        mock_query = MagicMock()
        mock_db.query.return_value = mock_query
        mock_query.count.return_value = 2
        mock_query.filter.return_value.count.return_value = 2
        mock_query.order_by.return_value.offset.return_value.limit.return_value.all.return_value = [e1, e2]
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = auth_client.get("/api/notifications/surge?limit=10&offset=0")
            assert r.status_code == 200
            data = r.json()
            assert data["total"] == 2
            assert data["today_count"] == 2
            assert len(data["events"]) == 2
            assert data["limit"] == 10

    def test_get_surges_bounded_today_count(self, auth_client):
        """The bell must receive today's count, never the 7094 all-time rows."""
        mock_db = MagicMock()
        mock_query = MagicMock()
        mock_db.query.return_value = mock_query
        mock_query.count.return_value = 7094
        mock_query.filter.return_value.count.return_value = 3
        mock_query.order_by.return_value.offset.return_value.limit.return_value.all.return_value = []
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = auth_client.get("/api/notifications/surge?limit=1&offset=0")
            assert r.status_code == 200
            data = r.json()
            assert data["total"] == 7094
            assert data["today_count"] == 3
            # A bounded query was actually issued against created_at.
            assert mock_query.filter.called
            expr = mock_query.filter.call_args.args[0]
            assert getattr(expr.left, "key", None) == "created_at"

    def test_post_surge_requires_auth(self, client):
        r = client.post("/api/notifications/surge", json={
            "symbol": "INFY",
            "move_pct": 3.0,
            "direction": "up",
            "screener_id": "s1",
            "screen_label": "L1",
        })
        assert r.status_code == 401

    def test_get_surges_requires_auth(self, client):
        assert client.get("/api/notifications/surge").status_code == 401

    def test_post_surge_does_not_leak_exception_detail(self, auth_client):
        mock_db = MagicMock()
        mock_db.commit.side_effect = RuntimeError("disk I/O error: /srv/secret/path.db")
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = auth_client.post("/api/notifications/surge", json={
                "symbol": "INFY",
                "move_pct": 3.0,
                "direction": "up",
                "screener_id": "s1",
                "screen_label": "L1",
            })
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "error"
        assert "secret" not in data["detail"]
        assert "disk I/O error" not in data["detail"]
        assert mock_db.rollback.called
        assert mock_db.close.called

    def test_handlers_are_sync_so_fastapi_uses_the_worker_pool(self):
        from api import notifications_api

        assert not __import__("inspect").iscoroutinefunction(notifications_api.record_surge)
        assert not __import__("inspect").iscoroutinefunction(notifications_api.get_surges)

    def test_no_hardcoded_secrets(self):
        text = Path(ROOT / "api" / "notifications_api.py").read_text()
        assert "sk-" not in text.lower()

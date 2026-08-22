"""Tests for notifications_api — surge POST/GET, no secrets."""
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from api_server_fastapi import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestNotificationsApi:
    def test_post_surge_ok(self, client):
        fake_event = MagicMock()
        fake_event.id = 42
        mock_db = MagicMock()
        mock_db.add.return_value = None
        mock_db.commit.return_value = None
        mock_db.close.return_value = None
        # make SessionLocal return mock_db
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            # need to make event.id after add
            def fake_add(obj):
                obj.id = 42
            mock_db.add.side_effect = fake_add
            r = client.post("/api/notifications/surge", json={
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

    def test_post_surge_symbol_uppercase(self, client):
        captured = {}
        mock_db = MagicMock()
        def fake_add(obj):
            captured["symbol"] = obj.symbol
            obj.id = 1
        mock_db.add.side_effect = fake_add
        mock_db.commit.return_value = None
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = client.post("/api/notifications/surge", json={
                "symbol": "tcs",
                "move_pct": 2.0,
                "direction": "up",
                "screener_id": "s1",
                "screen_label": "L1"
            })
            assert r.status_code == 200
            assert captured["symbol"] == "TCS"

    def test_get_surges_pagination(self, client):
        e1 = MagicMock()
        e1.to_dict.return_value = {"symbol": "A", "id": 1}
        e2 = MagicMock()
        e2.to_dict.return_value = {"symbol": "B", "id": 2}
        mock_db = MagicMock()
        mock_query = MagicMock()
        mock_db.query.return_value = mock_query
        mock_query.count.return_value = 2
        mock_query.order_by.return_value.offset.return_value.limit.return_value.all.return_value = [e1, e2]
        with patch("api.notifications_api.SessionLocal", return_value=mock_db):
            r = client.get("/api/notifications/surge?limit=10&offset=0")
            assert r.status_code == 200
            data = r.json()
            assert data["total"] == 2
            assert len(data["events"]) == 2
            assert data["limit"] == 10

    def test_no_hardcoded_secrets(self):
        text = Path(ROOT / "api" / "notifications_api.py").read_text()
        assert "sk-" not in text.lower()

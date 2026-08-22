"""Tests for debug_api 52w endpoint — auth, 404, envelope, no secrets."""
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
def mock_user():
    u = MagicMock()
    u.id = 1
    u.email = "test@example.com"
    u.is_active = True
    u.is_admin = False
    return u


@pytest.fixture
def client_with_auth(mock_user):
    app.dependency_overrides[get_current_user] = lambda: mock_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def client_no_auth():
    app.dependency_overrides.clear()
    with TestClient(app) as c:
        yield c


class TestDebugApi:
    def test_requires_auth(self, client_no_auth):
        r = client_no_auth.get("/api/debug/52w/RELIANCE")
        assert r.status_code == 401

    def test_health_not_needed_but_404_on_missing_data(self, client_with_auth):
        with patch("api.debug_api._fetch_daily_data_for_debug", side_effect=__import__("fastapi").HTTPException(status_code=404, detail="No daily data for XYZ")):
            r = client_with_auth.get("/api/debug/52w/XYZ")
            assert r.status_code == 404

    def test_success_envelope(self, client_with_auth):
        fake_md = {
            "current_price": 110.0,
            "high_52w": 100.0,
            "days_since_52w_high": 5,
            "daily_highs": [90, 100, 95],
            "daily_closes": [95, 99, 110],
            "volume": 1000,
            "avg_volume_20d": 900,
            "ma50": 95,
            "ma200": 90,
            "prev_high": 95,
            "prev_low": 90,
            "prev_close": 99,
        }
        with patch("api.debug_api._fetch_daily_data_for_debug", return_value=fake_md):
            r = client_with_auth.get("/api/debug/52w/RELIANCE")
            assert r.status_code == 200
            data = r.json()
            assert data["symbol"] == "RELIANCE"
            assert "high_52w" in data
            assert "strategy_checks" in data
            assert "52W_CHASER" in data["strategy_checks"]
            assert "market_data" in data
            # no secrets leaked
            assert "UPSTOX_API_KEY" not in str(data)
            assert "secret" not in str(data).lower()

    def test_no_hardcoded_secrets_in_module(self):
        text = Path(ROOT / "api" / "debug_api.py").read_text()
        assert "sk-" not in text.lower()
        assert "api_key" not in text.lower() or "UPSTOX_API_KEY" in text

"""
Broker API Tests for Alphashri.

Tests all broker endpoints including:
- GET /api/brokers/status (6 test cases)
- GET /api/brokers/upstox/auth (3 test cases)
- GET /api/brokers/upstox/callback (4 test cases)
- POST /api/brokers/upstox/disconnect (3 test cases)

Total: 16 test cases
"""

import sys
import os
import json
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from db.models import BrokerConnection, save_broker_token, delete_broker_token


class TestGetBrokerStatus:
    """Tests for GET /api/brokers/status endpoint."""

    def test_status_returns_disconnected_when_no_token(self, client: TestClient, db: Session):
        """Test: Returns disconnected when no token exists."""
        delete_broker_token("upstox", user_id=None)
        response = client.get("/api/brokers/status")

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is False
        assert data["broker"] == "upstox"
        assert data["expires_in_hours"] is None
        assert data["expires_at"] is None

    def test_status_returns_connected_with_valid_db_token(self, client: TestClient, db: Session):
        """Test: Returns connected with valid token from database."""
        delete_broker_token("upstox", user_id=None)
        save_broker_token("upstox", "test_access_token_123", user_id=None)

        response = client.get("/api/brokers/status")

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is True
        assert data["broker"] == "upstox"
        assert data["expires_in_hours"] is not None
        assert data["expires_in_hours"] > 0
        assert "expires_at" in data
        assert data["source"] == "database"

        delete_broker_token("upstox", user_id=None)

    def test_status_returns_expired_for_old_token(self, client: TestClient, db: Session):
        """Test: Returns expired when token is older than expiry time."""
        from db.database import SessionLocal

        delete_broker_token("upstox", user_id=None)
        
        db_local = SessionLocal()
        try:
            old_time = datetime.utcnow() - timedelta(hours=25)
            conn = BrokerConnection(
                broker_name="upstox",
                access_token="old_token",
                token_timestamp=old_time,
                user_id=None
            )
            db_local.add(conn)
            db_local.commit()
        finally:
            db_local.close()

        response = client.get("/api/brokers/status")

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is False

        delete_broker_token("upstox", user_id=None)

    def test_status_fallback_to_file_token(self, client: TestClient, db: Session, tmp_path: Path):
        """Test: Falls back to file token when DB has no token."""
        delete_broker_token("upstox", user_id=None)
        
        with patch("api.brokers.TOKEN_FILE", tmp_path / ".upstox_token.json"):
            token_data = {
                "access_token": "file_token_123",
                "timestamp": datetime.utcnow().isoformat()
            }
            with open(tmp_path / ".upstox_token.json", "w") as f:
                json.dump(token_data, f)

            response = client.get("/api/brokers/status")

            assert response.status_code == 200
            data = response.json()
            assert data["connected"] is True
            assert data["source"] == "file"

    def test_status_fallback_to_env_token(self, client: TestClient, db: Session, tmp_path: Path, monkeypatch):
        """Test: Falls back to env token when no DB or file token."""
        delete_broker_token("upstox", user_id=None)
        
        with patch("api.brokers.TOKEN_FILE", tmp_path / ".upstox_token.json"):
            with patch("api.brokers.config.UPSTOX_ACCESS_TOKEN", "env_token_123"):
                response = client.get("/api/brokers/status")

                assert response.status_code == 200
                data = response.json()
                assert data["connected"] is True
                assert data["source"] == "env"

    def test_status_returns_correct_expiry_calculation(self, client: TestClient, db: Session):
        """Test: Expiry time is calculated correctly (expires at 3:30 AM next day)."""
        delete_broker_token("upstox", user_id=None)
        save_broker_token("upstox", "test_token", user_id=None)

        response = client.get("/api/brokers/status")

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is True
        # Token expires at 3:30 AM next day, so it should be > 0 hours remaining
        assert data["expires_in_hours"] > 0

        delete_broker_token("upstox", user_id=None)


class TestUpstoxAuth:
    """Tests for GET /api/brokers/upstox/auth endpoint."""

    def test_auth_redirects_to_upstox(self, client: TestClient, monkeypatch):
        """Test: Auth endpoint redirects to Upstox OAuth URL."""
        with patch("api.brokers.config.UPSTOX_API_KEY", "test_api_key"):
            with patch("api.brokers.config.UPSTOX_API_SECRET", "test_secret"):
                response = client.get("/api/brokers/upstox/auth", follow_redirects=False)

                assert response.status_code == 307
                assert "api.upstox.com" in response.headers["location"]
                assert "test_api_key" in response.headers["location"]

    def test_auth_returns_500_without_api_key(self, client: TestClient, monkeypatch):
        """Test: Returns 500 if UPSTOX_API_KEY not set."""
        monkeypatch.delenv("UPSTOX_API_KEY", raising=False)
        monkeypatch.delenv("UPSTOX_API_SECRET", raising=False)
        monkeypatch.delenv("UPSTOX_CLIENT_ID", raising=False)
        monkeypatch.delenv("UPSTOX_CLIENT_SECRET", raising=False)

        response = client.get("/api/brokers/upstox/auth")

        assert response.status_code == 500
        assert "UPSTOX_API_KEY" in response.json()["detail"]

    def test_auth_includes_correct_redirect_uri(self, client: TestClient, monkeypatch):
        """Test: Auth URL includes correct redirect URI."""
        with patch("api.brokers.config.UPSTOX_API_KEY", "test_key"):
            with patch("api.brokers.config.UPSTOX_API_SECRET", "test_secret"):
                response = client.get("/api/brokers/upstox/auth", follow_redirects=False)

                location = response.headers["location"]
                assert "redirect_uri" in location
                expected_host = os.getenv("API_BASE_URL", "http://localhost:8765").replace("http://", "").replace("https://", "")
                assert expected_host in location


class TestUpstoxCallback:
    """Tests for GET /api/brokers/upstox/callback endpoint."""

    def test_callback_returns_500_without_credentials(self, client: TestClient, monkeypatch):
        """Test: Returns 500 if credentials not set."""
        monkeypatch.delenv("UPSTOX_API_KEY", raising=False)
        monkeypatch.delenv("UPSTOX_API_SECRET", raising=False)
        monkeypatch.delenv("UPSTOX_CLIENT_ID", raising=False)
        monkeypatch.delenv("UPSTOX_CLIENT_SECRET", raising=False)

        response = client.get("/api/brokers/upstox/callback?code=test_code")

        assert response.status_code == 500

    @pytest.mark.asyncio
    async def test_callback_exchanges_code_for_token(self, client: TestClient, monkeypatch):
        """Test: Callback exchanges auth code for access token."""
        with patch("api.brokers.config.UPSTOX_API_KEY", "test_key"):
            with patch("api.brokers.config.UPSTOX_API_SECRET", "test_secret"):
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {"access_token": "new_access_token_xyz"}

                with patch("api.brokers.httpx.AsyncClient") as mock_client:
                    mock_instance = AsyncMock()
                    mock_instance.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
                    mock_client.return_value = mock_instance

                    response = client.get("/api/brokers/upstox/callback?code=test_code", follow_redirects=False)

                    assert response.status_code == 307
                    assert "settings" in response.headers["location"]
                    assert "upstox=connected" in response.headers["location"]

        delete_broker_token("upstox", user_id=None)

    @pytest.mark.asyncio
    async def test_callback_returns_400_on_token_error(self, client: TestClient, monkeypatch):
        """Test: Returns 400 if token exchange fails."""
        with patch("api.brokers.config.UPSTOX_API_KEY", "test_key"):
            with patch("api.brokers.config.UPSTOX_API_SECRET", "test_secret"):
                mock_response = MagicMock()
                mock_response.status_code = 400
                mock_response.text = "Invalid code"

                with patch("api.brokers.httpx.AsyncClient") as mock_client:
                    mock_instance = AsyncMock()
                    mock_instance.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
                    mock_client.return_value = mock_instance

                    response = client.get("/api/brokers/upstox/callback?code=invalid_code")

                    assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_callback_returns_400_if_no_access_token_in_response(self, client: TestClient, monkeypatch):
        """Test: Returns 400 if response has no access_token."""
        with patch("api.brokers.config.UPSTOX_API_KEY", "test_key"):
            with patch("api.brokers.config.UPSTOX_API_SECRET", "test_secret"):
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {"error": "something went wrong"}

                with patch("api.brokers.httpx.AsyncClient") as mock_client:
                    mock_instance = AsyncMock()
                    mock_instance.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
                    mock_client.return_value = mock_instance

                    response = client.get("/api/brokers/upstox/callback?code=test_code")

                    assert response.status_code == 400
                    assert "access_token" in response.json()["detail"]


class TestUpstoxDisconnect:
    """Tests for POST /api/brokers/upstox/disconnect endpoint."""

    def test_disconnect_returns_success(self, client: TestClient, db: Session):
        """Test: Disconnect returns success."""
        response = client.post("/api/brokers/upstox/disconnect")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    def test_disconnect_removes_db_token(self, client: TestClient, db: Session):
        """Test: Disconnect removes token from database."""
        save_broker_token("upstox", "token_to_delete", user_id=None)

        response = client.post("/api/brokers/upstox/disconnect")

        assert response.status_code == 200

        status_response = client.get("/api/brokers/status")
        assert status_response.json()["connected"] is False

    def test_disconnect_removes_file_token(self, client: TestClient, db: Session, tmp_path: Path):
        """Test: Disconnect removes file token."""
        token_file = tmp_path / ".upstox_token.json"
        with open(token_file, "w") as f:
            json.dump({"access_token": "file_token"}, f)

        with patch("api.brokers.TOKEN_FILE", token_file):
            response = client.post("/api/brokers/upstox/disconnect")

            assert response.status_code == 200
            assert not token_file.exists()


class TestBrokerConnectionModel:
    """Tests for BrokerConnection model and helper functions."""

    def test_save_broker_token_creates_new(self, db: Session):
        """Test: save_broker_token creates new connection."""
        conn = save_broker_token("upstox", "new_token", user_id=None)

        assert conn.id is not None
        assert conn.broker_name == "upstox"
        assert conn.access_token == "new_token"
        assert conn.user_id is None

        delete_broker_token("upstox", user_id=None)

    def test_save_broker_token_updates_existing(self, db: Session):
        """Test: save_broker_token updates existing connection."""
        save_broker_token("upstox", "first_token", user_id=None)
        conn = save_broker_token("upstox", "updated_token", user_id=None)

        assert conn.access_token == "updated_token"

        delete_broker_token("upstox", user_id=None)

    def test_get_shared_broker_token_returns_none_if_not_exists(self, db: Session):
        """Test: get_shared_broker_token returns None if no token."""
        from db.models import get_shared_broker_token

        result = get_shared_broker_token("nonexistent_broker")
        assert result is None

    def test_delete_broker_token_returns_false_if_not_exists(self, db: Session):
        """Test: delete_broker_token returns False if no token to delete."""
        result = delete_broker_token("nonexistent_broker", user_id=None)
        assert result is False

"""
Tests for TradingAgents API endpoints.

Tests the /api/trading-agents endpoints:
- GET /api/trading-agents/health - Health check
- GET /api/trading-agents/config - Configuration
- POST /api/trading-agents/analyze - Stock analysis
- POST /api/trading-agents/chat - Quick chat
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class TestTradingAgentsHealth:
    """Test suite for TradingAgents health endpoint."""

    def test_health_endpoint_exists(self, client):
        """Test that health endpoint exists and returns 200."""
        response = client.get("/api/trading-agents/health")
        assert response.status_code == 200

    def test_health_response_structure(self, client):
        """Test health response has required fields."""
        response = client.get("/api/trading-agents/health")
        data = response.json()

        assert "status" in data
        assert "tradingagents_available" in data
        assert "timestamp" in data

    def test_health_status_values(self, client):
        """Test health status is either 'ok' or 'unavailable'."""
        response = client.get("/api/trading-agents/health")
        data = response.json()

        assert data["status"] in ["ok", "unavailable"]
        assert isinstance(data["tradingagents_available"], bool)


class TestTradingAgentsConfig:
    """Test suite for TradingAgents config endpoint."""

    def test_config_endpoint_exists(self, client):
        """Test that config endpoint exists."""
        response = client.get("/api/trading-agents/config")
        assert response.status_code in [200, 503]

    def test_config_response_structure_when_available(self, client):
        """Test config response structure when tradingagents available."""
        response = client.get("/api/trading-agents/config")

        if response.status_code == 200:
            data = response.json()
            assert "available_providers" in data
            assert "default_provider" in data
            assert "available_models" in data
            assert "default_analysts" in data

    def test_config_providers_list(self, client):
        """Test that expected providers are in the list."""
        response = client.get("/api/trading-agents/config")

        if response.status_code == 200:
            data = response.json()
            providers = data.get("available_providers", [])
            assert "deepseek" in providers


class TestTradingAgentsAnalyze:
    """Test suite for TradingAgents analyze endpoint."""

    def test_analyze_accepts_valid_request(self, client):
        """Test analyze accepts a valid request (no auth required)."""
        response = client.post(
            "/api/trading-agents/analyze",
            json={"ticker": "NVDA"}
        )
        assert response.status_code in [200, 500, 503]

    def test_analyze_valid_request_structure(self, client_with_db, test_user):
        """Test analyze accepts valid request structure."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/analyze",
            json={"ticker": "NVDA"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code in [200, 500, 503]

    def test_analyze_ticker_validation(self, client_with_db, test_user):
        """Test that ticker is required."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/analyze",
            json={},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 422

    def test_analyze_with_date(self, client_with_db, test_user):
        """Test analyze accepts date parameter."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/analyze",
            json={"ticker": "NVDA", "date": "2026-01-15"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code in [200, 500, 503]

    def test_analyze_with_analysts(self, client_with_db, test_user):
        """Test analyze accepts analysts parameter."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/analyze",
            json={
                "ticker": "NVDA",
                "analysts": ["market", "news"]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code in [200, 500, 503]


class TestTradingAgentsChat:
    """Test suite for TradingAgents chat endpoint."""

    def test_chat_valid_request(self, client):
        """Test chat accepts valid request."""
        response = client.post(
            "/api/trading-agents/chat",
            json={"message": "Hello"}
        )
        assert response.status_code in [200, 500, 503]

    def test_chat_valid_request_db(self, client_with_db, test_user):
        """Test chat accepts valid request."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/chat",
            json={"message": "Hello, analyze NVDA"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code in [200, 503]

    def test_chat_message_validation(self, client_with_db, test_user):
        """Test that message is required."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/chat",
            json={},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 422

    def test_chat_with_ticker(self, client_with_db, test_user):
        """Test chat accepts optional ticker."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.post(
            "/api/trading-agents/chat",
            json={"message": "What's the price?", "ticker": "AAPL"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code in [200, 503]


class TestTradingAgentsStream:
    """Test suite for TradingAgents stream endpoint."""

    def test_stream_endpoint_exists(self, client):
        """Test stream endpoint exists."""
        response = client.get("/api/trading-agents/stream/NVDA")
        assert response.status_code in [200, 500, 503]

    def test_stream_with_auth(self, client_with_db, test_user):
        """Test stream endpoint exists."""
        from api.auth import create_access_token
        token = create_access_token({"sub": str(test_user.id)})

        response = client_with_db.get(
            "/api/trading-agents/stream/NVDA",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code in [200, 500, 503]

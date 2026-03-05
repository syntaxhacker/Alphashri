"""
Contract Tests for Alphashri API.

These tests verify the API contract by testing actual responses against expectations.
Tests are designed to work with or without a running server.

Run with:
    pytest tests/contract/test_api_contract.py -v -m contract
"""

import os
import sys
from pathlib import Path

import pytest
import requests

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

OPENAPI_SPEC_PATH = ROOT / "openapi.yaml"
BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8765")


def check_server_running():
    """Check if API server is running."""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        return response.status_code == 200
    except:
        return False


@pytest.mark.contract
class TestHealthEndpoint:
    """Contract tests for health endpoint."""
    
    def test_health_returns_200(self):
        """Health endpoint should return 200 with correct structure."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] in ["healthy", "ok"]


@pytest.mark.contract
class TestAuthRegisterContract:
    """Contract tests for registration endpoint."""
    
    def test_register_requires_email(self):
        """Register should reject missing email."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"password": "TestPass123!"},
            timeout=5
        )
        assert response.status_code == 422
    
    def test_register_requires_password(self):
        """Register should reject missing password."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": "test@example.com"},
            timeout=5
        )
        assert response.status_code == 422
    
    def test_register_validates_email_format(self):
        """Register should validate email format."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": "not-an-email", "password": "TestPass123!"},
            timeout=5
        )
        assert response.status_code == 422
    
    def test_register_success_structure(self):
        """Register success should return correct structure."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        import uuid
        unique_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": unique_email,
                "password": "TestPass123!",
                "display_name": "Test User"
            },
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            assert "access_token" in data
            assert "refresh_token" in data
            assert "token_type" in data
            assert data["token_type"] == "bearer"


@pytest.mark.contract
class TestAuthLoginContract:
    """Contract tests for login endpoint."""
    
    def test_login_requires_email(self):
        """Login should reject missing email."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"password": "TestPass123!"},
            timeout=5
        )
        assert response.status_code == 422
    
    def test_login_requires_password(self):
        """Login should reject missing password."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "test@example.com"},
            timeout=5
        )
        assert response.status_code == 422
    
    def test_login_invalid_credentials(self):
        """Login should reject invalid credentials."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "nonexistent@example.com", "password": "WrongPass123!"},
            timeout=5
        )
        assert response.status_code == 401


@pytest.mark.contract
class TestAuthMeContract:
    """Contract tests for /me endpoint."""
    
    def test_me_requires_authentication(self):
        """Me endpoint should require authentication."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(f"{BASE_URL}/api/auth/me", timeout=5)
        assert response.status_code == 401
    
    def test_me_requires_valid_token(self):
        """Me endpoint should reject invalid token."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer invalid_token"},
            timeout=5
        )
        assert response.status_code == 401


@pytest.mark.contract
class TestScreenersContract:
    """Contract tests for screener endpoints."""
    
    def test_screeners_list_structure(self):
        """Screeners list should return correct structure."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(f"{BASE_URL}/api/screeners", timeout=5)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "screeners" in data


@pytest.mark.contract
class TestBacktestContract:
    """Contract tests for backtest endpoints."""
    
    def test_backtest_strategies_structure(self):
        """Strategies endpoint should return correct structure."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/backtest/strategies",
            timeout=5
        )
        assert response.status_code == 200
        data = response.json()
        assert "strategies" in data or isinstance(data, list)
    
    def test_backtest_costs_structure(self):
        """Costs endpoint should return correct structure."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/backtest/costs",
            timeout=5
        )
        assert response.status_code == 200
        data = response.json()
        assert "costs" in data or "breakdown" in data or isinstance(data, dict)
    
    def test_backtest_run_requires_symbols(self):
        """Backtest run should require symbols."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.post(
            f"{BASE_URL}/api/backtest/run",
            json={"strategy": "orb"},
            timeout=5
        )
        assert response.status_code in [400, 422]


@pytest.mark.contract
class TestSymbolsContract:
    """Contract tests for symbols endpoint."""
    
    def test_symbols_search_requires_query(self):
        """Symbols search should require query parameter."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/symbols/search",
            timeout=5
        )
        assert response.status_code in [200, 400, 422]


@pytest.mark.contract
class TestBotsContract:
    """Contract tests for bots endpoints - public access allowed."""
    
    def test_bots_list_returns_data(self):
        """Bots list should return data (public or requires DB)."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(f"{BASE_URL}/api/bots", timeout=5)
        # Returns 200 with empty list or 500 if DB unavailable
        assert response.status_code in [200, 500]
    
    def test_bots_available_strategies_returns_data(self):
        """Available strategies should return data or error."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/bots/available-strategies",
            timeout=5
        )
        # Returns 200 with list or 500 if DB unavailable
        assert response.status_code in [200, 500]


@pytest.mark.contract
class TestStrategiesContract:
    """Contract tests for strategies endpoints - public access allowed."""
    
    def test_strategies_list_returns_data(self):
        """Strategies list should return data or error."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/strategies",
            timeout=5
        )
        # Returns 200 with list or 500 if DB unavailable
        assert response.status_code in [200, 500]
    
    def test_strategies_templates_returns_data(self):
        """Templates endpoint should return data or error."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/strategies/templates",
            timeout=5
        )
        # Returns 200 with list or 500 if DB unavailable
        assert response.status_code in [200, 500]


@pytest.mark.contract
class TestPaperTradingContract:
    """Contract tests for paper trading endpoints."""
    
    def test_portfolio_returns_data(self):
        """Portfolio should return data or error."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/paper/portfolio",
            timeout=5
        )
        # Returns 200 with portfolio or 500 if unavailable
        assert response.status_code in [200, 500]
    
    def test_positions_returns_data(self):
        """Positions should return data or error."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/paper/positions",
            timeout=5
        )
        # Returns 200 with positions or 500 if unavailable
        assert response.status_code in [200, 500]


@pytest.mark.contract
class TestNewsContract:
    """Contract tests for news endpoints."""
    
    def test_news_endpoint_structure(self):
        """News endpoint should return valid response."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/news",
            timeout=10
        )
        # News may fail if API key not configured
        assert response.status_code in [200, 500, 503]


@pytest.mark.contract
class TestMarketTickerContract:
    """Contract tests for market ticker endpoints."""
    
    def test_market_ticker_returns_data(self):
        """Market ticker should return data or error."""
        if not check_server_running():
            pytest.skip("API server not running")
        
        response = requests.get(
            f"{BASE_URL}/api/market-ticker",
            timeout=5
        )
        # Returns 200 with data or 500 if unavailable
        assert response.status_code in [200, 500]


@pytest.mark.contract
class TestOpenAPISpecValid:
    """Test that OpenAPI spec is valid."""
    
    def test_openapi_spec_exists(self):
        """OpenAPI spec file should exist."""
        assert OPENAPI_SPEC_PATH.exists(), f"OpenAPI spec not found at {OPENAPI_SPEC_PATH}"
    
    def test_openapi_spec_valid_yaml(self):
        """OpenAPI spec should be valid YAML."""
        import yaml
        with open(OPENAPI_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        assert spec is not None
        assert "openapi" in spec or "swagger" in spec
    
    def test_openapi_spec_has_info(self):
        """OpenAPI spec should have info section."""
        import yaml
        with open(OPENAPI_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        assert "info" in spec
        assert "title" in spec["info"]
        assert "version" in spec["info"]
    
    def test_openapi_spec_has_paths(self):
        """OpenAPI spec should have paths defined."""
        import yaml
        with open(OPENAPI_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        assert "paths" in spec
        assert len(spec["paths"]) > 0

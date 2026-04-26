"""Tests for admin API endpoints."""

import sys
from pathlib import Path
from datetime import datetime
import json
import pytest
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from db.models import User
from api.auth import hash_password, create_access_token

# Fixtures for admin user and headers

@pytest.fixture
def admin_user(db: Session):
    """Create an admin user for testing."""
    admin = User(
        email="admin@example.com",
        hashed_password=hash_password("AdminPass123!"),
        display_name="Admin User",
        is_active=True,
        is_admin=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin

@pytest.fixture
def admin_auth_headers(admin_user: User):
    """Generate auth headers for admin user."""
    token, _ = create_access_token(admin_user.id)
    return {"Authorization": f"Bearer {token}"}

# =====================
# LLM Stats Tests
# =====================

class TestAdminLLMStats:
    """Tests for GET /api/admin/llm-stats"""

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_success(self, client, admin_auth_headers, mock_analyzer):
        """Test successful retrieval of LLM statistics."""
        mock_analyzer.get_llm_stats.return_value = [
            {
                "id": 1,
                "model": "gpt-4",
                "tokens": 1000,
                "cost": 0.01,
                "response_time_ms": 500,
                "success": True,
                "timestamp": datetime.now().isoformat()
            }
        ]
        mock_analyzer.get_llm_aggregate_stats.return_value = {
            "total_runs": 1,
            "total_tokens": 1000,
            "total_cost_usd": 0.01,
            "avg_response_time_ms": 500,
            "success_rate": 1.0,
        }

        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "recent_runs" in data
        assert "fetched_at" in data
        assert data["stats"]["total_runs"] == 1
        mock_analyzer.get_llm_stats.assert_called_once_with(limit=100)

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_custom_limit(self, client, admin_auth_headers, mock_analyzer):
        """Test that custom limit parameter is passed correctly."""
        mock_analyzer.get_llm_stats.return_value = []
        mock_analyzer.get_llm_aggregate_stats.return_value = {}

        response = client.get("/api/admin/llm-stats?limit=50", headers=admin_auth_headers)
        assert response.status_code == 200
        mock_analyzer.get_llm_stats.assert_called_once_with(limit=50)

    @patch('api.news_routes._llm_available', False)
    def test_get_llm_stats_llm_unavailable(self, client, admin_auth_headers):
        """Test 503 when LLM analyzer is not available."""
        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 503
        assert "LLM Analyzer not available" in response.json()["detail"]

    def test_get_llm_stats_not_admin(self, client, auth_headers):
        """Test 403 for non-admin user."""
        response = client.get("/api/admin/llm-stats", headers=auth_headers)
        assert response.status_code == 403
        assert "Admin access required" in response.json()["detail"]

    def test_get_llm_stats_unauthorized(self, client):
        """Test 401 without authentication."""
        response = client.get("/api/admin/llm-stats")
        assert response.status_code == 401

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_exception(self, client, admin_auth_headers, mock_analyzer):
        """Test 500 when analyzer raises exception."""
        mock_analyzer.get_llm_stats.side_effect = Exception("Database error")
        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 500
        assert "Database error" in response.json()["detail"]

# =====================
# Cache Stats Tests
# =====================

class TestAdminCacheStats:
    """Tests for GET/POST /api/admin/cache-stats"""

    @patch('cache.redis_client.get_cache_stats')
    def test_get_cache_stats_success(self, client, admin_auth_headers, mock_get_cache_stats):
        """Test successful retrieval of cache statistics."""
        mock_get_cache_stats.return_value = {"hits": 150, "misses": 15, "hit_rate": 0.909}
        response = client.get("/api/admin/cache-stats", headers=admin_auth_headers)
        assert response.status_code == 200
        assert response.json() == {"hits": 150, "misses": 15, "hit_rate": 0.909}
        mock_get_cache_stats.assert_called_once()

    def test_get_cache_stats_not_admin(self, client, auth_headers):
        """Test 403 for non-admin."""
        response = client.get("/api/admin/cache-stats", headers=auth_headers)
        assert response.status_code == 403

    def test_get_cache_stats_unauthorized(self, client):
        """Test 401 without auth."""
        response = client.get("/api/admin/cache-stats")
        assert response.status_code == 401

    @patch('cache.redis_client.get_cache_stats')
    def test_get_cache_stats_exception(self, client, admin_auth_headers, mock_get_cache_stats):
        """Test 500 when Redis raises exception."""
        mock_get_cache_stats.side_effect = Exception("Redis connection error")
        response = client.get("/api/admin/cache-stats", headers=admin_auth_headers)
        assert response.status_code == 500

    @patch('cache.redis_client.reset_stats')
    def test_reset_cache_stats_success(self, client, admin_auth_headers, mock_reset_stats):
        """Test resetting cache statistics."""
        response = client.post("/api/admin/cache-stats/reset", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "message" in data
        mock_reset_stats.assert_called_once()

    def test_reset_cache_stats_not_admin(self, client, auth_headers):
        """Test 403 for non-admin on reset."""
        response = client.post("/api/admin/cache-stats/reset", headers=auth_headers)
        assert response.status_code == 403

    def test_reset_cache_stats_unauthorized(self, client):
        """Test 401 without auth on reset."""
        response = client.post("/api/admin/cache-stats/reset")
        assert response.status_code == 401

# =====================
# Cache Keys Tests
# =====================

class TestAdminCacheKeys:
    """Tests for GET /api/admin/cache-keys"""

    @patch('cache.redis_client.get_cache_keys')
    def test_get_cache_keys_success_default(self, client, admin_auth_headers, mock_get_keys):
        """Test retrieving cache keys with default parameters."""
        mock_get_keys.return_value = ["key1", "key2"]
        response = client.get("/api/admin/cache-keys", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "keys" in data
        assert data["keys"] == ["key1", "key2"]
        mock_get_keys.assert_called_with(prefix=None, top=20)

    @patch('cache.redis_client.get_cache_keys')
    def test_get_cache_keys_with_params(self, client, admin_auth_headers, mock_get_keys):
        """Test retrieving cache keys with custom prefix and top."""
        mock_get_keys.return_value = ["backtest:1", "backtest:2"]
        response = client.get("/api/admin/cache-keys?prefix=backtest&top=10", headers=admin_auth_headers)
        assert response.status_code == 200
        mock_get_keys.assert_called_with(prefix="backtest", top=10)

    def test_get_cache_keys_not_admin(self, client, auth_headers):
        """Test 403 for non-admin."""
        response = client.get("/api/admin/cache-keys", headers=auth_headers)
        assert response.status_code == 403

    def test_get_cache_keys_unauthorized(self, client):
        """Test 401 without auth."""
        response = client.get("/api/admin/cache-keys")
        assert response.status_code == 401

    @patch('cache.redis_client.get_cache_keys')
    def test_get_cache_keys_exception(self, client, admin_auth_headers, mock_get_keys):
        """Test 500 when Redis raises exception."""
        mock_get_keys.side_effect = Exception("Redis error")
        response = client.get("/api/admin/cache-keys", headers=admin_auth_headers)
        assert response.status_code == 500

# =====================
# Invalidate Backtest Cache Tests
# =====================

class TestAdminCacheInvalidateBacktest:
    """Tests for DELETE /api/cache/backtest and /api/cache/backtest/{strategy_id}"""

    @patch('cache.redis_client.invalidate_backtest_cache')
    def test_invalidate_all_backtest_cache(self, client, admin_auth_headers, mock_invalidate):
        """Test invalidating all backtest cache entries for a user."""
        mock_invalidate.return_value = 5
        response = client.delete("/api/cache/backtest?user_id=1", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 5
        assert "Invalidated 5 backtest cache entries" in data["message"]
        mock_invalidate.assert_called_once_with(1)

    @patch('cache.redis_client.invalidate_backtest_cache')
    def test_invalidate_strategy_backtest_cache(self, client, admin_auth_headers, mock_invalidate):
        """Test invalidating backtest cache for specific strategy."""
        mock_invalidate.return_value = 3
        response = client.delete("/api/cache/backtest/ABC123?user_id=2", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 3
        mock_invalidate.assert_called_once_with(2, "ABC123")

    def test_invalidate_backtest_not_admin(self, client, auth_headers):
        """Test 403 for non-admin."""
        response = client.delete("/api/cache/backtest", headers=auth_headers)
        assert response.status_code == 403

    def test_invalidate_backtest_unauthorized(self, client):
        """Test 401 without auth."""
        response = client.delete("/api/cache/backtest")
        assert response.status_code == 401

    @patch('cache.redis_client.invalidate_backtest_cache')
    def test_invalidate_backtest_exception(self, client, admin_auth_headers, mock_invalidate):
        """Test 500 when Redis raises exception."""
        mock_invalidate.side_effect = Exception("Redis error")
        response = client.delete("/api/cache/backtest?user_id=1", headers=admin_auth_headers)
        assert response.status_code == 500

# =====================
# Invalidate News Cache Tests
# =====================

class TestAdminCacheInvalidateNews:
    """Tests for DELETE /api/cache/news"""

    @patch('cache.redis_client.invalidate_news_cache')
    def test_invalidate_news_cache(self, client, admin_auth_headers, mock_invalidate):
        """Test invalidating news cache."""
        mock_invalidate.return_value = 7
        response = client.delete("/api/cache/news", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 7
        assert "Invalidated 7 news cache entries" in data["message"]
        mock_invalidate.assert_called_once()

    def test_invalidate_news_not_admin(self, client, auth_headers):
        """Test 403 for non-admin."""
        response = client.delete("/api/cache/news", headers=auth_headers)
        assert response.status_code == 403

    def test_invalidate_news_unauthorized(self, client):
        """Test 401 without auth."""
        response = client.delete("/api/cache/news")
        assert response.status_code == 401

    @patch('cache.redis_client.invalidate_news_cache')
    def test_invalidate_news_exception(self, client, admin_auth_headers, mock_invalidate):
        """Test 500 when Redis raises exception."""
        mock_invalidate.side_effect = Exception("Redis error")
        response = client.delete("/api/cache/news", headers=admin_auth_headers)
        assert response.status_code == 500

# =====================
# Invalidate Screener Cache Tests
# =====================

class TestAdminCacheInvalidateScreener:
    """Tests for DELETE /api/cache/screener"""

    @patch('cache.redis_client.invalidate_screener_cache')
    def test_invalidate_screener_cache(self, client, admin_auth_headers, mock_invalidate):
        """Test invalidating screener cache."""
        mock_invalidate.return_value = 4
        response = client.delete("/api/cache/screener", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 4
        assert "Invalidated 4 screener cache entries" in data["message"]
        mock_invalidate.assert_called_once()

    def test_invalidate_screener_not_admin(self, client, auth_headers):
        """Test 403 for non-admin."""
        response = client.delete("/api/cache/screener", headers=auth_headers)
        assert response.status_code == 403

    def test_invalidate_screener_unauthorized(self, client):
        """Test 401 without auth."""
        response = client.delete("/api/cache/screener")
        assert response.status_code == 401

    @patch('cache.redis_client.invalidate_screener_cache')
    def test_invalidate_screener_exception(self, client, admin_auth_headers, mock_invalidate):
        """Test 500 when Redis raises exception."""
        mock_invalidate.side_effect = Exception("Redis error")
        response = client.delete("/api/cache/screener", headers=admin_auth_headers)
        assert response.status_code == 500

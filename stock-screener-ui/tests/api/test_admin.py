"""Tests for admin API endpoints."""

import sys
from pathlib import Path
from datetime import datetime
import json
import pytest
from unittest.mock import patch, MagicMock
from sqlalchemy.orm import Session  # Added import

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

class TestAdmin52wRange:
    """Tests for 52W range batch admin endpoints."""

    def test_get_52w_range_status_admin(self, client, admin_auth_headers):
        response = client.get("/api/admin/52w-range-status", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "job" in data
        assert "database" in data
        assert "db_row_count" in data["database"]

    def test_get_52w_range_status_not_admin(self, client, auth_headers):
        response = client.get("/api/admin/52w-range-status", headers=auth_headers)
        assert response.status_code == 403

    @patch("api.admin_routes._run_52w_batch_subprocess")
    @patch("trading.week52_job_status.get_job_status", return_value=None)
    def test_run_52w_range_batch(self, mock_status, mock_run, client, admin_auth_headers):
        response = client.post(
            "/api/admin/52w-range/run",
            headers=admin_auth_headers,
            json={"skip_existing": True, "redis": True, "limit": 0},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "started"
        mock_run.assert_called_once()

    @patch("api.admin_routes.clear_52w_range_data")
    @patch("trading.week52_job_status.get_job_status", return_value=None)
    def test_delete_52w_cache(self, mock_status, mock_clear, client, admin_auth_headers):
        mock_clear.return_value = {
            "redis_keys_deleted": 10,
            "db_rows_deleted": 0,
            "screener_cache_keys_deleted": 2,
            "clear_db": False,
        }
        response = client.delete(
            "/api/admin/52w-range/cache?clear_db=false",
            headers=admin_auth_headers,
        )
        assert response.status_code == 200
        mock_clear.assert_called_once_with(clear_db=False)

    def test_get_52w_status_includes_schedule(self, client, admin_auth_headers):
        response = client.get("/api/admin/52w-range-status", headers=admin_auth_headers)
        assert response.status_code == 200
        assert "schedule" in response.json()
        assert response.json()["schedule"]["interval_sec"] == 3600


class TestAdminLLMStats:
    """Tests for GET /api/admin/llm-stats"""

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_success(self, mock_analyzer, client, admin_auth_headers):
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
        assert "aggregate" in data
        assert "recent_runs" in data
        assert "fetched_at" in data
        assert data["aggregate"]["total_runs"] == 1
        mock_analyzer.get_llm_stats.assert_called_once_with(limit=100)

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_custom_limit(self, mock_analyzer, client, admin_auth_headers):
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
    def test_get_llm_stats_exception(self, mock_analyzer, client, admin_auth_headers):
        """Test 500 when analyzer raises exception."""
        mock_analyzer.get_llm_stats.side_effect = Exception("Database error")
        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 500
        assert "Database error" in response.json()["detail"]

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_includes_runs_by_model(self, mock_analyzer, client, admin_auth_headers):
        """Test that response includes runs_by_model breakdown with count, tokens, cost."""
        mock_analyzer.get_llm_stats.return_value = [
            {
                "id": 1, "model": "gpt-4", "tokens": 1000, "cost": 0.01,
                "response_time_ms": 500, "success": True,
                "timestamp": datetime.now().isoformat(),
            },
            {
                "id": 2, "model": "claude-3", "tokens": 800, "cost": 0.008,
                "response_time_ms": 600, "success": True,
                "timestamp": datetime.now().isoformat(),
            },
        ]
        mock_analyzer.get_llm_aggregate_stats.return_value = {
            "total_runs": 2,
            "total_tokens": 1800,
            "total_cost_usd": 0.018,
            "avg_response_time_ms": 550,
            "success_rate": 1.0,
            "runs_by_model": {
                "gpt-4": {"runs": 1, "tokens": 1000, "cost_usd": 0.01},
                "claude-3": {"runs": 1, "tokens": 800, "cost_usd": 0.008},
            },
        }
        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "runs_by_model" in data["aggregate"]
        assert data["aggregate"]["runs_by_model"]["gpt-4"]["runs"] == 1
        assert data["aggregate"]["runs_by_model"]["claude-3"]["tokens"] == 800
        assert data["aggregate"]["runs_by_model"]["gpt-4"]["cost_usd"] == 0.01

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_includes_runs_by_day(self, mock_analyzer, client, admin_auth_headers):
        """Test that response includes runs_by_day for last 7 days."""
        mock_analyzer.get_llm_stats.return_value = [
            {
                "id": 1, "model": "gpt-4", "tokens": 1000, "cost": 0.01,
                "response_time_ms": 500, "success": True,
                "timestamp": datetime.now().isoformat(),
            },
        ]
        mock_analyzer.get_llm_aggregate_stats.return_value = {
            "total_runs": 1,
            "total_tokens": 1000,
            "total_cost_usd": 0.01,
            "avg_response_time_ms": 500,
            "success_rate": 1.0,
            "runs_by_day": [
                {"date": "2025-06-15", "runs": 1, "tokens": 1000, "cost_usd": 0.01},
            ],
        }
        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "runs_by_day" in data["aggregate"]
        assert len(data["aggregate"]["runs_by_day"]) == 1
        assert data["aggregate"]["runs_by_day"][0]["date"] == "2025-06-15"

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_get_llm_stats_empty_stats(self, mock_analyzer, client, admin_auth_headers):
        """Test that empty stats are returned when no LLM runs exist."""
        mock_analyzer.get_llm_stats.return_value = []
        mock_analyzer.get_llm_aggregate_stats.return_value = {
            "total_runs": 0,
            "total_tokens": 0,
            "total_cost_usd": 0.0,
            "avg_response_time_ms": 0.0,
            "success_rate": 0.0,
            "runs_by_model": {},
            "runs_by_day": [],
        }
        response = client.get("/api/admin/llm-stats", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["aggregate"]["total_runs"] == 0
        assert data["aggregate"]["total_tokens"] == 0
        assert data["aggregate"]["total_cost_usd"] == 0.0
        assert data["aggregate"]["runs_by_model"] == {}
        assert data["aggregate"]["runs_by_day"] == []
        assert data["recent_runs"] == []

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_reset_llm_stats_success(self, mock_analyzer, client, admin_auth_headers):
        """Test successful reset of LLM stats log data."""
        mock_analyzer.clear_llm_stats.return_value = 5
        response = client.post("/api/admin/llm-stats/reset", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["deleted"] == 5
        assert "Cleared 5 LLM run log entries" in data["message"]
        mock_analyzer.clear_llm_stats.assert_called_once()

    @patch('api.news_routes._llm_available', False)
    def test_reset_llm_stats_unavailable(self, client, admin_auth_headers):
        """Test 503 when LLM analyzer not available on reset."""
        response = client.post("/api/admin/llm-stats/reset", headers=admin_auth_headers)
        assert response.status_code == 503
        assert "LLM Analyzer not available" in response.json()["detail"]

    def test_reset_llm_stats_not_admin(self, client, auth_headers):
        """Test 403 for non-admin on LLM stats reset."""
        response = client.post("/api/admin/llm-stats/reset", headers=auth_headers)
        assert response.status_code == 403
        assert "Admin access required" in response.json()["detail"]

    def test_reset_llm_stats_unauthorized(self, client):
        """Test 401 without auth on LLM stats reset."""
        response = client.post("/api/admin/llm-stats/reset")
        assert response.status_code == 401

    @patch('api.news_routes._llm_available', True)
    @patch('api.news_routes.article_analyzer')
    def test_reset_llm_stats_exception(self, mock_analyzer, client, admin_auth_headers):
        """Test 500 when clear raises."""
        mock_analyzer.clear_llm_stats.side_effect = Exception("db locked")
        response = client.post("/api/admin/llm-stats/reset", headers=admin_auth_headers)
        assert response.status_code == 500
        assert "db locked" in response.json()["detail"]

# =====================
# Cache Stats Tests
# =====================

class TestAdminCacheStats:
    """Tests for GET/POST /api/admin/cache-stats"""

    @patch('cache.redis_client.get_cache_stats')
    def test_get_cache_stats_success(self, mock_get_cache_stats, client, admin_auth_headers):
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
    def test_get_cache_stats_exception(self, mock_get_cache_stats, client, admin_auth_headers):
        """Test 500 when Redis raises exception."""
        mock_get_cache_stats.side_effect = Exception("Redis connection error")
        response = client.get("/api/admin/cache-stats", headers=admin_auth_headers)
        assert response.status_code == 500

    @patch('cache.redis_client.reset_stats')
    def test_reset_cache_stats_success(self, mock_reset_stats, client, admin_auth_headers):
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
    def test_get_cache_keys_success_default(self, mock_get_keys, client, admin_auth_headers):
        """Test retrieving cache keys with default parameters."""
        mock_get_keys.return_value = ["key1", "key2"]
        response = client.get("/api/admin/cache-keys", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "keys" in data
        assert data["keys"] == ["key1", "key2"]
        mock_get_keys.assert_called_with(prefix=None, top=20)

    @patch('cache.redis_client.get_cache_keys')
    def test_get_cache_keys_with_params(self, mock_get_keys, client, admin_auth_headers):
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
    def test_get_cache_keys_exception(self, mock_get_keys, client, admin_auth_headers):
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
    def test_invalidate_all_backtest_cache(self, mock_invalidate, client, admin_auth_headers):
        """Test invalidating all backtest cache entries for a user."""
        mock_invalidate.return_value = 5
        response = client.delete("/api/cache/backtest?user_id=1", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 5
        assert "Invalidated 5 backtest cache entries" in data["message"]
        mock_invalidate.assert_called_once_with(1)

    @patch('cache.redis_client.invalidate_backtest_cache')
    def test_invalidate_strategy_backtest_cache(self, mock_invalidate, client, admin_auth_headers):
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
    def test_invalidate_backtest_exception(self, mock_invalidate, client, admin_auth_headers):
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
    def test_invalidate_news_cache(self, mock_invalidate, client, admin_auth_headers):
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
    def test_invalidate_news_exception(self, mock_invalidate, client, admin_auth_headers):
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
    def test_invalidate_screener_cache(self, mock_invalidate, client, admin_auth_headers):
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
    def test_invalidate_screener_exception(self, mock_invalidate, client, admin_auth_headers):
        """Test 500 when Redis raises exception."""
        mock_invalidate.side_effect = Exception("Redis error")
        response = client.delete("/api/cache/screener", headers=admin_auth_headers)
        assert response.status_code == 500

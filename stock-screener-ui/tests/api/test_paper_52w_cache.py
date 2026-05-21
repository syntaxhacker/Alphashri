import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import pandas as pd

from api.paper.endpoints import _read_52w_cache, _write_52w_cache, _52W_TTL_MINUTES
import config


@pytest.fixture
def cache_dir(tmp_path):
    original = Path("api/paper/endpoints").parent
    import api.paper.endpoints as mod
    old = mod.CACHE_52W_DIR
    mod.CACHE_52W_DIR = tmp_path / "52w_cache"
    yield mod.CACHE_52W_DIR
    mod.CACHE_52W_DIR = old


class Test52wCacheHelpers:

    def test_write_and_read_past_date(self, cache_dir):
        _write_52w_cache("TEST", 500.0, 200.0)
        cache_file = cache_dir / "TEST.json"
        assert cache_file.exists()
        data = json.loads(cache_file.read_text())
        assert data["symbol"] == "TEST"
        assert data["high_52w"] == 500.0
        assert data["low_52w"] == 200.0

        # past date is always returned from cache
        cached = _read_52w_cache("TEST")
        assert cached is not None
        assert cached["high_52w"] == 500.0

    def test_today_cache_within_ttl(self, cache_dir):
        _write_52w_cache("TODAY_SYM", 300.0, 100.0)
        # Override date to today and cached_at to now
        now = datetime.now(config.IST)
        cache_file = cache_dir / "TODAY_SYM.json"
        data = {
            "symbol": "TODAY_SYM",
            "high_52w": 300.0,
            "low_52w": 100.0,
            "date": now.strftime('%Y-%m-%d'),
            "cached_at": now.isoformat(),
        }
        cache_file.write_text(json.dumps(data))

        cached = _read_52w_cache("TODAY_SYM")
        assert cached is not None
        assert cached["high_52w"] == 300.0

    def test_today_cache_expired(self, cache_dir):
        now = datetime.now(config.IST)
        cache_file = cache_dir / "EXPIRED.json"
        expired_at = now - timedelta(minutes=_52W_TTL_MINUTES + 1)
        data = {
            "symbol": "EXPIRED",
            "high_52w": 400.0,
            "low_52w": 150.0,
            "date": now.strftime('%Y-%m-%d'),
            "cached_at": expired_at.isoformat(),
        }
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(data))

        cached = _read_52w_cache("EXPIRED")
        assert cached is None  # TTL expired

    def test_malformed_cache_returns_none(self, cache_dir):
        cache_file = cache_dir / "BROKEN.json"
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text("not json")

        cached = _read_52w_cache("BROKEN")
        assert cached is None

    def test_missing_cache_returns_none(self, cache_dir):
        cached = _read_52w_cache("NONEXISTENT")
        assert cached is None

    def test_cache_uppercase_symbol(self, cache_dir):
        _write_52w_cache("test.low", 100.0, 50.0)
        cache_file = cache_dir / "TEST.LOW.json"
        assert cache_file.exists()
        cached = _read_52w_cache("test.low")
        assert cached is not None
        assert cached["high_52w"] == 100.0


class Test52wCacheEndpoint:

    def test_endpoint_uses_cache_on_hit(self, client, auth_headers):
        now = datetime.now(config.IST)
        cached_response = {
            "symbol": "CACHED",
            "high_52w": 500.0,
            "low_52w": 200.0,
            "date": now.strftime('%Y-%m-%d'),
            "cached_at": now.isoformat(),
        }
        with patch("api.paper.endpoints._read_52w_cache", return_value=cached_response):
            response = client.get("/api/paper/52w/CACHED", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["high_52w"] == 500.0
        assert data["low_52w"] == 200.0

    def test_endpoint_fetches_on_cache_miss(self, client, auth_headers):
        mock_df = pd.DataFrame({
            "high": [100 + i for i in range(400)],
            "low": [50 + i for i in range(400)],
        })
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = mock_df

        with patch("api.paper.endpoints._read_52w_cache", return_value=None), \
             patch("api.paper.endpoints._write_52w_cache") as mock_write, \
             patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api):

            response = client.get("/api/paper/52w/SYM", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["high_52w"] > 0
        assert data["low_52w"] > 0
        mock_write.assert_called_once()

    def test_endpoint_empty_data_returns_zero(self, client, auth_headers):
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = pd.DataFrame()

        with patch("api.paper.endpoints._read_52w_cache", return_value=None), \
             patch("api.paper.endpoints._write_52w_cache") as mock_write, \
             patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api):

            response = client.get("/api/paper/52w/EMPTY", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["high_52w"] == 0
        assert data["low_52w"] == 0
        mock_write.assert_called_once()

    def test_endpoint_handles_http_error(self, client, auth_headers):
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.side_effect = Exception("Connection error")

        with patch("api.paper.endpoints._read_52w_cache", return_value=None), \
             patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api):

            response = client.get("/api/paper/52w/ERROR", headers=auth_headers)

        assert response.status_code == 500
        assert "Failed to fetch 52W data" in response.json()["detail"]

    def test_endpoint_computes_correct_52w(self, client, auth_headers):
        highs = [105.0 + i * 0.5 for i in range(252)]
        lows = [95.0 + i * 0.5 for i in range(252)]
        # Extend to 400 days so the tail window is correct
        highs = [100.0] * 148 + highs
        lows = [90.0] * 148 + lows
        mock_df = pd.DataFrame({"high": highs, "low": lows})
        mock_api = MagicMock()
        mock_api.fetch_historical_data_v3.return_value = mock_df

        with patch("api.paper.endpoints._read_52w_cache", return_value=None), \
             patch("api.paper.endpoints._write_52w_cache"), \
             patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api):

            response = client.get("/api/paper/52w/CALC", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        expected_high = max(highs[-252:])
        expected_low = min(lows[-252:])
        assert data["high_52w"] == round(expected_high, 2)
        assert data["low_52w"] == round(expected_low, 2)

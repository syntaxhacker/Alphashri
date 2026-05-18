import pytest
import pandas as pd
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def sample_1min_candles():
    candles = []
    base_time = datetime(2026, 3, 30, 9, 15, 0, tzinfo=IST)
    for i in range(75):
        candles.append({
            "time": (base_time + timedelta(minutes=i)).isoformat(),
            "open": 282.0 + i * 0.1,
            "high": 284.0 + i * 0.1,
            "low": 281.0 + i * 0.1,
            "close": 283.0 + i * 0.1,
            "volume": 10000,
        })
    return candles


@pytest.fixture
def sample_1min_df():
    index = pd.date_range("2026-03-30 09:15:00", periods=75, freq="1min", tz="Asia/Kolkata")
    return pd.DataFrame({
        "open": [282.0 + i * 0.1 for i in range(75)],
        "high": [284.0 + i * 0.1 for i in range(75)],
        "low": [281.0 + i * 0.1 for i in range(75)],
        "close": [283.0 + i * 0.1 for i in range(75)],
        "volume": [10000] * 75,
    }, index=index)


@pytest.fixture
def sample_400day_df():
    dates = pd.date_range("2025-02-24", periods=400, freq="D")
    return pd.DataFrame({
        "open": [100 + i * 0.5 for i in range(400)],
        "high": [105 + i * 0.5 for i in range(400)],
        "low": [95 + i * 0.5 for i in range(400)],
        "close": [102 + i * 0.5 for i in range(400)],
        "volume": [50000] * 400,
    }, index=dates)


@pytest.fixture
def mock_trading_deps():
    mock_trader = MagicMock()
    mock_trader.positions = {}
    mock_journal = MagicMock()
    mock_journal.trades = []
    return mock_trader, mock_journal


@pytest.mark.unit
class TestChartEndpoint:

    def test_chart_returns_candles(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=1min",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["symbol"] == "ONGC"
        assert "candles" in data
        assert len(data["candles"]) > 0

    def test_chart_resample_5min(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=5min",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["candles"]) > 0

    def test_chart_52w_levels(self, client, auth_headers, sample_1min_df, sample_400day_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        mock_api.fetch_historical_data_v3.return_value = sample_400day_df
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=5min",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data.get("week52_levels") is not None
        wl = data["week52_levels"]
        assert "high_52w" in wl
        assert "low_52w" in wl
        assert wl["high_52w"] > 0
        assert wl["low_52w"] > 0

    def test_chart_52w_levels_error_graceful(self, client, auth_headers, sample_1min_df, mock_trading_deps):
        mock_trader, mock_journal = mock_trading_deps
        mock_api = MagicMock()
        mock_api.fetch_intraday_data_v3.return_value = sample_1min_df
        mock_api.fetch_historical_data_v3.side_effect = Exception("API error")
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", return_value=mock_api), \
             patch("api.paper_trading.get_paper_trader", return_value=mock_trader), \
             patch("api.paper_trading.get_journal", return_value=mock_journal):
            response = client.get(
                "/api/paper/chart/ONGC?timeframe=5min",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data.get("week52_levels") is None
        assert len(data["candles"]) > 0

    def test_chart_error_when_api_unavailable(self, client, auth_headers):
        with patch("upstox_trader.config_and_utils.free_indian_apis.UpstoxAPI", side_effect=Exception("Import error")):
            response = client.get(
                "/api/paper/chart/INVALID?timeframe=5min",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert "error" in data

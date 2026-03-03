"""
Tests for Chart Preview API endpoints.

Tests the /api/chart/preview/{symbol} endpoint which provides
lightweight chart data for frontend hover previews and expanded views.

Test cases cover:
- Valid symbol requests with different timeframes
- Invalid symbol handling
- Different date ranges (days parameter)
- ORB zone calculations
- Pivot point calculations
- Data format for frontend charting libraries
- External API mocking (yfinance/upstox)
"""

import sys
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime

import pytest
import pandas as pd

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Helper functions are defined in conftest.py and are available implicitly
# through pytest's fixture discovery system


class TestChartPreview:
    """
    Test suite for Chart Preview API endpoint.

    Endpoint: GET /api/chart/preview/{symbol}
    """

    def test_chart_preview_valid_symbol_default_params(
        self, client, sample_candles_data
    ):
        """
        Test chart preview with valid symbol using default parameters.

        Should return:
        - OHLCV candles resampled to 15-min timeframe
        - ORB zones calculated from first 45 minutes
        - Pivot points for support/resistance
        - Response formatted for frontend charting library
        """
        # Mock the TradingAPIFactory
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/RELIANCE")

            assert response.status_code == 200
            data = response.json()

            # Verify response structure
            assert data['symbol'] == 'RELIANCE'
            assert 'candles' in data
            assert 'orb_zones' in data
            assert 'pivot_levels' in data
            assert data['timeframe'] == 15  # default
            assert data['or_minutes'] == 45  # default
            assert 'total_candles' in data

            # Verify candles have correct structure
            for candle in data['candles']:
                assert 'time' in candle
                assert 'open' in candle
                assert 'high' in candle
                assert 'low' in candle
                assert 'close' in candle
                assert 'volume' in candle

            # Verify API was called correctly
            mock_api.fetch_historical_data_v3.assert_called_once()

    def test_chart_preview_custom_timeframe(self, client, sample_candles_data):
        """
        Test chart preview with custom timeframe parameter.

        Verifies that candles are resampled to the requested timeframe.
        Timeframes: 1, 5, 15, 30, 60 minutes
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            # Test 5-minute timeframe
            response = client.get("/api/chart/preview/TCS?tf=5")
            assert response.status_code == 200
            data = response.json()
            assert data['timeframe'] == 5

            # Test 30-minute timeframe
            response = client.get("/api/chart/preview/TCS?tf=30")
            assert response.status_code == 200
            data = response.json()
            assert data['timeframe'] == 30

    def test_chart_preview_invalid_timeframe(self, client, sample_candles_data):
        """
        Test chart preview with invalid timeframe parameter.

        Timeframe must be between 1 and 60.
        Should return 422 validation error.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            # Test timeframe > 60
            response = client.get("/api/chart/preview/INFY?tf=120")
            assert response.status_code == 422

    def test_chart_preview_custom_days(self, client, sample_candles_data):
        """
        Test chart preview with custom days parameter.

        Days parameter controls historical data range:
        - days=1 for hover preview (today only)
        - days=5+ for expanded/full chart view
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            # Test 5 days of data
            response = client.get("/api/chart/preview/HDFCBANK?days=5")
            assert response.status_code == 200
            data = response.json()
            assert 'candles' in data

            # Test 30 days (maximum)
            response = client.get("/api/chart/preview/HDFCBANK?days=30")
            assert response.status_code == 200

    def test_chart_preview_invalid_days(self, client, sample_candles_data):
        """
        Test chart preview with invalid days parameter.

        Days must be between 1 and 30.
        Should return 422 validation error.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            # Test days > 30
            response = client.get("/api/chart/preview/INFY?days=50")
            assert response.status_code == 422

            # Test days < 1
            response = client.get("/api/chart/preview/INFY?days=0")
            assert response.status_code == 422

    def test_chart_preview_custom_or_minutes(self, client, sample_candles_data):
        """
        Test chart preview with custom ORB period.

        ORB (Opening Range Breakout) period can be customized.
        Default is 45 minutes, range is 15-90 minutes.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            # Test 30-minute ORB
            response = client.get("/api/chart/preview/TATAMOTORS?or_minutes=30")
            assert response.status_code == 200
            data = response.json()
            assert data['or_minutes'] == 30

            # Test 60-minute ORB
            response = client.get("/api/chart/preview/TATAMOTORS?or_minutes=60")
            assert response.status_code == 200
            data = response.json()
            assert data['or_minutes'] == 60

    def test_chart_preview_empty_data(self, client):
        """
        Test chart preview when no data is available.

        Should return empty arrays for candles, orb_zones, pivot_levels.
        """
        mock_api = Mock()
        # Return empty DataFrame
        mock_api.fetch_historical_data_v3 = Mock(return_value=pd.DataFrame())

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/NONEXISTENT")
            assert response.status_code == 200
            data = response.json()

            assert data['symbol'] == 'NONEXISTENT'
            assert data['candles'] == []
            assert data['orb_zones'] == []
            assert data['pivot_levels'] == []

    def test_chart_preview_api_unavailable(self, client):
        """
        Test chart preview when external API is unavailable.

        Should return graceful error response without crashing.
        """
        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.side_effect = ValueError("API not available")

            response = client.get("/api/chart/preview/RELIANCE")
            assert response.status_code == 200
            data = response.json()

            assert 'error' in data
            assert data['error'] == 'API not available'
            assert data['candles'] == []
            assert data['orb_zones'] == []
            assert data['pivot_levels'] == []

    def test_chart_preview_exception_handling(self, client):
        """
        Test chart preview exception handling.

        Should catch exceptions and return error in response.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(side_effect=Exception("Network error"))

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/RELIANCE")
            assert response.status_code == 200
            data = response.json()

            assert 'error' in data
            assert 'Network error' in data['error']
            assert data['candles'] == []

    def test_chart_response_data_format(self, client, sample_candles_data):
        """
        Test that chart response data is formatted correctly for frontend.

        Verifies:
        - Numeric values are serializable (no NaN, Infinity)
        - Timestamps in correct format (milliseconds since epoch)
        - Candles sorted by time
        - OHLCV values are valid (high >= low, close within range)
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/INFY?days=5")
            assert response.status_code == 200
            data = response.json()

            # Check that candles are properly formatted
            candles = data['candles']
            for i, candle in enumerate(candles):
                # Verify time is in milliseconds
                assert candle['time'] > 1000000000000  # milliseconds since 2001

                # Verify OHLCV are valid numbers
                assert isinstance(candle['open'], (int, float))
                assert isinstance(candle['high'], (int, float))
                assert isinstance(candle['low'], (int, float))
                assert isinstance(candle['close'], (int, float))
                assert isinstance(candle['volume'], (int, float))

                # Verify OHLC relationships
                assert candle['high'] >= candle['low']
                assert candle['high'] >= candle['open']
                assert candle['high'] >= candle['close']
                assert candle['low'] <= candle['open']
                assert candle['low'] <= candle['close']

                # Verify no invalid values
                assert candle['high'] != float('inf')
                assert candle['low'] != float('-inf')
                assert candle['open'] != float('nan')

            # Verify candles are sorted by time
            times = [c['time'] for c in candles]
            assert times == sorted(times)

    def test_chart_orb_zones_structure(self, client, sample_candles_data):
        """
        Test that ORB zones are correctly calculated and structured.

        ORB zones should include:
        - Start time (session open)
        - End time (end of ORB period)
        - High price (ORB high)
        - Low price (ORB low)
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/RELIANCE")
            assert response.status_code == 200
            data = response.json()

            orb_zones = data['orb_zones']

            # Each ORB zone should have required fields
            for zone in orb_zones:
                assert 'start' in zone or 'time' in zone
                assert 'end' in zone
                assert 'high' in zone
                assert 'low' in zone

                # High should be >= low
                assert zone['high'] >= zone['low']

    def test_chart_pivot_levels_structure(self, client, sample_candles_data):
        """
        Test that pivot levels are correctly calculated and structured.

        Pivot levels should include:
        - R1, R2 (Resistance levels)
        - PP (Pivot Point)
        - S1, S2 (Support levels)
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/RELIANCE")
            assert response.status_code == 200
            data = response.json()

            pivot_levels = data['pivot_levels']

            # Each pivot level should have level name and price
            for level in pivot_levels:
                assert 'level' in level  # e.g., 'R1', 'S1'
                assert 'price' in level

                # Price should be a valid number
                assert isinstance(level['price'], (int, float))
                assert level['price'] > 0

    def test_chart_total_candles_count(self, client, sample_candles_data):
        """
        Test that total_candles field accurately reflects candle count.

        Frontend uses this for display and pagination.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            response = client.get("/api/chart/preview/SBIN")
            assert response.status_code == 200
            data = response.json()

            # total_candles should match actual candle count
            assert data['total_candles'] == len(data['candles'])

    def test_chart_multiple_symbols(self, client, sample_candles_data):
        """
        Test chart preview for multiple different symbols.

        Verifies endpoint works correctly for various symbols.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'TATAMOTORS']

            for symbol in symbols:
                response = client.get(f"/api/chart/preview/{symbol}")
                assert response.status_code == 200
                data = response.json()

                assert data['symbol'] == symbol
                assert 'candles' in data

    def test_chart_preview_symbol_case_sensitivity(self, client, sample_candles_data):
        """
        Test chart preview with uppercase and lowercase symbol names.

        Most stock symbols are uppercase, but endpoint should handle
        case variations gracefully.
        """
        mock_api = Mock()
        mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_from_config') as mock_factory:
            mock_factory.return_value = mock_api

            # Test uppercase (standard)
            response_upper = client.get("/api/chart/preview/RELIANCE")
            assert response_upper.status_code == 200

            # Test lowercase (should still work)
            response_lower = client.get("/api/chart/preview/reliance")
            assert response_lower.status_code == 200

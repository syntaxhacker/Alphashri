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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def _make_chart_api(return_data=None, side_effect=None):
    mock_api = Mock()
    if side_effect is not None:
        mock_api.fetch_historical_data_v3 = Mock(side_effect=side_effect)
    else:
        mock_api.fetch_historical_data_v3 = Mock(return_value=return_data)
    return mock_api


def _patch_chart_api(mock_api):
    return patch('api_server_fastapi.TradingAPIFactory.create_from_config', return_value=mock_api)


def _get_chart_response(client, symbol, data=None, side_effect=None, **params):
    mock_api = _make_chart_api(data, side_effect)
    with _patch_chart_api(mock_api):
        return client.get(f"/api/chart/preview/{symbol}", params=params)


class TestChartPreview:

    def test_chart_preview_valid_symbol_default_params(
        self, client, sample_candles_data
    ):
        mock_api = _make_chart_api(sample_candles_data)

        with patch('api_server_fastapi.TradingAPIFactory.create_client') as mock_factory, \
             patch('config.UPSTOX_API_KEY', 'test_key'), \
             patch('config.UPSTOX_API_SECRET', 'test_secret'), \
             patch('db.models.get_shared_broker_token') as mock_token:
            mock_factory.return_value = mock_api
            mock_token.return_value = {'access_token': 'test_token'}

            response = client.get("/api/chart/preview/RELIANCE")

            assert response.status_code == 200
            data = response.json()

            assert data['symbol'] == 'RELIANCE'
            assert 'candles' in data
            assert 'orb_zones' in data
            assert 'pivot_levels' in data
            assert data['timeframe'] == 15
            assert data['or_minutes'] == 45
            assert 'total_candles' in data

            for candle in data['candles']:
                assert 'time' in candle
                assert 'open' in candle
                assert 'high' in candle
                assert 'low' in candle
                assert 'close' in candle
                assert 'volume' in candle

            mock_api.fetch_historical_data_v3.assert_called_once()

    def test_chart_preview_custom_timeframe(self, client, sample_candles_data):
        response = _get_chart_response(client, "TCS", data=sample_candles_data, tf=5)
        assert response.status_code == 200
        assert response.json()['timeframe'] == 5

        response = _get_chart_response(client, "TCS", data=sample_candles_data, tf=30)
        assert response.status_code == 200
        assert response.json()['timeframe'] == 30

    def test_chart_preview_invalid_timeframe(self, client, sample_candles_data):
        response = _get_chart_response(client, "INFY", data=sample_candles_data, tf=120)
        assert response.status_code == 422

    def test_chart_preview_custom_days(self, client, sample_candles_data):
        response = _get_chart_response(client, "HDFCBANK", data=sample_candles_data, days=5)
        assert response.status_code == 200
        assert 'candles' in response.json()

        response = _get_chart_response(client, "HDFCBANK", data=sample_candles_data, days=30)
        assert response.status_code == 200

    def test_chart_preview_invalid_days(self, client, sample_candles_data):
        response = _get_chart_response(client, "INFY", data=sample_candles_data, days=50)
        assert response.status_code == 422

        response = _get_chart_response(client, "INFY", data=sample_candles_data, days=0)
        assert response.status_code == 422

    def test_chart_preview_custom_or_minutes(self, client, sample_candles_data):
        response = _get_chart_response(client, "TATAMOTORS", data=sample_candles_data, or_minutes=30)
        assert response.status_code == 200
        assert response.json()['or_minutes'] == 30

        response = _get_chart_response(client, "TATAMOTORS", data=sample_candles_data, or_minutes=60)
        assert response.status_code == 200
        assert response.json()['or_minutes'] == 60

    def test_chart_preview_empty_data(self, client):
        response = _get_chart_response(client, "NONEXISTENT", data=pd.DataFrame())
        assert response.status_code == 200
        data = response.json()

        assert data['symbol'] == 'NONEXISTENT'
        assert data['candles'] == []
        assert data['orb_zones'] == []
        assert data['pivot_levels'] == []

    def test_chart_preview_api_unavailable(self, client):
        with patch('config.UPSTOX_API_KEY', ''), \
             patch('config.UPSTOX_API_SECRET', ''):

            response = client.get("/api/chart/preview/RELIANCE")
            assert response.status_code == 200
            data = response.json()

            assert 'error' in data
            assert data['error'] == 'Upstox API credentials not configured'
            assert data['candles'] == []
            assert data['orb_zones'] == []
            assert data['pivot_levels'] == []

    def test_chart_preview_exception_handling(self, client):
        mock_api = _make_chart_api(side_effect=Exception("Network error"))

        with patch('api_server_fastapi.TradingAPIFactory.create_client') as mock_factory, \
             patch('config.UPSTOX_API_KEY', 'test_key'), \
             patch('config.UPSTOX_API_SECRET', 'test_secret'), \
             patch('db.models.get_shared_broker_token') as mock_token:
            mock_factory.return_value = mock_api
            mock_token.return_value = {'access_token': 'test_token'}

            response = client.get("/api/chart/preview/RELIANCE")
            assert response.status_code == 200
            data = response.json()

            assert 'error' in data
            assert 'Network error' in data['error']
            assert data['candles'] == []

    def test_chart_response_data_format(self, client, sample_candles_data):
        response = _get_chart_response(client, "INFY", data=sample_candles_data, days=5)
        assert response.status_code == 200
        candles = response.json()['candles']

        for candle in candles:
            assert candle['time'] > 1000000000000
            assert isinstance(candle['open'], (int, float))
            assert isinstance(candle['high'], (int, float))
            isinstance(candle['low'], (int, float))
            assert isinstance(candle['close'], (int, float))
            assert isinstance(candle['volume'], (int, float))

            assert candle['high'] >= candle['low']
            assert candle['high'] >= candle['open']
            assert candle['high'] >= candle['close']
            assert candle['low'] <= candle['open']
            assert candle['low'] <= candle['close']

            assert candle['high'] != float('inf')
            assert candle['low'] != float('-inf')
            assert candle['open'] != float('nan')

        times = [c['time'] for c in candles]
        assert times == sorted(times)

    def test_chart_orb_zones_structure(self, client, sample_candles_data):
        response = _get_chart_response(client, "RELIANCE", data=sample_candles_data)
        assert response.status_code == 200

        for zone in response.json()['orb_zones']:
            assert 'start' in zone or 'time' in zone
            assert 'end' in zone
            assert 'high' in zone
            assert 'low' in zone
            assert zone['high'] >= zone['low']

    def test_chart_pivot_levels_structure(self, client, sample_candles_data):
        response = _get_chart_response(client, "RELIANCE", data=sample_candles_data)
        assert response.status_code == 200

        for level in response.json()['pivot_levels']:
            assert 'level' in level
            assert 'price' in level
            assert isinstance(level['price'], (int, float))
            assert level['price'] > 0

    def test_chart_total_candles_count(self, client, sample_candles_data):
        response = _get_chart_response(client, "SBIN", data=sample_candles_data)
        assert response.status_code == 200
        data = response.json()
        assert data['total_candles'] == len(data['candles'])

    def test_chart_multiple_symbols(self, client, sample_candles_data):
        symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'TATAMOTORS']

        for symbol in symbols:
            response = _get_chart_response(client, symbol, data=sample_candles_data)
            assert response.status_code == 200
            data = response.json()
            assert data['symbol'] == symbol
            assert 'candles' in data

    def test_chart_preview_symbol_case_sensitivity(self, client, sample_candles_data):
        response_upper = _get_chart_response(client, "RELIANCE", data=sample_candles_data)
        assert response_upper.status_code == 200

        response_lower = _get_chart_response(client, "reliance", data=sample_candles_data)
        assert response_lower.status_code == 200

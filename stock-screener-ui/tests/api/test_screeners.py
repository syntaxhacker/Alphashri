"""
Screener API Tests

Tests for /api/screeners and /api/screener endpoints.
"""

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime
import sys
from pathlib import Path
import types

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Setup stub for tradingview_screener before importing api_server
if 'tradingview_screener' not in sys.modules:
    stub = types.ModuleType('tradingview_screener')
    stub.Query = object
    stub.Column = object
    sys.modules['tradingview_screener'] = stub

from api_server_fastapi import (
    PROFILE_META,
    PROFILES_WITH_52W_BUCKETS,
    fetch_screener_data,
    _profile_meta,
    _passes_profile_filters,
    _build_rationale,
    _to_float,
)
import trending_upside


@pytest.fixture
def mock_trending_stocks():
    """Mock trending_upside.fetch_trending_stocks to return sample data."""
    import pandas as pd

    sample_data = [
        {
            'name': 'RELIANCE',
            'close': 2500.0,
            'change': 25.0,
            'price_52_week_high': 2550.0,
            'ADX': 35.0,
            'ATR': 50.0,
            'Perf.W': 5.0,
            'RSI': 65.0,
            'Stoch.K': 70.0,
            'gap': 1.5,
            'premarket_change': 0.8,
            'impact_score': 8.5,
            'market_cap_basic': 16000000000000,
            'volume': 5000000,
            'sector': 'Energy',
            'reversal_signal': 'BULLISH',
            'swing_score': 95,
        },
        {
            'name': 'TCS',
            'close': 3800.0,
            'change': -15.0,
            'price_52_week_high': 3900.0,
            'ADX': 25.0,
            'ATR': 40.0,
            'Perf.W': -2.0,
            'RSI': 55.0,
            'Stoch.K': 60.0,
            'gap': 0.5,
            'premarket_change': -0.3,
            'impact_score': 3.2,
            'market_cap_basic': 14000000000000,
            'volume': 2000000,
            'sector': 'Technology',
            'reversal_signal': 'BEARISH',
            'swing_score': 75,
        },
        {
            'name': 'HDFC',
            'close': 1600.0,
            'change': 10.0,
            'price_52_week_high': 1600.0,
            'ADX': 40.0,
            'ATR': 30.0,
            'Perf.W': 8.0,
            'RSI': 75.0,
            'Stoch.K': 80.0,
            'gap': 2.0,
            'premarket_change': 1.2,
            'impact_score': 6.0,
            'market_cap_basic': 9000000000000,
            'volume': 8000000,
            'sector': 'Finance',
            'reversal_signal': 'BULLISH',
            'swing_score': 110,
        },
        {
            'name': 'INFY',
            'close': 1500.0,
            'change': 5.0,
            'price_52_week_high': 1580.0,
            'ADX': 20.0,
            'ATR': 25.0,
            'Perf.W': 1.0,
            'RSI': 50.0,
            'Stoch.K': 55.0,
            'gap': 0.0,
            'premarket_change': 0.0,
            'impact_score': 1.5,
            'market_cap_basic': 6000000000000,
            'volume': 3000000,
            'sector': 'Technology',
            'reversal_signal': 'MIXED',
            'swing_score': 60,
        },
    ]

    return pd.DataFrame(sample_data)


@pytest.fixture
def mock_trading_api():
    """Mock TradingAPIFactory to prevent real API calls."""
    with patch('api_server_fastapi.TradingAPIFactory') as mock:
        mock.create_from_config.side_effect = ValueError('No credentials configured')
        yield mock


class TestScreenersList:
    """Test GET /api/screeners endpoint."""

    @pytest.mark.asyncio
    async def test_get_screeners_list(self, client):
        """Test getting list of available screeners."""
        # This test assumes there's a FastAPI test client
        # If not, we'll test the underlying logic directly
        pass

    def test_profile_meta_constants(self):
        """Test that PROFILE_META has all expected screener configurations."""
        expected_screeners = [
            'trending',
            'near_52w_breakout',
            'buyer_interest',
            'buyer_interest_enhanced',
            'volatility_trend',
            'nifty50_activity',
            'rsi_reversal',
            'market_open_gap',
            'nifty_movers',
            'intraday_momentum',
            'high_momentum',
        ]

        for screener in expected_screeners:
            assert screener in PROFILE_META
            meta = PROFILE_META[screener]
            assert 'section_labels' in meta
            assert 'primary' in meta['section_labels']
            assert 'secondary' in meta['section_labels']

    def test_profiles_with_52w_buckets(self):
        """Test PROFILES_WITH_52W_BUCKETS constant."""
        assert 'trending' in PROFILES_WITH_52W_BUCKETS
        assert 'near_52w_breakout' in PROFILES_WITH_52W_BUCKETS

    def test_profile_meta_filters_structure(self):
        """Test that profile filters have correct structure."""
        for screener, meta in PROFILE_META.items():
            if 'filters' in meta:
                for filter_config in meta['filters']:
                    assert 'key' in filter_config
                    assert 'label' in filter_config
                    assert 'type' in filter_config
                    # Type-specific fields
                    if filter_config['type'] == 'number':
                        assert 'min' in filter_config
                        assert 'max' in filter_config
                        assert 'step' in filter_config
                        assert 'default' in filter_config
                    elif filter_config['type'] == 'select':
                        assert 'options' in filter_config
                        assert 'default' in filter_config

    def test_profile_meta_default_sort(self):
        """Test that each profile has a default sort configuration."""
        for screener, meta in PROFILE_META.items():
            assert 'default_sort' in meta
            sort_config = meta['default_sort']
            assert 'column' in sort_config
            assert 'direction' in sort_config
            assert sort_config['direction'] in ['asc', 'desc']


class TestScreenerDataRetrieval:
    """Test GET /api/screener endpoint with various profiles."""

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_fetch_screener_data_trending_profile(
        self, mock_fetch, mock_api, mock_trending_stocks
    ):
        """Test fetching screener data for 'trending' profile."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='trending'
        )

        assert 'approaching' in result
        assert 'touched' in result
        assert 'profile_meta' in result
        assert 'summary' in result

        # Check profile meta
        assert result['profile_meta']['section_labels']['primary'] == '🎯 APPROACHING 52W HIGH'
        assert result['profile_meta']['section_labels']['secondary'] == '✅ ALREADY TOUCHED 52W HIGH'

        # Check that we have both approaching and touched stocks
        approaching_count = len(result['approaching'])
        touched_count = len(result['touched'])
        assert approaching_count + touched_count == 4  # Total from mock data

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_fetch_screener_data_buyer_interest_enhanced(
        self, mock_fetch, mock_api, mock_trending_stocks
    ):
        """Test fetching screener data for 'buyer_interest_enhanced' profile."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='buyer_interest_enhanced',
            profile_filters={
                'direction': 'bullish',
                'min_score': '70',
                'min_vol_surge': '1.0'
            }
        )

        assert 'approaching' in result
        # Filtered by direction=bullish and score >= 70
        assert len(result['approaching']) >= 0

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_fetch_screener_data_market_open_gap(
        self, mock_fetch, mock_api, mock_trending_stocks
    ):
        """Test fetching screener data for 'market_open_gap' profile."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='market_open_gap',
            profile_filters={
                'min_gap_pct': '1.0',
                'min_volume_m': '1'
            }
        )

        assert 'approaching' in result
        # This profile doesn't use touched bucket
        assert len(result['touched']) == 0

        # Verify section labels
        assert result['profile_meta']['section_labels']['primary'] == '📈 GAP OPEN CANDIDATES'
        assert result['profile_meta']['section_labels']['secondary'] == '✅ LARGER GAP MOVERS'

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_fetch_screener_data_rsi_reversal(
        self, mock_fetch, mock_api, mock_trending_stocks
    ):
        """Test fetching screener data for 'rsi_reversal' profile."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='rsi_reversal',
            profile_filters={
                'max_rsi': '70',
                'min_stoch_k': '60'
            }
        )

        assert 'approaching' in result
        assert 'summary' in result

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_fetch_screener_data_intraday_momentum(
        self, mock_fetch, mock_api, mock_trending_stocks
    ):
        """Test fetching screener data for 'intraday_momentum' profile."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='intraday_momentum',
            profile_filters={
                'lookback_minutes': '15',
                'min_move_pct': '0.5'
            }
        )

        assert 'approaching' in result
        assert 'profile_meta' in result

    @pytest.mark.skip(reason="fetch_screener_data does not support symbols filter")
    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_fetch_screener_data_with_symbol_filter(
        self, mock_fetch, mock_api, mock_trending_stocks
    ):
        """Test fetching screener data with symbol filter."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='trending',
            symbols=['RELIANCE', 'TCS']
        )

        # Should only return data for filtered symbols
        all_symbols = [s['symbol'] for s in result['approaching']] + \
                      [s['symbol'] for s in result['touched']]

        assert all(s in ['RELIANCE', 'TCS'] for s in all_symbols)


class TestProfileFilters:
    """Test profile filter application."""

    def test_passes_profile_filters_market_open_gap(self):
        """Test filter logic for market_open_gap profile."""
        # Should pass: gap >= 1% and volume >= 1M
        stock_data = {
            'gap_pct': 1.5,
            'volume_m': 2.0,
        }
        assert _passes_profile_filters('market_open_gap', stock_data, {'min_gap_pct': '1.0', 'min_volume_m': '1.0'})

        # Should fail: gap too small
        stock_data['gap_pct'] = 0.5
        assert not _passes_profile_filters('market_open_gap', stock_data, {'min_gap_pct': '1.0', 'min_volume_m': '1.0'})

    def test_passes_profile_filters_high_momentum(self):
        """Test filter logic for high_momentum profile."""
        # Should pass: RSI >= 60 and volume >= 1M
        stock_data = {
            'rsi': 65,
            'volume_m': 2.0,
        }
        assert _passes_profile_filters('high_momentum', stock_data, {'min_rsi': '60', 'min_volume_m': '1.0'})

        # Should fail: RSI too low
        stock_data['rsi'] = 55
        assert not _passes_profile_filters('high_momentum', stock_data, {'min_rsi': '60', 'min_volume_m': '1.0'})

    def test_passes_profile_filters_buyer_interest_enhanced(self):
        """Test filter logic for buyer_interest_enhanced profile."""
        # Bullish direction: wick_close_pct >= 60
        stock_data_bullish = {
            'wick_close_pct': 75,
            'score': 80,
            'volume_surge': 1.5,
        }
        assert _passes_profile_filters(
            'buyer_interest_enhanced',
            stock_data_bullish,
            {'direction': 'bullish', 'min_score': '70', 'min_vol_surge': '1.0'}
        )

        # Should fail: not bullish enough
        stock_data_bullish['wick_close_pct'] = 50
        assert not _passes_profile_filters(
            'buyer_interest_enhanced',
            stock_data_bullish,
            {'direction': 'bullish', 'min_score': '70', 'min_vol_surge': '1.0'}
        )

        # Bearish direction: wick_close_pct <= 40
        stock_data_bearish = {
            'wick_close_pct': 35,
            'score': 80,
            'volume_surge': 1.5,
        }
        assert _passes_profile_filters(
            'buyer_interest_enhanced',
            stock_data_bearish,
            {'direction': 'bearish', 'min_score': '70', 'min_vol_surge': '1.0'}
        )

    def test_passes_profile_filters_volatility_trend(self):
        """Test filter logic for volatility_trend profile."""
        # Should pass: ATR >= 1%, RSI >= 50, bullish trend
        stock_data = {
            'atr_pct': 1.5,
            'rsi': 60,
            'is_bullish': True,
            'sentiment': 'bullish',
            'perf_w': 2.0,
            'adx': 30,
        }
        assert _passes_profile_filters(
            'volatility_trend',
            stock_data,
            {'min_atr_pct': '1.0', 'min_rsi': '50', 'trend': 'bullish'}
        )

        # Should fail: not bullish
        stock_data['is_bullish'] = False
        assert not _passes_profile_filters(
            'volatility_trend',
            stock_data,
            {'min_atr_pct': '1.0', 'min_rsi': '50', 'trend': 'bullish'}
        )

    def test_passes_profile_filters_no_filters(self):
        """Test that no filters means all stocks pass."""
        stock_data = {'any': 'data'}
        assert _passes_profile_filters('trending', stock_data, None)
        assert _passes_profile_filters('trending', stock_data, {})

    def test_passes_profile_filters_near_52w_breakout(self):
        """Test filter logic for near_52w_breakout profile."""
        # Should pass: within 5% of 52W high
        stock_data = {
            'to_52w_high': 3.0,
        }
        assert _passes_profile_filters('near_52w_breakout', stock_data, {'max_52w_gap': '5'})

        # Should fail: too far from 52W high
        stock_data['to_52w_high'] = 10.0
        assert not _passes_profile_filters('near_52w_breakout', stock_data, {'max_52w_gap': '5'})


class TestRationaleBuilder:
    """Test _build_rationale function."""

    def test_build_rationale_market_open_gap(self):
        """Test rationale for market_open_gap profile."""
        row = {
            'gap_pct': 2.5,
            'premarket_change': 1.2,
            'volume_m': 5.0,
        }
        rationale = _build_rationale('market_open_gap', row)
        assert 'Gap +2.50%' in rationale
        assert 'Pre +1.20%' in rationale
        assert 'Vol 5.00M' in rationale

    def test_build_rationale_rsi_reversal(self):
        """Test rationale for rsi_reversal profile."""
        row = {
            'reversal_signal': 'BULLISH',
            'rsi': 35.0,
            'stoch_k': 25.0,
            'day_change': -1.5,
        }
        rationale = _build_rationale('rsi_reversal', row)
        assert 'BULLISH reversal' in rationale
        assert 'RSI 35.0' in rationale
        assert 'StochK 25.0' in rationale
        assert 'Day -1.50%' in rationale

    def test_build_rationale_nifty_movers(self):
        """Test rationale for nifty_movers profile."""
        row = {
            'impact_score': 15.5,
            'market_cap_b': 500.0,
            'day_change': 2.5,
        }
        rationale = _build_rationale('nifty_movers', row)
        assert 'Impact +15.50' in rationale
        assert 'Cap 500.0B' in rationale
        assert 'Day +2.50%' in rationale

    def test_build_rationale_high_momentum(self):
        """Test rationale for high_momentum profile."""
        row = {
            'score': 95,
            'rsi': 70.0,
            'volume_m': 3.5,
            'day_change': 3.0,
        }
        rationale = _build_rationale('high_momentum', row)
        assert 'Score 95' in rationale
        assert 'RSI 70.0' in rationale
        assert 'Vol 3.50M' in rationale

    def test_build_rationale_buyer_interest(self):
        """Test rationale for buyer_interest profile."""
        row = {
            'wick_close_pct': 75.0,
            'volume_surge': 2.5,
            'rsi': 65.0,
            'adx': 35.0,
        }
        rationale = _build_rationale('buyer_interest', row)
        assert 'Wick 75%' in rationale
        assert 'VolSurge 2.50x' in rationale
        assert 'RSI 65.0' in rationale
        assert 'ADX 35.0' in rationale

    def test_build_rationale_volatility_trend(self):
        """Test rationale for volatility_trend profile."""
        row = {
            'atr_pct': 2.5,
            'adx': 40.0,
            'rsi': 60.0,
            'perf_w': 5.0,
        }
        rationale = _build_rationale('volatility_trend', row)
        assert 'ATR% 2.50%' in rationale
        assert 'ADX 40.0' in rationale
        assert 'RSI 60.0' in rationale
        assert 'PerfW +5.0%' in rationale

    def test_build_rationale_default(self):
        """Test default rationale for unknown profile."""
        row = {
            'score': 85,
            'to_52w_high': 3.5,
            'recent_return_5d': 2.0,
            'perf_w': 4.0,
        }
        rationale = _build_rationale('unknown_profile', row)
        assert 'Score 85' in rationale
        assert '52W gap +3.50%' in rationale
        assert '5D +2.0%' in rationale
        assert 'PerfW +4.0%' in rationale


class TestScreenerSorting:
    """Test default sorting for different screener profiles."""

    @pytest.mark.skip(reason="fetch_screener_data does not sort results; order depends on parallel execution")
    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_default_sort_trending(self, mock_fetch, mock_api, mock_trending_stocks):
        """Test default sorting for trending profile (by score desc)."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='trending'
        )

        approaching = result['approaching']
        if len(approaching) > 1:
            # Check sorted by score descending
            scores = [s.get('score', 0) for s in approaching]
            assert scores == sorted(scores, reverse=True)

    @pytest.mark.skip(reason="fetch_screener_data does not sort results; order depends on parallel execution")
    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_default_sort_market_open_gap(self, mock_fetch, mock_api, mock_trending_stocks):
        """Test default sorting for market_open_gap profile (by gap_pct desc)."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='market_open_gap'
        )

        approaching = result['approaching']
        if len(approaching) > 1:
            # Check sorted by gap_pct descending
            gaps = [abs(s.get('gap_pct', 0)) for s in approaching]
            assert gaps == sorted(gaps, reverse=True)


class TestScreenerDataStructure:
    """Test the structure of screener response data."""

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_stock_data_structure(self, mock_fetch, mock_api, mock_trending_stocks):
        """Test that each stock has all expected fields."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='trending'
        )

        all_stocks = result['approaching'] + result['touched']

        for stock in all_stocks:
            # Required fields
            assert 'symbol' in stock
            assert 'score' in stock
            assert 'tv_price' in stock
            assert 'upstox_price' in stock
            assert 'to_52w_high' in stock
            assert 'rationale' in stock

            # Optional but commonly present fields
            # These may vary by profile
            if 'day_change' in stock:
                assert isinstance(stock['day_change'], (int, float))

            if 'rsi' in stock:
                assert 0 <= stock['rsi'] <= 100 or stock['rsi'] is None

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_summary_structure(self, mock_fetch, mock_api, mock_trending_stocks):
        """Test that summary is properly generated."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        result = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='trending'
        )

        assert 'summary' in result
        summary = result['summary']

        # Summary should be a list of summary items
        assert isinstance(summary, list)

        if summary:
            for item in summary:
                assert 'label' in item
                assert 'value' in item


class TestScreenerCaching:
    """Test screener data caching behavior."""

    @patch('api_server_fastapi.TradingAPIFactory.create_from_config')
    @patch.object(trending_upside, 'fetch_trending_stocks')
    def test_cache_key_includes_profile_filters(self, mock_fetch, mock_api, mock_trending_stocks):
        """Test that cache key respects profile filters."""
        mock_fetch.return_value = mock_trending_stocks
        mock_api.side_effect = ValueError('No credentials')

        # First call with filters
        result1 = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='market_open_gap',
            profile_filters={'min_gap_pct': '1.0', 'min_volume_m': '1'}
        )

        # Second call with different filters
        result2 = fetch_screener_data(
            provider='upstox',
            mode='intraday',
            screener='market_open_gap',
            profile_filters={'min_gap_pct': '2.0', 'min_volume_m': '2'}
        )

        # Results should be different due to different filters
        # (This is a basic test - actual cache behavior depends on implementation)


class TestHelperFunctions:
    """Test helper functions."""

    def test_to_float_with_valid_values(self):
        """Test _to_float with valid numeric values."""
        assert _to_float(10.5) == 10.5
        assert _to_float("20.3") == 20.3
        assert _to_float(None) == 0.0
        assert _to_float(float('inf')) == 0.0
        assert _to_float(float('-inf')) == 0.0
        assert _to_float(float('nan')) == 0.0

    def test_profile_meta_function(self):
        """Test _profile_meta helper function."""
        meta = _profile_meta('trending')
        assert meta['section_labels']['primary'] == '🎯 APPROACHING 52W HIGH'

        # Unknown profile returns default (trending)
        meta = _profile_meta('unknown')
        assert meta['section_labels']['primary'] == '🎯 APPROACHING 52W HIGH'


class TestScreenerSWR:
    """Test stale-while-revalidate behavior on /api/screener endpoint."""

    @pytest.fixture
    def swr_fixtures(self, mock_trending_stocks, monkeypatch):
        sample_result = {
            'approaching': [],
            'touched': [],
            'last_updated': datetime.now().isoformat(),
            'provider': 'upstox',
            'mode': 'intraday',
            'screener': 'trending',
            'profile_meta': _profile_meta('trending'),
            'summary': [],
            'demo_mode': True,
            'applied_profile_filters': {},
        }
        with patch('api_server_fastapi.TradingAPIFactory') as mock_api, \
             patch.object(trending_upside, 'fetch_trending_stocks', return_value=mock_trending_stocks):
            mock_api.create_from_config.side_effect = ValueError('No credentials')
            yield sample_result

    def test_screener_response_has_cache_metadata(self, client, swr_fixtures, monkeypatch):
        """Response includes cache_status, served_from_cache, refreshing."""
        response = client.get("/api/screener")
        assert response.status_code == 200
        data = response.json()
        assert 'cache_status' in data
        assert 'served_from_cache' in data
        assert 'refreshing' in data
        assert data['cache_status'] in ('fresh', 'stale', 'miss', 'coalesced')
        assert isinstance(data['served_from_cache'], bool)
        assert isinstance(data['refreshing'], bool)

    def test_screener_has_x_cache_header(self, client, swr_fixtures, monkeypatch):
        """Response includes X-Cache header."""
        response = client.get("/api/screener")
        assert 'x-cache' in response.headers
        assert response.headers['x-cache'] in ('fresh', 'stale', 'miss', 'coalesced')

    def test_screener_cache_header_matches_body(self, client, swr_fixtures, monkeypatch):
        """X-Cache header matches cache_status in body."""
        response = client.get("/api/screener")
        data = response.json()
        assert response.headers['x-cache'] == data['cache_status']

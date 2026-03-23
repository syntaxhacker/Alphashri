"""
Market Ticker API Tests

Tests for /api/market-ticker endpoints.
"""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

try:
    import yfinance as yf
except ImportError:
    yf = None

from api.market_ticker import (
    TICKER_SYMBOLS,
    get_all_tickers,
    get_all_tickers_endpoint,
    get_ticker,
    TickerItem,
    TickerResponse,
    _ticker_cache,
    _cache_timestamp,
    fetch_ticker_data,
)
import time


def _make_ticker(current_price=100.0, prev_close=99.0):
    ticker = MagicMock()
    ticker.info = {
        'currentPrice': current_price,
        'regularMarketPrice': current_price,
        'dayHigh': current_price + 5,
        'dayLow': current_price - 5,
        'regularMarketPreviousClose': prev_close,
        'previousClose': prev_close,
    }
    ticker.history = MagicMock(return_value=None)
    return ticker


def _standard_ticker_factory(s):
    return _make_ticker()


async def _fetch_all_tickers_standard(mock_yfinance):
    mock_yfinance.side_effect = _standard_ticker_factory
    return await get_all_tickers_endpoint()


@pytest.fixture
def mock_yfinance():
    with patch('yfinance.Ticker') as mock_ticker_class:
        yield mock_ticker_class


@pytest.fixture
def mock_ticker(mock_yfinance):
    ticker = MagicMock()

    def make_info(**kwargs):
        default_info = {
            'currentPrice': 22500.50,
            'regularMarketPrice': 22500.50,
            'dayHigh': 22600.0,
            'dayLow': 22380.0,
            'regularMarketPreviousClose': 22374.75,
            'previousClose': 22374.75,
        }
        default_info.update(kwargs)
        return default_info

    ticker.info = MagicMock(side_effect=make_info)

    hist_df = MagicMock()
    hist_df.empty = False
    hist_df.__getitem__ = lambda self, key: MagicMock(iloc=MagicMock(__getitem__=lambda self, idx: [22374.75, 22300.0][idx]))

    def history_mock(period='5d'):
        return hist_df

    ticker.history = MagicMock(side_effect=history_mock)
    mock_yfinance.return_value = ticker

    return ticker


@pytest.fixture
def clear_cache():
    import api.market_ticker as market_ticker
    market_ticker._ticker_cache.clear()
    market_ticker._cache_timestamp = 0
    yield
    market_ticker._ticker_cache.clear()
    market_ticker._cache_timestamp = 0


class TestMarketTickerEndpoints:

    @pytest.mark.asyncio
    async def test_get_all_tickers_success(self, mock_yfinance, clear_cache):
        def mock_ticker_factory(yf_symbol):
            ticker = MagicMock()

            symbol_data = {
                '^NSEI': {
                    'currentPrice': 22500.50,
                    'dayHigh': 22600.0,
                    'dayLow': 22380.0,
                    'previousClose': 22374.75,
                },
                '^NSEBANK': {
                    'currentPrice': 48200.25,
                    'dayHigh': 48400.0,
                    'dayLow': 48050.0,
                    'previousClose': 48285.75,
                },
                'GC=F': {
                    'currentPrice': 2850.75,
                    'dayHigh': 2860.0,
                    'dayLow': 2835.0,
                    'previousClose': 2838.25,
                },
                'SI=F': {
                    'currentPrice': 32.50,
                    'dayHigh': 33.0,
                    'dayLow': 32.0,
                    'previousClose': 32.10,
                },
                'USDINR=X': {
                    'currentPrice': 83.15,
                    'dayHigh': 83.20,
                    'dayLow': 83.05,
                    'previousClose': 83.10,
                },
                'CL=F': {
                    'currentPrice': 78.50,
                    'dayHigh': 79.0,
                    'dayLow': 78.0,
                    'previousClose': 78.20,
                },
            }

            data = symbol_data.get(yf_symbol, symbol_data['^NSEI'])

            ticker.info = {
                'currentPrice': data['currentPrice'],
                'regularMarketPrice': data['currentPrice'],
                'dayHigh': data['dayHigh'],
                'dayLow': data['dayLow'],
                'regularMarketPreviousClose': data['previousClose'],
                'previousClose': data['previousClose'],
            }
            ticker.history = MagicMock(return_value=None)

            return ticker

        mock_yfinance.side_effect = mock_ticker_factory

        response = await get_all_tickers_endpoint()

        assert isinstance(response, TickerResponse)
        assert len(response.tickers) == 6
        assert '^NSEI' in response.tickers
        assert '^NSEBANK' in response.tickers
        assert 'GC=F' in response.tickers
        assert 'SI=F' in response.tickers
        assert 'USDINR=X' in response.tickers
        assert 'CL=F' in response.tickers

        nifty = response.tickers['^NSEI']
        assert nifty.symbol == '^NSEI'
        assert nifty.name == 'Nifty 50'
        assert nifty.price == 22500.50
        assert nifty.change == 125.75
        assert nifty.change_percent == 0.56
        assert nifty.is_positive is True
        assert nifty.error is None

        bank_nifty = response.tickers['^NSEBANK']
        assert bank_nifty.symbol == '^NSEBANK'
        assert bank_nifty.name == 'Bank Nifty'
        assert bank_nifty.change == -85.50
        assert bank_nifty.is_positive is False

    @pytest.mark.asyncio
    async def test_get_ticker_by_symbol(self, mock_yfinance, clear_cache):
        mock_yfinance.return_value = _make_ticker(22500.50, 22374.75)

        response = await get_ticker('^NSEI')

        assert isinstance(response, TickerItem)
        assert response.symbol == '^NSEI'
        assert response.name == 'Nifty 50'
        assert response.price == 22500.50
        assert response.change == 125.75
        assert response.is_positive is True

    @pytest.mark.asyncio
    async def test_get_ticker_invalid_symbol(self, clear_cache):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_ticker('INVALID')

        assert exc_info.value.status_code == 404
        assert 'Unknown symbol' in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_ticker_caching(self, mock_yfinance, clear_cache):
        call_count = {'count': 0}

        def counting_ticker_factory(s):
            call_count['count'] += 1
            return _make_ticker()

        mock_yfinance.side_effect = counting_ticker_factory

        response1 = await get_all_tickers_endpoint()
        first_call_count = call_count['count']

        response2 = await get_all_tickers_endpoint()

        assert call_count['count'] == first_call_count
        assert response1.tickers.keys() == response2.tickers.keys()

    @pytest.mark.asyncio
    async def test_ticker_cache_expiry(self, mock_yfinance, clear_cache):
        import api.market_ticker as mt

        call_count = {'count': 0}

        def counting_ticker_factory(s):
            call_count['count'] += 1
            return _make_ticker()

        mock_yfinance.side_effect = counting_ticker_factory

        original_ttl = mt._CACHE_TTL_SECONDS

        try:
            mt._CACHE_TTL_SECONDS = 0

            response1 = await get_all_tickers_endpoint()
            first_call_count = call_count['count']

            response2 = await get_all_tickers_endpoint()

            assert call_count['count'] > first_call_count
        finally:
            mt._CACHE_TTL_SECONDS = original_ttl

    @pytest.mark.asyncio
    async def test_ticker_api_error_handling(self, mock_yfinance, clear_cache):
        def failing_ticker_factory(s):
            if s == 'GC=F':
                raise Exception("Network error")
            return _make_ticker()

        mock_yfinance.side_effect = failing_ticker_factory

        response = await get_all_tickers_endpoint()

        assert len(response.tickers) == 6

        gold_ticker = response.tickers['GC=F']
        assert gold_ticker.error is not None
        assert 'Network error' in gold_ticker.error
        assert gold_ticker.price == 0

        nifty_ticker = response.tickers['^NSEI']
        assert nifty_ticker.error is None
        assert nifty_ticker.price > 0

    @pytest.mark.asyncio
    async def test_all_ticker_symbols_present(self, mock_yfinance, clear_cache):
        mock_yfinance.side_effect = _standard_ticker_factory

        response = await get_all_tickers_endpoint()

        expected_symbols = {
            '^NSEI': 'Nifty 50',
            '^NSEBANK': 'Bank Nifty',
            'GC=F': 'Gold',
            'SI=F': 'Silver',
            'USDINR=X': 'USD/INR',
            'CL=F': 'Crude Oil',
        }

        for symbol, name in expected_symbols.items():
            assert symbol in response.tickers
            assert response.tickers[symbol].name == name

    @pytest.mark.asyncio
    async def test_ticker_symbols_via_helper(self, mock_yfinance, clear_cache):
        response = await _fetch_all_tickers_standard(mock_yfinance)

        expected_symbols = {
            '^NSEI': 'Nifty 50',
            '^NSEBANK': 'Bank Nifty',
            'GC=F': 'Gold',
            'SI=F': 'Silver',
            'USDINR=X': 'USD/INR',
            'CL=F': 'Crude Oil',
        }

        for symbol, name in expected_symbols.items():
            assert symbol in response.tickers
            assert response.tickers[symbol].name == name

    @pytest.mark.asyncio
    async def test_cache_age_in_response(self, mock_yfinance, clear_cache):
        response = await _fetch_all_tickers_standard(mock_yfinance)

        assert hasattr(response, 'cache_age_seconds')
        assert response.cache_age_seconds >= 0
        assert response.cache_age_seconds < 1

    @pytest.mark.asyncio
    async def test_ticker_timestamp_fields(self, mock_yfinance, clear_cache):
        response = await _fetch_all_tickers_standard(mock_yfinance)

        nifty = response.tickers['^NSEI']
        assert nifty.timestamp is not None
        assert isinstance(nifty.timestamp, datetime)
        assert nifty.last_updated is not None
        assert isinstance(nifty.last_updated, datetime)

    @pytest.mark.asyncio
    async def test_source_field_in_ticker(self, mock_yfinance, clear_cache):
        response = await _fetch_all_tickers_standard(mock_yfinance)

        for ticker in response.tickers.values():
            assert ticker.source == "yahoo"

    @pytest.mark.asyncio
    async def test_get_all_tickers_response_structure(self, mock_yfinance, clear_cache):
        response = await _fetch_all_tickers_standard(mock_yfinance)

        assert hasattr(response, 'tickers')
        assert hasattr(response, 'timestamp')
        assert hasattr(response, 'cache_age_seconds')

        assert isinstance(response.timestamp, datetime)
        assert isinstance(response.tickers, dict)


class TestTickerConstants:

    def test_ticker_symbols_config(self):
        expected_symbols = {
            '^NSEI': {'name': 'Nifty 50', 'yf_symbol': '^NSEI'},
            '^NSEBANK': {'name': 'Bank Nifty', 'yf_symbol': '^NSEBANK'},
            'GC=F': {'name': 'Gold', 'yf_symbol': 'GC=F'},
            'SI=F': {'name': 'Silver', 'yf_symbol': 'SI=F'},
            'USDINR=X': {'name': 'USD/INR', 'yf_symbol': 'USDINR=X'},
            'CL=F': {'name': 'Crude Oil', 'yf_symbol': 'CL=F'},
        }

        assert len(TICKER_SYMBOLS) == 6
        for symbol, config in expected_symbols.items():
            assert symbol in TICKER_SYMBOLS
            assert TICKER_SYMBOLS[symbol]['name'] == config['name']
            assert TICKER_SYMBOLS[symbol]['yf_symbol'] == config['yf_symbol']


class TestTickerHelperFunctions:

    def test_fetch_ticker_data_success(self, mock_yfinance):
        from api.market_ticker import fetch_ticker_data

        mock_yfinance.return_value = _make_ticker(22500.50, 22374.75)

        symbol, data = fetch_ticker_data('^NSEI', 'Nifty 50', '^NSEI')

        assert symbol == '^NSEI'
        assert data['symbol'] == '^NSEI'
        assert data['name'] == 'Nifty 50'
        assert data['price'] == 22500.50
        assert data['change'] == 125.75
        assert data['is_positive'] is True
        assert data['source'] == 'yahoo'

    def test_fetch_ticker_data_error(self, mock_yfinance):
        from api.market_ticker import fetch_ticker_data

        mock_yfinance.side_effect = Exception("API Error")

        symbol, data = fetch_ticker_data('^NSEI', 'Nifty 50', '^NSEI')

        assert symbol == '^NSEI'
        assert 'error' in data
        assert 'API Error' in data['error']
        assert data['source'] == 'yahoo'

"""
Screener ETF filter tests.

ETFs/liquid funds (LIQUIDBEES, *ETF, *BEES, ...) must not appear in
52W screener output — a liquid fund "approaching its 52W high" is noise.
"""

import sys
import types
from pathlib import Path
from unittest.mock import patch

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Setup stub for tradingview_screener before importing screener modules
if 'tradingview_screener' not in sys.modules:
    stub = types.ModuleType('tradingview_screener')
    stub.Query = object
    stub.Column = object
    sys.modules['tradingview_screener'] = stub

from api.screener_api.screener_52w import fetch_52w_high_data
from api.screener_api.screener_models import (
    exclude_etfs_from_screener,
    is_likely_etf,
)
from api.screener_api.screener_scan import _process_single_stock


ETF_SYMBOLS = [
    'LIQUIDBEES',
    'NIFTYBEES',
    'GOLDBEES',
    'LIQUIDETF',
    'LIQUIDBETF',
    'LIQUID1',
    'LIQUIDPLUS',
    'LIQUIDADD',
    'EBBETF0430',
    'EBBETF0431',
    'AONELIQUID',
    'GROWWLIQID',
    'CASHIETF',
    'LIQUIDSHRI',
    'LIQUIDCASE',
    'ELIQUID',
    'LIQUIDBETA',
    'LIQUIDSBI',
    'HDFCLIQUID',
    'SBILIQETF',
    'LIQGRWBEES',
]

EQUITY_SYMBOLS = [
    'RELIANCE',
    'BHEL',
    'DBOL',
    'ZIMLAB',
    'NYKAA',
    'GLOBAL',
    'NURECA',
    'BOSCH-HCIL',
    'PERSISTENT',
    'MOTISONS',
    'KOTAKBANK',
    'LAURUSLABS',
]


class TestIsLikelyEtf:
    def test_flags_etf_symbols(self):
        for sym in ETF_SYMBOLS:
            assert is_likely_etf(sym) is True, sym

    def test_keeps_equity_symbols(self):
        for sym in EQUITY_SYMBOLS:
            assert is_likely_etf(sym) is False, sym

    def test_handles_prefix_and_case(self):
        assert is_likely_etf('NSE:LIQUIDBEES') is True
        assert is_likely_etf('liquidbees') is True

    def test_handles_empty_inputs(self):
        assert is_likely_etf(None) is False
        assert is_likely_etf('') is False


class TestExcludeEtfsFlag:
    def test_defaults_to_exclude(self, monkeypatch):
        monkeypatch.delenv('SCREENER_EXCLUDE_ETFS', raising=False)
        assert exclude_etfs_from_screener() is True

    def test_env_opt_out(self, monkeypatch):
        monkeypatch.setenv('SCREENER_EXCLUDE_ETFS', '0')
        assert exclude_etfs_from_screener() is False


def _tv_row(name, close=100.0, high_52w=102.0):
    return {'name': name, 'close': close, 'price_52_week_high': high_52w}


class TestProcessSingleStockDropsEtf:
    def test_etf_row_returns_none(self):
        result = _process_single_stock(
            _tv_row('LIQUIDBEES', close=1000.0, high_52w=1030.0),
            'near_52w_breakout', False, None, False, True,
            {'max_52w_gap': 3},
        )
        assert result is None

    def test_equity_row_passes(self):
        result = _process_single_stock(
            _tv_row('RELIANCE', close=2500.0, high_52w=2550.0),
            'near_52w_breakout', False, None, False, True,
            {'max_52w_gap': 3},
        )
        assert result is not None
        assert result[0]['symbol'] == 'RELIANCE'


def _ranges():
    return {
        'LIQUIDBEES': {'high': 1030.0, 'low': 990.0, 'close': 1000.0},
        'RELIANCE': {'high': 2550.0, 'low': 2000.0, 'close': 2500.0},
    }


class TestFetch52wHighDataDropsEtf:
    def test_etf_excluded_by_default(self):
        with patch(
            'api.screener_api.screener_52w.load_all_52w_ranges',
            return_value=_ranges(),
        ), patch(
            'api.screener_api.screener_52w._enrich_with_touch_history',
        ):
            data = fetch_52w_high_data(provider='other', profile_filters={'min_turnover_cr': 0})
        symbols = [s['symbol'] for s in data['approaching'] + data['touched']]
        assert 'LIQUIDBEES' not in symbols
        assert 'RELIANCE' in symbols

    def test_etf_included_when_opted_out(self, monkeypatch):
        monkeypatch.setenv('SCREENER_EXCLUDE_ETFS', '0')
        with patch(
            'api.screener_api.screener_52w.load_all_52w_ranges',
            return_value=_ranges(),
        ), patch(
            'api.screener_api.screener_52w._enrich_with_touch_history',
        ):
            data = fetch_52w_high_data(provider='other', profile_filters={'min_turnover_cr': 0})
        symbols = [s['symbol'] for s in data['approaching'] + data['touched']]
        assert 'LIQUIDBEES' in symbols

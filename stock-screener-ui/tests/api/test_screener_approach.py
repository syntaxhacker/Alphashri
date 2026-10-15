"""
Fresh vs retest approach-classification tests.

A row is 'touched' (at the high now), 'retest' (touched within the window,
now below), or 'fresh' (no touch in window). Touch = daily high within eps
of the SAME high the gap is measured against.
Fresh vs retest approach-classification + ETF exclusion tests.

A row is 'touched' (at the high now), 'retest' (touched within the window,
now below), or 'fresh' (no touch in window). Touch = daily high within eps
of the SAME high the gap is measured against. ETFs never reach output.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import config
from api.screener_api.screener_models import (
    classify_approach,
    has_live_data,
    exclude_etfs_from_screener,
    has_live_data,
    is_likely_etf,
    retest_window_days,
    touch_eps_pct,
)
from api.screener_api.screener_scan import _touch_stats_from_df


def _df(highs, end_days_ago=1):
    """Daily-bar frame ending end_days_ago days back with given highs."""
    base = datetime.now(config.IST).replace(hour=0, minute=0, second=0, microsecond=0)
    idx = [base - timedelta(days=end_days_ago + len(highs) - 1 - i) for i in range(len(highs))]
    return pd.DataFrame(
        {'high': highs, 'low': [h * 0.98 for h in highs], 'close': [h * 0.99 for h in highs]},
        index=pd.DatetimeIndex(idx),
    )


class FakeAPI:
    """Upstox stub serving one synthetic daily frame per symbol."""

    def __init__(self, frames):
        self.frames = frames

    def fetch_historical_data_v3(self, symbol, **kwargs):
        return self.frames.get(symbol)


class TestThresholds:
    def test_defaults(self, monkeypatch):
        monkeypatch.delenv('SCREENER_52W_TOUCH_EPS_PCT', raising=False)
        monkeypatch.delenv('SCREENER_RETEST_WINDOW_DAYS', raising=False)
        assert touch_eps_pct() == 0.5
        assert retest_window_days() == 5

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv('SCREENER_52W_TOUCH_EPS_PCT', '1.0')
        monkeypatch.setenv('SCREENER_RETEST_WINDOW_DAYS', '10')
        assert touch_eps_pct() == 1.0
        assert retest_window_days() == 10


class TestClassifyApproach:
    def test_touched_now_wins(self):
        assert classify_approach(True, 0) == 'touched'
        assert classify_approach(True, None) == 'touched'

    def test_recent_touch_is_retest(self):
        for d in (0, 1, 5):
            assert classify_approach(False, d) == 'retest', d

    def test_old_touch_is_fresh(self):
        assert classify_approach(False, 6) == 'fresh'
        assert classify_approach(False, 60) == 'fresh'

    def test_no_touch_in_lookback_is_fresh(self):
        assert classify_approach(False, None) == 'fresh'

    def test_custom_window(self):
        assert classify_approach(False, 7, window_days=10) == 'retest'
        assert classify_approach(False, 11, window_days=10) == 'fresh'

    def test_old_or_missing_touch_is_fresh(self):
        assert classify_approach(False, 6) == 'fresh'
        assert classify_approach(False, None) == 'fresh'


class TestHasLiveData:
    def test_zero_row_is_thin(self):
        assert has_live_data({'rsi': 0.0, 'adx': 0.0, 'volume_m': 0.0}) is False
        assert has_live_data({}) is False

    def test_instrumented_row(self):
        assert has_live_data({'rsi': 62.0, 'adx': 25.0, 'volume_m': 1.2}) is True
        assert has_live_data({'rsi': 0.0, 'adx': 0.0, 'volume_m': 2.5}) is True


class TestTouchStatsFromDf:
    def test_touch_three_days_ago(self):
        df = _df([90, 90, 90, 90, 90, 90, 90, 100, 90, 90])
        near, touch = _touch_stats_from_df(df, ref_high=100.0)
        assert touch == 3
        assert near == 3

    def test_no_touch_in_frame(self):
        df = _df([90] * 10)
        _, touch = _touch_stats_from_df(df, ref_high=100.0)
        assert touch is None

    def test_today_high_counts_as_touch(self):
        df = _df([90] * 10)
        _, touch = _touch_stats_from_df(df, ref_high=100.0, today_high=99.6)
        assert touch == 0

    def test_today_high_below_eps_not_touch(self):
        df = _df([90] * 10)
        _, touch = _touch_stats_from_df(df, ref_high=100.0, today_high=99.0)
        assert touch is None

    def test_gap_and_touch_share_reference(self):
        # breakout above ref: touch is 1 day ago even though period high > ref
        df = _df([90, 90, 90, 90, 90, 90, 90, 90, 102, 101])
        _, touch = _touch_stats_from_df(df, ref_high=100.0)
        assert touch == 1

class TestIsLikelyEtf:
    def test_flags_etfs(self):
        for sym in ('LIQUIDBEES', 'NIFTYBEES', 'LIQUIDETF', 'EBBETF0430',
                    'AONELIQUID', 'GROWWLIQID', 'CASHIETF', 'LIQUID1'):
            assert is_likely_etf(sym) is True, sym

    def test_keeps_equities(self):
        for sym in ('RELIANCE', 'BHEL', 'DBOL', 'ZIMLAB', 'GLOBAL', 'BOSCH-HCIL'):
            assert is_likely_etf(sym) is False, sym

    def test_exclude_flag(self, monkeypatch):
        monkeypatch.delenv('SCREENER_EXCLUDE_ETFS', raising=False)
        assert exclude_etfs_from_screener() is True
        monkeypatch.setenv('SCREENER_EXCLUDE_ETFS', '0')
        assert exclude_etfs_from_screener() is False


class TestFillTouchAndApproach:
    def _stock(self, symbol, high_52w, price, **kw):
        row = {
            'symbol': symbol, 'high_52w': high_52w, 'upstox_price': price,
            'tv_price': price, 'to_52w_high': round((high_52w - price) / high_52w * 100, 2),
            'touched_52w': False, 'days_ago': None,
            'rsi': 60.0, 'adx': 25.0, 'volume_m': 1.0,
        }
        row.update(kw)
        return row

    def test_retest_and_price_refresh(self):
        from api.screener_api.screener_52w import _fill_days_ago_from_upstox

        # touched 2 sessions ago at 100, now closed at 99*0.99
        api = FakeAPI({'RETEST': _df([90, 90, 90, 90, 90, 90, 90, 99, 100, 99])})
        stock = self._stock('RETEST', 100.0, 98.0)
        _fill_days_ago_from_upstox([stock], api, True, 1.0)
        assert stock['approach_type'] == 'retest'
        assert stock['days_since_touch'] == 2
        # price refreshed from latest daily close (99 * 0.99)
        assert stock['upstox_price'] == round(99 * 0.99, 2)

    def test_fresh_when_no_touch_in_frame(self):
        from api.screener_api.screener_52w import _fill_days_ago_from_upstox

        api = FakeAPI({'FRESH': _df([90] * 10)})
        stock = self._stock('FRESH', 100.0, 97.0)
        _fill_days_ago_from_upstox([stock], api, True, 1.0)
        assert stock['approach_type'] == 'fresh'
        assert stock['days_since_touch'] is None

    def test_intraday_ltp_kept(self):
        from api.screener_api.screener_52w import _fill_days_ago_from_upstox

        api = FakeAPI({'LTP': _df([90] * 10)})
        stock = self._stock('LTP', 100.0, 99.5, ltp_fresh=True)
        _fill_days_ago_from_upstox([stock], api, True, 1.0)
        assert stock['upstox_price'] == 99.5
        # 99.5 is within eps of 100 -> touched today -> retest, LTP still kept
        assert stock['approach_type'] == 'retest'
        assert stock['days_since_touch'] == 0

    def test_no_api_leaves_rows_untouched(self):
        from api.screener_api.screener_52w import _fill_days_ago_from_upstox

        stock = self._stock('X', 100.0, 98.0)
        _fill_days_ago_from_upstox([stock], None, False, 1.0)
        assert 'approach_type' not in stock


class TestTouchRecorderUniverse:
    def test_covers_full_52w_universe(self):
        from scripts.record_52w_touches import TOUCH_SCREENER_UNIVERSE

        assert '52w_high' in TOUCH_SCREENER_UNIVERSE
        assert 'trending' in TOUCH_SCREENER_UNIVERSE


class TestUnmappedSymbolsDropped:
    def test_unmapped_symbol_excluded_when_api_available(self):
        from api.screener_api.screener_52w import fetch_52w_high_data

        class ApiWithKeys:
            def get_instrument_key(self, symbol):
                return None if symbol == 'DAICHI' else f'NSE_EQ|{symbol}'
                return None if symbol == 'DAICHI' else 'NSE_EQ|%s' % symbol

        ranges = {
            'DAICHI': {'high': 369.9, 'low': 200.0, 'close': 364.8},
            'RELIANCE': {'high': 2550.0, 'low': 2000.0, 'close': 2500.0},
        }
        with patch(
            'api.screener_api.screener_52w.load_all_52w_ranges', return_value=ranges,
        ), patch(
            'api.screener_api.screener_52w._create_upstox_api', return_value=(ApiWithKeys(), True),
        ), patch(
            'api.screener_api.screener_52w._enrich_with_touch_history',
        ), patch(
            'api.screener_api.screener_52w._fetch_90d_daily', return_value=None,
        ):
            data = fetch_52w_high_data(provider='upstox', profile_filters=None)
        symbols = [s['symbol'] for s in data['approaching'] + data['touched']]
        assert 'DAICHI' not in symbols
        assert 'RELIANCE' in symbols

    def test_all_kept_without_api(self):
        from api.screener_api.screener_52w import fetch_52w_high_data

        ranges = {
            'DAICHI': {'high': 369.9, 'low': 200.0, 'close': 364.8},
        }
        with patch(
            'api.screener_api.screener_52w.load_all_52w_ranges', return_value=ranges,
        ), patch(
            'api.screener_api.screener_52w._create_upstox_api', return_value=(None, False),
        ), patch(
            'api.screener_api.screener_52w._enrich_with_touch_history',
        ):
            data = fetch_52w_high_data(provider='other', profile_filters=None)
        symbols = [s['symbol'] for s in data['approaching'] + data['touched']]
        assert 'DAICHI' in symbols


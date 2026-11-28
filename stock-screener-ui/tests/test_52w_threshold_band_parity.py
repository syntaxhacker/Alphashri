"""Characterization pins for the fixed 52W touch/threshold bands.

The legacy bands (0.98 / 0.99 / 0.999 multipliers) predate the configurable
0.5% ``touch_eps_pct`` default and are deliberately NOT unified onto it: screener
and signal output depends on the historical values. This file freezes each
site's current outputs *before* delegation, then asserts those exact numbers
again after the sites import the canonical constants. The delegation tests fail
on the pre-consolidation code by design.
"""
import asyncio
import importlib
import inspect
import os
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ.setdefault("CI_MODE", "1")

import pandas as pd
import pytest

import config
from api.screener_api import screener_52w, screener_scan
from api import debug_api
from trading import week52_utils


def _frame(highs, back=1):
    """Daily frame with deterministic IST dates ending ``back`` days ago."""
    base = datetime.now(config.IST).replace(hour=0, minute=0, second=0, microsecond=0)
    idx = [base - timedelta(days=back + len(highs) - 1 - i) for i in range(len(highs))]
    return pd.DataFrame(
        {
            'high': highs,
            'low': [h * 0.9 for h in highs],
            'close': [h * 0.95 for h in highs],
        },
        index=pd.DatetimeIndex(idx),
    )


SCAN_FRAMES = {
    'touch3': [90.0] * 7 + [100.0, 90.0, 90.0],
    'flat': [90.0] * 12,
    'breakout': [90.0] * 9 + [102.0, 101.0],
    'exact_98': [90.0] * 9 + [98.0, 90.0],
    'below_98': [90.0] * 9 + [97.999, 90.0],
}


class TestFrozenSiteOutputs:
    """Literal outputs captured from the sites before any source was touched."""

    @pytest.mark.parametrize(
        'frame,ref,today,expected',
        [
            ('touch3', 100.0, None, (3, 3)),
            ('touch3', 100.0, 99.6, (0, 0)),
            ('flat', 100.0, None, (1, None)),
            ('flat', 100.0, 99.6, (0, 0)),
            ('breakout', 100.0, None, (1, 1)),
            ('exact_98', 100.0, None, (2, None)),
            ('below_98', 100.0, None, (2, None)),
        ],
    )
    def test_touch_stats_from_df(self, frame, ref, today, expected):
        assert screener_scan._touch_stats_from_df(_frame(SCAN_FRAMES[frame]), ref, today) == expected

    @pytest.mark.parametrize(
        'symbol,expected',
        [('touch3', 3), ('exact_98', 2), ('flat', 1)],
    )
    def test_compute_days_ago(self, symbol, expected):
        class Api:
            def fetch_historical_data_v3(self, symbol=None, **_kwargs):
                return _frame(SCAN_FRAMES[symbol])

        assert screener_scan._compute_days_ago(Api(), symbol) == expected

    def test_debug_recent_touches_and_gap(self):
        md = {
            'current_price': 99.0,
            'high_52w': 100.0,
            'days_since_52w_high': 3,
            'daily_highs': [90.0, 95.0, 99.0, 100.0, 98.5, 99.5],
            'daily_closes': [89.0] * 6,
            'volume': 1.0,
            'avg_volume_20d': 1.0,
            'ma50': 1.0,
            'ma200': 1.0,
            'prev_high': 1.0,
            'prev_low': 1.0,
            'prev_close': 1.0,
        }
        with patch.object(debug_api, '_fetch_daily_data_for_debug', return_value=md), \
             patch.object(debug_api, '_check_52w_chaser', return_value={}), \
             patch.object(debug_api, '_check_52w_target', return_value={}), \
             patch.object(debug_api, '_check_blind_52w', return_value={}):
            out = asyncio.run(debug_api.debug_52w('T', user=None))
        assert out['pct_from_52w_high'] == 1.01
        assert out['recent_touches'] == [
            {'date': None, 'price': 99.5, 'distance_pct': -0.5},
            {'date': None, 'price': 100.0, 'distance_pct': 0.0},
            {'date': None, 'price': 99.0, 'distance_pct': -1.0},
        ]

    @pytest.mark.parametrize(
        'symbol,ltp,expected',
        [
            ('NEAR', 99.95, (0, 0, 'retest')),   # ltp >= 100 * 0.999
            ('BELOW', 99.8, (6, 6, 'fresh')),   # ltp < 100 * 0.999
        ],
    )
    def test_fill_days_ago_near_high_band(self, symbol, ltp, expected):
        bars = [90.0] * 6 + [100.0] + [90.0] * 5
        api = type('Api', (), {
            'fetch_historical_data_v3': lambda self, **_kw: _frame(bars),
        })()
        stock = {
            'symbol': symbol,
            'high_52w': 100.0,
            'upstox_price': ltp,
            'tv_price': ltp,
            'to_52w_high': 5.0,
            'touched_52w': False,
            'days_ago': None,
            'ltp_fresh': True,
            'rsi': 60.0,
            'adx': 25.0,
            'volume_m': 1.0,
        }
        screener_52w._fill_days_ago_from_upstox([stock], api, True, 1.0)
        actual = (stock['days_ago'], stock['days_since_touch'], stock['approach_type'])
        assert actual == expected

    @pytest.mark.parametrize(
        'highs,high,expected',
        [
            ([100, 105, 110, 115], 115, 0),
            ([100] * 10 + [115] + [110] * 5, 115, 5),
            ([100] * 10, 115, None),
            ([100] * 9 + [98.0], 100, 0),
            ([100] * 9 + [97.999], 100, 1),
        ],
    )
    def test_days_since_52w_high_touch(self, highs, high, expected):
        assert week52_utils.days_since_52w_high_touch(highs, high) == expected

    def test_days_since_52w_high_touch_from_df(self):
        assert week52_utils.days_since_52w_high_touch_from_df(
            _frame([90.0] * 9 + [100.0, 90.0]), 100.0,
        ) == 1
        assert week52_utils.days_since_52w_high_touch_from_df(
            _frame([90.0] * 12), 100.0,
        ) is None

    @pytest.mark.parametrize(
        'high,ins,expected',
        [
            (1255, 1257, 0),
            (1200, 1257, 9),
            (1260, 1257, 0),
        ],
    )
    def test_check_intraday_52w_touch_default_band(self, high, ins, expected):
        assert week52_utils.check_intraday_52w_touch(high, ins, days_since_52w_high=9) == expected


class TestDelegation:
    """Fails until every site imports its canonical band constant (the consolidation)."""

    @pytest.mark.parametrize(
        'module_name,attr',
        [
            ('trading.week52.config', 'LEGACY_TOUCH_BAND_PCT'),
            ('trading.week52.config', 'LEGACY_TOUCH_BAND_MULTIPLIER'),
            ('trading.week52.config', 'LEGACY_RECENT_TOUCH_BAND_PCT'),
            ('trading.week52.config', 'LEGACY_RECENT_TOUCH_BAND_MULTIPLIER'),
            ('trading.week52.config', 'LEGACY_NEAR_HIGH_BAND_PCT'),
            ('trading.week52.config', 'LEGACY_NEAR_HIGH_BAND_MULTIPLIER'),
            ('api.debug_api', 'LEGACY_RECENT_TOUCH_BAND_MULTIPLIER'),
            ('api.debug_api', 'signed_gap_pct_to_52w_high'),
            ('api.screener_api.screener_scan', 'LEGACY_TOUCH_BAND_MULTIPLIER'),
            ('api.screener_api.screener_52w', 'LEGACY_NEAR_HIGH_BAND_MULTIPLIER'),
            ('trading.week52_utils', 'LEGACY_TOUCH_BAND_MULTIPLIER'),
        ],
    )
    def test_site_imports_canonical_band(self, module_name, attr):
        assert hasattr(importlib.import_module(module_name), attr)

    def test_multipliers_reproduce_literals_bit_exactly(self):
        from trading.week52.config import (
            LEGACY_NEAR_HIGH_BAND_MULTIPLIER,
            LEGACY_NEAR_HIGH_BAND_PCT,
            LEGACY_RECENT_TOUCH_BAND_MULTIPLIER,
            LEGACY_RECENT_TOUCH_BAND_PCT,
            LEGACY_TOUCH_BAND_MULTIPLIER,
            LEGACY_TOUCH_BAND_PCT,
        )

        assert LEGACY_TOUCH_BAND_MULTIPLIER == 0.98
        assert LEGACY_RECENT_TOUCH_BAND_MULTIPLIER == 0.99
        assert LEGACY_NEAR_HIGH_BAND_MULTIPLIER == 0.999
        assert 1 - LEGACY_TOUCH_BAND_PCT / 100 == 0.98
        assert 1 - LEGACY_RECENT_TOUCH_BAND_PCT / 100 == 0.99
        assert 1 - LEGACY_NEAR_HIGH_BAND_PCT / 100 == 0.999

    @pytest.mark.parametrize(
        'function,literal',
        [
            (debug_api.debug_52w, '0.99'),
            (screener_scan._touch_stats_from_df, '0.98'),
            (screener_scan._compute_days_ago, '0.98'),
            (screener_52w._fill_days_ago_from_upstox, '0.999'),
            (week52_utils.days_since_52w_high_touch, '0.98'),
            (week52_utils.days_since_52w_high_touch_from_df, '0.98'),
            (week52_utils.check_intraday_52w_touch, '0.98'),
        ],
    )
    def test_no_raw_band_literal_left_at_site(self, function, literal):
        assert literal not in inspect.getsource(function)

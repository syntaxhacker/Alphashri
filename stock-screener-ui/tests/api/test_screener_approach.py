"""
Fresh vs retest approach-classification tests.

A row is 'touched' (at the high now), 'retest' (touched within the window,
now below), or 'fresh' (no touch in window). Touch = daily high within eps
of the SAME high the gap is measured against.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import config
from api.screener_api.screener_models import (
    classify_approach,
    has_live_data,
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

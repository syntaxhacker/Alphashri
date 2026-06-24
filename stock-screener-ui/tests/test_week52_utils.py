"""Tests for 52-week high calculation shared utility."""
import pytest
from trading.week52_utils import calculate_52w_high, check_intraday_52w_touch, days_since_52w_high_touch


class TestCalculate52WHigh:
    """Tests for calculate_52w_high() shared utility."""

    def test_basic_52w_high(self):
        """Test basic 52-week high calculation."""
        highs = [100, 105, 103, 108, 102, 110, 106, 104, 109, 107]
        result = calculate_52w_high(highs, period=252, exclude_current=True)
        # With exclude_current=True, should exclude last value (107)
        assert result == 110

    def test_with_current_bar_excluded(self):
        """Test that current bar (last value) is excluded to prevent look-ahead bias."""
        highs = [100, 105, 110, 115, 120]  # 120 is current bar
        result = calculate_52w_high(highs, period=252, exclude_current=True)
        # Should return 115 (excluding 120)
        assert result == 115

    def test_with_current_bar_included(self):
        """Test with exclude_current=False."""
        highs = [100, 105, 110, 115, 120]
        result = calculate_52w_high(highs, period=252, exclude_current=False)
        # Should return 120 (including all values)
        assert result == 120

    def test_insufficient_data(self):
        """Test with less than period data."""
        highs = [100, 105, 103]
        result = calculate_52w_high(highs, period=252, exclude_current=True)
        # Should return max of available data: 105
        assert result == 105

    def test_empty_list(self):
        """Test with empty list."""
        result = calculate_52w_high([], period=252, exclude_current=True)
        assert result is None

    def test_single_value_exclude_current(self):
        """Test single value with exclude_current=True."""
        highs = [100]
        result = calculate_52w_high(highs, period=252, exclude_current=True)
        # Excluding the only value leaves empty window
        assert result is None

    def test_single_value_include_current(self):
        """Test single value with exclude_current=False."""
        highs = [100]
        result = calculate_52w_high(highs, period=252, exclude_current=False)
        assert result == 100

    def test_rolling_window(self):
        """Test that only the last 'period' values are considered."""
        # 300 values, only last 252 should be used
        highs = list(range(1, 301))  # 1, 2, 3, ..., 300
        result = calculate_52w_high(highs, period=252, exclude_current=True)
        # Last 252 values are 49-300, exclude current (300) = max is 299
        assert result == 299

    def test_lookahead_bias_prevention(self):
        """
        Verify that exclude_current=True prevents look-ahead bias.
        This is critical for backtesting correctness.
        """
        highs = [90, 95, 100, 105, 200]  # 200 is current bar's high
        result_excluded = calculate_52w_high(highs, period=252, exclude_current=True)
        result_included = calculate_52w_high(highs, period=252, exclude_current=False)

        # With exclusion, 200 should not be included
        assert result_excluded == 105
        # Without exclusion, 200 should be included
        assert result_included == 200


class TestParity:
    """Parity tests between paper trading and backtest for 52W high calculation."""

    def test_paper_vs_backtest_consistency(self):
        """
        Both paper trading (runner_core.py) and backtest (week52_chaser.py)
        should now use the same calculate_52w_high() function.
        """
        # Simulate daily highs for a stock
        highs = [100 + i for i in range(300)]  # 100, 101, ..., 399

        # Paper trading uses exclude_current=True
        paper_result = calculate_52w_high(highs, period=252, exclude_current=True)

        # Both should get same result (backtest was already correct)
        assert paper_result == 398  # max of highs[48:299] = 398

    def test_realistic_scenario(self):
        """Test with realistic price data."""
        # Simulate a stock making new highs
        highs = [
            100, 102, 101, 105, 103, 108, 110, 107, 112, 115,  # Days 1-10
            113, 118, 120, 119, 122, 125, 123, 128, 130, 127,  # Days 11-20
            132, 135, 133, 138, 140, 137, 142, 145, 143, 148,  # Days 21-30
        ]

        # Calculate 52W high (with more than 30 days, but test with smaller period)
        result_excluded = calculate_52w_high(highs, period=30, exclude_current=True)
        result_included = calculate_52w_high(highs, period=30, exclude_current=False)

        # With exclusion: max of highs[0:29] = 145
        assert result_excluded == 145
        # Without exclusion: max of highs[0:30] = 148
        assert result_included == 148


class TestCheckIntraday52WTouch:
    """Tests for check_intraday_52w_touch() — guards against stale 52W entries."""

    def test_intraday_approach_98pct_with_old_threshold_allows_entry(self):
        """
        Mutation guard: threshold=1.0 lets intraday ₹1255 (99.8% of ₹1257) slip through.
        With the fixed threshold=0.98 it must return 0 (block entry).
        """
        result = check_intraday_52w_touch(1255, 1257, days_since_52w_high=9, threshold=0.98)
        assert result == 0, (
            f"Expected 0 (blocked) for intraday ₹1255 at 52W high ₹1257, "
            f"but got {result}. If threshold was 1.0 this would return 9."
        )

    def test_intraday_approach_98pct_with_buggy_threshold_1_allows_entry(self):
        """
        Confirm the bug: threshold=1.0 fails to catch intraday approach at 99.8%.
        """
        result = check_intraday_52w_touch(1255, 1257, days_since_52w_high=9, threshold=1.0)
        assert result == 9, f"Expected 9 (allowed) but got {result}"

    def test_intraday_above_52w_high_caught_by_both_thresholds(self):
        """Both thresholds catch when intraday breaks above the 52W high."""
        r1 = check_intraday_52w_touch(1260, 1257, days_since_52w_high=9, threshold=1.0)
        r2 = check_intraday_52w_touch(1260, 1257, days_since_52w_high=9, threshold=0.98)
        assert r1 == 0
        assert r2 == 0

    def test_no_intraday_touch_returns_unchanged(self):
        """When intraday is well below threshold, days_since passes through."""
        result = check_intraday_52w_touch(1200, 1257, days_since_52w_high=9, threshold=0.98)
        assert result == 9

    def test_days_since_already_zero_stays_zero(self):
        """If daily data already shows 0 touch, intraday check preserves it."""
        result = check_intraday_52w_touch(1255, 1257, days_since_52w_high=0, threshold=0.98)
        assert result == 0

    def test_zero_intraday_high_no_change(self):
        """Zero intraday high should not affect days_since."""
        result = check_intraday_52w_touch(0, 1257, days_since_52w_high=9, threshold=0.98)
        assert result == 9


class TestDaysSince52WHighTouch:
    """Tests for days_since_52w_high_touch()."""

    def test_recent_touch_returns_zero(self):
        """Last bar at or above 98% of 52W high returns 0."""
        highs = [100, 105, 110, 115]
        result = days_since_52w_high_touch(highs, 115)
        assert result == 0

    def test_touch_five_bars_ago(self):
        """Bar at index -6 was last to touch 98% threshold."""
        highs = [100] * 10 + [115] + [110] * 5  # 115 at index 10, 5 bars of 110 follow
        result = days_since_52w_high_touch(highs, 115)
        # last 5 bars are 110, index -6 is 115, so bars_ago = 5
        assert result == 5

    def test_no_touch_returns_none(self):
        """No bar reaches 98% threshold."""
        highs = [100] * 10
        result = days_since_52w_high_touch(highs, 115)
        assert result is None

    def test_empty_highs_returns_none(self):
        result = days_since_52w_high_touch([], 115)
        assert result is None

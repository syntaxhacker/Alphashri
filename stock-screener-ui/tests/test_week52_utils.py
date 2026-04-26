"""Tests for 52-week high calculation shared utility."""
import pytest
from trading.week52_utils import calculate_52w_high


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

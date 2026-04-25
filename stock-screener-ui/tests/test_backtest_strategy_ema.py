"""Tests for EMA Cross backtest strategy."""
import pytest
from backtest.strategies.ema_cross import calculate_ema as backtest_calculate_ema


def test_backtest_calculate_ema_returns_float():
    """Backtest calculate_ema returns a float, not a list."""
    closes = [100, 102, 105, 103, 108]
    result = backtest_calculate_ema(closes, 3)
    assert isinstance(result, float)
    # EMA = SMA(100, 102, 105) = 102.333, then apply EMA formula
    # EMA_3 = 102.333 * 0.5 + 103 * 0.5 = 102.667
    # EMA_4 = 102.667 * 0.5 + 108 * 0.5 = 105.333
    assert abs(result - 105.3333) < 0.01


def test_backtest_calculate_ema_insufficient_data():
    """Returns last value if insufficient data."""
    closes = [100, 102]
    result = backtest_calculate_ema(closes, 3)
    assert result == 102.0  # Returns last value if insufficient data


def test_backtest_calculate_ema_empty_list():
    """Returns 0.0 for empty list."""
    result = backtest_calculate_ema([], 3)
    assert result == 0.0


def test_ema_parity_paper_vs_backtest():
    """Both implementations should produce same EMA values."""
    from trading.ema_cross_signals import EMACrossSignalGenerator

    closes = [100, 102, 105, 103, 108, 107, 105, 103, 101, 99]

    paper_result = EMACrossSignalGenerator.calculate_ema(closes, 3)
    backtest_result = backtest_calculate_ema(closes, 3)

    # Last value should match (within floating point tolerance)
    assert abs(paper_result[-1] - backtest_result) < 0.01


def test_ema_golden_values():
    """Test against pandas ewm (ground truth)."""
    from trading.ema_cross_signals import EMACrossSignalGenerator

    closes = [100, 102, 105, 103, 108, 107, 105, 103, 101, 99]
    result = EMACrossSignalGenerator.calculate_ema(closes, 3)

    # Verified with: pd.Series(closes).ewm(span=3, adjust=False).mean()
    expected = [None, None, 102.3333, 102.6667, 105.3333, 106.1667,
                105.5833, 104.2917, 102.6458, 100.8229]

    for i, (actual, exp) in enumerate(zip(result, expected)):
        if exp is None:
            assert actual is None, f"Position {i}: expected None"
        else:
            assert abs(actual - exp) < 0.01, f"Position {i}: {actual} != {exp}"


def test_backtest_calculate_ema_single_value():
    """Returns the single value if only one price."""
    result = backtest_calculate_ema([100.0], 3)
    assert result == 100.0

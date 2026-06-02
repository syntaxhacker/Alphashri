"""Shared 52-week high/low calculation - single source of truth."""
import math
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd


def _rolling_window(
    values: List[float], period: int = 252, exclude_current: bool = True
) -> List[float]:
    if not values:
        return []
    if exclude_current:
        window = values[:-1] if len(values) > 1 else []
    else:
        window = values
    if not window:
        return []
    if len(window) > period:
        window = window[-period:]
    return window


def calculate_52w_high(highs: List[float], period: int = 252, exclude_current: bool = True) -> Optional[float]:
    """
    Calculate 52-week (252 trading days) rolling high.

    Args:
        highs: List of high prices (chronological order)
        period: Lookback period (default 252 = 1 year)
        exclude_current: If True, exclude last value to prevent look-ahead bias

    Returns:
        float: 52-week high, or None if insufficient data
    """
    window = _rolling_window(highs, period=period, exclude_current=exclude_current)
    if not window:
        return None
    return max(window)


def calculate_52w_low(lows: List[float], period: int = 252, exclude_current: bool = True) -> Optional[float]:
    """
    Calculate 52-week (252 trading days) rolling low.

    Same windowing rules as calculate_52w_high (excludes current bar by default).
    """
    window = _rolling_window(lows, period=period, exclude_current=exclude_current)
    if not window:
        return None
    return min(window)


def build_52w_range_from_ohlc(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    period: int = 252,
    exclude_current: bool = True,
) -> Optional[dict]:
    """
    Build {high, low, close} for stock_52w_range from daily OHLC lists.

    close is the latest bar close (included even when high/low exclude current bar).
    """
    if not closes:
        return None
    high = calculate_52w_high(highs, period=period, exclude_current=exclude_current)
    low = calculate_52w_low(lows, period=period, exclude_current=exclude_current)
    close = float(closes[-1])
    if high is None or low is None:
        return None
    if not all(math.isfinite(x) for x in (high, low, close)):
        return None
    return {"high": float(high), "low": float(low), "close": close}


def days_since_52w_high_touch(
    highs: List[float],
    high_52w: float,
    *,
    threshold: float = 0.98,
) -> Optional[int]:
    """
    Trading bars since the last daily high reached threshold * 52w high.
    0 = most recent bar (typically today/yesterday on daily data).
    """
    if not highs or high_52w <= 0:
        return None
    level = high_52w * threshold
    for bars_ago in range(len(highs) - 1, -1, -1):
        if highs[bars_ago] >= level:
            return max(0, len(highs) - 1 - bars_ago)
    return None


def days_since_52w_high_touch_from_df(df: "pd.DataFrame", high_52w: float) -> Optional[int]:
    """Calendar days from last 52w-high touch to the last bar date."""
    if df is None or df.empty or high_52w <= 0:
        return None
    level = high_52w * 0.98
    try:
        touched = df[df["high"].astype(float) >= level]
        if touched.empty:
            return None
        last_touch = touched.index[-1]
        last_bar = df.index[-1]
        if hasattr(last_touch, "to_pydatetime"):
            last_touch = last_touch.to_pydatetime()
        if hasattr(last_bar, "to_pydatetime"):
            last_bar = last_bar.to_pydatetime()
        if getattr(last_touch, "tzinfo", None):
            last_touch = last_touch.replace(tzinfo=None)
        if getattr(last_bar, "tzinfo", None):
            last_bar = last_bar.replace(tzinfo=None)
        return max(0, (last_bar - last_touch).days)
    except Exception:
        highs = df["high"].astype(float).tolist()
        return days_since_52w_high_touch(highs, high_52w)

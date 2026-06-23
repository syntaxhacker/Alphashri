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


def check_intraday_52w_touch(
    intraday_high: float,
    high_52w: float,
    days_since_52w_high: int,
    *,
    threshold: float = 0.98,
) -> int:
    """
    Detect if today's intraday high has already touched the 52W high zone.

    When a stock breaks its 52W high intraday but the daily bar hasn't closed,
    days_since_52w_high computed from daily data alone misses today's touch.
    This function overrides it to 0 so callers can block stale breakouts.

    Args:
        intraday_high: Today's highest price so far (from intraday data).
        high_52w: Current 52-week high (may or may not include today's candle).
        days_since_52w_high: Value computed from daily data only.
        threshold: Fraction of 52W high considered a "touch" (default 0.98).

    Returns:
        Corrected days_since value (0 if touched today, original otherwise).
    """
    if intraday_high > 0 and high_52w > 0:
        touch_level = high_52w * threshold
        if intraday_high >= touch_level and days_since_52w_high > 0:
            return 0
    return days_since_52w_high


# --- Shared helpers for 52W backtest Nautilus strategies (DRY fix) ---

from datetime import datetime, timezone
# Note: get_date_from_ns is timezone-naive in sense of IST; used for bar ts_event which is UTC ns


def get_date_from_ns(ts_ns: int) -> datetime:
    """Convert nanosecond timestamp (from nautilus bar.ts_event) to datetime in UTC.
    Duplicated previously in backtest/strategies/week52_*.py .
    """
    ts_sec = ts_ns / 1_000_000_000
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc)


class Week52HighTracker:
    """
    Stateful 52-week high tracker backed by calculate_52w_high.
    Eliminates duplicated _high_prices / _price_history + calc logic
    in Week52*NautilusStrategy.on_bar().

    Compatible with Week52HighIndicator API (used by chaser tests for backward compat).
    """
    def __init__(self, period: int = 252, min_periods: int = 20):
        self.period = period
        self.min_periods = min_periods
        self._high_prices: List[float] = []
        self._current_52w_high: Optional[float] = None

    def update(self, high_price: float) -> Optional[float]:
        """Append high (of bar), compute 52w excluding current, return it (or None)."""
        self._high_prices.append(float(high_price))

        # Keep only the last 'period'
        if len(self._high_prices) > self.period:
            self._high_prices.pop(0)

        # Match prior logic: compute even for small counts if possible
        if len(self._high_prices) >= self.min_periods:
            self._current_52w_high = calculate_52w_high(
                self._high_prices, period=self.period, exclude_current=True
            )
        elif len(self._high_prices) > 1:
            self._current_52w_high = calculate_52w_high(
                self._high_prices, period=self.period, exclude_current=True
            )
        else:
            self._current_52w_high = None

        return self._current_52w_high

    @property
    def value(self) -> Optional[float]:
        return self._current_52w_high

    def is_initialized(self) -> bool:
        return len(self._high_prices) >= self.min_periods and self._current_52w_high is not None

    def reset(self) -> None:
        self._high_prices = []
        self._current_52w_high = None

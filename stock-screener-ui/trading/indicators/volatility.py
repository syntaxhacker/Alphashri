"""Volatility indicators: ATR / ATR% / Bollinger Bands."""
from __future__ import annotations

import pandas as pd

from . import _engine
from ._common import SeriesLike, as_series, shape


def atr(high: SeriesLike, low: SeriesLike, close: SeriesLike, period: int = 14, *, full: bool = False):
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, was_series = as_series(close)
    return shape(_engine.atr(h, l, c, period), was_series, full, len(c))


def atr_pct(high: SeriesLike, low: SeriesLike, close: SeriesLike, period: int = 14) -> float:
    """Latest ATR as a percentage of the latest close (0.0 when undefined)."""
    c, _ = as_series(close)
    if c.empty or not c.iloc[-1]:
        return 0.0
    a = atr(high, low, close, period)
    if hasattr(a, "iloc"):  # Series input -> Series output
        last = a.iloc[-1]
        a_val = 0.0 if pd.isna(last) else float(last)
    else:
        a_val = float(a)
    return 0.0 if not a_val else round(a_val / float(c.iloc[-1]) * 100, 2)


def bbands(values: SeriesLike, length: int = 20, std: float = 2.0):
    s, _ = as_series(values)
    return _engine.bbands(s, length=length, std=std)


def supertrend(high: SeriesLike, low: SeriesLike, close: SeriesLike, length: int = 7, multiplier: float = 3.0):
    """Returns pandas-ta's Supertrend frame (SUPERT_/SUPERTd_/SUPERTl_/SUPERTs_ columns)."""
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, _ = as_series(close)
    return _engine.supertrend(h, l, c, length=length, multiplier=multiplier)

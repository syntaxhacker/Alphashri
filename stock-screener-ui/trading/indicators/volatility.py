"""Volatility indicators: ATR / ATR% / Bollinger Bands."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import _engine
from ._common import SeriesLike, as_series, shape


def atr(high: SeriesLike, low: SeriesLike, close: SeriesLike, period: int = 14, *, full: bool = False):
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, was_series = as_series(close)
    return shape(_engine.atr(h, l, c, period), was_series, full, len(c))


def atr_first_bar(high: SeriesLike, low: SeriesLike, close: SeriesLike,
                  period: int = 14, *, full: bool = False):
    """Wilder ATR seeded at the first bar's true range (``high - low``).

    The engine ATR (:func:`atr`) leaves bar 0's true range undefined because it
    shifts the close, so Wilder's smoothing starts at bar 1. This variant treats
    bar 0's true range as ``high - low`` and seeds there — the geometry contract
    used by chart-pattern detection. The two converge as
    ``(1 - 1/period) ** bars``; for short frames they are measurably different.
    """
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, was_series = as_series(close)
    if c.empty:
        return shape(None, was_series, full, 0)
    hv = h.to_numpy(dtype="float64")
    lv = l.to_numpy(dtype="float64")
    cv = c.to_numpy(dtype="float64")
    prev = np.empty_like(cv)
    prev[0] = np.nan
    prev[1:] = cv[:-1]
    tr = np.fmax.reduce([hv - lv, np.abs(hv - prev), np.abs(lv - prev)])
    out = pd.Series(tr, index=c.index, dtype="float64").ewm(
        alpha=1.0 / max(period, 1), adjust=False, min_periods=1
    ).mean()
    return shape(out, was_series, full, len(c))


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

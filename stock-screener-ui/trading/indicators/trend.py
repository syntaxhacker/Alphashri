"""Trend indicators: EMA / SMA. One responsibility, delegates to the engine."""
from __future__ import annotations

import pandas as pd

from . import _engine
from ._common import SeriesLike, as_series, shape


def _trend(compute, values: SeriesLike, period: int, full: bool):
    s, was_series = as_series(values)
    out = compute(s, period)
    # Non-full scalar requests keep the historical "insufficient data -> latest
    # price" fallback (0.0 would read as a crash-like value in live signals).
    if not was_series and not full:
        if out is None or out.empty or pd.isna(out.iloc[-1]):
            return float(s.iloc[-1]) if len(s) else 0.0
    return shape(out, was_series, full, len(s))


def ema(values: SeriesLike, period: int, *, full: bool = False):
    return _trend(_engine.ema, values, period, full)


def sma(values: SeriesLike, period: int, *, full: bool = False):
    return _trend(_engine.sma, values, period, full)

"""Trend-strength indicators: ADX with DI+ / DI-."""
from __future__ import annotations

from typing import Dict

import pandas as pd

from . import _engine
from ._common import SeriesLike, as_series, shape


def _col(frame: pd.DataFrame, prefix: str) -> pd.Series:
    for c in frame.columns:
        if c.startswith(prefix):
            return frame[c]
    raise KeyError(f"no column starting with {prefix!r} in {list(frame.columns)}")


def adx(high: SeriesLike, low: SeriesLike, close: SeriesLike, period: int = 14, *, full: bool = False):
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, was_series = as_series(close)
    frame = _engine.adx(h, l, c, period)
    if frame is None:
        return shape(None, was_series, full, len(c))
    return shape(_col(frame, "ADX_"), was_series, full, len(c))


def adx_di(high: SeriesLike, low: SeriesLike, close: SeriesLike, period: int = 14) -> Dict[str, float]:
    """Latest ADX / DI+ / DI- as a dict (for callers that need all three)."""
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, _ = as_series(close)
    if len(c) < period + 2:
        return {"adx": 0.0, "di_plus": 0.0, "di_minus": 0.0}
    frame = _engine.adx(h, l, c, period)

    def last(prefix: str) -> float:
        s = _col(frame, prefix)
        return 0.0 if s.empty or pd.isna(s.iloc[-1]) else round(float(s.iloc[-1]), 1)

    return {"adx": last("ADX_"), "di_plus": last("DMP_"), "di_minus": last("DMN_")}

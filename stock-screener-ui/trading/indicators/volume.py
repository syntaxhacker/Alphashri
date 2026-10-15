"""Volume indicators: anchored VWAP (bar-based)."""
from __future__ import annotations

from . import _engine
from ._common import SeriesLike, as_series


def vwap(high: SeriesLike, low: SeriesLike, close: SeriesLike, volume: SeriesLike, anchor: str = "D"):
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, _ = as_series(close)
    v, _ = as_series(volume)
    return _engine.vwap(h, l, c, v, anchor=anchor)

"""Momentum indicators: RSI / MACD / Stochastic."""
from __future__ import annotations

from . import _engine
from ._common import SeriesLike, as_series, shape


def rsi(values: SeriesLike, period: int = 14, *, full: bool = False):
    s, was_series = as_series(values)
    return shape(_engine.rsi(s, period), was_series, full, len(s))


def macd(values: SeriesLike, fast: int = 12, slow: int = 26, signal: int = 9):
    s, _ = as_series(values)
    return _engine.macd(s, fast=fast, slow=slow, signal=signal)


def stoch(high: SeriesLike, low: SeriesLike, close: SeriesLike, k: int = 14, d: int = 3, smooth: int = 3):
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, _ = as_series(close)
    return _engine.stoch(h, l, c, k=k, d=d, smooth=smooth)

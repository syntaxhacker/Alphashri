"""Momentum indicators: RSI / MACD / Stochastic."""
from __future__ import annotations

from typing import Optional

from . import _engine
from ._common import SeriesLike, as_series, shape


def rsi(values: SeriesLike, period: int = 14, *, full: bool = False):
    s, was_series = as_series(values)
    return shape(_engine.rsi(s, period), was_series, full, len(s))


def rsi_wilder(values: SeriesLike, period: int = 14) -> Optional[float]:
    """Wilder's RSI seeded with the SMA of the first ``period`` deltas.

    The engine RSI (:func:`rsi`) seeds Wilder's smoothing from the first delta
    via ``ewm(alpha=1/period, adjust=False)``. This variant uses the classic
    SMA-of-first-``period``-deltas seed instead, returns ``None`` until
    ``period + 1`` closes exist, and pins a series with zero average loss to 100.
    """
    s, _ = as_series(values)
    closes = s.tolist()
    if period <= 0 or len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    avg_gain = sum(max(d, 0.0) for d in deltas[:period]) / period
    avg_loss = sum(max(-d, 0.0) for d in deltas[:period]) / period
    for d in deltas[period:]:
        avg_gain = (avg_gain * (period - 1) + max(d, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def macd(values: SeriesLike, fast: int = 12, slow: int = 26, signal: int = 9):
    s, _ = as_series(values)
    return _engine.macd(s, fast=fast, slow=slow, signal=signal)


def stoch(high: SeriesLike, low: SeriesLike, close: SeriesLike, k: int = 14, d: int = 3, smooth: int = 3):
    h, _ = as_series(high)
    l, _ = as_series(low)
    c, _ = as_series(close)
    return _engine.stoch(h, l, c, k=k, d=d, smooth=smooth)

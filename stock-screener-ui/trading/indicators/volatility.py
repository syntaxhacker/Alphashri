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


def _candle_field(candle, name: str, idx: int):
    """Tolerant OHLC getter for Upstox candles as dicts or positional lists."""
    if isinstance(candle, dict):
        value = candle.get(name)
    else:
        try:
            value = candle[idx]
        except (IndexError, TypeError):
            value = None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def atr_mean_range(bars, i: int, n: int = 14) -> float:
    """Mean ``high - low`` over the ``n`` bars ending at index ``i``.

    This is deliberately NOT a true range (no previous-close term) and NOT
    Wilder-smoothed: the LRL-iFVG studies call this number "ATR" and feed it to
    collinearity tolerances. Returns 0.0 when fewer than ``n`` bars are available.
    Plain ``sum`` keeps the desk number bit-identical to its historical home in
    ``scripts/indicators.py``; do not swap in numpy for speed.
    """
    if i < n:
        return 0.0
    return sum(bars[k]["high"] - bars[k]["low"] for k in range(i - n + 1, i + 1)) / n


def atr_mean_true_range(candles, period: int = 14):
    """Mean TRUE range over the last ``period`` valid candles.

    Unlike :func:`atr`, this is a bounded arithmetic mean, not Wilder smoothing.
    Candles with a non-positive or unparseable close are skipped without moving
    the previous close; a missing high/low falls back to ``|close - prev_close|``.
    Returns None when no true range can be formed. Plain ``sum`` and Python
    floats preserve the desk speed panel's historical result bit-for-bit.
    """
    trs: list[float] = []
    prev_close = None
    for c in candles or []:
        high = _candle_field(c, "high", 2)
        low = _candle_field(c, "low", 3)
        close = _candle_field(c, "close", 4)
        if close is None or close <= 0:
            continue
        if high is not None and low is not None and prev_close is not None:
            trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
        elif prev_close is not None:
            trs.append(abs(close - prev_close))
        prev_close = close
    if not trs:
        return None
    window = trs[-max(1, period):]
    return sum(window) / len(window)


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

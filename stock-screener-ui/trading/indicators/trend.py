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


def ema_sma_seed(values: SeriesLike, period: int, *, full: bool = False):
    """EMA seeded with the mean of the first ``period`` closes.

    The engine EMA (:func:`ema`) asks pandas-ta to do the same seed, but this
    variant is a plain backward recursion and skips missing closes before
    seeding: the seed is the mean of the first ``period`` *valid* closes and the
    result is aligned back to the original positions (gaps stay undefined).
    A partial prefix therefore yields the same trailing value as the full
    series, which the report overlays rely on.
    """
    s, was_series = as_series(values)
    n = len(s)
    out = pd.Series(float("nan"), index=s.index, dtype="float64")
    if period <= 0 or n == 0:
        return shape(out, was_series, full, n)
    valid = [i for i, v in enumerate(s.tolist()) if not pd.isna(v)]
    if len(valid) < period:
        return shape(out, was_series, full, n)
    k = 2.0 / (period + 1.0)
    vals = [float(s.iloc[i]) for i in valid]
    e = sum(vals[:period]) / period
    seq = [e]
    for v in vals[period:]:
        e = v * k + e * (1.0 - k)
        seq.append(e)
    for pos, idx in enumerate(valid[period - 1:]):
        out.iloc[idx] = seq[pos]
    return shape(out, was_series, full, n)


def ema_first_close(values: SeriesLike, period: int, *, full: bool = False):
    """EMA seeded with the first close (the ``ewm(adjust=False)`` form).

    Unlike :func:`ema` / :func:`ema_sma_seed` there is no SMA warm-up: the
    recursion starts at ``values[0]``. Because it only looks backwards, a full
    series is one pass, which is why the profitability scan prefers it over
    rebuilding an EMA per signal bar.
    """
    s, was_series = as_series(values)
    n = len(s)
    if period <= 0 or n == 0:
        return shape(None, was_series, full, n)
    alpha = 2.0 / (period + 1.0)
    out = [float(s.iloc[0])]
    append = out.append
    for v in s.iloc[1:]:
        append(alpha * float(v) + (1.0 - alpha) * out[-1])
    return shape(pd.Series(out, index=s.index, dtype="float64"), was_series, full, n)

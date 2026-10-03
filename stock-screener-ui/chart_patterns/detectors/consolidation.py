"""Consolidation detector: long, tight sideways base (continuation, neutral).

A consolidation base is a long horizontal range in which price oscillates inside
a box and does not trend. Unlike :mod:`rectangle` — which fits pivot envelopes
and requires two touches per edge — this detector scans trailing windows of
increasing length, keeps the genuine (range-bound, near-flat) ones and reports
the **longest** qualifying base. That turns a multi-month sideways base into a
single hit, and exposes ``base_days`` / ``range_pct`` / ``range_pos`` so scanners
can filter for long, tight, non-extended bases.

Geometry built here:

* ``breakout_level`` = window high (upside breakout of the box), long geometry,
* ``opposite_extreme`` = window low (measured-move target / ATR stop anchor),
* ``trendlines`` = the two flat box edges (upper resistance, lower support).
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

from .. import features as F
from .common import (
    flat_line_points,
    get_swings,
    make_hit,
    pivot_markers,
    register,
    window_slice,
)

# Trailing windows (bars) scanned; the longest qualifying one is reported.
WINDOWS = (30, 60, 90, 120, 180, 250)
MIN_BARS = 20
# Widest accepted base: a range wider than this is a trend, not a consolidation.
RANGE_MAX = float(os.environ.get("PATTERN_CONSOLIDATION_MAX_RANGE_PCT", "20.0"))
# A base needs real two-sided volatility; a dead-flat line is not a base and
# would otherwise trip the engine's "flat line produces no patterns" invariant.
MIN_RANGE_PCT = 1.5
# Close must not drift more than 12% of price across the window (near-flat).
NEAR_FLAT_MAX = 0.12
# Last close must be inside the box, away from a mid-breakout at either edge.
POS_MIN, POS_MAX = 15.0, 85.0
TOUCH_TOL_ATR = 0.75


def _tightness(range_pct: float, range_max: float) -> float:
    """Simple tightness score in ``[0.5, 1.0]`` (1.0 = dead-flat base).

    Floored at 0.5 so a genuine base never scores as ``marginal`` purely for
    having a wide-but-still-acceptable range.
    """
    score = 1.0 - float(range_pct) / (2.0 * max(float(range_max), 1e-9))
    return round(float(min(1.0, max(0.5, score))), 3)


def _window_base(df: pd.DataFrame, start: int, end: int, w: int):
    """Metrics for the trailing base in ``[start, end]`` or ``None`` if no base."""
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    close = df["close"].astype(float)

    hi = float(high.iloc[start : end + 1].max())
    lo = float(low.iloc[start : end + 1].min())
    mp = float(close.iloc[start : end + 1].mean())
    if hi <= lo or mp <= 0:
        return None

    range_pct = (hi - lo) / mp * 100.0
    if range_pct > RANGE_MAX or range_pct < MIN_RANGE_PCT:
        return None

    last = float(close.iloc[end])
    range_pos = (last - lo) / (hi - lo) * 100.0
    if not (POS_MIN <= range_pos <= POS_MAX):
        return None

    xs = np.arange(start, end + 1, dtype=float)
    beta, _intercept, _r2 = F.linreg_fit(
        xs, close.iloc[start : end + 1].to_numpy(dtype=float)
    )
    if abs(F.relative_slope(beta, end - start + 1, mp)) > NEAR_FLAT_MAX:
        return None

    return {
        "start": start,
        "end": end,
        "w": w,
        "hi": hi,
        "lo": lo,
        "mp": mp,
        "range_pct": range_pct,
        "range_pos": range_pos,
    }


def detect_consolidation(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Consolidation (neutral continuation; long tight base with upside geometry).

    Scans trailing windows ``WINDOWS`` and reports the **longest** one that is a
    genuine base: range ``<= RANGE_MAX`` (default 20%, env
    ``PATTERN_CONSOLIDATION_MAX_RANGE_PCT``), last close inside the box
    (``15 <= range_pos <= 85``) and close near-flat over the window
    (``|relative slope| <= 0.12``). Metric tools tightly bound a horizontal base
    but let genuine multi-month bases through. Breakout is the box high with the
    box low as the measured-move / stop anchor (``direction="neutral"``, long
    geometry). Emits at most one hit per symbol.
    """
    ctx = ctx or {}
    n = len(df)
    if n < MIN_BARS:
        return []

    best = None
    for w in WINDOWS:
        # Only scan a window we actually have bars for, so ``base_days`` is the
        # true lookback rather than a clipped (smaller) span.
        if n < w:
            continue
        win = window_slice(df, w, MIN_BARS)
        if win is None:
            continue
        start, end = win
        base = _window_base(df, start, end, w)
        if base is None:
            continue
        if best is None or base["w"] > best["w"]:
            best = base

    if best is None:
        return []

    start, end = best["start"], best["end"]
    hi, lo = best["hi"], best["lo"]
    range_pct, range_pos = best["range_pct"], best["range_pos"]

    atr_val = F.atr_value(df)
    highs, lows = get_swings(df, ctx)
    H = [(p, q) for p, q in highs if start <= p <= end]
    L = [(p, q) for p, q in lows if start <= p <= end]
    touches = 1
    if atr_val > 0:
        touches = max(
            1,
            F.count_touches(highs, 0.0, hi, atr_val, tol_atr=TOUCH_TOL_ATR)
            + F.count_touches(lows, 0.0, lo, atr_val, tol_atr=TOUCH_TOL_ATR),
        )

    notes = f"consolidation {best['w']}d; range {range_pct:.1f}%, pos {range_pos:.0f}%"
    return [
        make_hit(
            "consolidation",
            df,
            start_pos=start,
            end_pos=end,
            breakout_level=hi,
            opposite_extreme=lo,
            pattern_height=hi - lo,
            touches=touches,
            r2=_tightness(range_pct, RANGE_MAX),
            trendlines=[
                flat_line_points(df, hi, start, end),
                flat_line_points(df, lo, start, end),
            ],
            notes=notes,
            direction="neutral",
            pivots=pivot_markers(df, H, L, start, end),
            base_days=best["w"],
            range_pct=range_pct,
            range_pos=range_pos,
        )
    ]


register("consolidation", detect_consolidation)

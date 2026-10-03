"""Curve / cup detectors.

Rounded (quadratic) price structures: the bearish curve (rounded top / dome) and
the Cup & Handle continuation. Pure ``detect(df, ctx) -> list[PatternHit]``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .. import features as F
from .common import (
    curve_points,
    flat_line_points,
    get_swings,
    make_hit,
    pivot_markers,
    register,
    window_slice,
)

LOOKBACK = 140


def _quad_fit(y: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    """Fit y against its own index; return fitted, coeffs, r2, vertex-x."""
    xs = np.arange(len(y), dtype=float)
    fitted, coeffs = F.polyfit_values(y, degree=2, x=xs)
    r2 = F.r2_of(y, fitted)
    if len(coeffs) >= 3 and abs(float(coeffs[0])) > 1e-12:
        vertex = -float(coeffs[1]) / (2.0 * float(coeffs[0]))
    else:
        vertex = len(y) / 2.0
    return fitted, coeffs, r2, vertex


def _outer_envelope_curve(
    fitted: np.ndarray,
    boundary: np.ndarray,
    side: str,
    margin: float = 1e-4,
) -> np.ndarray:
    """Translate a fitted curve so it clears the candles on ``side``.

    ``side="upper"`` lifts the curve to sit at/above every bar ``high``; ``"lower"``
    drops it to sit at/below every bar ``low``. Only the vertical offset changes —
    the dome/cup curvature (and therefore the analysis) is preserved — so the
    outline reads as the same structure while never cutting through the candles.
    """
    f = np.asarray(fitted, dtype=float)
    b = np.asarray(boundary, dtype=float)
    if len(f) == 0 or len(b) == 0:
        return f.copy()
    size = min(len(f), len(b))
    f = f[:size]
    b = b[:size]
    if side == "upper":
        delta = float(np.max(b - f))
        return f + max(delta, 0.0) + margin
    delta = float(np.max(f - b))
    return f - max(delta, 0.0) - margin


def detect_curve_bearish(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Curve Pattern, Bearish (rounded top / dome).

    Concave-down quadratic fit (``a < 0``) of close with its vertex in the
    middle third: both edges are below the peak. The neckline is the lower edge
    level; breakout is downward through it, measured move = peak - neckline.

    Three overlay lines are drawn: the fitted quadratic dome curve (the
    analysis), the horizontal neckline at ``breakout_level`` (so the dashed
    breakout guide coincides with a real drawn level, mirroring the cup rim),
    and an **upper envelope** that follows the same dome but is lifted to clear
    the swing highs — so the drawn overlay never cuts through the candles.
    Swing pivots used to define the structure are attached for on-chart markers.
    """
    start, end = window_slice(df, LOOKBACK, 40) or (0, 0)
    if end <= 0:
        return []
    y = df["close"].iloc[start : end + 1].to_numpy(dtype=float)
    if len(y) < 20:
        return []
    fitted, coeffs, r2, vertex = _quad_fit(y)
    a = float(coeffs[0])
    n = len(y)
    if a >= 0:
        return []
    if not (0.2 * n <= vertex <= 0.8 * n):
        return []
    if r2 < 0.55:
        return []
    peak = float(fitted.max())
    neckline = float(min(fitted[0], fitted[-1]))
    depth = peak - neckline
    atr_val = F.atr_value(df)
    if depth <= max(0.6 * atr_val, 0.6):
        return []
    hi, lo, _, _ = F.swing_extremes(df, start, end)
    if peak <= neckline:
        return []
    # price must have rolled over below the peak toward the neckline
    if float(df["close"].iloc[end]) > neckline + 0.6 * depth:
        return []
    highs, lows = get_swings(df, ctx)
    pivots = pivot_markers(df, highs, lows, start, end)
    upper_env = _outer_envelope_curve(
        fitted,
        df["high"].iloc[start : end + 1].to_numpy(dtype=float),
        "upper",
    )
    notes = f"rounded top; peak {peak:.4g}, neckline {neckline:.4g}, R2 {r2:.2f}"
    return [
        make_hit(
            "curve_bearish",
            df,
            start_pos=start,
            end_pos=end,
            breakout_level=neckline,
            opposite_extreme=hi,
            pattern_height=depth,
            touches=2,
            r2=r2,
            trendlines=[
                curve_points(df, start, fitted),
                flat_line_points(df, neckline, start, end),
                curve_points(df, start, upper_env),
            ],
            notes=notes,
            pivots=pivots,
        )
    ]


def detect_cup_handle(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Cup & Handle (bullish continuation).

    A rounded cup (concave-up fit, vertex mid-cup, R² >= 0.5) followed by a
    shallow handle that retraces <50% of the cup depth and drifts sideways/down.
    Breakout is above the cup rim; measured move = cup depth.

    Overlays make both halves readable: (a) the fitted cup curve, (b) a lower
    envelope following that curve but dropped clear of the candle lows so the cup
    outline never cuts through price, (c) the rim line at ``breakout_level``
    spanning the whole cup+handle, and (d) explicit handle upper/lower boundary
    lines across the handle region. ``start_pos``/``end_pos`` span cup+handle and
    the defining swing pivots are attached for on-chart markers.
    """
    start, end = window_slice(df, LOOKBACK, 60) or (0, 0)
    if end <= 0:
        return []
    n = end - start + 1
    handle_bars = max(5, n // 8)
    cup_end = end - handle_bars
    if cup_end - start < 25:
        return []
    y = df["close"].iloc[start : cup_end + 1].to_numpy(dtype=float)
    fitted, coeffs, r2, vertex = _quad_fit(y)
    if float(coeffs[0]) <= 0:
        return []
    m = len(y)
    if not (0.15 * m <= vertex <= 0.85 * m):
        return []
    if r2 < 0.5:
        return []
    trough = float(fitted.min())
    cup_high = float(df["high"].iloc[start : cup_end + 1].max())
    depth = cup_high - trough
    atr_val = F.atr_value(df)
    if depth <= max(0.6 * atr_val, 0.6):
        return []

    h_low = float(df["low"].iloc[cup_end : end + 1].min())
    h_high = float(df["high"].iloc[cup_end : end + 1].max())
    # handle sits in the upper half of the cup (shallow retrace)
    if h_low < trough + 0.5 * depth:
        return []
    if (h_high - h_low) > 0.5 * depth:
        return []
    h_start = float(df["close"].iloc[cup_end])
    h_end = float(df["close"].iloc[end])
    if h_start > 0 and (h_end - h_start) / h_start > 0.05:
        return []
    # price should be near the rim ready to break out
    if float(df["close"].iloc[end]) < trough + 0.55 * (cup_high - trough):
        return []

    rim = cup_high
    touches = 2
    highs, lows = get_swings(df, ctx)
    pivots = pivot_markers(df, highs, lows, start, end)
    cup_lower_env = _outer_envelope_curve(
        fitted,
        df["low"].iloc[start : cup_end + 1].to_numpy(dtype=float),
        "lower",
    )
    notes = (
        f"cup & handle; cup low {trough:.4g}, rim {rim:.4g}, "
        f"handle {h_low:.4g}-{h_high:.4g}, R2 {r2:.2f}"
    )
    return [
        make_hit(
            "cup_handle",
            df,
            start_pos=start,
            end_pos=end,
            breakout_level=rim,
            opposite_extreme=h_low,
            pattern_height=depth,
            touches=touches,
            r2=r2,
            trendlines=[
                curve_points(df, start, fitted),
                flat_line_points(df, rim, start, end),
                curve_points(df, start, cup_lower_env),
                flat_line_points(df, h_high, cup_end, end),
                flat_line_points(df, h_low, cup_end, end),
            ],
            notes=notes,
            pivots=pivots,
        )
    ]


register("curve_bearish", detect_curve_bearish)
register("cup_handle", detect_cup_handle)

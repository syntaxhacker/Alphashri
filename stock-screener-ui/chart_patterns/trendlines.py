"""Standalone support/resistance trendline detection.

Thin wrapper over :mod:`chart_patterns.features` envelope geometry:
support is the lower boundary through swing lows, resistance the upper
boundary through swing highs. Side-effect-free; returns plain dicts.
"""

from __future__ import annotations

import pandas as pd

from chart_patterns import features as F
from chart_patterns.detectors.common import get_swings, iso_ts


def _build_side(df: pd.DataFrame, pivots: list, env: dict, kind: str, atr: float) -> dict | None:
    """Serialise one envelope line, applying the touches/span guards."""
    try:
        slope = float(env["slope"])
        intercept = float(env["intercept"])
        x0 = int(env["x0"])
        x1 = int(env["x1"])
        touches = int(F.count_touches(pivots, slope, intercept, atr, tol_atr=0.6))
        span = int(x1 - x0)
        if touches < 2 or span < 20:
            return None
        return {
            "kind": kind,
            "start_date": iso_ts(df.index[x0]),
            "start_price": float(F.line_value(slope, intercept, x0)),
            "end_date": iso_ts(df.index[x1]),
            "end_price": float(F.line_value(slope, intercept, x1)),
            "slope": slope,
            "touches": touches,
            "span_bars": span,
            "violations": int(env["viol"]),
        }
    except (KeyError, TypeError, ValueError, IndexError):
        return None


def detect_trendlines(df: pd.DataFrame | None) -> dict:
    """Detect standalone support (swing lows) and resistance (swing highs).

    Returns ``{"support": obj | None, "resistance": obj | None}``. Never
    raises on bad input: ``None``/empty/malformed frames yield both ``None``.
    """
    empty = {"support": None, "resistance": None}
    if df is None or getattr(df, "empty", True):
        return dict(empty)
    try:
        norm = F.normalize_ohlcv(df)
    except (ValueError, TypeError, KeyError, AttributeError):
        return dict(empty)
    if norm is None or norm.empty:
        return dict(empty)

    out: dict = {"support": None, "resistance": None}
    try:
        atr = float(F.atr_value(norm))
    except Exception:
        return dict(empty)
    tol = 0.25 * atr

    try:
        _, lows = get_swings(norm, {})
        env = F.envelope_line(norm, lows, "lower", tol)
        if env is not None:
            out["support"] = _build_side(norm, lows, env, "support", atr)
    except Exception:
        out["support"] = None

    try:
        highs, _ = get_swings(norm, {})
        env = F.envelope_line(norm, highs, "upper", tol)
        if env is not None:
            out["resistance"] = _build_side(norm, highs, env, "resistance", atr)
    except Exception:
        out["resistance"] = None

    return out

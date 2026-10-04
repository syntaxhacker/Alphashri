"""Standalone support/resistance trendline detection.

Thin wrapper over :mod:`chart_patterns.features` envelope geometry:
support is the lower boundary through swing lows, resistance the upper
boundary through swing highs. Side-effect-free; returns plain dicts.
"""

from __future__ import annotations

import pandas as pd

from chart_patterns import features as F
from chart_patterns.detectors.common import get_swings, iso_ts

#: Trailing window (in bars) used for trendline detection. The envelope fit
#: prefers the longest 0-violation line, so running it over the full history
#: latches onto stale lines (e.g. an old rising resistance on a long 1h
#: frame) instead of the recent line the price is currently respecting.
TRENDLINE_LOOKBACK_BARS = 400


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

    if len(norm) > TRENDLINE_LOOKBACK_BARS:
        norm = norm.iloc[-TRENDLINE_LOOKBACK_BARS:]

    out: dict = {"support": None, "resistance": None}
    try:
        atr = float(F.atr_value(norm))
    except Exception:
        return dict(empty)
    tol = 0.25 * atr

    # Swing strictness scales with frame size: wide swings on large frames (a
    # 1h frame has ~1700 bars and ~230 default pivots, making the
    # O(pivots^2 x span) envelope fit ~8s/side); small frames keep the
    # default order so sparse pivots still form lines. Single call — the
    # helper already returns BOTH highs and lows.
    order = 6 if len(norm) >= 500 else 2
    try:
        highs, lows = get_swings(norm, {}, order, order)
    except Exception:
        return dict(empty)

    try:
        env = F.envelope_line(norm, lows, "lower", tol)
        if env is not None:
            out["support"] = _build_side(norm, lows, env, "support", atr)
    except Exception:
        out["support"] = None

    try:
        env = F.envelope_line(norm, highs, "upper", tol)
        if env is not None:
            out["resistance"] = _build_side(norm, highs, env, "resistance", atr)
    except Exception:
        out["resistance"] = None

    return out

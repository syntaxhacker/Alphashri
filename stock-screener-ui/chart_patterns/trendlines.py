"""Standalone support/resistance trendline detection.

Thin wrapper over :mod:`chart_patterns.features` envelope geometry:
support is the lower boundary through swing lows, resistance the upper
boundary through swing highs. Side-effect-free; returns plain dicts.
"""

from __future__ import annotations

import pandas as pd

from chart_patterns import features as F
from chart_patterns import config as pattern_config
from chart_patterns.detectors.common import get_swings, iso_ts

#: Trailing window (in bars) used for trendline detection. The envelope fit
#: prefers the longest 0-violation line, so running it over the full history
#: latches onto stale lines (e.g. an old rising resistance on a long 1h
#: frame) instead of the recent line the price is currently respecting.
#: Re-exported from :mod:`chart_patterns.config` (env-overridable).
TRENDLINE_LOOKBACK_BARS = pattern_config.TRENDLINE_LOOKBACK_BARS


def _build_side(df: pd.DataFrame, pivots: list, env: dict, kind: str, atr: float) -> dict | None:
    """Serialise one envelope line, applying the touches/span guards."""
    try:
        slope = float(env["slope"])
        intercept = float(env["intercept"])
        x0 = int(env["x0"])
        x1 = int(env["x1"])
        touches = int(F.count_touches(pivots, slope, intercept, atr, tol_atr=pattern_config.TRENDLINE_TOUCH_TOL_ATR))
        span = int(x1 - x0)
        if touches < pattern_config.TRENDLINE_MIN_TOUCHES or span < pattern_config.TRENDLINE_MIN_SPAN:
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


def detect_trendlines(df: pd.DataFrame | None, lookback_bars: int | None = None) -> dict:
    """Detect standalone support (swing lows) and resistance (swing highs).

    ``lookback_bars`` caps the trailing window the detector runs over: a
    positive int slices the frame to its last ``lookback_bars`` bars (never
    enlarging a shorter frame); anything else falls back to
    ``config.TRENDLINE_LOOKBACK_BARS``.

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

    window = (
        lookback_bars
        if isinstance(lookback_bars, int) and lookback_bars > 0
        else pattern_config.TRENDLINE_LOOKBACK_BARS
    )
    if len(norm) > window:
        norm = norm.iloc[-window:]

    out: dict = {"support": None, "resistance": None}
    try:
        atr = float(F.atr_value(norm))
    except Exception:
        return dict(empty)
    tol = pattern_config.TRENDLINE_ENVELOPE_TOL_ATR * atr

    # Swing strictness scales with frame size: wide swings on large frames (a
    # 1h frame has ~1700 bars and ~230 default pivots, making the
    # O(pivots^2 x span) envelope fit ~8s/side); small frames keep the
    # default order so sparse pivots still form lines. Single call — the
    # helper already returns BOTH highs and lows.
    order = pattern_config.TRENDLINE_SWING_ORDER if len(norm) >= pattern_config.TRENDLINE_SWING_MIN_BARS else 2
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

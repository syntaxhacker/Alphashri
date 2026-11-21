"""Standalone support/resistance trendline detection.

Thin wrapper over :mod:`chart_patterns.features` primitives: swing pivots come
from :func:`F.pivot_indices` with NaN-tolerant fractal semantics, boundaries
from :func:`F.envelope_line`, and touch counts from :func:`F.count_touches`.
Support is the lower boundary through swing lows, resistance the upper
boundary through swing highs. Side-effect-free; returns plain dicts.

The detector is ``O(m^2 x span)`` in the pivot count ``m``; the shared envelope
scorer restricts each pair to its own ``[x0, x1]`` span and picks the first
pair with the minimal ``(viol, -span)`` key. The fast normalization path lets
already-clean scan frames skip coercion. None of this changes which line wins
relative to the reference implementation.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

from chart_patterns import features as F
from chart_patterns import config as pattern_config
from chart_patterns.detectors.common import iso_ts

#: Trailing window (in bars) used for trendline detection. The envelope fit
#: prefers the longest 0-violation line, so running it over the full history
#: latches onto stale lines (e.g. an old rising resistance on a long 1h
#: frame) instead of the recent line the price is currently respecting.
#: Re-exported from :mod:`chart_patterns.config` (env-overridable).
TRENDLINE_LOOKBACK_BARS = pattern_config.TRENDLINE_LOOKBACK_BARS


def _fast_normalize(df: pd.DataFrame) -> pd.DataFrame | None:
    """Return ``df`` narrowed to OHLCV floats when no coercion is needed.

    The full :func:`F.normalize_ohlcv` is idempotent for frames that already
    have lowercase unique OHLCV columns, numeric dtypes, a unique monotonic
    index and no NaNs. In that common case (cached scan data) skip the
    ``apply(pd.to_numeric)``, dedupe, sort and dropna passes entirely.
    Returns ``None`` when any step would not be a no-op, so the caller falls
    back to the full (defensive) path with identical results.
    """
    try:
        cols = [str(c).lower() for c in df.columns]
        if len(cols) != len(set(cols)) or not set(F.OHLCV_COLUMNS) <= set(cols):
            return None
        frame = df
        if cols != [str(c) for c in df.columns]:
            frame = df.copy()
            frame.columns = cols
        for col in F.OHLCV_COLUMNS:
            if not pd.api.types.is_numeric_dtype(frame[col]):
                return None
        idx = frame.index
        if not (idx.is_unique and idx.is_monotonic_increasing):
            return None
        block = frame[F.OHLCV_COLUMNS]
        # One numeric pass in place of pandas' isna().any().any(); a NaN must
        # still fall through so the defensive path decides the row layout.
        if np.isnan(block.to_numpy(dtype=float, copy=False)).any():
            return None
        # astype's copy keyword is deprecated in pandas 4; an all-float64 block
        # needs no cast and the detector only reads it, so keep the no-copy path.
        if block.dtypes.eq("float64").all():
            return block
        return block.astype(float)
    except Exception:
        return None


def window_signature(df: pd.DataFrame | None, lookback_bars: int | None = None) -> str | None:
    """Signature of the exact trailing window :func:`detect_trendlines` reads.

    The returned geometry depends only on that window (its length and OHLCV
    bytes), not on the rest of the frame, so two frames with the same
    signature produce the same lines. The length is embedded in the string so a
    reader can reproduce the identical slice without knowing the scan's
    ``lookback_bars``.

    A trailing in-progress daily bar is dropped: it never exists on the read
    path (``include_partial_today=False``) and the lines are a
    completed-session read. Returns ``None`` when the frame cannot be
    fingerprinted (callers must then recompute, never reuse).
    """
    if df is None or getattr(df, "empty", True):
        return None
    if (getattr(df, "attrs", {}) or {}).get("partial_today") and len(df) > 1:
        df = df.iloc[:-1]
    try:
        window = _trendline_window(df, lookback_bars)
        if window is None or window.empty:
            return None
        h = hashlib.sha1()
        # _trendline_window always returns OHLCV columns in contract order,
        # so re-selecting them would only allocate a duplicate block.
        h.update(window.to_numpy(dtype=float).tobytes())
        h.update(np.asarray(window.index.asi8, dtype=np.int64).tobytes())
        return f"{len(window)}:{h.hexdigest()[:16]}"
    except Exception:
        return None


def window_matches(signature: str | None, df: pd.DataFrame | None) -> bool:
    """True when ``signature`` was computed from the window ``df`` ends with.

    Uses the length embedded in the signature, so the scan's own
    ``lookback_bars`` never has to travel with the stored lines.
    """
    if not signature or not isinstance(signature, str):
        return False
    try:
        length = int(signature.split(":", 1)[0])
    except (TypeError, ValueError):
        return False
    return window_signature(df, length) == signature


def _trendline_window(df: pd.DataFrame | None, lookback_bars: int | None):
    """Normalized frame sliced exactly as :func:`detect_trendlines` slices it."""
    if df is None or getattr(df, "empty", True):
        return None
    try:
        norm = _fast_normalize(df)
        if norm is None:
            norm = F.normalize_ohlcv(df)
    except (ValueError, TypeError, KeyError, AttributeError):
        return None
    if norm is None or norm.empty:
        return None
    window = (
        lookback_bars
        if isinstance(lookback_bars, int) and lookback_bars > 0
        else pattern_config.TRENDLINE_LOOKBACK_BARS
    )
    if len(norm) > window:
        norm = norm.iloc[-window:]
    return norm


def _build_side(df: pd.DataFrame, pivots: list, env: dict, kind: str, atr: float) -> dict | None:
    """Serialise one envelope line, applying the touches/span guards."""
    try:
        slope = float(env["slope"])
        intercept = float(env["intercept"])
        x0 = int(env["x0"])
        x1 = int(env["x1"])
        touches = F.count_touches(
            pivots, slope, intercept, atr,
            tol_atr=pattern_config.TRENDLINE_TOUCH_TOL_ATR,
        )
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
    norm = _trendline_window(df, lookback_bars)
    if norm is None or norm.empty:
        return dict(empty)

    out: dict = {"support": None, "resistance": None}
    try:
        atr = float(F.atr_value(norm))
    except Exception:
        return dict(empty)
    tol = pattern_config.TRENDLINE_ENVELOPE_TOL_ATR * atr

    # Swing strictness scales with frame size: wide swings on large frames (a
    # 1h frame has ~1700 bars and ~230 default pivots, making the envelope fit
    # costly); small frames keep the default order so sparse pivots still form
    # lines. Both sides use the shared NaN-tolerant fractal scan.
    order = pattern_config.TRENDLINE_SWING_ORDER if len(norm) >= pattern_config.TRENDLINE_SWING_MIN_BARS else 2
    high = norm["high"].to_numpy(dtype=float)
    low = norm["low"].to_numpy(dtype=float)
    try:
        hi_pos = F.pivot_indices(high, order, order, "high", nan_tolerant=True)
        lo_pos = F.pivot_indices(low, order, order, "low", nan_tolerant=True)
        highs = list(zip(hi_pos, high[hi_pos].tolist()))
        lows = list(zip(lo_pos, low[lo_pos].tolist()))
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

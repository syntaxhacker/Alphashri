"""Standalone support/resistance trendline detection.

Thin wrapper over :mod:`chart_patterns.features` envelope geometry:
support is the lower boundary through swing lows, resistance the upper
boundary through swing highs. Side-effect-free; returns plain dicts.

Performance notes
-----------------
The detector is ``O(m^2 x span)`` in the pivot count ``m``: every pivot pair
defines a candidate boundary line and every bar between its endpoints is a
potential violation. The previous implementation evaluated each pair over the
*full* frame grid and counted violations with NumPy per chunk; this keeps the
exact winner selection (fewest violations, then longest span, first-in-pair
order on ties) but

* restricts each pair's cell grid to its own ``[x0, x1]`` span instead of the
  whole frame (typically ~3x fewer cells),
* counts violations with a single ``np.bincount`` over all pairs instead of
  per-chunk reductions, and drops the per-row ``worst`` pierce computation
  (needed only for the winner, recomputed once),
* finds swing pivots with a vectorised sliding-window scan instead of a
  Python loop per bar, and
* takes a fast normalization path when the frame already meets the feature
  contract (the common scan path).

None of this changes which line wins: pair order, the ``(viol, -span)`` key
and strict-``<`` improvement are identical to the reference implementation,
so returned lines are bit-for-bit equivalent.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from chart_patterns import features as F
from chart_patterns import config as pattern_config
from chart_patterns.detectors.common import iso_ts

#: Trailing window (in bars) used for trendline detection. The envelope fit
#: prefers the longest 0-violation line, so running it over the full history
#: latches onto stale lines (e.g. an old rising resistance on a long 1h
#: frame) instead of the recent line the price is currently respecting.
#: Re-exported from :mod:`chart_patterns.config` (env-overridable).
TRENDLINE_LOOKBACK_BARS = pattern_config.TRENDLINE_LOOKBACK_BARS

#: Cell budget per block when scoring pivot pairs in :func:`_envelope_line`.
#: Keeps peak memory bounded on pivot-dense frames; blocks are processed in
#: pair order so the global winner selection is unchanged.
_ENVELOPE_CELL_CAP = 2_000_000


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
        if block.isna().any().any():
            return None
        return block.astype(float)
    except Exception:
        return None


def _swing_pivots(values: np.ndarray, order: int, kind: str) -> list[tuple[int, float]]:
    """Vectorised fractal scan equivalent to ``features.find_swing_highs/lows``.

    Keeps position ``i`` iff ``values[i]`` is the extremum of
    ``[i-order, i+order]`` *and* strictly beats at least one immediate
    neighbour (rejects all-flat windows). NaN handling mirrors the scalar
    reference exactly: a NaN anywhere in the window does not by itself
    disqualify the centre, and comparisons with NaN neighbours are false.
    """
    n = len(values)
    need = 2 * order + 1
    if n < need:
        return []
    win = sliding_window_view(values, need)
    centre = values[order:n - order]
    prev = values[order - 1:n - order - 1]
    nxt = values[order + 1:n - order + 1]
    has_nan = np.any(np.isnan(win), axis=1)
    if kind == "high":
        cond1 = has_nan | (centre >= np.max(win, axis=1))
        cond2 = (centre > prev) | (centre > nxt)
    else:
        cond1 = has_nan | (centre <= np.min(win, axis=1))
        cond2 = (centre < prev) | (centre < nxt)
    pos = np.nonzero(cond1 & cond2)[0] + order
    return [(int(p), float(values[p])) for p in pos]


def _envelope_line(
    boundary: np.ndarray,
    xs: np.ndarray,
    qs: np.ndarray,
    tol: float,
    side: str,
) -> dict | None:
    """Best straight boundary through pivots staying outside candles.

    Exact equivalent of :func:`features.envelope_line`: every pivot pair
    ``(i, j)`` scores ``(violations, -span)`` over bars ``[x0, x1]``, pairs
    are processed in ``(i, j)`` order and the first pair achieving the
    running minimum wins (strict ``<`` improvement). Cells are limited to
    each pair's own span and violations are counted with one
    ``np.bincount`` pass over all pairs instead of per-chunk reductions.
    Returns an envelope dict (``slope, intercept, x0, q0, x1, q1, viol,
    worst``) or ``None`` when fewer than two pivots exist.
    """
    m = len(xs)
    if m < 2:
        return None
    xs = np.asarray(xs, dtype=np.float64)
    qs = np.asarray(qs, dtype=np.float64)
    boundary = np.asarray(boundary, dtype=np.float64)
    n = len(boundary)
    ii, jj = np.triu_indices(m, 1)          # pair order: i ascending, then j
    X0 = xs[ii]
    X1 = xs[jj]
    Q0 = qs[ii]
    Q1 = qs[jj]
    span = X1 - X0                          # > 0: pivot positions are unique
    slopes = (Q1 - Q0) / span
    counts = span.astype(np.int64) + 1      # bars in [x0, x1], inclusive
    num_pairs = len(X0)
    best_key = None
    best = -1
    viol = np.zeros(num_pairs, dtype=np.int64)
    blk_pairs = max(1, _ENVELOPE_CELL_CAP // max(n, 1))
    for p0 in range(0, num_pairs, blk_pairs):
        p1 = min(p0 + blk_pairs, num_pairs)
        sl = slice(p0, p1)
        b_counts = counts[sl]
        b_total = int(b_counts.sum())
        P = np.repeat(np.arange(p0, p1), b_counts)
        cell_idx = np.arange(b_total)
        starts = np.cumsum(b_counts) - b_counts
        K = (X0[P] + (cell_idx - np.repeat(starts, b_counts))).astype(np.int64)
        Kf = K.astype(np.float64)
        y = Q0[P] + slopes[P] * (Kf - X0[P])
        if side == "upper":
            d = boundary[K] - y             # violation: price pierces above the line
        else:
            d = y - boundary[K]             # violation: price pierces below the line
        over = d > tol
        viol[sl] = np.bincount(P, weights=over.astype(np.uint8), minlength=p1 - p0).astype(np.int64)
        for k in range(p0, p1):
            key = (int(viol[k]), -int(span[k]))
            if best_key is None or key < best_key:
                best_key = key
                best = k
    if best < 0:
        return None
    # Winner's cells are contiguous ([starts, starts+count)) so its worst
    # pierce depth is one small vectorised reduction instead of per-row work.
    x0b = int(X0[best]); x1b = int(X1[best])
    Kb = np.arange(x0b, x1b + 1, dtype=np.int64)
    Kbf = Kb.astype(np.float64)
    yb = float(Q0[best]) + float(slopes[best]) * (Kbf - X0[best])
    if side == "upper":
        db = boundary[Kb] - yb
    else:
        db = yb - boundary[Kb]
    overb = db > tol
    worst = float(db[overb].max()) if bool(overb.any()) else 0.0
    slope = float(slopes[best])
    return {
        "slope": slope,
        "intercept": float(Q0[best]) - slope * x0b,
        "x0": x0b,
        "q0": float(Q0[best]),
        "x1": x1b,
        "q1": float(Q1[best]),
        "viol": int(viol[best]),
        "worst": worst,
    }


def _build_side(df: pd.DataFrame, pivots: list, env: dict, kind: str, atr: float) -> dict | None:
    """Serialise one envelope line, applying the touches/span guards."""
    try:
        slope = float(env["slope"])
        intercept = float(env["intercept"])
        x0 = int(env["x0"])
        x1 = int(env["x1"])
        # Vectorised touch count: identical elementwise ops to the scalar
        # reference (abs(price - (slope*pos + intercept)) <= tol_atr * atr).
        xs = np.array([p for p, _ in pivots], dtype=float)
        qs = np.array([q for _, q in pivots], dtype=float)
        # count_touches returns 0 when atr <= 0: replicate that guard exactly.
        if atr <= 0:
            touches = 0
        else:
            touches = int(
                np.count_nonzero(
                    np.abs(qs - (slope * xs + intercept))
                    <= pattern_config.TRENDLINE_TOUCH_TOL_ATR * atr
                )
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
    if df is None or getattr(df, "empty", True):
        return dict(empty)
    try:
        norm = _fast_normalize(df)
        if norm is None:
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
    # 1h frame has ~1700 bars and ~230 default pivots, making the envelope fit
    # costly); small frames keep the default order so sparse pivots still form
    # lines. Pivots for both sides come from one pass over the frame.
    order = pattern_config.TRENDLINE_SWING_ORDER if len(norm) >= pattern_config.TRENDLINE_SWING_MIN_BARS else 2
    high = norm["high"].to_numpy(dtype=float)
    low = norm["low"].to_numpy(dtype=float)
    try:
        highs = _swing_pivots(high, order, "high")
        lows = _swing_pivots(low, order, "low")
    except Exception:
        return dict(empty)

    try:
        env = _envelope_line(low, [p for p, _ in lows], [q for _, q in lows], tol, "lower")
        if env is not None:
            out["support"] = _build_side(norm, lows, env, "support", atr)
    except Exception:
        out["support"] = None

    try:
        env = _envelope_line(high, [p for p, _ in highs], [q for _, q in highs], tol, "upper")
        if env is not None:
            out["resistance"] = _build_side(norm, highs, env, "resistance", atr)
    except Exception:
        out["resistance"] = None

    return out

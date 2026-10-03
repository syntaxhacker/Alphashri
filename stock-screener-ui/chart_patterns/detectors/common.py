"""Shared detector primitives: :class:`PatternHit`, level math and registry.

Detectors live in sibling modules (``reversal``, ``continuation``, ``curve_cup``)
and register themselves into :data:`DETECTORS` via :func:`register`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from .. import features as F

# --- tunables (CONTRACT §2) -------------------------------------------------
PROXIMITY_PCT = 2.0  # % distance to breakout line treated as "forming"
VOLUME_MULT = 1.2  # end swing volume vs mean(prior 20)
ATR_STOP_K = 1.5  # stop is never wider than k * ATR(14)


@dataclass
class PatternHit:
    """One detected pattern occurrence (CONTRACT §2).

    ``symbol``/``timeframe`` are filled by the engine; detectors leave them
    blank. They are trailer fields so the frozen field order above is intact.
    """

    pattern_id: str
    pattern_name: str
    family: str
    direction: str
    status: str
    quality: str
    confidence: float
    start_date: str
    end_date: str
    start_price: float
    end_price: float
    breakout_level: float
    target: float
    stop: float
    rr: float
    bars_ago: int
    volume_confirmed: bool
    trendlines: list[list[dict]] = field(default_factory=list)
    notes: str = ""
    symbol: str = ""
    timeframe: str = ""
    # Swing points used to define the pattern, for on-chart markers + manual audit.
    pivots: list[dict] = field(default_factory=list)
    # Consolidation-base metrics (only set by the ``consolidation`` detector).
    # Trailer fields so the frozen ``PatternHit`` field order above is intact.
    base_days: int = 0
    range_pct: float = 0.0
    range_pos: float = 0.0


# pattern_id -> (display name, family, direction)
PATTERN_CATALOG: dict[str, tuple[str, str, str]] = {
    "falling_wedge": ("Falling Wedge", "reversal", "bullish"),
    "rising_wedge": ("Rising Wedge", "reversal", "bearish"),
    "diamond_bottom": ("Diamond Bottom", "reversal", "bullish"),
    "triple_bottom": ("Triple Bottom", "reversal", "bullish"),
    "double_bottom": ("Double Bottom", "reversal", "bullish"),
    "head_shoulders": ("Head & Shoulders", "reversal", "bearish"),
    "inverse_head_shoulders": ("Inverse H&S", "reversal", "bullish"),
    "rounding_bottom": ("Rounding Bottom", "reversal", "bullish"),
    "ascending_channel": ("Ascending Channel", "continuation", "bullish"),
    "descending_channel": ("Descending Channel", "continuation", "bearish"),
    "bull_flag": ("Bull Flag", "continuation", "bullish"),
    "bear_flag": ("Bear Flag", "continuation", "bearish"),
    "pennant": ("Pennant", "continuation", "bullish"),
    "rectangle": ("Rectangle", "continuation", "neutral"),
    "ascending_triangle": ("Ascending Triangle", "continuation", "bullish"),
    "descending_triangle": ("Descending Triangle", "continuation", "bearish"),
    "curve_bearish": ("Curve Pattern (Bearish)", "curve_cup", "bearish"),
    "cup_handle": ("Cup & Handle", "curve_cup", "bullish"),
    "consolidation": ("Consolidation", "continuation", "neutral"),
}

# pattern_id -> detect(df, ctx) -> list[PatternHit]
DETECTORS: list[tuple[str, Callable]] = []


def register(pattern_id: str, fn: Callable) -> None:
    """Register ``fn`` for ``pattern_id`` (idempotent)."""
    for i, (pid, _) in enumerate(DETECTORS):
        if pid == pattern_id:
            DETECTORS[i] = (pattern_id, fn)
            return
    DETECTORS.append((pattern_id, fn))


# ---------------------------------------------------------------------------
# Date / line serialisation
# ---------------------------------------------------------------------------


def fmt_date(ts) -> str:
    """Human-readable index timestamp (kept short for display fields)."""
    try:
        if ts.hour == 0 and ts.minute == 0 and ts.second == 0:
            return ts.strftime("%Y-%m-%d")
        return ts.strftime("%Y-%m-%d %H:%M")
    except AttributeError:
        return str(ts)


def iso_ts(ts) -> str:
    """Full ISO timestamp matching ``candles.candles_to_series`` exactly.

    Chart overlays are matched to candles by timestamp, so overlay points must
    use the *same* format as the candle series (``idx.isoformat()``), otherwise
    intraday points would collapse onto the first candle of the day.
    """
    try:
        return ts.isoformat()
    except AttributeError:
        return str(ts)


def line_points(
    df: pd.DataFrame, slope: float, intercept: float, start: int, end: int
) -> list[dict]:
    """Two-point serialisation of a fitted trendline (start/end of pattern)."""
    return [
        {"t": iso_ts(df.index[start]), "price": round(F.line_value(slope, intercept, start), 4)},
        {"t": iso_ts(df.index[end]), "price": round(F.line_value(slope, intercept, end), 4)},
    ]


def pivot_line_points(
    df: pd.DataFrame,
    slope: float,
    intercept: float,
    pivots: list[tuple[int, float]],
    start: int | None = None,
    end: int | None = None,
) -> list[dict]:
    """Trendline drawn **through the pivot points** (first → last pivot of the set).

    Uses the pivots' real ``(position, price)`` so the boundary actually touches
    the swing highs/lows at both ends, instead of a regression line that floats
    off them. Falls back to the fitted line when fewer than two pivots exist.
    """
    ordered = sorted(pivots, key=lambda t: t[0]) if pivots else []
    if len(ordered) >= 2:
        (x0, q0), (x1, q1) = ordered[0], ordered[-1]
        return [
            {"t": iso_ts(df.index[int(x0)]), "price": round(float(q0), 4)},
            {"t": iso_ts(df.index[int(x1)]), "price": round(float(q1), 4)},
        ]
    if ordered:
        x0 = int(ordered[0][0])
        return [
            {"t": iso_ts(df.index[x0]), "price": round(float(ordered[0][1]), 4)},
            {"t": iso_ts(df.index[int(end if end is not None else len(df) - 1)]), "price": round(float(ordered[0][1]), 4)},
        ]
    xa = int(start if start is not None else 0)
    xb = int(end if end is not None else len(df) - 1)
    return [
        {"t": iso_ts(df.index[xa]), "price": round(F.line_value(slope, intercept, xa), 4)},
        {"t": iso_ts(df.index[xb]), "price": round(F.line_value(slope, intercept, xb), 4)},
    ]


def chord_value(pivots: list[tuple[int, float]], x: float) -> float | None:
    """Value at ``x`` of the straight line through the first and last pivot.

    This is the *same* line ``pivot_line_points`` draws, so breakout / target /
    stop levels stay consistent with the visual boundary (rather than coming from
    a separate regression fit).
    """
    ordered = sorted(pivots, key=lambda t: t[0]) if pivots else []
    if len(ordered) < 2:
        return None
    (x0, q0), (x1, q1) = ordered[0], ordered[-1]
    if x1 == x0:
        return float(q0)
    slope = (q1 - q0) / (x1 - x0)
    return float(q0 + slope * (x - x0))


def envelope_pair(
    df: pd.DataFrame,
    highs: list[tuple[int, float]],
    lows: list[tuple[int, float]],
    atr_val: float,
    tol_mult: float = 0.25,
):
    """``(upper_env, lower_env)`` bounding lines through the highs/lows pivots."""
    tol = tol_mult * atr_val
    return (
        F.envelope_line(df, highs, "upper", tol),
        F.envelope_line(df, lows, "lower", tol),
    )


def segment_points(df: pd.DataFrame, x0: int, q0: float, x1: int, q1: float) -> list[dict]:
    """Two-point line from explicit endpoint coordinates (pivot-anchored)."""
    return [
        {"t": iso_ts(df.index[int(x0)]), "price": round(float(q0), 4)},
        {"t": iso_ts(df.index[int(x1)]), "price": round(float(q1), 4)},
    ]


def pivot_markers(
    df: pd.DataFrame,
    highs: list[tuple[int, float]],
    lows: list[tuple[int, float]],
    x0: int | None = None,
    x1: int | None = None,
    limit: int = 80,
) -> list[dict]:
    """Swing pivots within ``[x0, x1]`` as ``{t, price, kind}`` markers.

    Powers the on-chart pivot dots and the manual-audit list in the detail pane.
    """
    out: list[dict] = []
    for kind, pivots in (("high", highs), ("low", lows)):
        for p, q in pivots:
            if x0 is not None and p < x0:
                continue
            if x1 is not None and p > x1:
                continue
            out.append({"t": iso_ts(df.index[int(p)]), "price": round(float(q), 4), "kind": kind})
    out.sort(key=lambda d: d["t"])
    return out[:limit]


def flat_line_points(df: pd.DataFrame, price: float, start: int, end: int) -> list[dict]:
    """Horizontal guide (neckline / range edge) across two positions."""
    p = round(float(price), 4)
    return [
        {"t": iso_ts(df.index[int(start)]), "price": p},
        {"t": iso_ts(df.index[int(end)]), "price": p},
    ]


def curve_points(df: pd.DataFrame, start: int, fitted) -> list[dict]:
    """Serialise a fitted curve (relative positions) as a polyline overlay."""
    return [
        {"t": iso_ts(df.index[start + i]), "price": round(float(y), 4)}
        for i, y in enumerate(fitted)
    ]


# ---------------------------------------------------------------------------
# Swing cache
# ---------------------------------------------------------------------------


def get_swings(
    df: pd.DataFrame, ctx: dict | None = None, left: int = 2, right: int = 2
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Cached ``(high_pivots, low_pivots)`` as position-ordered price tuples."""
    key = (left, right)
    if ctx is not None:
        cache = ctx.setdefault("_swings", {})
        if key in cache:
            return cache[key]
    highs = [(i, float(df["high"].iloc[i])) for i in F.find_swing_highs(df["high"], left, right)]
    lows = [(i, float(df["low"].iloc[i])) for i in F.find_swing_lows(df["low"], left, right)]
    result = (highs, lows)
    if ctx is not None:
        ctx["_swings"][key] = result
    return result


def window_bounds(df: pd.DataFrame, lookback: int) -> tuple[int, int]:
    """Inclusive ``(start, end)`` of the trailing detection window."""
    n = len(df)
    if n == 0:
        return 0, 0
    start = max(0, n - max(1, int(lookback)))
    return start, n - 1


def window_slice(
    df: pd.DataFrame, lookback: int, min_bars: int
) -> tuple[int, int] | None:
    """Trailing window that has at least ``min_bars`` bars, else ``None``."""
    start, end = window_bounds(df, lookback)
    if end - start + 1 < min_bars:
        return None
    return start, end


def mean_price(df: pd.DataFrame, start: int, end: int) -> float:
    """Mean close over the inclusive window (price normaliser for slopes)."""
    return float(df["close"].iloc[start : end + 1].astype(float).mean())


def line_width(su: float, iu: float, sl: float, il: float, x: float) -> float:
    """Vertical separation ``upper(x) - lower(x)`` of two lines."""
    return F.line_value(su, iu, x) - F.line_value(sl, il, x)


def cross_x(su: float, iu: float, sl: float, il: float) -> float:
    """Bar position where two lines intersect (``inf`` when parallel)."""
    denom = su - sl
    if abs(denom) < 1e-12:
        return float("inf")
    return (il - iu) / denom


def fit_window_pair(
    df: pd.DataFrame,
    ctx: dict,
    start: int,
    max_pivots: int | None = 5,
) -> tuple[
    list[tuple[int, float]],
    list[tuple[int, float]],
    tuple[float, float, float],
    tuple[float, float, float],
] | None:
    """Fit swing-high and swing-low lines to the trailing pivots in window.

    ``max_pivots`` limits the fit to the most recent N pivots on each side
    (default 5, tuned for wedges/flags). Pass ``None`` to fit *all* pivots in the
    window, which channels / rectangles / triangles need to capture the full
    structure rather than a recent local leg.

    Returns ``(highs, lows, upper_fit, lower_fit)`` or ``None`` when there are
    fewer than two pivots of either kind.
    """
    highs, lows = get_swings(df, ctx)
    H = [(p, q) for p, q in highs if p >= start]
    L = [(p, q) for p, q in lows if p >= start]
    if len(H) < 2 or len(L) < 2:
        return None
    Hf = F.last_n(H, max_pivots) if max_pivots else H
    Lf = F.last_n(L, max_pivots) if max_pivots else L
    upper = F.fit_pivot_line(Hf)
    lower = F.fit_pivot_line(Lf)
    if upper is None or lower is None:
        return None
    return H, L, upper, lower


def pattern_end(
    H: list[tuple[int, float]],
    L: list[tuple[int, float]],
    end: int,
    pad: int = 2,
) -> int:
    """Effective pattern end: no further right than the last pivot used.

    Trendlines fitted through pivots must not be extrapolated far past their
    final touch, otherwise a breakout leg that ran away from the pattern makes
    the line (and therefore the computed breakout level) meaningless. We cap the
    evaluation x at ``min(end, last_pivot + pad)`` across both lines.
    """
    candidates = [int(end)]
    for piv in (H, L):
        if piv:
            candidates.append(int(piv[-1][0]) + int(pad))
    return max(0, min(candidates))


# ---------------------------------------------------------------------------
# Level math
# ---------------------------------------------------------------------------


def compute_levels(
    direction: str,
    breakout_level: float,
    pattern_height: float,
    opposite_extreme: float,
    atr_val: float,
    k: float = ATR_STOP_K,
) -> tuple[float, float, float]:
    """Measured-move target, ATR-capped stop and reward:risk.

    * target = breakout +/- pattern height (measured move),
    * stop = opposite pattern extreme, capped so its distance from entry never
      exceeds ``k * ATR``,
    * rr = reward / risk (0.0 when risk is non-positive).

    For ``neutral`` the breakout is treated as the upper edge (long geometry).
    """
    entry = float(breakout_level)
    height = max(float(pattern_height), 0.0)
    k = max(float(k), 0.0)
    cap = k * max(float(atr_val), 0.0)

    if direction == "bearish":
        target = entry - height
        raw_stop = float(opposite_extreme)
        stop = min(raw_stop, entry + cap) if cap > 0 else raw_stop
        risk = stop - entry
        reward = entry - target
    else:  # bullish / neutral
        target = entry + height
        raw_stop = float(opposite_extreme)
        stop = max(raw_stop, entry - cap) if cap > 0 else raw_stop
        risk = entry - stop
        reward = target - entry

    if risk <= 0 or reward <= 0:
        return float(target), float(stop), 0.0
    return float(target), float(stop), float(reward / risk)


def classify_status(
    df: pd.DataFrame,
    breakout_level: float,
    direction: str,
    end_pos: int,
    tol: float = PROXIMITY_PCT,
) -> str:
    """``confirmed | forming | failed`` per CONTRACT §2.

    ``failed`` requires a prior close beyond the line that has since crossed
    back. ``marginal`` is applied later from the quality score.
    """
    if df is None or df.empty:
        return "forming"
    last = float(df["close"].iloc[-1])
    line = float(breakout_level)
    if line <= 0:
        return "forming"

    if direction == "bearish":
        crossed = last < line
        distance = (line - last) / line * 100.0
        prior = df["close"].iloc[int(end_pos) : -1]
        returned = bool((prior < line).any()) if len(prior) else False
    else:  # bullish / neutral
        crossed = last > line
        distance = (last - line) / line * 100.0
        prior = df["close"].iloc[int(end_pos) : -1]
        returned = bool((prior > line).any()) if len(prior) else False

    if crossed:
        return "confirmed"
    if returned:
        return "failed"
    if distance >= -tol:
        return "forming"
    return "forming"


# ---------------------------------------------------------------------------
# Quality / confidence
# ---------------------------------------------------------------------------


def quality_from_score(score: float) -> str:
    if score >= 80:
        return "textbook"
    if score >= 65:
        return "strong"
    if score >= 45:
        return "fair"
    return "marginal"


def score_quality(
    touches: int,
    r2: float,
    volume_confirmed: bool,
    bonus: float = 0.0,
) -> tuple[str, float]:
    """Map touches + trendline R² + volume into ``(quality, confidence)``.

    Weights: touches 40, R² 35, volume 15, base geometry 10. Confidence is the
    same 0..100 score.
    """
    score = 0.0
    score += 40.0 * min(max(int(touches), 0), 4) / 4.0
    score += 35.0 * min(max(float(r2), 0.0), 1.0)
    score += 15.0 if volume_confirmed else 0.0
    score += 10.0
    score += max(0.0, float(bonus))
    score = float(max(0.0, min(100.0, score)))
    return quality_from_score(score), score


# ---------------------------------------------------------------------------
# Hit construction
# ---------------------------------------------------------------------------


def make_hit(
    pattern_id: str,
    df: pd.DataFrame,
    *,
    start_pos: int,
    end_pos: int,
    breakout_level: float,
    opposite_extreme: float,
    pattern_height: float,
    touches: int,
    r2: float,
    trendlines: list[list[dict]] | None = None,
    notes: str = "",
    pivots: list[dict] | None = None,
    volume_confirmed: bool | None = None,
    quality_bonus: float = 0.0,
    direction: str | None = None,
    status: str | None = None,
    base_days: int | None = None,
    range_pct: float | None = None,
    range_pos: float | None = None,
) -> PatternHit:
    """Assemble a fully-computed :class:`PatternHit`."""
    name, family, catalog_direction = PATTERN_CATALOG[pattern_id]
    direction = direction or catalog_direction

    # Consolidation trailer metrics default to 0 for every non-consolidation hit.
    try:
        base_days = int(base_days) if base_days is not None else 0
    except (TypeError, ValueError):
        base_days = 0
    try:
        range_pct = float(range_pct) if range_pct is not None else 0.0
    except (TypeError, ValueError):
        range_pct = 0.0
    try:
        range_pos = float(range_pos) if range_pos is not None else 0.0
    except (TypeError, ValueError):
        range_pos = 0.0

    if volume_confirmed is None:
        volume_confirmed = F.is_volume_confirmed(df, int(end_pos), mult=VOLUME_MULT)

    atr_val = F.atr_value(df)
    target, stop, rr = compute_levels(
        direction, breakout_level, pattern_height, opposite_extreme, atr_val
    )
    if status is None:
        status = classify_status(df, breakout_level, direction, int(end_pos))

    quality, confidence = score_quality(touches, r2, volume_confirmed, quality_bonus)
    if quality == "marginal" and status == "forming":
        status = "marginal"

    start_pos = int(max(0, min(start_pos, len(df) - 1)))
    end_pos = int(max(0, min(end_pos, len(df) - 1)))
    close = df["close"].astype(float)

    return PatternHit(
        pattern_id=pattern_id,
        pattern_name=name,
        family=family,
        direction=direction,
        status=status,
        quality=quality,
        confidence=round(float(confidence), 1),
        start_date=fmt_date(df.index[start_pos]),
        end_date=fmt_date(df.index[end_pos]),
        start_price=round(float(close.iloc[start_pos]), 4),
        end_price=round(float(close.iloc[end_pos]), 4),
        breakout_level=round(float(breakout_level), 4),
        target=round(float(target), 4),
        stop=round(float(stop), 4),
        rr=round(float(rr), 3),
        bars_ago=int(len(df) - 1 - end_pos),
        volume_confirmed=bool(volume_confirmed),
        trendlines=trendlines or [],
        notes=notes,
        pivots=pivots or [],
        base_days=int(base_days),
        range_pct=round(float(range_pct), 3),
        range_pos=round(float(range_pos), 3),
    )

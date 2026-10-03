"""Reversal pattern detectors.

Each detector is a pure ``detect(df, ctx) -> list[PatternHit]`` function over a
normalised OHLCV frame. Pivots and trendlines are price based; every docstring
states the geometry and the math used.

Boundary contract (shared by every detector here): a drawn line must be a true
support/resistance envelope. The upper boundary sits at/above every candle high
between its endpoints, the lower boundary at/below every candle low, and
``breakout_level`` is the value of the *same drawn* boundary at the pattern end.
``_bound`` performs the final (parallel) intercept shift that guarantees this
after the best pivot pair has been selected by ``features.envelope_line``.

Draw-vs-detect split: the *detection* geometry (convergence, R², tolerance) is
evaluated on the common overlap of the two envelopes so the accepted pattern is
unchanged. The *drawing* then keeps each boundary anchored to its own real
extreme pivot (so the resistance/support lines start on an actual candle high /
low instead of floating off the recent overlap) and extends the pattern's
``end_pos`` to the bar that breaks the boundary. Every hit carries the swing
``pivots`` inside its drawn span so the UI can mark them and list datetimes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .. import features as F
from .common import (
    curve_points,
    fit_window_pair,
    flat_line_points,
    iso_ts,
    make_hit,
    mean_price as mean_price_fn,
    pivot_markers,
    register,
    segment_points,
    get_swings,
    window_slice,
)

LOOKBACK = 150
MIN_SPAN = 15
MIN_R2 = 0.45
CONVERGE = 0.80  # end width must be < 80% of start width

# Wedges are the only reversal pattern that benefits from scanning further back:
# a falling wedge on a daily chart can span many months, so a short trailing
# window clips the true resistance anchor and starts the boundary mid-air.
WEDGE_WINDOWS = (90, 150, 200)


# ---------------------------------------------------------------------------
# small local helpers
# ---------------------------------------------------------------------------


def _window(df: pd.DataFrame, lookback: int = LOOKBACK, min_bars: int = 30):
    return window_slice(df, lookback, min_bars)


def _fit_pair(df, ctx, start):
    # Wedges span the full detection window, so fit all window pivots (not just
    # the most recent few) — otherwise the drawn boundaries cover only a recent
    # sub-segment and do not reach the pattern's start.
    return fit_window_pair(df, ctx, start, max_pivots=None)


def _bound(
    df: pd.DataFrame, slope: float, intercept: float, x0: int, x1: int, side: str
) -> tuple[float, float]:
    """Shift a line's intercept so it bounds every candle within ``[x0, x1]``.

    The slope is preserved and the line is translated by the smallest amount
    needed, so an upper line ends up at/above every high and a lower line at/below
    every low. This keeps the drawn boundary from cutting through candles.
    """
    x0 = int(x0)
    x1 = int(x1)
    if x1 < x0:
        return float(slope), float(intercept)
    # Serialised overlay prices are rounded to 4 decimals (``segment_points``);
    # a constant margin keeps the drawn (reconstructed) line a true envelope.
    margin = 1e-4
    xs = np.arange(x0, x1 + 1, dtype=float)
    line = slope * xs + intercept
    if side == "upper":
        delta = float(np.max(df["high"].to_numpy(dtype=float)[x0 : x1 + 1] - line))
        intercept += max(delta, 0.0) + margin
    else:
        delta = float(np.max(line - df["low"].to_numpy(dtype=float)[x0 : x1 + 1]))
        intercept -= max(delta, 0.0) + margin
    return float(slope), float(intercept)


def _r2_of(pivots: list[tuple[int, float]]) -> float:
    fit = F.fit_pivot_line(pivots)
    return float(fit[2]) if fit else 0.0


def _breakout_pos(
    df: pd.DataFrame,
    slope: float,
    intercept: float,
    direction: str,
    from_pos: int,
) -> int | None:
    """First bar at/after ``from_pos`` whose close crosses the line, else ``None``.

    ``direction="bullish"`` looks for a close above the line (resistance break);
    ``"bearish"`` looks for a close below it (support break). Extending the
    pattern's ``end_pos`` to this bar puts the breakout candles inside the hit's
    date span without moving the drawn envelope itself (which stays pre-breakout
    so it still bounds price).
    """
    close = df["close"].to_numpy(dtype=float)
    n = len(close)
    for x in range(max(0, int(from_pos)), n):
        y = F.line_value(slope, intercept, x)
        if direction == "bullish" and close[x] > y:
            return x
        if direction == "bearish" and close[x] < y:
            return x
    return None


def _bottom_line_points(
    df: pd.DataFrame,
    pivots: list[tuple[int, float]],
    bound: bool = True,
) -> list[dict]:
    """Segment/polyline through the bottom pivots.

    A straight segment through the two lowest swing lows is already a lower
    envelope; ``_bound`` guarantees it even when a non-pivot dip creeps below the
    chord. A polyline (3+ bottoms) is serialised through the exact pivots so it
    never cuts through them.
    """
    ordered = sorted(pivots, key=lambda t: t[0])
    if len(ordered) < 2:
        return []
    if bound and len(ordered) == 2:
        (x0, q0), (x1, q1) = ordered
        slope = (q1 - q0) / (x1 - x0)
        intercept = q0 - slope * x0
        slope, intercept = _bound(df, slope, intercept, x0, x1, "lower")
        return segment_points(
            df, x0, F.line_value(slope, intercept, x0), x1, F.line_value(slope, intercept, x1)
        )
    return [
        {"t": iso_ts(df.index[int(p)]), "price": round(float(q), 4)}
        for p, q in ordered
    ]


# ---------------------------------------------------------------------------
# Wedges
# ---------------------------------------------------------------------------


def _wedge_envelopes(df: pd.DataFrame, ctx: dict, start: int, falling: bool):
    """One window's upper/lower envelope fits, or ``None``.

    The resistance envelope is built from the swing highs in the window. The
    support envelope is built from the swing lows and, **for falling wedges
    only**, from the latest bar's low as an extra anchor so the support can run
    to the current price (e.g. from the early-Mar low to the latest low).

    Rising wedges deliberately keep their real pivot span: anchoring the latest
    (post-breakdown) low drags the support slope down until it is shallower than
    the rising resistance, which flips the ``su < sl`` convergence sign and makes
    the wedge disappear.
    """
    pair = _fit_pair(df, ctx, start)
    if pair is None:
        return None
    H, L, (_, _, r2u), (_, _, r2l) = pair
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return None
    tol = 0.25 * atr_val
    if falling:
        last = len(df) - 1
        L = L + [(last, float(df["low"].iloc[last]))]
    eu = F.envelope_line(df, H, "upper", tol)
    el = F.envelope_line(df, L, "lower", tol)
    if eu is None or el is None:
        return None
    return {
        "eu": eu,
        "el": el,
        "H": H,
        "L": L,
        "r2u": r2u,
        "r2l": r2l,
        "atr": atr_val,
        "start": int(start),
    }


def _build_wedge_hit(
    df: pd.DataFrame,
    eu: dict,
    el: dict,
    H: list,
    L: list,
    r2u: float,
    r2l: float,
    atr_val: float,
    falling: bool,
):
    """Validate a (resistance, support) envelope pair and build its hit.

    The pair may come from a single window or from two different windows blended
    by :func:`_wedge_impl`; every geometry rule is re-checked here so a blended
    pair that does not form a real wedge is rejected rather than drawn.
    """
    if atr_val <= 0 or eu is None or el is None:
        return None
    cx0 = max(eu["x0"], el["x0"])
    cx1 = min(eu["x1"], el["x1"])
    if cx1 - cx0 < 10:
        return None

    # --- detection geometry: common overlap (unchanged thresholds) ---------
    su, iu = _bound(df, eu["slope"], eu["intercept"], cx0, cx1, "upper")
    sl, il = _bound(df, el["slope"], el["intercept"], cx0, cx1, "lower")

    def uval(x):
        return F.line_value(su, iu, x)

    def lval(x):
        return F.line_value(sl, il, x)

    w_start = uval(cx0) - lval(cx0)
    w_end = uval(cx1) - lval(cx1)
    mp = mean_price_fn(df, cx0, cx1)
    if mp <= 0:
        return None
    if falling:
        if not (su < 0 and sl < 0):
            return None
    else:
        if not (su > 0 and sl > 0):
            return None
    if not (w_start > 0 and w_end > 0 and w_end < w_start * CONVERGE):
        return None
    if su >= sl:  # upper must fall faster / lower must rise faster
        return None
    # lines must not cross inside the pattern (they converge to the right).
    denom = su - sl
    xcross = (il - iu) / denom if abs(denom) > 1e-12 else 1e9
    if cx0 < xcross < cx1:
        return None
    hi, lo, _, _ = F.swing_extremes(df, cx0, cx1)
    touches = F.count_touches(H, su, iu, atr_val) + F.count_touches(L, sl, il, atr_val)
    r2 = min(r2u, r2l)
    if r2 < MIN_R2:
        return None

    # --- drawing: each boundary keeps its own real extreme pivot span ------
    # Re-bound over the *full* per-side span (not the overlap) so the line still
    # provably bounds price after being extended to its earliest pivot.
    su2, iu2 = _bound(df, eu["slope"], eu["intercept"], eu["x0"], eu["x1"], "upper")
    sl2, il2 = _bound(df, el["slope"], el["intercept"], el["x0"], el["x1"], "lower")

    # Extend end_pos to the bar that breaks the *drawn* boundary (post-breakout
    # candles stay inside the pattern span). If no breakout exists or the
    # extrapolated boundary would overshoot the opposite extreme (breaking
    # target/stop sides), fall back to the last drawn boundary bar so the drawn
    # lines still end inside the span and levels stay well defined.
    held_end = max(eu["x1"], el["x1"])
    if falling:
        br = _breakout_pos(df, su2, iu2, "bullish", cx1)
        end_pos = br if br is not None else held_end
        breakout = F.line_value(su2, iu2, end_pos)
        if not (breakout > lo):
            end_pos = held_end
            breakout = F.line_value(su2, iu2, end_pos)
            if not (breakout > lo):
                return None
    else:
        br = _breakout_pos(df, sl2, il2, "bearish", cx1)
        end_pos = br if br is not None else held_end
        breakout = F.line_value(sl2, il2, end_pos)
        if not (breakout < hi):
            end_pos = held_end
            breakout = F.line_value(sl2, il2, end_pos)
            if not (breakout < hi):
                return None

    trendlines = [
        segment_points(
            df, eu["x0"], F.line_value(su2, iu2, eu["x0"]), eu["x1"], F.line_value(su2, iu2, eu["x1"])
        ),
        segment_points(
            df, el["x0"], F.line_value(sl2, il2, el["x0"]), el["x1"], F.line_value(sl2, il2, el["x1"])
        ),
    ]
    piv_x1 = max(end_pos, eu["x1"], el["x1"])
    piv_x0 = min(eu["x0"], el["x0"])
    pivots = pivot_markers(df, H, L, piv_x0, piv_x1)
    kind = "falling" if falling else "rising"
    pid = "falling_wedge" if falling else "rising_wedge"
    notes = (
        f"{kind} wedge; upper slope {su:.4g} vs lower {sl:.4g}, "
        f"width {w_start:.3g}->{w_end:.3g}, R2 {r2:.2f}"
    )
    return make_hit(
        pid,
        df,
        start_pos=cx0,
        end_pos=end_pos,
        breakout_level=breakout,
        opposite_extreme=lo if falling else hi,
        pattern_height=hi - lo,
        touches=touches,
        r2=r2,
        trendlines=trendlines,
        notes=notes,
        pivots=pivots,
    )


def _wedge_candidate(df: pd.DataFrame, ctx: dict, start: int, falling: bool):
    """One window's full falling/rising wedge candidate, or ``None``."""
    env = _wedge_envelopes(df, ctx, start, falling)
    if env is None:
        return None
    return _build_wedge_hit(
        df,
        env["eu"],
        env["el"],
        env["H"],
        env["L"],
        env["r2u"],
        env["r2l"],
        env["atr"],
        falling,
    )


def _bar_gap_days(df: pd.DataFrame, x0: int, x1: int) -> float:
    """Calendar-day distance between two bar positions (bar count as fallback)."""
    try:
        return abs(float((df.index[int(x0)] - df.index[int(x1)]).days))
    except (AttributeError, TypeError):
        return float(abs(int(x0) - int(x1)))


def _wedge_impl(df: pd.DataFrame, ctx: dict, falling: bool) -> list:
    """Best falling/rising wedge across the wedge windows.

    Each window contributes an independently-validated candidate. The winning
    geometry is then *blended* across windows so both boundaries can reach their
    true extreme pivots:

    * the **support** comes from the candidate whose lower-boundary start is the
      most recent valid one (a real recent low, not an early pivot that flattens
      the line);
    * the **resistance** comes from the candidate whose upper-boundary start is
      closest to that support start (so the two boundaries cover a comparable
      span and actually converge);
    * the blended pair is fully re-validated; if it is not a real wedge the
      highest-confidence single-window candidate is used instead.
    """
    candidates = []
    for lookback in WEDGE_WINDOWS:
        win = window_slice(df, lookback, 30)
        if win is None:
            continue
        start, _end = win
        env = _wedge_envelopes(df, ctx, start, falling)
        if env is None:
            continue
        hit = _build_wedge_hit(
            df,
            env["eu"],
            env["el"],
            env["H"],
            env["L"],
            env["r2u"],
            env["r2l"],
            env["atr"],
            falling,
        )
        if hit is not None:
            candidates.append({"hit": hit, "env": env})
    if not candidates:
        return []
    if len(candidates) == 1:
        return [candidates[0]["hit"]]

    # Support: most recent valid lower-boundary start (tie -> higher confidence).
    support = max(
        candidates,
        key=lambda c: (c["env"]["el"]["x0"], c["hit"].confidence),
    )
    sup_x0 = int(support["env"]["el"]["x0"])
    # Resistance: upper-boundary start closest in calendar time to the support
    # start (bar counts mislead here — a holiday-heavy span can make an earlier
    # date fewer bars away than a later one).
    resistance = min(
        candidates,
        key=lambda c: (
            _bar_gap_days(df, c["env"]["eu"]["x0"], sup_x0),
            -c["hit"].confidence,
        ),
    )
    blended = _build_wedge_hit(
        df,
        resistance["env"]["eu"],
        support["env"]["el"],
        resistance["env"]["H"],
        support["env"]["L"],
        resistance["env"]["r2u"],
        support["env"]["r2l"],
        support["env"]["atr"],
        falling,
    )
    if blended is not None:
        return [blended]
    # Blend did not form a valid wedge -> best single-window candidate.
    best = max(candidates, key=lambda c: c["hit"].confidence)
    return [best["hit"]]


def detect_falling_wedge(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Falling Wedge (bullish reversal).

    Support/resistance **envelopes** through the swing pivots: the upper
    (resistance) line is at/above every high and falls faster than the lower
    (support) line, so the two converge to the right while bounding price. Each
    boundary is drawn from its own earliest real pivot across a widened window
    (so the resistance starts on the actual high, not the recent overlap).
    Breakout is upward through the upper line; measured move = pattern high-low
    range, and ``end_pos`` reaches the breakout bar.
    """
    return _wedge_impl(df, ctx or {}, falling=True)


def detect_rising_wedge(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Rising Wedge (bearish reversal).

    The lower (support) line is at/below every low and rises faster than the
    upper line, so the two converge to the right while bounding price. Each
    boundary starts at its own real pivot; ``end_pos`` reaches the bar that
    breaks the lower boundary. Breakout is downward through the lower line;
    measured move = pattern high-low range.
    """
    return _wedge_impl(df, ctx or {}, falling=False)


# ---------------------------------------------------------------------------
# Diamond bottom
# ---------------------------------------------------------------------------


def detect_diamond_bottom(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Diamond Bottom (bullish reversal).

    Volatility first *expands* (upper line rising, lower line falling) then
    *contracts* (converging), tracing a diamond. Each half is bounded by an upper
    and lower envelope drawn across the **full half span** (so the four lines are
    visible and form the lens). Breakout is upward through the right-hand
    descending upper envelope; measured move = widest envelope width.
    """
    ctx = ctx or {}
    win = _window(df, lookback=130, min_bars=40)
    if win is None:
        return []
    start, end = win
    highs, lows = get_swings(df, ctx)
    H = [(p, q) for p, q in highs if p >= start]
    L = [(p, q) for p, q in lows if p >= start]
    if len(H) < 3 or len(L) < 3:
        return []
    mid = (start + end) // 2

    H1 = [(p, q) for p, q in H if p < mid]
    L1 = [(p, q) for p, q in L if p < mid]
    H2 = [(p, q) for p, q in H if p >= mid]
    L2 = [(p, q) for p, q in L if p >= mid]
    if len(H1) < 2 or len(L1) < 2 or len(H2) < 2 or len(L2) < 2:
        return []
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return []
    tol = 0.25 * atr_val
    eu1 = F.envelope_line(df, H1, "upper", tol)
    el1 = F.envelope_line(df, L1, "lower", tol)
    eu2 = F.envelope_line(df, H2, "upper", tol)
    el2 = F.envelope_line(df, L2, "lower", tol)
    if not all([eu1, el1, eu2, el2]):
        return []
    lx0 = max(eu1["x0"], el1["x0"])
    lx1 = min(eu1["x1"], el1["x1"])
    rx0 = max(eu2["x0"], el2["x0"])
    rx1 = min(eu2["x1"], el2["x1"])
    if lx1 - lx0 < 4 or rx1 - rx0 < 4 or rx1 <= lx1:
        return []
    su1, iu1 = _bound(df, eu1["slope"], eu1["intercept"], lx0, lx1, "upper")
    sl1, il1 = _bound(df, el1["slope"], el1["intercept"], lx0, lx1, "lower")
    su2, iu2 = _bound(df, eu2["slope"], eu2["intercept"], rx0, rx1, "upper")
    sl2, il2 = _bound(df, el2["slope"], el2["intercept"], rx0, rx1, "lower")

    # left half: expanding (upper rises, lower falls).
    if not (su1 > 0 and sl1 < 0):
        return []
    w1_start = F.line_value(su1, iu1, lx0) - F.line_value(sl1, il1, lx0)
    w1_end = F.line_value(su1, iu1, lx1) - F.line_value(sl1, il1, lx1)
    if not (w1_end > w1_start):
        return []
    # right half: contracting (lines converge).
    w2_start = F.line_value(su2, iu2, rx0) - F.line_value(sl2, il2, rx0)
    w2_end = F.line_value(su2, iu2, rx1) - F.line_value(sl2, il2, rx1)
    if not (w2_start > 0 and w2_end > 0 and w2_end < w2_start * 0.85):
        return []
    if not (su2 < sl2):
        return []

    r2 = min(_r2_of(H1), _r2_of(L1), _r2_of(H2), _r2_of(L2))
    if r2 < MIN_R2:
        return []

    # --- draw the four lens lines across the full half spans ---------------
    left0 = min(eu1["x0"], el1["x0"])
    right1 = max(eu2["x1"], el2["x1"])
    lu_s, lu_i = _bound(df, eu1["slope"], eu1["intercept"], left0, mid, "upper")
    ll_s, ll_i = _bound(df, el1["slope"], el1["intercept"], left0, mid, "lower")
    ru_s, ru_i = _bound(df, eu2["slope"], eu2["intercept"], mid, right1, "upper")
    rl_s, rl_i = _bound(df, el2["slope"], el2["intercept"], mid, right1, "lower")

    br = _breakout_pos(df, ru_s, ru_i, "bullish", rx1)
    end_pos = br if br is not None else right1
    breakout = F.line_value(ru_s, ru_i, end_pos)
    hi, lo, _, _ = F.swing_extremes(df, start, right1)
    if not (breakout > lo):
        end_pos = right1
        breakout = F.line_value(ru_s, ru_i, end_pos)
        if not (breakout > lo):
            return []
    height = max(w1_end - w1_start, w2_start - w2_end, hi - lo)
    touches = F.count_touches(H2, ru_s, ru_i, atr_val) + F.count_touches(
        L2, rl_s, rl_i, atr_val
    )
    trendlines = [
        segment_points(df, left0, F.line_value(lu_s, lu_i, left0), mid, F.line_value(lu_s, lu_i, mid)),
        segment_points(df, left0, F.line_value(ll_s, ll_i, left0), mid, F.line_value(ll_s, ll_i, mid)),
        segment_points(df, mid, F.line_value(ru_s, ru_i, mid), right1, F.line_value(ru_s, ru_i, right1)),
        segment_points(df, mid, F.line_value(rl_s, rl_i, mid), right1, F.line_value(rl_s, rl_i, right1)),
    ]
    pivots = pivot_markers(df, H, L, left0, max(end_pos, right1))
    notes = (
        f"diamond bottom; expand {w1_start:.3g}->{w1_end:.3g}, "
        f"contract {w2_start:.3g}->{w2_end:.3g}"
    )
    return [
        make_hit(
            "diamond_bottom",
            df,
            start_pos=left0,
            end_pos=end_pos,
            breakout_level=breakout,
            opposite_extreme=lo,
            pattern_height=height,
            touches=touches,
            r2=r2,
            trendlines=trendlines,
            notes=notes,
            pivots=pivots,
        )
    ]


# ---------------------------------------------------------------------------
# Double / triple bottoms
# ---------------------------------------------------------------------------


def _similarity_r2(a: float, b: float, mean_price: float, tol_pct: float = 4.0) -> float:
    """Geometry confidence for equal-level bottoms: 1.0 identical, ~0.5 at tol."""
    if mean_price <= 0:
        return 0.0
    sim_pct = abs(a - b) / mean_price * 100.0
    return float(max(0.0, min(1.0, 1.0 - 0.5 * sim_pct / tol_pct)))


def _double_bottom_impl(df: pd.DataFrame, ctx: dict, tol_pct: float = 4.0) -> list:
    win = _window(df, lookback=130, min_bars=30)
    if win is None:
        return []
    start, end = win
    highs, lows = get_swings(df, ctx)
    H = [(p, q) for p, q in highs if p >= start]
    L = [(p, q) for p, q in lows if p >= start]
    if len(L) < 2 or len(H) < 1:
        return []
    two = sorted(sorted(L, key=lambda t: t[1])[:2], key=lambda t: t[0])
    a, b = two
    if b[0] - a[0] < 4:
        return []
    mean_price = mean_price_fn(df, start, end)
    if mean_price <= 0:
        return []
    sim_pct = abs(a[1] - b[1]) / mean_price * 100.0
    if sim_pct > tol_pct:
        return []
    # neckline = highest high across the two bottoms (a true upper envelope
    # over the drawn span, not just the max *pivot* between them).
    neck = float(df["high"].iloc[a[0] : b[0] + 1].max())
    base = min(a[1], b[1])
    depth = neck - base
    atr_val = F.atr_value(df)
    if depth <= max(0.5 * atr_val, 0.5):
        return []
    # price should be recovering toward the neckline, not collapsing
    if float(df["close"].iloc[end]) < base + 0.35 * depth:
        return []
    r2 = _similarity_r2(a[1], b[1], mean_price, tol_pct)
    if r2 < 0.5:
        return []
    # end_pos reaches the neckline breakout bar (post-breakout inside the span).
    br = _breakout_pos(df, 0.0, neck, "bullish", b[0])
    end_pos = br if br is not None else b[0]
    trendlines = [
        flat_line_points(df, neck, a[0], b[0]),
        _bottom_line_points(df, [a, b], bound=True),
    ]
    pivots = pivot_markers(df, H, L, a[0], max(end_pos, b[0]))
    notes = f"double bottom; lows {a[1]:.4g}/{b[1]:.4g} ({sim_pct:.2f}% apart), neckline {neck:.4g}"
    return [
        make_hit(
            "double_bottom",
            df,
            start_pos=a[0],
            end_pos=end_pos,
            breakout_level=neck,
            opposite_extreme=base,
            pattern_height=depth,
            touches=2,
            r2=r2,
            trendlines=trendlines,
            notes=notes,
            pivots=pivots,
        )
    ]


def detect_double_bottom(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Double Bottom (bullish reversal).

    Two swing lows at (near) equal price with an intervening swing high
    (neckline). Similarity ``|p1-p2|/mean <= 4%``; neckline = highest high
    across the two bottoms (horizontal upper envelope = ``breakout_level``); a
    lower envelope connects the two bottom pivots. Measured move = neckline -
    base; breakout above the neckline and ``end_pos`` at that breakout bar.
    """
    return _double_bottom_impl(df, ctx or {})


def detect_triple_bottom(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Triple Bottom (bullish reversal).

    Three swing lows at near-equal price, each pair separated by a swing high.
    Neckline = highest high across the first..third bottom (horizontal upper
    envelope = ``breakout_level``); a polyline through the three bottom pivots
    draws the support. Measured move = neckline - lowest low; breakout above the
    neckline with ``end_pos`` at the breakout bar. Three touches raise quality.
    """
    ctx = ctx or {}
    win = _window(df, lookback=150, min_bars=40)
    if win is None:
        return []
    start, end = win
    highs, lows = get_swings(df, ctx)
    H = [(p, q) for p, q in highs if p >= start]
    L = [(p, q) for p, q in lows if p >= start]
    if len(L) < 3 or len(H) < 2:
        return []
    three = sorted(sorted(L, key=lambda t: t[1])[:3], key=lambda t: t[0])
    (p1, v1), (p2, v2), (p3, v3) = three
    if p2 - p1 < 4 or p3 - p2 < 4:
        return []
    mean_price = mean_price_fn(df, start, end)
    if mean_price <= 0:
        return []
    vals = [v1, v2, v3]
    sim_pct = (max(vals) - min(vals)) / mean_price * 100.0
    if sim_pct > 4.5:
        return []
    # neckline = highest high across the full three-bottom span (upper envelope).
    neck = float(df["high"].iloc[p1 : p3 + 1].max())
    base = float(min(vals))
    depth = neck - base
    atr_val = F.atr_value(df)
    if depth <= max(0.5 * atr_val, 0.5):
        return []
    if float(df["close"].iloc[end]) < base + 0.35 * depth:
        return []
    r2 = min(_similarity_r2(v1, v2, mean_price), _similarity_r2(v2, v3, mean_price))
    if r2 < 0.5:
        return []
    br = _breakout_pos(df, 0.0, neck, "bullish", p3)
    end_pos = br if br is not None else p3
    trendlines = [
        flat_line_points(df, neck, p1, p3),
        _bottom_line_points(df, [(p1, v1), (p2, v2), (p3, v3)], bound=False),
    ]
    pivots = pivot_markers(df, H, L, p1, max(end_pos, p3))
    notes = f"triple bottom; lows {vals}, neckline {neck:.4g}, spread {sim_pct:.2f}%"
    return [
        make_hit(
            "triple_bottom",
            df,
            start_pos=p1,
            end_pos=end_pos,
            breakout_level=neck,
            opposite_extreme=base,
            pattern_height=depth,
            touches=3,
            r2=r2,
            trendlines=trendlines,
            notes=notes,
            pivots=pivots,
        )
    ]


# ---------------------------------------------------------------------------
# Head & Shoulders
# ---------------------------------------------------------------------------


def _hs_impl(df: pd.DataFrame, ctx: dict, inverse: bool) -> list:
    win = _window(df, lookback=150, min_bars=40)
    if win is None:
        return []
    start, end = win
    all_highs, all_lows = get_swings(df, ctx)
    if inverse:
        primary = [(p, q) for p, q in all_lows if p >= start]
        secondary = [(p, q) for p, q in all_highs if p >= start]
    else:
        primary = [(p, q) for p, q in all_highs if p >= start]
        secondary = [(p, q) for p, q in all_lows if p >= start]
    if len(primary) < 3:
        return []
    # pick the three most prominent pivots (extreme price first) that are
    # position-separated; try each candidate left/right pair for the head.
    cand = sorted(primary, key=lambda t: t[1], reverse=not inverse)[:6]
    best = None
    for h in cand:
        lefts = [p for p in cand if p[0] < h[0] - 3]
        rights = [p for p in cand if p[0] > h[0] + 3]
        if not lefts or not rights:
            continue
        left = max(lefts, key=lambda t: t[1]) if not inverse else min(lefts, key=lambda t: t[1])
        right = max(rights, key=lambda t: t[1]) if not inverse else min(rights, key=lambda t: t[1])
        mean_price = mean_price_fn(df, start, end)
        if mean_price <= 0:
            continue
        shoulder_diff = abs(left[1] - right[1]) / mean_price
        head_prom = (h[1] - max(left[1], right[1])) if not inverse else (
            min(left[1], right[1]) - h[1]
        )
        score = head_prom / max(mean_price, 1e-9) - shoulder_diff
        if best is None or score > best[0]:
            best = (score, left, h, right, mean_price)
    if best is None:
        return []
    score, (pl, vl), (ph, vh), (pr, vr), mean_price = best
    if score <= 0:
        return []
    if abs(vl - vr) / mean_price > 0.05:
        return []

    neck_pts = [(p, q) for p, q in secondary if pl < p < pr]
    if len(neck_pts) < 2:
        return []
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return []
    side = "upper" if inverse else "lower"
    env = F.envelope_line(df, neck_pts, side, 0.25 * atr_val)
    if env is None:
        return []
    nx0 = max(int(env["x0"]), pl)
    nx1 = int(pr)
    if nx1 - nx0 < 3:
        return []
    ns, ni = _bound(df, env["slope"], env["intercept"], nx0, nx1, side)

    def nval(x):
        return F.line_value(ns, ni, x)

    breakout = nval(nx1)
    if inverse:
        base = min(vl, vh, vr)
        height = breakout - base
        if height <= max(0.4 * atr_val, 0.4):
            return []
        if float(df["close"].iloc[end]) < base + 0.35 * height:
            return []
        opposite = base
        r2 = max(0.0, 1.0 - (breakout - min(vl, vr)) / max(height, 1e-9))
    else:
        top = max(vl, vh, vr)
        height = top - breakout
        if height <= max(0.4 * atr_val, 0.4):
            return []
        if float(df["close"].iloc[end]) > top - 0.35 * height:
            return []
        opposite = top
        r2 = max(0.0, 1.0 - (max(vl, vr) - breakout) / max(height, 1e-9))
    r2 = float(min(1.0, max(0.45, r2)))
    pid = "inverse_head_shoulders" if inverse else "head_shoulders"
    notes = (
        f"{'inverse ' if inverse else ''}H&S; shoulders {vl:.4g}/{vr:.4g}, "
        f"head {vh:.4g}, neckline {breakout:.4g}"
    )
    pivots = pivot_markers(df, all_highs, all_lows, min(pl, ph, pr), pr)
    return [
        make_hit(
            pid,
            df,
            start_pos=min(pl, ph, pr),
            end_pos=pr,
            breakout_level=breakout,
            opposite_extreme=opposite,
            pattern_height=height,
            touches=3,
            r2=r2,
            trendlines=[segment_points(df, nx0, nval(nx0), nx1, breakout)],
            notes=notes,
            pivots=pivots,
        )
    ]


def detect_head_shoulders(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Head & Shoulders (bearish reversal).

    Three swing highs: middle (head) higher than two similar shoulders; the
    neckline is a *support envelope* at/below every low between the shoulders
    (fitted through the trough pivots, then shifted so it never sits inside
    price). Breakout is downward through the neckline; measured move = head -
    neckline. The shoulder and head pivots are emitted for on-chart markers.
    """
    return _hs_impl(df, ctx or {}, inverse=False)


def detect_inverse_head_shoulders(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Inverse Head & Shoulders (bullish reversal).

    Mirror of H&S using lows: the neckline is a *resistance envelope* at/above
    every high between the shoulders (not an average through price); breakout is
    upward through it. The shoulder and head pivots are emitted for markers.
    """
    return _hs_impl(df, ctx or {}, inverse=True)


# ---------------------------------------------------------------------------
# Rounding bottom
# ---------------------------------------------------------------------------


def _poly_cup(df: pd.DataFrame, start: int, end: int):
    """Fit close against bar index; return dict or None."""
    y = df["close"].iloc[start : end + 1].to_numpy(dtype=float)
    if len(y) < 15:
        return None
    xs = np.arange(len(y), dtype=float)
    fitted, coeffs = F.polyfit_values(y, degree=2, x=xs)
    if len(coeffs) < 3:
        return None
    a, b, _c = float(coeffs[0]), float(coeffs[1]), float(coeffs[2])
    r2 = F.r2_of(y, fitted)
    vertex = -b / (2 * a) if abs(a) > 1e-12 else len(y) / 2.0
    return {
        "a": a,
        "vertex": vertex,
        "r2": r2,
        "fitted": fitted,
        "n": len(y),
        "y": y,
    }


def detect_rounding_bottom(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Rounding Bottom (bullish reversal).

    A concave-up (``a > 0``) quadratic fit of close with its vertex in the middle
    third of the window; both rims rise above the fitted trough. The breakout
    guide is a horizontal *resistance envelope* at the window's highest high (so
    it sits at the same level as ``breakout_level`` and never cuts through the
    candles); the fitted U is drawn alongside it. Measured move = rim - fitted
    trough.
    """
    ctx = ctx or {}
    win = _window(df, lookback=130, min_bars=40)
    if win is None:
        return []
    start, end = win
    cup = _poly_cup(df, start, end)
    if cup is None:
        return []
    if cup["a"] <= 0:
        return []
    n = cup["n"]
    if not (0.2 * n <= cup["vertex"] <= 0.8 * n):
        return []
    if cup["r2"] < 0.55:
        return []
    fitted = cup["fitted"]
    trough = float(fitted.min())
    hi, lo, _, _ = F.swing_extremes(df, start, end)
    rim = float(hi)  # resistance envelope across the whole window
    atr_val = F.atr_value(df)
    depth = rim - trough
    if depth <= max(0.6 * atr_val, 0.6):
        return []
    if rim <= trough:
        return []
    # price should have climbed off the base toward the rim
    if float(df["close"].iloc[end]) < trough + 0.45 * (rim - trough):
        return []
    highs, lows = get_swings(df, ctx)
    H = [(p, q) for p, q in highs if p >= start]
    L = [(p, q) for p, q in lows if p >= start]
    touches = 2
    notes = f"rounding bottom; trough {trough:.4g}, rim {rim:.4g}, R2 {cup['r2']:.2f}"
    return [
        make_hit(
            "rounding_bottom",
            df,
            start_pos=start,
            end_pos=end,
            breakout_level=rim,
            opposite_extreme=lo,
            pattern_height=depth,
            touches=touches,
            r2=cup["r2"],
            # Rim first so it renders as the upper (resistance) envelope; the
            # fitted U is drawn as the lower guide.
            trendlines=[
                flat_line_points(df, rim, start, end),
                curve_points(df, start, fitted),
            ],
            notes=notes,
            pivots=pivot_markers(df, H, L, start, end),
        )
    ]


# ---------------------------------------------------------------------------
# registration
# ---------------------------------------------------------------------------

register("falling_wedge", detect_falling_wedge)
register("rising_wedge", detect_rising_wedge)
register("diamond_bottom", detect_diamond_bottom)
register("triple_bottom", detect_triple_bottom)
register("double_bottom", detect_double_bottom)
register("head_shoulders", detect_head_shoulders)
register("inverse_head_shoulders", detect_inverse_head_shoulders)
register("rounding_bottom", detect_rounding_bottom)

"""Continuation pattern detectors.

Channels, flags, pennants, rectangles and triangles. All detectors are pure
``detect(df, ctx) -> list[PatternHit]`` functions over a normalised OHLCV frame.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .. import features as F
from .common import (
    envelope_pair,
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
MIN_R2 = 0.45
PENETRATION_MAX = 0.35
# Channels / ranges / triangles are detected across several trailing windows so a
# structure that exists over the last ~60-100 bars is not masked by a longer-term
# trend captured by the full 150-bar window.
WINDOWS = (150, 100, 60)

# Pennant tunables. A pennant's triangle is usually longer and shallower than a
# flag, and its pole may be smaller than the >=5% required for a flag, so it gets
# its own (still genuine) scan: a real pole (>=3%) followed by a consolidation
# whose high/low envelopes **converge** across their common span. The old reuse
# of the flag scanner plus a 15% convergence gate produced ~0 real hits.
PENNANT_POLES = (6, 8, 10, 12, 15)
PENNANT_FLAGS = (5, 7, 9, 12, 15, 18)
PENNANT_MIN_POLE_RET = 0.03
PENNANT_MAX_FLAG_FRAC = 0.65  # consolidation range vs pole move
PENNANT_MAX_RETR = 0.70  # max retracement of the pole
PENNANT_CONVERGE = 0.85  # end width must be < 85% of start width
PENNANT_CONVERGE_MID = 0.85  # end width must also be < 85% of the mid-span width
PENNANT_MAX_DRIFT = 0.04  # net consolidation drift vs its start price


def _fit_pair(df, ctx, start, max_pivots=5):
    return fit_window_pair(df, ctx, start, max_pivots=max_pivots)


def _line_val(env: dict, x) -> float:
    """Value of a fitted envelope line at bar position ``x``."""
    return env["q0"] + env["slope"] * (x - env["x0"])


def _drawn_span(eu: dict, el: dict, min_span: int = 10):
    """Common x-overlap over which **both** envelope boundaries are drawn.

    Detectors must draw both edges over the same span; otherwise one boundary
    extends into empty air past the other (and past the breakout), which is the
    reported channel/flag/pennant viewing bug.
    """
    x0 = max(int(eu["x0"]), int(el["x0"]))
    x1 = min(int(eu["x1"]), int(el["x1"]))
    if x1 - x0 < min_span:
        return None
    return x0, x1


def _broke_opposite(df: pd.DataFrame, level: float, direction: str, atr_val: float,
                    tol_mult: float = 0.25) -> bool:
    """True when the last close pierced the boundary *opposite* the pattern.

    A bearish pattern (descending channel / descending triangle) is invalidated
    when price breaks **up** through its upper boundary; a bullish pattern when
    price breaks **down** through its lower boundary. Used so a downward setup
    is never presented after price has resolved the other way.
    """
    if df is None or df.empty or atr_val <= 0 or level <= 0:
        return False
    last = float(df["close"].iloc[-1])
    tol = tol_mult * atr_val
    if direction == "bearish":
        return last > level + tol
    return last < level - tol


def _shift_line(df: pd.DataFrame, slope: float, intercept: float, x0: int, x1: int,
                side: str) -> tuple[float, float]:
    """Translate a line so it bounds every candle within ``[x0, x1]``.

    Keeps the slope and shifts the intercept by the smallest amount needed, so an
    upper line ends at/above every high and a lower line at/below every low. Used
    by the flag pole so a pivot-pair line that an intermediate wick pokes through
    is nudged into a true boundary.
    """
    x0, x1 = int(x0), int(x1)
    if x1 < x0:
        return float(slope), float(intercept)
    xs = np.arange(x0, x1 + 1, dtype=float)
    line = slope * xs + intercept
    if side == "upper":
        delta = float(np.max(df["high"].to_numpy(dtype=float)[x0 : x1 + 1] - line))
        intercept += max(delta, 0.0)
    else:
        delta = float(np.max(line - df["low"].to_numpy(dtype=float)[x0 : x1 + 1]))
        intercept -= max(delta, 0.0)
    return float(slope), float(intercept)


def _breakout_pos(df: pd.DataFrame, x_from: int, breakout: float, direction: str):
    """First position at/after ``x_from`` whose close crosses ``breakout``.

    Lets ``end_pos`` reach the bar that actually broke the line instead of a
    stale window end far past it. Returns ``None`` when price never crossed.
    """
    if df is None or df.empty or breakout <= 0:
        return None
    close = df["close"].to_numpy(dtype=float)
    lo = max(0, int(x_from))
    for i in range(lo, len(close)):
        if direction == "bearish":
            if close[i] < breakout:
                return i
        elif close[i] > breakout:
            return i
    return None


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


def _channel_once(df: pd.DataFrame, ctx: dict, start: int, end: int, ascending: bool):
    if end <= 0:
        return None
    pair = _fit_pair(df, ctx, start, max_pivots=None)
    if pair is None:
        return None
    H, L, (_, _, r2u), (_, _, r2l) = pair
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return None
    tol = 0.25 * atr_val
    eu, el = envelope_pair(df, H, L, atr_val)
    if eu is None or el is None:
        return None

    def val(env, x):
        return _line_val(env, x)

    span = _drawn_span(eu, el)
    if span is None:
        return None
    x0, x1 = span
    # Re-fit each boundary to the pivots *inside* the shared leg so the drawn
    # lines start/end on real pivots of that leg (not floating in empty air).
    H2 = [(p, q) for p, q in H if x0 <= p <= x1]
    L2 = [(p, q) for p, q in L if x0 <= p <= x1]
    if len(H2) >= 2 and len(L2) >= 2:
        eu2 = F.envelope_line(df, H2, "upper", tol)
        el2 = F.envelope_line(df, L2, "lower", tol)
        if eu2 is not None and el2 is not None:
            span2 = _drawn_span(eu2, el2)
            if span2 is not None:
                eu, el, (x0, x1) = eu2, el2, span2

    su, sl = eu["slope"], el["slope"]
    mp = mean_price_fn(df, x0, x1)
    if mp <= 0:
        return None
    w_start = val(eu, x0) - val(el, x0)
    w_end = val(eu, x1) - val(el, x1)
    if ascending and not (su > 0 and sl > 0):
        return None
    if (not ascending) and not (su < 0 and sl < 0):
        return None
    # parallel: slopes close (<10% drift difference)
    if abs(su - sl) * (x1 - x0) / mp > 0.10:
        return None
    if not (w_start > 0 and w_end > 0 and w_end > w_start * 0.55):
        return None
    eu_int, el_int = eu["intercept"], el["intercept"]
    x_cross = (el_int - eu_int) / (su - sl) if abs(su - sl) > 1e-12 else float("inf")
    if x0 < x_cross < x1:
        return None
    if F.penetration_ratio(df, su, eu_int, x0, x1, "upper", atr_val) > PENETRATION_MAX:
        return None
    if F.penetration_ratio(df, sl, el_int, x0, x1, "lower", atr_val) > PENETRATION_MAX:
        return None
    hi, lo, _, _ = F.swing_extremes(df, x0, x1)
    r2 = min(r2u, r2l)
    if r2 < MIN_R2:
        return None
    touches = F.count_touches(H, su, eu_int, atr_val) + F.count_touches(L, sl, el_int, atr_val)
    width = float(np.mean([val(eu, x) - val(el, x) for x in range(x0, x1 + 1)]))
    if ascending:
        breakout = val(eu, x1)
        pid, opposite, direction = "ascending_channel", lo, "bullish"
    else:
        # Bearish channel guard: if price has broken the OPPOSITE (upper)
        # boundary the descending structure is invalidated and price is moving
        # up — reject rather than present a fresh short.
        if _broke_opposite(df, val(eu, x1), "bearish", atr_val):
            return None
        breakout = val(el, x1)
        pid, opposite, direction = "descending_channel", hi, "bearish"
    # Let ``end_pos`` reach the bar that actually broke the line (so status and
    # bars_ago reflect the breakout, not a stale window end past it).
    bp = _breakout_pos(df, x1, breakout, direction)
    end_pos = x1 if bp is None else max(x1, bp)
    def _boundary(env: dict) -> list[dict]:
        # Structural end (x1) first, then the breakout bar: both edges span the
        # whole detected range. Keeping x1 as the middle vertex preserves the
        # "breakout level sits on the drawn boundary" invariant used by audits,
        # while the extra vertex extends the drawn line through the breakout.
        pts = segment_points(df, x0, val(env, x0), x1, val(env, x1))
        if end_pos > x1:
            pts.append({"t": iso_ts(df.index[int(end_pos)]), "price": round(val(env, end_pos), 4)})
        return pts

    trendlines = [_boundary(eu), _boundary(el)]
    notes = (
        f"{pid.replace('_', ' ')}; slope {su:.4g}/{sl:.4g}, "
        f"width {w_start:.3g}->{w_end:.3g}, R2 {r2:.2f}"
    )
    return make_hit(
        pid,
        df,
        start_pos=x0,
        end_pos=end_pos,
        breakout_level=breakout,
        opposite_extreme=opposite,
        pattern_height=max(width, 0.0),
        touches=touches,
        r2=r2,
        trendlines=trendlines,
        notes=notes,
        direction=direction,
        pivots=pivot_markers(df, H, L, x0, x1),
    )


def _channel_impl(df: pd.DataFrame, ctx: dict, ascending: bool) -> list:
    hits = []
    seen = set()
    for lookback in WINDOWS:
        win = window_slice(df, lookback, 30)
        if win is None:
            continue
        start, end = win
        hit = _channel_once(df, ctx, start, end, ascending)
        if hit is not None and (hit.start_date, hit.end_date) not in seen:
            seen.add((hit.start_date, hit.end_date))
            hits.append(hit)
    return hits


def detect_ascending_channel(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Ascending Channel (bullish continuation).

    Two near-parallel upward lines (slope difference < 10% of price over the
    window, width not contracting). Both boundaries are drawn over their common
    leg (anchored on real pivots of that leg) and ``end_pos`` reaches the bar that
    breaks the upper line. Breakout is up through the upper line; measured move =
    mean channel width.
    """
    return _channel_impl(df, ctx or {}, ascending=True)


def detect_descending_channel(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Descending Channel (bearish continuation). Mirror of ascending channel.

    Rejected when price has broken the **opposite** (upper) boundary — an upward
    resolution is not a fresh short.
    """
    return _channel_impl(df, ctx or {}, ascending=False)


# ---------------------------------------------------------------------------
# Flags / pennant
# ---------------------------------------------------------------------------


def _find_pole_flag(df: pd.DataFrame, bullish: bool):
    """Search pole+consolidation; return the best ``(dict)`` or ``None``."""
    n = len(df)
    end = n - 1
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    best = None
    for pole_bars in (6, 8, 10, 12, 15):
        for flag_bars in (5, 7, 9, 12):
            total = pole_bars + flag_bars
            if total > min(n, LOOKBACK):
                continue
            pstart = end - total
            pend = end - flag_bars
            fstart = pend
            fend = end
            c0 = float(close.iloc[pstart])
            c1 = float(close.iloc[pend])
            if c0 <= 0:
                continue
            pole_ret = (c1 - c0) / c0
            pole_high = float(high.iloc[pstart : pend + 1].max())
            pole_low = float(low.iloc[pstart : pend + 1].min())
            pole_move = pole_high - pole_low
            if pole_move <= 0:
                continue
            fhigh = float(high.iloc[fstart : fend + 1].max())
            flow = float(low.iloc[fstart : fend + 1].min())
            frange = fhigh - flow
            if frange > 0.55 * pole_move:
                continue
            if frange <= 0:
                continue
            # A flag consolidates: its net drift must be small vs the pole move.
            flag_change = abs(float(close.iloc[fend]) - float(close.iloc[fstart]))
            if flag_change > 0.22 * pole_move:
                continue
            if bullish:
                if pole_ret < 0.05:
                    continue
                retr = (pole_high - flow) / pole_move
                if retr > 0.6:
                    continue
                fdrift = (float(close.iloc[fend]) - float(close.iloc[fstart])) / max(
                    float(close.iloc[fstart]), 1e-9
                )
                if fdrift > 0.04:
                    continue
            else:
                if pole_ret > -0.05:
                    continue
                retr = (fhigh - pole_low) / pole_move
                if retr > 0.6:
                    continue
                fdrift = (float(close.iloc[fend]) - float(close.iloc[fstart])) / max(
                    float(close.iloc[fstart]), 1e-9
                )
                if fdrift < -0.04:
                    continue
            score = abs(pole_ret) * 10.0 - frange / pole_move
            if best is None or score > best["score"]:
                best = dict(
                    score=score,
                    pstart=pstart,
                    pend=pend,
                    fstart=fstart,
                    fend=fend,
                    pole_ret=pole_ret,
                    pole_high=pole_high,
                    pole_low=pole_low,
                    pole_move=pole_move,
                    fhigh=fhigh,
                    flow=flow,
                )
    return best


def _flag_hit(df, best, pid, bullish):
    atr_val = F.atr_value(df)
    highs, lows = get_swings(df)
    pstart, pend = int(best["pstart"]), int(best["pend"])
    fstart, fend = int(best["fstart"]), int(best["fend"])
    if bullish:
        breakout = best["fhigh"]
        opposite = best["flow"]
    else:
        breakout = best["flow"]
        opposite = best["fhigh"]
    # R2 of the consolidation closes as a line (quality signal).
    seg = df["close"].iloc[fstart : fend + 1].to_numpy(dtype=float)
    _, _, r2 = F.linreg_fit(np.arange(len(seg)), seg)
    r2 = max(r2, 0.5)
    touches = 2
    # Pole line goes pivot-high -> pivot-high (bullish) / pivot-low -> pivot-low
    # (bearish) so it runs *along* the pole instead of cutting through candles.
    # Prefer the envelope through those pivots (fewest violations, longest span),
    # then nudge it outward so an intermediate wick cannot poke through.
    pole_pivots = highs if bullish else lows
    side = "upper" if bullish else "lower"
    window = [(p, q) for p, q in pole_pivots if pstart <= p <= pend]
    env = F.envelope_line(df, window, side, 0.25 * atr_val) if len(window) >= 2 else None
    if env is not None:
        ps, pi = env["slope"], env["intercept"]
        px0, px1 = int(env["x0"]), int(env["x1"])
    elif bullish:
        px0, px1 = pstart, pend
        aq0, aq1 = float(df["high"].iloc[pstart]), float(best["pole_high"])
        ps = (aq1 - aq0) / (px1 - px0) if px1 > px0 else 0.0
        pi = aq0 - ps * px0
    else:
        px0, px1 = pstart, pend
        aq0, aq1 = float(df["low"].iloc[pstart]), float(best["pole_low"])
        ps = (aq1 - aq0) / (px1 - px0) if px1 > px0 else 0.0
        pi = aq0 - ps * px0
    ps, pi = _shift_line(df, ps, pi, px0, px1, side)
    pole_line = segment_points(
        df, px0, F.line_value(ps, pi, px0), px1, F.line_value(ps, pi, px1)
    )
    trendlines = [
        pole_line,
        flat_line_points(df, best["fhigh"], fstart, fend),
        flat_line_points(df, best["flow"], fstart, fend),
    ]
    notes = (
        f"{pid.replace('_', ' ')}; pole {best['pole_ret'] * 100:.2f}% "
        f"({pend - pstart} bars), consolidation range "
        f"{best['flow']:.4g}-{best['fhigh']:.4g}"
    )
    return [
        make_hit(
            pid,
            df,
            start_pos=pstart,
            end_pos=fend,
            breakout_level=breakout,
            opposite_extreme=opposite,
            pattern_height=best["pole_move"],
            touches=touches,
            r2=r2,
            trendlines=trendlines,
            notes=notes,
            pivots=pivot_markers(df, highs, lows, pstart, fend),
        )
    ]


def detect_bull_flag(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Bull Flag (bullish continuation).

    A strong pole (>=5% advance over <=15 bars) followed by a tight
    consolidation retracing <60% of the pole. Breakout above the flag high;
    measured move = pole height projected from the breakout.
    """
    best = _find_pole_flag(df, bullish=True)
    if best is None:
        return []
    return _flag_hit(df, best, "bull_flag", True)


def detect_bear_flag(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Bear Flag (bearish continuation). Mirror of bull flag on a down pole."""
    best = _find_pole_flag(df, bullish=False)
    if best is None:
        return []
    return _flag_hit(df, best, "bear_flag", False)


def _find_pennant(df: pd.DataFrame):
    """Return the best ``pole + converging consolidation`` dict or ``None``.

    Scans a wider set of pole/consolidation windows than the flag scanner and
    accepts a smaller pole (>=3%), because a pennant's symmetrical triangle is
    usually longer and shallower than a flag. Convergence is measured across the
    **common span** of the fitted high/low envelopes so the reported lines
    actually bound price and the breakout level sits on the upper line.
    """
    n = len(df)
    if n < 20:
        return None
    end = n - 1
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return None
    highs_all, lows_all = get_swings(df)
    best = None
    for pole_bars in PENNANT_POLES:
        for flag_bars in PENNANT_FLAGS:
            total = pole_bars + flag_bars
            if total > min(n, LOOKBACK):
                continue
            pstart = end - total
            pend = end - flag_bars
            fstart, fend = pend, end
            c0 = float(close.iloc[pstart])
            c1 = float(close.iloc[pend])
            if c0 <= 0:
                continue
            pole_ret = (c1 - c0) / c0
            if pole_ret < PENNANT_MIN_POLE_RET:
                continue
            pole_high = float(high.iloc[pstart : pend + 1].max())
            pole_low = float(low.iloc[pstart : pend + 1].min())
            pole_move = pole_high - pole_low
            if pole_move <= 0:
                continue
            fhigh = float(high.iloc[fstart : fend + 1].max())
            flow = float(low.iloc[fstart : fend + 1].min())
            frange = fhigh - flow
            if frange <= 0 or frange > PENNANT_MAX_FLAG_FRAC * pole_move:
                continue
            if (pole_high - flow) / pole_move > PENNANT_MAX_RETR:
                continue
            flag_change = abs(float(close.iloc[fend]) - float(close.iloc[fstart]))
            if flag_change > 0.22 * pole_move:
                continue
            fdrift = (float(close.iloc[fend]) - float(close.iloc[fstart])) / max(
                float(close.iloc[fstart]), 1e-9
            )
            if fdrift > PENNANT_MAX_DRIFT:
                continue
            search_start = max(0, fstart - 3)
            H = [(p, q) for p, q in highs_all if search_start <= p <= fend]
            L = [(p, q) for p, q in lows_all if search_start <= p <= fend]
            if len(H) < 2 or len(L) < 2:
                continue
            eu, el = envelope_pair(df, H, L, atr_val)
            if eu is None or el is None:
                continue
            # Common span: within it each envelope provably bounds its own side,
            # so the drawn lines never cut through price and the breakout level
            # equals the upper line's value at its right endpoint.
            cx0 = max(eu["x0"], el["x0"])
            cx1 = min(eu["x1"], el["x1"])
            if cx1 - cx0 < 4:
                continue

            def val(env, x):
                return env["q0"] + env["slope"] * (x - env["x0"])

            w_start = val(eu, cx0) - val(el, cx0)
            w_end = val(eu, cx1) - val(el, cx1)
            w_mid = val(eu, (cx0 + cx1) // 2) - val(el, (cx0 + cx1) // 2)
            if not (w_start > 0 and w_end > 0 and w_mid > 0):
                continue
            # Convergence must be genuine: narrower at the right edge than both
            # the start and the middle of the span (a real symmetric triangle).
            if not (w_end < w_start * PENNANT_CONVERGE and w_end < w_mid * PENNANT_CONVERGE_MID):
                continue
            if not (eu["slope"] < el["slope"]):
                continue  # converging: upper falls relative to lower
            if F.penetration_ratio(df, eu["slope"], eu["intercept"], cx0, cx1, "upper", atr_val) > PENETRATION_MAX:
                continue
            if F.penetration_ratio(df, el["slope"], el["intercept"], cx0, cx1, "lower", atr_val) > PENETRATION_MAX:
                continue
            score = pole_ret * 10.0 - (w_end / w_start)
            if best is None or score > best["score"]:
                best = dict(
                    score=score,
                    pstart=pstart,
                    pend=pend,
                    fstart=fstart,
                    fend=fend,
                    cx0=cx0,
                    cx1=cx1,
                    pole_ret=pole_ret,
                    pole_high=pole_high,
                    pole_low=pole_low,
                    pole_move=pole_move,
                    fhigh=fhigh,
                    flow=flow,
                    eu=eu,
                    el=el,
                    w_start=w_start,
                    w_end=w_end,
                )
    return best


def detect_pennant(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Pennant (bullish continuation).

    A pole (>=3% advance) followed by a *converging* consolidation (symmetrical
    triangle): the envelope through the consolidation highs and the envelope
    through its lows narrow to <85% of both their starting separation *and* the
    width at the middle of the span while bounding price. Breakout is upward
    through the upper envelope; measured move = pole height.

    Unlike a flag scanner this accepts a longer, shallower consolidation and a
    smaller pole, which is what real pennants look like; the old >=5%-pole /
    flag-scanner reuse plus a 15% convergence gate produced almost no hits.
    """
    n = len(df)
    if n < 20:
        return []
    best = _find_pennant(df)
    if best is None:
        return []
    eu, el = best["eu"], best["el"]
    cx0, cx1 = best["cx0"], best["cx1"]

    def val(env, x):
        return env["q0"] + env["slope"] * (x - env["x0"])

    up_q0, up_q1 = val(eu, cx0), val(eu, cx1)
    lo_q0, lo_q1 = val(el, cx0), val(el, cx1)
    # Quality signal: how cleanly the consolidation highs/lows trend.
    xs = np.arange(cx0, cx1 + 1, dtype=float)
    _, _, r2u = F.linreg_fit(xs, df["high"].iloc[cx0 : cx1 + 1].to_numpy(dtype=float))
    _, _, r2l = F.linreg_fit(xs, df["low"].iloc[cx0 : cx1 + 1].to_numpy(dtype=float))
    r2 = float(min(r2u, r2l))
    atr_val = F.atr_value(df)
    highs, lows = get_swings(df)
    touches = F.count_touches(highs, eu["slope"], eu["intercept"], atr_val) + F.count_touches(
        lows, el["slope"], el["intercept"], atr_val
    )
    notes = (
        f"pennant; pole {best['pole_ret'] * 100:.2f}% "
        f"({best['pend'] - best['pstart']} bars), flag width "
        f"{best['w_start']:.3g}->{best['w_end']:.3g}"
    )
    return [
        make_hit(
            "pennant",
            df,
            start_pos=best["pstart"],
            end_pos=cx1,
            breakout_level=up_q1,
            opposite_extreme=best["flow"],
            pattern_height=best["pole_move"],
            touches=touches,
            r2=r2,
            trendlines=[
                segment_points(df, cx0, up_q0, cx1, up_q1),
                segment_points(df, cx0, lo_q0, cx1, lo_q1),
            ],
            notes=notes,
            pivots=pivot_markers(df, highs, lows, cx0, cx1),
        )
    ]


# ---------------------------------------------------------------------------
# Rectangle
# ---------------------------------------------------------------------------


def _rectangle_once(df: pd.DataFrame, ctx: dict, start: int, end: int):
    if end <= 0:
        return None
    pair = _fit_pair(df, ctx, start, max_pivots=None)
    if pair is None:
        return None
    H, L, (_, _, r2u), (_, _, r2l) = pair
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return None
    eu, el = envelope_pair(df, H, L, atr_val)
    if eu is None or el is None:
        return None
    span = _drawn_span(eu, el)
    if span is None:
        return None
    x0, x1 = span

    def val(env, x):
        return _line_val(env, x)

    mp = mean_price_fn(df, x0, x1)
    if mp <= 0:
        return None
    # A real rectangle is a *horizontal* range. Each edge must be near-flat over
    # its own pivot span **and** over the span it is drawn across — checking only
    # the (shorter) common span let visibly sloped edges (e.g. a descending
    # channel) masquerade as a range.
    for env in (eu, el):
        span_env = int(env["x1"]) - int(env["x0"])
        if span_env <= 0 or not F.is_horizontal(env["slope"], span_env, mp, tol=0.03):
            return None
    if not (
        F.is_horizontal(eu["slope"], x1 - x0, mp, tol=0.03)
        and F.is_horizontal(el["slope"], x1 - x0, mp, tol=0.03)
    ):
        return None
    res, sup = val(eu, x1), val(el, x1)
    if not (res > sup):
        return None
    width_rel = (res - sup) / mp
    if not (0.02 <= width_rel <= 0.6):
        return None
    touch_res = F.count_touches(H, eu["slope"], eu["intercept"], atr_val, tol_atr=0.6)
    touch_sup = F.count_touches(L, el["slope"], el["intercept"], atr_val, tol_atr=0.6)
    if touch_res < 2 or touch_sup < 2:
        return None
    if F.penetration_ratio(df, eu["slope"], eu["intercept"], x0, x1, "upper", atr_val) > PENETRATION_MAX:
        return None
    if F.penetration_ratio(df, el["slope"], el["intercept"], x0, x1, "lower", atr_val) > PENETRATION_MAX:
        return None
    r2 = min(r2u, r2l)
    if r2 < 0.5:
        return None
    # Breakout is the side price actually resolves: upper edge on an upside
    # break (default, long geometry), lower edge on a genuine downside break
    # (short geometry). An inside-range reading stays the default upward.
    last = float(df["close"].iloc[-1])
    tol = 0.25 * atr_val
    if last < sup - tol:
        breakout, opposite, direction = sup, res, "bearish"
    else:
        breakout, opposite, direction = res, sup, "neutral"
    notes = (
        f"rectangle {sup:.4g}-{res:.4g} ({width_rel * 100:.1f}% wide), "
        f"touches {touch_sup}/{touch_res}"
    )
    return make_hit(
        "rectangle",
        df,
        start_pos=x0,
        end_pos=x1,
        breakout_level=breakout,
        opposite_extreme=opposite,
        pattern_height=res - sup,
        touches=touch_res + touch_sup,
        r2=r2,
        trendlines=[
            segment_points(df, x0, val(eu, x0), x1, res),
            segment_points(df, x0, val(el, x0), x1, sup),
        ],
        notes=notes,
        direction=direction,
        pivots=pivot_markers(df, H, L, x0, x1),
    )


def detect_rectangle(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Rectangle / unresolved range (neutral continuation).

    A horizontal resistance and support each touched >=2 times, with price
    oscillating between them (both trendline drifts < 3% of price over the span
    they are drawn across). Scanned over several trailing windows so a recent
    range is not masked by a longer trend. Breakout is the side price actually
    resolves — the upper edge on an upside break (default, `neutral`) or the
    lower edge on a downside break (short geometry); measured move = range
    height.
    """
    ctx = ctx or {}
    hits = []
    seen = set()
    for lookback in WINDOWS:
        win = window_slice(df, lookback, 40)
        if win is None:
            continue
        start, end = win
        hit = _rectangle_once(df, ctx, start, end)
        if hit is not None and (hit.start_date, hit.end_date) not in seen:
            seen.add((hit.start_date, hit.end_date))
            hits.append(hit)
    return hits


# ---------------------------------------------------------------------------
# Triangles
# ---------------------------------------------------------------------------


def _triangle_once(df: pd.DataFrame, ctx: dict, start: int, end: int, ascending: bool):
    if end <= 0:
        return None
    pair = _fit_pair(df, ctx, start, max_pivots=None)
    if pair is None:
        return None
    H, L, (_, _, r2u), (_, _, r2l) = pair
    atr_val = F.atr_value(df)
    if atr_val <= 0:
        return None
    eu, el = envelope_pair(df, H, L, atr_val)
    if eu is None or el is None:
        return None
    x0 = max(eu["x0"], el["x0"])
    x1 = min(eu["x1"], el["x1"])
    if x1 - x0 < 10:
        return None

    def val(env, x):
        return env["q0"] + env["slope"] * (x - env["x0"])

    mp = mean_price_fn(df, x0, x1)
    if mp <= 0:
        return None
    span = x1 - x0
    w_start = val(eu, x0) - val(el, x0)
    w_end = val(eu, x1) - val(el, x1)
    if not (w_start > 0 and w_end > 0 and w_end < w_start * 0.8):
        return None
    su, sl = eu["slope"], el["slope"]

    if ascending:
        if not F.is_horizontal(su, span, mp, tol=0.04):
            return None
        if F.relative_slope(sl, span, mp) < 0.03:
            return None
        if val(eu, x1) <= val(el, x1):
            return None
        breakout = val(eu, x1)
        pid, opposite, direction = "ascending_triangle", None, "bullish"
        notes = f"ascending triangle; resistance {val(eu, x1):.4g}, rising support slope {sl:.4g}"
    else:
        if not F.is_horizontal(sl, span, mp, tol=0.04):
            return None
        if F.relative_slope(su, span, mp) > -0.03:
            return None
        if val(eu, x1) <= val(el, x1):
            return None
        breakout = val(el, x1)
        pid, opposite, direction = "descending_triangle", None, "bearish"
        notes = f"descending triangle; support {val(el, x1):.4g}, falling resistance slope {su:.4g}"

    if F.penetration_ratio(df, eu["slope"], eu["intercept"], x0, x1, "upper", atr_val) > PENETRATION_MAX:
        return None
    if F.penetration_ratio(df, el["slope"], el["intercept"], x0, x1, "lower", atr_val) > PENETRATION_MAX:
        return None
    # Bullish ascending triangle: if price closed back *below* the rising support
    # it resolved the wrong way — reject rather than label it an upside break.
    if ascending and _broke_opposite(df, val(el, x1), "bullish", atr_val):
        return None
    r2 = min(r2u, r2l)
    if r2 < 0.5:
        return None
    hi, lo, _, _ = F.swing_extremes(df, x0, x1)
    opposite = lo if ascending else hi
    touches = F.count_touches(H, eu["slope"], eu["intercept"], atr_val) + F.count_touches(L, el["slope"], el["intercept"], atr_val)
    return make_hit(
        pid,
        df,
        start_pos=min(eu["x0"], el["x0"]),
        end_pos=max(eu["x1"], el["x1"]),
        breakout_level=breakout,
        opposite_extreme=opposite,
        pattern_height=hi - lo,
        touches=touches,
        r2=r2,
        trendlines=[
            segment_points(df, eu["x0"], eu["q0"], eu["x1"], eu["q1"]),
            segment_points(df, el["x0"], el["q0"], el["x1"], el["q1"]),
        ],
        notes=notes,
        direction=direction,
        pivots=pivot_markers(df, H, L, x0, x1),
    )


def _triangle_impl(df: pd.DataFrame, ctx: dict, ascending: bool) -> list:
    hits = []
    seen = set()
    for lookback in WINDOWS:
        win = window_slice(df, lookback, 30)
        if win is None:
            continue
        start, end = win
        hit = _triangle_once(df, ctx, start, end, ascending)
        if hit is not None and (hit.start_date, hit.end_date) not in seen:
            seen.add((hit.start_date, hit.end_date))
            hits.append(hit)
    return hits


def detect_ascending_triangle(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Ascending Triangle (bullish continuation).

    Flat resistance (|drift| < 4% of price) with a rising support (>=3% drift)
    converging into it. Breakout is up through resistance; measured move =
    window high-low range. Rejected when price closes back below the rising
    support (the opposite of the bullish resolution).
    """
    return _triangle_impl(df, ctx or {}, ascending=True)


def detect_descending_triangle(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Descending Triangle (bearish continuation). Flat support + falling high."""
    return _triangle_impl(df, ctx or {}, ascending=False)


# ---------------------------------------------------------------------------
# registration
# ---------------------------------------------------------------------------

register("ascending_channel", detect_ascending_channel)
register("descending_channel", detect_descending_channel)
register("bull_flag", detect_bull_flag)
register("bear_flag", detect_bear_flag)
register("pennant", detect_pennant)
register("rectangle", detect_rectangle)
register("ascending_triangle", detect_ascending_triangle)
register("descending_triangle", detect_descending_triangle)

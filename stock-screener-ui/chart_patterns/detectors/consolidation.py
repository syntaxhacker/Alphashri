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

A trailing breakout/breakdown leg is trimmed off the box before the edges are
measured, so a breakdown that runs to a new low no longer drags the support (and
the drawn lower edge) down with it.
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
# A trailing run of >= this many bars closing beyond the box (by more than
# ``BREAKOUT_TOL_ATR * ATR``) is a breakout/breakdown leg, not part of the base.
# Trimming it keeps the box edges on the base: a breakdown that runs to a new
# low must not drag the lower boundary (and the drawn box) down with it.
# ``1`` so a fresh single-bar breakout (today's bar) is trimmed too and the base
# it broke out of is still reported — otherwise a same-day breakout hides the
# base because the raw window's last close sits at the top of the range.
BREAKOUT_MIN_BARS = 1
BREAKOUT_TOL_ATR = 0.25


def _calendar_days(df: pd.DataFrame, start: int, end: int) -> int:
    """Calendar-day span of the bar window ``[start, end]`` (bar count fallback).

    ``base_days`` is labelled (and filtered) in days, but windows are scanned
    in bars; on intraday frames a 120-bar base is hours, not days. Mirrors the
    ``_bar_gap_days`` helper in ``detectors/reversal.py``.
    """
    try:
        span = abs(float((df.index[int(end)] - df.index[int(start)]).days))
        return int(span)
    except (AttributeError, TypeError, IndexError, ValueError):
        return int(abs(int(end) - int(start)))


def _tightness(range_pct: float, range_max: float) -> float:
    """Simple tightness score in ``[0.5, 1.0]`` (1.0 = dead-flat base).

    Floored at 0.5 so a genuine base never scores as ``marginal`` purely for
    having a wide-but-still-acceptable range.
    """
    score = 1.0 - float(range_pct) / (2.0 * max(float(range_max), 1e-9))
    return round(float(min(1.0, max(0.5, score))), 3)


class _BaseScan:
    """One-shot NumPy view of a frame for base-box measurement.

    The consolidation scan calls :func:`_window_base` ~600 times per symbol
    (every candidate end in :func:`_trailing_base_end`, for each of the 6
    windows). Each call used to re-``astype`` all three price columns and
    re-slice via pandas ``.iloc``. The OHLCV columns are converted **once**
    here; every window metric is then a cheap NumPy slice reduction plus the
    same :func:`linreg_fit` call as before, and per-``(start, end)`` metrics
    are memoized so the trailing-trim loop, its walk-back and the final
    validation share each box instead of recomputing it.
    """

    __slots__ = ("high", "low", "close", "n", "_memo", "_xs")

    def __init__(self, df: pd.DataFrame):
        self.high = df["high"].to_numpy(dtype=float)
        self.low = df["low"].to_numpy(dtype=float)
        self.close = df["close"].to_numpy(dtype=float)
        self.n = len(df)
        self._memo: dict[tuple[int, int], dict | None] = {}
        self._xs = np.arange(self.n, dtype=float)

    def metrics(self, start: int, end: int) -> dict | None:
        """Box metrics for ``[start, end]`` (range + near-flat), memoized.

        Returns ``None`` when the window is not a tight flat box. The
        mid-box ``range_pos`` guard is applied by the caller (detection skips
        it for the trailing-trim search, validation applies it) so one cache
        entry serves both.
        """
        start, end = int(start), int(end)
        key = (start, end)
        if key in self._memo:
            return self._memo[key]
        box = self._compute(start, end)
        self._memo[key] = box
        return box

    def _compute(self, start: int, end: int) -> dict | None:
        if end < start or start < 0 or end >= self.n:
            return None
        seg_h = self.high[start : end + 1]
        seg_l = self.low[start : end + 1]
        seg_c = self.close[start : end + 1]
        # ``nanmax``/``nanmin`` match pandas ``.max()``/``.min()`` (skipna);
        # ``nanmean`` matched pandas ``.mean()`` bit-for-bit on 1000 real
        # window slices (no bottleneck in this env).
        hi = float(np.nanmax(seg_h))
        lo = float(np.nanmin(seg_l))
        mp = float(np.nanmean(seg_c))
        if hi <= lo or mp <= 0:
            return None
        range_pct = (hi - lo) / mp * 100.0
        if range_pct > RANGE_MAX or range_pct < MIN_RANGE_PCT:
            return None
        last = float(self.close[end])
        range_pos = (last - lo) / (hi - lo) * 100.0
        beta, _intercept, _r2 = F.linreg_fit(
            self._xs[start : end + 1], seg_c
        )
        if abs(F.relative_slope(beta, end - start + 1, mp)) > NEAR_FLAT_MAX:
            return None
        return {
            "start": start,
            "end": end,
            "hi": hi,
            "lo": lo,
            "mp": mp,
            "range_pct": range_pct,
            "range_pos": range_pos,
        }

    def window_base(
        self, start: int, end: int, w: int, check_pos: bool = True
    ) -> dict | None:
        """Memoized :func:`_window_base` equivalent over the cached arrays."""
        box = self.metrics(start, end)
        if box is None:
            return None
        if check_pos and not (POS_MIN <= box["range_pos"] <= POS_MAX):
            return None
        return {**box, "w": w}

    def trailing_base_end(self, start: int, end: int, atr_val: float) -> int:
        """Memoized :func:`_trailing_base_end` equivalent (see its docstring)."""
        start, end = int(start), int(end)
        if end - start + 1 <= MIN_BARS:
            return end
        tol = BREAKOUT_TOL_ATR * max(float(atr_val), 0.0)
        close = self.close
        k = int(end)
        for cand in range(int(end) - 1, int(start) + MIN_BARS - 2, -1):
            base = self.metrics(start, cand)
            if base is None:
                continue
            tail = close[cand + 1 : end + 1]
            if len(tail) < BREAKOUT_MIN_BARS:
                continue
            if bool((tail < base["lo"] - tol).all()) or bool((tail > base["hi"] + tol).all()):
                k = cand
                break
        while k - 1 >= int(start) + MIN_BARS - 1:
            prev = self.metrics(start, k - 1)
            if prev is None:
                break
            if prev["lo"] <= close[k] <= prev["hi"]:
                break
            k -= 1
        return k


def _scan_of(df: pd.DataFrame) -> _BaseScan:
    """Fresh :class:`_BaseScan` for ``df`` (memo lives for one scan only)."""
    return _BaseScan(df)


def _window_base(
    df: pd.DataFrame, start: int, end: int, w: int, check_pos: bool = True
):
    """Metrics for the trailing base in ``[start, end]`` or ``None`` if no base.

    ``check_pos`` gates the "last close sits mid-box" guard. Detection uses it to
    reject windows already mid-breakout, but the trailing-breakout trim skips it
    (a base legitimately ends at the edge where price leaves the box).
    """
    return _scan_of(df).window_base(start, end, w, check_pos=check_pos)


def _trailing_base_end(
    df: pd.DataFrame, start: int, end: int, atr_val: float
) -> int:
    """Last bar of the base before a trailing breakout, else ``end``.

    Finds the largest sub-window ``[start, k]`` that is still a range-bound base
    (range + near-flat; the mid-box position guard is skipped because a base
    ends where price leaves the box) whose *following* bars all close beyond
    that sub-window's box. The end is then walked back past any leading breakout
    bar so the first bar to leave the box is excluded from the base. This keeps
    a breakout/breakdown leg from dragging the box edges — and the drawn box —
    with it (e.g. a breakdown running to a new low no longer sets the support).
    """
    return _scan_of(df).trailing_base_end(start, end, atr_val)


def _range_bound_swings(
    highs: list, lows: list, start: int, end: int, hi: float, lo: float, atr_val: float
) -> bool:
    """Two-sided oscillation check over pre-fetched swing lists.

    Requires **at least two touches on each edge** and a retest of both edges in
    the **second half** of the window. One touch per edge anywhere is too weak:

    * a slow uptrend whose low is months stale (KOTAKBANK 1D, Apr→Oct 2026: low
      363 last touched May, lows then stepping 368→386→394 while highs ran
      386→413→435) passed on a single old low + a late high — the recency check
      rejects it;
    * a V-shape (decline to a low, then a rally to the box top — DRREDDY 1D,
      Aug→Oct 2026) touches each edge once, with the low at the midpoint —
      requiring ≥2 touches per edge rejects it.

    A genuine base swings back and forth, testing each edge repeatedly.
    """
    start, end = int(start), int(end)
    H = [(p, q) for p, q in highs if start <= p <= end]
    L = [(p, q) for p, q in lows if start <= p <= end]
    if not H or not L:
        return False
    # Two-sided oscillation in **both halves**: each half must touch both edges.
    # A single touch per edge anywhere lets a V-shape or a drift masquerade as a
    # range: a V tests one edge in the first half and the other in the second
    # (KOTAKBANK 1D; DRREDDY 1D *and* 1h), so one half never touches both.
    # Genuine bases swing back and forth throughout and pass easily.
    mid = start + (end - start) // 2
    for seg_lo, seg_hi in ((start, mid - 1), (mid, end)):
        if seg_hi < seg_lo:
            continue
        seg_h = [(p, q) for p, q in H if seg_lo <= p <= seg_hi]
        seg_l = [(p, q) for p, q in L if seg_lo <= p <= seg_hi]
        if F.count_touches(seg_h, 0.0, hi, atr_val, tol_atr=TOUCH_TOL_ATR) < 1:
            return False
        if F.count_touches(seg_l, 0.0, lo, atr_val, tol_atr=TOUCH_TOL_ATR) < 1:
            return False
    return True


def _is_range_bound(
    df: pd.DataFrame, ctx: dict | None, start: int, end: int, hi: float, lo: float, atr_val: float
) -> bool:
    """True when price oscillates inside the box — touches **both** edges.

    The mid-box position guard (``POS_MIN..POS_MAX``) rejects a window whose last
    close is at the top of the range, which is exactly what a base looks like on
    the bar it breaks out. For a breakout leg the base is instead validated by
    two-sided oscillation: a real base swings back and forth (swing highs near
    ``hi`` *and* swing lows near ``lo``), whereas a monotonic trend rides one
    edge and produces touches on a single side only.
    """
    highs, lows = get_swings(df, ctx)
    return _range_bound_swings(highs, lows, start, end, hi, lo, atr_val)


def detect_consolidation(df: pd.DataFrame, ctx: dict | None = None) -> list:
    """Consolidation (neutral continuation; long tight base with upside geometry).

    Scans trailing windows ``WINDOWS`` and reports the **longest** one that is a
    genuine base: range ``<= RANGE_MAX`` (default 20%, env
    ``PATTERN_CONSOLIDATION_MAX_RANGE_PCT``), two-sided oscillation inside the
    box (swing highs near the top *and* swing lows near the bottom, via
    ``_is_range_bound``) and close near-flat over the window
    (``|relative slope| <= 0.12``). A trailing breakout leg is then trimmed so
    the box edges (and drawn box) stop at the base rather than at the breakout
    extreme. Metric tools tightly bound a horizontal base but let genuine
    multi-month bases through. Breakout is the box high with the box low as the
    measured-move / stop anchor (``direction="neutral"``, long geometry). Emits
    at most one hit per symbol.
    """
    ctx = ctx or {}
    n = len(df)
    if n < MIN_BARS:
        return []

    atr_val = F.atr_value(df)
    # One array conversion + one memo for the whole scan: the 6 trailing
    # windows share ``end`` and the trim loop re-asks the same ``(start, cand)``
    # boxes (walk-back, final validation) instead of recomputing them.
    scan = _scan_of(df)
    # Swing pivots are frame-level: fetch once (also warms the ``ctx`` cache
    # for the other detectors sharing this call's ``ctx``) and filter per
    # window, instead of re-fetching per window.
    swings = get_swings(df, ctx)
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
        # Trim a trailing breakout/breakdown leg FIRST so the box is measured on
        # the base, not on the breakout bar. Validating the raw window first
        # (as before) hid every fresh breakout: the breakout bar inflates the
        # range and pushes the last close to the top of the window.
        box_end = scan.trailing_base_end(start, end, atr_val)
        base = scan.window_base(start, box_end, w, check_pos=False)
        if base is None:
            continue
        # Both cases (breakout leg or not) require the base to oscillate
        # (touch both edges) so a monotonic trend — whose last close also
        # sits at the top of the range — is still rejected.
        if not _range_bound_swings(swings[0], swings[1], start, box_end, base["hi"], base["lo"], atr_val):
            continue
        base["span"] = base["end"] - base["start"] + 1
        if best is None or base["span"] > best["span"]:
            best = base

    if best is None:
        return []

    start, end = best["start"], best["end"]
    hi, lo = best["hi"], best["lo"]
    range_pct, range_pos = best["range_pct"], best["range_pos"]
    base_days = _calendar_days(df, start, end)

    highs, lows = swings
    H = [(p, q) for p, q in highs if start <= p <= end]
    L = [(p, q) for p, q in lows if start <= p <= end]
    touches = 1
    if atr_val > 0:
        touches = max(
            1,
            F.count_touches(highs, 0.0, hi, atr_val, tol_atr=TOUCH_TOL_ATR)
            + F.count_touches(lows, 0.0, lo, atr_val, tol_atr=TOUCH_TOL_ATR),
        )

    notes = f"consolidation {base_days}d; range {range_pct:.1f}%, pos {range_pos:.0f}%"
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
            base_days=base_days,
            range_pct=range_pct,
            range_pos=range_pos,
        )
    ]


register("consolidation", detect_consolidation)

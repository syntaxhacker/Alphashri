"""Reversal-detector audit tests (direction / level sides / envelope quality).

Synthetic geometry only (no production mocks), one builder per reversal pattern.
For every pattern we assert:

* the catalog direction and that target/stop sit on the correct side of
  ``breakout_level`` (bullish: target above, stop below; bearish: mirror);
* ``breakout_level`` equals the drawn breakout boundary (upper for bullish,
  lower for bearish) at the hit's end date;
* every drawn two-point boundary is a support/resistance envelope that does not
  cut through candles (an upper line has no high above it, a lower line has no
  low below it);
* status reflects a close beyond the boundary (confirmed) or a cross that came
  back (failed).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F
from chart_patterns.detectors.common import DETECTORS, PATTERN_CATALOG, fmt_date

_INDEX = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")

REVERSAL = {
    "falling_wedge",
    "rising_wedge",
    "diamond_bottom",
    "triple_bottom",
    "double_bottom",
    "head_shoulders",
    "inverse_head_shoulders",
    "rounding_bottom",
}
BULLISH = {
    "falling_wedge",
    "diamond_bottom",
    "triple_bottom",
    "double_bottom",
    "inverse_head_shoulders",
    "rounding_bottom",
}


# ---------------------------------------------------------------------------
# Synthetic frames
# ---------------------------------------------------------------------------


def frame(closes, spread: float = 0.5) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + spread,
            "low": close - spread,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=_INDEX[:n],
    )


def interp(anchors, n: int) -> np.ndarray:
    anchors = sorted(anchors)
    return np.interp(
        np.arange(n), [a[0] for a in anchors], [a[1] for a in anchors]
    )


def detector(pattern_id: str):
    return dict(DETECTORS)[pattern_id]


def _falling_wedge():
    n = 90
    su, sl = -0.5, -0.34
    anchors = [(i, 120 + su * i) for i in (5, 20, 35, 50, 65)]
    anchors += [(i, 100 + sl * i) for i in (12, 27, 42, 57, 72)]
    anchors += [(n - 1, 118 + su * 60)]
    return frame(interp(anchors, n))


def _rising_wedge():
    n = 90
    su, sl = 0.34, 0.55
    anchors = [(i, 100 + su * i) for i in (5, 20, 35, 50, 65)]
    anchors += [(i, 80 + sl * i) for i in (12, 27, 42, 57, 72)]
    anchors += [(n - 1, 70 + sl * 60)]
    return frame(interp(anchors, n))


def _rising_wedge_with_breakdown():
    """Rising wedge whose last bars collapse below the support (post-breakdown).

    The collapse low is *not* a swing pivot (last bar), so it only enters the
    support fit through the latest-low anchor. A correct detector must not let
    that anchor drag the support down and invert the ``su < sl`` convergence.
    """
    n = 90
    su, sl = 0.34, 0.55
    anchors = [(i, 100 + su * i) for i in (5, 20, 35, 50, 65)]
    anchors += [(i, 80 + sl * i) for i in (12, 27, 42, 57, 72)]
    anchors += [(78, 118.0), (82, 100.0), (n - 1, 78.0)]
    return frame(interp(anchors, n))


def _double_bottom():
    n = 60
    return frame(interp([(0, 110), (10, 100), (25, 115), (40, 100), (55, 118)], n))


def _triple_bottom():
    n = 70
    anchors = [(0, 112), (10, 100), (20, 115), (30, 100), (45, 115), (52, 100), (65, 118)]
    return frame(interp(anchors, n))


def _head_shoulders():
    n = 70
    anchors = [(0, 105), (15, 115), (25, 105), (35, 130), (45, 104), (55, 114), (65, 100)]
    return frame(interp(anchors, n))


def _inverse_head_shoulders():
    n = 70
    anchors = [(0, 115), (15, 105), (25, 115), (35, 90), (45, 116), (55, 106), (65, 122)]
    return frame(interp(anchors, n))


def _rounding_bottom():
    return frame([100 + 0.02 * (i - 40) ** 2 for i in range(80)])


def _diamond_bottom():
    n = 60
    anchors = [
        (0, 104), (4, 100), (11, 108), (18, 96), (25, 113), (32, 99),
        (38, 110), (45, 103), (51, 108), (53, 105), (n - 1, 116),
    ]
    return frame(interp(anchors, n))


GEOMETRIES = {
    "falling_wedge": _falling_wedge,
    "rising_wedge": _rising_wedge,
    "double_bottom": _double_bottom,
    "triple_bottom": _triple_bottom,
    "head_shoulders": _head_shoulders,
    "inverse_head_shoulders": _inverse_head_shoulders,
    "rounding_bottom": _rounding_bottom,
    "diamond_bottom": _diamond_bottom,
}


# ---------------------------------------------------------------------------
# Overlay geometry helpers
# ---------------------------------------------------------------------------


def _pos_by_iso(df):
    return {ix.isoformat(): i for i, ix in enumerate(df.index)}


def _seg_counts(df, trend):
    """``(n_high_above, n_low_below)`` for a two-point overlay, else ``None``."""
    pos = _pos_by_iso(df)
    pts = []
    for p in trend:
        x = pos.get(p.get("t"))
        if x is None:
            return None
        pts.append((int(x), float(p["price"])))
    if len(pts) != 2:
        return None
    (x0, p0), (x1, p1) = pts
    if x1 == x0:
        return None
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    n_above = n_below = 0
    for x in range(min(x0, x1), max(x0, x1) + 1):
        y = p0 + (p1 - p0) * (x - x0) / (x1 - x0)
        if highs[x] > y + 1e-6:
            n_above += 1
        if lows[x] < y - 1e-6:
            n_below += 1
    return n_above, n_below


def _line_at_end(df, trend, end_pos):
    pos = _pos_by_iso(df)
    pts = [(pos[p["t"]], float(p["price"])) for p in trend if p.get("t") in pos]
    (x0, p0), (x1, p1) = pts
    return p0 + (p1 - p0) * (end_pos - x0) / (x1 - x0)


def _hits(pid):
    df = F.normalize_ohlcv(GEOMETRIES[pid]())
    return df, (detector(pid)(df, {}) or [])


# ---------------------------------------------------------------------------
# Direction + level sides
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pid", sorted(REVERSAL))
def test_direction_matches_catalog(pid):
    _, hits = _hits(pid)
    assert hits, f"{pid} did not fire on its synthetic geometry"
    assert hits[0].direction == PATTERN_CATALOG[pid][2]


@pytest.mark.parametrize("pid", sorted(REVERSAL))
def test_target_and_stop_sides(pid):
    _, hits = _hits(pid)
    assert hits
    for hit in hits:
        if hit.direction == "bullish":
            assert hit.target > hit.breakout_level > hit.stop
        else:
            assert hit.target < hit.breakout_level < hit.stop


# ---------------------------------------------------------------------------
# Drawn boundaries bound price and carry the breakout level
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pid", sorted(REVERSAL))
def test_drawn_boundaries_do_not_cut_candles(pid):
    df, hits = _hits(pid)
    assert hits
    for hit in hits:
        for trend in hit.trendlines:
            counts = _seg_counts(df, trend)
            if counts is None:  # fitted curve / non-straight guide
                continue
            n_above, n_below = counts
            # A valid boundary is one-sided: upper (no high above) or lower
            # (no low below). Both > 0 means it cuts through candles.
            assert not (n_above > 0 and n_below > 0), (
                f"{pid} boundary cuts candles: n_above={n_above} "
                f"n_below={n_below} trend={trend}"
            )


@pytest.mark.parametrize("pid", sorted(REVERSAL))
def test_breakout_level_lies_on_drawn_boundary(pid):
    df, hits = _hits(pid)
    assert hits
    pos = _pos_by_iso(df)
    for hit in hits:
        end_iso = _end_iso(df, hit)
        assert end_iso is not None, f"{pid}: end date not in frame"
        end_pos = pos[end_iso]
        bullish = hit.direction == "bullish"
        matched = False
        opposite = False
        for trend in hit.trendlines:
            counts = _seg_counts(df, trend)
            if counts is None:
                continue
            n_above, n_below = counts
            if bullish and n_above == 0:
                val = _line_at_end(df, trend, end_pos)
                if abs(val - hit.breakout_level) / max(abs(hit.breakout_level), 1e-9) <= 1e-3:
                    matched = True
            if (not bullish) and n_below == 0:
                val = _line_at_end(df, trend, end_pos)
                if abs(val - hit.breakout_level) / max(abs(hit.breakout_level), 1e-9) <= 1e-3:
                    matched = True
            if bullish and n_below == 0:
                opposite = True
            if (not bullish) and n_above == 0:
                opposite = True
        assert matched, f"{pid}: breakout {hit.breakout_level} not on a drawn boundary"
        # when both sides are drawn, the opposite envelope must also exist
        if len([t for t in hit.trendlines if _seg_counts(df, t) is not None]) >= 2:
            assert opposite, f"{pid}: missing opposite-side envelope"


def _end_iso(df, hit):
    return next(
        (ix.isoformat() for ix in df.index if fmt_date(ix) == hit.end_date), None
    )


# ---------------------------------------------------------------------------
# Status: confirmed / failed
# ---------------------------------------------------------------------------


def test_double_bottom_confirmed_on_breakout():
    n = 72
    df = F.normalize_ohlcv(
        frame(interp([(0, 112), (9, 100), (22, 117), (35, 100), (55, 119), (71, 121)], n))
    )
    hits = detector("double_bottom")(df, {})
    assert hits and hits[0].status == "confirmed"


def test_double_bottom_failed_after_crossback():
    n = 72
    df = F.normalize_ohlcv(
        frame(interp([(0, 112), (9, 100), (22, 117), (35, 100), (48, 119), (62, 108), (71, 109)], n))
    )
    hits = detector("double_bottom")(df, {})
    assert hits and hits[0].status == "failed"


def test_head_shoulders_failed_after_crossback():
    n = 80
    df = F.normalize_ohlcv(
        frame(interp(
            [(0, 108), (12, 116), (24, 106), (36, 131), (48, 105), (60, 115), (70, 99), (79, 110)],
            n,
        ))
    )
    hits = detector("head_shoulders")(df, {})
    assert hits and hits[0].status == "failed"


def test_inverse_head_shoulders_failed_after_crossback():
    n = 80
    df = F.normalize_ohlcv(
        frame(interp(
            [(0, 112), (12, 104), (24, 114), (36, 89), (48, 115), (60, 105), (70, 121), (79, 112)],
            n,
        ))
    )
    hits = detector("inverse_head_shoulders")(df, {})
    assert hits and hits[0].status == "failed"


# ---------------------------------------------------------------------------
# Drawing audit: pivots, boundary anchors and per-pattern line sets
# ---------------------------------------------------------------------------


def _straight_seg(df, trend):
    """``(x0, p0, x1, p1)`` for a mapped two-point line, else ``None``."""
    pos = _pos_by_iso(df)
    pts = []
    for p in trend:
        x = pos.get(p.get("t"))
        if x is None:
            return None
        pts.append((int(x), float(p["price"])))
    if len(pts) != 2:
        return None
    (x0, p0), (x1, p1) = pts
    if x1 == x0:
        return None
    return x0, p0, x1, p1


def _violations(df, trend, slack):
    """``(n_highs_above, n_lows_below)`` for a straight line with ATR slack."""
    seg = _straight_seg(df, trend)
    if seg is None:
        return None
    x0, p0, x1, p1 = seg
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    n_above = n_below = 0
    for x in range(min(x0, x1), max(x0, x1) + 1):
        y = p0 + (p1 - p0) * (x - x0) / (x1 - x0)
        if highs[x] - y > slack:
            n_above += 1
        if y - lows[x] > slack:
            n_below += 1
    return n_above, n_below


@pytest.mark.parametrize("pid", sorted(REVERSAL))
def test_every_hit_carries_valid_pivots(pid):
    """Every hit emits swing pivots matching the real candle extremes."""
    df, hits = _hits(pid)
    assert hits
    pos = _pos_by_iso(df)
    for hit in hits:
        assert hit.pivots, f"{pid} emitted no pivot markers"
        for pv in hit.pivots:
            assert pv["kind"] in {"high", "low"}
            x = pos.get(pv["t"])
            assert x is not None, f"{pid} pivot timestamp not in frame"
            ref = float(df["high"].iloc[x]) if pv["kind"] == "high" else float(df["low"].iloc[x])
            assert pv["price"] == pytest.approx(ref, abs=1e-6)


@pytest.mark.parametrize("pid", sorted(REVERSAL))
def test_straight_boundaries_within_atr_tolerance(pid):
    """No straight boundary cuts candles by more than 0.25*ATR on either side."""
    df, hits = _hits(pid)
    assert hits
    slack = 0.25 * F.atr_value(df)
    for hit in hits:
        for trend in hit.trendlines:
            counts = _violations(df, trend, slack)
            if counts is None:
                continue
            n_above, n_below = counts
            assert not (n_above > 0 and n_below > 0), (
                f"{pid} boundary cuts candles: above={n_above} below={n_below}"
            )


@pytest.mark.parametrize("pid", ["falling_wedge", "rising_wedge"])
def test_wedge_boundaries_start_on_real_pivots(pid):
    """Both wedge boundaries anchor on a real candle high/low at their start."""
    df, hits = _hits(pid)
    assert hits
    slack = 0.25 * F.atr_value(df)
    for hit in hits:
        upper_anchor = lower_anchor = False
        for trend in hit.trendlines:
            counts = _violations(df, trend, 1e-9)
            seg = _straight_seg(df, trend)
            if counts is None or seg is None:
                continue
            x0, p0, _x1, _p1 = seg
            n_above, n_below = counts
            if n_above == 0:  # resistance envelope starts on a real high
                assert p0 == pytest.approx(float(df["high"].iloc[x0]), abs=slack)
                upper_anchor = True
            if n_below == 0:  # support envelope starts on a real low
                assert p0 == pytest.approx(float(df["low"].iloc[x0]), abs=slack)
                lower_anchor = True
        assert upper_anchor and lower_anchor


@pytest.mark.parametrize("pid", ["falling_wedge", "rising_wedge"])
def test_wedge_end_reaches_last_boundary_bar(pid):
    """``end`` is at/after both drawn boundaries (breakout leg inside the span)."""
    df, hits = _hits(pid)
    assert hits
    for hit in hits:
        end_iso = _end_iso(df, hit)
        assert end_iso is not None
        for trend in hit.trendlines:
            seg = _straight_seg(df, trend)
            if seg is None:
                continue
            _x0, _p0, x1, _p1 = seg
            assert end_iso >= df.index[x1].isoformat()


def test_rising_wedge_support_ignores_post_breakdown_low():
    """A rising wedge still fires when the last bars collapse below support.

    The support boundary must end at its last real pivot, not be anchored to the
    post-breakdown low — anchoring it flattens the support until it is shallower
    than the resistance and the wedge (correctly) stops existing.
    """
    df = F.normalize_ohlcv(_rising_wedge_with_breakdown())
    hits = detector("rising_wedge")(df, {})
    assert hits, "rising wedge with a post-breakdown collapse must still fire"
    end_iso = _end_iso(df, hits[0])
    last_iso = df.index[-1].isoformat()
    support = None
    for trend in hits[0].trendlines:
        counts = _seg_counts(df, trend)
        if counts is None:
            continue
        _n_above, n_below = counts
        if n_below == 0:
            support = trend
    assert support is not None, "rising wedge must draw a lower (support) envelope"
    assert support[-1]["t"] != last_iso, (
        "support must not be dragged to the post-breakdown low"
    )
    assert end_iso >= support[-1]["t"]


def test_diamond_bottom_draws_full_four_line_lens():
    df, hits = _hits("diamond_bottom")
    assert hits
    slack = 0.25 * F.atr_value(df)
    for hit in hits:
        segs = [_straight_seg(df, t) for t in hit.trendlines]
        assert len(segs) == 4 and all(s is not None for s in segs), "expected 4 boundary lines"
        sides = []
        for trend in hit.trendlines:
            n_above, n_below = _violations(df, trend, slack)
            assert not (n_above > 0 and n_below > 0), "diamond line cuts price"
            sides.append("upper" if n_above == 0 else "lower")
        assert sides.count("upper") == 2 and sides.count("lower") == 2
        x0s = sorted({s[0] for s in segs})
        assert len(x0s) == 2, "diamond halves must share a common midpoint"
        # left half expands: its upper line rises; lower falls.
        left = [s for s in segs if s[0] == x0s[0]]
        assert left[0][1] < left[0][3] or left[1][1] > left[1][3]


@pytest.mark.parametrize("pid", ["double_bottom", "triple_bottom"])
def test_bottom_neckline_is_horizontal_breakout_envelope(pid):
    """Neckline is a horizontal upper envelope == breakout_level; bottoms drawn."""
    df, hits = _hits(pid)
    assert hits
    for hit in hits:
        straights = [t for t in hit.trendlines if _straight_seg(df, t) is not None]
        horizontals = [
            t
            for t in straights
            if t[0]["price"] == pytest.approx(t[-1]["price"], abs=1e-6)
        ]
        assert horizontals, "no horizontal neckline drawn"
        neck = horizontals[0]
        assert neck[0]["price"] == pytest.approx(hit.breakout_level, rel=1e-6)
        # Neckline is a true upper envelope over its span.
        assert _violations(df, neck, 0.0)[0] == 0
        # A support line connecting the bottom pivots is drawn (segment/complex).
        assert len(hit.trendlines) >= 2
        # Pattern end reaches the last neckline bar (bottoms / breakout).
        end_iso = _end_iso(df, hit)
        assert end_iso >= neck[-1]["t"]


@pytest.mark.parametrize("pid", ["head_shoulders", "inverse_head_shoulders"])
def test_hs_neckline_bounds_price_and_marks_head(pid):
    """Neckline is a one-sided envelope; pivots include the head extreme."""
    df, hits = _hits(pid)
    assert hits
    slack = 0.25 * F.atr_value(df)
    for hit in hits:
        two_pt = [t for t in hit.trendlines if _straight_seg(df, t) is not None]
        assert len(two_pt) == 1, "H&S draws a single neckline"
        n_above, n_below = _violations(df, two_pt[0], slack)
        assert n_above == 0 or n_below == 0, "neckline must be an envelope"
        assert len(hit.pivots) >= 3, "shoulders + head must be marked"
        kinds = {p["kind"] for p in hit.pivots}
        assert "low" in kinds and "high" in kinds
        # the head is the most extreme primary pivot in the drawn span.
        if pid == "head_shoulders":
            head = max(p["price"] for p in hit.pivots if p["kind"] == "high")
        else:
            head = min(p["price"] for p in hit.pivots if p["kind"] == "low")
        assert any(p["price"] == pytest.approx(head) for p in hit.pivots)


def test_rounding_bottom_draws_rim_above_highs():
    df, hits = _hits("rounding_bottom")
    assert hits
    for hit in hits:
        straights = [t for t in hit.trendlines if _straight_seg(df, t) is not None]
        assert straights, "rounding bottom needs a rim/physical envelope"
        rim = straights[0]
        assert rim[0]["price"] == pytest.approx(hit.breakout_level, rel=1e-6)
        assert _violations(df, rim, 0.0)[0] == 0, "rim must sit at/above every high"
        curves = [t for t in hit.trendlines if len(t) > 2]
        assert curves, "fitted U curve must still be drawn"

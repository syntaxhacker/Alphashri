"""Continuation-pattern audit tests (direction, level sides, drawn boundaries).

Complements ``test_chart_patterns_detectors.py`` without touching it. For every
continuation pattern owned by ``chart_patterns/detectors/continuation.py`` this
suite asserts the geometric invariants that matter for a scanner:

* the reported direction matches the catalog,
* ``target`` / ``stop`` sit on the correct side of ``breakout_level``,
* ``breakout_level`` equals the **drawn** breakout boundary at the breakout
  point (upper boundary for bullish/neutral, lower for bearish),
* the drawn boundaries do not cut through price beyond the envelope tolerance,
* ``start_date``/``end_date`` cover both boundaries, and
* ``confirmed`` / ``failed`` status agrees with price crossing the breakout in
  the pattern direction.

All frames are synthetic (no production mocks, no network). The pennant frame
uses a genuinely *converging* consolidation so the detector can only fire on a
real symmetric triangle.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F
from chart_patterns.detectors import continuation as C
from chart_patterns.detectors.common import PATTERN_CATALOG, get_swings

_INDEX = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")

# Envelope tolerance used by ``F.envelope_line`` (0.25 * ATR). A boundary may
# legitimately sit this far inside the extreme candle; beyond it is a violation.
ENVELOPE_TOL = 0.25
VIOL_TOL = 0.30  # small epsilon on top of the envelope tolerance

# Drawn-line role per pattern (matches the order of ``hit.trendlines``).
ROLES = {
    "ascending_channel": ["upper", "lower"],
    "descending_channel": ["upper", "lower"],
    "rectangle": ["upper", "lower"],
    "ascending_triangle": ["upper", "lower"],
    "descending_triangle": ["upper", "lower"],
    "pennant": ["upper", "lower"],
    "bull_flag": ["other", "upper", "lower"],
    "bear_flag": ["other", "upper", "lower"],
}

OWNED = sorted(ROLES)


# ---------------------------------------------------------------------------
# frame helpers
# ---------------------------------------------------------------------------


def frame(closes, spread: float = 0.5, high_cap=None, volume=None) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    high = close + spread
    if high_cap is not None:
        high = np.minimum(high, np.asarray(high_cap, dtype=float))
    vol = np.full(n, 1000.0) if volume is None else np.asarray(volume, dtype=float)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": high,
            "low": close - spread,
            "close": close,
            "volume": vol,
        },
        index=_INDEX[:n],
    )


def frame_hl(high, low, close) -> pd.DataFrame:
    close = np.asarray(close, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": np.asarray(high, dtype=float),
            "low": np.asarray(low, dtype=float),
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
    return getattr(C, f"detect_{pattern_id}")


# ---------------------------------------------------------------------------
# geometries
# ---------------------------------------------------------------------------


def _ascending_channel():
    n = 90
    anchors = [(i, 100 + 0.5 * i) for i in (5, 20, 35, 50, 65)]
    anchors += [(i, 90 + 0.5 * i) for i in (12, 27, 42, 57, 72)]
    return frame(interp(anchors, n))


def _descending_channel():
    n = 90
    anchors = [(i, 120 - 0.5 * i) for i in (5, 20, 35, 50, 65)]
    anchors += [(i, 110 - 0.5 * i) for i in (12, 27, 42, 57, 72)]
    return frame(interp(anchors, n))


def _rectangle():
    n = 90
    anchors = [(i, 120) for i in (5, 22, 40, 58, 76)] + [(i, 100) for i in (13, 31, 49, 67)]
    return frame(interp(anchors, n))


def _ascending_triangle():
    n = 90
    anchors = [(i, 120) for i in (5, 25, 45, 62)]
    anchors += [(12, 100), (32, 106), (52, 113), (70, 118), (n - 1, 124)]
    return frame(interp(anchors, n), high_cap=120)


def _descending_triangle():
    n = 90
    anchors = [(i, 100) for i in (12, 32, 52, 70)]
    anchors += [(5, 120), (25, 114), (45, 107), (62, 103), (n - 1, 96)]
    return frame(interp(anchors, n))


def _bull_flag():
    n = 60
    return frame(interp([(0, 100), (38, 100), (48, 130), (n - 1, 126)], n))


def _bear_flag():
    n = 60
    return frame(interp([(0, 130), (38, 130), (48, 100), (n - 1, 104)], n))


def _pennant(converge: bool = True):
    """Pole (100 -> 112 over 8 bars) then a 13-bar consolidation.

    With ``converge=True`` the boundary half-width shrinks from 3.0 to 0.6
    (a real symmetric triangle). With ``converge=False`` it holds roughly flat,
    which must NOT be accepted as a pennant.
    """
    n = 80
    close = np.full(n, 100.0)
    high = close + 0.5
    low = close - 0.5
    for i in range(59, 68):
        c = 100 + (112 - 100) * (i - 59) / 8.0
        close[i] = c
        high[i] = c + 0.5
        low[i] = c - 0.5
    for k, i in enumerate(range(67, 80)):
        half = (3.0 - 0.20 * k) if converge else (2.0 + 0.02 * k)
        center = 110.0
        wig = 0.35 * np.sin(k)
        close[i] = center + half * (1 if k % 2 == 0 else -1)
        high[i] = center + half + wig
        low[i] = center - half - wig
    return frame_hl(high, low, close)


GEOMETRIES = {
    "ascending_channel": _ascending_channel,
    "descending_channel": _descending_channel,
    "rectangle": _rectangle,
    "ascending_triangle": _ascending_triangle,
    "descending_triangle": _descending_triangle,
    "bull_flag": _bull_flag,
    "bear_flag": _bear_flag,
    "pennant": _pennant,
}


# ---------------------------------------------------------------------------
# Extra geometries for the regression guards (not part of GEOMETRIES)
# ---------------------------------------------------------------------------


def _descending_channel_broken_up():
    """A clean descending channel that then rallies through its upper edge."""
    base = _descending_channel()
    c = np.asarray(base["close"]).copy()
    rally = np.linspace(c[-1], 165.0, 15)
    return frame(np.concatenate([c, rally[1:]]))


def _ascending_triangle_broken_down():
    """An ascending triangle whose price closes back below rising support."""
    d = _ascending_triangle()
    c = np.asarray(d["close"]).copy()
    c[-2] = 100.0
    c[-1] = 95.0
    return frame(c, high_cap=120)


def _pennant_with_halfs(halfs):
    """Pennant pole + consolidation whose half-width follows ``halfs``."""
    close = np.full(80, 100.0)
    high = close + 0.5
    low = close - 0.5
    for i in range(59, 68):
        c = 100 + (112 - 100) * (i - 59) / 8.0
        close[i] = c
        high[i] = c + 0.5
        low[i] = c - 0.5
    for k, i in enumerate(range(67, 80)):
        half = halfs[k]
        center = 110.0
        close[i] = center + half * (1 if k % 2 == 0 else -1)
        high[i] = center + half + 0.35 * np.sin(k)
        low[i] = center - half - 0.35 * np.sin(k)
    return frame_hl(high, low, close)


def _pennant_weak():
    """Barely converging triangle: end < start but not clearly < mid.

    This is the ADANIPORTS-style case that must be rejected — the right edge is
    "about the same width" as the middle, so it is not a real pennant.
    """
    return _pennant_with_halfs([3.0 - 0.10 * k for k in range(13)])


def _rectangle_sloped():
    """Both edges drift down ~7% — a descending channel, not a rectangle."""
    n = 90
    anchors = [(i, 130 - 0.25 * i) for i in (5, 22, 40, 58, 76)]
    anchors += [(i, 110 - 0.25 * i) for i in (13, 31, 49, 67)]
    return frame(interp(anchors, n))


def _ascending_channel_broken_down():
    """Ascending channel that then closes below its lower edge (opposite break)."""
    base = _ascending_channel()
    c = np.asarray(base["close"]).copy()
    drop = np.linspace(c[-1], 80.0, 15)
    return frame(np.concatenate([c, drop[1:]]))


def _bull_flag_wavy_pole():
    """Bull flag with a wavy pole so >=2 swing highs live inside the pole."""
    n = 60
    pts = [(0, 100), (30, 100), (34, 112), (37, 106), (40, 128), (43, 122),
           (48, 130), (n - 1, 126)]
    return frame(interp(pts, n))


def _bear_flag_wavy_pole():
    """Bear flag with a wavy pole so >=2 swing lows live inside the pole."""
    n = 60
    pts = [(0, 130), (30, 130), (34, 118), (37, 124), (40, 106), (43, 112),
           (48, 100), (n - 1, 104)]
    return frame(interp(pts, n))


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------


def _pos_map(df):
    iso = {df.index[i].isoformat(): i for i in range(len(df))}
    fmt = {}
    for i in range(len(df)):
        fmt.setdefault(df.index[i].strftime("%Y-%m-%d"), i)
    iso.update(fmt)
    return iso


def _line_at(line, pos, x):
    x0, q0 = pos[line[0]["t"]], float(line[0]["price"])
    x1, q1 = pos[line[1]["t"]], float(line[1]["price"])
    if x1 == x0:
        return q0
    return q0 + (q1 - q0) / (x1 - x0) * (x - x0)


def _boundary_stats(hit, df):
    """Return ``(max_excess_atr, n_beyond_tol)`` across the drawn boundaries."""
    atr = F.atr_value(df)
    pos = _pos_map(df)
    roles = ROLES[hit.pattern_id]
    high = df["high"].to_numpy(float)
    low = df["low"].to_numpy(float)
    max_exc = 0.0
    n_beyond = 0
    for i, line in enumerate(hit.trendlines):
        if i >= len(roles) or len(line) < 2:
            continue
        role = roles[i]
        if role == "other":
            continue
        x0, x1 = int(pos[line[0]["t"]]), int(pos[line[1]["t"]])
        for x in range(x0, x1 + 1):
            y = _line_at(line, pos, x)
            d = (high[x] - y) if role == "upper" else (y - low[x])
            if d > 0 and atr > 0:
                exc = d / atr
                max_exc = max(max_exc, exc)
                if exc > VIOL_TOL:
                    n_beyond += 1
    return max_exc, n_beyond


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pattern_id", OWNED)
def test_fires_on_own_geometry(pattern_id):
    hits = detector(pattern_id)(F.normalize_ohlcv(GEOMETRIES[pattern_id]()), {})
    assert hits, f"{pattern_id} did not fire on its synthetic geometry"


@pytest.mark.parametrize("pattern_id", OWNED)
def test_direction_matches_catalog(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    _name, family, direction = PATTERN_CATALOG[pattern_id]
    assert hit.family == family
    assert hit.direction == direction


@pytest.mark.parametrize("pattern_id", OWNED)
def test_target_stop_sides(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    b = hit.breakout_level
    if hit.direction == "bearish":
        assert hit.target < b, f"{pattern_id}: bearish target must be below breakout"
        assert hit.stop > b, f"{pattern_id}: bearish stop must be above breakout"
    else:  # bullish / neutral -> long geometry
        assert hit.target > b, f"{pattern_id}: target must be above breakout"
        assert hit.stop < b, f"{pattern_id}: stop must be below breakout"


@pytest.mark.parametrize("pattern_id", OWNED)
def test_breakout_level_is_on_drawn_boundary(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    roles = ROLES[pattern_id]
    pos = _pos_map(d)
    iu, il = roles.index("upper"), roles.index("lower")
    up, lo = hit.trendlines[iu], hit.trendlines[il]
    xu, xl = pos[up[1]["t"]], pos[lo[1]["t"]]
    cx = min(xu, xl)
    up_v = _line_at(up, pos, cx)
    lo_v = _line_at(lo, pos, cx)
    if hit.direction == "bearish":
        assert hit.breakout_level == pytest.approx(lo_v, rel=1e-6, abs=1e-3)
    else:
        assert hit.breakout_level == pytest.approx(up_v, rel=1e-6, abs=1e-3)


@pytest.mark.parametrize("pattern_id", OWNED)
def test_boundaries_bound_price(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    max_exc, n_beyond = _boundary_stats(hit, d)
    assert max_exc <= VIOL_TOL + 1e-9, f"{pattern_id}: boundary pokes {max_exc:.3f} ATR"
    assert n_beyond == 0, f"{pattern_id}: {n_beyond} candles beyond a drawn boundary"


@pytest.mark.parametrize("pattern_id", OWNED)
def test_span_covers_both_boundaries(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    pos = _pos_map(d)
    boundary = []
    for i, line in enumerate(hit.trendlines):
        if i < len(ROLES[pattern_id]) and len(line) >= 2:
            boundary.extend([pos[line[0]["t"]], pos[line[1]["t"]]])
    assert boundary
    start_pos, end_pos = pos[hit.start_date], pos[hit.end_date]
    assert start_pos <= min(boundary), f"{pattern_id}: start does not cover boundary"
    assert max(boundary) <= end_pos, f"{pattern_id}: end does not cover boundary"


@pytest.mark.parametrize("pattern_id", OWNED)
def test_status_matches_price_crossing(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    last = float(d["close"].iloc[-1])
    if hit.direction == "bearish":
        crossed = last < hit.breakout_level
        prior_beyond = (d["close"].iloc[:] < hit.breakout_level)
    else:
        crossed = last > hit.breakout_level
        prior_beyond = (d["close"].iloc[:] > hit.breakout_level)
    if hit.status == "confirmed":
        assert crossed, f"{pattern_id}: confirmed but price is not beyond breakout"
    if hit.status == "failed":
        assert not crossed, f"{pattern_id}: failed status but price is beyond breakout"
        assert bool(prior_beyond.any())


def test_pennant_requires_convergence():
    """A pole + flat consolidation is not a pennant; converging is."""
    conv = F.normalize_ohlcv(_pennant(converge=True))
    flat = F.normalize_ohlcv(_pennant(converge=False))
    assert C.detect_pennant(conv, {}), "converging pennant should fire"
    assert not C.detect_pennant(flat, {}), "flat consolidation must not be a pennant"


def test_pennant_direction_is_bullish():
    d = F.normalize_ohlcv(_pennant(converge=True))
    hit = C.detect_pennant(d, {})[0]
    assert hit.direction == "bullish"
    assert hit.target > hit.breakout_level
    assert hit.stop < hit.breakout_level


@pytest.mark.parametrize("pattern_id", OWNED)
def test_flags_breakout_meets_consolidation_box(pattern_id):
    """Flag breakout level must equal a box edge (dashed breakout meets box)."""
    if pattern_id not in {"bull_flag", "bear_flag"}:
        pytest.skip("flag-only check")
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    _name, _family, direction = PATTERN_CATALOG[pattern_id]
    upper = hit.trendlines[1]
    lower = hit.trendlines[2]
    if direction == "bearish":
        assert hit.breakout_level == pytest.approx(lower[0]["price"], abs=1e-3)
    else:
        assert hit.breakout_level == pytest.approx(upper[0]["price"], abs=1e-3)


# ---------------------------------------------------------------------------
# Regression guards for the reported viewing / correctness issues
# ---------------------------------------------------------------------------


def test_descending_channel_rejects_opposite_upper_break():
    """Price rallying through the upper edge invalidates a bearish channel."""
    clean = F.normalize_ohlcv(_descending_channel())
    broken = F.normalize_ohlcv(_descending_channel_broken_up())
    assert C.detect_descending_channel(clean, {}), "clean descending channel should fire"
    assert C.detect_descending_channel(broken, {}) == [], (
        "price breaking up through the opposite boundary must not be a short"
    )


def test_ascending_triangle_rejects_opposite_support_break():
    """A close below rising support invalidates a bullish ascending triangle."""
    clean = F.normalize_ohlcv(_ascending_triangle())
    broken = F.normalize_ohlcv(_ascending_triangle_broken_down())
    assert C.detect_ascending_triangle(clean, {}), "clean ascending triangle should fire"
    assert C.detect_ascending_triangle(broken, {}) == [], (
        "a downside resolution must not be labelled an upside breakout"
    )


def test_pennant_requires_clear_convergence():
    """Converging fires; barely-converging (end ~= mid) and flat do not."""
    assert C.detect_pennant(F.normalize_ohlcv(_pennant(converge=True)), {})
    assert not C.detect_pennant(F.normalize_ohlcv(_pennant_weak()), {}), (
        "right edge must be clearly narrower than the middle of the span"
    )
    assert not C.detect_pennant(F.normalize_ohlcv(_pennant(converge=False)), {})


def test_rectangle_rejects_sloped_range():
    """A horizontal range fires; a downward-sloping 'range' does not."""
    assert C.detect_rectangle(F.normalize_ohlcv(_rectangle()), {})
    assert C.detect_rectangle(F.normalize_ohlcv(_rectangle_sloped()), {}) == [], (
        "a drifting/descending range is not a rectangle"
    )


@pytest.mark.parametrize("pattern_id", ["ascending_channel", "descending_channel"])
def test_channel_drawn_boundaries_share_span(pattern_id):
    """Both channel edges are drawn over the same leg (no floating edge)."""
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    up, lo = hit.trendlines[0], hit.trendlines[1]
    assert up[0]["t"] == lo[0]["t"], f"{pattern_id}: left edges must coincide"
    assert up[1]["t"] == lo[1]["t"], f"{pattern_id}: right edges must coincide"
    _max_exc, n_beyond = _boundary_stats(hit, d)
    assert n_beyond == 0


def test_channel_end_reaches_breakout_bar():
    """``end_pos`` extends to the bar that actually crossed the breakout line."""
    d = F.normalize_ohlcv(GEOMETRIES["ascending_channel"]())
    hit = C.detect_ascending_channel(d, {})[0]
    pos = _pos_map(d)
    drawn_end = max(pos[hit.trendlines[0][1]["t"]], pos[hit.trendlines[1][1]["t"]])
    end_pos = pos[hit.end_date]
    assert end_pos >= drawn_end
    if end_pos > drawn_end:
        assert float(d["close"].iloc[end_pos]) > hit.breakout_level + 1e-9


@pytest.mark.parametrize("pattern_id", ["ascending_channel", "descending_channel"])
def test_channel_lines_extend_through_breakout(pattern_id):
    """Both drawn edges reach the pattern end (breakout bar), not the last pivot.

    Regression: the boundaries stopped at the final swing pivot, so the channel
    lines looked cut off well before the range they described.
    """
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    pos = _pos_map(d)
    end_pos = pos[hit.end_date]
    for line in hit.trendlines[:2]:
        assert len(line) >= 2
        assert pos[line[-1]["t"]] == end_pos, f"{pattern_id}: edge stops before pattern end"
    # The structural end remains the shared middle vertex (when the line is
    # extended), so the breakout level still sits on the drawn boundary.
    assert hit.trendlines[0][1]["t"] == hit.trendlines[1][1]["t"]


def test_channel_boundaries_bound_price_and_target_sides():
    """Every channel edge stays a real envelope and levels point the right way."""
    for pattern_id in ("ascending_channel", "descending_channel"):
        d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
        hit = detector(pattern_id)(d, {})[0]
        _max_exc, n_beyond = _boundary_stats(hit, d)
        assert n_beyond == 0, f"{pattern_id}: {n_beyond} candles beyond a boundary"
        if hit.direction == "bearish":
            assert hit.target < hit.breakout_level < hit.stop
        else:
            assert hit.stop < hit.breakout_level < hit.target


@pytest.mark.parametrize("pattern_id", ["bull_flag", "bear_flag"])
def test_flag_box_is_envelope_and_matches_breakout(pattern_id):
    """The consolidation box bounds every flag candle and its edge is the break."""
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    upper, lower = hit.trendlines[1], hit.trendlines[2]
    pos = _pos_map(d)
    x0, x1 = pos[upper[0]["t"]], pos[upper[1]["t"]]
    fmax = float(d["high"].iloc[x0 : x1 + 1].max())
    fmin = float(d["low"].iloc[x0 : x1 + 1].min())
    assert upper[0]["price"] >= fmax - 1e-3
    assert lower[0]["price"] <= fmin + 1e-3
    if pattern_id == "bear_flag":
        assert hit.breakout_level == pytest.approx(lower[0]["price"], abs=1e-3)
    else:
        assert hit.breakout_level == pytest.approx(upper[0]["price"], abs=1e-3)


@pytest.mark.parametrize(
    "pattern_id,geometry,kind",
    [
        ("bull_flag", _bull_flag_wavy_pole, "high"),
        ("bear_flag", _bear_flag_wavy_pole, "low"),
    ],
)
def test_flag_pole_is_pivot_anchored(pattern_id, geometry, kind):
    """Pole line connects real swing pivots (highs for bull, lows for bear)."""
    d = F.normalize_ohlcv(geometry())
    hits = detector(pattern_id)(d, {})
    assert hits, f"{pattern_id} should fire on its wavy-pole geometry"
    hit = hits[0]
    highs, lows = get_swings(d)
    pivots = highs if kind == "high" else lows
    pivot_prices = {round(q, 4) for _p, q in pivots}
    pole = hit.trendlines[0]
    assert len(pole) == 2
    assert pole[0]["price"] in pivot_prices, f"pole start {pole[0]} is not a {kind} pivot"
    assert pole[1]["price"] in pivot_prices, f"pole end {pole[1]} is not a {kind} pivot"


@pytest.mark.parametrize("pattern_id", OWNED)
def test_every_hit_carries_pivot_markers(pattern_id):
    """Every continuation hit exposes on-chart pivot markers for the audit list."""
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hit = detector(pattern_id)(d, {})[0]
    assert hit.pivots, f"{pattern_id} hit must carry pivot markers"
    for p in hit.pivots:
        assert set(p) >= {"t", "price", "kind"}
        assert p["kind"] in {"high", "low"}
        assert p["t"]

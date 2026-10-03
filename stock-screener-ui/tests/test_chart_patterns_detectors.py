"""Detector geometry + level-math tests for the chart-pattern engine.

Synthetic OHLCV frames are built locally (no production mocks). Each detector is
given a frame whose shape clearly forms the pattern and must report it with the
contract family/direction; trap frames must not trigger spurious hits.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F
from chart_patterns.detectors.common import (
    DETECTORS,
    PATTERN_CATALOG,
    classify_status,
    compute_levels,
    score_quality,
)

_INDEX = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")


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


def interp(anchors, n: int) -> np.ndarray:
    anchors = sorted(anchors)
    xs = [a[0] for a in anchors]
    ys = [a[1] for a in anchors]
    return np.interp(np.arange(n), xs, ys)


def detector(pattern_id: str):
    return dict(DETECTORS)[pattern_id]


# ---------------------------------------------------------------------------
# Geometry builders (one per pattern id)
# ---------------------------------------------------------------------------


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


def _consolidation():
    """Long tight base: 130 bars oscillating in a ~6% box around 102.5."""
    n = 130
    close = 102.5 + 2.5 * np.sin(np.arange(n) * 2.0 * np.pi / 20.0)
    return frame(close)


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


def _pennant():
    n = 60
    anchors = [(0, 100), (38, 100), (48, 131), (50, 123), (52, 129), (55, 124), (56, 127), (n - 1, 126)]
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


def _curve_bearish():
    return frame([130 - 0.02 * (i - 40) ** 2 for i in range(80)])


def _diamond_bottom():
    n = 60
    anchors = [
        (0, 104), (4, 100), (11, 108), (18, 96), (25, 113), (32, 99),
        (38, 110), (45, 103), (51, 108), (53, 105), (n - 1, 116),
    ]
    return frame(interp(anchors, n))


def _cup_handle():
    cup = [100 + 0.012 * (i - 39) ** 2 for i in range(79)]
    handle = interp([(0, 118.25), (5, 112), (10, 117)], 11)
    return frame(cup + list(handle[1:]))


GEOMETRIES = {
    "falling_wedge": _falling_wedge,
    "rising_wedge": _rising_wedge,
    "ascending_channel": _ascending_channel,
    "descending_channel": _descending_channel,
    "rectangle": _rectangle,
    "consolidation": _consolidation,
    "ascending_triangle": _ascending_triangle,
    "descending_triangle": _descending_triangle,
    "bull_flag": _bull_flag,
    "bear_flag": _bear_flag,
    "pennant": _pennant,
    "double_bottom": _double_bottom,
    "triple_bottom": _triple_bottom,
    "head_shoulders": _head_shoulders,
    "inverse_head_shoulders": _inverse_head_shoulders,
    "rounding_bottom": _rounding_bottom,
    "curve_bearish": _curve_bearish,
    "diamond_bottom": _diamond_bottom,
    "cup_handle": _cup_handle,
}


# ---------------------------------------------------------------------------
# Registration / catalog
# ---------------------------------------------------------------------------


def test_every_catalog_pattern_is_registered():
    registered = {pid for pid, _ in DETECTORS}
    assert registered == set(PATTERN_CATALOG)


def test_geometry_builders_cover_catalog():
    assert set(GEOMETRIES) == set(PATTERN_CATALOG)


def test_every_detector_documents_its_geometry():
    for pattern_id, fn in DETECTORS:
        doc = (fn.__doc__ or "").strip()
        assert len(doc) >= 40, f"{pattern_id} detector needs a geometry docstring"


# ---------------------------------------------------------------------------
# Detection on clear geometry
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pattern_id", sorted(PATTERN_CATALOG))
def test_detector_fires_on_its_geometry(pattern_id):
    d = F.normalize_ohlcv(GEOMETRIES[pattern_id]())
    hits = detector(pattern_id)(d, {}) or []
    assert hits, f"{pattern_id} did not fire on its synthetic geometry"
    hit = hits[0]
    name, family, direction = PATTERN_CATALOG[pattern_id]
    assert hit.pattern_id == pattern_id
    assert hit.family == family
    assert hit.direction == direction
    assert 0 < hit.confidence <= 100
    assert hit.rr >= 0
    assert hit.status in {"forming", "confirmed", "failed", "marginal"}
    assert hit.quality in {"textbook", "strong", "fair", "marginal"}
    assert hit.start_date and hit.end_date


def test_wedge_directions():
    assert detector("falling_wedge")(F.normalize_ohlcv(_falling_wedge()), {})[0].direction == "bullish"
    assert detector("rising_wedge")(F.normalize_ohlcv(_rising_wedge()), {})[0].direction == "bearish"


def test_flag_directions():
    assert detector("bull_flag")(F.normalize_ohlcv(_bull_flag()), {})[0].direction == "bullish"
    assert detector("bear_flag")(F.normalize_ohlcv(_bear_flag()), {})[0].direction == "bearish"


# ---------------------------------------------------------------------------
# False-positive traps
# ---------------------------------------------------------------------------


def _hits_on(df):
    d = F.normalize_ohlcv(df)
    out = []
    for pid, fn in DETECTORS:
        out.extend(fn(d, {}) or [])
    return out


def test_monotonic_trend_produces_no_patterns():
    n = 80
    assert _hits_on(frame(np.linspace(100, 140, n))) == []
    assert _hits_on(frame(np.linspace(140, 100, n))) == []


def test_flat_line_produces_no_patterns():
    assert _hits_on(frame(np.full(80, 100.0))) == []


def test_single_spike_is_not_a_reversal_bottom():
    spike = np.full(80, 100.0)
    spike[40] = 130.0
    ids = {h.pattern_id for h in _hits_on(frame(spike))}
    assert not ids & {"double_bottom", "triple_bottom", "head_shoulders", "inverse_head_shoulders"}


def test_random_walk_has_no_textbook_hits():
    rng = np.random.default_rng(7)
    walk = 100 + np.cumsum(rng.normal(0, 1.5, 120))
    hits = _hits_on(frame(walk))
    assert all(h.quality != "textbook" for h in hits)


# ---------------------------------------------------------------------------
# Level math (measured move / ATR stop / rr)
# ---------------------------------------------------------------------------


def test_compute_levels_bullish_measured_move():
    target, stop, rr = compute_levels("bullish", 100.0, 20.0, 90.0, atr_val=2.0, k=1.5)
    assert target == 120.0
    assert stop == 97.0  # opposite extreme (90) capped to entry - 1.5*ATR = 97
    assert rr == pytest.approx(20.0 / 3.0)


def test_compute_levels_bearish_measured_move():
    target, stop, rr = compute_levels("bearish", 100.0, 20.0, 110.0, atr_val=2.0, k=1.5)
    assert target == 80.0
    assert stop == 103.0
    assert rr == pytest.approx(20.0 / 3.0)


def test_compute_levels_uses_opposite_extreme_when_tighter_than_cap():
    # Tighter stop (97.5) wins over the ATR cap (97.0) for a long.
    target, stop, rr = compute_levels("bullish", 100.0, 20.0, 97.5, atr_val=2.0, k=1.5)
    assert stop == 97.5
    assert rr == pytest.approx(20.0 / 2.5)


def test_compute_levels_rejects_non_positive_rr():
    _, _, rr = compute_levels("bullish", 100.0, 0.0, 90.0, atr_val=2.0)
    assert rr == 0.0


def test_classify_status_transitions():
    up = frame([100, 101, 102, 103, 104, 105])
    # bullish: last close 105 > breakout 104 -> confirmed
    assert classify_status(up, 104.0, "bullish", end_pos=0) == "confirmed"
    # within 2% below the line -> forming
    assert classify_status(up, 106.0, "bullish", end_pos=0) == "forming"
    down = frame([110, 109, 108, 107, 106, 105])
    # bearish: last close 105 above support 104 but within 2% -> forming
    assert classify_status(down, 104.0, "bearish", end_pos=0) == "forming"
    # bearish: last close 105 < support 106 -> confirmed
    assert classify_status(down, 106.0, "bearish", end_pos=0) == "confirmed"


def test_classify_status_failed_after_crossback():
    # crossed above 103 then closed back below 101.
    df = frame([100, 104, 103, 102, 100, 101])
    assert classify_status(df, 103.5, "bullish", end_pos=0) == "failed"


def test_score_quality_monotonic_in_inputs():
    low_q, low_c = score_quality(1, 0.2, False)
    high_q, high_c = score_quality(4, 0.95, True)
    assert high_c > low_c
    assert low_q == "marginal"
    assert high_q in {"textbook", "strong"}


# ---------------------------------------------------------------------------
# Feature primitives
# ---------------------------------------------------------------------------


def test_find_swing_pivots():
    closes = [100, 101, 103, 102, 100, 99, 101, 104, 102, 100]
    df = frame(closes, spread=0.1)
    highs = F.find_swing_highs(df["high"], left=1, right=1)
    lows = F.find_swing_lows(df["low"], left=1, right=1)
    assert 2 in highs  # local max at index 2 (103)
    assert 5 in lows  # local min at index 5 (99) after spread
    assert 7 in highs


def test_linreg_fit_perfect_line():
    slope, intercept, r2 = F.linreg_fit([0, 1, 2, 3], [1, 3, 5, 7])
    assert slope == pytest.approx(2.0)
    assert intercept == pytest.approx(1.0)
    assert r2 == pytest.approx(1.0)


def test_linreg_fit_single_point_degenerate():
    slope, intercept, r2 = F.linreg_fit([5], [42])
    assert slope == 0.0
    assert intercept == 42.0
    assert r2 == 1.0


def test_atr_positive():
    df = frame(interp([(0, 100), (20, 120), (40, 90), (60, 130), (79, 110)], 80))
    assert F.atr_value(df) > 0


def test_volume_confirmation():
    closes = list(np.linspace(100, 110, 30))
    vol = [100.0] * 29 + [500.0]
    df = frame(closes, volume=vol)
    assert F.is_volume_confirmed(df, 29, mult=1.2, lookback=20)
    assert not F.is_volume_confirmed(df, 5, mult=1.2, lookback=20)


def test_poly_curvature_sign():
    up = [100 + 0.02 * (i - 20) ** 2 for i in range(40)]
    _, coeffs_up = F.polyfit_values(up, degree=2)
    assert F.curvature_sign(coeffs_up) == 1
    down = [130 - 0.02 * (i - 20) ** 2 for i in range(40)]
    _, coeffs_down = F.polyfit_values(down, degree=2)
    assert F.curvature_sign(coeffs_down) == -1

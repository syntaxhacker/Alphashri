"""Focused tests for the small detector primitives centralised in ``common``.

These replace per-detector copies, so the assertions lock the exact numeric
behaviour: strict crossings, inclusive span bounds, and input-order pivot
filtering. Synthetic frames only -- no network, DB, or broker.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns.detectors.common import (
    breakout_pos,
    envelope_common_span,
    envelope_tolerance,
    envelope_value,
    line_breakout_pos,
    pivots_in,
)


def _frame(closes, *, high=None, low=None) -> pd.DataFrame:
    vals = np.asarray(closes, dtype=float)
    return pd.DataFrame(
        {
            "open": vals,
            "high": np.asarray(high, dtype=float) if high is not None else vals + 0.5,
            "low": np.asarray(low, dtype=float) if low is not None else vals - 0.5,
            "close": vals,
            "volume": np.full(len(vals), 1000.0),
        }
    )


# --- envelope_tolerance ------------------------------------------------------


@pytest.mark.parametrize("atr", [0.0, 1.0, 2.4, 8.0, -3.0])
def test_envelope_tolerance_is_quarter_atr(atr):
    assert envelope_tolerance(atr) == 0.25 * float(atr)


def test_envelope_tolerance_accepts_numpy_scalar():
    assert envelope_tolerance(np.float64(4.0)) == 1.0


# --- envelope_value ----------------------------------------------------------


def test_envelope_value_matches_slope_times_x_plus_intercept():
    # Anchored at x0=4: q0 = 0.5*4 + 100 = 102. A dropped (x - x0) term shows up
    # immediately at x=0 and x=12.
    env = {
        "slope": 0.5,
        "intercept": 100.0,
        "x0": 4,
        "q0": 102.0,
        "x1": 12,
        "q1": 106.0,
    }
    for x in (0, 4, 9, 12, 4.5):
        assert envelope_value(env, x) == pytest.approx(0.5 * x + 100.0)


def test_envelope_value_matches_line_value_on_a_fitted_envelope():
    from chart_patterns import features as F

    df = _frame(np.full(12, 100.0))
    env = F.envelope_line(df, [(2, 100.5), (9, 100.5)], "upper", 1.0)
    assert env is not None
    for x in range(2, 10):
        assert envelope_value(env, x) == pytest.approx(
            F.line_value(env["slope"], env["intercept"], x)
        )


# --- envelope_common_span -----------------------------------------------------


def test_envelope_common_span_uses_max_start_and_min_end():
    upper = {"x0": 3, "x1": 25}
    lower = {"x0": 7, "x1": 20}
    assert envelope_common_span(upper, lower) == (7, 20)


def test_envelope_common_span_accepts_exactly_min_span():
    upper = {"x0": 2, "x1": 12}
    lower = {"x0": 2, "x1": 12}
    assert envelope_common_span(upper, lower, min_span=10) == (2, 12)
    assert envelope_common_span(upper, lower, min_span=11) is None


def test_envelope_common_span_rejects_short_or_reversed_overlap():
    assert envelope_common_span({"x0": 0, "x1": 9}, {"x0": 0, "x1": 9}) is None
    assert envelope_common_span({"x0": 12, "x1": 20}, {"x0": 0, "x1": 8}) is None


def test_envelope_common_span_casts_to_int():
    upper = {"x0": 3.9, "x1": 18.7}
    lower = {"x0": np.int64(5), "x1": np.int64(17)}
    assert envelope_common_span(upper, lower) == (5, 17)


# --- pivots_in ----------------------------------------------------------------

_PIVOTS = [(0, 100.0), (3, 101.0), (5, 99.0), (9, 102.0), (12, 98.0)]


def test_pivots_in_filters_by_start_inclusively():
    assert pivots_in(_PIVOTS, 5) == [(5, 99.0), (9, 102.0), (12, 98.0)]


def test_pivots_in_filters_by_start_and_end_inclusively():
    assert pivots_in(_PIVOTS, 3, 9) == [(3, 101.0), (5, 99.0), (9, 102.0)]
    assert pivots_in(_PIVOTS, 100) == []
    assert pivots_in(_PIVOTS, 9, 3) == []


def test_pivots_in_preserves_input_order():
    unsorted = [(9, 102.0), (0, 100.0), (5, 99.0), (3, 101.0)]
    assert pivots_in(unsorted, 3, 9) == [(9, 102.0), (5, 99.0), (3, 101.0)]


# --- breakout_pos -------------------------------------------------------------

_BULL = [100.0, 101.0, 101.5, 102.0, 99.0, 103.0]
_BEAR = [102.0, 101.0, 101.0, 100.5, 103.0]


def test_breakout_pos_bullish_uses_strict_cross():
    # The close equal to the level at x=2 must not count as a breakout.
    assert breakout_pos(_frame(_BULL), 0, 101.5, "bullish") == 3


def test_breakout_pos_bearish_uses_strict_cross():
    # Equal at x=1 and x=2; first strictly below is x=3.
    assert breakout_pos(_frame(_BEAR), 0, 101.0, "bearish") == 3


def test_breakout_pos_starts_from_x_from_and_clamps_negative():
    df = _frame(_BULL)
    assert breakout_pos(df, 4, 101.5, "bullish") == 5  # earlier cross at 3 skipped
    assert breakout_pos(df, -5, 101.5, "bullish") == 3
    assert breakout_pos(df, 99, 101.5, "bullish") is None


def test_breakout_pos_rejects_nonpositive_level_and_missing_frame():
    df = _frame([-5.0, -6.0])
    assert breakout_pos(df, 0, 0.0, "bearish") is None
    assert breakout_pos(df, 0, -1.0, "bearish") is None
    assert breakout_pos(None, 0, 10.0, "bullish") is None
    assert breakout_pos(_frame([]), 0, 10.0, "bullish") is None


def test_breakout_pos_returns_none_when_never_crossed():
    df = _frame(_BULL)
    assert breakout_pos(df, 0, 200.0, "bullish") is None
    assert breakout_pos(df, 0, 50.0, "bearish") is None


# --- line_breakout_pos --------------------------------------------------------


def _line():
    # y = 100 + 0.5x -> [100, 100.5, 101, 101.5, 102, 102.5]
    return 0.5, 100.0


def test_line_breakout_pos_bullish_uses_line_at_each_bar():
    slope, intercept = _line()
    df = _frame([100.0, 100.5, 101.0, 102.0, 100.0, 103.0])
    assert line_breakout_pos(df, 0, slope, intercept, "bullish") == 3
    assert line_breakout_pos(df, 4, slope, intercept, "bullish") == 5
    assert line_breakout_pos(df, 9, slope, intercept, "bullish") is None
    assert line_breakout_pos(df, -3, slope, intercept, "bullish") == 3


def test_line_breakout_pos_bearish_uses_line_at_each_bar():
    slope, intercept = _line()
    df = _frame([100.0, 100.5, 101.0, 100.0, 102.0, 98.0])
    assert line_breakout_pos(df, 0, slope, intercept, "bearish") == 3
    assert line_breakout_pos(df, 4, slope, intercept, "bearish") == 5


def test_line_breakout_pos_has_no_positive_level_guard():
    # The contrast with breakout_pos is deliberate: reversal crosses a line that
    # may sit at or below zero, whereas a zero constant level is not tradeable.
    df = _frame([-1.0, -2.0])
    assert line_breakout_pos(df, 0, 0.0, 0.0, "bearish") == 0
    assert breakout_pos(df, 0, 0.0, "bearish") is None


def test_cross_scans_skip_nan_closes():
    df = _frame([100.0, np.nan, 103.0])
    assert breakout_pos(df, 0, 101.0, "bullish") == 2
    assert line_breakout_pos(df, 0, 0.0, 100.0, "bullish") == 2

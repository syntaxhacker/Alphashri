"""Characterisation tests for the three shared detector primitives.

Locks the observable behaviour of ``shift_line_to_bound``, ``calendar_day_gap``
and ``scan_windows`` in ``chart_patterns.detectors.common`` so a future refactor
cannot silently change what the detectors emit. Synthetic frames only — no
network, no DB, no broker.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from chart_patterns.detectors.common import (
    calendar_day_gap,
    scan_windows,
    shift_line_to_bound,
)


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------


def _frame(index, n, *, high=None, low=None) -> pd.DataFrame:
    close = np.full(n, 100.0)
    highs = np.asarray(high, dtype=float) if high is not None else close + 0.5
    lows = np.asarray(low, dtype=float) if low is not None else close - 0.5
    return pd.DataFrame(
        {
            "open": close,
            "high": highs,
            "low": lows,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=index,
    )


def _bound_frame() -> pd.DataFrame:
    """Five bars where the max deviation from ``0.5x + 100`` is load-bearing.

    line(x) = 0.5x + 100 -> [100, 100.5, 101, 101.5, 102]
    max(high - line) = 105 - 101 = 4 (upper delta)
    max(line - low)  = 102 - 99  = 2 (lower delta, also at x=4)
    All numbers are exact binary floats so the bound assertions are exact.
    """
    idx = pd.date_range("2024-01-01", periods=5, freq="D", tz="UTC")
    return _frame(
        idx,
        5,
        high=[101.0, 101.5, 105.0, 102.0, 102.0],
        low=[99.0, 99.5, 99.0, 100.0, 100.0],
    )


class _Hit:
    """Minimal stand-in for ``PatternHit`` (only the dedupe fields matter)."""

    def __init__(self, start_date, end_date, tag):
        self.start_date = start_date
        self.end_date = end_date
        self.tag = tag


# ---------------------------------------------------------------------------
# shift_line_to_bound
# ---------------------------------------------------------------------------


def test_shift_line_to_bound_upper_margin_lifts_by_exactly_margin_and_bounds():
    df = _bound_frame()
    s, i0 = 0.5, 100.0

    plain = shift_line_to_bound(df, s, i0, 0, 4, "upper", margin=0.0)
    lifted = shift_line_to_bound(df, s, i0, 0, 4, "upper", margin=1e-4)

    # Assert the numeric difference (the margin itself), not an approximate
    # total line value. If the margin is dropped from the reversal path the
    # two intercepts become identical and this 1e-4 assertion breaks.
    assert lifted[1] - plain[1] == pytest.approx(1e-4)
    assert lifted[1] > plain[1]

    # Both lines remain true upper envelopes over [x0, x1].
    for intercept in (plain[1], lifted[1]):
        line = s * np.arange(0, 5, dtype=float) + intercept
        assert np.all(line - df["high"].to_numpy(dtype=float) >= -1e-9)


def test_shift_line_to_bound_lower_margin_lifts_by_exactly_margin_and_bounds():
    df = _bound_frame()
    s, i0 = 0.5, 100.0

    plain = shift_line_to_bound(df, s, i0, 0, 4, "lower", margin=0.0)
    lifted = shift_line_to_bound(df, s, i0, 0, 4, "lower", margin=1e-4)

    # Lower bound is pushed DOWN by the margin: plain - lifted == margin.
    assert plain[1] - lifted[1] == pytest.approx(1e-4)
    assert lifted[1] < plain[1]

    # Both lines remain true lower envelopes over [x0, x1].
    for intercept in (plain[1], lifted[1]):
        line = s * np.arange(0, 5, dtype=float) + intercept
        assert np.all(df["low"].to_numpy(dtype=float) - line >= -1e-9)


def test_shift_line_to_bound_reversed_range_returns_pair_unchanged():
    df = _bound_frame()
    for side in ("upper", "lower"):
        # x1 < x0 -> early return; even an explicit margin is ignored.
        got = shift_line_to_bound(df, 0.5, 100.0, 4, 2, side, margin=1e-4)
        assert got == (0.5, 100.0)


@pytest.mark.parametrize("side", ["upper", "lower"])
@pytest.mark.parametrize("margin", [0.0, 1e-4])
def test_shift_line_to_bound_preserves_slope_exactly(side, margin):
    df = _bound_frame()
    slope = 0.5
    got_slope, _ = shift_line_to_bound(df, slope, 100.0, 0, 4, side, margin=margin)
    assert got_slope == slope  # exact equality, not approx


def test_reversal_bound_uses_margin_but_continuation_shift_does_not():
    """Tie the wrappers to the primitive: this fails if margin is dropped from
    the reversal path (``_BOUND_MARGIN`` -> 0 or ``+ margin`` removed), since
    the reversal result would then equal the no-margin primitive exactly.
    """
    from chart_patterns.detectors import continuation, reversal

    df = _bound_frame()
    s, i0 = 0.5, 100.0
    plain = shift_line_to_bound(df, s, i0, 0, 4, "upper", margin=0.0)

    rev = reversal._bound(df, s, i0, 0, 4, "upper")
    assert rev[0] == s
    assert rev[1] - plain[1] == pytest.approx(1e-4)

    cont = continuation._shift_line(df, s, i0, 0, 4, "upper")
    assert cont == plain


# ---------------------------------------------------------------------------
# calendar_day_gap
# ---------------------------------------------------------------------------


def test_calendar_day_gap_datetime_index_uses_calendar_days():
    # Non-uniform index: 2 bars apart but 9 calendar days apart.
    idx = pd.to_datetime(
        ["2024-01-01", "2024-01-02", "2024-01-10", "2024-01-11", "2024-02-15"]
    )
    df = _frame(idx, 5)
    assert calendar_day_gap(df, 0, 2) == 9.0  # not the 2-bar distance
    assert calendar_day_gap(df, 2, 4) == 36.0  # 2024-01-10 -> 2024-02-15


def test_calendar_day_gap_range_index_falls_back_to_bar_count():
    df = _frame(pd.RangeIndex(5), 5)  # no `.days` on the index difference
    assert calendar_day_gap(df, 0, 3) == 3.0
    assert calendar_day_gap(df, 3, 0) == 3.0


def test_calendar_day_gap_is_symmetric():
    dt = _frame(pd.date_range("2024-01-01", periods=5, freq="D", tz="UTC"), 5)
    assert calendar_day_gap(dt, 0, 2) == calendar_day_gap(dt, 2, 0)

    rng = _frame(pd.RangeIndex(5), 5)
    assert calendar_day_gap(rng, 0, 2) == calendar_day_gap(rng, 2, 0)


# ---------------------------------------------------------------------------
# scan_windows
# ---------------------------------------------------------------------------


def test_scan_windows_calls_once_per_eligible_window_with_positional_args_and_keeps_first_hit():
    n = 10
    df = _frame(pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC"), n)
    ctx = {"marker": object()}
    calls = []

    def once(df_, ctx_, start, end, **kwargs):
        calls.append((df_, ctx_, start, end, kwargs))
        return _Hit("A", "B", tag=f"call-{len(calls)}")

    kw = {"ascending": True, "extra": 7}
    hits = scan_windows(df, ctx, min_bars=3, once=once, lookbacks=(10, 5, 3), **kw)

    # All three windows have >= 3 bars -> once called once per lookback.
    assert len(calls) == 3
    for call in calls:
        assert call[0] is df
        assert call[1] is ctx
        assert call[4] == kw
    assert calls[0][2:4] == (0, 9)  # lookback 10
    assert calls[1][2:4] == (5, 9)  # lookback 5
    assert calls[2][2:4] == (7, 9)  # lookback 3

    # All hits share (start_date, end_date) -> only the FIRST is kept.
    assert len(hits) == 1
    assert hits[0].tag == "call-1"


def test_scan_windows_skips_windows_shorter_than_min_bars():
    n = 10
    df = _frame(pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC"), n)
    ctx = {}
    calls = []

    def once(df_, ctx_, start, end, **kwargs):
        calls.append((start, end))
        return _Hit(str(start), str(end), tag=f"{start}-{end}")

    # lookback 10 -> 10 bars (kept); 5 -> 5 bars and 3 -> 3 bars (both < 6).
    hits = scan_windows(df, ctx, min_bars=6, once=once, lookbacks=(10, 5, 3))

    assert calls == [(0, 9)]
    assert len(hits) == 1
    assert hits[0].tag == "0-9"

"""Synthetic-frame tests for the lane-A ict.pine helpers (no network, no DB)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from scripts.research.ict_pine.core import (
    SwingPoint,
    atr,
    body,
    mode_filter,
    pivots,
    swings,
    true_range,
)
from scripts.research.ict_pine.killzones import (
    KILLZONES,
    killzone_windows,
    session_mask,
)

pytestmark = pytest.mark.unit


def _frame(high: list[float], low: list[float], index=None) -> pd.DataFrame:
    mid = [(h + lo) / 2 for h, lo in zip(high, low)]
    return pd.DataFrame(
        {"high": high, "low": low, "open": mid, "close": mid}, index=index
    )


def test_body_and_true_range_hand_computed() -> None:
    df = pd.DataFrame(
        {
            "open": [10.0, 20.0, 30.0],
            "close": [14.0, 18.0, 35.0],
            "high": [15.0, 22.0, 36.0],
            "low": [9.0, 19.0, 28.0],
        }
    )
    np.testing.assert_allclose(body(df).to_numpy(), [4.0, 2.0, 5.0])
    # Bar 0 has no prev close; bars 1-2 use max(range, |H-Cp|, |L-Cp|).
    np.testing.assert_allclose(true_range(df).to_numpy(), [6.0, 8.0, 18.0])


def test_atr_constant_range_equals_that_range() -> None:
    df = _frame([101.0] * 10, [99.0] * 10)
    result = atr(df, 10)
    assert result.iloc[:9].isna().all()
    np.testing.assert_allclose(result.iloc[9:].to_numpy(), 2.0)


def test_atr_uses_sma_seed_then_rma_recursion() -> None:
    trs = [10.0, 12.0, 8.0, 14.0, 16.0]
    closes = [100.0]
    highs = [100.0 + trs[0] / 2]
    lows = [100.0 - trs[0] / 2]
    for tr in trs[1:]:
        closes.append(closes[-1])
        highs.append(closes[-1] + tr / 2)
        lows.append(closes[-1] - tr / 2)
    df = pd.DataFrame(
        {"high": highs, "low": lows, "open": closes, "close": closes}
    )
    seed = (10.0 + 12.0 + 8.0) / 3
    third = (seed * 2 + 14.0) / 3
    fourth = (third * 2 + 16.0) / 3
    result = atr(df, 3)
    assert result.iloc[:2].isna().all()
    np.testing.assert_allclose(result.iloc[2:].to_numpy(), [seed, third, fourth])


def _swings_frame() -> pd.DataFrame:
    high = [100.5] * 5 + [91.0] + [96, 97, 98, 99, 100] + [120.0]
    high += [110, 109, 108, 107, 106] + [100.5] * 4
    low = [99.5] * 5 + [90.0] + [95, 96, 97, 98, 99] + [119.0]
    low += [105, 104, 103, 102, 101] + [99.5] * 4
    assert len(high) == len(low) == 21
    return _frame([float(x) for x in high], [float(x) for x in low])


def test_swings_pivot_indexes_and_confirmation_lag() -> None:
    assert swings(_swings_frame(), length=5) == [
        SwingPoint(5, 90.0, "low", 10),
        SwingPoint(11, 120.0, "high", 16),
    ]


def test_swings_no_future_leak_when_tail_is_dropped() -> None:
    full = _swings_frame()
    shorter = full.iloc[:16]
    before = [point for point in swings(full, 5) if point.confirmed_idx < 16]
    assert swings(shorter, 5) == before == [SwingPoint(5, 90.0, "low", 10)]


def test_pivots_left_right_confirmation() -> None:
    df = _frame(
        [100, 101, 99, 100, 98, 110, 105, 104, 103, 102],
        [90, 91, 92, 91, 90, 80, 85, 86, 87, 88],
    )
    highs, lows = pivots(df, left=2, right=1)
    assert highs == [SwingPoint(5, 110, "high", 6)]
    assert lows == [SwingPoint(5, 80, "low", 6)]


def test_mode_filter_does_not_drop_bars() -> None:
    df = _frame([2.0] * 3, [1.0] * 3)
    assert mode_filter(df, "Present") is df
    assert mode_filter(df, "Historical") is df


def test_killzone_registry_matches_pine_session_strings() -> None:
    assert [(z.name, z.session, z.tz, z.enabled) for z in KILLZONES] == [
        ("New York", "0700-0900", "America/New_York", True),
        ("London Open", "0700-1000", "Europe/London", True),
        ("London Close", "1500-1700", "Europe/London", True),
        ("Asian", "1000-1400", "Asia/Tokyo", True),
    ]


def test_session_mask_new_york_boundary_on_known_et_date() -> None:
    idx = pd.to_datetime(
        [
            "2026-11-19 06:59:00",
            "2026-11-19 08:00:00",
            "2026-11-19 08:30:00",
            "2026-11-19 08:59:59",
            "2026-11-19 09:00:00",
            "2026-11-19 09:29:00",
            "2026-11-19 09:30:00",
        ]
    ).tz_localize("America/New_York")
    # Pine's New York window is 0700-0900 ET (ict.pine:538). The brief's
    # "09:30 in, 09:29 out" example describes a 09:30 NYSE-open killzone,
    # which this indicator does not define; both instants are out here.
    assert session_mask(idx).to_numpy().tolist() == [
        False,
        True,
        True,
        True,
        False,
        False,
        False,
    ]


def test_session_mask_respects_dst_via_zoneinfo() -> None:
    idx = pd.to_datetime(
        [
            "2026-11-19 13:29:00",  # 08:29 EST -> in
            "2026-11-19 13:59:00",  # 08:59 EST -> in
            "2026-11-19 14:00:00",  # 09:00 EST -> out
            "2026-07-01 12:30:00",  # 08:30 EDT -> in
            "2026-07-01 13:30:00",  # 09:30 EDT -> out
        ],
        utc=True,
    )
    assert session_mask(idx).to_numpy().tolist() == [True, True, False, True, False]


def test_session_mask_accepts_alternate_chart_timezone() -> None:
    idx = pd.to_datetime(["2026-11-19 08:30:00"]).tz_localize("America/New_York")
    result = session_mask(idx, tz="UTC")
    assert result.index[0] == pd.Timestamp("2026-11-19 13:30:00", tz="UTC")
    assert bool(result.iloc[0]) is True


def test_session_mask_requires_tz_aware_index() -> None:
    with pytest.raises(ValueError, match="tz-aware"):
        session_mask(pd.date_range("2026-11-19", periods=2, freq="h"))


def test_killzone_windows_are_contiguous_runs_per_zone() -> None:
    idx = pd.date_range(
        "2026-11-19 08:58", periods=5, freq="min", tz="America/New_York"
    )
    df = pd.DataFrame({"close": range(len(idx))}, index=idx)
    windows = killzone_windows(df)
    assert windows["New York"] == [(idx[0], idx[1])]
    assert windows["London Open"] == []
    assert windows["London Close"] == []
    assert windows["Asian"] == []


def test_killzone_windows_use_each_zones_native_timezone() -> None:
    # 02:58-03:01 ET is 07:58-08:01 GMT in November: London Open only.
    idx = pd.date_range(
        "2026-11-19 02:58", periods=4, freq="min", tz="America/New_York"
    )
    windows = killzone_windows(pd.DataFrame({"close": range(4)}, index=idx))
    assert windows["London Open"] == [(idx[0], idx[-1])]
    assert windows["New York"] == []

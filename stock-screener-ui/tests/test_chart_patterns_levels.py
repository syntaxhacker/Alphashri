"""Unit tests for backend-owned support/resistance zones (payload contract §5)."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from chart_patterns import levels
from tests.helpers.levels_fixtures import SR_CLOSES


def _frame(closes, *, high_low: float = 0.5) -> pd.DataFrame:
    closes = np.asarray(closes, dtype=float)
    index = pd.date_range("2026-01-01", periods=len(closes), freq="D")
    return pd.DataFrame(
        {
            "open": closes,
            "high": closes + high_low,
            "low": closes - high_low,
            "close": closes,
            "volume": 1000.0,
        },
        index=index,
    )


def _wire(closes, *, high_low: float = 0.5):
    frame = _frame(closes, high_low=high_low)
    return [
        {
            "t": stamp.date().isoformat(),
            "o": row.open,
            "h": row.high,
            "l": row.low,
            "c": row.close,
            "v": row.volume,
        }
        for stamp, row in frame.iterrows()
    ]


def _zone(kind, score, top, *, bars_since=0, touches=2):
    return {
        "kind": kind,
        "top": top,
        "bottom": top - 1.0,
        "start_date": "2026-01-01",
        "end_date": "2026-01-02",
        "touches": touches,
        "score": score,
        "_bars_since": bars_since,
    }


def test_two_touches_form_support_and_resistance():
    closes = list(SR_CLOSES)
    zones = levels.compute_sr_zones(_wire(closes), timeframe="1D")
    assert len(zones) == 2
    by_kind = {zone["kind"]: zone for zone in zones}
    assert by_kind["support"]["top"] < 110.0
    assert by_kind["resistance"]["bottom"] > 110.0
    for zone in zones:
        assert zone["touches"] == 2
        assert set(zone) == {
            "kind", "top", "bottom", "start_date", "end_date", "touches", "score",
            "bars_since_touch",
        }
        assert math.isfinite(zone["score"]) and math.isfinite(zone["top"])
        assert zone["start_date"] <= zone["end_date"]
    # Deterministic scoring/order on repeated calls.
    assert levels.compute_sr_zones(_wire(closes), timeframe="1D") == zones


def test_public_zones_expose_touch_age():
    # Order-2 pivots on this frame: lows at bars 2/6, highs at bars 4/8, so the
    # last touches are knowable without reading the zone's own timestamps.
    closes = list(SR_CLOSES)
    n = len(closes)
    zones = levels.compute_sr_zones(_wire(closes), timeframe="1D")
    by_kind = {zone["kind"]: zone for zone in zones}
    expected = {"support": 6, "resistance": 8}
    assert set(by_kind) == set(expected)
    for kind, last_touch in expected.items():
        zone = by_kind[kind]
        assert "bars_since_touch" in zone
        assert isinstance(zone["bars_since_touch"], int)
        assert zone["bars_since_touch"] >= 0
        assert zone["bars_since_touch"] == n - 1 - last_touch
        assert "_bars_since" not in zone


def test_intraday_zones_carry_exact_touch_timestamps():
    closes = list(SR_CLOSES)
    index = pd.date_range(
        "2026-01-05 09:15", periods=len(closes), freq="15min", tz="Asia/Kolkata"
    )
    wire = [
        {
            "t": stamp.isoformat(),
            "o": row,
            "h": row + 0.5,
            "l": row - 0.5,
            "c": row,
            "v": 1000.0,
        }
        for stamp, row in zip(index, closes)
    ]

    zones = levels.compute_sr_zones(
        wire, session="Asia/Kolkata", timeframe="15m"
    )
    by_kind = {zone["kind"]: zone for zone in zones}
    support = by_kind["support"]
    resistance = by_kind["resistance"]

    # Lows at bars 2 and 6; highs at bars 4 and 8. Timestamps are the exact
    # intraday bars, not the session date (which alone would snap to 09:15).
    assert support["start_time"] == index[2].isoformat()
    assert support["end_time"] == index[6].isoformat()
    assert resistance["start_time"] == index[4].isoformat()
    assert resistance["end_time"] == index[8].isoformat()
    for zone in zones:
        assert zone["start_date"] == "2026-01-05"
        assert zone["end_date"] == "2026-01-05"
        assert zone["start_time"] <= zone["end_time"]


def test_daily_weekly_monthly_zones_keep_date_only_shape():
    closes = list(SR_CLOSES)
    for timeframe in ("1D", "1W", "1M"):
        zones = levels.compute_sr_zones(_wire(closes), timeframe=timeframe)
        assert zones, timeframe
        for zone in zones:
            assert "start_time" not in zone
            assert "end_time" not in zone
            assert set(zone) == {
                "kind", "top", "bottom", "start_date", "end_date", "touches", "score",
                "bars_since_touch",
            }


def test_single_touch_is_rejected():
    zones = levels.compute_sr_zones(
        _wire([100, 101, 102, 90, 103, 104, 105, 106]), timeframe="1D"
    )
    assert zones == []


def test_merge_tolerance_boundary_is_inclusive():
    points = [(0, 100.0), (3, 100.3)]
    assert len(levels._cluster_touches(points, 0.3)) == 1
    assert len(levels._cluster_touches(points, 0.299999)) == 2
    # Touch order does not change the deterministic grouping.
    assert levels._cluster_touches(list(reversed(points)), 0.3) == levels._cluster_touches(
        points, 0.3
    )


def test_unconfirmed_trailing_spike_is_not_used():
    base = [110, 110, 100, 105, 110, 110, 100, 105, 110, 110]
    with_spike = base + [80]
    zones = levels.compute_sr_zones(_wire(with_spike), timeframe="1D")
    assert zones, "confirmed zones from the earlier bars remain"
    assert all(zone["bottom"] > 90.0 for zone in zones), "trailing spike is unconfirmed"
    assert all(zone["end_date"] <= "2026-01-10" for zone in zones)


def test_lookahead_free_zone_extent_matches_truncated_frame():
    base = [110, 110, 100, 105, 110, 110, 100, 105, 110, 110]
    full = levels.compute_sr_zones(_wire(base + [80]), timeframe="1D")
    truncated = levels.compute_sr_zones(_wire(base), timeframe="1D")
    full_zone = next(zone for zone in full if zone["bottom"] < 105.0)
    truncated_zone = next(zone for zone in truncated if zone["bottom"] < 105.0)
    assert full_zone["touches"] == truncated_zone["touches"]
    assert full_zone["start_date"] == truncated_zone["start_date"]
    assert full_zone["end_date"] == truncated_zone["end_date"]


def test_overlap_merges_support_and_resistance_into_sr():
    closes = [99.98, 100.02] * 4 + [101.5]
    zones = levels.compute_sr_zones(_wire(closes, high_low=0.01), timeframe="1D")
    assert len(zones) == 1
    zone = zones[0]
    assert zone["kind"] == "sr"
    assert zone["touches"] == 5, "touches from both merged clusters are summed"


def test_break_after_two_closes_drops_the_zone():
    closes = [110, 110, 100, 105, 110, 110, 100, 105, 110, 110, 90, 90, 95]
    zones = levels.compute_sr_zones(_wire(closes), timeframe="1D")
    assert not any(zone["kind"] == "support" for zone in zones)
    assert all(zone["bottom"] > 100.0 for zone in zones)


def test_single_close_beyond_zone_does_not_break_it():
    closes = [110, 110, 100, 105, 110, 110, 100, 105, 110, 110, 90, 110]
    zones = levels.compute_sr_zones(_wire(closes), timeframe="1D")
    assert any(zone["kind"] == "support" for zone in zones)


def test_stale_zone_dropped_after_120_untouched_bars():
    closes = [110, 110, 100, 105, 110, 110, 100, 105, 110] + [110] * 130
    assert levels.compute_sr_zones(_wire(closes), timeframe="1D") == []


def test_short_frame_is_empty():
    for n in (0, 1, 3, 4):
        closes = [100.0 + i for i in range(n)]
        assert levels.compute_sr_zones(_wire(closes), timeframe="1D") == []


def test_max_four_zones_and_two_per_side():
    zones = [
        _zone("support", 10.0, 100.0),
        _zone("support", 9.0, 95.0),
        _zone("support", 8.0, 90.0),
        _zone("resistance", 7.0, 120.0),
        _zone("resistance", 6.0, 115.0),
        _zone("resistance", 5.0, 110.0),
        _zone("sr", 4.0, 105.0),
    ]
    selected = levels._select_zones(zones)
    assert len(selected) == 4
    assert sum(zone["kind"] == "support" for zone in selected) == 2
    assert sum(zone["kind"] == "resistance" for zone in selected) == 2
    assert levels._select_zones([dict(zone) for zone in zones]) == selected
    # The fill pass must not smuggle in a third support when no resistance
    # candidates exist.
    one_side = levels._select_zones(
        [_zone("support", 3.0, 90.0), _zone("support", 2.0, 95.0),
         _zone("support", 1.0, 100.0)]
    )
    assert len(one_side) == 2
    assert all(zone["kind"] == "support" for zone in one_side)


def test_large_frame_uses_pivot_order_six():
    closes = [100.0] * 520
    closes[511] = 95.0
    closes[516] = 94.0

    large = levels.compute_sr_zones(_wire(closes), timeframe="1D")
    small = levels.compute_sr_zones(_wire(closes[-100:]), timeframe="1D")
    assert not any(zone["bottom"] < 96.0 for zone in large), "order 6 ignores the dip"
    assert any(zone["bottom"] < 96.0 for zone in small), "order 2 confirms both dips"


def test_wire_candles_and_frame_inputs_agree_and_stay_json_safe():
    closes = list(SR_CLOSES)
    wire = _wire(closes)
    from_frame = levels.compute_sr_zones(_frame(closes), timeframe="1D")
    from_wire = levels.compute_sr_zones(wire, timeframe="1D")
    assert from_frame == from_wire
    for zone in from_wire:
        assert all(
            math.isfinite(zone[key]) for key in ("top", "bottom", "score", "bars_since_touch")
        )
        assert zone["end_date"] <= wire[-1]["t"]


# --- Optimisation-guard vectors -------------------------------------------
# The zone scan now builds numeric columns directly and starts the pivot scan
# at the lookback boundary. These pin the exact boundary and coercion rules.


def test_window_pivots_slice_matches_full_frame_scan():
    rng = np.random.default_rng(20261125)
    for _ in range(25):
        values = rng.normal(100.0, 4.0, 1500)
        values[rng.integers(0, 1500, 20)] = np.nan
        for order in (2, 6):
            window_start = 1500 - 400
            for kind in ("high", "low"):
                full = levels.features.pivot_indices(
                    values, order, order, kind, nan_tolerant=False
                )
                expected = [
                    (i, float(values[i]))
                    for i in full
                    if i >= window_start
                    and np.isfinite(values[i])
                    and values[i] > 0.0
                ]
                assert (
                    levels._window_pivots(values, order, window_start, kind)
                    == expected
                )


def test_window_pivots_keeps_the_first_lookback_bar():
    values = np.full(1500, 100.0)
    # A confirmed spike exactly at window_start (1100) must survive; one bar
    # earlier must be discarded, matching the old full-frame scan + filter.
    values[1100] = 140.0
    values[1099] = 90.0
    points = levels._window_pivots(values, 6, 1100, "high")
    assert (1100, 140.0) in points
    assert all(i >= 1100 for i, _ in points)


def test_wire_fast_path_matches_sanitized_frame_exactly():
    raw = [
        (100.0, 101.0, 99.0, 100.0),
        ("101.5", "102.5", "100.5", "101.5"),
        (None, None, None, None),
        ("bad", "bad", "bad", "bad"),
        (102, 103, 101, 102),
        (True, True, True, True),
        (103.25, 104.25, 102.25, 103.25),
        (0.0, 1.0, -1.0, 0.0),
        (-5.0, -4.0, -6.0, -5.0),
    ]
    wire = [
        {
            "t": f"2026-01-{i + 1:02d}",
            "o": o,
            "h": h,
            "l": low,
            "c": c,
            "v": 1000,
        }
        for i, (o, h, low, c) in enumerate(raw)
    ]
    from_wire = levels._prepare_frame(wire)
    frame = pd.DataFrame(
        {
            "t": [candle["t"] for candle in wire],
            "open": [candle["o"] for candle in wire],
            "high": [candle["h"] for candle in wire],
            "low": [candle["l"] for candle in wire],
            "close": [candle["c"] for candle in wire],
        }
    ).set_index("t")
    from_frame = levels._prepare_frame(frame)
    pd.testing.assert_frame_equal(from_wire, from_frame.rename_axis(None))
    # Invalid/non-numeric bars are NaN, never emitted as data.
    assert from_wire.loc["2026-01-03"].isna().all()
    assert from_wire.loc["2026-01-04"].isna().all()
    assert (from_wire.loc[["2026-01-08", "2026-01-09"]] == 0.0).sum().sum() == 0
    assert from_wire.loc["2026-01-08"].isna().all()


def test_optimised_cluster_mean_matches_np_mean_bitwise():
    # The hot path uses add.reduce over a reused buffer instead of np.mean on a
    # growing list; both must agree to the last bit (including >8 touches).
    prices = [100.0 + i * 0.137 for i in range(20)]
    clusters = levels._cluster_touches(list(enumerate(prices)), 1e9)
    assert len(clusters) == 1
    assert clusters[0]["mean"] == float(np.mean(prices))


def test_seeded_golden_zones_are_unchanged_by_hotpath_optimisations():
    # Golden output from scripts/perf/bench_sr.py (seed 20261127, 400 bars).
    n = 400
    rng = np.random.default_rng(20261127 + n)
    close = 100.0 + np.cumsum(rng.normal(0.0, 0.35, n)) + 3.0 * np.sin(
        np.arange(n) / 11.0
    )
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + rng.uniform(0.05, 0.55, n)
    low = np.minimum(open_, close) - rng.uniform(0.05, 0.55, n)
    stamps = pd.date_range("2025-01-01", periods=n, freq="15min")
    wire = [
        {
            "t": stamp.isoformat(),
            "o": float(o),
            "h": float(h),
            "l": float(low_),
            "c": float(c),
            "v": float(v),
        }
        for stamp, o, h, low_, c, v in zip(
            stamps, open_, high, low, close, rng.integers(100, 2000, n)
        )
    ]
    expected = [
        {
            "bars_since_touch": 40,
            "bottom": 96.202302,
            "end_date": "2025-01-04",
            "end_time": "2025-01-04T17:45:00",
            "kind": "resistance",
            "score": 8099.91,
            "start_date": "2025-01-02",
            "start_time": "2025-01-02T05:15:00",
            "top": 96.978003,
            "touches": 8,
        },
        {
            "bars_since_touch": 34,
            "bottom": 95.228332,
            "end_date": "2025-01-04",
            "end_time": "2025-01-04T19:15:00",
            "kind": "resistance",
            "score": 5101.41,
            "start_date": "2025-01-02",
            "start_time": "2025-01-02T06:30:00",
            "top": 95.952492,
            "touches": 5,
        },
    ]
    assert levels.compute_sr_zones(wire, timeframe="15m") == expected

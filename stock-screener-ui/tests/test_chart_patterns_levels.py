"""Unit tests for backend-owned support/resistance zones (payload contract §5)."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from chart_patterns import levels


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
    closes = [110, 110, 100, 105, 120, 110, 100, 105, 120, 110, 110, 110]
    zones = levels.compute_sr_zones(_wire(closes), timeframe="1D")
    assert len(zones) == 2
    by_kind = {zone["kind"]: zone for zone in zones}
    assert by_kind["support"]["top"] < 110.0
    assert by_kind["resistance"]["bottom"] > 110.0
    for zone in zones:
        assert zone["touches"] == 2
        assert set(zone) == {
            "kind", "top", "bottom", "start_date", "end_date", "touches", "score",
        }
        assert math.isfinite(zone["score"]) and math.isfinite(zone["top"])
        assert zone["start_date"] <= zone["end_date"]
    # Deterministic scoring/order on repeated calls.
    assert levels.compute_sr_zones(_wire(closes), timeframe="1D") == zones


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
    closes = [110, 110, 100, 105, 120, 110, 100, 105, 120, 110, 110, 110]
    wire = _wire(closes)
    from_frame = levels.compute_sr_zones(_frame(closes), timeframe="1D")
    from_wire = levels.compute_sr_zones(wire, timeframe="1D")
    assert from_frame == from_wire
    for zone in from_wire:
        assert all(
            math.isfinite(zone[key]) for key in ("top", "bottom", "score")
        )
        assert zone["end_date"] <= wire[-1]["t"]

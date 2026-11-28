"""Parity: the price_action adapter must not change the chart S/R zone payload."""

from __future__ import annotations

import importlib
import math

import pandas as pd

from chart_patterns.levels import compute_sr_zones
from market_levels import PRICE_ACTION, DetectorSpec
from market_levels.detectors import price_action
from market_levels.registry import DETECTORS
from trading.timezone import TZ_IST

CLOSES = [110, 110, 100, 105, 120, 110, 100, 105, 120, 110, 110, 110]
AS_OF = "2026-01-12"


def _wire(closes, *, high_low: float = 0.5):
    index = pd.date_range("2026-01-01", periods=len(closes), freq="D")
    return [
        {
            "t": stamp.date().isoformat(),
            "o": close,
            "h": close + high_low,
            "l": close - high_low,
            "c": close,
            "v": 1000.0,
        }
        for stamp, close in zip(index, closes)
    ]


def _intraday_wire(closes):
    index = pd.date_range(
        "2026-01-05 09:15", periods=len(closes), freq="15min", tz=TZ_IST
    )
    return [
        {
            "t": stamp.isoformat(),
            "o": close,
            "h": close + 0.5,
            "l": close - 0.5,
            "c": close,
            "v": 1000.0,
        }
        for stamp, close in zip(index, closes)
    ]


def _ctx(candles, **overrides):
    ctx = {
        "symbol": "NIFTY",
        "timeframe": "1D",
        "as_of": AS_OF,
        "candles": candles,
    }
    ctx.update(overrides)
    return ctx


def _assert_parity(zones, levels, ctx):
    assert isinstance(levels, list)
    assert len(levels) == len(zones)
    for zone, level in zip(zones, levels):
        assert level.symbol == ctx["symbol"]
        assert level.timeframe == ctx["timeframe"]
        assert level.geometry == "zone"
        assert level.source == PRICE_ACTION
        assert level.side is None
        assert level.kind == zone["kind"]
        assert level.bottom == zone["bottom"]
        assert level.top == zone["top"]
        assert level.touches == zone["touches"]
        assert level.as_of == zone["end_date"]
        # Intraday clock detail stays in evidence; as_of edges are date-only
        # for both daily and intraday zones.
        assert level.start_as_of == zone["start_date"]
        assert level.end_as_of == zone["end_date"]
        assert level.price is None
        assert level.detector_version == "1"
        assert level.schema_version == 1
        assert level.evidence["raw_kind"] == zone.get("raw_kind", zone["kind"])
        assert level.evidence["score"] == zone["score"]
        assert level.evidence["start_date"] == zone["start_date"]
        assert level.evidence["end_date"] == zone["end_date"]
        assert level.evidence["touches"] == zone["touches"]
        assert level.evidence["bars_since_touch"] == zone["bars_since_touch"]
        for name in ("start_time", "end_time"):
            assert (name in level.evidence) == (name in zone)
            if name in zone:
                assert level.evidence[name] == zone[name]
        assert isinstance(level.strength, float)
        assert math.isfinite(level.strength)
        assert 0.0 <= level.strength <= 1.0

        rebuilt = {
            "kind": level.kind,
            "top": level.top,
            "bottom": level.bottom,
            "start_date": level.evidence["start_date"],
            "end_date": level.evidence["end_date"],
            "touches": level.touches,
            "score": level.evidence["score"],
            "bars_since_touch": level.evidence["bars_since_touch"],
        }
        if "start_time" in zone:
            rebuilt["start_time"] = level.evidence["start_time"]
            rebuilt["end_time"] = level.evidence["end_time"]
        assert rebuilt == zone


def test_spec_and_import_registration():
    assert price_action.SPEC == DetectorSpec(
        id="price_action",
        version="1",
        kind="price_action",
        min_bars=5,
        required_inputs=("candles",),
        params_schema={},
    )
    # Reload proves registration happens at import even if another suite cleared
    # the shared registry after this module was collected.
    module = importlib.reload(price_action)
    assert [entry for entry in DETECTORS if entry[0].id == "price_action"] == [
        (module.SPEC, module.detect)
    ]


def test_daily_zones_match_raw_detector_exactly():
    candles = _wire(CLOSES)
    ctx = _ctx(candles, timeframe="1D")
    zones = compute_sr_zones(candles, session=None, timeframe="1D", market=None)
    levels = price_action.detect(ctx)

    assert zones
    _assert_parity(zones, levels, ctx)
    assert {level.kind for level in levels} == {"support", "resistance"}
    assert all(zone["score"] > 1.0 for zone in zones), "raw score needs normalizing"
    assert len({level.id for level in levels}) == len(levels)


def test_strength_is_batch_relative_and_preserves_raw_score_order():
    candles = _wire(CLOSES)
    ctx = _ctx(candles, timeframe="1D")
    zones = compute_sr_zones(candles, timeframe="1D")
    levels = price_action.detect(ctx)

    assert zones
    max_score = max(zone["score"] for zone in zones)
    assert all(0.0 <= level.strength <= 1.0 for level in levels)
    assert all(
        level.strength == zone["score"] / max_score
        for zone, level in zip(zones, levels)
    )
    for zone, level in zip(zones, levels):
        if zone["score"] == max_score:
            assert level.strength == 1.0
    ordered = sorted(
        (zone["score"], level.strength) for zone, level in zip(zones, levels)
    )
    assert all(left[1] <= right[1] for left, right in zip(ordered, ordered[1:]))


def test_intraday_timestamps_survive_unchanged():
    candles = _intraday_wire(CLOSES)
    ctx = _ctx(
        candles,
        timeframe="15m",
        session=TZ_IST,
        market="india",
    )
    zones = compute_sr_zones(
        candles, session=TZ_IST, timeframe="15m", market="india"
    )
    levels = price_action.detect(ctx)

    assert zones
    assert all("start_time" in zone and "end_time" in zone for zone in zones)
    _assert_parity(zones, levels, ctx)
    assert all("start_time" in level.evidence for level in levels)


def test_sr_kind_is_preserved_exactly():
    closes = [99.98, 100.02] * 4 + [101.5]
    candles = _wire(closes, high_low=0.01)
    ctx = _ctx(candles, timeframe="1D")
    zones = compute_sr_zones(candles, timeframe="1D")
    levels = price_action.detect(ctx)

    assert len(zones) == 1
    assert zones[0]["kind"] == "sr"
    _assert_parity(zones, levels, ctx)
    assert levels[0].kind == "sr"


def test_detect_is_deterministic_across_repeated_calls():
    candles = _wire(CLOSES)
    ctx = _ctx(candles, timeframe="1D")
    first = price_action.detect(ctx)
    second = price_action.detect(ctx)
    third = price_action.detect(_ctx(_wire(CLOSES), timeframe="1D"))

    assert first == second == third
    assert [level.id for level in first] == [level.id for level in second]


def test_empty_and_short_candle_lists_return_empty():
    for candles in ([], _wire(CLOSES[:1]), _wire(CLOSES[:4])):
        assert price_action.detect(_ctx(candles, timeframe="1D")) == []

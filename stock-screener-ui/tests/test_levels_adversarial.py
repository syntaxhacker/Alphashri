"""Adversarial audit of the market_levels contract, adapters, fusion and service.

Every case here is offline. Upstream fixtures come from the sibling parity tests
so a drift in those helpers is caught here too. Two cases that used to fail are
kept as regression guards: non-finite spot side labelling and cold-registry
adapter registration.
"""

from __future__ import annotations

import copy
import importlib
import itertools
import math
from collections import Counter
from dataclasses import replace

import pytest

import market_levels

from api import options_levels
from api.options_levels import build_levels
from chart_patterns.levels import compute_sr_zones
from market_levels import (
    FUEL,
    GEX,
    LEVEL_SCHEMA_VERSION,
    MAX_PAIN,
    OI,
    PIVOT,
    PRICE_ACTION,
    RESISTANCE,
    SESSION,
    SOURCE_PRECEDENCE,
    SUPPORT,
    TRENDLINE,
    WALL,
    DetectorSpec,
    Level,
    LevelBook,
    build_level_book,
    fuse_levels,
    level_id,
)
from market_levels.detectors import gex as gex_detector
from market_levels.detectors import pivot as pivot_detector
from market_levels.detectors import price_action as price_action_detector
from market_levels.detectors import walls as walls_detector
from market_levels.fusion import _bounds
from market_levels.registry import (
    DETECTORS,
    clear_registry,
    iter_detectors,
    list_specs,
    register,
)
from tests import test_levels_integration as integration_mod
from tests.api.test_options_levels import _gex_row, _terse
from tests.test_levels_fusion import _level as _fused_level
from tests.test_levels_options_parity import ROWS, _side_of as _raw_side_of
from tests.test_levels_pivot_parity import HLC_CASES, PIVOT_KEYS, KINDS as PIVOT_KINDS
from tests.test_levels_price_action_parity import CLOSES, _intraday_wire, _wire
from trading.pivot_utils import calculate_pivot_points

AS_OF = "2026-01-01"
SYMBOL = "NIFTY"
TIMEFRAME = "1D"
SPOT = 22962.6
BAD_NUMBERS = (float("nan"), float("inf"), float("-inf"))


@pytest.fixture
def clean_registry():
    saved = list(DETECTORS)
    clear_registry()
    try:
        yield
    finally:
        DETECTORS[:] = saved


@pytest.fixture
def four_adapters(clean_registry):
    for module in (
        price_action_detector,
        pivot_detector,
        gex_detector,
        walls_detector,
    ):
        importlib.reload(module)
    yield


def _lvl(**overrides):
    values = {
        "id": level_id(PRICE_ACTION, SUPPORT, AS_OF, price=100.0),
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "as_of": AS_OF,
        "kind": SUPPORT,
        "source": PRICE_ACTION,
        "price": 100.0,
    }
    values.update(overrides)
    return Level(**values)


def _ctx(**overrides):
    ctx = {"symbol": SYMBOL, "timeframe": TIMEFRAME, "as_of": AS_OF}
    ctx.update(overrides)
    return ctx


def _rebuild_zone(level):
    zone = {
        "kind": level.kind,
        "top": level.top,
        "bottom": level.bottom,
        "start_date": level.evidence["start_date"],
        "end_date": level.evidence["end_date"],
        "touches": level.touches,
        "score": level.evidence["score"],
        "bars_since_touch": level.evidence["bars_since_touch"],
    }
    for name in ("start_time", "end_time"):
        if name in level.evidence:
            zone[name] = level.evidence[name]
    return zone


# --- contract --------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"price": None},
        {"price": None, "bottom": 100.0},
        {"price": None, "top": 101.0},
        {"price": None, "geometry": "zone", "bottom": 100.0},
        {"price": None, "geometry": "zone", "top": 101.0},
        {"price": None, "geometry": "segment", "start_price": 100.0},
        {"price": None, "geometry": "segment", "end_price": 101.0},
    ],
)
def test_level_rejects_missing_and_partial_geometry(overrides):
    with pytest.raises(ValueError, match="price, bottom\\+top"):
        _lvl(**overrides)


@pytest.mark.parametrize(
    "field", ("price", "bottom", "top", "start_price", "end_price", "strength")
)
@pytest.mark.parametrize("bad", BAD_NUMBERS)
def test_level_rejects_non_finite_numbers_everywhere(field, bad):
    overrides = {field: bad}
    if field in ("bottom", "start_price"):
        overrides["price"] = None
    if field == "bottom":
        overrides["top"] = 101.0
    if field == "start_price":
        overrides["end_price"] = 101.0
    with pytest.raises(ValueError, match="finite"):
        _lvl(**overrides)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"bottom": 101.0, "top": 100.0}, "bottom must be <= top"),
        ({"strength": -1e-12}, "between 0 and 1"),
        ({"strength": 1.0 + 1e-12}, "between 0 and 1"),
        ({"geometry": "channel"}, "geometry must be one of"),
        ({"geometry": ""}, "geometry must be one of"),
        ({"side": "sr"}, "side must be one of"),
        ({"side": "Below"}, "side must be one of"),
        ({"price": "not-a-number"}, "finite number"),
        ({"schema_version": 0}, "schema_version must be a positive integer"),
        ({"schema_version": True}, "schema_version must be a positive integer"),
    ],
)
def test_level_validation_error_messages(overrides, message):
    with pytest.raises(ValueError) as exc:
        _lvl(**overrides)
    assert message in str(exc.value)


def test_level_accepts_boundaries_and_equal_zone_edges():
    assert _lvl(strength=0.0).strength == 0.0
    assert _lvl(strength=1.0).strength == 1.0
    zone = _lvl(
        price=None, geometry="zone", bottom=100.0, top=100.0, side="inside"
    )
    assert (zone.geometry, zone.side) == ("zone", "inside")
    segment = _lvl(
        price=None, geometry="segment", start_price=110.0, end_price=100.0,
        start_as_of="2026-01-01", end_as_of="2026-01-10",
    )
    assert _bounds(segment) == (100.0, 110.0)
    assert (segment.start_as_of, segment.end_as_of) == ("2026-01-01", "2026-01-10")

    # A segment needs both date endpoints; the exact error names the missing ones.
    with pytest.raises(ValueError) as exc:
        _lvl(price=None, geometry="segment", start_price=110.0, end_price=100.0)
    assert str(exc.value) == (
        "segment geometry requires start_as_of and end_as_of, got "
        "start_as_of=None, end_as_of=None"
    )
    with pytest.raises(ValueError) as exc:
        _lvl(
            price=None, geometry="segment", start_price=110.0, end_price=100.0,
            start_as_of="2026-01-01",
        )
    assert str(exc.value) == (
        "segment geometry requires start_as_of and end_as_of, got "
        "start_as_of='2026-01-01', end_as_of=None"
    )


def test_level_id_stable_distinct_and_sensitive_to_every_identity_part():
    base = level_id(PRICE_ACTION, SUPPORT, AS_OF, price=100.0)
    assert base == level_id(PRICE_ACTION, SUPPORT, AS_OF, price=100.0)
    assert len(base) == 12 and all(c in "0123456789abcdef" for c in base)
    variants = [
        level_id(GEX, SUPPORT, AS_OF, price=100.0),
        level_id(PRICE_ACTION, RESISTANCE, AS_OF, price=100.0),
        level_id(PRICE_ACTION, SUPPORT, "2026-01-02", price=100.0),
        level_id(PRICE_ACTION, SUPPORT, AS_OF, price=100.5),
        level_id(PRICE_ACTION, SUPPORT, AS_OF, bottom=99.0, top=101.0),
        level_id(PRICE_ACTION, SUPPORT, AS_OF, start_price=99.0, end_price=101.0),
        level_id(PRICE_ACTION, SUPPORT, AS_OF, price=100.0, extra="call"),
    ]
    assert len({base, *variants}) == len(variants) + 1


def test_evidence_is_copied_per_instance_and_object_is_frozen():
    first = _lvl()
    second = _lvl()
    first.evidence["tag"] = 1
    assert second.evidence == {}
    assert Level.__hash__ is not None
    assert isinstance(_lvl(), Level)
    with pytest.raises(AttributeError):
        first.price = 101.0
    book = LevelBook(SYMBOL, TIMEFRAME, AS_OF, SPOT, (first,))
    assert book.schema_version == LEVEL_SCHEMA_VERSION


EXPECTED_PUBLIC_API = {
    "LEVEL_SCHEMA_VERSION",
    "SUPPORT",
    "RESISTANCE",
    "PIVOT",
    "FUEL",
    "WALL",
    "MAX_PAIN",
    "TRENDLINE",
    "PRICE_ACTION",
    "GEX",
    "OI",
    "SESSION",
    "Level",
    "LevelBook",
    "level_id",
    "DetectorSpec",
    "DETECTORS",
    "register",
    "iter_detectors",
    "list_specs",
    "clear_registry",
    "SOURCE_PRECEDENCE",
    "fuse_levels",
    "build_level_book",
}


def test_public_all_is_unique_resolvable_and_matches_public_surface():
    names = market_levels.__all__
    assert len(names) == len(set(names)), "duplicate name in __all__"
    assert all(hasattr(market_levels, name) for name in names)
    assert set(names) == EXPECTED_PUBLIC_API

    surface = {name for name in dir(market_levels) if not name.startswith("_")}
    assert set(names) <= surface
    # Variable by design: further submodules can appear as lanes are imported;
    # only these load-dependent names are allowed outside __all__.
    assert surface - set(names) <= {
        "models", "registry", "fusion", "service", "detectors"
    }


# --- price action ----------------------------------------------------------


@pytest.mark.parametrize(
    "candles", ([], _wire(CLOSES[:1]), _wire(CLOSES[:4]), None)
)
def test_price_action_empty_short_and_missing_candles(candles):
    assert price_action_detector.detect(_ctx(candles=candles)) == []


def test_price_action_invalid_numeric_bars_match_raw_detector_exactly():
    candles = _wire(CLOSES * 2)
    candles[10] = {**candles[10], "c": float("nan")}
    candles[11] = {**candles[11], "h": 50.0, "l": 150.0}
    candles.append({"t": "neg", "o": -1.0, "h": 1.0, "l": -2.0, "c": 1.0})
    zones = compute_sr_zones(candles, timeframe=TIMEFRAME)
    levels = price_action_detector.detect(_ctx(candles=candles, timeframe=TIMEFRAME))

    assert zones
    assert len(levels) == len(zones)
    assert [_rebuild_zone(level) for level in levels] == zones
    assert all(
        math.isfinite(level.bottom)
        and math.isfinite(level.top)
        and math.isfinite(level.strength)
        for level in levels
    )


def test_price_action_non_dict_rows_are_rejected_like_upstream():
    candles = _wire(CLOSES * 2) + [None, "junk"]
    assert compute_sr_zones(candles, timeframe=TIMEFRAME) == []
    assert price_action_detector.detect(_ctx(candles=candles)) == []


def test_price_action_intraday_times_are_exact_iso_strings():
    candles = _intraday_wire(CLOSES * 2)
    ctx = _ctx(
        candles=candles, timeframe="15m", session="Asia/Kolkata", market="india"
    )
    zones = compute_sr_zones(
        candles, session="Asia/Kolkata", timeframe="15m", market="india"
    )
    levels = price_action_detector.detect(ctx)

    assert zones and all("start_time" in zone and "end_time" in zone for zone in zones)
    assert len(levels) == len(zones)
    for zone, level in zip(zones, levels):
        assert level.evidence["start_time"] == zone["start_time"]
        assert level.evidence["end_time"] == zone["end_time"]
        assert "+05:30" in level.evidence["start_time"]
        assert _rebuild_zone(level) == zone


def test_price_action_sr_kind_and_raw_kind_are_preserved():
    candles = _wire([99.98, 100.02] * 4 + [101.5], high_low=0.01)
    zones = compute_sr_zones(candles, timeframe=TIMEFRAME)
    levels = price_action_detector.detect(_ctx(candles=candles))

    assert len(zones) == 1 and zones[0]["kind"] == "sr"
    assert len(levels) == 1 and levels[0].kind == "sr"
    assert levels[0].evidence["raw_kind"] == "sr"
    assert _rebuild_zone(levels[0]) == zones[0]


def test_price_action_strength_is_batch_relative_and_monotonic():
    candles = _wire(CLOSES)
    zones = compute_sr_zones(candles, timeframe=TIMEFRAME)
    levels = price_action_detector.detect(_ctx(candles=candles))
    max_score = max(zone["score"] for zone in zones)

    assert zones
    assert [level.evidence["score"] for level in levels] == [
        zone["score"] for zone in zones
    ]
    assert all(
        level.strength == zone["score"] / max_score
        for zone, level in zip(zones, levels)
    )
    assert any(level.strength == 1.0 for level in levels)
    by_score = sorted(zip(zones, levels), key=lambda pair: pair[0]["score"])
    assert all(
        left[1].strength <= right[1].strength
        for left, right in zip(by_score, by_score[1:])
    )


def test_price_action_non_finite_scores_get_zero_strength_and_keep_raw_evidence(
    monkeypatch,
):
    def zone(index, score):
        return {
            "kind": "support",
            "top": 101.0 + index,
            "bottom": 99.0 + index,
            "start_date": "2026-01-01",
            "end_date": "2026-01-02",
            "touches": index + 1,
            "score": score,
            "bars_since_touch": index,
        }

    zones = [zone(0, 1000.0)] + [zone(i, bad) for i, bad in enumerate(BAD_NUMBERS, 1)]
    zones.append(zone(4, 500.0))
    monkeypatch.setattr(price_action_detector, "compute_sr_zones", lambda *a, **k: zones)

    levels = price_action_detector.detect(_ctx(candles=[]))

    assert [level.strength for level in levels] == [1.0, 0.0, 0.0, 0.0, 0.5]
    assert [level.evidence["score"] for level in levels] == [
        zone["score"] for zone in zones
    ]


def test_price_action_repeated_calls_are_byte_identical():
    candles = _wire(CLOSES)
    ctx = _ctx(candles=candles)
    assert price_action_detector.detect(ctx) == price_action_detector.detect(ctx)
    assert price_action_detector.detect(ctx) == price_action_detector.detect(
        _ctx(candles=_wire(CLOSES))
    )
    assert len({level.id for level in price_action_detector.detect(ctx)}) == len(
        price_action_detector.detect(ctx)
    )


# --- pivot -----------------------------------------------------------------


@pytest.mark.parametrize(("label", "hlc"), HLC_CASES)
def test_pivot_every_key_matches_helper_without_rounding(label, hlc):
    points = calculate_pivot_points(
        hlc["high"], hlc["low"], hlc["close"], hlc["pivot_type"]
    )
    levels = pivot_detector.detect(_ctx(pivot_hlc=hlc))
    by_key = {level.evidence["pivot_key"]: level for level in levels}

    assert set(by_key) == {
        key for key in PIVOT_KEYS if getattr(points, key) is not None
    }
    for key in PIVOT_KEYS:
        value = getattr(points, key)
        if value is None:
            assert key not in by_key
            continue
        level = by_key[key]
        assert level.price == value
        assert level.price == float(value)
        assert level.price != round(level.price, 2)
        assert level.kind == PIVOT_KINDS[key]
        assert level.id == level_id(PIVOT, PIVOT_KINDS[key], AS_OF, price=value, extra=key)
        assert level.evidence == {"pivot_key": key}
        assert (level.symbol, level.timeframe, level.as_of) == (
            SYMBOL,
            TIMEFRAME,
            AS_OF,
        )


def test_pivot_r4_s4_only_for_camarilla_and_default_type_is_classic():
    hlc = {"high": 101.0, "low": 99.0, "close": 100.5}
    classic = pivot_detector.detect(_ctx(pivot_hlc=hlc))
    default = pivot_detector.detect(_ctx(pivot_hlc={k: v for k, v in hlc.items() if k != "pivot_type"}))
    camarilla = pivot_detector.detect(
        _ctx(pivot_hlc={**hlc, "pivot_type": "camarilla"})
    )

    assert classic == default
    assert not ({"r4", "s4"} & {lv.evidence["pivot_key"] for lv in classic})
    assert {lv.evidence["pivot_key"] for lv in camarilla} == set(PIVOT_KEYS)
    assert {lv.evidence["pivot_key"] for lv in classic} == set(PIVOT_KEYS) - {"r4", "s4"}


def test_pivot_unknown_type_falls_back_to_classic_like_helper():
    hlc = {"high": 103.0, "low": 97.0, "close": 101.0, "pivot_type": "unknown"}
    expected = calculate_pivot_points(103.0, 97.0, 101.0, "unknown")
    levels = pivot_detector.detect(_ctx(pivot_hlc=hlc))
    assert {lv.evidence["pivot_key"]: lv.price for lv in levels} == {
        key: getattr(expected, key)
        for key in PIVOT_KEYS
        if getattr(expected, key) is not None
    }


@pytest.mark.parametrize(
    ("hlc", "error"),
    [
        ({}, KeyError),
        ({"high": 100.0, "low": 90.0}, KeyError),
        ({"high": "bad", "low": 90.0, "close": 95.0}, TypeError),
        ({"high": None, "low": 90.0, "close": 95.0}, TypeError),
    ],
)
def test_pivot_missing_and_malformed_hlc_raise_like_helper(hlc, error):
    def oracle():
        return calculate_pivot_points(
            hlc["high"], hlc["low"], hlc["close"], hlc.get("pivot_type", "classic")
        )

    with pytest.raises(error) as helper_error:
        oracle()
    with pytest.raises(error) as adapter_error:
        pivot_detector.detect(_ctx(pivot_hlc=hlc))
    if error is TypeError:
        assert str(adapter_error.value) == str(helper_error.value)


@pytest.mark.parametrize("bad", BAD_NUMBERS)
def test_pivot_nan_and_inf_hlc_are_rejected_by_level_contract(bad):
    hlc = {"high": bad, "low": 90.0, "close": 95.0}
    with pytest.raises(ValueError, match="price must be finite"):
        pivot_detector.detect(_ctx(pivot_hlc=hlc))


def test_pivot_repeated_calls_are_identical():
    hlc = {"high": 22456.789012, "low": 22310.123456,
           "close": 22398.456789, "pivot_type": "camarilla"}
    assert pivot_detector.detect(_ctx(pivot_hlc=hlc)) == pivot_detector.detect(
        _ctx(pivot_hlc=dict(hlc))
    )


# --- options adapters ------------------------------------------------------


@pytest.mark.parametrize("rows", ([], None, _terse(100, 0, 0, 0), _terse(100, 0, 0, 0)))
def test_options_empty_and_zero_oi_chains_produce_no_levels(rows):
    ctx = _ctx(option_rows=rows, spot=100.0)
    assert gex_detector.detect(ctx) == ()
    assert walls_detector.detect(ctx) == ()


def test_degraded_gex_skips_gex_but_walls_survive():
    rows = [
        {"strike": s, "ce_oi": 1_000_000, "pe_oi": 500_000, "ce_gamma": 0.0, "pe_gamma": 0.0}
        for s in (22900.0, 23000.0, 23100.0)
    ]
    raw = build_levels(rows, SPOT)
    assert raw["gex"]["degraded"] is True

    ctx = _ctx(option_rows=rows, spot=SPOT)
    assert gex_detector.detect(ctx) == ()
    wall_levels = walls_detector.detect(ctx)
    assert wall_levels
    assert {lv.source for lv in wall_levels} == {OI}
    assert all(lv.kind in {WALL, MAX_PAIN} for lv in wall_levels)


def test_null_and_malformed_gex_blocks_are_skipped(monkeypatch):
    blocks = {
        "support": {"strike": 22900.0, "side": "below", "strength": 0.5, "net_gex": 1.0},
        "resistance": None,
        "fuel_down": "not-a-block",
        "fuel_up": {"strike": "bad", "side": "above", "net_gex": -1.0},
        "degraded": False,
    }
    monkeypatch.setattr(
        options_levels, "build_levels", lambda rows, spot: {"gex": blocks}
    )
    levels = gex_detector.detect(_ctx(option_rows=[], spot=SPOT))
    assert len(levels) == 1
    assert levels[0].kind == SUPPORT and levels[0].price == 22900.0
    assert levels[0].side == "below" and levels[0].strength == 0.5
    assert levels[0].evidence["raw"] == blocks["support"]


def test_null_and_malformed_wall_blocks_are_skipped(monkeypatch):
    payload = {
        "call_wall": {"strike": None, "oi": 10},
        "put_wall": None,
        "call_walls": [{"strike": "bad", "oi": 5}, None, float("nan")],
        "put_walls": "not-a-list",
        "max_pain": {"strike": "bad"},
    }
    monkeypatch.setattr(options_levels, "build_levels", lambda rows, spot: payload)
    assert walls_detector.detect(_ctx(option_rows=[], spot=SPOT)) == ()


def test_duplicate_walls_dedupe_to_first_field_and_rank(monkeypatch):
    block = {"strike": 23000.0, "side": "below", "oi": 10}
    payload = {
        "call_wall": block,
        "put_wall": None,
        "call_walls": [block, {"strike": 23100.0, "side": "above", "oi": 4}],
        "put_walls": [],
        "max_pain": None,
    }
    monkeypatch.setattr(options_levels, "build_levels", lambda rows, spot: payload)
    levels = walls_detector.detect(_ctx(option_rows=[], spot=SPOT))

    assert [lv.price for lv in levels] == [23000.0, 23100.0]
    assert [(lv.evidence["field"], lv.evidence["rank"]) for lv in levels] == [
        ("call_wall", 1),
        ("call_walls", 2),
    ]


def test_call_and_put_wall_at_same_price_both_survive_adapter(monkeypatch):
    payload = {
        "call_wall": {"strike": 23000.0, "side": "above", "oi": 10},
        "put_wall": {"strike": 23000.0, "side": "below", "oi": 20},
        "call_walls": [],
        "put_walls": [],
        "max_pain": None,
    }
    monkeypatch.setattr(options_levels, "build_levels", lambda rows, spot: payload)
    levels = walls_detector.detect(_ctx(option_rows=[], spot=SPOT))

    assert len(levels) == 2
    assert {lv.evidence["wall"] for lv in levels} == {"call", "put"}
    assert len({lv.id for lv in levels}) == 2
    # Fusion's identity excludes evidence, so these two provenance-distinct
    # walls collapse to one. Documented here as a known coverage gap.
    assert len(fuse_levels(levels, spot=SPOT)) == 1


def test_max_pain_dict_and_float_both_become_exact_levels(monkeypatch):
    raw = build_levels(ROWS, SPOT)
    dict_pain = walls_detector.detect(_ctx(option_rows=ROWS, spot=SPOT))
    pain = [lv for lv in dict_pain if lv.kind == MAX_PAIN]
    assert len(pain) == 1
    assert pain[0].price == raw["max_pain"]["strike"]
    assert pain[0].side == _raw_side_of(pain[0].price, SPOT)
    assert pain[0].evidence == {"field": "max_pain", "raw": raw["max_pain"]}
    assert pain[0].id == level_id(OI, MAX_PAIN, AS_OF, price=pain[0].price, extra="max_pain")

    monkeypatch.setattr(
        options_levels,
        "build_levels",
        lambda rows, spot: {
            "call_wall": None,
            "put_wall": None,
            "call_walls": [],
            "put_walls": [],
            "max_pain": 23000.0,
        },
    )
    ctx = _ctx(option_rows=[], spot=23000.0)
    float_pain = walls_detector.detect(ctx)
    assert len(float_pain) == 1
    assert (float_pain[0].price, float_pain[0].side) == (23000.0, "inside")
    assert float_pain[0].evidence == {"field": "max_pain", "raw": 23000.0}


def test_spot_equal_to_strike_gives_walls_inside_and_gex_raw_side():
    rows = [
        _gex_row(22900, 0.001, 1_000_000, 0, 0),
        _gex_row(23200, 0, 0, 0.001, 3_000_000),
    ]
    ctx = _ctx(option_rows=rows, spot=22900.0)
    raw = build_levels(rows, 22900.0)

    gex_levels = {lv.evidence["field"]: lv for lv in gex_detector.detect(ctx)}
    wall_levels = walls_detector.detect(ctx)
    assert raw["gex"]["support"]["strike"] == 22900.0
    assert gex_levels["support"].side == raw["gex"]["support"]["side"]
    assert gex_levels["resistance"].side == raw["gex"]["resistance"]["side"]
    assert [
        lv.side for lv in wall_levels if lv.price == 22900.0
    ] == ["inside"]


@pytest.mark.parametrize("spot", (None, float("nan"), float("inf"), 0.0, -1.0, "bad"))
def test_invalid_spot_yields_no_wall_side(spot):
    levels = walls_detector.detect(_ctx(option_rows=ROWS, spot=spot))
    assert levels
    assert all(lv.side is None for lv in levels)


def test_options_adapters_keep_exact_raw_parity_without_mutation():
    raw = build_levels(ROWS, SPOT)
    before = copy.deepcopy(raw)
    ctx = _ctx(option_rows=ROWS, spot=SPOT)

    gex_levels = {lv.evidence["field"]: lv for lv in gex_detector.detect(ctx)}
    wall_levels = walls_detector.detect(ctx)

    assert set(gex_levels) == {
        "support", "resistance", "fuel_down", "fuel_up"
    }
    for field, level in gex_levels.items():
        block = raw["gex"][field]
        assert (level.price, level.side, level.strength) == (
            block["strike"], block["side"], block["strength"]
        )
        assert level.evidence["raw"] == block
        assert level.evidence["net_gex"] == block["net_gex"]
    assert {lv.price for lv in wall_levels if lv.kind == WALL} == {
        block["strike"]
        for field, _ in (("call_wall", "call"), ("put_wall", "put"),
                         ("call_walls", "call"), ("put_walls", "put"))
        for block in (
            raw[field] if isinstance(raw[field], list) else [raw[field]]
        )
        if block is not None
    }
    assert raw == before
    assert ROWS == copy.deepcopy(ROWS)


# --- fusion ----------------------------------------------------------------


def test_exact_duplicates_dedupe_stronger_and_are_order_independent():
    weak = _fused_level(price=100.0, strength=0.2, touches=1)
    strong = _fused_level(price=100.0, strength=0.9, touches=5)
    for order in ((weak, strong), (strong, weak)):
        assert fuse_levels(order, spot=100.0) == fuse_levels([strong], spot=100.0)
        assert [(lv.id, lv.strength, lv.touches) for lv in fuse_levels(order, spot=100.0)] == [
            (strong.id, 0.9, 5)
        ]
    tie_low = _fused_level(price=101.0, strength=0.5, touches=2)
    tie_high = _fused_level(price=101.0, strength=0.5, touches=9)
    assert fuse_levels([tie_low, tie_high]) == (tie_high,)
    assert fuse_levels([tie_high, tie_low]) == (tie_high,)


def test_same_price_different_source_never_merges():
    sources = (PRICE_ACTION, PIVOT, GEX, OI, SESSION, TRENDLINE)
    levels = [
        _fused_level(source=source, price=100.0, strength=0.5, ident=source)
        for source in sources
    ]
    fused = fuse_levels(levels, spot=100.0)
    assert len(fused) == len(sources)
    assert [lv.source for lv in fused] == list(SOURCE_PRECEDENCE)


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"price": 90.0}, "below"),
        ({"price": 100.0}, "inside"),
        ({"price": 110.0}, "above"),
        ({"price": None, "bottom": 95.0, "top": 99.0}, "below"),
        ({"price": None, "bottom": 95.0, "top": 105.0}, "inside"),
        ({"price": None, "bottom": 101.0, "top": 105.0}, "above"),
        ({"price": None, "start_price": 110.0, "end_price": 105.0}, "above"),
    ],
)
def test_side_fill_all_geometries_and_explicit_side_wins(kwargs, expected):
    level = _fused_level(**kwargs)
    assert fuse_levels([level], spot=100.0)[0].side == expected
    explicit = _fused_level(price=90.0, side="inside", ident="explicit")
    assert fuse_levels([explicit], spot=100.0)[0].side == "inside"
    assert fuse_levels([_fused_level(price=90.0)])[0].side is None


@pytest.mark.parametrize("cap", (0, 1, 2))
def test_max_per_side_caps_each_side(cap):
    levels = [
        _fused_level(price=p, strength=s, ident=f"id-{i}")
        for i, (p, s) in enumerate(
            [(80.0, 0.9), (90.0, 0.5), (100.0, 0.3), (110.0, 0.2), (120.0, 0.4)]
        )
    ]
    fused = fuse_levels(levels, spot=100.0, max_per_side=cap)
    counts = {side: sum(lv.side == side for lv in fused) for side in ("below", "above", "inside")}
    assert all(count <= cap for count in counts.values())
    assert len(fused) == sum(min(count, cap) for count in (2, 2, 1))
    with pytest.raises(ValueError, match="max_per_side"):
        fuse_levels(levels, max_per_side=-1)


def test_deterministic_order_for_every_input_permutation():
    levels = [
        _fused_level(source=TRENDLINE, price=150.0, strength=1.0, ident="zz"),
        _fused_level(source=PRICE_ACTION, price=140.0, strength=0.1, ident="yy"),
        _fused_level(source=GEX, price=120.0, strength=0.5, ident="xx"),
        _fused_level(source=GEX, price=110.0, strength=0.9, ident="ww"),
        _fused_level(source=PRICE_ACTION, price=99.0, strength=0.1, ident="aaa"),
        _fused_level(source=PRICE_ACTION, price=101.0, strength=0.1, ident="bbb"),
    ]
    expected = fuse_levels(levels, spot=100.0)
    assert [(lv.source, lv.price) for lv in expected] == [
        (PRICE_ACTION, 99.0),
        (PRICE_ACTION, 101.0),
        (PRICE_ACTION, 140.0),
        (GEX, 110.0),
        (GEX, 120.0),
        (TRENDLINE, 150.0),
    ]
    for order in itertools.permutations(levels):
        assert fuse_levels(order, spot=100.0) == expected


def test_source_precedence_then_strength_then_distance():
    levels = [
        _fused_level(source=GEX, price=100.0, strength=0.1, ident="g"),
        _fused_level(source=PRICE_ACTION, price=200.0, strength=0.1, ident="p"),
        _fused_level(source=PIVOT, price=99.0, strength=1.0, ident="v"),
        _fused_level(source="other", price=100.0, strength=1.0, ident="o"),
    ]
    fused = fuse_levels(levels, spot=100.0)
    assert [lv.source for lv in fused] == [PRICE_ACTION, PIVOT, GEX, "other"]


def test_fusion_uses_id_as_final_tie_break_independent_of_input_order():
    low = _fused_level(
        kind=SUPPORT, price=100.0, strength=0.5, touches=2, ident="aaa"
    )
    high = _fused_level(
        kind=RESISTANCE, price=100.0, strength=0.5, touches=2, ident="zzz"
    )
    for order in ((low, high), (high, low)):
        fused = fuse_levels(order, spot=100.0)
        assert [lv.id for lv in fused] == ["aaa", "zzz"]
        assert [lv.kind for lv in fused] == [SUPPORT, RESISTANCE]
    # Reversing only the ids reverses the order, proving the id is the tie-break.
    flipped_low = _fused_level(
        kind=SUPPORT, price=100.0, strength=0.5, touches=2, ident="zzz"
    )
    flipped_high = _fused_level(
        kind=RESISTANCE, price=100.0, strength=0.5, touches=2, ident="aaa"
    )
    assert [lv.id for lv in fuse_levels([flipped_low, flipped_high], spot=100.0)] == [
        "aaa", "zzz"
    ]


NUMERIC_FIELDS = (
    "price", "bottom", "top", "strength", "touches", "start_price", "end_price"
)


def test_fusion_preserves_numeric_provenance_and_only_fills_side():
    levels = [
        _fused_level(price=90.0, strength=0.4, touches=2, ident="horizontal"),
        _fused_level(
            price=None, bottom=95.0, top=99.0, strength=0.6, touches=3,
            ident="zone",
        ),
        _fused_level(
            price=None, start_price=105.0, end_price=110.0, strength=0.8,
            touches=4, ident="segment",
        ),
        _fused_level(price=100.0, strength=0.2, side="inside", ident="explicit"),
    ]
    before = {
        lv.id: tuple(getattr(lv, name) for name in NUMERIC_FIELDS) for lv in levels
    }
    sides_before = {lv.id: lv.side for lv in levels}

    fused = fuse_levels(levels, spot=100.0)

    assert {lv.id for lv in fused} == set(before)
    assert {
        lv.id: tuple(getattr(lv, name) for name in NUMERIC_FIELDS) for lv in fused
    } == before
    for level in fused:
        assert replace(level, side=sides_before[level.id]) == dict(
            (lv.id, lv) for lv in levels
        )[level.id]
    assert {lv.id: lv.side for lv in fused} == {
        "horizontal": "below", "zone": "below", "segment": "above",
        "explicit": "inside",
    }


def test_fusion_preserves_evidence_and_provenance_and_never_mutates_inputs():
    level = _fused_level(price=100.0, ident="id")
    level.evidence["tag"] = {"nested": 1}
    snapshot = copy.deepcopy(level.evidence)
    fused = fuse_levels([level], spot=100.0)
    assert fused[0].evidence == snapshot
    assert (fused[0].id, fused[0].detector_version, fused[0].schema_version) == (
        level.id, level.detector_version, level.schema_version
    )
    assert level.side is None


@pytest.mark.parametrize("bad_spot", BAD_NUMBERS)
def test_fusion_nonfinite_spot_must_not_label_side(bad_spot):
    """Regression guard: non-finite spots must not receive a confident side.

    Fusion used to label NaN/Inf spots as inside/below/above even though
    ``walls._side`` declines them; the finiteness guard now leaves ``side``
    unset. Keep this case so the old behaviour cannot return.
    """
    level = _fused_level(price=100.0)
    assert fuse_levels([level], spot=bad_spot)[0].side is None


# --- service ---------------------------------------------------------------


def test_service_skips_detectors_with_missing_required_inputs(clean_registry):
    seen = []

    def detector(name, required, price):
        def fn(ctx):
            seen.append((name, dict(ctx)))
            return _fused_level(price=price, ident=name)

        register(DetectorSpec(name, "1", SUPPORT, 0, required, {}), fn)

    detector("candles_only", ("candles",), 90.0)
    detector("needs_chain", ("option_rows", "spot"), 110.0)
    detector("needs_custom", ("custom_input",), 120.0)

    book = build_level_book(
        SYMBOL, TIMEFRAME, AS_OF, candles=[{"c": 1.0}], spot=100.0,
        ctx={"custom_input": [1]}, use_adapters=False,
    )

    assert [name for name, _ in seen] == ["candles_only", "needs_custom"]
    assert "option_rows" not in seen[0][1]
    assert seen[0][1]["custom_input"] == [1]
    assert [lv.id for lv in book.levels] == ["candles_only", "needs_custom"]


def test_service_merges_caller_ctx_and_keeps_book_identity(clean_registry):
    seen = []

    def fn(ctx):
        seen.append(dict(ctx))
        return _fused_level(price=100.0, ident="ctx_detector")

    register(
        DetectorSpec("ctx_detector", "1", SUPPORT, 0, ("custom_input",), {}), fn
    )
    ctx = {
        "symbol": "OVERRIDE",
        "candles": ["from-ctx"],
        "custom_input": 7,
        "extra": "visible",
    }
    book = build_level_book(
        SYMBOL, TIMEFRAME, AS_OF, candles=[{"c": 2.0}], spot=100.0,
        ctx=ctx, use_adapters=False,
    )

    assert seen[0]["symbol"] == "OVERRIDE"
    assert seen[0]["candles"] == ["from-ctx"]
    assert seen[0]["custom_input"] == 7 and seen[0]["extra"] == "visible"
    assert (book.symbol, book.timeframe, book.as_of, book.spot) == (
        SYMBOL, TIMEFRAME, AS_OF, 100.0
    )
    assert book.levels[0].source == PRICE_ACTION


@pytest.mark.parametrize(
    ("result", "error"),
    [
        (None, None),
        (_fused_level(price=100.0), None),
        ([_fused_level(price=100.0)], None),
        (("not-a-level",), TypeError),
        (42, TypeError),
    ],
)
def test_service_validates_detector_results(clean_registry, result, error):
    def fn(ctx):
        return result

    register(DetectorSpec("shaped", "1", SUPPORT), fn)
    if error is None:
        book = build_level_book(SYMBOL, TIMEFRAME, AS_OF, use_adapters=False)
        assert len(book.levels) == (0 if result is None else 1)
    else:
        with pytest.raises(error):
            build_level_book(SYMBOL, TIMEFRAME, AS_OF, use_adapters=False)


def test_service_all_four_real_adapters_produce_one_levelbook(four_adapters):
    candles = _wire(CLOSES)
    hlc = {"high": 101.234567, "low": 97.891234, "close": 99.876543}
    book = build_level_book(
        SYMBOL, TIMEFRAME, AS_OF, candles=candles, pivot_hlc=hlc,
        option_rows=ROWS, spot=SPOT,
    )

    assert isinstance(book, LevelBook)
    assert {lv.source for lv in book.levels} == {
        PRICE_ACTION, PIVOT, GEX, OI
    }
    assert book.schema_version == LEVEL_SCHEMA_VERSION
    assert len({lv.id for lv in book.levels}) == len(book.levels)
    assert all(lv.side in {"below", "above", "inside"} for lv in book.levels)
    assert {spec.id for spec in [s for s, _ in iter_detectors()]} == {
        "price_action", "pivot", "gex", "walls", "trendline"
    }
    assert {lv.kind for lv in book.levels if lv.source == PRICE_ACTION} == {
        SUPPORT, RESISTANCE
    }
    assert {lv.evidence["pivot_key"] for lv in book.levels if lv.source == PIVOT} == set(
        PIVOT_KEYS
    ) - {"r4", "s4"}
    assert {lv.evidence["field"] for lv in book.levels if lv.source == GEX} == {
        "support", "resistance", "fuel_down", "fuel_up"
    }
    assert {lv.kind for lv in book.levels if lv.source == OI} == {WALL, MAX_PAIN}


def test_cold_registry_build_book_registers_all_four_adapters(clean_registry):
    """No pre-registration and no reload: _ensure_adapters must register them."""
    assert list_specs() == []

    book = build_level_book(
        SYMBOL, TIMEFRAME, AS_OF, candles=_wire(CLOSES),
        pivot_hlc={"high": 101.234567, "low": 97.891234, "close": 99.876543},
        option_rows=ROWS, spot=SPOT,
    )

    assert {spec.id for spec in list_specs()} == {
        "price_action", "pivot", "gex", "walls", "trendline"
    }
    assert {lv.source for lv in book.levels} == {
        PRICE_ACTION, PIVOT, GEX, OI
    }


def test_integration_fixture_exact_counts_per_source(four_adapters):
    """The integration fixture has 18 levels: replace any weaker >= assertion."""
    book = build_level_book(
        integration_mod.SYMBOL, integration_mod.TIMEFRAME, integration_mod.AS_OF,
        candles=integration_mod._candles(),
        pivot_hlc=dict(integration_mod.PIVOT_HLC),
        option_rows=integration_mod.OPTION_ROWS,
        spot=integration_mod.SPOT,
    )

    counts = Counter(level.source for level in book.levels)
    assert counts == {PRICE_ACTION: 3, PIVOT: 7, GEX: 4, OI: 4}
    assert len(book.levels) == 18


def test_service_does_not_mutate_any_upstream_input(four_adapters):
    candles = _wire(CLOSES)
    hlc = {"high": 101.0, "low": 99.0, "close": 100.0, "pivot_type": "classic"}
    rows = copy.deepcopy(ROWS)
    candle_before, hlc_before, rows_before = (
        copy.deepcopy(candles), dict(hlc), copy.deepcopy(rows)
    )
    build_level_book(
        SYMBOL, TIMEFRAME, AS_OF, candles=candles, pivot_hlc=hlc,
        option_rows=rows, spot=SPOT,
    )
    assert candles == candle_before and hlc == hlc_before and rows == rows_before

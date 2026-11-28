"""End-to-end LevelBook integration across all four adapters.

Read-only by contract: the raw chart S/R, pivot and options analytics are
computed here as an oracle and compared to the fused book. Nothing in this
module mutates an upstream payload, and no existing consumer output is read or
rewritten.
"""

from __future__ import annotations

import copy
import importlib
from collections import Counter
from datetime import date, timedelta

import pandas as pd
import pytest

from api.options_levels import build_levels
from chart_patterns.levels import compute_sr_zones
from market_levels import (
    FUEL,
    GEX,
    MAX_PAIN,
    OI,
    PIVOT,
    PRICE_ACTION,
    RESISTANCE,
    SOURCE_PRECEDENCE,
    SUPPORT,
    WALL,
    build_level_book,
)
from market_levels.detectors import gex as gex_detector
from market_levels.detectors import pivot as pivot_detector
from market_levels.detectors import price_action as price_action_detector
from market_levels.detectors import walls as walls_detector
from market_levels.fusion import fuse_levels
from market_levels.registry import DETECTORS, clear_registry, list_specs
from trading.pivot_utils import calculate_pivot_points
from tests.helpers.levels_fixtures import SR_CLOSES

SYMBOL = "NIFTY"
TIMEFRAME = "1D"
AS_OF = "2026-01-01"
SPOT = 22962.6

# Fixed inputs. The chain is the case from tests/test_levels_options_parity.py;
# the HLC triple is a fixed "classic" case from tests/test_levels_pivot_parity.py.
PIVOT_HLC = {
    "high": 101.234567,
    "low": 97.891234,
    "close": 99.876543,
    "pivot_type": "classic",
}
OPTION_ROWS = [
    {"strike": 22500.0, "ce_oi": 100_000, "pe_oi": 1_000_000,
     "ce_gamma": 0.0001, "pe_gamma": 0.002},
    {"strike": 22700.0, "ce_oi": 300_000, "pe_oi": 500_000,
     "ce_gamma": 0.0004, "pe_gamma": 0.0008},
    {"strike": 22900.0, "ce_oi": 900_000, "pe_oi": 200_000,
     "ce_gamma": 0.0009, "pe_gamma": 0.0005},
    {"strike": 22950.0, "ce_oi": 1_500_000, "pe_oi": 700_000,
     "ce_gamma": 0.0006, "pe_gamma": 0.0006},
    {"strike": 23000.0, "ce_oi": 1_100_000, "pe_oi": 1_300_000,
     "ce_gamma": 0.0005, "pe_gamma": 0.0009},
    {"strike": 23200.0, "ce_oi": 800_000, "pe_oi": 400_000,
     "ce_gamma": 0.001, "pe_gamma": 0.0004},
]

_PIVOT_KEYS = ("pp", "r1", "r2", "r3", "s1", "s2", "s3", "r4", "s4")
_PIVOT_KINDS = {
    "pp": PIVOT,
    "r1": RESISTANCE, "r2": RESISTANCE, "r3": RESISTANCE, "r4": RESISTANCE,
    "s1": SUPPORT, "s2": SUPPORT, "s3": SUPPORT, "s4": SUPPORT,
}
_GEX_FIELDS = {
    "support": SUPPORT,
    "resistance": RESISTANCE,
    "fuel_down": FUEL,
    "fuel_up": FUEL,
}
_WALL_FIELDS = (
    ("call_wall", "call"),
    ("put_wall", "put"),
    ("call_walls", "call"),
    ("put_walls", "put"),
)
_SR_UNIT = SR_CLOSES

# Exact oracle values for this fixed fixture. These pin the expected output:
# dropping a source or narrowing a kind set must fail, not merely stay a subset.
_EXPECTED_SOURCE_COUNTS = {PRICE_ACTION: 3, PIVOT: 7, GEX: 4, OI: 4}
_EXPECTED_PRICE_ACTION_KINDS = ["resistance", "resistance", "support"]
_EXPECTED_PIVOT_KEYS = {"pp", "r1", "r2", "r3", "s1", "s2", "s3"}
_EXPECTED_OI_KINDS = ["max_pain", "wall", "wall", "wall"]


def _closes(n: int = 400) -> list[float]:
    """Deterministic, repeating S/R-shaped closes (no RNG, no network)."""
    return [
        100.0 + (value - 110.0)
        for value in (_SR_UNIT * ((n // len(_SR_UNIT)) + 1))[:n]
    ]


def _candles(n: int = 400) -> list[dict]:
    """Daily wire candles in the style of tests/test_chart_patterns_levels.py."""
    start = date(2025, 1, 1)
    return [
        {
            "t": (start + timedelta(days=i)).isoformat(),
            "o": close,
            "h": close + 0.5,
            "l": close - 0.5,
            "c": close,
            "v": 1000.0,
        }
        for i, close in enumerate(_closes(n))
    ]


def _intraday_candles(n: int = 400) -> list[dict]:
    index = pd.date_range(
        "2026-01-05 09:15", periods=n, freq="15min", tz="Asia/Kolkata"
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
        for stamp, close in zip(index, _closes(n))
    ]


def _build(**overrides) -> object:
    kwargs = {
        "candles": _candles(),
        "pivot_hlc": dict(PIVOT_HLC),
        "option_rows": OPTION_ROWS,
        "spot": SPOT,
    }
    kwargs.update(overrides)
    return build_level_book(SYMBOL, TIMEFRAME, AS_OF, **kwargs)


@pytest.fixture
def book():
    """Guarantee a clean four-adapter registry, then restore it afterwards.

    Other suites reload/clear the shared registry, so this makes the integration
    deterministic without leaking any registration state to them.
    """
    saved = list(DETECTORS)
    clear_registry()
    for module in (
        price_action_detector,
        pivot_detector,
        gex_detector,
        walls_detector,
    ):
        importlib.reload(module)
    try:
        yield _build()
    finally:
        DETECTORS[:] = saved


def _zone_key(zone: dict) -> tuple:
    """Hashable, order-independent view of a raw zone dict."""
    return tuple(sorted(zone.items()))


def _rebuild_zone(level) -> dict:
    """Reconstruct the raw compute_sr_zones payload from a Level + evidence."""
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


def _side_of(level, spot: float) -> str:
    """Independent geometry-based side, used to check fusion's side fill."""
    if level.price is not None:
        low = high = float(level.price)
    elif level.bottom is not None and level.top is not None:
        low, high = float(level.bottom), float(level.top)
    else:
        low, high = sorted((float(level.start_price), float(level.end_price)))
    if high < spot:
        return "below"
    if low > spot:
        return "above"
    return "inside"


def _raw_wall_entries() -> list[tuple[str, str, dict]]:
    """Adapter-equivalent, de-duplicated (field, wall, block) wall entries."""
    raw = build_levels(OPTION_ROWS, SPOT)
    entries: list[tuple[str, str, dict]] = []
    seen: set[tuple[str, float]] = set()
    for field, wall in _WALL_FIELDS:
        block = raw.get(field)
        for entry in (block if isinstance(block, list) else [block]):
            if entry is None or (wall, entry["strike"]) in seen:
                continue
            seen.add((wall, entry["strike"]))
            entries.append((field, wall, entry))
    return entries


# --- book-level invariants -------------------------------------------------


def test_all_four_sources_determinism_and_unique_ids(book):
    assert {spec.id for spec in list_specs()} == {
        "price_action", "pivot", "gex", "walls", "trendline"
    }
    assert book.symbol == SYMBOL and book.timeframe == TIMEFRAME
    assert book.as_of == AS_OF and book.spot == SPOT
    assert book.schema_version == 1
    assert {level.source for level in book.levels} == {
        PRICE_ACTION, PIVOT, GEX, OI
    }
    assert Counter(level.source for level in book.levels) == Counter(
        _EXPECTED_SOURCE_COUNTS
    )
    assert len(book.levels) == sum(_EXPECTED_SOURCE_COUNTS.values()) == 18
    assert len({level.id for level in book.levels}) == len(book.levels)
    # Fresh inputs, fresh book: byte-for-byte identical frozen value objects.
    assert book == _build()


def test_service_matches_manual_fusion_of_adapters(book):
    ctx = {
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "as_of": AS_OF,
        "candles": _candles(),
        "pivot_hlc": dict(PIVOT_HLC),
        "option_rows": OPTION_ROWS,
        "spot": SPOT,
    }
    detected = []
    for module in (
        price_action_detector,
        pivot_detector,
        gex_detector,
        walls_detector,
    ):
        detected.extend(module.detect(ctx))
    assert book.levels == fuse_levels(detected, spot=SPOT)


def test_fusion_fills_sides_and_preserves_provenance(book):
    assert book.levels
    assert all(level.side == _side_of(level, SPOT) for level in book.levels)
    assert all(level.side in {"below", "above", "inside"} for level in book.levels)
    # Source rank is the deterministic top-level ordering key.
    ranks = [SOURCE_PRECEDENCE.index(level.source) for level in book.levels]
    assert ranks == sorted(ranks)
    # Provenance fields survive fusion untouched.
    assert all(level.symbol == SYMBOL and level.timeframe == TIMEFRAME
               for level in book.levels)
    assert all(level.detector_version == "1" and level.schema_version == 1
               for level in book.levels)
    assert all("raw_kind" in level.evidence for level in book.levels
               if level.source == PRICE_ACTION)
    assert all("pivot_key" in level.evidence for level in book.levels
               if level.source == PIVOT)
    assert all("field" in level.evidence for level in book.levels
               if level.source in (GEX, OI))


# --- per-source parity against the untouched upstream functions -----------


def test_price_action_zones_reconstruct_exactly(book):
    candles = _candles()
    zones = compute_sr_zones(candles, session=None, timeframe=TIMEFRAME, market=None)
    assert len(zones) == 3
    assert Counter(zone["kind"] for zone in zones) == Counter(
        {"resistance": 2, "support": 1}
    )
    rebuilt = [
        _rebuild_zone(level)
        for level in book.levels
        if level.source == PRICE_ACTION
    ]
    assert Counter(map(_zone_key, zones)) == Counter(map(_zone_key, rebuilt))
    assert sorted(level.kind for level in book.levels
                  if level.source == PRICE_ACTION) == _EXPECTED_PRICE_ACTION_KINDS
    assert sorted(level.evidence["raw_kind"] for level in book.levels
                  if level.source == PRICE_ACTION) == _EXPECTED_PRICE_ACTION_KINDS
    assert all(level.geometry == "zone" and level.side is not None
               for level in book.levels if level.source == PRICE_ACTION)


def test_price_action_times_reconstruct_via_evidence():
    candles = _intraday_candles()
    zones = compute_sr_zones(
        candles, session="Asia/Kolkata", timeframe="15m", market="india"
    )
    assert zones and all("start_time" in zone for zone in zones)
    saved = list(DETECTORS)
    clear_registry()
    importlib.reload(price_action_detector)
    try:
        intraday_book = build_level_book(
            SYMBOL, "15m", AS_OF, candles=candles,
            session="Asia/Kolkata", market="india",
            pivot_hlc=dict(PIVOT_HLC), option_rows=OPTION_ROWS, spot=SPOT,
        )
    finally:
        DETECTORS[:] = saved

    rebuilt = [
        _rebuild_zone(level)
        for level in intraday_book.levels
        if level.source == PRICE_ACTION
    ]
    assert Counter(map(_zone_key, zones)) == Counter(map(_zone_key, rebuilt))
    assert all("start_time" in level.evidence and "end_time" in level.evidence
               for level in intraday_book.levels if level.source == PRICE_ACTION)


def test_pivot_values_reconstruct_exactly(book):
    points = calculate_pivot_points(
        PIVOT_HLC["high"], PIVOT_HLC["low"], PIVOT_HLC["close"], "classic"
    )
    expected = {
        key: (_PIVOT_KINDS[key], getattr(points, key))
        for key in _PIVOT_KEYS
        if getattr(points, key) is not None
    }
    actual = {
        level.evidence["pivot_key"]: (level.kind, level.price)
        for level in book.levels
        if level.source == PIVOT
    }
    assert actual == expected
    assert set(actual) == _EXPECTED_PIVOT_KEYS
    assert not ({"r4", "s4"} & set(actual)), "classic pivots have no R4/S4"
    assert Counter(level.kind for level in book.levels
                   if level.source == PIVOT) == Counter(
        {PIVOT: 1, RESISTANCE: 3, SUPPORT: 3}
    )
    assert all(level.geometry == "horizontal" and level.as_of == AS_OF
               and level.strength is None and level.touches is None
               for level in book.levels if level.source == PIVOT)


def test_gex_levels_match_options_builder_exactly(book):
    raw = build_levels(OPTION_ROWS, SPOT)
    levels = {lv.evidence["field"]: lv for lv in book.levels if lv.source == GEX}
    assert set(levels) == set(_GEX_FIELDS)
    for field, kind in _GEX_FIELDS.items():
        block = raw["gex"][field]
        level = levels[field]
        assert (level.kind, level.price, level.side, level.strength) == (
            kind, block["strike"], block["side"], block["strength"],
        )
        assert level.evidence["raw"] == block
        assert level.evidence["net_gex"] == block["net_gex"]
        assert level.geometry == "horizontal" and level.as_of == AS_OF


def test_wall_levels_match_options_builder_after_fusion(book):
    raw = build_levels(OPTION_ROWS, SPOT)
    entries = _raw_wall_entries()
    walls = [lv for lv in book.levels if lv.source == OI and lv.kind == WALL]
    pains = [lv for lv in book.levels if lv.source == OI and lv.kind == MAX_PAIN]

    # Fusion collapses same-price call/put walls (identity excludes the wall
    # side), so compare the distinct strikes the adapter produced.
    expected_prices = {block["strike"] for _, _, block in entries}
    assert {lv.price for lv in walls} == expected_prices
    assert len(walls) == len(expected_prices)
    assert expected_prices == {22900.0, 22950.0, 23000.0}
    assert sorted(lv.kind for lv in book.levels
                  if lv.source == OI) == _EXPECTED_OI_KINDS
    # Rank/index come straight from the upstream wall enumeration and survive fusion.
    assert sorted((lv.evidence["rank"], lv.evidence["index"], lv.price)
                  for lv in walls) == [
        (1, 0, 22950.0), (2, 1, 23000.0), (3, 2, 22900.0),
    ]
    assert {(lv.evidence["field"], lv.evidence["wall"], lv.price)
            for lv in walls} == {
        ("call_wall", "call", 22950.0),
        ("call_walls", "call", 23000.0),
        ("call_walls", "call", 22900.0),
    }
    for level in walls:
        candidates = [block for _, _, block in entries
                      if block["strike"] == level.price]
        assert candidates
        assert level.side in {block["side"] for block in candidates}
        assert level.evidence["raw"] in candidates
        assert level.evidence["wall"] in {"call", "put"}
        assert level.strength is None and level.geometry == "horizontal"

    pain = raw["max_pain"]
    assert len(pains) == 1
    assert pains[0].price == pain["strike"]
    assert pains[0].side == pain["side"]
    assert pains[0].evidence == {"field": "max_pain", "raw": pain}


def test_building_book_does_not_mutate_upstream_outputs():
    candles = _candles()
    zones_before = copy.deepcopy(
        compute_sr_zones(candles, session=None, timeframe=TIMEFRAME, market=None)
    )
    points_before = calculate_pivot_points(
        PIVOT_HLC["high"], PIVOT_HLC["low"], PIVOT_HLC["close"], "classic"
    )
    options_before = copy.deepcopy(build_levels(OPTION_ROWS, SPOT))
    rows_before = copy.deepcopy(OPTION_ROWS)
    hlc_before = dict(PIVOT_HLC)

    _build(candles=candles)

    assert candles == _candles()
    assert OPTION_ROWS == rows_before
    assert PIVOT_HLC == hlc_before
    assert compute_sr_zones(candles, timeframe=TIMEFRAME) == zones_before
    assert calculate_pivot_points(
        PIVOT_HLC["high"], PIVOT_HLC["low"], PIVOT_HLC["close"], "classic"
    ) == points_before
    assert build_levels(OPTION_ROWS, SPOT) == options_before

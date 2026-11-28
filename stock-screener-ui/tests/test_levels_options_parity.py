"""Exact parity between ``api.options_levels`` and the options Level adapters."""

from __future__ import annotations

import ast
import copy
import importlib
from pathlib import Path

import pytest

from api import options_levels
from api.options_levels import build_levels
from market_levels import (
    FUEL,
    GEX,
    MAX_PAIN,
    OI,
    RESISTANCE,
    SUPPORT,
    WALL,
    DetectorSpec,
    build_level_book,
    level_id,
)
from market_levels.detectors import gex as gex_detector
from market_levels.detectors import walls as walls_detector
from market_levels.registry import iter_detectors

SYMBOL = "NIFTY"
TIMEFRAME = "1D"
AS_OF = "2026-01-01"
SPOT = 22962.6

# Fixed chain: all four GEX blocks resolve, the top call/put walls also appear
# in the near lists (the dedupe case), and max pain lands on the call wall.
ROWS = [
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

GEX_FIELDS = {
    "support": SUPPORT,
    "resistance": RESISTANCE,
    "fuel_down": FUEL,
    "fuel_up": FUEL,
}
WALL_FIELDS = (
    ("call_wall", "call"),
    ("put_wall", "put"),
    ("call_walls", "call"),
    ("put_walls", "put"),
)


def _ctx(rows=None, spot=SPOT) -> dict:
    return {
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "as_of": AS_OF,
        "option_rows": ROWS if rows is None else rows,
        "spot": spot,
    }


def _side_of(price: float, spot: float):
    if spot <= 0:
        return None
    return "below" if price < spot else ("above" if price > spot else "inside")


def test_specs_registered_at_import():
    # Reload so the assertion also holds if another module cleared the registry.
    gex_mod = importlib.reload(gex_detector)
    walls_mod = importlib.reload(walls_detector)
    assert gex_mod.SPEC == DetectorSpec(
        id="gex", version="1", kind=GEX, min_bars=0,
        required_inputs=("option_rows", "spot"), params_schema={},
    )
    assert walls_mod.SPEC == DetectorSpec(
        id="walls", version="1", kind=OI, min_bars=0,
        required_inputs=("option_rows", "spot"), params_schema={},
    )
    registered = {spec.id: (spec, fn) for spec, fn in iter_detectors()}
    assert registered["gex"] == (gex_mod.SPEC, gex_mod.detect)
    assert registered["walls"] == (walls_mod.SPEC, walls_mod.detect)


@pytest.mark.parametrize("module", [gex_detector, walls_detector])
def test_api_is_imported_lazily(module):
    tree = ast.parse(Path(module.__file__).read_text())
    top_level_api = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""]
        else:
            continue
        top_level_api.extend(name for name in names if name.startswith("api"))
    assert top_level_api == []
    detect_fn = next(n for n in tree.body
                     if isinstance(n, ast.FunctionDef) and n.name == "detect")
    assert any(isinstance(n, ast.ImportFrom) and n.module == "api.options_levels"
               for n in ast.walk(detect_fn))


def test_gex_levels_match_raw_blocks_exactly():
    raw = build_levels(ROWS, SPOT)
    levels = {lv.evidence["field"]: lv for lv in gex_detector.detect(_ctx())}

    assert set(levels) == set(GEX_FIELDS)
    for field, kind in GEX_FIELDS.items():
        block = raw["gex"][field]
        lv = levels[field]
        assert block is not None
        assert (lv.kind, lv.source, lv.geometry) == (kind, GEX, "horizontal")
        assert (lv.symbol, lv.timeframe, lv.as_of) == (SYMBOL, TIMEFRAME, AS_OF)
        assert lv.price == block["strike"]
        assert lv.side == block["side"]
        assert lv.strength == block["strength"]
        assert set(lv.evidence) == {"field", "raw", "net_gex"}
        assert lv.evidence["raw"] == block
        assert lv.evidence["net_gex"] == block["net_gex"]
        assert lv.id == level_id(GEX, kind, AS_OF, price=block["strike"],
                                 extra=field)
        assert lv.detector_version == "1"
        assert lv.schema_version == 1
        assert lv.touches is None
        assert (lv.start_as_of, lv.end_as_of) == (None, None)


def test_wall_levels_match_raw_blocks_and_dedupe_singles():
    raw = build_levels(ROWS, SPOT)
    levels = walls_detector.detect(_ctx())
    walls = [lv for lv in levels if lv.kind == WALL]
    pains = [lv for lv in levels if lv.kind == MAX_PAIN]
    assert {lv.kind for lv in levels} == {WALL, MAX_PAIN}

    expected: list[tuple[str, str, int, dict]] = []
    seen: set[tuple[str, float]] = set()
    for field, wall in WALL_FIELDS:
        block = raw.get(field)
        entries = block if isinstance(block, list) else [block]
        for index, entry in enumerate(entries):
            if entry is None or (wall, entry["strike"]) in seen:
                continue
            seen.add((wall, entry["strike"]))
            expected.append((field, wall, index, entry))

    assert len(walls) == len(expected) == 6
    for lv, (field, wall, index, block) in zip(walls, expected):
        assert (lv.source, lv.geometry) == (OI, "horizontal")
        assert (lv.symbol, lv.timeframe, lv.as_of) == (SYMBOL, TIMEFRAME, AS_OF)
        assert lv.price == block["strike"]
        assert lv.side == _side_of(block["strike"], SPOT)
        assert lv.strength is None
        assert lv.evidence == {
            "field": field,
            "wall": wall,
            "rank": index + 1,
            "index": index,
            "raw": block,
        }
        assert lv.id == level_id(OI, WALL, AS_OF, price=block["strike"],
                                 extra=field)
        assert lv.detector_version == "1"
        assert lv.schema_version == 1
        assert lv.touches is None
        assert (lv.start_as_of, lv.end_as_of) == (None, None)
    assert {(lv.evidence["wall"], lv.price) for lv in walls} == seen

    pain = raw["max_pain"]
    assert len(pains) == 1
    assert (pains[0].source, pains[0].geometry) == (OI, "horizontal")
    assert pains[0].price == pain["strike"]
    assert pains[0].side == _side_of(pain["strike"], SPOT)
    assert pains[0].strength is None
    assert pains[0].evidence == {"field": "max_pain", "raw": pain}
    assert set(pains[0].evidence) == {"field", "raw"}
    assert pains[0].schema_version == 1
    assert pains[0].touches is None
    assert (pains[0].start_as_of, pains[0].end_as_of) == (None, None)
    assert pains[0].id == level_id(OI, MAX_PAIN, AS_OF,
                                  price=pain["strike"], extra="max_pain")


def test_float_max_pain_and_equal_spot_side(monkeypatch):
    def fake_build_levels(rows, spot):
        return {
            "call_wall": None, "put_wall": None,
            "call_walls": [], "put_walls": [],
            "max_pain": 23000.0,
        }

    monkeypatch.setattr(options_levels, "build_levels", fake_build_levels)
    ctx = _ctx(spot=23000.0)
    levels = walls_detector.detect(ctx)
    assert len(levels) == 1
    assert levels[0].kind == MAX_PAIN and levels[0].source == OI
    assert levels[0].price == 23000.0 and levels[0].side == "inside"
    assert levels[0].strength is None
    assert levels[0].evidence == {"field": "max_pain", "raw": 23000.0}


def test_degraded_and_null_branches_produce_no_levels():
    degraded_rows = [{"strike": s, "ce_oi": 1_000_000, "pe_oi": 1_000_000,
                      "ce_gamma": 0, "pe_gamma": 0}
                     for s in (22900, 22950, 23000)]
    assert build_levels(degraded_rows, SPOT)["gex"]["degraded"] is True
    assert gex_detector.detect(_ctx(degraded_rows)) == ()
    assert gex_detector.detect(_ctx([])) == ()
    assert walls_detector.detect(_ctx([])) == ()

    zero_oi = [{"strike": s, "ce_oi": 0, "pe_oi": 0}
               for s in (22900, 22950, 23000)]
    assert gex_detector.detect(_ctx(zero_oi)) == ()
    assert walls_detector.detect(_ctx(zero_oi)) == ()


def test_individual_null_and_malformed_blocks_are_skipped(monkeypatch):
    def fake_build_levels(rows, spot):
        return {
            "call_wall": {"strike": None, "oi": 10},
            "put_wall": None,
            "call_walls": [{"strike": "bad", "oi": 5}, None],
            "put_walls": [],
            "max_pain": None,
            "gex": {
                "support": {"strike": 22900.0, "side": "below",
                            "strength": 0.5, "net_gex": 1.0},
                "resistance": None,
                "fuel_down": {"strike": None, "net_gex": -1.0},
                "fuel_up": None,
                "degraded": False,
            },
        }

    monkeypatch.setattr(options_levels, "build_levels", fake_build_levels)
    gex_levels = gex_detector.detect(_ctx())
    assert len(gex_levels) == 1
    assert gex_levels[0].kind == SUPPORT and gex_levels[0].price == 22900.0
    assert walls_detector.detect(_ctx()) == ()


def test_deterministic_output_and_unchanged_raw_payload():
    raw = build_levels(ROWS, SPOT)
    before = copy.deepcopy(raw)
    ctx_a = _ctx()
    ctx_b = _ctx()
    for _ in range(3):
        assert gex_detector.detect(ctx_a) == gex_detector.detect(ctx_b)
        assert walls_detector.detect(ctx_a) == walls_detector.detect(ctx_b)
    assert raw == before
    assert ctx_a == _ctx() and ctx_b == _ctx()


def test_shared_options_levels_ctx_avoids_recompute(monkeypatch):
    raw = build_levels(ROWS, SPOT)
    before = copy.deepcopy(raw)

    def forbidden(*args, **kwargs):
        raise AssertionError("build_levels called despite ctx['options_levels']")

    monkeypatch.setattr(options_levels, "build_levels", forbidden)
    ctx = _ctx()
    ctx["options_levels"] = raw
    gex_levels = gex_detector.detect(ctx)
    wall_levels = walls_detector.detect(ctx)

    assert [lv.price for lv in gex_levels] == [
        raw["gex"][field]["strike"] for field in GEX_FIELDS
    ]
    assert sum(lv.kind == WALL for lv in wall_levels) == 6
    assert [lv.price for lv in wall_levels if lv.kind == MAX_PAIN] == [
        raw["max_pain"]["strike"]
    ]
    assert raw == before


def test_build_level_book_uses_one_shared_options_block(monkeypatch):
    real_build_levels = options_levels.build_levels
    calls: list[tuple] = []

    def spy(rows, spot):
        calls.append((rows, spot))
        return real_build_levels(rows, spot)

    monkeypatch.setattr(options_levels, "build_levels", spy)

    book = build_level_book(SYMBOL, TIMEFRAME, AS_OF, option_rows=ROWS, spot=SPOT)
    assert calls == [(ROWS, SPOT)]

    raw = real_build_levels(ROWS, SPOT)
    gex_levels = [lv for lv in book.levels if lv.source == GEX]
    oi_levels = [lv for lv in book.levels if lv.source == OI]
    assert len(gex_levels) == 4
    assert {lv.price for lv in gex_levels} == {
        raw["gex"][field]["strike"] for field in GEX_FIELDS
    }
    assert sum(lv.kind == WALL for lv in oi_levels) == 3
    assert [lv.price for lv in oi_levels if lv.kind == MAX_PAIN] == [
        raw["max_pain"]["strike"]
    ]

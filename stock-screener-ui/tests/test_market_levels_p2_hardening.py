"""P2 hardening guards for the additive LevelBook contract.

Each case here fails against the pre-hardening code and passes once the
geometry, numeric-string and Mapping handling is tightened. Existing detector
math, fusion rules and golden/parity outputs are deliberately not covered here.
"""

from __future__ import annotations

from types import MappingProxyType

import pytest

from api import options_levels
from market_levels import (
    SUPPORT,
    Level,
    LevelBook,
    level_id,
)
from market_levels.detectors import gex as gex_detector
from market_levels.detectors import trendline as trendline_detector
from market_levels.detectors import walls as walls_detector

AS_OF = "2026-01-01"
SPOT = 22962.6


def _lvl(**overrides) -> Level:
    values = {
        "id": level_id("price_action", SUPPORT, AS_OF, price=100.0),
        "symbol": "NIFTY",
        "timeframe": "1D",
        "as_of": AS_OF,
        "kind": SUPPORT,
        "source": "price_action",
        "price": 100.0,
    }
    values.update(overrides)
    return Level(**values)


def _ctx(**overrides):
    ctx = {"symbol": "NIFTY", "timeframe": "1D", "as_of": AS_OF}
    ctx.update(overrides)
    return ctx


# --- geometry strictness ----------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"price": None, "bottom": 99.0, "top": 101.0},
        {
            "price": None,
            "start_price": 98.0,
            "end_price": 105.0,
            "start_as_of": "2026-01-01",
            "end_as_of": "2026-01-10",
        },
        {"bottom": 99.0, "top": 101.0},
        {
            "start_price": 98.0,
            "end_price": 105.0,
            "start_as_of": "2026-01-01",
            "end_as_of": "2026-01-10",
        },
    ],
)
def test_horizontal_geometry_rejects_zone_or_segment_fields(overrides):
    with pytest.raises(ValueError, match="horizontal geometry requires price"):
        _lvl(**overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        {"geometry": "zone", "price": 100.0, "bottom": 99.0, "top": 101.0},
        {
            "geometry": "zone",
            "price": None,
            "bottom": 99.0,
            "top": 101.0,
            "start_price": 98.0,
            "end_price": 105.0,
            "start_as_of": "2026-01-01",
            "end_as_of": "2026-01-10",
        },
    ],
)
def test_zone_geometry_rejects_price_or_segment_fields(overrides):
    with pytest.raises(ValueError, match=r"zone geometry requires bottom\+top"):
        _lvl(**overrides)


def test_valid_geometries_still_construct():
    assert _lvl().geometry == "horizontal"
    assert _lvl(
        price=None, geometry="zone", bottom=99.0, top=101.0
    ).geometry == "zone"
    assert _lvl(
        price=None,
        geometry="segment",
        start_price=98.0,
        end_price=105.0,
        start_as_of="2026-01-01",
        end_as_of="2026-01-10",
    ).geometry == "segment"


# --- numeric-string normalization ------------------------------------------


def test_horizontal_numeric_strings_are_normalized_to_float():
    level = _lvl(price="100.5", strength="0.5")
    assert isinstance(level.price, float) and level.price == 100.5
    assert isinstance(level.strength, float) and level.strength == 0.5


def test_zone_numeric_strings_are_normalized_to_float():
    level = _lvl(price=None, geometry="zone", bottom="99.25", top="101.75")
    assert isinstance(level.bottom, float) and level.bottom == 99.25
    assert isinstance(level.top, float) and level.top == 101.75


def test_segment_numeric_strings_are_normalized_to_float():
    level = _lvl(
        price=None,
        geometry="segment",
        start_price="98.5",
        end_price="105.5",
        start_as_of="2026-01-01",
        end_as_of="2026-01-10",
    )
    assert isinstance(level.start_price, float) and level.start_price == 98.5
    assert isinstance(level.end_price, float) and level.end_price == 105.5


def test_bool_numbers_are_normalized_to_float():
    level = _lvl(price=True)
    assert isinstance(level.price, float) and level.price == 1.0


def test_level_book_numeric_string_spot_is_normalized_to_float():
    book = LevelBook("NIFTY", "1D", AS_OF, spot="100.5", levels=())
    assert isinstance(book.spot, float) and book.spot == 100.5


def test_invalid_numeric_string_is_still_rejected():
    with pytest.raises(ValueError, match="finite number"):
        _lvl(price="not-a-number")


# --- non-dict Mapping widening ---------------------------------------------


def test_gex_accepts_non_dict_mapping_blocks(monkeypatch):
    block = MappingProxyType(
        {"strike": 22900.0, "side": "below", "strength": 0.5, "net_gex": 1.0}
    )
    payload = MappingProxyType({"gex": MappingProxyType({"support": block})})
    monkeypatch.setattr(options_levels, "build_levels", lambda rows, spot: payload)

    levels = gex_detector.detect(_ctx(option_rows=[], spot=SPOT))

    assert len(levels) == 1
    assert levels[0].price == 22900.0
    assert levels[0].evidence["raw"] == dict(block)


def test_walls_accept_non_dict_mapping_blocks(monkeypatch):
    wall = MappingProxyType({"strike": 23000.0, "oi": 10})
    pain = MappingProxyType({"strike": 23100.0})
    payload = MappingProxyType(
        {
            "call_wall": wall,
            "put_wall": None,
            "call_walls": [],
            "put_walls": [],
            "max_pain": pain,
        }
    )
    monkeypatch.setattr(options_levels, "build_levels", lambda rows, spot: payload)

    levels = walls_detector.detect(_ctx(option_rows=[], spot=SPOT))

    assert {lv.price for lv in levels} == {23000.0, 23100.0}
    assert all(isinstance(lv.evidence["raw"], dict) for lv in levels)


def test_trendline_params_accept_non_dict_mapping():
    params = MappingProxyType({"pivots": 5, "min_touches": 3})
    assert trendline_detector._params({"trendline_params": params}) == params

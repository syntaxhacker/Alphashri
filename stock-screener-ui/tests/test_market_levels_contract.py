"""Contract tests for the stdlib-only market_levels foundation."""

from __future__ import annotations

import ast
import dataclasses
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

import market_levels
import market_levels.service as service
from market_levels import models
from tests.helpers.market_levels_public_api import EXPECTED_PUBLIC_API
from market_levels.models import (
    FUEL,
    GEX,
    LEVEL_SCHEMA_VERSION,
    MAX_PAIN,
    OI,
    PIVOT,
    PRICE_ACTION,
    RESISTANCE,
    SESSION,
    SUPPORT,
    TRENDLINE,
    WALL,
    DetectorSpec,
    Level,
    LevelBook,
    level_id,
)

LEVEL_FIELDS = (
    "id",
    "symbol",
    "timeframe",
    "as_of",
    "kind",
    "source",
    "geometry",
    "price",
    "bottom",
    "top",
    "side",
    "strength",
    "touches",
    "start_price",
    "end_price",
    "start_as_of",
    "end_as_of",
    "evidence",
    "detector_version",
    "schema_version",
)


def _level(**overrides) -> Level:
    values = {
        "id": "lvl0000000001",
        "symbol": "NIFTY",
        "timeframe": "1D",
        "as_of": "2026-01-01",
        "kind": SUPPORT,
        "source": PRICE_ACTION,
        "price": 100.0,
    }
    values.update(overrides)
    return Level(**values)


def test_public_api_exports_exact_all_set_and_identity():
    expected = EXPECTED_PUBLIC_API
    exported = market_levels.__all__
    assert len(exported) == len(expected), "duplicate name in __all__"
    assert set(exported) == expected
    assert all(hasattr(market_levels, name) for name in exported)

    # Re-exports must be the exact objects from their defining modules.
    for name in ("register", "iter_detectors", "list_specs", "clear_registry"):
        assert callable(getattr(market_levels, name))
        assert getattr(market_levels, name) is getattr(market_levels.registry, name)
    assert callable(market_levels.level_id)
    assert market_levels.level_id is models.level_id
    assert callable(market_levels.fuse_levels)
    assert market_levels.fuse_levels is market_levels.fusion.fuse_levels
    assert callable(market_levels.build_level_book)
    assert market_levels.build_level_book is market_levels.service.build_level_book
    assert market_levels.DETECTORS is market_levels.registry.DETECTORS
    assert market_levels.SOURCE_PRECEDENCE is market_levels.fusion.SOURCE_PRECEDENCE
    assert market_levels.LEVEL_SCHEMA_VERSION == models.LEVEL_SCHEMA_VERSION
    for name in ("Level", "LevelBook", "DetectorSpec"):
        assert getattr(market_levels, name) is getattr(models, name)


def test_constants_and_field_order():
    assert LEVEL_SCHEMA_VERSION == 1
    assert (SUPPORT, RESISTANCE, PIVOT, FUEL, WALL, MAX_PAIN, TRENDLINE) == (
        "support",
        "resistance",
        "pivot",
        "fuel",
        "wall",
        "max_pain",
        "trendline",
    )
    assert (PRICE_ACTION, GEX, OI, SESSION) == (
        "price_action",
        "gex",
        "oi",
        "session",
    )
    assert PIVOT == "pivot" and TRENDLINE == "trendline"
    assert tuple(Level.__dataclass_fields__) == LEVEL_FIELDS
    assert tuple(DetectorSpec.__dataclass_fields__) == (
        "id",
        "version",
        "kind",
        "min_bars",
        "required_inputs",
        "params_schema",
    )
    assert tuple(LevelBook.__dataclass_fields__) == (
        "symbol",
        "timeframe",
        "as_of",
        "spot",
        "levels",
        "schema_version",
    )


def test_dataclasses_are_frozen_and_evidence_is_isolated():
    level = _level()
    book = LevelBook("NIFTY", "1D", "2026-01-01", 100.0, (level,))
    spec = DetectorSpec("price_action", "1", SUPPORT, 10, ("candles",), {})
    for obj in (level, book, spec):
        with pytest.raises(dataclasses.FrozenInstanceError):
            obj.id = "changed"
    assert level.geometry == "horizontal"
    assert level.schema_version == 1
    assert level.evidence == {}
    other = _level()
    other.evidence["x"] = 1
    assert level.evidence == {}


def test_level_is_hashable_by_id():
    level = _level()
    assert hash(level) == hash(level.id)
    assert {level, _level()} == {level}


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_level_book_rejects_non_finite_spot(bad):
    with pytest.raises(ValueError, match="spot must be finite"):
        LevelBook("NIFTY", "1D", "2026-01-01", bad)


def test_level_book_requires_tuple_levels_and_positive_schema():
    assert LevelBook("NIFTY", "1D", "2026-01-01", None, (), 1).spot is None
    with pytest.raises(ValueError, match="levels must be a tuple"):
        LevelBook("NIFTY", "1D", "2026-01-01", 100.0, [])
    with pytest.raises(ValueError, match="schema_version must be a positive integer"):
        LevelBook("NIFTY", "1D", "2026-01-01", 100.0, (), 0)


def test_level_id_is_stable_and_sensitive_to_identity():
    ident = level_id(PRICE_ACTION, SUPPORT, "2026-01-01", price=100.0)
    assert re.fullmatch(r"[0-9a-f]{12}", ident)
    assert ident == level_id(PRICE_ACTION, SUPPORT, "2026-01-01", price=100.0)
    assert ident != level_id(GEX, SUPPORT, "2026-01-01", price=100.0)
    assert ident != level_id(PRICE_ACTION, RESISTANCE, "2026-01-01", price=100.0)
    assert ident != level_id(PRICE_ACTION, SUPPORT, "2026-01-01", price=101.0)
    assert ident != level_id(PRICE_ACTION, SUPPORT, "2026-01-02", price=100.0)
    assert ident != level_id(
        PRICE_ACTION, SUPPORT, "2026-01-01", bottom=99.0, top=101.0
    )


def test_validation_requires_some_geometry():
    with pytest.raises(ValueError, match="price, bottom\\+top"):
        _level(price=None)


def test_segment_requires_both_endpoints_and_dates():
    valid = _level(
        geometry="segment",
        price=None,
        start_price=98.0,
        end_price=105.0,
        start_as_of="2026-01-01",
        end_as_of="2026-01-10",
    )
    assert (valid.start_price, valid.end_price) == (98.0, 105.0)
    assert (valid.start_as_of, valid.end_as_of) == ("2026-01-01", "2026-01-10")

    with pytest.raises(ValueError, match=r"segment geometry requires start_price\+end_price"):
        _level(geometry="segment")  # price only
    with pytest.raises(ValueError, match=r"price, bottom\+top, or start_price\+end_price"):
        _level(geometry="segment", price=None, start_price=98.0)
    with pytest.raises(ValueError, match=r"segment geometry requires start_price\+end_price"):
        _level(geometry="segment", price=None, bottom=98.0, top=105.0)
    with pytest.raises(ValueError, match="segment geometry requires start_as_of and end_as_of"):
        _level(geometry="segment", price=None, start_price=98.0, end_price=105.0)
    with pytest.raises(ValueError, match="start_as_of and end_as_of"):
        _level(
            geometry="segment", price=None, start_price=98.0, end_price=105.0,
            start_as_of="2026-01-01",
        )
    with pytest.raises(ValueError, match="segment geometry cannot use price or bottom/top"):
        _level(
            geometry="segment", start_price=98.0, end_price=105.0,
            start_as_of="2026-01-01", end_as_of="2026-01-10",
        )
    with pytest.raises(ValueError, match="segment geometry cannot use price or bottom/top"):
        _level(
            geometry="segment", price=None, bottom=98.0, top=105.0,
            start_price=98.0, end_price=105.0,
            start_as_of="2026-01-01", end_as_of="2026-01-10",
        )


def test_level_id_includes_segment_dates_only_when_present():
    undated = level_id(TRENDLINE, TRENDLINE, "2026-01-01", start_price=98.0, end_price=105.0)
    dated = level_id(
        TRENDLINE, TRENDLINE, "2026-01-01", start_price=98.0, end_price=105.0,
        start_as_of="2026-01-01", end_as_of="2026-01-10",
    )
    assert undated != dated
    assert dated != level_id(
        TRENDLINE, TRENDLINE, "2026-01-01", start_price=98.0, end_price=105.0,
        start_as_of="2026-02-01", end_as_of="2026-02-10",
    )
    assert level_id(PRICE_ACTION, SUPPORT, "2026-01-01", price=100.0) == "cd76cd06c416"
    assert (
        level_id(PRICE_ACTION, SUPPORT, "2026-01-01", bottom=99.0, top=101.0)
        == "fd399821cc49"
    )


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_validation_rejects_non_finite_numbers(bad):
    with pytest.raises(ValueError, match="finite"):
        _level(price=bad)
    with pytest.raises(ValueError, match="finite"):
        _level(bottom=bad, top=101.0)
    with pytest.raises(ValueError, match="finite"):
        _level(strength=bad)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"geometry": "wedge"}, "geometry must be one of"),
        ({"side": "sr"}, "side must be one of"),
        ({"bottom": 101.0, "top": 100.0}, "bottom must be <= top"),
        ({"strength": 1.5}, "between 0 and 1"),
        ({"strength": -0.1}, "between 0 and 1"),
        ({"schema_version": 0}, "schema_version must be a positive integer"),
        ({"schema_version": -1}, "schema_version must be a positive integer"),
        ({"price": "abc"}, "finite number"),
    ],
)
def test_validation_reports_clear_errors(overrides, message):
    with pytest.raises(ValueError) as exc:
        _level(**overrides)
    assert message in str(exc.value)


_WEIGHT_PROBE = """
import sys

HEAVY = ("api", "db", "trading", "pandas", "numpy", "chart_patterns")


def check(stage, allowed=()):
    heavy = sorted(
        name for name in sys.modules
        if any(name == prefix or name.startswith(prefix + ".") for prefix in HEAVY)
    )
    adapters = sorted(
        name for name in sys.modules
        if name.startswith("market_levels.detectors.") and name not in allowed
    )
    print(f"{stage}: heavy={heavy} adapters={adapters} modules={len(sys.modules)}")
    if heavy or adapters:
        raise SystemExit(1)


import market_levels
check("import market_levels")
import market_levels.detectors.gex
assert "market_levels.detectors.gex" in sys.modules
check("import market_levels.detectors.gex", ("market_levels.detectors.gex",))
"""


def test_fresh_import_is_lightweight_in_subprocess():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-c", _WEIGHT_PROBE],
        cwd=root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )
    detail = f"cwd={root}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    assert result.returncode == 0, detail
    assert "import market_levels: heavy=[] adapters=[]" in result.stdout, detail
    assert (
        "import market_levels.detectors.gex: heavy=[] adapters=[]" in result.stdout
    ), detail


def test_options_builder_import_stays_inside_a_function():
    tree = ast.parse(Path(service.__file__).read_text(encoding="utf-8"))

    def is_options_import(node):
        return (
            isinstance(node, ast.ImportFrom) and node.module == "api.options_levels"
        ) or (
            isinstance(node, ast.Import)
            and any(alias.name.startswith("api.") for alias in node.names)
        )

    assert not any(is_options_import(node) for node in tree.body)
    assert any(
        is_options_import(node)
        for fn in tree.body
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef))
        for node in ast.walk(fn)
    )


def test_models_module_is_stdlib_only():
    source = Path(models.__file__).read_text(encoding="utf-8")
    roots = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".", 1)[0])
    assert roots <= set(sys.stdlib_module_names)
    assert not roots & {"api", "db", "trading", "chart_patterns", "numpy", "pandas"}

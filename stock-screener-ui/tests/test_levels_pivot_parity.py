"""Exact parity between the shared pivot math and the LevelBook pivot adapter."""

from __future__ import annotations

import importlib
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from market_levels import PIVOT, RESISTANCE, SUPPORT, DetectorSpec, Level, level_id
from market_levels.detectors import pivot as pivot_adapter
from market_levels.registry import (
    DETECTORS,
    clear_registry,
    iter_detectors,
    list_specs,
)
from trading.pivot_utils import calculate_pivot_points

AS_OF = "2026-01-02"
BASE_CTX = {"symbol": "NIFTY", "timeframe": "1D", "as_of": AS_OF}

HLC_CASES = [
    pytest.param(
        "classic",
        {
            "high": 101.234567,
            "low": 97.891234,
            "close": 99.876543,
            "pivot_type": "classic",
        },
        id="classic",
    ),
    pytest.param(
        "fibonacci",
        {
            "high": 152.3456789,
            "low": 148.9876543,
            "close": 151.1234567,
            "pivot_type": "fibonacci",
        },
        id="fibonacci",
    ),
    pytest.param(
        "camarilla",
        {
            "high": 22456.789012,
            "low": 22310.123456,
            "close": 22398.456789,
            "pivot_type": "camarilla",
        },
        id="camarilla",
    ),
]

PIVOT_KEYS = ("pp", "r1", "r2", "r3", "s1", "s2", "s3", "r4", "s4")
KINDS = {
    "pp": PIVOT,
    "r1": RESISTANCE,
    "r2": RESISTANCE,
    "r3": RESISTANCE,
    "r4": RESISTANCE,
    "s1": SUPPORT,
    "s2": SUPPORT,
    "s3": SUPPORT,
    "s4": SUPPORT,
}


def _points(hlc):
    return calculate_pivot_points(
        hlc["high"], hlc["low"], hlc["close"], hlc.get("pivot_type", "classic")
    )


def _levels(hlc):
    return pivot_adapter.detect({**BASE_CTX, "pivot_hlc": hlc})


@pytest.mark.parametrize(("label", "hlc"), HLC_CASES)
def test_levels_match_helper_key_by_key(label, hlc):
    points = _points(hlc)
    levels = _levels(hlc)
    expected_keys = [key for key in PIVOT_KEYS if getattr(points, key) is not None]
    by_key = {level.evidence["pivot_key"]: level for level in levels}

    assert len(levels) == len(expected_keys)
    assert len(by_key) == len(levels)
    assert set(by_key) == set(expected_keys)
    if label == "camarilla":
        assert {"r4", "s4"} <= set(by_key)
    else:
        assert not ({"r4", "s4"} & set(by_key))

    for key in expected_keys:
        level = by_key[key]
        value = getattr(points, key)
        assert isinstance(level, Level)
        assert level.price == value
        assert level.kind == KINDS[key]
        assert level.source == PIVOT
        assert level.geometry == "horizontal"
        assert level.id == level_id(PIVOT, KINDS[key], AS_OF, price=value, extra=key)
        assert level.evidence == {"pivot_key": key}
        assert (level.symbol, level.timeframe, level.as_of) == (
            BASE_CTX["symbol"],
            BASE_CTX["timeframe"],
            BASE_CTX["as_of"],
        )
        assert level.side is None
        assert level.strength is None
        assert level.touches is None
        assert level.detector_version == pivot_adapter.SPEC.version


@pytest.mark.parametrize(("label", "hlc"), HLC_CASES)
def test_repeated_detect_is_identical(label, hlc):
    def shape(levels):
        return [
            (level.id, level.kind, level.price, dict(level.evidence)) for level in levels
        ]

    assert shape(_levels(hlc)) == shape(_levels(hlc))


@pytest.mark.parametrize(("label", "hlc"), HLC_CASES)
def test_values_are_not_rounded_or_formatted(label, hlc):
    points = _points(hlc)
    levels = _levels(hlc)
    for level in levels:
        value = getattr(points, level.evidence["pivot_key"])
        assert isinstance(level.price, float)
        assert level.price == value
        assert level.price != round(level.price, 2)
    assert len(levels) > 0


def test_missing_hlc_raises_instead_of_returning_silent_levels():
    with pytest.raises(KeyError, match="pivot_hlc"):
        pivot_adapter.detect(dict(BASE_CTX))
    with pytest.raises(KeyError, match="close"):
        pivot_adapter.detect(
            {**BASE_CTX, "pivot_hlc": {"high": 100.0, "low": 80.0}}
        )


def test_invalid_hlc_raises_the_same_error_as_the_helper():
    hlc = {"high": "not-a-number", "low": 80.0, "close": 90.0}
    with pytest.raises(TypeError) as helper_error:
        _points(hlc)
    with pytest.raises(TypeError) as adapter_error:
        _levels(hlc)
    assert str(adapter_error.value) == str(helper_error.value)


def test_non_finite_hlc_is_rejected_clearly():
    hlc = {"high": float("nan"), "low": 80.0, "close": 90.0}
    assert math.isnan(_points(hlc).pp)
    with pytest.raises(ValueError, match="price must be finite"):
        _levels(hlc)


def test_spec_registers_at_import():
    previous = list(DETECTORS)
    try:
        clear_registry()
        importlib.reload(pivot_adapter)
        assert pivot_adapter.SPEC == DetectorSpec(
            id="pivot",
            version="1",
            kind="pivot",
            min_bars=0,
            required_inputs=("pivot_hlc",),
            params_schema={"pivot_type": "classic|fibonacci|camarilla"},
        )
        assert list_specs() == [pivot_adapter.SPEC]
        assert [fn for _, fn in iter_detectors()] == [pivot_adapter.detect]
    finally:
        DETECTORS[:] = previous

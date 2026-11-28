"""Deterministic coverage for the trendline segment detector.

The fixtures use a fixed sinusoidal phase instead of randomness: the same
rising/falling/flat frames are produced on every run, with no clock or I/O.
"""

from __future__ import annotations

import copy
import math
import re
from datetime import date, timedelta

import pytest

from market_levels import (
    RESISTANCE,
    SUPPORT,
    TRENDLINE,
    build_level_book,
    level_id,
    list_specs,
)
from market_levels.detectors import trendline
from market_levels.registry import DETECTORS, clear_registry, register

SYMBOL = "NIFTY"
TIMEFRAME = "1D"
AS_OF = "2026-05-01"
BARS = 120
PHASE = 0.7
PERIOD = 8


def _candles(*, n: int = BARS, trend: float = 0.5, base: float = 100.0) -> list[dict]:
    start = date(2026, 1, 1)
    rows: list[dict] = []
    for index in range(n):
        close = base + trend * index + 3.0 * math.sin(
            (index + PHASE) * 2.0 * math.pi / PERIOD
        )
        rows.append(
            {
                "t": (start + timedelta(days=index)).isoformat(),
                "o": close,
                "h": close + 0.6,
                "l": close - 0.6,
                "c": close,
                "v": 1000.0,
            }
        )
    return rows


def _ctx(
    candles: list[dict] | None = None, **params
) -> dict:
    return {
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "as_of": AS_OF,
        "candles": _candles() if candles is None else candles,
        "trendline_params": params,
    }


@pytest.fixture(autouse=True)
def _registered_detector():
    saved = list(DETECTORS)
    clear_registry()
    register(trendline.SPEC, trendline.detect)
    try:
        yield
    finally:
        DETECTORS[:] = saved


def _assert_segment(level, expected_kind: str) -> None:
    assert level.geometry == "segment"
    assert (level.kind, level.source) == (expected_kind, TRENDLINE)
    assert re.fullmatch(r"[0-9a-f]{12}", level.id)
    assert level.price is None and level.bottom is None and level.top is None
    assert level.start_price is not None and level.end_price is not None
    assert level.start_as_of and level.end_as_of
    assert level.start_as_of <= level.end_as_of
    assert level.touches >= 3
    assert level.strength is not None and 0.0 < level.strength <= 1.0
    assert level.detector_version == "1"
    assert {"fit_points", "touch_points", "touches", "slope", "intercept",
            "r2", "relative_slope", "atr", "tol_atr", "tol_price",
            "pivots_used", "window_start"} <= set(level.evidence)


def test_spec_is_registered_with_candles_as_its_only_required_input():
    specs = [spec for spec in list_specs() if spec.id == "trendline"]
    assert specs == [trendline.SPEC]
    assert (specs[0].version, specs[0].kind) == ("1", TRENDLINE)
    assert specs[0].required_inputs == ("candles",)


def test_rising_fixture_emits_rising_support_and_resistance_segments():
    levels = trendline.detect(_ctx(_candles(trend=0.5, base=100.0)))

    assert [level.kind for level in levels] == [SUPPORT, RESISTANCE]
    for level in levels:
        _assert_segment(level, SUPPORT if level is levels[0] else RESISTANCE)
        assert level.end_price > level.start_price


def test_falling_fixture_emits_falling_support_and_resistance_segments():
    levels = trendline.detect(_ctx(_candles(trend=-0.5, base=200.0)))

    assert [level.kind for level in levels] == [SUPPORT, RESISTANCE]
    for level in levels:
        _assert_segment(level, SUPPORT if level is levels[0] else RESISTANCE)
        assert level.end_price < level.start_price


def test_flat_fixture_is_rejected_as_an_invalid_fit():
    assert trendline.detect(_ctx(_candles(trend=0.0))) == []


@pytest.mark.parametrize("bars", [0, 1, 12, 29])
def test_short_frame_emits_nothing(bars):
    assert trendline.detect(_ctx(_candles(n=bars))) == []


def test_ids_are_stable_and_reconstructed_from_both_endpoints():
    ctx = _ctx()
    first = trendline.detect(ctx)
    second = trendline.detect(ctx)

    assert first == second
    assert [level.id for level in first] == [level.id for level in second]
    for level in first:
        expected = level_id(
            TRENDLINE,
            level.kind,
            AS_OF,
            start_price=level.start_price,
            end_price=level.end_price,
            start_as_of=level.start_as_of,
            end_as_of=level.end_as_of,
            extra=level.evidence["pivot_side"],
        )
        assert level.id == expected


@pytest.mark.parametrize("pivots", [3, 5])
def test_recent_pivot_count_is_configurable(pivots):
    levels = trendline.detect(_ctx(pivots=pivots))
    assert len(levels) == 2
    assert all(level.evidence["pivots_used"] == pivots for level in levels)
    assert all(len(level.evidence["fit_points"]) == pivots for level in levels)


def test_detect_is_pure_and_book_contains_segments_without_consumer_changes():
    candles = _candles()
    ctx = _ctx(candles)
    before = copy.deepcopy(ctx)

    assert trendline.detect(ctx) == trendline.detect(ctx)
    assert ctx == before

    book = build_level_book(SYMBOL, TIMEFRAME, AS_OF, candles=candles)
    segments = [level for level in book.levels if level.source == TRENDLINE]
    assert len(segments) == 2
    assert all(level.geometry == "segment" for level in segments)
    assert candles == before["candles"]

"""Prototype of a future trendline detector plugged into the public LevelBook.

Nothing in ``market_levels`` or any consumer is edited: the fake detector is
registered through the public API and the real price-action adapter is loaded
lazily by ``build_level_book``. The segment must travel through fusion intact.
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date, timedelta

import pytest

from market_levels import (
    DETECTORS,
    PRICE_ACTION,
    TRENDLINE,
    DetectorSpec,
    Level,
    LevelBook,
    build_level_book,
    clear_registry,
    fuse_levels,
    level_id,
    list_specs,
    register,
)

SYMBOL = "NIFTY"
TIMEFRAME = "1D"
AS_OF = "2026-01-01"
SPOT = 100.0
START_PRICE = 98.0
END_PRICE = 105.0
START_AS_OF = "2026-01-01"
END_AS_OF = "2026-01-10"

TRENDLINE_SPEC = DetectorSpec(
    id="trendline",
    version="1",
    kind="trendline",
    min_bars=0,
    required_inputs=("candles",),
    params_schema={},
)

TRENDLINE_ID = level_id(
    TRENDLINE,
    TRENDLINE,
    AS_OF,
    start_price=START_PRICE,
    end_price=END_PRICE,
)

_SR_UNIT = (110, 110, 100, 105, 120, 110, 100, 105, 120, 110, 110, 110)


def _candles(n: int = 400) -> list[dict]:
    closes = [
        100.0 + (value - 110.0)
        for value in (_SR_UNIT * (n // len(_SR_UNIT) + 1))[:n]
    ]
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
        for i, close in enumerate(closes)
    ]


def _ctx() -> dict:
    return {
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "as_of": AS_OF,
        "candles": _candles(),
    }


def _build() -> LevelBook:
    return build_level_book(SYMBOL, TIMEFRAME, AS_OF, candles=_candles(), spot=SPOT)


def detect(ctx) -> list[Level]:
    """Pure fake detector: one rising segment, no inputs beyond candles."""
    return [
        Level(
            id=TRENDLINE_ID,
            symbol=ctx["symbol"],
            timeframe=ctx["timeframe"],
            as_of=ctx["as_of"],
            kind=TRENDLINE,
            source=TRENDLINE,
            geometry="segment",
            start_price=START_PRICE,
            end_price=END_PRICE,
            start_as_of=START_AS_OF,
            end_as_of=END_AS_OF,
            evidence={
                "description": "rising segment 98.0 -> 105.0 from 2026-01-01 to 2026-01-10"
            },
            detector_version=TRENDLINE_SPEC.version,
        )
    ]


def _segment(**overrides) -> Level:
    values = {
        "id": TRENDLINE_ID,
        "symbol": SYMBOL,
        "timeframe": TIMEFRAME,
        "as_of": AS_OF,
        "kind": TRENDLINE,
        "source": TRENDLINE,
        "geometry": "segment",
        "start_price": START_PRICE,
        "end_price": END_PRICE,
        "start_as_of": START_AS_OF,
        "end_as_of": END_AS_OF,
    }
    values.update(overrides)
    return Level(**values)


def _windowed_segment(start_as_of: str, end_as_of: str) -> Level:
    # A date-aware detector seeds extra with its window, so segments with the
    # same two prices but different windows never share an id.
    ident = level_id(
        TRENDLINE,
        TRENDLINE,
        AS_OF,
        start_price=START_PRICE,
        end_price=END_PRICE,
        extra=f"{start_as_of}|{end_as_of}",
    )
    return _segment(id=ident, start_as_of=start_as_of, end_as_of=end_as_of)


@pytest.fixture(autouse=True)
def _isolated_registry():
    saved = list(DETECTORS)
    clear_registry()
    try:
        yield
    finally:
        DETECTORS[:] = saved


@pytest.fixture
def book(_isolated_registry):
    register(TRENDLINE_SPEC, detect)
    return _build()


def test_book_contains_segment_and_real_price_action_zones(book):
    segments = [lv for lv in book.levels if lv.geometry == "segment"]
    zones = [lv for lv in book.levels if lv.source == PRICE_ACTION]
    assert len(segments) == 1
    assert len(zones) >= 1
    segment = segments[0]
    assert (segment.id, segment.kind, segment.source) == (
        TRENDLINE_ID,
        TRENDLINE,
        TRENDLINE,
    )
    assert all(lv.geometry == "zone" for lv in zones)
    assert [lv.source for lv in book.levels].index(PRICE_ACTION) < [
        lv.source for lv in book.levels
    ].index(TRENDLINE)


def test_fusion_preserves_segment_fields_and_only_fills_side(book):
    raw = detect(_ctx())[0]
    fused = next(lv for lv in book.levels if lv.id == raw.id)
    assert raw.side is None
    assert fused == replace(raw, side="inside")
    assert (fused.start_price, fused.end_price) == (START_PRICE, END_PRICE)
    assert (fused.start_as_of, fused.end_as_of) == (START_AS_OF, END_AS_OF)
    assert fused.price is None and fused.bottom is None and fused.top is None
    assert fused.evidence["description"] and fused.detector_version == "1"
    assert fused.schema_version == 1


def test_segment_is_valid_input_and_does_not_change_zone_levels(_isolated_registry):
    candles = _candles()
    zones_only = build_level_book(SYMBOL, TIMEFRAME, AS_OF, candles=candles, spot=SPOT)
    register(TRENDLINE_SPEC, detect)
    with_segment = build_level_book(
        SYMBOL, TIMEFRAME, AS_OF, candles=candles, spot=SPOT
    )

    before = tuple(lv for lv in zones_only.levels if lv.source == PRICE_ACTION)
    after = tuple(lv for lv in with_segment.levels if lv.source == PRICE_ACTION)
    assert before and before == after
    assert len(with_segment.levels) == len(zones_only.levels) + 1
    assert candles == _candles(), "build must not mutate the shared candle payload"


def test_two_builds_are_deterministic(book):
    rebuilt = _build()
    assert book == rebuilt
    assert [lv.id for lv in book.levels] == [lv.id for lv in rebuilt.levels]


def test_future_detector_needs_no_source_or_consumer_change(book):
    # All wiring happens through ``market_levels`` public names: the fake spec
    # object itself is the only trendline registration in the registry.
    assert [spec for spec in list_specs() if spec.id == TRENDLINE] == [TRENDLINE_SPEC]
    assert [spec for spec in list_specs() if spec.id == TRENDLINE][0] is TRENDLINE_SPEC
    assert {spec.id for spec in list_specs()} >= {"price_action", "trendline"}
    assert isinstance(book, LevelBook)
    assert (book.symbol, book.timeframe, book.as_of, book.spot) == (
        SYMBOL,
        TIMEFRAME,
        AS_OF,
        SPOT,
    )
    assert book.schema_version == 1
    assert all(isinstance(lv, Level) and lv.schema_version == 1 for lv in book.levels)


@pytest.mark.parametrize("missing", ["start_price", "end_price", "both"])
def test_segment_missing_an_endpoint_is_rejected_with_value_error(missing):
    overrides = {}
    if missing in ("start_price", "both"):
        overrides["start_price"] = None
    if missing in ("end_price", "both"):
        overrides["end_price"] = None
    with pytest.raises(ValueError, match=r"segment|start_price|end_price"):
        _segment(**overrides)


@pytest.mark.parametrize("field", ["start_price", "end_price"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_segment_non_finite_endpoint_is_rejected_with_value_error(field, bad):
    with pytest.raises(ValueError, match=f"{field} must be finite"):
        _segment(**{field: bad})


def test_segment_non_numeric_endpoint_is_rejected_with_value_error():
    with pytest.raises(ValueError, match="start_price must be a finite number"):
        _segment(start_price="not-a-price")


def test_segment_id_is_stable_and_distinct_from_horizontal_at_same_price():
    assert re.fullmatch(r"[0-9a-f]{12}", TRENDLINE_ID)
    assert TRENDLINE_ID == level_id(
        TRENDLINE,
        TRENDLINE,
        AS_OF,
        start_price=START_PRICE,
        end_price=END_PRICE,
    )
    horizontal_id = level_id(TRENDLINE, TRENDLINE, AS_OF, price=START_PRICE)
    assert TRENDLINE_ID != horizontal_id

    segment = _segment()
    horizontal = Level(
        id=horizontal_id,
        symbol=SYMBOL,
        timeframe=TIMEFRAME,
        as_of=AS_OF,
        kind=TRENDLINE,
        source=TRENDLINE,
        geometry="horizontal",
        price=START_PRICE,
    )
    assert horizontal.price == segment.start_price
    assert {lv.id for lv in fuse_levels([segment, horizontal], spot=SPOT)} == {
        TRENDLINE_ID,
        horizontal_id,
    }


def test_segment_with_price_only_and_no_endpoints_is_rejected():
    with pytest.raises(ValueError):
        _segment(price=100.0, start_price=None, end_price=None)


@pytest.mark.parametrize("missing", ["start_price", "end_price"])
@pytest.mark.parametrize("with_price", [False, True])
def test_segment_with_one_endpoint_missing_is_rejected(missing, with_price):
    overrides = {missing: None}
    if with_price:
        overrides["price"] = 100.0
    with pytest.raises(ValueError):
        _segment(**overrides)


def test_valid_segment_with_both_endpoints_and_dates_is_accepted():
    level = _segment()
    assert level.geometry == "segment"
    assert (level.start_price, level.end_price) == (START_PRICE, END_PRICE)
    assert (level.start_as_of, level.end_as_of) == (START_AS_OF, END_AS_OF)


def test_same_endpoints_different_windows_keep_distinct_ids_and_both_survive_fusion():
    january = _windowed_segment("2026-01-01", "2026-01-10")
    february = _windowed_segment("2026-02-01", "2026-02-10")
    assert january.id != february.id
    fused = fuse_levels([january, february], spot=SPOT)
    assert {lv.id for lv in fused} == {january.id, february.id}
    assert {(lv.start_as_of, lv.end_as_of) for lv in fused} == {
        ("2026-01-01", "2026-01-10"),
        ("2026-02-01", "2026-02-10"),
    }

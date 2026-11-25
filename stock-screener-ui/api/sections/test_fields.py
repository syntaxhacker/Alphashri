"""Hand-built-row tests for the section field map and predicate evaluator.

No scanner, DB or clock is used: every row is a plain dict, so these tests fail
loudly if a predicate starts depending on network state or hidden globals.
"""

from __future__ import annotations

import pytest
from tradingview_screener import col

from api.sections.fields import (
    AUTO_FIELDS,
    CONCEPT_REFERENCE,
    SECTION_FIELDS,
    fields_for_sections,
)
from api.sections.predicates import OP_MAP, evaluate


def make_row(symbol: str, **overrides) -> dict:
    row = {
        "ticker": symbol,
        "name": symbol,
        "update_mode": "streaming",
        "close": 100.0,
        "VWAP": 100.0,
        "change": 1.0,
        "change|5": 0.5,
        "relative_volume_10d_calc": 1.2,
        "volume_change|5": 0.3,
        "price_52_week_high": 110.0,
        "type": "stock",
        "exchange": "NSE",
    }
    row.update(overrides)
    return row


def section(**overrides) -> dict:
    definition = {"id": "test", "conditions": [], "render": {"type": "table", "columns": []}}
    definition.update(overrides)
    return definition


# --------------------------------------------------------------------------- #
# Field map
# --------------------------------------------------------------------------- #


def test_section_fields_is_the_verified_whitelist():
    assert SECTION_FIELDS == frozenset(
        {
            "close", "open", "high", "low", "VWAP", "change", "change_abs",
            "change|1", "change|5", "change|15", "change|30", "change|60",
            "volume", "volume_change|5", "volume_change|15",
            "relative_volume_10d_calc", "average_volume_10d_calc",
            "price_52_week_high", "price_52_week_low", "EMA20", "EMA50",
            "market_cap_basic", "Volatility.D", "Volatility.W", "Perf.W",
            "type", "exchange", "update_mode",
        }
    )
    assert AUTO_FIELDS == frozenset({"ticker", "name"})
    assert set(CONCEPT_REFERENCE.values()) <= SECTION_FIELDS
    for unavailable in ("change_1m", "change_5m", "Perf.1D", "relative_volume_5d_calc", "PriceToVWAP"):
        assert unavailable not in SECTION_FIELDS


def test_null_value_resolves_to_the_concept_reference():
    definition = {
        "id": "vwap",
        "concept": "vwap_above",
        "conditions": [{"metric": "close", "op": "gt", "value": None}],
    }
    assert "VWAP" in fields_for_sections([definition])
    rows = [
        make_row("UP", close=101, VWAP=100),
        make_row("DOWN", close=99, VWAP=100),
    ]
    assert evaluate(rows, [definition]) == {"vwap": ["UP"]}


def test_op_map_matches_library_column_operations():
    expressions = {
        "gt": col("close") > 1,
        "gte": col("close") >= 1,
        "lt": col("close") < 1,
        "lte": col("close") <= 1,
        "eq": col("type") == "stock",
        "crosses_above": col("close").crosses_above("VWAP"),
        "crosses_below": col("close").crosses_below("VWAP"),
    }
    assert set(OP_MAP) == set(expressions)
    for op, expression in expressions.items():
        assert OP_MAP[op] == expression["operation"]


def test_fields_for_sections_is_a_stable_deduplicated_union():
    defs = [
        section(
            id="vwap",
            conditions=[
                {"metric": "close", "op": "crosses_above", "value": "VWAP"},
                {"metric": "relative_volume_10d_calc", "op": "gte", "value": 1.5},
            ],
            render={"type": "table", "columns": ["close", "change", "VWAP", "unknown_field"]},
        ),
        section(
            id="momentum",
            conditions=[{"metric": "change|5", "op": "gt", "value": 0.5}],
            render={"type": "cards", "columns": ["change|5", "change_1m"]},
        ),
    ]
    assert fields_for_sections(defs) == [
        "ticker", "name", "close", "VWAP", "relative_volume_10d_calc",
        "change", "change|5", "update_mode", "type", "exchange",
    ]
    assert fields_for_sections(list(reversed(defs))) != fields_for_sections(defs)


def test_fields_for_sections_includes_field_value_operands():
    defs = [section(conditions=[{"metric": "close", "op": "crosses_above", "value": "VWAP"}])]
    fields = fields_for_sections(defs)
    assert "close" in fields and "VWAP" in fields
    assert fields[-3:] == ["update_mode", "type", "exchange"]


def test_fields_for_sections_drops_unavailable_fields():
    defs = [
        section(
            conditions=[
                {"metric": "change_1m", "op": "gt", "value": 1},
                {"metric": "Perf.1D", "op": "gt", "value": 1},
            ],
            render={"columns": ["relative_volume_5d_calc", "PriceToVWAP", "close"]},
        )
    ]
    assert fields_for_sections(defs) == [
        "ticker", "name", "close", "update_mode", "type", "exchange",
    ]


# --------------------------------------------------------------------------- #
# Predicates
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("op", "threshold", "expected"),
    [
        ("gt", 1.0, ["A"]),
        ("gte", 1.0, ["A", "B"]),
        ("lt", 1.0, ["C"]),
        ("lte", 1.0, ["B", "C"]),
        ("eq", 1.0, ["B"]),
    ],
)
def test_comparison_ops(op, threshold, expected):
    rows = [
        make_row("A", change=2.0),
        make_row("B", change=1.0),
        make_row("C", change=-1.0),
    ]
    defs = [section(conditions=[{"metric": "change", "op": op, "value": threshold}])]
    assert evaluate(rows, defs)["test"] == expected


def test_eq_works_on_text_fields():
    rows = [
        make_row("A", type="stock"),
        make_row("B", type="fund"),
        make_row("C", type="stock"),
    ]
    defs = [section(conditions=[{"metric": "type", "op": "eq", "value": "stock"}])]
    assert evaluate(rows, defs)["test"] == ["A", "C"]


def test_crosses_above_requires_previous_snapshot():
    rows = [
        make_row("UP", close=101, VWAP=100, _prev={"close": 99, "VWAP": 100}),
        make_row("DOWN", close=99, VWAP=100, _prev={"close": 101, "VWAP": 100}),
        make_row("NOPREV", close=101, VWAP=100),
        make_row("EMPTY", close=101, VWAP=100, _prev={}),
    ]
    defs = [section(conditions=[{"metric": "close", "op": "crosses_above", "value": "VWAP"}])]
    assert evaluate(rows, defs)["test"] == ["UP"]


def test_crosses_below_requires_previous_snapshot():
    rows = [
        make_row("UP", close=101, VWAP=100, _prev={"close": 99, "VWAP": 100}),
        make_row("DOWN", close=99, VWAP=100, _prev={"close": 101, "VWAP": 100}),
        make_row("NOPREV", close=99, VWAP=100),
    ]
    defs = [section(conditions=[{"metric": "close", "op": "crosses_below", "value": "VWAP"}])]
    assert evaluate(rows, defs)["test"] == ["DOWN"]


def test_crosses_against_numeric_threshold():
    rows = [
        make_row("UP", **{"change|5": 1.5}, _prev={"change|5": 0.5}),
        make_row("DOWN", **{"change|5": -1.5}, _prev={"change|5": 0.5}),
        make_row("NOPREV", **{"change|5": 1.5}),
    ]
    above = section(conditions=[{"metric": "change|5", "op": "crosses_above", "value": 1.0}])
    below = section(id="below", conditions=[{"metric": "change|5", "op": "crosses_below", "value": -1.0}])
    result = evaluate(rows, [above, below])
    assert result["test"] == ["UP"]
    assert result["below"] == ["DOWN"]


def test_conditions_combine_with_and_by_default_and_or_when_requested():
    rows = [
        make_row("BOTH", change=2.0, relative_volume_10d_calc=2.0),
        make_row("ONE", change=2.0, relative_volume_10d_calc=1.0),
        make_row("NONE", change=0.0, relative_volume_10d_calc=2.0),
    ]
    conditions = [
        {"metric": "change", "op": "gt", "value": 1.0},
        {"metric": "relative_volume_10d_calc", "op": "gte", "value": 1.5},
    ]
    result = evaluate(rows, [section(conditions=conditions), section(id="any", logic="or", conditions=conditions)])
    assert result["test"] == ["BOTH"]
    assert result["any"] == ["BOTH", "ONE", "NONE"]


def test_live_sections_skip_delayed_rows_but_allow_delayed_opt_in():
    rows = [
        make_row("LIVE"),
        make_row("LATE", update_mode="delayed_streaming_600"),
        make_row("MARKED", update_mode="delayed_streaming_900", _delayed=True),
    ]
    result = evaluate(rows, [section(), section(id="late", allow_delayed=True)])
    assert result["test"] == ["LIVE"]
    assert result["late"] == ["LIVE", "LATE", "MARKED"]


def test_unavailable_metric_or_unknown_op_matches_nothing():
    rows = [make_row("A")]
    defs = [
        section(id="bad_field", conditions=[{"metric": "change_1m", "op": "gt", "value": 1}]),
        section(id="bad_op", conditions=[{"metric": "change", "op": "like", "value": 1}]),
    ]
    assert evaluate(rows, defs) == {"bad_field": [], "bad_op": []}


def test_result_is_deduplicated_in_row_order_and_covers_every_section():
    rows = [make_row("A", change=2.0), make_row("A", change=2.0), make_row("B", change=0.0)]
    defs = [section(conditions=[{"metric": "change", "op": "gt", "value": 1.0}]), section(id="all")]
    result = evaluate(rows, defs)
    assert result == {"test": ["A"], "all": ["A", "B"]}

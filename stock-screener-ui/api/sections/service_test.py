"""Service-level tests: one frame per market/window, delayed guard, envelopes.

Predicate internals belong to ``api.sections.fields`` / ``.predicates`` and are
stubbed here with deterministic, documented semantics so these tests exercise
the adapter's wiring rather than a second copy of the evaluator.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types

import pandas as pd
import pytest

if importlib.util.find_spec("api.sections.fields") is None:
    # The fields lane is a separate work stream; keep this module importable
    # until it lands. Real tests below replace all three names explicitly.
    sys.modules.setdefault(
        "api.sections.fields",
        types.ModuleType("api.sections.fields"),
    )
    sys.modules["api.sections.fields"].SECTION_FIELDS = {}
    sys.modules["api.sections.fields"].fields_for_sections = lambda defs: []

service = importlib.import_module("api.sections.service")

METRIC_FIELDS = {
    "close": "close",
    "vwap": "VWAP",
    "rvol": "relative_volume_10d_calc",
    "change_5m": "change|5",
}


def _fields_for_sections(defs):
    fields = []
    for definition in defs:
        for condition in definition.get("conditions", []):
            for key in ("metric", "value"):
                field = METRIC_FIELDS.get(str(condition.get(key, "")).lower())
                if field and field not in fields:
                    fields.append(field)
    return fields


def _matches(row, condition):
    field = METRIC_FIELDS.get(str(condition.get("metric", "")).lower())
    value = row.get(field) if field else None
    if field is None or value is None:
        return False
    op = condition.get("op")
    if op == "gte":
        return value >= condition["value"]
    if op == "crosses_above":
        right_field = METRIC_FIELDS.get(str(condition.get("value", "")).lower())
        before = (row.get("_prev") or {}).get(field)
        right_before = (row.get("_prev") or {}).get(right_field)
        if right_field is None or before is None or right_before is None:
            return False
        return before <= right_before and value > row.get(right_field)
    return False


def _evaluate(rows, defs):
    """Fake evaluator: section id -> matching symbols, with per-row _prev."""
    result = {}
    for definition in defs:
        section_id = str(definition.get("id"))
        matched = result.setdefault(section_id, [])
        for row in rows:
            if row.get("update_mode") != "streaming" and not definition.get("allow_delayed"):
                continue
            conditions = definition.get("conditions", [])
            if conditions and all(_matches(row, condition) for condition in conditions):
                matched.append(str(row.get("ticker")))
    return result


def _frame(*rows):
    return pd.DataFrame(list(rows))


@pytest.fixture
def adapter(monkeypatch):
    monkeypatch.setattr(service, "fields_for_sections", _fields_for_sections)
    monkeypatch.setattr(service, "evaluate", _evaluate)
    service.clear_cache()
    yield service
    service.clear_cache()


def _momentum(section_id="m1", value=1.5):
    return {
        "id": section_id,
        "conditions": [{"metric": "rvol", "op": "gte", "value": value}],
    }


def _vwap_cross(section_id="v1"):
    return {
        "id": section_id,
        "conditions": [{"metric": "close", "op": "crosses_above", "value": "VWAP"}],
    }


def test_one_fetch_per_window_for_two_section_sets(adapter):
    calls = []

    def fetcher(market, fields):
        calls.append((market, tuple(fields)))
        return _frame(
            {"ticker": "A", "name": "Alpha", "close": 101.0, "VWAP": 100.0,
             "relative_volume_10d_calc": 2.0, "update_mode": "streaming"},
            {"ticker": "B", "name": "Beta", "close": 50.0, "VWAP": 51.0,
             "relative_volume_10d_calc": 0.8, "update_mode": "streaming"},
        )

    first = adapter.scan_sections("india", [_momentum("m1", 1.5)], fetcher=fetcher)
    second = adapter.scan_sections("india", [_momentum("m2", 3.0)], fetcher=fetcher)

    assert len(calls) == 1
    assert calls[0][0] == "india"
    assert "relative_volume_10d_calc" in calls[0][1]
    assert "update_mode" in calls[0][1]
    # Same raw frame, but each request evaluates its own predicate.
    assert first["rows"][0]["signals"] == {"m1": True}
    assert second["rows"][0]["signals"] == {"m2": False}
    assert first["row_count"] == second["row_count"] == 2


def test_ttl_expiry_refetches(adapter, monkeypatch):
    clock = {"now": 100.0}
    monkeypatch.setattr(adapter, "_monotonic", lambda: clock["now"])
    calls = []

    def fetcher(market, fields):
        calls.append(clock["now"])
        return _frame({"ticker": "A", "name": "Alpha", "update_mode": "streaming"})

    adapter.scan_sections("usa", [_momentum()], fetcher=fetcher)
    clock["now"] += 30
    adapter.scan_sections("usa", [_momentum()], fetcher=fetcher)
    assert len(calls) == 1

    clock["now"] += 31
    adapter.scan_sections("usa", [_momentum()], fetcher=fetcher)
    assert len(calls) == 2


def test_different_field_union_refetches(adapter):
    calls = []

    def fetcher(market, fields):
        calls.append(tuple(fields))
        return _frame({"ticker": "A", "name": "Alpha", "update_mode": "streaming"})

    adapter.scan_sections("india", [_momentum()], fetcher=fetcher)
    adapter.scan_sections("india", [
        {"id": "c1", "conditions": [{"metric": "change_5m", "op": "gte", "value": 1}]},
    ], fetcher=fetcher)

    assert len(calls) == 2
    assert "change|5" in calls[1]
    assert "relative_volume_10d_calc" not in calls[1]


def test_delayed_rows_excluded_by_default(adapter):
    frame = _frame(
        {"ticker": "LIVE", "name": "Live", "relative_volume_10d_calc": 2.0,
         "update_mode": "streaming"},
        {"ticker": "DELAY", "name": "Delayed", "relative_volume_10d_calc": 2.0,
         "update_mode": "delayed_streaming_900"},
        {"ticker": "NO MODE", "name": "Unknown", "relative_volume_10d_calc": 2.0},
    )
    result = adapter.scan_sections("india", [_momentum()], fetcher=lambda m, f: frame)

    assert [row["symbol"] for row in result["rows"]] == ["LIVE"]
    assert result["row_count"] == 1
    assert result["delayed_rows"] == 2
    assert "Excluded 2 delayed" in result["note"]


def test_delayed_rows_included_when_allowed(adapter):
    frame = _frame(
        {"ticker": "LIVE", "name": "Live", "relative_volume_10d_calc": 2.0,
         "update_mode": "streaming"},
        {"ticker": "DELAY", "name": "Delayed", "relative_volume_10d_calc": 2.0,
         "update_mode": "delayed_streaming_900"},
    )
    result = adapter.scan_sections(
        "india", [_momentum()], allow_delayed=True, fetcher=lambda m, f: frame
    )

    assert [row["symbol"] for row in result["rows"]] == ["LIVE", "DELAY"]
    assert result["row_count"] == 2
    assert result["delayed_rows"] == 1
    assert "Including 1 delayed" in result["note"]
    # The service opt-in also makes delayed rows eligible for predicates.
    assert result["rows"][1]["signals"] == {"m1": True}


def test_empty_defs_never_fetches(adapter):
    def fetcher(market, fields):
        raise AssertionError("empty defs must not fetch")

    result = adapter.scan_sections("india", [], fetcher=fetcher)

    assert result["rows"] == []
    assert result["row_count"] == 0
    assert result["delayed_rows"] == 0
    assert result["note"] is None
    assert result["market"] == "india"
    assert result["generated_at"]


def test_unknown_metric_ignored(adapter):
    calls = []
    defs = [
        _momentum("known"),
        {"id": "unknown", "conditions": [{"metric": "not_a_field", "op": "gte", "value": 1}]},
    ]

    def fetcher(market, fields):
        calls.append(tuple(fields))
        return _frame(
            {"ticker": "A", "name": "Alpha", "relative_volume_10d_calc": 2.0,
             "not_a_field": 99.0, "update_mode": "streaming"}
        )

    result = adapter.scan_sections("india", defs, fetcher=fetcher)

    assert "not_a_field" not in calls[0]
    assert "not_a_field" not in result["rows"][0]["fields"]
    assert result["rows"][0]["signals"] == {"known": True, "unknown": False}


def test_previous_state_cross(adapter):
    frame = _frame(
        {"ticker": "A", "name": "Alpha", "close": 101.0, "VWAP": 100.0,
         "update_mode": "streaming"},
        {"ticker": "B", "name": "Beta", "close": 99.0, "VWAP": 100.0,
         "update_mode": "streaming"},
    )
    previous = {
        "A": {"close": 99.0, "VWAP": 100.0},
        "B": {"close": 101.0, "VWAP": 100.0},
    }
    result = adapter.scan_sections(
        "india", [_vwap_cross()], previous=previous, fetcher=lambda m, f: frame
    )

    assert result["rows"][0]["signals"] == {"v1": True}
    assert result["rows"][1]["signals"] == {"v1": False}
    assert "_prev" not in result["rows"][0]["fields"]


def test_missing_field_is_none_and_no_signal(adapter):
    frame = _frame({"ticker": "A", "name": "Alpha", "update_mode": "streaming"})
    result = adapter.scan_sections("india", [_momentum()], fetcher=lambda m, f: frame)

    assert result["rows"][0]["fields"]["relative_volume_10d_calc"] is None
    assert result["rows"][0]["signals"] == {"m1": False}


def test_symbol_and_signal_survive_a_missing_ticker_column(adapter):
    # The library can return a duplicate null `ticker` column when callers
    # select it explicitly; identity must fall back to `name` and matches must
    # be compared against that same identity.
    frame = _frame({
        "name": "RELIANCE",
        "relative_volume_10d_calc": 2.0,
        "update_mode": "streaming",
    })
    result = adapter.scan_sections("india", [_momentum()], fetcher=lambda m, f: frame)

    assert result["rows"][0]["symbol"] == "RELIANCE"
    assert result["rows"][0]["signals"] == {"m1": True}

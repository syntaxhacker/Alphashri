"""Pure predicate evaluator for signal sections.

Rows come from one ``tradingview_screener`` fetch per market (see ``api.tv``);
the user's section conditions are applied here, in Python, after that fetch.
Nothing in this module performs I/O, reads a clock, or mutates a row.

``crosses_above`` / ``crosses_below`` need the previous poll's value. The caller
stores it on each row as ``_prev = {field: previous_value, ...}``; with no
``_prev`` the condition simply does not match — we never infer a cross from a
single snapshot.
"""

from __future__ import annotations

import math
from typing import Any

from .fields import (
    CONCEPT_REFERENCE,
    IDENTITY_FIELDS,
    OP_MAP,
    conditions_of,
    logic_of,
    metric_of,
    normalize_op,
    resolve_field,
    section_concept_of,
    section_id_of,
    value_of,
)

__all__ = ["OP_MAP", "evaluate"]


def _number(value: Any) -> float | None:
    """Finite float for comparisons; ``None`` for missing/non-numeric/NaN data."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except (TypeError, ValueError):
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def _equal(left: Any, right: Any) -> bool:
    """Equality that treats numeric strings as numbers and keeps text as text."""
    if left is None or right is None:
        return False
    a, b = _number(left), _number(right)
    if a is not None and b is not None:
        return a == b
    if isinstance(left, str) or isinstance(right, str):
        return str(left).strip() == str(right).strip()
    return left == right


def _operand(row: dict, condition: dict) -> tuple[Any, Any, str | None, bool]:
    """Resolve the right operand: a whitelisted name means another row field."""
    raw = value_of(condition)
    field = resolve_field(raw) if raw is not None and not isinstance(raw, bool) else None
    if field is not None:
        return row.get(resolve_field(metric_of(condition))), row.get(field), field, True
    return row.get(resolve_field(metric_of(condition))), raw, None, False


def _crosses(
    condition: dict, row: dict, left_now: Any, right: Any, right_field: str | None
) -> bool:
    """Sign flip between ``_prev`` and the current snapshot (strict on the new side)."""
    previous = row.get("_prev")
    if not isinstance(previous, dict):
        return False

    metric = resolve_field(metric_of(condition))
    left_before = _number(previous.get(metric))
    left_after = _number(left_now)
    if left_before is None or left_after is None:
        return False

    if right_field is not None:
        before = _number(previous.get(right_field))
        after = _number(row.get(right_field))
    else:
        before = after = _number(right)
    if before is None or after is None:
        return False

    op = normalize_op(condition.get("op") or condition.get("operator"))
    if op == "crosses_above":
        return left_before <= before and left_after > after
    if op == "crosses_below":
        return left_before >= before and left_after < after
    return False


def _condition_matches(condition: dict, row: dict) -> bool:
    metric = resolve_field(metric_of(condition))
    op = normalize_op(condition.get("op") or condition.get("operator") or condition.get("operation"))
    if metric is None or op is None or value_of(condition) is None:
        return False

    left, right, right_field, _ = _operand(row, condition)
    if op in ("crosses_above", "crosses_below"):
        return _crosses(condition, row, left, right, right_field)
    if op == "eq":
        return _equal(left, right)

    a, b = _number(left), _number(right)
    if a is None or b is None:
        return False
    if op == "gt":
        return a > b
    if op == "gte":
        return a >= b
    if op == "lt":
        return a < b
    if op == "lte":
        return a <= b
    return False


def _valid(condition: dict) -> bool:
    """Reject unknown metrics/ops before evaluation — never weaken a filter."""
    return bool(
        resolve_field(metric_of(condition))
        and normalize_op(
            condition.get("op") or condition.get("operator") or condition.get("operation")
        )
        and value_of(condition) is not None
    )


def _section_matches(definition: dict, row: dict) -> bool:
    conditions = conditions_of(definition)
    if not conditions:
        return True
    # A null value means the concept supplies the comparison field. Materialise
    # that field reference before validation so VWAP/EMA/52W sections work.
    reference = CONCEPT_REFERENCE.get(section_concept_of(definition) or "")
    if reference is not None:
        conditions = [
            {**condition, "value": reference}
            if value_of(condition) is None
            else condition
            for condition in conditions
        ]
    if not all(_valid(condition) for condition in conditions):
        return False
    results = [_condition_matches(condition, row) for condition in conditions]
    return any(results) if logic_of(definition) == "or" else all(results)


def _eligible(definition: dict, row: dict) -> bool:
    """Live sections require a streaming feed; delayed rows need an opt-in."""
    if row.get("update_mode") == "streaming":
        return True
    return bool(definition.get("allow_delayed"))


def _symbol(row: dict) -> str | None:
    for key in IDENTITY_FIELDS:
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def evaluate(rows: list[dict], defs: list[dict]) -> dict[str, list[str]]:
    """Map each section id to the symbols it matches.

    Result lists are in row order, deduplicated. Sections with no conditions
    match every eligible row. Delayed rows are excluded unless the definition
    carries ``allow_delayed`` (the caller is responsible for marking those rows
    as delayed — e.g. ``_delayed: True`` — for the UI badge).
    """
    result: dict[str, list[str]] = {}
    for definition in defs or []:
        section_id = section_id_of(definition)
        if section_id is None:
            continue
        matched = result.setdefault(section_id, [])
        seen = set(matched)
        for row in rows or []:
            if not isinstance(row, dict) or not _eligible(definition, row):
                continue
            if not _section_matches(definition, row):
                continue
            symbol = _symbol(row)
            if symbol is None or symbol in seen:
                continue
            seen.add(symbol)
            matched.append(symbol)
    return result

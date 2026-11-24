"""Verified TradingView field whitelist for signal sections.

The scanner frame is fetched once per market through ``api.tv`` /
``tradingview_screener``; every section metric and render column is resolved
against this whitelist before it becomes part of the shared ``select()`` call.
A typo or an unavailable field is dropped here — it never reaches the network
and it never silently turns into a predicate that matches everything.

``change|N`` spellings come from ``api.tv.INTRADAY_CHANGE_FIELDS`` rather than
being restated: that map is the repo's single source for the verified flat
intraday field names (``columns.py:120-129``).
"""

from __future__ import annotations

from typing import Any, Iterable

from api.tv import INTRADAY_CHANGE_FIELDS
from api.tv.columns import canonical_field

#: Fields verified present in both the India and America scanner frames
#: (2026-11-24 probe). ``ticker``/``name`` are handled separately because the
#: library adds them to every DataFrame automatically.
SECTION_FIELDS: frozenset[str] = frozenset(
    {
        "close",
        "open",
        "high",
        "low",
        "VWAP",
        "change",
        "change_abs",
        *INTRADAY_CHANGE_FIELDS.values(),  # change|1, change|5, change|15
        "change|30",
        "change|60",
        "volume",
        "volume_change|5",
        "volume_change|15",
        "relative_volume_10d_calc",
        "average_volume_10d_calc",
        "price_52_week_high",
        "price_52_week_low",
        "EMA20",
        "EMA50",
        "market_cap_basic",
        "Volatility.D",
        "Volatility.W",
        "Perf.W",
        "type",
        "exchange",
        "update_mode",
    }
)

#: Identity columns the library injects into every scanned frame. They are
#: valid metrics/render columns and are always part of the requested union.
AUTO_FIELDS: frozenset[str] = frozenset({"ticker", "name"})

#: A null condition value means "the concept supplies the comparison field".
#: Keep this in sync with src/state/sections/presets.ts (same ids, same fields).
CONCEPT_REFERENCE: dict[str, str] = {
    "vwap_above": "VWAP",
    "vwap_below": "VWAP",
    "vwap_cross": "VWAP",
    "52w_touch": "price_52_week_high",
    "ema_cross": "EMA50",
    "orb_proxy": "open",
}

_CONCEPT_KEYS = ("concept", "kind", "section_concept")

#: Deterministic order for the identity fields (frozenset order is not stable).
IDENTITY_FIELDS: tuple[str, ...] = ("ticker", "name")

#: Needed for the live-data guard and the type/exchange display badges, whether
#: or not a section names them explicitly.
REQUIRED_FIELDS: tuple[str, ...] = ("update_mode", "type", "exchange")

#: Every field a section may legally name.
ALLOWED_FIELDS: frozenset[str] = SECTION_FIELDS | AUTO_FIELDS

#: Section predicate id -> the library's ``FilterOperationDict["operation"]``
#: spelling. This is a shared vocabulary only: section predicates are evaluated
#: in Python after the single fetch, never pushed into the scanner WHERE clause.
OP_MAP: dict[str, str] = {
    "gt": "greater",
    "gte": "egreater",
    "lt": "less",
    "lte": "eless",
    "eq": "equal",
    "crosses_above": "crosses_above",
    "crosses_below": "crosses_below",
}

#: Accepted UI spellings for the same operators. Unknown operators are rejected.
OP_ALIASES: dict[str, str] = {
    ">": "gt",
    ">=": "gte",
    "≥": "gte",
    "<": "lt",
    "<=": "lte",
    "≤": "lte",
    "=": "eq",
    "==": "eq",
    "crosses up": "crosses_above",
    "crosses down": "crosses_below",
}

#: Where a predicate's operands may live on a SectionDefinition condition.
_METRIC_KEYS = ("metric", "field", "column")
_VALUE_KEYS = ("value", "threshold", "right")
_ID_KEYS = ("id", "section_id", "key")
_LOGIC_KEYS = ("logic", "match")


def resolve_field(name: Any) -> str | None:
    """Return the canonical field for *name*, or ``None`` when not allowed.

    Legacy spellings are resolved through ``api.tv.columns.canonical_field`` so
    there is only one alias table. Unknown fields are rejected, not guessed.
    """
    if name is None:
        return None
    text = canonical_field(str(name))
    return text if text in ALLOWED_FIELDS else None


def normalize_op(op: Any) -> str | None:
    """Return the canonical predicate op for *op*, or ``None`` if unsupported."""
    if not isinstance(op, str):
        return None
    text = op.strip().lower()
    text = OP_ALIASES.get(text, text)
    return text if text in OP_MAP else None


def _first(mapping: dict, keys: Iterable[str], default: Any = None) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return default


def conditions_of(definition: Any) -> list[dict]:
    """Conditions of a SectionDefinition; tolerate a missing/short-shaped def."""
    if not isinstance(definition, dict):
        return []
    raw = _first(definition, ("conditions", "predicates", "filters"), [])
    if not isinstance(raw, (list, tuple)):
        return []
    return [item for item in raw if isinstance(item, dict)]


def render_columns_of(definition: Any) -> list[Any]:
    """Render columns of a SectionDefinition (``render.columns``)."""
    if not isinstance(definition, dict):
        return []
    render = definition.get("render", {})
    if isinstance(render, dict):
        raw = _first(render, ("columns", "fields"), [])
    elif isinstance(render, (list, tuple)):
        raw = render
    else:
        raw = _first(definition, ("columns", "render_columns", "fields"), [])
    if not isinstance(raw, (list, tuple)):
        return []
    return list(raw)


def section_id_of(definition: Any) -> str | None:
    """Stable identifier used as the key of ``evaluate``'s result."""
    if not isinstance(definition, dict):
        return None
    value = _first(definition, _ID_KEYS)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def logic_of(definition: Any) -> str:
    """``"and"`` (default) or ``"or"`` — how a section's conditions combine."""
    if not isinstance(definition, dict):
        return "and"
    value = _first(definition, _LOGIC_KEYS, "and")
    text = str(value).strip().lower() if value is not None else "and"
    return "or" if text in {"or", "any"} else "and"


def section_concept_of(definition: Any) -> str | None:
    """Concept id of a section; drives null-value reference resolution."""
    if not isinstance(definition, dict):
        return None
    value = _first(definition, _CONCEPT_KEYS)
    return str(value).strip() if value is not None else None


def metric_of(condition: Any) -> Any:
    """Raw metric name of a condition (before whitelist resolution)."""
    return _first(condition, _METRIC_KEYS) if isinstance(condition, dict) else None


def value_of(condition: Any) -> Any:
    """Raw operand of a condition (before field-reference resolution)."""
    return _first(condition, _VALUE_KEYS) if isinstance(condition, dict) else None


def condition_fields(condition: dict, concept: str | None = None) -> list[str]:
    """Fields referenced by one condition.

    A cross/threshold condition may compare against another scanner field
    (``close crosses above VWAP``), so the field-valued operand must join the
    select union too — otherwise the second leg would be missing from the frame.
    """
    fields: list[str] = []
    metric = resolve_field(metric_of(condition))
    if metric:
        fields.append(metric)
    value = value_of(condition)
    if value is None and concept is not None:
        value = CONCEPT_REFERENCE.get(concept)
    if value is not None and not isinstance(value, bool):
        right = resolve_field(value)
        if right and right not in fields:
            fields.append(right)
    return fields


def fields_for_sections(defs: list[dict]) -> list[str]:
    """Union of all section fields in stable first-seen order.

    Identity fields lead (the library adds them), then each definition's
    condition fields and render columns in declaration order, then the
    mandatory guard/badge fields. Unavailable fields are dropped.
    """
    ordered = list(IDENTITY_FIELDS)
    seen = set(ordered)

    def add(field: str | None) -> None:
        if field and field not in seen:
            seen.add(field)
            ordered.append(field)

    for definition in defs or []:
        concept = section_concept_of(definition)
        for condition in conditions_of(definition):
            for field in condition_fields(condition, concept):
                add(field)
        for column in render_columns_of(definition):
            add(resolve_field(column))

    for required in REQUIRED_FIELDS:
        add(required)

    return ordered

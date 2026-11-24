"""Section scan adapter: one TradingView frame per market per cache window.

The fields lane (``api.sections.fields`` / ``.predicates``) owns the metric
whitelist and the predicate evaluator. This module owns transport, the raw
frame cache, the delayed-feed guard and the response envelope; it computes no
indicators and never invents a value the scanner did not return.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from tradingview_screener import Query

from .fields import SECTION_FIELDS, fields_for_sections

try:  # the fields lane re-exports the evaluator; use it when present
    from .fields import evaluate
except ImportError:  # until then it lives in the sibling pure module
    from .predicates import evaluate

CACHE_TTL_SEC = 60

_FRAME_LIMIT = 500
_STREAMING = "streaming"
# The scanner always carries these; fields_for_sections already includes them,
# but guard the live-data check even if that contract changes.
_REQUIRED_FIELDS = ("ticker", "name", "update_mode")

# Monotonic clock as a module attribute so tests can advance a window without
# sleeping (wall-clock adjustments must never extend a cache window).
_monotonic = time.monotonic
# ``(market, field-union) -> (stored_at, raw frame)``. The frame is cache-owned:
# callers must never mutate it. Predicates see copies with per-request _prev.
_cache: dict[tuple[str, tuple[str, ...]], tuple[float, Any]] = {}


def _field_names(value: Any) -> list[str]:
    """Normalise ``fields_for_sections`` output to a flat list of field names."""
    if value is None:
        return []
    if isinstance(value, dict):
        candidates = value.keys()
    elif isinstance(value, (list, tuple, set, frozenset)):
        candidates = value
    else:
        candidates = [value]
    return [str(item) for item in candidates if item is not None]


def _union_fields(defs: list[dict]) -> tuple[str, ...]:
    """Stable union of the fields a section set needs."""
    if not defs:
        return ()
    fields = _field_names(fields_for_sections(defs))
    if SECTION_FIELDS:
        allowed = set(SECTION_FIELDS) | {"ticker", "name"}
        fields = [field for field in fields if field in allowed]
    fields.extend(_REQUIRED_FIELDS)
    return tuple(sorted(dict.fromkeys(fields)))


def _default_fetcher(market: str, fields: list[str]):
    """The one library call shape; ``fetcher`` replaces it in tests."""
    result = (
        Query().set_markets(market).select(*fields).limit(_FRAME_LIMIT).get_scanner_data()
    )
    # get_scanner_data() returns (total_count, dataframe); a custom fetcher may
    # return the frame directly.
    return result[1] if isinstance(result, tuple) and len(result) == 2 else result


def _rows(frame: Any) -> list[dict]:
    """Read a frame as dict rows, supporting DataFrames and plain sequences."""
    if frame is None:
        return []
    try:
        records = frame.to_dict("records") if hasattr(frame, "to_dict") else list(frame)
    except (TypeError, ValueError):
        records = list(frame)
    return [dict(record) for record in records]


def _cell(row: dict, key: str) -> Any:
    """Return a scanner value or None; NaN is a missing value, never a number."""
    if key not in row:
        return None
    value = row[key]
    if value is None:
        return None
    if isinstance(value, float) and value != value:
        return None
    return value


def _signals(eval_rows: list[dict], defs: list[dict], allow_delayed: bool) -> list[dict[str, bool]]:
    """Invert ``evaluate``'s section -> symbols map into per-row signals."""
    if not defs:
        return [{} for _ in eval_rows]
    # The service-level opt-in is authoritative: delayed rows present in the
    # response must also be eligible for section predicates.
    eval_defs = [{**definition, "allow_delayed": True} for definition in defs] if allow_delayed else defs
    matched = evaluate(eval_rows, eval_defs) or {}
    return [
        {
            str(section_id): str(row.get("ticker")) in symbols
            for section_id, symbols in matched.items()
        }
        for row in eval_rows
    ]


def clear_cache() -> None:
    """Drop all cached frames (used between tests and on manual refresh)."""
    _cache.clear()


def scan_sections(
    market: str,
    defs: list[dict],
    *,
    allow_delayed: bool = False,
    previous: dict[str, dict] | None = None,
    fetcher=None,
) -> dict:
    """Scan one market once per cache window and evaluate section predicates.

    ``fetcher(market, fields)`` may return a DataFrame, a sequence of row dicts,
    or the library's ``(count, frame)`` tuple. User predicates are never sent to
    TradingView: they are applied in Python to the cached raw frame.
    """
    market_key = str(market).strip().lower()
    defs = list(defs or [])
    fields = _union_fields(defs)
    response: dict[str, Any] = {
        "market": market_key,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "row_count": 0,
        "delayed_rows": 0,
        "note": None,
        "rows": [],
    }
    if not fields:
        return response

    key = (market_key, fields)
    now = _monotonic()
    cached = _cache.get(key)
    if cached is not None and now < cached[0] + CACHE_TTL_SEC:
        frame = cached[1]
    else:
        frame = (fetcher or _default_fetcher)(market_key, list(fields))
        if isinstance(frame, tuple) and len(frame) == 2:
            frame = frame[1]
        _cache[key] = (now, frame)

    rows: list[dict] = []
    eval_rows: list[dict] = []
    delayed_rows = 0
    for raw in _rows(frame):
        mode = _cell(raw, "update_mode")
        is_delayed = mode is None or str(mode).strip().lower() != _STREAMING
        if is_delayed:
            delayed_rows += 1
            if not allow_delayed:
                continue

        row_fields = {field: _cell(raw, field) for field in fields}
        symbol = str(_cell(raw, "ticker") or _cell(raw, "symbol") or "")
        name = _cell(raw, "name")
        # The evaluator reads `_prev` from the row to detect crosses. It never
        # appears in the response payload.
        eval_row = dict(row_fields)
        eval_row["ticker"] = symbol
        eval_row["_prev"] = (previous or {}).get(symbol)
        rows.append({"symbol": symbol, "name": name, "fields": row_fields, "signals": {}})
        eval_rows.append(eval_row)

    signals = _signals(eval_rows, defs, allow_delayed)
    for row, row_signals in zip(rows, signals):
        row["signals"] = row_signals

    response["rows"] = rows
    response["row_count"] = len(rows)
    response["delayed_rows"] = delayed_rows
    if delayed_rows:
        response["note"] = (
            f"Including {delayed_rows} delayed row(s); data may be up to 15 minutes old."
            if allow_delayed
            else f"Excluded {delayed_rows} delayed row(s); streaming data required."
        )
    return response

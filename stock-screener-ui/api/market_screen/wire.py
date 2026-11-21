"""Opt-in columnar wire format for GET /api/market/snapshot.

The default object payload repeats every field name once per row -- at the real
3,229-row frame roughly 800 KB is key text the client already knows. The
``columns-v1`` layout hoists the key set into ``fields`` once and transposes the
values into equal-length columns, so the client can build typed arrays without a
per-row dict. It is strictly additive: the JSON body is unchanged unless the
caller asks for ``?format=columns``.

Serialization is done here rather than by FastAPI so the payload is encoded
once. orjson is the fast path (the wire format is identical without it: no
whitespace, no key sorting, no NaN); the stdlib fallback keeps this module
importable when the wheel is absent.
"""

from __future__ import annotations

import json
from typing import Any

try:
    import orjson as _fastjson
except ImportError:  # pragma: no cover - fallback keeps the module importable
    _fastjson = None

WIRE_FORMAT_JSON = "json"
WIRE_FORMAT_COLUMNS = "columns"
ALLOWED_FORMATS: tuple[str, ...] = (WIRE_FORMAT_JSON, WIRE_FORMAT_COLUMNS)

#: Carried in the payload so a future layout can never be mistaken for this one.
COLUMNS_FORMAT_VERSION = "columns-v1"


def normalize_format(value: str | None) -> str:
    """Return the canonical format id, or raise ``ValueError`` for an unknown one.

    Matching is case/whitespace tolerant (``?format= Columns `` is the columnar
    mode) but there is no silent fallback: a typo must fail loudly instead of
    quietly shipping a body the caller did not ask for.
    """
    fmt = (value or WIRE_FORMAT_JSON).strip().lower()
    if fmt not in ALLOWED_FORMATS:
        raise ValueError(
            f"unknown format '{value}'; expected one of "
            + ", ".join(ALLOWED_FORMATS)
        )
    return fmt


def to_columnar(payload: dict[str, Any]) -> dict[str, Any]:
    """Transpose an object-envelope payload into ``columns-v1``.

    ``meta`` is the envelope minus ``rows``, so every key the JSON response
    carries (``as_of``, ``update_mode``, ``cached``, ``stale``, ``age_sec``,
    ``universe``, ``total``) survives untouched.

    ``fields`` starts from the first row's key order. A key that only shows up
    in a later row is appended rather than dropped, and every row contributes a
    value (``None`` when absent) so each column has exactly ``len(rows)``
    entries -- a ragged row must not silently shorten a column.
    """
    rows = payload.get("rows") or []
    meta = {key: value for key, value in payload.items() if key != "rows"}
    if not rows:
        return {
            "format": COLUMNS_FORMAT_VERSION,
            "meta": meta,
            "fields": [],
            "columns": {},
        }

    fields = list(rows[0].keys())
    seen = set(fields)
    for row in rows[1:]:
        for key in row:
            if key not in seen:
                seen.add(key)
                fields.append(key)

    columns: dict[str, list[Any]] = {field: [] for field in fields}
    for row in rows:
        for field in fields:
            columns[field].append(row.get(field))

    return {
        "format": COLUMNS_FORMAT_VERSION,
        "meta": meta,
        "fields": fields,
        "columns": columns,
    }


def dumps(payload: Any) -> bytes:
    """Encode a payload once, as bytes, for a ``Response`` body.

    Returning bytes lets FastAPI hand the body straight to the ASGI layer --
    the dict would otherwise be encoded twice (once here, once by the default
    ``JSONResponse``). GZipMiddleware still compresses it normally.
    """
    if _fastjson is not None:
        return _fastjson.dumps(payload)
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

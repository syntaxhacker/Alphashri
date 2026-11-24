"""HTTP surface for native signal sections: ``GET /api/sections/scan``."""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api.auth import get_current_user

from .fields import (
    conditions_of,
    metric_of,
    render_columns_of,
    resolve_field,
    section_id_of,
)
from .service import scan_sections

logger = logging.getLogger("sections.router")

ROUTER_PREFIX = "/api/sections"
SCAN_PATH = "/scan"
SECTION_SCAN_PATH = ROUTER_PREFIX + SCAN_PATH

router = APIRouter(prefix=ROUTER_PREFIX, tags=["sections"])


class SectionRow(BaseModel):
    """One scanner row with the requested fields and per-section booleans."""

    symbol: str
    name: str | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    signals: dict[str, Any] = Field(default_factory=dict)


class SectionScanResponse(BaseModel):
    """Scanned rows plus feed freshness metadata for the UI."""

    market: str
    generated_at: str
    rows: list[SectionRow] = Field(default_factory=list)
    row_count: int = 0
    delayed_rows: int = 0
    note: str | None = None


def _has_usable_field(definition: dict) -> bool:
    """A definition is actionable only if a metric or render column resolves."""
    for condition in conditions_of(definition):
        if resolve_field(metric_of(condition)):
            return True
    for column in render_columns_of(definition):
        if isinstance(column, str) and resolve_field(column):
            return True
    return False


def _parse_definitions(raw: str) -> tuple[list[dict], int]:
    """Decode the JSON query param and drop definitions we cannot evaluate."""
    try:
        parsed = json.loads(raw or "[]")
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="sections must be a JSON array of SectionDefinition objects",
        ) from exc

    if not isinstance(parsed, list):
        parsed = [parsed]

    valid: list[dict] = []
    dropped = 0
    for definition in parsed:
        concept = definition.get("concept") if isinstance(definition, dict) else None
        if (
            not isinstance(definition, dict)
            or not section_id_of(definition)
            or not isinstance(concept, str)
            or not concept.strip()
            or not _has_usable_field(definition)
        ):
            dropped += 1
            continue
        valid.append(definition)
    return valid, dropped


def _with_drop_note(payload: dict, dropped: int) -> dict:
    """Surface dropped definitions without mutating the service payload."""
    if not dropped:
        return payload
    parts = [
        text
        for text in (
            payload.get("note"),
            f"Dropped {dropped} invalid section definition(s); they were ignored.",
        )
        if text
    ]
    return {**payload, "note": "; ".join(parts)}


@router.get(
    SCAN_PATH,
    response_model=SectionScanResponse,
    summary="Scan signal sections for a market",
    description=(
        "Evaluate user-defined signal sections against one TradingView scanner "
        "frame per market. Definitions are supplied as a JSON array in the "
        "`sections` query parameter; unknown or malformed definitions are "
        "dropped and reported in `note`. Delayed rows are excluded unless "
        "`allow_delayed` is set, and `delayed_rows` plus `note` always disclose "
        "them. Configured conditions are evaluated in Python after the fetch, "
        "never pushed to the scanner."
    ),
)
async def scan_sections_route(
    market: Literal["india", "america"] = Query(
        "india", description="Market id. `india` or `america`."
    ),
    sections: str = Query(
        "[]",
        description="JSON array of SectionDefinition objects (id, concept, conditions, render).",
    ),
    allow_delayed: bool = Query(
        False,
        description="Include delayed scanner rows, with a visible note and badge count.",
    ),
    _user=Depends(get_current_user),
) -> SectionScanResponse:
    definitions, dropped = _parse_definitions(sections)
    payload = await run_in_threadpool(
        scan_sections,
        market=market,
        defs=definitions,
        allow_delayed=allow_delayed,
    )
    return SectionScanResponse.model_validate(_with_drop_note(payload, dropped))


__all__ = [
    "ROUTER_PREFIX",
    "SCAN_PATH",
    "SECTION_SCAN_PATH",
    "SectionRow",
    "SectionScanResponse",
    "router",
]

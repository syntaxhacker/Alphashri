"""HTTP surface for the Home Monitor Catalyst Radar: ``/api/catalysts``."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import get_current_user

from .contract import DEFAULT_SECTOR, CatalystToday
from .service import build_catalysts

logger = logging.getLogger("catalyst_radar.router")

ROUTER_PREFIX = "/api/catalysts"
TODAY_PATH = "/today"
CATALYSTS_TODAY_PATH = ROUTER_PREFIX + TODAY_PATH

router = APIRouter(prefix=ROUTER_PREFIX, tags=["catalysts"])

_ALLOWED_MARKETS = ("india",)


@router.get(
    TODAY_PATH,
    response_model=CatalystToday,
    summary="Today's sector catalysts for the Home Monitor",
    description=(
        "Sector-level catalyst read for the Home Monitor. The NIFTY Auto "
        "constituents and their live move/relative volume/52-week state come "
        "from the existing market snapshot; headlines come from Google News "
        "RSS. A dead source is reported in `warnings` -- the endpoint still "
        "returns whatever it can verify and never fabricates a row."
    ),
)
async def catalysts_today(
    market: str = Query(
        default="india",
        description="Market id. v1 supports `india`.",
    ),
    sector: str = Query(
        default=DEFAULT_SECTOR,
        description="`all` or any sector id returned in `available_sectors`.",
    ),
    _user=Depends(get_current_user),
) -> CatalystToday:
    value = (market or "").strip().lower()
    if value not in _ALLOWED_MARKETS:
        raise HTTPException(status_code=400, detail=f"unknown market '{market}'")
    return await build_catalysts(value, sector)


__all__ = [
    "CATALYSTS_TODAY_PATH",
    "ROUTER_PREFIX",
    "TODAY_PATH",
    "router",
]

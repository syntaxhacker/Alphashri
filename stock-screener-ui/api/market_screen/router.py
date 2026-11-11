"""Market screen router — GET /api/market/snapshot."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .snapshot import MAX_LIMIT, build_snapshot

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get(
    "/snapshot",
    summary="NSE market snapshot for the one-page screener",
)
async def market_snapshot(
    universe: str = Query(
        default="all_equity",
        description="Universe: all_equity (default), nifty50, nifty500 or nse_fo.",
    ),
    limit: int = Query(
        default=MAX_LIMIT,
        ge=1,
        le=MAX_LIMIT,
        description="Max rows returned (1..4000).",
    ),
    force: bool = Query(
        default=False,
        description="Bypass the in-process/disk cache and re-fetch from TradingView.",
    ),
) -> dict[str, Any]:
    """Return the whole NSE market (one TV scan) shaped for the screener.

    The (potentially 58s cold) TV scan runs off the event loop via
    ``asyncio.to_thread`` so it can never block other requests.
    """
    try:
        return await asyncio.to_thread(build_snapshot, universe, limit, force)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # upstream TV failure without a cached fallback
        raise HTTPException(
            status_code=502, detail=f"market_source_unavailable: {exc}"
        ) from exc

"""Market screen router — GET /api/market/snapshot."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import get_current_user
from .snapshot import MAX_LIMIT, MAX_SYMBOLS, build_snapshot, select_rows

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get(
    "/snapshot",
    summary="NSE market snapshot for the one-page screener",
    dependencies=[Depends(get_current_user)],
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
    symbols: str | None = Query(
        default=None,
        description=(
            "Optional comma-separated symbols (max 20). Filtered against the "
            "full cached snapshot, before `limit` is applied; unknown symbols "
            "are omitted."
        ),
    ),
    force: bool = Query(
        default=False,
        description="Bypass the in-process/disk cache and re-fetch from TradingView.",
    ),
) -> dict[str, Any]:
    """Return the whole NSE market (one TV scan) shaped for the screener.

    The (potentially 58s cold) TV scan runs off the event loop via
    ``asyncio.to_thread`` so it can never block other requests.

    ``symbols`` is optional. An empty or whitespace-only value (e.g.
    ``?symbols=``) means no filter and returns all rows; otherwise it filters
    the full snapshot to the requested symbols (max 20, deduplicated
    case-insensitively) and ``total`` is the number of matches. The filter runs
    before ``limit`` truncates the response, so a symbol outside the first
    ``limit`` rows of the universe is still found.
    """
    wanted: list[str] | None = None
    if symbols is not None:
        raw = [s.strip() for s in symbols.split(",") if s.strip()]
        # Dedupe case-insensitively (first occurrence wins) before the cap
        # check so repeated entries do not burn the symbol budget.
        seen: set[str] = set()
        wanted = []
        for s in raw:
            key = s.upper()
            if key in seen:
                continue
            seen.add(key)
            wanted.append(s)
        if len(wanted) > MAX_SYMBOLS:
            raise HTTPException(
                status_code=400,
                detail=f"symbols accepts at most {MAX_SYMBOLS} symbols",
            )

    # A symbol filter must see the whole universe: the TV scan truncates to
    # ``limit``, so filtering a 12-row frame can never find rank 400. Build the
    # full frame (the same one the prewarm task caches) and apply the cap after
    # the filter. The cached frame is therefore keyed on MAX_LIMIT -- the cache
    # stores the full snapshot, and the filter stays a response transform.
    frame_limit = MAX_LIMIT if wanted else limit
    try:
        result = await asyncio.to_thread(build_snapshot, universe, frame_limit, force)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # upstream TV failure without a cached fallback
        raise HTTPException(
            status_code=502, detail=f"market_source_unavailable: {exc}"
        ) from exc

    if wanted:
        rows, matched = select_rows(result["rows"], wanted, limit)
        result = {**result, "rows": rows, "total": matched}
    return result

"""HTTP surface for the additive LevelBook read: ``GET /api/levels/{symbol}``.

Additive by contract: this router only exposes the existing LevelBook service
and never touches or replaces the 52W screener columns, the original chart S/R,
or any other consumer endpoint. It follows the read-only market-endpoint
precedent (open, like ``/api/chart-patterns/symbol/{symbol}``).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api.utils import _sanitize_for_json
from .service import build_levels_payload

ROUTER_PREFIX = "/api/levels"

router = APIRouter(prefix=ROUTER_PREFIX, tags=["levels"])


@router.get(
    "/{symbol}",
    summary="Fused LevelBook S/R + trendline for a symbol",
    description=(
        "Additive read of the LevelBook for a symbol: returns the fused "
        "support/resistance zones and confirmed trendline segments plus the "
        "current spot. The endpoint only wraps the existing "
        "``market_levels.build_level_book`` service and never mutates or "
        "replaces the 52W screener columns, the original chart S/R, or any "
        "other consumer output."
    ),
)
def levels_for_symbol(
    symbol: str,
    timeframe: str = Query(
        default="1D",
        description="Registered timeframe id, e.g. 1D (default), 1h, 15m.",
    ),
    lookback_bars: Optional[int] = Query(
        default=None,
        ge=1,
        description="Limit the candle window passed to the detectors.",
    ),
):
    """Return the additive LevelBook S/R + trendline snapshot for ``symbol``."""
    symbol = (symbol or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol required")
    if lookback_bars is not None and lookback_bars < 1:
        raise HTTPException(status_code=400, detail="lookback_bars must be >= 1")

    payload = build_levels_payload(
        symbol=symbol,
        timeframe=timeframe,
        lookback_bars=lookback_bars,
    )
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail=f"no candle data for '{symbol}' at timeframe '{timeframe}'",
        )
    return _sanitize_for_json(payload)


__all__ = ["ROUTER_PREFIX", "router"]
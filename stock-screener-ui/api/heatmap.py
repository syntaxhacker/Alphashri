"""
Heatmap API — P/E Forward heatmap for Indian stocks (NSE/BSE).
"""

import logging
from typing import List, Optional
from functools import lru_cache
from datetime import datetime, timedelta

from fastapi import APIRouter, Query, HTTPException
import config

logger = logging.getLogger(__name__)
router = APIRouter(tags=["heatmap"])

# In-memory cache (15 min TTL)
_heatmap_cache = {"data": None, "timestamp": None}
CACHE_TTL_SECONDS = 15 * 60  # 15 minutes


def _get_tradingview_screener():
    """Import and return TradingView screener instance."""
    from tradingview_screener import Query
    return Query()


@lru_cache(maxsize=1)
def _get_cached_stocks() -> List[dict]:
    """
    Fetch top 500 NSE stocks with P/E and market cap data from TradingView.
    Returns list of dicts with: symbol, name, sector, market_cap, pe_ratio, price, change_pct
    """
    try:
        q = _get_tradingview_screener()
        df = q.with_columns(
            "market_cap_basic",
            "price_earnings_ttm",  # Forward P/E
            "close",
            "name",
            "sector",
            "description",
            "change_percent",
        ).set_filter(
            "exchange=NSE"
        ).order_by("market_cap_basic", ascending=False).limit(500)

        rows = df.execute()

        if rows.empty:
            logger.warning("TradingView screener returned empty result")
            return []

        stocks = []
        for _, row in rows.iterrows():
            pe = row.get("price_earnings_ttm")
            mcap = row.get("market_cap_basic")

            # Skip stocks with no P/E or negative P/E (loss-making)
            if pe is None or pe <= 0:
                continue
            if mcap is None or mcap <= 0:
                continue

            stocks.append({
                "symbol": row.get("ticker", "").replace(":NSE", ""),
                "name": row.get("name", ""),
                "sector": row.get("sector", ""),
                "market_cap": mcap,
                "pe_ratio": round(pe, 2),
                "price": row.get("close"),
                "change_pct": row.get("change_percent"),
            })

        logger.info(f"Fetched {len(stocks)} stocks with valid P/E data from TradingView")
        return stocks

    except Exception as e:
        logger.error(f"Error fetching TradingView screener data: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to fetch stock data: {str(e)}")


def _get_cached_data() -> List[dict]:
    """Return cached data if still valid, else fetch fresh data."""
    now = datetime.now()
    if (
        _heatmap_cache["data"] is not None
        and _heatmap_cache["timestamp"] is not None
        and (now - _heatmap_cache["timestamp"]).total_seconds() < CACHE_TTL_SECONDS
    ):
        return _heatmap_cache["data"]

    # Fetch fresh data
    data = _get_cached_stocks()
    _heatmap_cache["data"] = data
    _heatmap_cache["timestamp"] = now
    return data


@router.get("/api/heatmap/pe")
async def get_pe_heatmap(
    min_pe: Optional[float] = Query(None, description="Minimum P/E ratio filter"),
    max_pe: Optional[float] = Query(None, description="Maximum P/E ratio filter"),
    sector: Optional[str] = Query(None, description="Filter by sector"),
    limit: int = Query(500, ge=1, le=1000, description="Number of stocks to return"),
) -> dict:
    """
    Get top Indian stocks by market cap with P/E ratios.
    Returns heatmap-ready data (sorted by market cap, color-coded by P/E).
    """
    stocks = _get_cached_data()

    # Apply filters
    if min_pe is not None:
        stocks = [s for s in stocks if s["pe_ratio"] >= min_pe]
    if max_pe is not None:
        stocks = [s for s in stocks if s["pe_ratio"] <= max_pe]
    if sector:
        stocks = [s for s in stocks if s["sector"] and sector.lower() in s["sector"].lower()]

    # Apply limit
    stocks = stocks[:limit]

    return {
        "stocks": stocks,
        "count": len(stocks),
        "cached": _heatmap_cache["timestamp"] is not None,
    }


@router.get("/api/heatmap/sectors")
async def get_sectors():
    """Return sector list with average P/E and stock count."""
    stocks = _get_cached_data()

    sector_data = {}
    for s in stocks:
        sect = s.get("sector") or "Unknown"
        if sect not in sector_data:
            sector_data[sect] = {"count": 0, "total_pe": 0}

        sector_data[sect]["count"] += 1
        sector_data[sect]["total_pe"] += s["pe_ratio"]

    sectors = []
    for name, data in sector_data.items():
        avg_pe = data["total_pe"] / data["count"] if data["count"] > 0 else 0
        sectors.append({
            "name": name,
            "count": data["count"],
            "avg_pe": round(avg_pe, 2),
        })

    # Sort by count descending
    sectors.sort(key=lambda x: x["count"], reverse=True)

    return {"sectors": sectors}


@router.post("/api/heatmap/refresh")
async def refresh_cache():
    """Force refresh the cache (admin endpoint)."""
    global _heatmap_cache
    _heatmap_cache = {"data": None, "timestamp": None}
    data = _get_cached_data()
    return {"status": "refreshed", "count": len(data)}
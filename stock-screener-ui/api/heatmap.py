"""
Heatmap API — P/E Forward heatmap for Indian stocks (NSE/BSE).
"""

import logging
from typing import List, Optional
from functools import lru_cache
from datetime import datetime

from fastapi import APIRouter, Query, HTTPException
from tradingview_screener import Query as TVQuery, col

logger = logging.getLogger(__name__)
router = APIRouter(tags=["heatmap"])

_heatmap_cache = {"data": None, "timestamp": None}
CACHE_TTL_SECONDS = 15 * 60


from requests.exceptions import RequestException, HTTPError, ConnectionError as RequestsConnectionError, Timeout
import time

FALLBACK_DATA_KEY = "heatmap_fallback"


def _get_cached_stocks() -> List[dict]:
    max_retries = 3
    last_error = None

    for attempt in range(max_retries):
        try:
            query = TVQuery()
            query = query.select(
                'name', 'close', 'change', 'sector',
                'market_cap_basic', 'price_earnings_ttm',
                'price_book_ratio', 'dividend_yield_recent',
                'Perf.Y', 'return_on_equity',
                'price_52_week_high', 'price_52_week_low',
            )
            query = query.set_markets('india')
            query = query.where(col('sector') != '', col('price_earnings_ttm') > 0)
            query = query.order_by('market_cap_basic', ascending=False).limit(1000)

            _, df = query.get_scanner_data()

            if df.empty:
                logger.warning("TradingView screener returned empty result")
                return _get_fallback_data()

            # Deduplicate - keep NSE only, drop BSE duplicates
            df = df[~df['ticker'].str.contains('BSE:')].drop_duplicates(subset=['name'])

            stocks = []
            for _, row in df.iterrows():
                stocks.append({
                    "symbol": row.get("ticker", "").replace("NSE:", ""),
                    "name": row.get("name", ""),
                    "sector": row.get("sector", ""),
                    "market_cap": row.get("market_cap_basic"),
                    "pe_ratio": round(row.get("price_earnings_ttm", 0), 2),
                    "pb_ratio": round(row.get("price_book_ratio", 0), 2) if row.get("price_book_ratio") else None,
                    "dividend_yield": round(row.get("dividend_yield_recent", 0), 2) if row.get("dividend_yield_recent") else None,
                    "perf_1y": round(row.get("Perf.Y", 0), 2) if row.get("Perf.Y") else None,
                    "roe": round(row.get("return_on_equity", 0), 2) if row.get("return_on_equity") else None,
                    "high_52w": row.get("price_52_week_high"),
                    "low_52w": row.get("price_52_week_low"),
                    "price": row.get("close"),
                    "change_pct": row.get("change"),
                })

            # Store successful response for fallback
            global _heatmap_cache
            _heatmap_cache["fallback"] = stocks

            logger.info(f"Fetched {len(stocks)} stocks with valid P/E data from TradingView")
            return stocks

        except HTTPError as e:
            logger.error(f"TradingView API HTTP error (attempt {attempt + 1}/{max_retries}): {e}")
            last_error = f"TradingView API error: {e.response.status_code if e.response else 'unknown'}"
        except RequestsConnectionError as e:
            logger.warning(f"Connection error (attempt {attempt + 1}/{max_retries}): {e}")
            last_error = "TradingView server unreachable"
        except Timeout as e:
            logger.warning(f"Timeout (attempt {attempt + 1}/{max_retries}): {e}")
            last_error = "TradingView API timeout"
        except RequestException as e:
            logger.error(f"Request error (attempt {attempt + 1}/{max_retries}): {e}")
            last_error = f"Request failed: {str(e)}"
        except ValueError as e:
            logger.error(f"Data parsing error (attempt {attempt + 1}/{max_retries}): {e}")
            last_error = f"Data parsing error: {str(e)}"
        except Exception as e:
            logger.exception(f"Unexpected error (attempt {attempt + 1}/{max_retries}): {e}")
            last_error = f"Internal error: {str(e)}"

        if attempt < max_retries - 1:
            time.sleep(1 * (attempt + 1))  # Exponential backoff

    # All retries failed - try fallback data
    fallback = _get_fallback_data()
    if fallback:
        logger.warning(f"Using fallback data ({len(fallback)} stocks) after {max_retries} failed attempts")
        return fallback

    raise HTTPException(status_code=503, detail=f"Failed to fetch stock data: {last_error}")


def _get_fallback_data() -> List[dict]:
    global _heatmap_cache
    return _heatmap_cache.get("fallback", [])


def _get_cached_data() -> List[dict]:
    now = datetime.now()
    if (
        _heatmap_cache["data"] is not None
        and _heatmap_cache["timestamp"] is not None
        and (now - _heatmap_cache["timestamp"]).total_seconds() < CACHE_TTL_SECONDS
    ):
        return _heatmap_cache["data"]

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
    stocks = _get_cached_data()

    if min_pe is not None:
        stocks = [s for s in stocks if s["pe_ratio"] >= min_pe]
    if max_pe is not None:
        stocks = [s for s in stocks if s["pe_ratio"] <= max_pe]
    if sector:
        stocks = [s for s in stocks if s["sector"] and sector.lower() in s["sector"].lower()]

    stocks = stocks[:limit]

    return {
        "stocks": stocks,
        "count": len(stocks),
        "cached": _heatmap_cache["timestamp"] is not None,
    }


@router.get("/api/heatmap/sectors")
async def get_sectors():
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

    sectors.sort(key=lambda x: x["count"], reverse=True)

    return {"sectors": sectors}


@router.post("/api/heatmap/refresh")
async def refresh_cache():
    global _heatmap_cache
    _heatmap_cache = {"data": None, "timestamp": None}
    data = _get_cached_data()
    return {"status": "refreshed", "count": len(data)}
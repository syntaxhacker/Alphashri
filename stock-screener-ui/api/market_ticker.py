"""
Market Ticker API - Live market data for indices and commodities.

Provides real-time prices for Nifty 50, Bank Nifty, Gold, Silver, USD/INR, and Crude Oil.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import datetime
import asyncio
import time
import math

router = APIRouter(prefix="/api/market-ticker", tags=["market-ticker"])


class TickerItem(BaseModel):
    """Single ticker item with price and change."""
    symbol: str
    name: str
    price: float
    change: float  # Absolute change
    change_percent: float  # Percentage change
    high: Optional[float] = None
    low: Optional[float] = None
    prev_close: Optional[float] = None
    timestamp: Optional[datetime] = None
    is_positive: bool = True
    error: Optional[str] = None
    source: str = "yahoo"  # Data source identifier
    update_time_ms: int = 0  # Time since last update
    last_updated: Optional[datetime] = None


class TickerResponse(BaseModel):
    """Response containing all ticker data."""
    tickers: Dict[str, TickerItem]
    timestamp: datetime
    cache_age_seconds: float = 0


def _get_previous_close(ticker, info: Optional[Dict[str, Any]] = None) -> float:
    """Get previous closing price for change calculation.

    Prefer provider fields first, then fallback to historical candles.
    """
    try:
        info = info or {}

        prev_from_info = info.get("regularMarketPreviousClose") or info.get("previousClose")
        if prev_from_info is not None:
            prev_val = float(prev_from_info)
            if math.isfinite(prev_val) and prev_val > 0:
                return prev_val

        # Need at least two candles to derive prior close.
        hist = ticker.history(period="5d")
        if hist is not None and not hist.empty:
            close = hist["Close"]
            if len(close) >= 2:
                return float(close.iloc[-2])
            return float(close.iloc[-1])
        return 0.0
    except Exception:
        return 0.0


async def fetch_ticker_data(symbol: str, name: str, yf_symbol: str) -> tuple[str, Dict[str, Any]]:
    """Fetch data for a single ticker using yfinance."""
    import yfinance as yf

    try:
        ticker = yf.Ticker(yf_symbol)
        info = ticker.info
        # Get current price
        current_price = info.get('currentPrice') or info.get('regularMarketPrice')
        if current_price is None:
            hist = ticker.history(period="1d")
            if hist is not None and not hist.empty:
                current_price = float(hist['Close'].iloc[-1])
        if current_price is None:
            return symbol, {"error": f"Could not fetch price for {symbol}", "source": "yahoo"}
        # Get previous close for change calculation
        prev_close = _get_previous_close(ticker, info)
        change = current_price - prev_close
        change_percent = (change / prev_close * 100) if prev_close != 0 else 0.0
        return symbol, {
            "symbol": symbol,
            "name": name,
            "price": round(current_price, 2),
            "change": round(change, 2),
            "change_percent": round(change_percent, 2),
            "high": info.get('dayHigh'),
            "low": info.get('dayLow'),
            "prev_close": round(prev_close, 2) if prev_close else None,
            "timestamp": datetime.now(),
            "is_positive": change >= 0,
            "source": "yahoo",
            "update_time_ms": 0,
            "last_updated": datetime.now()
        }
    except Exception as e:
        return symbol, {
            "symbol": symbol,
            "name": name,
            "error": str(e),
            "source": "yahoo"
        }


# Define ticker symbols (Yahoo Finance format)
TICKER_SYMBOLS = {
    "^NSEI": {"name": "Nifty 50", "yf_symbol": "^NSEI"},
    "^NSEBANK": {"name": "Bank Nifty", "yf_symbol": "^NSEBANK"},
    "GC=F": {"name": "Gold", "yf_symbol": "GC=F"},
    "SI=F": {"name": "Silver", "yf_symbol": "SI=F"},
    "USDINR=X": {"name": "USD/INR", "yf_symbol": "USDINR=X"},
    "CL=F": {"name": "Crude Oil", "yf_symbol": "CL=F"},
}

# Cache for ticker data
_ticker_cache: Dict[str, Dict[str, Any]] = {}
_cache_timestamp: float = 0
_CACHE_TTL_SECONDS: int = 30  # Cache expires after 30 seconds


async def get_all_tickers() -> Dict[str, TickerItem]:
    """Fetch all ticker data."""
    global _cache_timestamp

    now = time.time()
    cache_age = now - _cache_timestamp

    # Return cached data if still fresh
    if _ticker_cache and cache_age < _CACHE_TTL_SECONDS:
        return _ticker_cache
    # Fetch fresh data
    tasks = []
    for symbol, meta in TICKER_SYMBOLS.items():
        task = fetch_ticker_data(symbol, meta["name"], meta["yf_symbol"])
        tasks.append(task)
    # Wait for all tasks to complete
    results = await asyncio.gather(*tasks)
    # Process results
    tickers = {}
    for symbol, result in results:
            if "error" in result:
                tickers[symbol] = TickerItem(
                    symbol=result["symbol"],
                    name=result.get("name", TICKER_SYMBOLS[symbol]["name"]),
                    price=0,
                    change=0,
                    change_percent=0,
                    high=None,
                    low=None,
                    prev_close=None,
                    timestamp=datetime.now(),
                    is_positive=False,
                    error=result["error"],
                    source="yahoo",
                    update_time_ms=0,
                    last_updated=datetime.now()
                )
            else:
                tickers[symbol] = TickerItem(
                    symbol=result["symbol"],
                    name=result["name"],
                    price=result["price"],
                    change=result["change"],
                    change_percent=result["change_percent"],
                    high=result.get("high"),
                    low=result.get("low"),
                    prev_close=result.get("prev_close"),
                    timestamp=result.get("timestamp"),
                    is_positive=result["is_positive"],
                    error=None,
                    source=result["source"],
                    update_time_ms=result["update_time_ms"],
                    last_updated=result["last_updated"]
                )
    # Update cache
    _ticker_cache.clear()
    for k, v in tickers.items():
        _ticker_cache[k] = v.model_dump()
    _cache_timestamp = time.time()
    return tickers


@router.get("")
async def get_all_tickers_endpoint():
    """Get all market ticker data.
    Returns cached data if available, otherwise fetches fresh data.
    """
    tickers = await get_all_tickers()
    return TickerResponse(
        tickers=tickers,
        timestamp=datetime.now(),
        cache_age_seconds=time.time() - _cache_timestamp
    )


@router.get("/{symbol}")
async def get_ticker(symbol: str):
    """Get ticker data for a specific symbol."""
    if symbol not in TICKER_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")
    tickers = await get_all_tickers()
    if symbol not in tickers:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")
    return tickers[symbol]

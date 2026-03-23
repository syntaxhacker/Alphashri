"""
Sector API - FastAPI endpoints for sector-wise market analysis.

Aggregates data from TradingView to provide real-time sector performance,
technical strength, and top movers.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import asyncio
import pandas as pd
from datetime import datetime
import math
from tradingview_screener import Query as TVQuery, col

router = APIRouter(prefix="/api/sector", tags=["sector"])

class SectorItem(BaseModel):
    sector: str
    avg_change: float
    stock_count: int
    advances: int
    declines: int
    avg_rsi: float
    avg_adx: float
    top_movers: str

class StockMover(BaseModel):
    symbol: str
    change: float

class SectorResponse(BaseModel):
    sectors: List[SectorItem]
    top_stock_movers: List[StockMover]
    last_updated: datetime
    market: str

def _to_float(value, default=0.0):
    try:
        if value is None:
            return default
        out = float(value)
        if not math.isfinite(out):
            return default
        return out
    except Exception:
        return default

def _fetch_sector_data(market: str, limit: int) -> pd.DataFrame:
    """Synchronous TradingView query — must not be called directly in an async context."""
    query = TVQuery().select('name', 'close', 'change', 'sector', 'market_cap_basic', 'RSI', 'ADX')
    query = query.set_markets(market)

    if market == 'india':
        market_cap_filter = 5_000_000_000
        query = query.where(
            col('sector') != '',
            col('market_cap_basic') > market_cap_filter
        )
    else:
        query = query.where(col('sector') != '')

    query = query.order_by('market_cap_basic', ascending=False).limit(limit)

    _, df = query.get_scanner_data()
    return df


@router.get("", response_model=SectorResponse)
async def get_sector_performance(
    market: str = Query("india", enum=["india", "america"]),
    limit: int = Query(500, ge=100, le=1000)
):
    """
    Fetch latest stock data and aggregate by sector.
    Based on scanners/sector_dashboard.py logic.
    """
    try:
        df = await asyncio.to_thread(_fetch_sector_data, market, limit)

        if df.empty:
            return SectorResponse(sectors=[], top_stock_movers=[], last_updated=datetime.now(), market=market)

        # Deduplicate and calculate weighted average
        df_unique = df.drop_duplicates(subset=['name']).copy()
        
        # Calculate top 10 stock movers across all sectors
        top_stock_movers = []
        df_movers = df_unique.sort_values('change', ascending=False).head(10)
        for _, row in df_movers.iterrows():
            top_stock_movers.append(StockMover(
                symbol=row['name'],
                change=round(row['change'], 2)
            ))

        def aggregate_sector(group):
            total_mc = group['market_cap_basic'].sum()
            avg_change = (group['change'] * group['market_cap_basic']).sum() / total_mc if total_mc > 0 else 0
            advances = (group['change'] > 0).sum()
            declines = (group['change'] < 0).sum()
            avg_rsi = group['RSI'].mean()
            avg_adx = group['ADX'].mean()
            
            # Get top 3 movers
            top_3 = group.sort_values('change', ascending=False).head(3)
            movers = [f"{s['name']}({s['change']:+.1f}%)" for _, s in top_3.iterrows()]
            
            return pd.Series({
                'avg_change': round(avg_change, 2),
                'stock_count': len(group),
                'advances': int(advances),
                'declines': int(declines),
                'avg_rsi': round(avg_rsi, 1),
                'avg_adx': round(avg_adx, 1),
                'top_movers': " ".join(movers)
            })

        sector_agg = df_unique.groupby('sector', group_keys=False).apply(
            aggregate_sector, include_groups=False
        ).reset_index()
        
        # Sort by performance
        sector_agg = sector_agg.sort_values('avg_change', ascending=False)
        
        sectors = []
        for _, row in sector_agg.iterrows():
            sectors.append(SectorItem(
                sector=row['sector'],
                avg_change=row['avg_change'],
                stock_count=row['stock_count'],
                advances=row['advances'],
                declines=row['declines'],
                avg_rsi=row['avg_rsi'],
                avg_adx=row['avg_adx'],
                top_movers=row['top_movers']
            ))
            
        return SectorResponse(
            sectors=sectors,
            top_stock_movers=top_stock_movers,
            last_updated=datetime.now(),
            market=market
        )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

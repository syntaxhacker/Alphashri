"""
Sector API - FastAPI endpoints for sector-wise market analysis.

Aggregates data from TradingView to provide real-time sector performance,
technical strength, and top movers.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Optional, Any, Tuple
import asyncio
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from tradingview_screener import Query as TVQuery, col

from config import IST
from api.utils import _to_float

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


# ===== Sector Correlation & Rotation =====

# Sector index definitions
NIFTY_SECTOR_INDICES = [
    ("NIFTY 50", "NSE_INDEX|Nifty 50"),  # benchmark
    ("NIFTY BANK", "NSE_INDEX|Nifty Bank"),
    ("NIFTY IT", "NSE_INDEX|Nifty IT"),
    ("NIFTY FMCG", "NSE_INDEX|Nifty FMCG"),
    ("NIFTY PHARMA", "NSE_INDEX|Nifty Pharma"),
    ("NIFTY AUTO", "NSE_INDEX|Nifty Auto"),
    ("NIFTY ENERGY", "NSE_INDEX|Nifty Energy"),
    ("NIFTY REALTY", "NSE_INDEX|Nifty Realty"),
    ("NIFTY METAL", "NSE_INDEX|Nifty Metal"),
    ("NIFTY CONSUMPTION", "NSE_INDEX|Nifty Consumption"),
    ("NIFTY FIN_SERVICE", "NSE_INDEX|Nifty Financial Services"),
]

US_SECTOR_ETFS = [
    ("SPY", "SPY"),
    ("XLK", "XLK"),
    ("XLF", "XLF"),
    ("XLE", "XLE"),
    ("XLV", "XLV"),
    ("XLY", "XLY"),
    ("XLC", "XLC"),
    ("XLI", "XLI"),
    ("XLB", "XLB"),
    ("XLU", "XLU"),
    ("XLP", "XLP"),
]

# Cache setup
CACHE_DIR = Path(__file__).parent.parent / "experiments" / "data" / "sector_corr_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL_SECONDS = 300  # 5 minutes


def _make_cache_key(market: str, lookback_days: int) -> str:
    return f"{market}_{lookback_days}"


def _get_cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _get_cache_meta_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.meta"


def _read_cache(key: str) -> Optional[dict]:
    path = _get_cache_path(key)
    if not path.exists():
        return None
    try:
        meta_path = _get_cache_meta_path(key)
        if meta_path.exists():
            with open(meta_path, "r") as f:
                meta = json.load(f)
            if time.time() - meta.get("ts", 0) > CACHE_TTL_SECONDS:
                return None
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _write_cache(key: str, data: dict) -> None:
    with open(_get_cache_path(key), "w") as f:
        json.dump(data, f)
    with open(_get_cache_meta_path(key), "w") as f:
        json.dump({"ts": time.time()}, f)


def _get_instrument_key_map() -> Dict[str, str]:
    """Build mapping from index name to instrument key from cached NSE instruments file."""
    # The nse_instruments.json is in the parent project (upstox_trader/)
    instruments_path = Path(__file__).parent.parent.parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json"
    if not instruments_path.exists():
        return {}
    try:
        with open(instruments_path, "r") as f:
            instruments = json.load(f)
        mapping = {}
        for item in instruments:
            if item.get("segment") == "NSE_INDEX" and item.get("instrument_type") == "INDEX":
                name = item.get("name", "").strip()
                key = item.get("instrument_key", "")
                if name and key:
                    mapping[name] = key
        return mapping
    except Exception:
        return {}


async def _fetch_upstox_index_data(
    api, instrument_key: str, lookback_days: int
) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV data for an index using Upstox V3 API."""
    try:
        now = datetime.now(IST)
        to_date = now.strftime("%Y-%m-%d")
        from_date = (now - timedelta(days=lookback_days + 10)).strftime("%Y-%m-%d")

        url = f"https://api.upstox.com/v3/historical-candle/{instrument_key}/day/1/{from_date}/{to_date}"
        headers = api._get_headers()

        response = await asyncio.to_thread(
            lambda: requests.get(url, headers=headers, timeout=30)
        )
        response.raise_for_status()
        data = response.json()

        if data.get("status") != "success":
            return None

        candles = data.get("data", {}).get("candles", [])
        if not candles:
            return None

        df = pd.DataFrame(
            candles,
            columns=["timestamp", "open", "high", "low", "close", "volume"]
        )
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df.set_index("timestamp", inplace=True)
        df = df.sort_index()
        df = df.tail(lookback_days)
        return df

    except Exception:
        return None


async def _fetch_yfinance_data(
    symbol: str, lookback_days: int
) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV data using yfinance."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=f"{lookback_days}d", interval="1d")
        if df.empty:
            return None
        df.index = df.index.tz_localize(None) if df.index.tz else df.index
        df = df.rename(columns={"Close": "close"})
        return df[["close"]].dropna()
    except ImportError:
        return None
    except Exception:
        return None


async def _fetch_sector_data_for_market(
    market: str, lookback_days: int
) -> Dict[str, pd.DataFrame]:
    """
    Fetch daily close data for all sector indices/ETFs for a given market.
    Returns: { sector_name: DataFrame with 'close' column }
    """
    results: Dict[str, pd.DataFrame] = {}

    if market == "india":
        # Build instrument key map
        key_map = _get_instrument_key_map()
        try:
            from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
            from config import UPSTOX_API_KEY, UPSTOX_API_SECRET

            if not UPSTOX_API_KEY or not UPSTOX_API_SECRET:
                raise ImportError("Upstox credentials not configured")

            api = UpstoxAPI(
                api_key=UPSTOX_API_KEY,
                api_secret=UPSTOX_API_SECRET,
                quiet=True
            )
            if not api.instruments:
                api._download_and_cache_instruments()


            fallback_map = {
                "NIFTY 50": "^NSEI",
                "NIFTY BANK": "^NSEBANK",
                "NIFTY IT": "^CNXIT",
                "NIFTY FMCG": "^CNXFMCG",
                "NIFTY PHARMA": "^CNXPHARMA",
                "NIFTY AUTO": "^CNXAUTO",
                "NIFTY ENERGY": "^CNXENERGY",
                "NIFTY METAL": "^CNXMETAL",
                "NIFTY REALTY": "^CNXREALTY",
                "NIFTY CONSUMPTION": "^CNXCONSUM",
                "NIFTY FIN_SERVICE": "^CNXFIN",
            }
            for display_name, _ in NIFTY_SECTOR_INDICES:
                # Find matching instrument key
                instrument_key = None
                for k, v in key_map.items():
                    if k.upper() == display_name:
                        instrument_key = v
                        break

                df = None
                if instrument_key:
                    df = await _fetch_upstox_index_data(api, instrument_key, lookback_days)

                if df is not None and not df.empty and "close" in df.columns and len(df) >= 5:
                    results[display_name] = df
                else:
                    # Upstox failed or no instrument key — fallback to yfinance
                    yf_symbol = fallback_map.get(display_name)
                    if yf_symbol:
                        df = await _fetch_yfinance_data(yf_symbol, lookback_days)
                        if df is not None and not df.empty and len(df) >= 5:
                            results[display_name] = df

        except Exception:
            pass

    elif market == "america":
        for display_name, yf_symbol in US_SECTOR_ETFS:
            df = await _fetch_yfinance_data(yf_symbol, lookback_days)
            if df is not None and not df.empty and len(df) >= 5:
                results[display_name] = df

    return results


def _compute_correlation_matrix(
    dfs: Dict[str, pd.DataFrame]
) -> Tuple[Optional[List[List[float]]], Optional[List[str]]]:
    """Compute Pearson correlation matrix on daily returns."""
    if len(dfs) < 2:
        return None, None

    all_indices = None
    for df in dfs.values():
        if all_indices is None:
            all_indices = df.index
        else:
            all_indices = all_indices.intersection(df.index)

    if all_indices is None or len(all_indices) < 2:
        return None, None

    symbols = list(dfs.keys())
    close_matrix = np.column_stack([
        dfs[sym].loc[all_indices, "close"].values for sym in symbols
    ])

    returns = np.diff(np.log(close_matrix), axis=0)

    with np.errstate(invalid="ignore", divide="ignore"):
        corr_matrix = np.corrcoef(returns, rowvar=False)

    corr_matrix = np.nan_to_num(corr_matrix, nan=0.0)
    corr_list = [[round(float(v), 6) for v in row] for row in corr_matrix]

    return corr_list, symbols


def _compute_betas(
    dfs: Dict[str, pd.DataFrame], benchmark_name: str
) -> Dict[str, float]:
    """Compute beta of each sector vs benchmark."""
    if benchmark_name not in dfs:
        return {}

    benchmark_returns = np.diff(np.log(dfs[benchmark_name]["close"].values))
    betas = {}

    for name, df in dfs.items():
        if name == benchmark_name:
            betas[name] = 1.0
            continue
        try:
            sector_returns = np.diff(np.log(df["close"].values))
            min_len = min(len(sector_returns), len(benchmark_returns))
            s_ret = sector_returns[-min_len:]
            b_ret = benchmark_returns[-min_len:]
            cov = np.cov(s_ret, b_ret)[0, 1]
            var = np.var(b_ret)
            beta = round(float(cov / var), 3) if var > 0 else 0.0
            betas[name] = beta
        except Exception:
            betas[name] = 0.0

    return betas


def _compute_relative_strength(
    dfs: Dict[str, pd.DataFrame], benchmark_name: str
) -> Dict[str, Dict[str, float]]:
    """Compute relative strength vs benchmark for multiple timeframes.
    RS = (sector_return - benchmark_return) in percentage points.
    """
    if benchmark_name not in dfs:
        return {}

    benchmark_df = dfs[benchmark_name]
    b_close = benchmark_df["close"]

    def get_bench_prev(days: int) -> float:
        idx = -days - 1
        if abs(idx) > len(b_close):
            return b_close.iloc[0]
        return b_close.iloc[idx]

    b_current = b_close.iloc[-1]
    b_rs_5d = (b_current / get_bench_prev(5) - 1) * 100
    b_rs_1m = (b_current / get_bench_prev(22) - 1) * 100
    b_rs_3m = (b_current / get_bench_prev(66) - 1) * 100

    rs_data: Dict[str, Dict[str, float]] = {}
    for name, df in dfs.items():
        s_close = df["close"]
        try:
            s_current = s_close.iloc[-1]
            s_len = len(s_close)
            def _prev(close_series, n_len, days):
                idx = -days - 1
                return close_series.iloc[0] if abs(idx) > n_len else close_series.iloc[idx]

            s_rs_5d = (s_current / _prev(s_close, s_len, 5) - 1) * 100
            s_rs_1m = (s_current / _prev(s_close, s_len, 22) - 1) * 100
            s_rs_3m = (s_current / _prev(s_close, s_len, 66) - 1) * 100

            rs_data[name] = {
                "rs_5d": round(float(s_rs_5d - b_rs_5d), 2),
                "rs_1m": round(float(s_rs_1m - b_rs_1m), 2),
                "rs_3m": round(float(s_rs_3m - b_rs_3m), 2),
            }
        except Exception:
            rs_data[name] = {"rs_5d": 0.0, "rs_1m": 0.0, "rs_3m": 0.0}

    return rs_data


def _compute_ranks(
    rs_data: Dict[str, Dict[str, float]]
) -> Dict[str, Dict[str, int]]:
    """Compute current rank and rank change for each sector."""
    valid = {k: v for k, v in rs_data.items() if "rs_1m" in v}
    sorted_syms = sorted(valid.keys(), key=lambda s: valid[s]["rs_1m"], reverse=True)
    rank_current = {s: i + 1 for i, s in enumerate(sorted_syms)}

    # Rank change: compare current rank to 3M-based rank (proxy for "1M ago")
    sorted_3m = sorted(valid.keys(), key=lambda s: valid[s]["rs_3m"], reverse=True)
    rank_3m_ago = {s: i + 1 for i, s in enumerate(sorted_3m)}

    rank_change = {}
    for s in valid:
        change = rank_3m_ago.get(s, len(valid)) - rank_current.get(s, len(valid))
        rank_change[s] = change

    return {"current": rank_current, "change_1m": rank_change}


# Response models
class SectorCorrelationSector(BaseModel):
    name: str
    beta_vs_index: float
    relative_strength_5d: float
    relative_strength_1m: float
    relative_strength_3m: float
    rank_current: int
    rank_change_1m: int


class SectorCorrelationResponse(BaseModel):
    sectors: List[SectorCorrelationSector]
    correlation_matrix: List[List[float]]
    sector_names: List[str]
    last_updated: str


@router.get("/correlation", response_model=SectorCorrelationResponse)
async def get_sector_correlation(
    market: str = Query("india", enum=["india", "america"]),
    lookback_days: int = Query(90, ge=30, le=365)
):
    """
    Compute cross-sector correlations and relative strength metrics.

    Returns correlation matrix between major sector indices, beta vs benchmark,
    and relative strength rankings over multiple timeframes.
    """
    if market not in ("india", "america"):
        raise HTTPException(status_code=422, detail="Invalid market value")

    cache_key = _make_cache_key(market, lookback_days)
    cached = _read_cache(cache_key)
    if cached is not None:
        return SectorCorrelationResponse(**cached)

    dfs = await _fetch_sector_data_for_market(market, lookback_days)

    if not dfs or len(dfs) < 2:
        raise HTTPException(
            status_code=500,
            detail="Insufficient sector data available. Please try again later."
        )

    benchmark_name = "NIFTY 50" if market == "india" else "SPY"
    if benchmark_name not in dfs:
        benchmark_name = list(dfs.keys())[0]

    corr_matrix, sector_names = _compute_correlation_matrix(dfs)
    betas = _compute_betas(dfs, benchmark_name)
    rs_data = _compute_relative_strength(dfs, benchmark_name)
    ranks = _compute_ranks(rs_data)

    sectors_response = []
    for name in sector_names:
        sectors_response.append(SectorCorrelationSector(
            name=name,
            beta_vs_index=round(betas.get(name, 0.0), 3),
            relative_strength_5d=rs_data.get(name, {}).get("rs_5d", 0.0),
            relative_strength_1m=rs_data.get(name, {}).get("rs_1m", 0.0),
            relative_strength_3m=rs_data.get(name, {}).get("rs_3m", 0.0),
            rank_current=ranks["current"].get(name, 0),
            rank_change_1m=ranks["change_1m"].get(name, 0),
        ))

    sectors_response.sort(key=lambda s: s.rank_current)

    response_obj = SectorCorrelationResponse(
        sectors=sectors_response,
        correlation_matrix=corr_matrix or [],
        sector_names=sector_names,
        last_updated=datetime.now(IST).isoformat()
    )

    _write_cache(cache_key, response_obj.model_dump())
    return response_obj


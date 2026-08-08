"""
Correlation API — compute pairwise Pearson correlation of stock returns
and normalized price overlays for a set of symbols.
"""

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException

from config import IST, UPSTOX_API_KEY, UPSTOX_API_SECRET
from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
from api.utils import (
    make_cache_helpers,
    _compute_pearson_correlation_matrix,
)

import time  # kept for test patching (TTL expiry tests patch api.correlation.time); actual use is in api.utils

router = APIRouter(prefix="/api/correlation", tags=["correlation"])

CACHE_DIR = Path(__file__).parent.parent / "experiments" / "data" / "correlation_cache"
CACHE_TTL_SECONDS = 300  # 5 minutes


def _make_cache_key(symbols: list[str], timeframe: str, period: int, period_unit: str) -> str:
    sym = "_".join(sorted(s.upper() for s in symbols))
    return f"{sym}_{timeframe}_{period}_{period_unit}"


# Use factory to bind shared cache helpers (eliminates duplicate wrapper fns vs sector.py)
_get_cache_path, _get_cache_meta_path, _read_cache, _write_cache = make_cache_helpers(
    CACHE_DIR, CACHE_TTL_SECONDS
)


# ===== Data fetching =====

async def _fetch_symbol_data(
    api, symbol: str, timeframe: str, period: int, period_unit: str
) -> Optional[pd.DataFrame]:
    """Fetch OHLCV data for a single symbol."""
    try:
        now = datetime.now(IST)
        to_date = now.strftime("%Y-%m-%d")
        if period_unit == "days":
            from_date = (now - timedelta(days=period)).strftime("%Y-%m-%d")
        else:
            from_date = (now - timedelta(minutes=period)).strftime("%Y-%m-%d")

        chart_unit = "days" if timeframe == "daily" else "minutes"
        df = await asyncio.to_thread(
            api.fetch_historical_data_v3,
            symbol=symbol,
            unit=chart_unit,
            interval=1,
            from_date=from_date,
            to_date=to_date,
        )
        if timeframe == "intraday" and (df is None or df.empty):
            df = await asyncio.to_thread(
                api.fetch_intraday_data_v3,
                symbol=symbol,
                interval="1",
            )
        return df
    except Exception:
        return None


# ===== Correlation computation =====

def _compute_correlation(
    dfs: dict[str, pd.DataFrame],
) -> tuple[Optional[list[list[float]]], Optional[list[str]], Optional[dict[str, list[dict]]], Optional[dict]]:
    """
    Compute Pearson correlation matrix on close-to-close returns
    and normalized price series for overlay chart.

    Returns: (matrix, symbols, normalized, meta) or (None, None, None, None) on failure.
    """
    if not dfs:
        return None, None, None, None

    valid_symbols = [s for s, df in dfs.items() if df is not None and not df.empty and "close" in df.columns]
    if len(valid_symbols) < 2:
        if len(valid_symbols) == 1:
            s = valid_symbols[0]
            df = dfs[s]
            idx = df.index
            start_date = idx[0].isoformat() if hasattr(idx[0], "isoformat") else str(idx[0])
            end_date = idx[-1].isoformat() if hasattr(idx[-1], "isoformat") else str(idx[-1])
            normalized = {
                s: [
                    {"timestamp": (i.isoformat() if hasattr(i, "isoformat") else str(i)),
                     "value": round((v / df["close"].iloc[0] - 1) * 100, 4)}
                    for i, v in zip(idx, df["close"])
                ]
            }
            return [[1.0]], [s], normalized, {
                "start_date": start_date,
                "end_date": end_date,
                "data_points": len(df),
            }
        return None, None, None, None

    # Use shared implementation for alignment + corr matrix (dedups vs sector.py)
    corr_list, _, all_indices = _compute_pearson_correlation_matrix(
        {s: dfs[s] for s in valid_symbols}
    )
    if corr_list is None or all_indices is None:
        return None, None, None, None

    all_dfs = [dfs[s] for s in valid_symbols]

    normalized = {}
    for s, df in zip(valid_symbols, all_dfs):
        df_aligned = df.loc[all_indices]
        base = df_aligned["close"].iloc[0]
        normalized[s] = [
            {
                "timestamp": (i.isoformat() if hasattr(i, "isoformat") else str(i)),
                "value": round((v / base - 1) * 100, 4),
            }
            for i, v in zip(all_indices, df_aligned["close"])
        ]

    start_date = all_indices[0].isoformat() if hasattr(all_indices[0], "isoformat") else str(all_indices[0])
    end_date = all_indices[-1].isoformat() if hasattr(all_indices[-1], "isoformat") else str(all_indices[-1])

    meta = {
        "start_date": start_date,
        "end_date": end_date,
        "data_points": len(all_indices),
    }

    return corr_list, valid_symbols, normalized, meta


# ===== Endpoint =====

@router.post("/")
async def compute_correlation(body: dict):
    symbols = body.get("symbols", [])
    timeframe = body.get("timeframe", "daily")
    period = body.get("period", 30)
    period_unit = body.get("period_unit", "days")

    if not symbols:
        raise HTTPException(status_code=400, detail="symbols list must not be empty")

    if timeframe not in ("daily", "intraday"):
        raise HTTPException(status_code=400, detail="timeframe must be 'daily' or 'intraday'")

    if period_unit not in ("days", "minutes"):
        raise HTTPException(status_code=400, detail="period_unit must be 'days' or 'minutes'")

    if not isinstance(period, (int, float)) or period <= 0:
        raise HTTPException(status_code=400, detail="period must be a positive number")

    symbols = [s.strip().upper() for s in symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail="symbols list must not be empty after cleaning")

    cache_key = _make_cache_key(symbols, timeframe, int(period), period_unit)
    cached = _read_cache(cache_key)
    if cached is not None:
        cached["cached"] = True
        return cached

    if not UPSTOX_API_KEY or not UPSTOX_API_SECRET:
        raise HTTPException(status_code=500, detail="Upstox API credentials not configured")

    try:
        api = UpstoxAPI(api_key=UPSTOX_API_KEY, api_secret=UPSTOX_API_SECRET, quiet=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize API: {str(e)}")

    fetch_tasks = [
        _fetch_symbol_data(api, sym, timeframe, int(period), period_unit)
        for sym in symbols
    ]
    results = await asyncio.gather(*fetch_tasks)

    dfs = {sym: df for sym, df in zip(symbols, results)}

    matrix, valid_symbols, normalized, meta = _compute_correlation(dfs)

    if matrix is None:
        return {
            "matrix": [],
            "symbols": [],
            "normalized": {},
            "meta": {"start_date": None, "end_date": None, "data_points": 0},
            "cached": False,
            "warning": "Insufficient overlapping data to compute correlation",
        }

    response = {
        "matrix": matrix,
        "symbols": valid_symbols,
        "normalized": normalized,
        "meta": meta,
        "cached": False,
    }

    _write_cache(cache_key, response)

    return response

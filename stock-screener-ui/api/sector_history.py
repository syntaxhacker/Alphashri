"""Long-horizon sector history from real index/ETF daily closes.

Endpoint: ``GET /api/sector/history?market=india|america&years=5``.
Monthly returns, ranks, risk, seasonality and rank persistence are derived
from the same index/ETF price series used by the sector correlation endpoint.
"""

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config import IST
from api.sector import (
    NIFTY_SECTOR_INDICES,
    US_SECTOR_ETFS,
    _fetch_upstox_index_data,
    _get_instrument_key_map,
)
from api.utils import make_cache_helpers

router = APIRouter(prefix="/api/sector", tags=["sector"])

CACHE_DIR = (
    Path(__file__).parent.parent
    / "experiments"
    / "data"
    / "sector_history_cache"
)
CACHE_TTL_SECONDS = 86400

_get_cache_path, _get_cache_meta_path, _read_cache, _write_cache = make_cache_helpers(
    CACHE_DIR, CACHE_TTL_SECONDS
)

DISCLAIMER = (
    "Monthly history. Sample size per calendar month is shown. "
    "Historical context, not a forecast."
)

NIFTY_YF_FALLBACK = {
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


class SectorHistorySeries(BaseModel):
    name: str
    is_benchmark: bool
    monthly_returns: List[Optional[float]]
    ranks: List[Optional[int]]


class SectorHistoryRisk(BaseModel):
    name: str
    max_drawdown: Optional[float]
    current_drawdown: Optional[float]
    recovery_days: Optional[int]
    sharpe: Optional[float]
    volatility: Optional[float]


class SectorHistorySeasonalityItem(BaseModel):
    name: str
    month: int
    avg_return: Optional[float]
    hit_rate: Optional[float]
    n: int


class SectorHistoryPersistenceItem(BaseModel):
    name: str
    top3_months: int
    top3_stayed: int
    top3_persistence_pct: Optional[float]
    avg_next_rank: Optional[float]


class SectorHistoryPersistence(BaseModel):
    by_sector: List[SectorHistoryPersistenceItem]
    transition_matrix: List[List[Optional[float]]]


class SectorHistoryResponse(BaseModel):
    market: str
    years: int
    cached: bool = False
    months: List[str]
    as_of: str
    last_updated: str
    source: str
    disclaimer: str
    universe: List[str]
    series: List[SectorHistorySeries]
    risk: List[SectorHistoryRisk]
    seasonality: List[SectorHistorySeasonalityItem]
    persistence: SectorHistoryPersistence


def _round_or_none(value: Any, digits: int = 2) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return round(number, digits)


def _rank_or_none(value: Any) -> Optional[int]:
    number = _round_or_none(value, 0)
    return int(number) if number is not None else None


def _month_end_closes(close: pd.Series) -> pd.Series:
    """Last close per month, excluding the in-progress calendar month."""
    series = pd.to_numeric(close, errors="coerce").dropna()
    if series.empty:
        return pd.Series(dtype=float)
    series = series.sort_index()
    index = pd.DatetimeIndex(series.index)
    if index.tz is not None:
        index = index.tz_convert(IST).tz_localize(None)
    periods = index.to_period("M")
    closes = series.groupby(periods).last()
    current_period = pd.Timestamp.now(tz=IST).tz_localize(None).to_period("M")
    return closes[closes.index < current_period]


def _monthly_returns(closes: pd.Series) -> pd.Series:
    return closes.pct_change(fill_method=None) * 100


def _rank_frame(returns: pd.DataFrame, universe: List[str]) -> pd.DataFrame:
    return returns[universe].rank(axis=1, ascending=False, method="min")


def _risk_metrics(close: pd.Series) -> Dict[str, Optional[float]]:
    series = pd.to_numeric(close, errors="coerce").dropna()
    series = series[series > 0].sort_index()
    if series.empty:
        return {
            "max_drawdown": None,
            "current_drawdown": None,
            "recovery_days": None,
            "sharpe": None,
            "volatility": None,
        }

    running_max = series.cummax()
    drawdown = series / running_max - 1.0
    trough_ts = drawdown.idxmin()
    peak_value = float(running_max.loc[trough_ts])

    after_trough = series.loc[trough_ts:].iloc[1:]
    recovered = after_trough[after_trough >= peak_value]
    recovery_days = (
        int((recovered.index[0] - trough_ts).days) if len(recovered) else None
    )

    daily = series.pct_change().dropna()
    std = float(daily.std(ddof=1)) if len(daily) > 1 else float("nan")
    mean = float(daily.mean()) if len(daily) else float("nan")
    sharpe = (
        float(round(mean / std * np.sqrt(252), 2))
        if np.isfinite(std) and std > 0
        else None
    )
    volatility = (
        float(round(std * np.sqrt(252) * 100, 2)) if np.isfinite(std) else None
    )

    return {
        "max_drawdown": _round_or_none(drawdown.min() * 100),
        "current_drawdown": _round_or_none(drawdown.iloc[-1] * 100),
        "recovery_days": recovery_days,
        "sharpe": sharpe,
        "volatility": volatility,
    }


def _seasonality(returns: pd.Series) -> List[Dict[str, Any]]:
    values = returns.dropna()
    groups = {month: group for month, group in values.groupby(values.index.month)}
    items: List[Dict[str, Any]] = []
    for month in range(1, 13):
        group = groups.get(month)
        if group is None or group.empty:
            items.append(
                {"month": month, "avg_return": None, "hit_rate": None, "n": 0}
            )
            continue
        items.append(
            {
                "month": month,
                "avg_return": _round_or_none(group.mean()),
                "hit_rate": _round_or_none((group > 0).mean() * 100),
                "n": int(len(group)),
            }
        )
    return items


def _sector_persistence(ranks: pd.Series) -> Dict[str, Any]:
    next_ranks = ranks.shift(-1)
    paired = ranks.notna() & next_ranks.notna()
    in_top3 = ranks <= 3
    top3_pairs = in_top3 & paired
    top3_stayed = int((next_ranks[top3_pairs] <= 3).sum())
    top3_denominator = int(top3_pairs.sum())

    return {
        "top3_months": int(in_top3.sum()),
        "top3_stayed": top3_stayed,
        "top3_persistence_pct": (
            _round_or_none(top3_stayed / top3_denominator * 100)
            if top3_denominator
            else None
        ),
        "avg_next_rank": (
            _round_or_none(next_ranks[paired].mean()) if paired.any() else None
        ),
    }


def _transition_matrix(ranks: pd.DataFrame, size: int) -> List[List[Optional[float]]]:
    counts = np.zeros((size, size), dtype=float)
    for name in ranks.columns:
        pairs = pd.DataFrame(
            {"current": ranks[name], "next": ranks[name].shift(-1)}
        ).dropna()
        for current, nxt in zip(pairs["current"], pairs["next"]):
            counts[int(current) - 1, int(nxt) - 1] += 1

    matrix: List[List[Optional[float]]] = []
    for row in counts:
        total = float(row.sum())
        if total:
            matrix.append(
                [float(round(float(value) / total * 100, 2)) for value in row]
            )
        else:
            matrix.append([None] * size)
    return matrix


def _normalize_daily_frame(df: pd.DataFrame) -> pd.DataFrame:
    index = pd.DatetimeIndex(df.index)
    if index.tz is not None:
        index = index.tz_convert(IST)
    index = index.normalize()
    close = pd.to_numeric(df["close"], errors="coerce")
    frame = pd.DataFrame({"close": close.to_numpy()}, index=index)
    frame = frame[~frame.index.duplicated(keep="last")]
    return frame.sort_index().dropna()


def _build_upstox_client():
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    from config import UPSTOX_API_KEY, UPSTOX_API_SECRET

    if not UPSTOX_API_KEY or not UPSTOX_API_SECRET:
        return None
    api = UpstoxAPI(
        api_key=UPSTOX_API_KEY,
        api_secret=UPSTOX_API_SECRET,
        quiet=True,
    )
    if not api.instruments:
        api._download_and_cache_instruments()
    return api


async def _fetch_yfinance_history(
    symbol: str, years: int
) -> Optional[pd.DataFrame]:
    def _load() -> Optional[pd.DataFrame]:
        import yfinance as yf

        end = datetime.now(IST) + timedelta(days=1)
        start = end - timedelta(days=years * 365 + 10)
        df = yf.Ticker(symbol).history(
            start=start.date().isoformat(),
            end=end.date().isoformat(),
            interval="1d",
        )
        if df is None or df.empty or "Close" not in df.columns:
            return None
        return df.rename(columns={"Close": "close"})[["close"]]

    try:
        df = await asyncio.to_thread(_load)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    return _normalize_daily_frame(df)


async def _fetch_india_history(years: int) -> Dict[str, pd.DataFrame]:
    lookback_days = years * 365 + 10
    key_map = await asyncio.to_thread(_get_instrument_key_map)
    upper_keys = {name.upper(): key for name, key in key_map.items()}

    try:
        api = await asyncio.to_thread(_build_upstox_client)
    except Exception:
        api = None

    results: Dict[str, pd.DataFrame] = {}
    for display_name, _ in NIFTY_SECTOR_INDICES:
        df = None
        instrument_key = upper_keys.get(display_name)
        if api is not None and instrument_key:
            df = await _fetch_upstox_index_data(api, instrument_key, lookback_days)
            if df is not None and not df.empty:
                df = _normalize_daily_frame(df)

        if df is None or df.empty:
            yf_symbol = NIFTY_YF_FALLBACK.get(display_name)
            if yf_symbol:
                df = await _fetch_yfinance_history(yf_symbol, years)

        if df is not None and not df.empty:
            results[display_name] = df
    return results


async def _fetch_us_history(years: int) -> Dict[str, pd.DataFrame]:
    results: Dict[str, pd.DataFrame] = {}
    for display_name, yf_symbol in US_SECTOR_ETFS:
        df = await _fetch_yfinance_history(yf_symbol, years)
        if df is not None and not df.empty:
            results[display_name] = df
    return results


async def _fetch_history_data(market: str, years: int) -> Dict[str, pd.DataFrame]:
    if market == "india":
        return await _fetch_india_history(years)
    return await _fetch_us_history(years)


def _build_history_payload(
    market: str, years: int, closes: Dict[str, pd.DataFrame]
) -> Optional[SectorHistoryResponse]:
    definitions = NIFTY_SECTOR_INDICES if market == "india" else US_SECTOR_ETFS
    ordered = [name for name, _ in definitions]
    benchmark = ordered[0]

    monthly: Dict[str, pd.Series] = {}
    daily: Dict[str, pd.Series] = {}
    for name in ordered:
        df = closes.get(name)
        if df is None or df.empty or "close" not in df.columns:
            continue
        normalized = _normalize_daily_frame(df)
        if normalized.empty:
            continue
        month_close = _month_end_closes(normalized["close"])
        if len(month_close) >= 2:
            monthly[name] = month_close
            daily[name] = normalized["close"]

    if not monthly:
        return None

    month_index = pd.PeriodIndex(
        sorted({period for series in monthly.values() for period in series.index}),
        freq="M",
    )
    close_frame = pd.DataFrame(
        {name: series.reindex(month_index) for name, series in monthly.items()},
        index=month_index,
    )
    returns = pd.DataFrame(
        {name: _monthly_returns(close_frame[name]) for name in close_frame.columns},
        index=month_index,
    )

    universe = [
        name
        for name in ordered
        if name != benchmark
        and name in returns.columns
        and bool(returns[name].notna().any())
    ]
    if len(universe) < 2 or len(month_index) < 13:
        return None

    rank_frame = _rank_frame(returns, universe)
    series_names = [name for name in ordered if name in monthly]

    series_items: List[SectorHistorySeries] = []
    for name in series_names:
        is_benchmark = name == benchmark
        series_items.append(
            SectorHistorySeries(
                name=name,
                is_benchmark=is_benchmark,
                monthly_returns=[
                    _round_or_none(value) for value in returns[name]
                ],
                ranks=(
                    [None] * len(month_index)
                    if is_benchmark
                    else [_rank_or_none(value) for value in rank_frame[name]]
                ),
            )
        )

    risk_items = [
        SectorHistoryRisk(name=name, **_risk_metrics(daily[name]))
        for name in series_names
    ]

    seasonality_items: List[SectorHistorySeasonalityItem] = []
    for name in universe:
        for item in _seasonality(returns[name]):
            seasonality_items.append(
                SectorHistorySeasonalityItem(name=name, **item)
            )

    persistence_items = [
        SectorHistoryPersistenceItem(
            name=name, **_sector_persistence(rank_frame[name])
        )
        for name in universe
    ]

    return SectorHistoryResponse(
        market=market,
        years=years,
        cached=False,
        months=[str(period) for period in month_index],
        as_of=month_index[-1].to_timestamp(how="end").strftime("%Y-%m-%d"),
        last_updated=datetime.now(IST).isoformat(),
        source="NIFTY sector indices" if market == "india" else "US sector ETFs",
        disclaimer=DISCLAIMER,
        universe=universe,
        series=series_items,
        risk=risk_items,
        seasonality=seasonality_items,
        persistence=SectorHistoryPersistence(
            by_sector=persistence_items,
            transition_matrix=_transition_matrix(
                rank_frame[universe], len(universe)
            ),
        ),
    )


@router.get(
    "/history",
    response_model=SectorHistoryResponse,
    summary="Long-horizon sector history",
)
async def get_sector_history(
    market: str = Query("india", pattern="^(india|america)$"),
    years: int = Query(5, ge=1, le=10),
):
    """Monthly sector history, risk, seasonality and rank persistence."""
    cache_key = f"{market}_{years}"
    cached = _read_cache(cache_key)
    if cached is not None:
        return SectorHistoryResponse(**cached).model_copy(
            update={"cached": True}
        )

    try:
        closes = await _fetch_history_data(market, years)
    except Exception:
        closes = {}

    payload = _build_history_payload(market, years, closes)
    if payload is None:
        raise HTTPException(status_code=503, detail="sector_history_unavailable")

    _write_cache(cache_key, payload.model_dump())
    return payload

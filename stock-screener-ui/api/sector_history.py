"""Long-horizon sector history from real index/ETF daily closes.

Endpoint: ``GET /api/sector/history?market=india|america&years=5``.
Monthly returns, ranks, risk, seasonality and rank persistence are derived
from the same index/ETF price series used by the sector correlation endpoint.

Fetching/normalisation lives in :mod:`api.market_history`; the canonical
sector universe lives in :mod:`api.sector_universe`.  This module owns the
response models, analytics, payload assembly and the HTTP route.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from config import IST
from api.market_history import (
    HistoryData,
    _fetch_upstox_index_data,
    _get_instrument_key_map,
    fetch_market_history,
    normalize_daily_frame,
    source_summary,
)
from api.sector_universe import (
    BENCHMARK_BY_MARKET,
    DESCRIPTORS_BY_MARKET,
    NIFTY_SECTOR_INDICES,
    NIFTY_YF_FALLBACK,
    US_SECTOR_ETFS,
    YF_FALLBACK_BY_MARKET,
)
from api.utils import finite_or_none, make_cache_helpers

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sector", tags=["sector"])

CACHE_DIR = (
    Path(__file__).parent.parent
    / "experiments"
    / "data"
    / "sector_history_cache"
)
CACHE_TTL_SECONDS = 86400
#: Bump whenever the persisted payload shape/semantics change; old files then
#: miss (and are validated again) instead of being served with stale fields.
CACHE_SCHEMA_VERSION = 2

_cache_helpers = make_cache_helpers(CACHE_DIR, CACHE_TTL_SECONDS)
_get_cache_path, _get_cache_meta_path, _read_cache, _write_cache = _cache_helpers
_read_stale_cache = _cache_helpers.read_stale

DISCLAIMER = (
    "Monthly history. Sample size per calendar month is shown. "
    "Historical context, not a forecast."
)

#: A non-benchmark needs a real history before it can influence ranks.
MIN_UNIVERSE_RETURNS = 12
MIN_UNIVERSE_MONTH_COVERAGE = 0.60
#: A month is only ranked when at least this share of the universe has a
#: return; short/partial series must not silently shrink the comparison set.
MIN_RANK_MONTH_COVERAGE = 0.80
#: Only persist a market snapshot when most expected proxies were fetched.
MIN_CACHE_SERIES_COVERAGE = 0.80

# Compatibility aliases for callers that imported these from this module.
_normalize_daily_frame = normalize_daily_frame


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
    #: Exact number of observed month-to-month rank pairs behind the matrix.
    transition_n: int = 0


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
    number = finite_or_none(value)
    if number is None:
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


def _rank_frame(
    returns: pd.DataFrame,
    universe: List[str],
    min_coverage: Optional[float] = MIN_RANK_MONTH_COVERAGE,
) -> pd.DataFrame:
    """Rank each month, nulling rows with insufficient universe coverage."""
    if not universe:
        return pd.DataFrame(index=returns.index)

    frame = returns.reindex(columns=universe)
    ranks = frame.rank(axis=1, ascending=False, method="min")
    if min_coverage is not None and universe:
        required = float(len(universe)) * float(min_coverage)
        enough = frame.notna().sum(axis=1) >= required
        ranks = ranks.where(enough, np.nan)
    return ranks


def _qualifies_for_universe(
    returns: pd.DataFrame,
    name: str,
    total_months: int,
    history_returns: Optional[pd.DataFrame] = None,
) -> bool:
    """Require >=12 observed returns and >=60% window coverage.

    ``history_returns`` (the untrimmed frame) proves the series is old enough;
    ``returns`` is the requested window whose coverage must not be sparse.
    """
    if name not in returns.columns or total_months <= 0:
        return False
    history = history_returns if history_returns is not None else returns
    if name not in history.columns or name not in returns.columns:
        return False
    observed = int(history[name].notna().sum())
    if observed < MIN_UNIVERSE_RETURNS:
        return False
    window_observed = int(returns[name].notna().sum())
    return window_observed / float(total_months) >= MIN_UNIVERSE_MONTH_COVERAGE


def _drop_in_progress_bar(series: pd.Series) -> pd.Series:
    """Drop today's IST bar: the session is still forming for risk metrics."""
    if series.empty or not isinstance(series.index, pd.DatetimeIndex):
        return series
    index = series.index
    if index.tz is not None:
        index = index.tz_convert(IST).tz_localize(None)
    cutoff = pd.Timestamp.now(tz=IST).tz_localize(None).normalize()
    return series[index.normalize() < cutoff]


def _risk_metrics(close: pd.Series) -> Dict[str, Optional[float]]:
    series = pd.to_numeric(close, errors="coerce").dropna()
    series = _drop_in_progress_bar(series[series > 0].sort_index())
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

    daily = series.pct_change(fill_method=None).dropna()
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


def _transition_sample_size(ranks: pd.DataFrame) -> int:
    """Count observed adjacent rank pairs (the matrix denominator)."""
    total = 0
    for name in ranks.columns:
        pairs = ranks[name].notna() & ranks[name].shift(-1).notna()
        total += int(pairs.sum())
    return total


async def _fetch_history_data(
    market: str, years: int, force: bool = False
) -> HistoryData:
    """Compatibility wrapper around the shared market-history fetcher."""
    return await fetch_market_history(market, years, force=force)


def _generic_source(market: str) -> str:
    return "NIFTY sector indices" if market == "india" else "US sector ETFs"


def _build_history_payload(
    market: str,
    years: int,
    closes: Dict[str, pd.DataFrame],
    sources: Optional[Dict[str, str]] = None,
) -> Optional[SectorHistoryResponse]:
    definitions = DESCRIPTORS_BY_MARKET.get(market)
    if not definitions:
        return None
    ordered = [descriptor.display for descriptor in definitions]
    benchmark = BENCHMARK_BY_MARKET[market]

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

    full_month_index = pd.PeriodIndex(
        sorted({period for series in monthly.values() for period in series.index}),
        freq="M",
    )
    if len(full_month_index) < 13:
        return None
    close_frame = pd.DataFrame(
        {
            name: series.reindex(full_month_index)
            for name, series in monthly.items()
        },
        index=full_month_index,
    )
    full_returns = pd.DataFrame(
        {name: _monthly_returns(close_frame[name]) for name in close_frame.columns},
        index=full_month_index,
    )

    # Returns are computed before trimming so the first displayed month keeps
    # its return against the prior close; only the payload window is trimmed.
    max_months = max(1, int(years) * 12)
    month_index = full_month_index[-max_months:]
    returns = full_returns.iloc[-max_months:]

    universe = [
        name
        for name in ordered
        if name != benchmark
        and _qualifies_for_universe(
            returns, name, len(month_index), history_returns=full_returns
        )
    ]
    if len(universe) < 2:
        return None

    rank_frame = _rank_frame(returns, universe)
    series_names = [name for name in ordered if name in monthly]

    series_items: List[SectorHistorySeries] = []
    for name in series_names:
        is_benchmark = name == benchmark
        if is_benchmark or name not in rank_frame.columns:
            ranks: List[Optional[int]] = [None] * len(month_index)
        else:
            ranks = [_rank_or_none(value) for value in rank_frame[name]]
        series_items.append(
            SectorHistorySeries(
                name=name,
                is_benchmark=is_benchmark,
                monthly_returns=[
                    _round_or_none(value) for value in returns[name]
                ],
                ranks=ranks,
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

    resolved_sources = (
        sources if sources is not None else getattr(closes, "sources", None)
    )
    source = (
        source_summary(market, resolved_sources)
        if resolved_sources
        else _generic_source(market)
    )

    return SectorHistoryResponse(
        market=market,
        years=years,
        cached=False,
        months=[str(period) for period in month_index],
        as_of=month_index[-1].to_timestamp(how="end").strftime("%Y-%m-%d"),
        last_updated=datetime.now(IST).isoformat(),
        source=source,
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
            transition_n=_transition_sample_size(rank_frame[universe]),
        ),
    )


def _cache_key(market: str, years: int) -> str:
    return f"v{CACHE_SCHEMA_VERSION}_{market}_{years}"


def _load_cached_payload(
    key: str,
    market: str,
    years: int,
    *,
    stale: bool = False,
) -> Optional[SectorHistoryResponse]:
    """Read + validate a cache entry; any schema mismatch falls back to a miss."""
    raw = _read_stale_cache(key) if stale else _read_cache(key)
    if raw is None:
        return None
    try:
        payload = SectorHistoryResponse.model_validate(raw)
    except Exception:
        logger.warning("Ignoring invalid sector history cache entry %s", key)
        return None
    if payload.market != market or payload.years != years:
        logger.warning("Ignoring mismatched sector history cache entry %s", key)
        return None
    return payload.model_copy(update={"cached": True})


def _coverage_is_adequate(payload: SectorHistoryResponse, market: str) -> bool:
    expected = len(DESCRIPTORS_BY_MARKET.get(market, ()))
    benchmark = BENCHMARK_BY_MARKET.get(market)
    series_names = {series.name for series in payload.series}
    if expected == 0 or len(payload.universe) < 2 or not benchmark:
        return False
    if benchmark not in series_names:
        return False
    complete = sum(
        1
        for series in payload.series
        if sum(value is not None for value in series.monthly_returns)
        >= MIN_UNIVERSE_RETURNS
    )
    return complete / float(expected) >= MIN_CACHE_SERIES_COVERAGE


@router.get(
    "/history",
    response_model=SectorHistoryResponse,
    summary="Long-horizon sector history",
)
async def get_sector_history(
    market: str = Query("india", pattern="^(india|america)$"),
    years: int = Query(5, ge=1, le=10),
    force: bool = Query(False, description="Bypass the daily cache and refetch"),
):
    """Monthly sector history, risk, seasonality and rank persistence."""
    cache_key = _cache_key(market, years)
    if not force:
        cached = _load_cached_payload(cache_key, market, years)
        if cached is not None:
            return cached

    payload: Optional[SectorHistoryResponse] = None
    try:
        closes = await _fetch_history_data(market, years, force=force)
        payload = _build_history_payload(market, years, closes)
    except Exception:
        logger.warning(
            "Sector history fetch failed for %s/%sY", market, years, exc_info=True
        )

    if payload is not None and _coverage_is_adequate(payload, market):
        try:
            _write_cache(cache_key, payload.model_dump())
        except Exception:
            logger.warning("Sector history cache write failed for %s", cache_key)
        return payload

    # A failed or partial refresh must not replace/serve a degraded snapshot
    # for a day: fall back to the last complete cache regardless of TTL.
    stale = _load_cached_payload(cache_key, market, years, stale=True)
    if stale is not None:
        return stale

    if payload is not None:
        # Partial but still useful: serve live without persisting it.
        return payload

    raise HTTPException(status_code=503, detail="sector_history_unavailable")

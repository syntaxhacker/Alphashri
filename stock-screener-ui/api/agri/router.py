"""Agri-commodity mandi prices — read-only HTTP surface.

Prices come from the local SQLite cache built by ``scripts/market/agri_import.py``
from the Agmarknet CKAN mirror. A missing cache is reported as
``data_source="empty"``; it is never presented as a successful load.
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

import config

from . import aggregate, registry, store
from .contract import (
    MAX_COMPARE,
    RANGES,
    AppliedFilters,
    CommoditiesResponse,
    FiltersPayload,
    Kpis,
    PricesResponse,
)

router = APIRouter(prefix="/api/agri", tags=["agri"])
logger = logging.getLogger("agri.router")

DB_PATH: Optional[Path] = None
DATA_SOURCE_EMPTY: str = "empty"
_DATA_SOURCE_CKAN: str = registry.SOURCE_CKAN
_HISTORY_LOOKBACK_DAYS: int = 400
_PRICES_CACHE_TTL: float = 60.0
_PRICES_CACHE_MAX: int = 64
_PRICES_CACHE: dict[tuple[Any, ...], tuple[float, PricesResponse]] = {}


def _reader() -> Optional[Any]:
    return store.open_reader(DB_PATH)


def _cache_get(cache_key: tuple[Any, ...]) -> Optional[PricesResponse]:
    entry = _PRICES_CACHE.get(cache_key)
    if entry is None:
        return None
    expires_at, response = entry
    if expires_at < time.monotonic():
        _PRICES_CACHE.pop(cache_key, None)
        return None
    return response


def _cache_put(cache_key: tuple[Any, ...], response: PricesResponse) -> None:
    if len(_PRICES_CACHE) >= _PRICES_CACHE_MAX:
        _PRICES_CACHE.pop(next(iter(_PRICES_CACHE)))
    _PRICES_CACHE[cache_key] = (time.monotonic() + _PRICES_CACHE_TTL, response)


def _as_of_options(conn: Optional[Any]) -> dict[str, Any]:
    if conn is None:
        return {"as_of": None, "states": [], "districts": [], "markets": []}
    return store.fetch_options(conn)


def _geography(conn: Optional[Any]) -> dict[str, Any]:
    if conn is None:
        return {"state_districts": {}, "district_markets": {}}
    return store.fetch_geography(conn)


def _check_commodity(value: Optional[str]) -> Optional[str]:
    if not value or not value.strip():
        return None
    key = value.strip().casefold()
    if registry.commodity(key) is None:
        raise HTTPException(
            status_code=400,
            detail=f"unknown commodity '{value}'. valid keys: {', '.join(registry.valid_keys())}",
        )
    return key


def _check_group(value: Optional[str]) -> Optional[str]:
    if not value or not value.strip():
        return None
    group = value.strip().casefold()
    if not registry.is_valid_group(group):
        raise HTTPException(
            status_code=400,
            detail=f"unknown group '{value}'. valid groups: {', '.join(g['key'] for g in registry.groups())}",
        )
    return group


def _check_range(value: str) -> str:
    name = (value or "").strip().casefold()
    if name not in RANGES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown range '{value}'. valid ranges: {', '.join(RANGES)}",
        )
    return name


def _check_date(value: Optional[str], label: str) -> Optional[str]:
    if not value or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be an ISO date (YYYY-MM-DD), got '{value}'")


def _check_compare(value: Optional[str]) -> list[str]:
    if not value or not value.strip():
        return []
    keys = [part.strip().casefold() for part in value.split(",") if part.strip()]
    if len(keys) > MAX_COMPARE:
        raise HTTPException(status_code=400, detail=f"compare accepts at most {MAX_COMPARE} commodity keys")
    for key in keys:
        if registry.commodity(key) is None:
            raise HTTPException(status_code=400, detail=f"unknown comparison commodity '{key}'")
    return keys


def _source_names(keys: list[str]) -> list[str]:
    return sorted({name for key in keys for name in registry.source_names_for(key)})


def _shift(day: str, days: int) -> str:
    return (date.fromisoformat(day) - timedelta(days=days)).isoformat()


@router.get("/filters", response_model=FiltersPayload, summary="Agri price filter options")
def get_agri_filters() -> FiltersPayload:
    """Commodity/group registries and the geographies present in the cache."""
    conn = _reader()
    try:
        options = _as_of_options(conn)
        geography = _geography(conn)
    finally:
        if conn is not None:
            conn.close()
    return FiltersPayload(
        ok=True,
        as_of=options["as_of"],
        freshness_days=aggregate.freshness_days(options["as_of"]),
        commodities=registry.commodities(),
        groups=registry.groups(),
        states=options["states"],
        districts=options["districts"],
        markets=options["markets"],
        **geography,
    )


@router.get("/prices", response_model=PricesResponse, summary="Agri mandi price dashboard payload")
def get_agri_prices(
    commodity: Optional[str] = Query(None, description="Tracked commodity key"),
    group: Optional[str] = Query(None, description="Commodity group key"),
    state: Optional[str] = Query(None, description="State name"),
    district: Optional[str] = Query(None, description="District name"),
    market: Optional[str] = Query(None, description="Market / mandi name"),
    range: str = Query("6m", description="1m | 3m | 6m | 1y | max, anchored to as_of"),
    date_from: Optional[str] = Query(None, alias="from", description="Inclusive ISO start date"),
    date_to: Optional[str] = Query(None, alias="to", description="Inclusive ISO end date"),
    compare: Optional[str] = Query(None, description="Comma-separated commodity keys (max 5)"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum quotes to return"),
) -> PricesResponse:
    """Snapshot, time series, mandi quotes, KPIs and up to five comparisons."""
    key = _check_commodity(commodity)
    group_key = _check_group(group)
    range_name = _check_range(range)
    from_day = _check_date(date_from, "from")
    to_day = _check_date(date_to, "to")
    compare_keys = _check_compare(compare)
    if from_day and to_day and from_day > to_day:
        raise HTTPException(status_code=400, detail="from must be on or before to")
    if key and group_key and key not in registry.keys_for_group(group_key):
        raise HTTPException(
            status_code=400,
            detail=f"commodity '{key}' is not in group '{group_key}'",
        )

    snapshot_keys = list(registry.keys_for_group(group_key)) if group_key else list(registry.valid_keys())
    geo = {
        "states": [state] if state else None,
        "districts": [district] if district else None,
        "markets": [market] if market else None,
    }
    filters = AppliedFilters(
        commodity=key, group=group_key, state=state, district=district,
        market=market, range=range_name, date_from=from_day, date_to=to_day,
    )
    empty_kpis = Kpis(unit=registry.PRICE_UNIT, arrivals_unit=registry.ARRIVALS_UNIT)

    conn = _reader()
    if conn is None:
        warnings = ["no rows matched the current filters", "agri price cache is missing; run scripts/market/agri_import.py"]
        if key:
            warnings.append(f"MSP not verified for {registry.label_for(key)}; distance_to_msp_pct is null")
        return PricesResponse(
            ok=True, data_source=DATA_SOURCE_EMPTY, filters=filters, kpis=empty_kpis,
            warnings=warnings,
        )

    try:
        identity = store.cache_identity(conn)
        cache_key: Optional[tuple[Any, ...]] = None
        if identity is not None:
            cache_key = (
                key, group_key, state, district, market, range_name,
                from_day, to_day, tuple(compare_keys), limit, identity,
                datetime.now(config.IST).date().isoformat(),
            )
            cached = _cache_get(cache_key)
            if cached is not None:
                return cached.model_copy(deep=True)

        global_as_of = _as_of_options(conn)["as_of"]
        if not global_as_of:
            return PricesResponse(
                ok=True, data_source=DATA_SOURCE_EMPTY, filters=filters, kpis=empty_kpis,
                warnings=["agri price cache is empty; run scripts/market/agri_import.py"],
            )

        as_of = store.latest_date(
            conn,
            commodity_names=_source_names(snapshot_keys),
            **geo,
        ) or global_as_of

        latest_rows = store.fetch_rows(
            conn, commodity_names=_source_names(snapshot_keys), on_date=as_of, **geo,
        )
        anchor_map = store.anchor_dates(
            conn,
            {k: registry.source_names_for(k) for k in snapshot_keys},
            as_of,
            aggregate.CHANGE_OFFSETS,
        )
        anchor_dates_set = {d for per_key in anchor_map.values() for d in per_key.values() if d}
        history_rows = store.fetch_rows(
            conn, commodity_names=_source_names(snapshot_keys), on_dates=anchor_dates_set, **geo,
        )
        snapshot = aggregate.latest_snapshot(
            latest_rows, history_rows, as_of=as_of, keys=snapshot_keys,
        )

        series: list[dict[str, Any]] = []
        quotes: list[dict[str, Any]] = []
        kpis = empty_kpis
        selected_rows: list[dict[str, Any]] = []
        if key:
            # 6m changes must be available even when the chart range is 1m.
            lookback = (
                None if range_name == "max"
                else min(max(aggregate.CHANGE_OFFSETS[-1], aggregate.RANGE_DAYS[range_name] or 0), _HISTORY_LOOKBACK_DAYS)
            )
            history_start = _shift(as_of, lookback or _HISTORY_LOOKBACK_DAYS)
            start = min(from_day, history_start) if from_day else history_start
            selected_rows = store.fetch_rows(
                conn, commodity_names=_source_names([key]),
                from_date=start, to_date=to_day or as_of, **geo,
            )
            daily = aggregate.aggregate_daily(selected_rows)
            series = aggregate.filter_by_range(daily, as_of, range_name, from_day, to_day)
            quotes = aggregate.selected_quotes(selected_rows, limit=limit)
            kpis = Kpis(**aggregate.kpis_for(daily, as_of, key))

        comparison: list[dict[str, Any]] = []
        if compare_keys:
            by_key: dict[str, list[dict[str, Any]]] = {}
            cutoff = aggregate.range_cutoff(as_of, range_name, from_day)
            for compare_key in compare_keys:
                by_key[compare_key] = store.fetch_rows(
                    conn, commodity_names=_source_names([compare_key]),
                    from_date=cutoff, to_date=to_day or as_of, **geo,
                )
            comparison = aggregate.comparison_series(by_key, as_of, range_name, from_day, to_day)

        warning_rows = selected_rows if key else latest_rows + history_rows
        warnings = aggregate.collect_warnings(warning_rows, as_of, selected_key=key)
        response = PricesResponse(
            ok=True,
            as_of=as_of,
            freshness_days=aggregate.freshness_days(as_of),
            data_source=_DATA_SOURCE_CKAN,
            filters=filters,
            kpis=kpis,
            series=series,
            snapshot=snapshot,
            quotes=quotes,
            comparison=comparison,
            warnings=warnings,
        )
        if cache_key is not None:
            _cache_put(cache_key, response)
        return response
    finally:
        conn.close()


@router.get("/commodities", response_model=CommoditiesResponse, summary="Tracked agri commodities")
def get_agri_commodities() -> CommoditiesResponse:
    """Backward-compatible option list; now also carries group and unit."""
    return CommoditiesResponse(ok=True, commodities=registry.commodities(), groups=registry.groups())

"""Agri-commodity mandi prices — read-only HTTP surface.

Every query filters on the canonical ``commodity_key``; the raw source spelling
is audit metadata only. Prices come from the local SQLite cache built by
``scripts/market/agri_import.py`` and the daily collector. A missing cache is
reported as ``data_source="empty"``; it is never presented as a successful load.

The read path uses ``store.fetch_rows(commodity_keys=...)`` and
``store.latest_date_per_key(...)``; raw ``commodity`` matching is never used.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

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

DB_PATH: Optional[Path] = None
DATA_SOURCE_EMPTY: str = "empty"
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


def _shift(day: str, days: int) -> str:
    return (date.fromisoformat(day) - timedelta(days=days)).isoformat()


def _row_source(row: dict[str, Any]) -> Optional[str]:
    return registry.normalise_price_source(row.get("price_source") or row.get("source"))


def _fetch_rows(
    conn: Any,
    *,
    commodity_keys: Optional[Iterable[str]] = None,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
    on_date: Optional[str] = None,
    on_dates: Optional[Iterable[str]] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Rows filtered by canonical key.

    ``store.fetch_rows`` treats an empty key list as "no key filter", so an
    empty selection must short-circuit here or a missing commodity would read
    the entire table.
    """
    keys = list(commodity_keys) if commodity_keys is not None else None
    if keys is not None and not keys:
        return []
    return store.fetch_rows(
        conn,
        commodity_keys=keys,
        states=states,
        districts=districts,
        markets=markets,
        on_date=on_date,
        on_dates=on_dates,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )


def _latest_date_per_key(
    conn: Any,
    keys: Iterable[str],
    *,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> dict[str, Optional[str]]:
    return store.latest_date_per_key(
        conn,
        list(keys),
        states=states, districts=districts, markets=markets,
    )


def _max_date(
    conn: Any,
    key: str,
    target: str,
    *,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> Optional[str]:
    clauses = ["commodity_key = ?", "date <= ?"]
    params: list[Any] = [key, target]
    for column, values in (
        ("state", states), ("district", districts), ("market", markets),
    ):
        items = list(values or ())
        if items:
            clauses.append(f"{column} IN ({', '.join('?' for _ in items)})")
            params.extend(items)
    row = conn.execute(
        f"SELECT MAX(date) FROM {store.TABLE} WHERE " + " AND ".join(clauses),
        params,
    ).fetchone()
    return row[0] if row else None


def _anchor_dates(
    conn: Any,
    key_to_as_of: dict[str, Optional[str]],
    offsets: Iterable[int],
    *,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> dict[str, dict[int, Optional[str]]]:
    out: dict[str, dict[int, Optional[str]]] = {}
    for key, as_of in key_to_as_of.items():
        if not as_of:
            out[key] = {days: None for days in offsets}
            continue
        out[key] = {
            days: _max_date(
                conn, key, _shift(as_of, days),
                states=states, districts=districts, markets=markets,
            )
            for days in offsets
        }
    return out


def _fetch_latest_rows(
    conn: Any,
    latest_by_key: dict[str, Optional[str]],
    *,
    states: Optional[Iterable[str]] = None,
    districts: Optional[Iterable[str]] = None,
    markets: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
    buckets: dict[str, list[str]] = {}
    for key, day in latest_by_key.items():
        if day:
            buckets.setdefault(str(day), []).append(key)
    rows: list[dict[str, Any]] = []
    for day in sorted(buckets):
        rows.extend(_fetch_rows(
            conn, commodity_keys=buckets[day], on_date=day,
            states=states, districts=districts, markets=markets,
        ))
    return rows


def _snapshot_rows(
    latest_rows: list[dict[str, Any]],
    history_rows: list[dict[str, Any]],
    latest_by_key: dict[str, Optional[str]],
    keys: Iterable[str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key in keys:
        own_latest = [row for row in latest_rows if row.get("commodity_key") == key]
        own_history = [row for row in history_rows if row.get("commodity_key") == key]
        entry = aggregate.latest_snapshot(
            own_latest, own_history, as_of=latest_by_key.get(key), keys=[key],
        )[0]
        entry["freshness_days"] = aggregate.freshness_days(entry.get("date"))
        out.append(entry)
    return out


def _quote_from_row(row: dict[str, Any], day: str) -> dict[str, Any]:
    key = str(row.get("commodity_key") or "") or None
    return {
        "date": day,
        "commodity_key": key,
        "state": str(row.get("state") or ""),
        "district": str(row.get("district") or ""),
        "market": str(row.get("market") or ""),
        "variety": str(row.get("variety") or ""),
        "grade": str(row.get("grade") or ""),
        "product_form": registry.product_form_for(key, row.get("variety"), row.get("product_form")),
        "price_unit": str(row.get("price_unit") or "").strip() or None,
        "price_source": _row_source(row),
        "min": aggregate.to_float(row.get("min_price")),
        "max": aggregate.to_float(row.get("max_price")),
        "modal": aggregate.to_float(row.get("modal_price")),
        "arrivals_qtl": aggregate.to_float(row.get("arrivals_qtl")),
    }


def _selected_quotes(
    rows: Iterable[dict[str, Any]],
    *,
    limit: Optional[int] = None,
) -> tuple[list[dict[str, Any]], int]:
    """Latest-date quotes with a stable order and the pre-limit total."""
    data = [row for row in rows if row.get("date")]
    if not data:
        return [], 0
    latest = max(str(row["date"]) for row in data)
    chosen: dict[tuple[str, ...], dict[str, Any]] = {}
    for row in data:
        if str(row["date"]) != latest:
            continue
        key = str(row.get("commodity_key") or "")
        identity = (
            str(row.get("state") or ""),
            str(row.get("district") or ""),
            str(row.get("market") or ""),
            key,
            str(row.get("variety") or ""),
            str(row.get("grade") or ""),
            registry.product_form_for(key, row.get("variety"), row.get("product_form")) or "",
            str(row.get("price_unit") or "").strip(),
        )
        chosen.setdefault(identity, row)
    ordered = [_quote_from_row(row, latest) for _, row in sorted(chosen.items())]
    total = len(ordered)
    return (ordered[:limit] if limit is not None else ordered), total


def _data_source(rows: Iterable[dict[str, Any]]) -> str:
    sources = {source for row in rows if (source := _row_source(row))}
    if not sources:
        return DATA_SOURCE_EMPTY
    if len(sources) == 1:
        return next(iter(sources))
    return registry.SOURCE_MIXED


def _per_key_freshness_warnings(
    snapshot: Iterable[dict[str, Any]],
    as_of: Optional[str],
) -> list[str]:
    if not as_of:
        return []
    try:
        anchor = date.fromisoformat(as_of)
    except ValueError:
        return []
    out: list[str] = []
    for row in snapshot:
        day = row.get("date")
        if not day:
            continue
        try:
            gap = (anchor - date.fromisoformat(day)).days
        except ValueError:
            continue
        if gap > aggregate.STALE_AFTER_DAYS:
            out.append(
                f"{row['label']} is {gap} days behind {as_of} "
                f"(latest {day}); showing its own latest date"
            )
    return out


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

        global_as_of = _as_of_options(conn)["as_of"] or store.latest_date(conn)
        if not global_as_of:
            return PricesResponse(
                ok=True, data_source=DATA_SOURCE_EMPTY, filters=filters, kpis=empty_kpis,
                warnings=["agri price cache is empty; run scripts/market/agri_import.py"],
            )

        latest_by_key = _latest_date_per_key(conn, snapshot_keys, **geo)
        dated_keys = [day for day in latest_by_key.values() if day]
        as_of = (
            (latest_by_key.get(key) or global_as_of) if key
            else (max(dated_keys) if dated_keys else global_as_of)
        )

        latest_rows = _fetch_latest_rows(conn, latest_by_key, **geo)
        anchor_map = _anchor_dates(
            conn,
            {k: day for k, day in latest_by_key.items() if day},
            aggregate.CHANGE_OFFSETS,
            **geo,
        )
        anchor_dates_set = {d for per_key in anchor_map.values() for d in per_key.values() if d}
        history_rows = _fetch_rows(
            conn,
            commodity_keys=[k for k, day in latest_by_key.items() if day],
            on_dates=anchor_dates_set,
            **geo,
        )
        snapshot = _snapshot_rows(latest_rows, history_rows, latest_by_key, snapshot_keys)

        series: list[dict[str, Any]] = []
        quotes: list[dict[str, Any]] = []
        quotes_total = 0
        kpis = empty_kpis
        selected_rows: list[dict[str, Any]] = []
        if key:
            key_as_of = latest_by_key.get(key) or as_of
            # 6m changes must be available even when the chart range is 1m.
            lookback = (
                None if range_name == "max"
                else min(max(aggregate.CHANGE_OFFSETS[-1], aggregate.RANGE_DAYS[range_name] or 0), _HISTORY_LOOKBACK_DAYS)
            )
            history_start = _shift(key_as_of, lookback or _HISTORY_LOOKBACK_DAYS)
            start = min(from_day, history_start) if from_day else history_start
            selected_rows = _fetch_rows(
                conn, commodity_keys=[key],
                from_date=start, to_date=to_day or key_as_of, **geo,
            )
            daily = aggregate.aggregate_daily(selected_rows)
            series = aggregate.filter_by_range(daily, key_as_of, range_name, from_day, to_day)
            quotes, quotes_total = _selected_quotes(selected_rows, limit=limit)
            kpis = Kpis(**aggregate.kpis_for(daily, key_as_of, key))
            as_of = key_as_of

        comparison: list[dict[str, Any]] = []
        if compare_keys:
            by_key: dict[str, list[dict[str, Any]]] = {}
            compare_as_ofs: dict[str, str] = {}
            for compare_key in compare_keys:
                compare_as_of = latest_by_key.get(compare_key)
                if not compare_as_of:
                    compare_as_of = _latest_date_per_key(conn, [compare_key], **geo).get(compare_key)
                compare_as_of = compare_as_of or as_of
                compare_as_ofs[compare_key] = compare_as_of
                cutoff = aggregate.range_cutoff(compare_as_of, range_name, from_day)
                by_key[compare_key] = _fetch_rows(
                    conn, commodity_keys=[compare_key],
                    from_date=cutoff, to_date=to_day or compare_as_of, **geo,
                )
            comparison = aggregate.comparison_series(
                by_key, as_of, range_name, from_day, to_day, as_of_by_key=compare_as_ofs,
            )

        warning_rows = selected_rows if key else latest_rows + history_rows
        warnings = aggregate.collect_warnings(warning_rows, as_of, selected_key=key)
        warnings.extend(_per_key_freshness_warnings(snapshot, as_of))
        warnings = list(dict.fromkeys(warnings))

        response = PricesResponse(
            ok=True,
            as_of=as_of,
            freshness_days=aggregate.freshness_days(as_of),
            data_source=_data_source(selected_rows + latest_rows + history_rows),
            filters=filters,
            kpis=kpis,
            series=series,
            snapshot=snapshot,
            quotes=quotes,
            quotes_total=quotes_total,
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

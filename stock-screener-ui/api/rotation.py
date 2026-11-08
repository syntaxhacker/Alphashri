"""Sector, industry and theme rotation overview."""

from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple

import numpy as np
import pandas as pd
import requests
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from api.tv_auth import get_tv_cookies, tv_scanner_data
from tradingview_screener import Query as TVQuery, col

from api.sector import _load_theme_membership
from config import IST

router = APIRouter(prefix="/api/rotation", tags=["rotation"])

PERIOD_FIELDS: Dict[str, str] = {
    "1D": "change",
    "1W": "Perf.W",
    "1M": "Perf.1M",
    "3M": "Perf.3M",
    "6M": "Perf.6M",
    "YTD": "Perf.YTD",
    "1Y": "Perf.Y",
}
PERIODS = list(PERIOD_FIELDS)
KINDS = ("sector", "industry", "theme")
Market = Literal["india", "america"]
Kind = Literal["sector", "industry", "theme"]
Period = Literal["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"]
CACHE_TTL_SECONDS = 60
FRAME_LIMIT = 3000
MAX_GROUPS = 48

ROTATION_COLUMNS = (
    "name",
    "sector",
    "industry",
    "change",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "Perf.6M",
    "Perf.YTD",
    "Perf.Y",
    "market_cap_basic",
    "relative_volume",
)

BENCHMARKS = {
    "india": {"name": "NIFTY 50", "symbol": "NSE:NIFTY", "vix": "NSE:INDIAVIX"},
    "america": {"name": "S&P 500", "symbol": "AMEX:SPY", "vix": "CBOE:VIX"},
}

_frame_cache: Dict[str, Tuple[float, pd.DataFrame]] = {}
_frame_lock = threading.Lock()
_overview_cache: Dict[Tuple[str, str, str, int, int], Tuple[float, Dict[str, Any]]] = {}
_overview_lock = threading.Lock()


class RotationMover(BaseModel):
    symbol: str
    change: float


class RotationRow(BaseModel):
    id: str
    name: str
    kind: str
    slug: Optional[str] = None
    category: Optional[str] = None
    members: int
    covered: int
    returns: Dict[str, float]
    rs_1m: float
    rs_1w: float
    rs_pct: float
    mom_pct: float
    rank: int
    rank_delta: int
    breadth: float
    rel_volume: float
    quadrant: str
    status: str
    top_movers: List[RotationMover]


class RotationRegime(BaseModel):
    benchmark: str
    benchmark_change: float
    benchmark_1m: float
    vix: Optional[float] = None
    vix_change: Optional[float] = None
    breadth: float
    label: str


class RotationOverviewResponse(BaseModel):
    market: str
    kind: str
    period: str
    benchmark: str
    last_updated: str
    regime: RotationRegime
    counts: Dict[str, int]
    rows: List[RotationRow]


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if np.isfinite(number) else default


def _fetch_rotation_frame(market: str, limit: int = FRAME_LIMIT) -> pd.DataFrame:
    query = TVQuery().select(*ROTATION_COLUMNS).set_markets(market)
    if market == "india":
        query = query.where(col("sector") != "", col("market_cap_basic") > 5_000_000_000)
    else:
        query = query.where(col("sector") != "")
    query = query.order_by("market_cap_basic", ascending=False).limit(limit)
    _, df = tv_scanner_data(query)
    return df


def _get_frame(market: str) -> pd.DataFrame:
    now = time.monotonic()
    with _frame_lock:
        cached = _frame_cache.get(market)
        if cached and cached[0] > now:
            return cached[1].copy()
        frame = _fetch_rotation_frame(market)
        _frame_cache[market] = (now + CACHE_TTL_SECONDS, frame.copy())
        return frame


def _fetch_benchmark(market: str) -> Dict[str, Any]:
    meta = BENCHMARKS[market]
    columns = ["name", "change", "Perf.W", "Perf.1M", "Perf.3M", "Perf.6M", "Perf.YTD", "Perf.Y", "close"]
    payload = {
        "symbols": {"tickers": [meta["symbol"], meta["vix"]], "query": {"types": []}},
        "columns": columns,
        "range": [0, 10],
    }
    output: Dict[str, Any] = {
        "benchmark": meta["name"],
        "returns": {period: 0.0 for period in PERIODS},
        "vix": None,
        "vix_change": None,
    }
    try:
        request_kwargs = {
            "json": payload,
            "timeout": 20,
            "headers": {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"},
        }
        cookies = get_tv_cookies()
        if cookies:
            request_kwargs["cookies"] = cookies
        response = requests.post(
            f"https://scanner.tradingview.com/{market}/scan",
            **request_kwargs,
        )
        response.raise_for_status()
        for row in response.json().get("data", []):
            values = dict(zip(columns, row.get("d") or []))
            if row.get("s") == meta["symbol"]:
                output["returns"] = {
                    period: _finite(values.get(column))
                    for period, column in PERIOD_FIELDS.items()
                }
            elif row.get("s") == meta["vix"]:
                output["vix"] = _finite(values.get("close"), None) if values.get("close") is not None else None
                output["vix_change"] = _finite(values.get("change"), None) if values.get("change") is not None else None
    except requests.RequestException:
        return output
    return output


def _weighted_return(group: pd.DataFrame, column: str) -> float:
    values = pd.to_numeric(group[column], errors="coerce")
    weights = pd.to_numeric(group["market_cap_basic"], errors="coerce")
    # TradingView occasionally sends Infinity for bad prints; drop them so the
    # aggregate (and therefore the JSON payload) can never become non-finite.
    valid = np.isfinite(values) & np.isfinite(weights) & (weights > 0)
    if not valid.any():
        return 0.0
    total = float(weights[valid].sum())
    if not np.isfinite(total) or total <= 0:
        return 0.0
    return _finite(float((values[valid] * weights[valid]).sum() / total))


def _relative_strength(value: float, benchmark: float) -> float:
    return float(value - benchmark)


def _percentile(values: List[float]) -> List[float]:
    if not values:
        return []
    if len(values) == 1:
        return [50.0]
    series = pd.Series(values, dtype="float64")
    return [float(value) for value in series.rank(pct=True).mul(100).tolist()]


def _quadrant(rs_pct: float, mom_pct: float) -> str:
    # Strictly above the midpoint: ``rank(pct=True)`` returns exactly 50 for the
    # lower half of a two-item set, and that group is below median, not leading.
    if rs_pct > 50 and mom_pct > 50:
        return "leading"
    if rs_pct > 50:
        return "weakening"
    if mom_pct > 50:
        return "improving"
    return "lagging"


def _status(rs_pct: float, mom_pct: float, _breadth: float, return_1w: float) -> str:
    if rs_pct >= 75 and mom_pct >= 60 and return_1w > 0:
        return "booming"
    if rs_pct <= 25 and mom_pct <= 40 and return_1w < 0:
        return "dumping"
    if mom_pct >= 60 and rs_pct < 75:
        return "heating"
    if mom_pct <= 40 and rs_pct > 25:
        return "cooling"
    return "neutral"


def _top_movers(group: pd.DataFrame, limit: int = 3) -> List[RotationMover]:
    ordered = group.sort_values("change", ascending=False).head(limit)
    movers: List[RotationMover] = []
    for _, row in ordered.iterrows():
        symbol = str(row.get("name") or "").strip()
        if not symbol:
            continue
        movers.append(RotationMover(symbol=symbol, change=round(_finite(row.get("change")), 2)))
    return movers


def _make_row(
    *,
    key: str,
    name: str,
    kind: str,
    group: pd.DataFrame,
    benchmark_returns: Dict[str, float],
    member_count: int,
    slug: Optional[str] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    returns = {period: round(_weighted_return(group, column), 2) for period, column in PERIOD_FIELDS.items()}
    advances = int((pd.to_numeric(group["change"], errors="coerce") > 0).sum())
    declines = int((pd.to_numeric(group["change"], errors="coerce") < 0).sum())
    breadth = round(advances / (advances + declines) * 100, 1) if advances + declines else 50.0
    rel_volume = pd.to_numeric(group["relative_volume"], errors="coerce")
    rel_volume = rel_volume.replace([np.inf, -np.inf], np.nan).dropna()
    volume = round(float(rel_volume.median()), 2) if not rel_volume.empty else 0.0
    return {
        "id": key,
        "name": name,
        "kind": kind,
        "slug": slug,
        "category": category,
        "members": int(member_count),
        "covered": int(len(group)),
        "returns": returns,
        "rs_1m": round(_finite(_relative_strength(returns["1M"], benchmark_returns["1M"])), 2),
        "rs_1w": round(_finite(_relative_strength(returns["1W"], benchmark_returns["1W"])), 2),
        "rank": 0,
        "rank_delta": 0,
        "breadth": breadth,
        "rel_volume": volume,
        "quadrant": "lagging",
        "status": "neutral",
        "top_movers": [mover.model_dump() for mover in _top_movers(group)],
    }


def _slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    return "-".join(part for part in cleaned.split("-") if part)


def _build_for_kind(
    frame: pd.DataFrame,
    kind: str,
    benchmark_returns: Dict[str, float],
) -> List[Dict[str, Any]]:
    if frame is None or frame.empty:
        return []
    unique = frame.drop_duplicates(subset=["name"]).copy()
    for column in PERIOD_FIELDS.values():
        unique[column] = pd.to_numeric(unique[column], errors="coerce")
    unique["market_cap_basic"] = pd.to_numeric(unique["market_cap_basic"], errors="coerce")
    unique["relative_volume"] = pd.to_numeric(unique["relative_volume"], errors="coerce")
    unique["change"] = pd.to_numeric(unique["change"], errors="coerce")

    if kind == "theme":
        try:
            info, slug_to_members = _load_theme_membership()
        except Exception:
            # DB unavailable / taxonomy broken -> no themes rather than a 502.
            return []
        if not slug_to_members:
            return []
        names = unique["name"].astype(str).str.strip().str.upper()
        rows: List[Dict[str, Any]] = []
        for slug, members in slug_to_members.items():
            wanted = {str(member).strip().upper() for member in members}
            if not wanted:
                continue
            group = unique[names.isin(wanted)]
            if group.empty:
                continue
            meta = info.get(slug, {})
            rows.append(
                _make_row(
                    key=f"{kind}:{slug}",
                    name=str(meta.get("name") or slug),
                    kind=kind,
                    group=group,
                    benchmark_returns=benchmark_returns,
                    member_count=len(wanted),
                    slug=slug,
                    category=meta.get("category"),
                )
            )
        return rows

    group_column = kind
    rows = []
    for name, group in unique.groupby(group_column):
        label = str(name or "").strip()
        if not label:
            continue
        rows.append(
            _make_row(
                key=f"{kind}:{_slugify(label)}",
                name=label,
                kind=kind,
                group=group,
                benchmark_returns=benchmark_returns,
                member_count=len(group),
            )
        )
    return rows


def _finalize_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return []
    rs_values = [_finite(row["rs_1m"]) for row in rows]
    rs_short = [_finite(row["rs_1w"]) for row in rows]
    mom_values = [rs_short[index] - rs_values[index] / 4 for index in range(len(rows))]
    rs_pct = _percentile(rs_values)
    mom_pct = _percentile(mom_values)
    rank_now = {index: rank for rank, index in enumerate(sorted(range(len(rows)), key=lambda i: rs_values[i], reverse=True), 1)}
    rank_short = {index: rank for rank, index in enumerate(sorted(range(len(rows)), key=lambda i: rs_short[i], reverse=True), 1)}
    for index, row in enumerate(rows):
        row["rs_pct"] = round(rs_pct[index], 1)
        row["mom_pct"] = round(mom_pct[index], 1)
        row["rank"] = rank_now[index]
        row["rank_delta"] = rank_now[index] - rank_short[index]
        row["quadrant"] = _quadrant(row["rs_pct"], row["mom_pct"])
        row["status"] = _status(row["rs_pct"], row["mom_pct"], row["breadth"], row["returns"]["1W"])
    return rows


def _breadth_counts(frame: pd.DataFrame) -> Tuple[int, int]:
    """``(advances, declines)`` for a universe frame, deduplicated by name.

    Names without a usable ``change`` are neither advancing nor declining, so
    the denominator is the traded sample — callers that need to know how thin
    that sample is must surface the counts, not only the percentage.
    """
    if frame is None or frame.empty:
        return 0, 0
    change = pd.to_numeric(
        frame.drop_duplicates(subset=["name"])["change"], errors="coerce")
    return int((change > 0).sum()), int((change < 0).sum())


def _market_breadth(frame: pd.DataFrame) -> float:
    advances, declines = _breadth_counts(frame)
    total = advances + declines
    return round(advances / total * 100, 1) if total else 50.0


#: A cached breadth reading older than its 60s overview TTL is still served by
#: :func:`cached_breadth` (flagged ``stale``) so a consumer such as the Nifty
#: report never loses the last known reading between rotation refreshes.
def cached_breadth(market: str = "india") -> Optional[Dict[str, Any]]:
    """Non-blocking advance/decline breadth for ``market``, fresh or stale.

    Reads the in-process overview/frame caches only — **never** fetches, so a
    20s report rebuild cannot inherit a 20s Upstox frame call. Returns ``None``
    when this process has never built an overview for ``market`` (a cold start);
    otherwise::

        {"advances_pct": float, "advances": int | None, "declines": int | None,
         "total": int | None, "as_of": str | None, "stale": bool}

    ``advances_pct`` is ``advances / (advances + declines) * 100`` over the
    deduplicated universe frame (the same number the rotation strip prints), and
    ``total`` is that denominator — a 19% reading on a 40-name sample is not the
    same statement as 19% on 3,000 names.

    Only the requested market is considered. Returning another market's
    breadth (the old Nifty fallback) can label a US risk-off print as Nifty
    advance/decline — e.g. a 19% reading beside a 74% Indian tape.
    """
    now = time.monotonic()
    best: Optional[Tuple[float, Dict[str, Any], float]] = None
    try:
        # Writers hold this lock only for the cache assignment (the frame fetch
        # happens outside it), so the wait is a few instructions.
        with _overview_lock:
            items = list(_overview_cache.items())
        for key, entry in items:
            try:
                expires, payload = entry
                if str((key or ("",))[0]).lower() != market:
                    continue
                if not isinstance(payload, dict):
                    continue
                value = (payload.get("regime") or {}).get("breadth")
                if value is None:
                    continue
                candidate = (float(expires), payload, float(value))
            except (TypeError, ValueError):
                continue
            if best is None or candidate[0] > best[0]:
                best = candidate
    except Exception:
        return None
    if best is None:
        return None

    expires, payload, value = best
    advances = declines = total = None
    try:
        # Deliberately lock-free: ``_get_frame`` holds ``_frame_lock`` across
        # its network fetch, and a read-only getter must not queue behind that.
        # ``dict.get`` is atomic, and the cached tuple is never mutated in place.
        frame = _frame_cache.get(market)
        if frame is not None:
            advances, declines = _breadth_counts(frame[1])
            total = advances + declines
    except Exception:
        advances = declines = total = None
    return {
        "advances_pct": round(value, 1),
        "advances": advances,
        "declines": declines,
        "total": total,
        "as_of": payload.get("last_updated"),
        "stale": bool(expires <= now),
    }


def _build_overview(
    market: str,
    kind: str,
    period: str,
    min_members: int,
    limit: int,
) -> Dict[str, Any]:
    frame = _get_frame(market)
    benchmark_data = _fetch_benchmark(market)
    benchmark_returns = {
        period_key: _finite((benchmark_data.get("returns") or {}).get(period_key))
        for period_key in PERIODS
    }
    rows = _build_for_kind(frame, kind, benchmark_returns)
    rows = [row for row in rows if row["members"] >= min_members]
    rows = sorted(rows, key=lambda row: row["members"], reverse=True)[:limit]
    rows = _finalize_rows(rows)
    rows.sort(key=lambda row: row["returns"][period], reverse=True)

    counts = {"booming": 0, "heating": 0, "cooling": 0, "dumping": 0, "neutral": 0}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    breadth = _market_breadth(frame)
    benchmark_change = _finite(benchmark_returns.get("1D"))
    regime_label = "MIXED"
    if breadth >= 55 and benchmark_change >= 0:
        regime_label = "RISK-ON"
    elif breadth <= 45 and benchmark_change < 0:
        regime_label = "RISK-OFF"

    return {
        "market": market,
        "kind": kind,
        "period": period,
        "benchmark": benchmark_data["benchmark"],
        "last_updated": datetime.now(IST).isoformat(),
        "regime": {
            "benchmark": benchmark_data["benchmark"],
            "benchmark_change": round(benchmark_change, 2),
            "benchmark_1m": round(_finite(benchmark_returns.get("1M")), 2),
            "vix": round(benchmark_data["vix"], 2) if benchmark_data.get("vix") is not None else None,
            "vix_change": round(benchmark_data["vix_change"], 2) if benchmark_data.get("vix_change") is not None else None,
            "breadth": breadth,
            "label": regime_label,
        },
        "counts": counts,
        "rows": rows,
    }


@router.get("/overview", response_model=RotationOverviewResponse)
async def get_rotation_overview(
    market: Market = Query("india"),
    kind: Kind = Query("sector"),
    period: Period = Query("1M"),
    min_members: int = Query(3, ge=1, le=100),
    limit: int = Query(MAX_GROUPS, ge=5, le=100),
):
    cache_key = (market, kind, period, min_members, limit)
    now = time.monotonic()
    with _overview_lock:
        cached = _overview_cache.get(cache_key)
        if cached and cached[0] > now:
            return RotationOverviewResponse(**cached[1])
    try:
        result = await asyncio.to_thread(_build_overview, market, kind, period, min_members, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Rotation data unavailable: {exc}") from exc
    with _overview_lock:
        _overview_cache[cache_key] = (now + CACHE_TTL_SECONDS, result)
    return RotationOverviewResponse(**result)


def clear_cache() -> None:
    with _frame_lock:
        _frame_cache.clear()
    with _overview_lock:
        _overview_cache.clear()

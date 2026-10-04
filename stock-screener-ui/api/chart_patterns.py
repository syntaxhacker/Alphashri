"""Chart-patterns API (CONTRACT.md §5).

Router prefix ``/api/chart-patterns``. All responses are JSON-sanitized. The
scan endpoint is auth-gated; read-only market endpoints mirror the ``/api/chart``
precedent (open).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from chart_patterns import candles, jobs, store
from chart_patterns import trendlines as trendlines_mod
from db.models.user import User
from api.auth import get_current_user
from api.utils import _sanitize_for_json

router = APIRouter(prefix="/api/chart-patterns", tags=["chart-patterns"])


# ---------------------------------------------------------------------------
# Frozen fallbacks (CONTRACT.md §1/§2) — used only if Agent 1's registries are
# unavailable so this router stays functional during integration.
# ---------------------------------------------------------------------------

_FALLBACK_TIMEFRAMES = [
    {"id": "1m", "label": "1m", "minutes": 1, "native": True, "source_tf": None, "max_lookback_days": 30, "min_bars": 60},
    {"id": "3m", "label": "3m", "minutes": 3, "native": False, "source_tf": "1m", "max_lookback_days": 30, "min_bars": 60},
    {"id": "5m", "label": "5m", "minutes": 5, "native": True, "source_tf": None, "max_lookback_days": 90, "min_bars": 60},
    {"id": "10m", "label": "10m", "minutes": 10, "native": True, "source_tf": None, "max_lookback_days": 90, "min_bars": 60},
    {"id": "15m", "label": "15m", "minutes": 15, "native": True, "source_tf": None, "max_lookback_days": 90, "min_bars": 60},
    {"id": "30m", "label": "30m", "minutes": 30, "native": True, "source_tf": None, "max_lookback_days": 180, "min_bars": 60},
    {"id": "1h", "label": "1h", "minutes": 60, "native": True, "source_tf": None, "max_lookback_days": 365, "min_bars": 60},
    {"id": "2h", "label": "2h", "minutes": 120, "native": False, "source_tf": "1h", "max_lookback_days": 365, "min_bars": 60},
    {"id": "3h", "label": "3h", "minutes": 180, "native": False, "source_tf": "1h", "max_lookback_days": 365, "min_bars": 60},
    {"id": "4h", "label": "4h", "minutes": 240, "native": True, "source_tf": None, "max_lookback_days": 365, "min_bars": 60},
    {"id": "1D", "label": "1D", "minutes": 1440, "native": True, "source_tf": None, "max_lookback_days": 730, "min_bars": 60},
    {"id": "1W", "label": "1W", "minutes": 10080, "native": True, "source_tf": None, "max_lookback_days": 1825, "min_bars": 52},
    {"id": "1M", "label": "1M", "minutes": 43200, "native": True, "source_tf": None, "max_lookback_days": 3650, "min_bars": 24},
]

_FAMILIES = [
    {"id": "reversal", "label": "Reversal"},
    {"id": "continuation", "label": "Continuation"},
    {"id": "curve_cup", "label": "Curve & Cup"},
]

_FALLBACK_PATTERNS = [
    {"pattern_id": "falling_wedge", "name": "Falling Wedge", "family": "reversal", "direction": "bullish", "description": "Converging down-sloping trendlines; bullish reversal."},
    {"pattern_id": "rising_wedge", "name": "Rising Wedge", "family": "reversal", "direction": "bearish", "description": "Converging up-sloping trendlines; bearish reversal."},
    {"pattern_id": "diamond_bottom", "name": "Diamond Bottom", "family": "reversal", "direction": "bullish", "description": "Broadening then contracting range; bullish reversal."},
    {"pattern_id": "triple_bottom", "name": "Triple Bottom", "family": "reversal", "direction": "bullish", "description": "Three roughly equal lows with intervening rallies."},
    {"pattern_id": "double_bottom", "name": "Double Bottom", "family": "reversal", "direction": "bullish", "description": "Two equal lows separated by a peak; bullish reversal."},
    {"pattern_id": "head_shoulders", "name": "Head & Shoulders", "family": "reversal", "direction": "bearish", "description": "Three peaks with a higher middle peak; bearish reversal."},
    {"pattern_id": "inverse_head_shoulders", "name": "Inverse H&S", "family": "reversal", "direction": "bullish", "description": "Inverted head & shoulders; bullish reversal."},
    {"pattern_id": "rounding_bottom", "name": "Rounding Bottom", "family": "reversal", "direction": "bullish", "description": "Saucer-shaped base; bullish reversal."},
    {"pattern_id": "ascending_channel", "name": "Ascending Channel", "family": "continuation", "direction": "bullish", "description": "Parallel up-sloping support/resistance channel."},
    {"pattern_id": "descending_channel", "name": "Descending Channel", "family": "continuation", "direction": "bearish", "description": "Parallel down-sloping support/resistance channel."},
    {"pattern_id": "bull_flag", "name": "Bull Flag", "family": "continuation", "direction": "bullish", "description": "Sharp advance then tight downward consolidation."},
    {"pattern_id": "bear_flag", "name": "Bear Flag", "family": "continuation", "direction": "bearish", "description": "Sharp decline then tight upward consolidation."},
    {"pattern_id": "pennant", "name": "Pennant", "family": "continuation", "direction": "bullish", "description": "Small symmetrical triangle after a sharp move."},
    {"pattern_id": "rectangle", "name": "Rectangle", "family": "continuation", "direction": "neutral", "description": "Horizontal range; unresolved consolidation."},
    {"pattern_id": "ascending_triangle", "name": "Ascending Triangle", "family": "continuation", "direction": "bullish", "description": "Flat resistance with rising support; bullish continuation."},
    {"pattern_id": "descending_triangle", "name": "Descending Triangle", "family": "continuation", "direction": "bearish", "description": "Flat support with falling resistance; bearish continuation."},
    {"pattern_id": "curve_bearish", "name": "Curve Pattern (Bearish)", "family": "curve_cup", "direction": "bearish", "description": "Rounded top / dome; bearish curve pattern."},
    {"pattern_id": "cup_handle", "name": "Cup & Handle", "family": "curve_cup", "direction": "bullish", "description": "Rounded cup then shallow handle; bullish continuation."},
]

_FALLBACK_UNIVERSES = [
    {"id": "nifty50", "label": "Nifty 50"},
    {"id": "nifty100", "label": "Nifty 100"},
    {"id": "nifty200", "label": "Nifty 200"},
    {"id": "nifty500", "label": "Nifty 500"},
    {"id": "all_equity", "label": "All NSE Equities"},
]

# Legacy alias: older clients request universe "all"; the registry id is
# "all_equity". Normalized in create_scan before validation/submit.
_UNIVERSE_ALIASES = {"all": "all_equity"}

_name_cache: Optional[dict] = None


# ---------------------------------------------------------------------------
# Resolvers
# ---------------------------------------------------------------------------

def _spec_to_dict(spec) -> dict:
    if isinstance(spec, dict):
        return {k: spec.get(k) for k in ("id", "label", "minutes", "native", "source_tf", "max_lookback_days", "min_bars")}
    return {
        "id": getattr(spec, "id", None),
        "label": getattr(spec, "label", None),
        "minutes": getattr(spec, "minutes", None),
        "native": getattr(spec, "native", None),
        "source_tf": getattr(spec, "source_tf", None),
        "max_lookback_days": getattr(spec, "max_lookback_days", None),
        "min_bars": getattr(spec, "min_bars", None),
    }


def _timeframes_payload() -> list[dict]:
    try:
        from chart_patterns import timeframes as tf

        specs = getattr(tf, "TIMEFRAMES", None)
        if specs:
            return [_spec_to_dict(s) for s in specs]
    except Exception:
        pass
    return [dict(s) for s in _FALLBACK_TIMEFRAMES]


def _pattern_from_dict(item) -> Optional[dict]:
    if isinstance(item, dict):
        pid = item.get("pattern_id") or item.get("id")
        return {
            "pattern_id": pid,
            "name": item.get("name") or item.get("label") or pid,
            "family": item.get("family"),
            "direction": item.get("direction"),
            "description": item.get("description", ""),
        }
    pid = getattr(item, "pattern_id", None) or getattr(item, "id", None)
    if not pid:
        return None
    return {
        "pattern_id": pid,
        "name": getattr(item, "name", None) or getattr(item, "label", pid),
        "family": getattr(item, "family", None),
        "direction": getattr(item, "direction", None),
        "description": getattr(item, "description", "") or "",
    }


def _patterns_payload() -> list[dict]:
    candidates = []
    try:
        from chart_patterns import engine as eng

        candidates.append(eng)
    except Exception:
        pass
    try:
        import chart_patterns.detectors as detectors

        candidates.append(detectors)
        try:
            from chart_patterns.detectors import common as det_common

            candidates.append(det_common)
        except Exception:
            pass
    except Exception:
        pass

    descriptions = {p["pattern_id"]: p.get("description", "") for p in _FALLBACK_PATTERNS}

    for module in candidates:
        for attr in ("PATTERN_CATALOG", "PATTERNS", "PATTERN_DEFS", "CATALOG"):
            catalog = getattr(module, attr, None)
            if not catalog:
                continue
            parsed = _parse_catalog(catalog, descriptions)
            if parsed:
                return parsed
    return [dict(p) for p in _FALLBACK_PATTERNS]


def _parse_catalog(catalog, descriptions: dict) -> list[dict]:
    parsed: list[dict] = []
    if isinstance(catalog, dict):
        for pid, value in catalog.items():
            entry = _catalog_entry(pid, value, descriptions)
            if entry:
                parsed.append(entry)
    elif isinstance(catalog, (list, tuple)):
        for item in catalog:
            entry = _pattern_from_dict(item)
            if entry and entry.get("pattern_id"):
                entry["description"] = entry.get("description") or descriptions.get(entry["pattern_id"], "")
                parsed.append(entry)
    return [p for p in parsed if p.get("pattern_id")]


def _catalog_entry(pid, value, descriptions: dict) -> Optional[dict]:
    if isinstance(value, dict):
        value = dict(value)
        value.setdefault("pattern_id", pid)
        entry = _pattern_from_dict(value)
    elif isinstance(value, (tuple, list)):
        name = value[0] if len(value) > 0 else pid
        family = value[1] if len(value) > 1 else None
        direction = value[2] if len(value) > 2 else None
        entry = {"pattern_id": pid, "name": name, "family": family, "direction": direction, "description": ""}
    else:
        entry = {"pattern_id": pid, "name": str(value), "family": None, "direction": None, "description": ""}
    if entry:
        entry["description"] = entry.get("description") or descriptions.get(pid, "")
    return entry


def _universes_payload() -> list[dict]:
    out = []
    try:
        from chart_patterns import universes as u

        lister = getattr(u, "list_universes", None)
        if callable(lister):
            for item in lister() or []:
                if isinstance(item, dict) and item.get("id"):
                    out.append({
                        "id": item["id"],
                        "label": item.get("label") or str(item["id"]).title(),
                        "count": item.get("count") or 0,
                    })
        if not out:
            raw = getattr(u, "UNIVERSES", None) or getattr(u, "UNIVERSE_DEFS", None)
            if isinstance(raw, dict):
                iterable = [dict(v, id=v.get("id", k)) for k, v in raw.items()]
            elif isinstance(raw, (list, tuple)):
                iterable = list(raw)
            else:
                iterable = []
            for item in iterable:
                if isinstance(item, dict):
                    uid = item.get("id") or item.get("universe")
                    if not uid:
                        continue
                    count = item.get("count")
                    if count is None and item.get("symbols") is not None:
                        count = len(item["symbols"])
                    out.append({"id": uid, "label": item.get("label") or str(uid).title(), "count": count or 0})
        if not out:
            ids = getattr(u, "UNIVERSE_IDS", None)
            if ids:
                for uid in ids:
                    out.append({"id": uid, "label": str(uid).title(), "count": _count_universe(u, uid)})
    except Exception:
        out = []
    if out:
        return out
    return [dict(x, count=0) for x in _FALLBACK_UNIVERSES]


def _valid_universe_ids() -> set:
    """Universe ids from the real registry, falling back to the frozen list."""
    try:
        from chart_patterns import universes as u

        lister = getattr(u, "list_universes", None)
        if callable(lister):
            ids = {d["id"] for d in (lister() or []) if isinstance(d, dict) and d.get("id")}
            if ids:
                return ids
    except Exception:
        pass
    return {x["id"] for x in _FALLBACK_UNIVERSES}


def _valid_timeframe_ids() -> set:
    """Timeframe ids from the real registry, falling back to the frozen list."""
    try:
        from chart_patterns import timeframes as tf

        ids = getattr(tf, "TIMEFRAME_IDS", None)
        if ids:
            return set(ids)
    except Exception:
        pass
    return {t["id"] for t in _FALLBACK_TIMEFRAMES}


def _normalize_universe(uid: str) -> str:
    """Map legacy aliases (e.g. "all") to registry ids ("all_equity")."""
    key = (uid or "").strip().lower()
    return _UNIVERSE_ALIASES.get(key, uid)


def _count_universe(module, uid: str) -> int:
    try:
        raw = module.get_universe(uid)
        return len(list(raw))
    except Exception:
        return 0


def _lookup_name(symbol: str) -> Optional[str]:
    global _name_cache
    if _name_cache is None:
        mapping = {}
        try:
            from api.symbols import _load_instruments

            for inst in _load_instruments():
                sym = inst.get("trading_symbol") or inst.get("symbol")
                if sym:
                    mapping[str(sym).upper()] = inst.get("name")
        except Exception:
            pass
        _name_cache = mapping
    return _name_cache.get(str(symbol).upper())


def _slice_candles(df, start_date, end_date, max_bars: int = 160):
    """Return the OHLCV window covering a pattern (padded + capped) for a card.

    The window always includes the pattern's start and end bars, even when it is
    longer than ``max_bars`` (uniform downsample rather than truncating the head),
    so the pattern boundary trendlines remain drawable. The right edge is padded
    past ``end_date`` so post-breakout price action (~30 bars) is visible.
    """
    if df is None or getattr(df, "empty", True):
        return []
    try:
        n = len(df)
        days = df.index.strftime("%Y-%m-%d").tolist()
        s = str(start_date)[:10] if start_date else ""
        e = str(end_date)[:10] if end_date else ""
        si = days.index(s) if s and s in days else 0
        ei = (n - 1 - days[::-1].index(e)) if e and e in days else n - 1
        if ei < si:
            si, ei = 0, n - 1
    except Exception:
        si, ei = 0, len(df) - 1
    pad = max(5, int((ei - si + 1) * 0.12))
    lo = max(0, si - pad)
    # Pad the right edge generously (~30 bars) so the breakout's follow-through
    # is visible; bounded by the newest available bar.
    hi = min(n - 1, ei + max(pad, 30))
    length = hi - lo + 1
    if length <= max_bars:
        return candles.candles_to_series(df.iloc[lo:hi + 1], max_bars)
    # Uniform downsample across the whole window, always keeping pattern
    # endpoints. Exactly max_bars points are picked (lo/hi from the linspace
    # edges, si/ei swapped in for their nearest non-critical neighbour), so
    # the follow-up candles_to_series(len(window)) call cannot tail() away
    # the pattern head.
    if max_bars < 2:
        keep = [i for i in (si, ei) if 0 <= i < n][:max(1, max_bars)] if max_bars else []
        return candles.candles_to_series(df.iloc[keep], max(1, max_bars))
    grid = {lo + round(k * (length - 1) / (max_bars - 1)) for k in range(max_bars)}
    grid = {g for g in grid if lo <= g <= hi}
    grid |= {lo, hi}
    for must in (si, ei):
        if not (lo <= must <= hi) or must in grid:
            continue
        victims = [g for g in grid if g not in (lo, hi, si, ei)]
        if victims:
            grid.remove(min(victims, key=lambda g: abs(g - must)))
        grid.add(must)
    ordered = sorted(grid)
    if len(ordered) > max_bars:
        # Defensive trim (rounding collisions aside, the swap-in above keeps
        # the count exact): drop evenly from non-endpoints, never si/ei/lo/hi.
        keep = {lo, hi, si, ei}
        rest = [g for g in ordered if g not in keep]
        drop = len(ordered) - max_bars
        drop_idx = {round(k * (len(rest) - 1) / (drop - 1)) for k in range(drop)} if drop > 1 else {0}
        rest = [g for i, g in enumerate(rest) if i not in drop_idx]
        ordered = sorted(keep | set(rest))
    window = df.iloc[ordered]
    return candles.candles_to_series(window, len(window))


def _stored_trend_lines(item) -> Optional[list]:
    """Scan-time ``trend_lines`` already carried by a result item, else ``None``.

    Never raises: missing keys, ``None`` values, wrong types, and non-dict
    items all fall through to ``None`` (caller runs the legacy recompute).
    """
    try:
        stored = item.get("trend_lines")
    except Exception:
        return None
    if isinstance(stored, list) and stored:
        return stored
    return None


def _enrich_with_candles(items, default_timeframe: Optional[str] = None, max_bars: int = 160):
    """Attach a real candle window + last close/day change to each result item.

    Candles are served from ``candles.fetch_for_timeframe`` (disk-cached), so
    this also retrofits hits persisted before candle windows were exposed.
    The fetch is bounded to the last 500 bars (detector windows are ≤250).
    Items already carrying scan-time ``trend_lines`` keep them; the detector
    only runs as a legacy fallback for items without stored lines.
    """
    cache: dict = {}
    tl_cache: dict = {}
    for item in items or []:
        stored_lines = _stored_trend_lines(item)
        symbol = item.get("symbol") if isinstance(item, dict) else None
        timeframe = (item.get("timeframe") if isinstance(item, dict) else None) or default_timeframe
        if not symbol or not timeframe:
            if isinstance(item, dict):
                item.setdefault("candles", [])
                item.setdefault("last_close", None)
                item.setdefault("day_change_pct", None)
                item["trend_lines"] = stored_lines if stored_lines is not None else []
            continue
        key = (symbol, timeframe)
        if key not in cache:
            try:
                cache[key] = candles.fetch_for_timeframe(symbol, timeframe, lookback_bars=500)
            except Exception:
                cache[key] = None
        df = cache[key]
        item["candles"] = _slice_candles(df, item.get("start_date"), item.get("end_date"), max_bars)
        if df is not None and not getattr(df, "empty", True):
            try:
                last = float(df["close"].iloc[-1])
                prev = float(df["close"].iloc[-2]) if len(df) > 1 else last
                item["last_close"] = last
                item["day_change_pct"] = round(((last - prev) / prev * 100.0) if prev else 0.0, 2)
            except Exception:
                item["last_close"] = None
                item["day_change_pct"] = None
        else:
            item["last_close"] = None
            item["day_change_pct"] = None
        if stored_lines is not None:
            item["trend_lines"] = stored_lines
            continue
        if key not in tl_cache:
            try:
                if df is not None and not getattr(df, "empty", True):
                    tl_cache[key] = trendlines_mod.detect_trendlines(df)
                else:
                    tl_cache[key] = {"support": None, "resistance": None}
            except Exception:
                tl_cache[key] = {"support": None, "resistance": None}
        try:
            res = tl_cache[key] or {}
            item["trend_lines"] = [v for v in (res.get("support"), res.get("resistance")) if v]
        except Exception:
            item["trend_lines"] = []
    return items


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    universe: str = ""
    timeframe: str
    force: bool = False
    # Optional explicit symbol scope. When present, only these symbols are
    # scanned (the job is stored under the reserved ``custom`` universe), so a
    # caller can run detection on a hand-picked list without computing a whole
    # universe.
    symbols: Optional[list[str]] = None
    # Optional trailing window in bars. None = Auto (fetch max_lookback_days,
    # no slicing). When set, history covers N bars and detection sees only
    # the last N bars.
    lookback_bars: Optional[int] = None


# Upper bound on a custom scan's symbol list (matches the picker's practical
# size; keeps one request from enqueuing a universe-sized job by accident).
MAX_CUSTOM_SYMBOLS = 200


def _normalize_symbol_list(raw) -> list[str]:
    """Upper-cased, de-duplicated, order-preserving symbol scope (capped)."""
    out: list[str] = []
    seen: set = set()
    for item in raw or []:
        symbol = str(item or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
        if len(out) >= MAX_CUSTOM_SYMBOLS:
            break
    return out


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/timeframes")
async def get_timeframes():
    return _sanitize_for_json({"timeframes": _timeframes_payload()})


@router.get("/universes")
async def get_universes():
    return _sanitize_for_json({"universes": _universes_payload(), "default": "nifty50"})


@router.get("/patterns")
async def get_patterns():
    return _sanitize_for_json({"families": list(_FAMILIES), "patterns": _patterns_payload()})


@router.post("/scan")
async def create_scan(request: ScanRequest, user: User = Depends(get_current_user)):
    if request.lookback_bars is not None and not (
        60 <= request.lookback_bars <= 5000
    ):
        raise HTTPException(
            status_code=422,
            detail="lookback_bars must be between 60 and 5000",
        )
    symbols = _normalize_symbol_list(request.symbols)
    if symbols:
        # Explicit symbol scope: scan only these, under the reserved universe.
        universe = "custom"
        params = {"force": request.force, "symbols": symbols}
    else:
        universe = _normalize_universe(request.universe)
        if universe not in _valid_universe_ids():
            raise HTTPException(
                status_code=422,
                detail=f"unknown universe {request.universe!r}. Known: {sorted(_valid_universe_ids())}",
            )
        params = {"force": request.force}
    if request.lookback_bars is not None:
        params["lookback_bars"] = request.lookback_bars
    if request.timeframe not in _valid_timeframe_ids():
        raise HTTPException(
            status_code=422,
            detail=f"unknown timeframe {request.timeframe!r}. Known: {sorted(_valid_timeframe_ids())}",
        )
    try:
        dto = jobs.submit(
            universe,
            request.timeframe,
            requested_by=getattr(user, "id", None),
            params=params,
        )
    except jobs.QueueFullError:
        return JSONResponse(
            status_code=429,
            content={
                "detail": "chart-pattern scan queue is full",
                "queue_size": jobs.queue_size(),
                "max_queue": jobs.PATTERN_SCAN_MAX_QUEUE,
            },
        )
    return _sanitize_for_json({
        "job_id": dto["job_id"],
        "status": dto["status"],
        "queue_position": dto["queue_position"],
        "queue_size": jobs.queue_size(),
    })


@router.get("/jobs")
async def list_jobs(active: int = Query(0, ge=0, le=1)):
    rows = jobs.list_active() if active else store.list_jobs(limit=50)
    return _sanitize_for_json({"jobs": rows})


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    dto = jobs.get_job(job_id)
    if not dto:
        raise HTTPException(status_code=404, detail="job not found")
    return _sanitize_for_json(dto)


def _build_filters(
    job_id=None, universe=None, timeframe=None, family=None, direction=None,
    status=None, quality=None, formed_within_bars=None, volume_confirmed=None,
    min_rr=None, symbol=None, pattern_id=None,
    min_base_days=None, max_range_pct=None, q=None, sort="confidence",
) -> dict:
    return {
        "job_id": job_id,
        "universe": universe,
        "timeframe": timeframe,
        "family": family,
        "direction": direction,
        "status": status,
        "quality": quality,
        "formed_within_bars": formed_within_bars,
        "volume_confirmed": volume_confirmed,
        "min_rr": min_rr,
        "symbol": symbol,
        "pattern_id": pattern_id,
        "min_base_days": min_base_days,
        "max_range_pct": max_range_pct,
        "q": q,
        "sort": sort,
    }


@router.get("/results")
async def get_results(
    job_id: Optional[str] = Query(None),
    universe: Optional[str] = Query(None),
    timeframe: Optional[str] = Query(None),
    family: Optional[list[str]] = Query(None),
    direction: Optional[list[str]] = Query(None),
    status: Optional[list[str]] = Query(None),
    quality: Optional[str] = Query(None),
    formed_within_bars: Optional[int] = Query(None),
    volume_confirmed: Optional[bool] = Query(None),
    min_rr: Optional[float] = Query(None),
    symbol: Optional[list[str]] = Query(None),
    pattern_id: Optional[list[str]] = Query(None),
    min_base_days: Optional[int] = Query(None),
    max_range_pct: Optional[float] = Query(None),
    q: Optional[str] = Query(None),
    sort: str = Query("confidence"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    filters = _build_filters(
        job_id, universe, timeframe, family, direction, status, quality,
        formed_within_bars, volume_confirmed, min_rr, symbol, pattern_id,
        min_base_days, max_range_pct, q, sort=sort,
    )
    items, total, summary = store.query_results(filters, limit=limit, offset=offset)
    # Candle enrichment may hit the (disk-cached) Upstox API on a miss — keep it
    # off the event loop so a slow/hung fetch cannot freeze the whole server.
    await run_in_threadpool(_enrich_with_candles, items, timeframe)
    return _sanitize_for_json({
        "items": items,
        "total": total,
        "summary": summary,
        "data_through": summary.get("data_through"),
    })


@router.get("/summary")
async def get_summary(
    job_id: Optional[str] = Query(None),
    universe: Optional[str] = Query(None),
    timeframe: Optional[str] = Query(None),
    family: Optional[list[str]] = Query(None),
    direction: Optional[list[str]] = Query(None),
    status: Optional[list[str]] = Query(None),
    quality: Optional[str] = Query(None),
    formed_within_bars: Optional[int] = Query(None),
    volume_confirmed: Optional[bool] = Query(None),
    min_rr: Optional[float] = Query(None),
    symbol: Optional[list[str]] = Query(None),
    pattern_id: Optional[list[str]] = Query(None),
    min_base_days: Optional[int] = Query(None),
    max_range_pct: Optional[float] = Query(None),
    q: Optional[str] = Query(None),
    sort: str = Query("confidence"),
):
    filters = _build_filters(
        job_id, universe, timeframe, family, direction, status, quality,
        formed_within_bars, volume_confirmed, min_rr, symbol, pattern_id,
        min_base_days, max_range_pct, q, sort=sort,
    )
    summary = store.compute_summary(filters)
    return _sanitize_for_json({
        "scanned": summary.get("scanned", 0),
        "patterns": summary.get("patterns", 0),
        "in_view": summary.get("in_view", 0),
        "confirmed": summary.get("confirmed", 0),
        "bullish": summary.get("bullish", 0),
        "bearish": summary.get("bearish", 0),
        "data_through": summary.get("data_through"),
        "last_scan_at": summary.get("last_scan_at"),
        "pattern_counts": summary.get("pattern_counts", {}),
        "family_counts": summary.get("family_counts", {}),
    })


def _candle_fields(symbol: str, timeframe: str) -> dict:
    try:
        df = candles.fetch_for_timeframe(symbol, timeframe, lookback_bars=500)
    except Exception:
        df = None
    if df is None or getattr(df, "empty", True):
        return {"last_close": None, "day_change_pct": None, "history_bars": 0}
    try:
        close = float(df["close"].iloc[-1])
        prev = float(df["close"].iloc[-2]) if len(df) > 1 else close
        change = ((close - prev) / prev * 100.0) if prev else 0.0
        return {"last_close": close, "day_change_pct": round(change, 2), "history_bars": int(len(df))}
    except Exception:
        return {"last_close": None, "day_change_pct": None, "history_bars": int(len(df))}


@router.get("/symbol/{symbol}")
async def get_symbol(symbol: str, timeframe: str = Query("1D")):
    detail = store.get_symbol_detail(symbol, timeframe)
    detail.update(await run_in_threadpool(_candle_fields, symbol, timeframe))
    await run_in_threadpool(_enrich_with_candles, detail.get("patterns", []), timeframe)
    if not detail.get("name"):
        detail["name"] = _lookup_name(symbol)
    return _sanitize_for_json(detail)


@router.get("/symbol/{symbol}/chart")
async def get_symbol_chart(
    symbol: str,
    timeframe: str = Query("1D"),
    limit: int = Query(2000, ge=1, le=2000),
    lookback_bars: Optional[int] = Query(None),
):
    try:
        lb = lookback_bars if lookback_bars is not None else 500
        df = candles.fetch_for_timeframe(symbol, timeframe, lookback_bars=lb)
    except Exception:
        df = None
    series = candles.candles_to_series(df, limit) if df is not None else []
    detail = store.get_symbol_detail(symbol, timeframe)
    overlays = []
    for pattern in detail.get("patterns", []):
        if pattern.get("trendlines"):
            overlays.append({
                "pattern_id": pattern.get("pattern_id"),
                "pattern_name": pattern.get("pattern_name"),
                "direction": pattern.get("direction"),
                "trendlines": pattern.get("trendlines"),
                "start_date": pattern.get("start_date"),
                "end_date": pattern.get("end_date"),
                "id": pattern.get("id"),
            })
    try:
        _res = trendlines_mod.detect_trendlines(df)
        trend_lines = [v for v in (_res.get("support"), _res.get("resistance")) if v] if isinstance(_res, dict) else []
    except Exception:
        trend_lines = []
    return _sanitize_for_json({
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "candles": series,
        "overlays": overlays,
        "trend_lines": trend_lines,
    })

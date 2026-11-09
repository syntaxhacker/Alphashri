"""Chart-patterns API (CONTRACT.md §5).

Router prefix ``/api/chart-patterns``. All responses are JSON-sanitized. The
scan endpoint is auth-gated; read-only market endpoints mirror the ``/api/chart``
precedent (open).
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import queue as _queue
import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import NamedTuple, Optional

from sqlalchemy.orm import Session

from db.database import get_db

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from chart_patterns import candles, config, jobs, store
from chart_patterns import scan as scan_mod
from chart_patterns import trendlines as trendlines_mod
from chart_patterns import watch as watch_mod
from chart_patterns.tags import tags_for
from chart_patterns.parallel import max_workers as _parallel_max_workers

import config as root_config

try:
    from chart_patterns import engine as engine_mod
except Exception:  # pragma: no cover - engine always present in app env
    engine_mod = None
from db.models.user import User
from api.auth import get_current_user
from api.utils import _sanitize_for_json

router = APIRouter(prefix="/api/chart-patterns", tags=["chart-patterns"])

# Risk sizing (stop/target/breakout/RR) is the trader's job, not the pattern
# engine's. The DB keeps the columns for the watch trigger, but the API never
# exposes them to the chart/scan.
_RISK_FIELDS = ("breakout_level", "target", "stop", "rr", "breakout_score")


def _strip_risk_fields(items) -> None:
    for item in items or []:
        if isinstance(item, dict):
            for key in _RISK_FIELDS:
                item.pop(key, None)


def _json_response(payload) -> JSONResponse:
    """Sanitize once, then serialize directly instead of letting FastAPI re-encode.

    Every endpoint previously wrote ``JSONResponse(content=_sanitize_for_json(x))``
    (or ``return _sanitize_for_json(x)``). The dict form makes FastAPI run a
    second full ``jsonable_encoder`` traversal — costly on candle-heavy cards.
    Both forms produce the same wire body: ``_sanitize_for_json`` has already
    flattened every leaf, and ``JSONResponse`` refuses NaN/Inf (``allow_nan``
    is off), so nothing sanitizable reaches the encoder either way.
    """
    return JSONResponse(content=_sanitize_for_json(payload))


# ---------------------------------------------------------------------------
# Frozen fallbacks (CONTRACT.md §1/§2) — used only if Agent 1's registries are
# unavailable so this router stays functional during integration.
# ---------------------------------------------------------------------------

_FALLBACK_TIMEFRAMES = [
    {"id": "1m", "label": "1m", "minutes": 1, "native": True, "source_tf": None, "max_lookback_days": 30, "min_bars": 60},
    {"id": "5m", "label": "5m", "minutes": 5, "native": True, "source_tf": None, "max_lookback_days": 90, "min_bars": 60},
    {"id": "10m", "label": "10m", "minutes": 10, "native": True, "source_tf": None, "max_lookback_days": 90, "min_bars": 60},
    {"id": "15m", "label": "15m", "minutes": 15, "native": True, "source_tf": None, "max_lookback_days": 90, "min_bars": 60},
    {"id": "30m", "label": "30m", "minutes": 30, "native": True, "source_tf": None, "max_lookback_days": 180, "min_bars": 60},
    {"id": "1h", "label": "1h", "minutes": 60, "native": True, "source_tf": None, "max_lookback_days": 365, "min_bars": 60},
    {"id": "3h", "label": "3h", "minutes": 180, "native": False, "source_tf": "1h", "max_lookback_days": 365, "min_bars": 60},
    {"id": "4h", "label": "4h", "minutes": 240, "native": False, "source_tf": "1h", "max_lookback_days": 365, "min_bars": 60},
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


# Candle ``t`` strings depend only on the frame index, and every symbol
# fetched for the same session shares the same trading calendar — reformatting
# 712 timestamps per distinct symbol is pure recomputation. The lists are
# time-invariant for a given (tz, length, timestamp bytes) key, so a small
# bounded cache turns a ~1.8 ms per-frame isoformat loop into a lookup.
_TS_CACHE_LOCK = threading.Lock()
_TS_CACHE: dict = {}
_TS_CACHE_MAX = 8


# ---------------------------------------------------------------------------
# Short-TTL read cache (stale-scan-safe)
#
# ``/summary`` and ``/matrix`` re-query the store on every UI poll, but the
# underlying hit set only changes when a new scan completes. Entries are keyed
# on the ``last_scan_at`` of the latest completed job for the requested
# universe/timeframe(s), plus a 3-second TTL backstop: if a newer scan
# finishes, the key changes and the recompute runs immediately, so no
# response can outlive the scan it was built from by more than the TTL.
# ``/results`` is deliberately *not* cached (enrichment + fresh cards).
# ---------------------------------------------------------------------------

_READ_CACHE_TTL_SEC = 3.0
_summary_cache: dict = {}
_matrix_cache: dict = {}
_read_cache_lock = threading.Lock()
_READ_CACHE_MAX_ENTRIES = 64


def _freeze_filters(filters: dict) -> tuple:
    """Hashable snapshot of a store filter dict (lists become tuples)."""
    items = []
    for key in sorted(filters):
        value = filters[key]
        if isinstance(value, list):
            value = tuple(value)
        items.append((key, value))
    return tuple(items)


def _last_scan_at_for(universe, timeframe):
    """Latest completed job's ``finished_at`` for a combo (``None``-safe)."""
    try:
        session = store._new_session()
        try:
            return store._last_scan_at(session, {"universe": universe, "timeframe": timeframe})
        finally:
            session.close()
    except Exception:
        return None


def _read_cache_get(cache: dict, key):
    now = _time.monotonic()
    with _read_cache_lock:
        entry = cache.get(key)
        if entry is None:
            return None
        expires, payload = entry
        if now < expires:
            return payload
        cache.pop(key, None)
        return None


def _read_cache_put(cache: dict, key, payload) -> None:
    now = _time.monotonic()
    with _read_cache_lock:
        while len(cache) >= _READ_CACHE_MAX_ENTRIES:
            cache.pop(next(iter(cache)), None)
        cache[key] = (now + _READ_CACHE_TTL_SEC, payload)


def _clear_read_caches() -> None:
    """Drop the short-TTL read caches (tests + operator resets)."""
    with _read_cache_lock:
        _summary_cache.clear()
        _matrix_cache.clear()


# ---------------------------------------------------------------------------
# Symbol chart fetch: hard timeout + negative cache for empty results.
#
# A missing/slow symbol (Upstox DNS failure, hung feed) must not hold
# ``GET /symbol/{symbol}/chart`` for 30s and then repeat the wait on every
# click. The upstream fetch is capped by ``CHART_FETCH_TIMEOUT_SEC``; on
# timeout or an empty frame the endpoint answers ``{"candles":[]}`` with an
# ``error``/``note`` instead of 500. Empty results are cached per
# ``(symbol, timeframe, IST session)`` for ~5 minutes so a repeat click is
# instant; entries never outlive the session they were taken in.
# ---------------------------------------------------------------------------

#: Hard upper bound on one symbol-chart candle fetch (seconds). Env-overridable
#: for deployments on slower feeds; 0 disables the cap.
_CHART_FETCH_TIMEOUT_SEC = float(os.environ.get("CHART_FETCH_TIMEOUT_SEC", "7.0"))
#: TTL of a negative (empty-result) cache entry (seconds).
_CHART_NEG_CACHE_TTL_SEC = float(os.environ.get("CHART_NEG_CACHE_TTL_SEC", "300.0"))
_CHART_NEG_CACHE_MAX = 256

_chart_neg_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}
_chart_neg_cache_lock = threading.Lock()
_chart_logger = logging.getLogger(__name__)


def _ist_session_date() -> str:
    """Today's IST session date — the date component of the negative-cache key."""
    return datetime.now(root_config.IST).strftime("%Y-%m-%d")


def _chart_neg_cache_get(symbol: str, timeframe: str, session: str) -> Optional[dict]:
    now = _time.monotonic()
    key = (str(symbol).upper(), str(timeframe), session)
    with _chart_neg_cache_lock:
        entry = _chart_neg_cache.get(key)
        if entry is None:
            return None
        expires, payload = entry
        if now < expires:
            return payload
        _chart_neg_cache.pop(key, None)
        return None


def _chart_neg_cache_put(symbol: str, timeframe: str, session: str, payload: dict) -> None:
    now = _time.monotonic()
    key = (str(symbol).upper(), str(timeframe), session)
    with _chart_neg_cache_lock:
        while len(_chart_neg_cache) >= _CHART_NEG_CACHE_MAX:
            _chart_neg_cache.pop(next(iter(_chart_neg_cache)), None)
        _chart_neg_cache[key] = (now + _CHART_NEG_CACHE_TTL_SEC, payload)


def _chart_empty_payload(symbol: str, timeframe: str, *, reason: str, note: str) -> dict:
    """Empty chart answer carrying a machine-readable ``error`` + human ``note``."""
    return {
        "symbol": str(symbol).upper(),
        "timeframe": timeframe,
        "candles": [],
        "overlays": [],
        "trend_lines": [],
        "error": reason,
        "note": note,
    }


def _log_chart_fetch(
    symbol: str,
    timeframe: str,
    *,
    elapsed_ms: float,
    rows: int,
    cache_hit: bool,
    timeout: bool,
    error: Optional[str],
) -> None:
    _chart_logger.info(
        "chart_fetch symbol=%s timeframe=%s elapsed_ms=%.0f rows=%d cache_hit=%s timeout=%s error=%s",
        symbol, timeframe, elapsed_ms, rows, bool(cache_hit), bool(timeout), error or "",
    )


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
        from chart_patterns import timeframe_config

        rows = timeframe_config.enabled_timeframes()
        if rows:
            return [_spec_to_dict(row) for row in rows]
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
    """Enabled timeframe ids, falling back to the frozen list."""
    try:
        from chart_patterns import timeframe_config

        ids = timeframe_config.enabled_timeframe_ids()
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


def _slice_candles(df, start_date, end_date, max_bars: int = config.CARD_MAX_BARS):
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
        return _fast_candle_series(df.iloc[lo:hi + 1], max_bars)
    # Uniform downsample across the whole window, always keeping pattern
    # endpoints. Exactly max_bars points are picked (lo/hi from the linspace
    # edges, si/ei swapped in for their nearest non-critical neighbour), so
    # the follow-up candles_to_series(len(window)) call cannot tail() away
    # the pattern head.
    if max_bars < 2:
        keep = [i for i in (si, ei) if 0 <= i < n][:max(1, max_bars)] if max_bars else []
        return _fast_candle_series(df.iloc[keep], max(1, max_bars))
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
    return _fast_candle_series(window, len(window))


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


def _stored_lines_sig(item) -> Optional[str]:
    """Scan-time ``trend_lines_sig`` carried by a result item, else ``None``."""
    try:
        sig = item.get("trend_lines_sig")
    except Exception:
        return None
    return str(sig) if isinstance(sig, str) and sig else None


def _stored_lines_fresh(item, current_sig=None) -> bool:
    """True when stored ``trend_lines`` are non-empty and match the detector.

    After a detector change the stored lines are stale and must be recomputed
    so cards and fullscreen agree. ``current_sig`` lets batch callers compute
    the detector signature once per request instead of per item; when omitted
    it is built on demand.
    """
    if _stored_trend_lines(item) is None:
        return False
    if current_sig is None:
        current_sig = config.trendline_signature()
    return _stored_lines_sig(item) == current_sig


def _clamp_to_lookback(df, lookback_bars: Optional[int]):
    """Slice ``df`` to its last ``lookback_bars`` rows; passthrough otherwise.

    The fetch window carries ~1.5x headroom (``_lookback_days`` safety factor)
    so detection always sees enough bars; the displayed chart/cards are
    clamped to exactly the requested Lookback. ``None`` (Auto) or invalid
    values keep the whole fetched window.
    """
    if lookback_bars is None or df is None or getattr(df, "empty", True):
        return df
    try:
        n = int(lookback_bars)
    except (TypeError, ValueError):
        return df
    if n <= 0 or len(df) <= n:
        return df
    return df.tail(n)


def _ts_list(idx) -> list:
    """Isoformat timestamp strings for an index (calendar-cached)."""
    try:
        key = (str(getattr(idx, "tz", None)), len(idx), idx.asi8.tobytes())
    except Exception:
        return [t.isoformat() if hasattr(t, "isoformat") else str(t) for t in idx]
    with _TS_CACHE_LOCK:
        cached = _TS_CACHE.get(key)
    if cached is not None:
        return cached
    ts = [t.isoformat() if hasattr(t, "isoformat") else str(t) for t in idx]
    with _TS_CACHE_LOCK:
        while len(_TS_CACHE) >= _TS_CACHE_MAX:
            _TS_CACHE.pop(next(iter(_TS_CACHE)), None)
        _TS_CACHE[key] = ts
    return ts


def _fast_candle_series(frame, limit) -> list:
    """Vectorized twin of ``candles.candles_to_series`` (same ``{t,o,h,l,c,v}`` shape).

    ``iterrows`` with per-value ``import math`` costs ~20-27 ms per 500-bar
    frame; column arrays do the same row work in ~3 ms. Any unexpected frame
    shape falls back to :func:`candles.candles_to_series` so output never
    changes (NaN/Inf -> 0.0 and the tail/limit rule are mirrored).

    The limit slice is applied to the numpy arrays / index views instead of
    ``frame.tail()``, so no 700-row DataFrame copy runs per distinct symbol,
    and non-finite cleaning is vectorized (the per-scalar ``float`` /
    ``isinf`` pairing only pays up front in ``tolist``). Output is identical
    to the previous per-row loop.
    """
    if frame is None or getattr(frame, "empty", True):
        return []
    try:
        import numpy as _np

        n = len(frame)
        if limit and limit > 0:
            try:
                keep = int(limit)
            except (TypeError, ValueError):
                keep = 0
            if keep > 0 and n > keep:
                idx = frame.index[n - keep:]
            else:
                idx = frame.index
        else:
            idx = frame.index
        ts = _ts_list(idx)

        def _col(name: str) -> list:
            arr = frame[name].to_numpy(dtype=float)
            if limit and limit > 0:
                try:
                    keep = int(limit)
                except (TypeError, ValueError):
                    keep = 0
                if keep > 0 and len(arr) > keep:
                    arr = arr[len(arr) - keep:]
            if arr.size and not _np.isfinite(arr).all():
                arr = _np.where(_np.isfinite(arr), arr, 0.0)
            return arr.tolist()

        opens = _col("open")
        highs = _col("high")
        lows = _col("low")
        closes = _col("close")
        vols = _col("volume")
        series: list = []
        append = series.append
        for t, o, h, l, c, v in zip(ts, opens, highs, lows, closes, vols):
            append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v})
        return series
    except Exception:
        return candles.candles_to_series(frame, limit)


def _last_close_change(df) -> tuple[Optional[float], Optional[float]]:
    """Last close and its 2dp % change vs the previous bar, or ``(None, None)``.

    Shared by card enrichment (:func:`_finalize_item`) and the ``/symbol``
    header (:func:`_candle_fields`) so both report the same number from the
    same frame instead of two copies of the arithmetic drifting apart.
    """
    if df is None or getattr(df, "empty", True):
        return None, None
    try:
        vals = df["close"].to_numpy()
        close = float(vals[-1])
        prev = float(vals[-2]) if len(vals) > 1 else close
        change = ((close - prev) / prev * 100.0) if prev else 0.0
        return close, round(change, 2)
    except Exception:
        return None, None


def _clamped_candle_series(df, lookback_bars, limit) -> list:
    """Candle series tail-clamped to the Lookback, then to the chart limit.

    ``tail(N)`` followed by ``tail(limit)`` is ``tail(min(N, limit))``, so the
    clamp and the limit collapse into one series conversion. Never raises: a
    broken frame yields ``[]`` (same fail-soft stance as :func:`_finalize_item`).
    """
    try:
        frame = _clamp_to_lookback(df, lookback_bars)
        if frame is None or getattr(frame, "empty", True):
            return []
        return _fast_candle_series(frame, limit)
    except Exception:
        return []


def _cache_setdefault(cache, key, value, lock=None) -> None:
    """Insert ``value`` under ``key`` unless present; ``lock`` guards sharing.

    Batch and SSE paths share one per-request cache dict across threads, and
    first writer wins (duplicate ``(symbol, timeframe)`` work is wasted, not
    fatal).
    """
    if lock is None:
        cache.setdefault(key, value)
        return
    with lock:
        cache.setdefault(key, value)


def _finalize_item(item, df, *, key, lookback_bars, compute_trendlines, tl_cache, lock=None, current_sig=None):
    """Attach a candle window + last close/day change + trend lines to one item.

    Phase-2 of :func:`_enrich_with_candles`, factored so the SSE stream
    (``GET /results/stream``) reuses the exact per-item logic — a streamed
    item is byte-identical to its batched twin. ``key`` is the
    ``(symbol, timeframe)`` fetch key (``None`` when the item carries no
    symbol/timeframe); ``tl_cache`` maps keys to detector results. Pass
    ``lock`` when calling from worker threads (guards the shared caches).
    Mutates and returns ``item``; never raises for a dict item.
    """
    if isinstance(item, dict):
        item.setdefault("tags", tags_for(str(item.get("symbol") or "")))
    if current_sig is None:
        current_sig = config.trendline_signature()
    stored_lines = _stored_trend_lines(item) if _stored_lines_fresh(item, current_sig) else None
    if key is None:
        if isinstance(item, dict):
            item.setdefault("candles", [])
            item.setdefault("last_close", None)
            item.setdefault("day_change_pct", None)
            item["trend_lines"] = (stored_lines or []) if compute_trendlines else []
        return item
    # Per-key candle window + closes: result sets repeat (symbol, timeframe)
    # across patterns; rebuilding the series per item is the dominant
    # enrichment cost. Cache under a namespaced key in the shared ``tl_cache``
    # (the batch path and the SSE worker both share one dict per request), so
    # duplicates reuse one conversion. Sharing the list object is safe: the
    # endpoint deep-copies via ``_sanitize_for_json`` before serializing.
    series_key = ("__series__", key, lookback_bars)
    cached = tl_cache.get(series_key) if isinstance(tl_cache, dict) else None
    if cached is not None:
        item["candles"], item["last_close"], item["day_change_pct"] = cached
    else:
        candle_series = _clamped_candle_series(df, lookback_bars, config.CHART_MAX_BARS)
        last_close, day_change = _last_close_change(df)
        if isinstance(tl_cache, dict):
            _cache_setdefault(tl_cache, series_key, (candle_series, last_close, day_change), lock)
        item["candles"] = candle_series
        item["last_close"] = last_close
        item["day_change_pct"] = day_change
    if not compute_trendlines:
        item["trend_lines"] = []
        return item
    if stored_lines is not None:
        item["trend_lines"] = stored_lines
        return item
    if key not in tl_cache:
        try:
            if df is not None and not getattr(df, "empty", True):
                computed = trendlines_mod.detect_trendlines(df)
            else:
                computed = {"support": None, "resistance": None}
        except Exception:
            computed = {"support": None, "resistance": None}
        _cache_setdefault(tl_cache, key, computed, lock)
    try:
        res = tl_cache[key] or {}
        item["trend_lines"] = [v for v in (res.get("support"), res.get("resistance")) if v]
    except Exception:
        item["trend_lines"] = []
    return item


def _item_fetch_key(item, default_timeframe: Optional[str] = None):
    """``(symbol, timeframe)`` fetch key for a result item, or ``None``.

    Shared by the batch (:func:`_enrich_with_candles`) and SSE
    (:func:`_stream_results_worker`) paths so an item resolves the same frame
    in both — a per-item ``timeframe`` wins over the request default.
    """
    if not isinstance(item, dict):
        return None
    symbol = item.get("symbol")
    timeframe = item.get("timeframe") or default_timeframe
    if not symbol or not timeframe:
        return None
    return (symbol, timeframe)


def _distinct_fetch_keys(items, default_timeframe: Optional[str] = None) -> list:
    """Distinct per-item fetch keys, first-seen order (stable enrichment order)."""
    ordered: list = []
    seen: set = set()
    for item in items:
        key = _item_fetch_key(item, default_timeframe)
        if key is None or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def _fetch_candles_retry(symbol, timeframe, lookback_bars, *, log_failure: bool = False):
    """``fetch_for_timeframe`` with one retry; ``None`` after both attempts fail.

    Candle fetches routinely hit transient Upstox 429s (especially with bots
    consuming the shared budget), so a single retry turns most of those into
    hits instead of candle-less cards. ``_enrich_with_candles`` logs the final
    failure; the SSE worker stays quiet (the stream already surfaces errors).
    """
    last_exc = None
    for attempt in (0, 1):
        try:
            return candles.fetch_for_timeframe(symbol, timeframe, lookback_bars=lookback_bars)
        except Exception as exc:  # noqa: BLE001 - fail-soft per card
            last_exc = exc
            if attempt == 0:
                _time.sleep(0.5)
    if log_failure:
        import logging as _logging

        _logging.getLogger(__name__).warning(
            "card enrich: candle fetch failed for %s %s: %s",
            symbol, timeframe, last_exc,
        )
    return None


def _enrich_with_candles(items, default_timeframe: Optional[str] = None, max_bars: int = config.CARD_MAX_BARS,
                          lookback_bars: Optional[int] = None, compute_trendlines: bool = True):
    """Attach a real candle window + last close/day change to each result item.

    Candles are served from ``candles.fetch_for_timeframe`` (disk-cached), so
    this also retrofits hits persisted before candle windows were exposed.
    The fetch covers the full Lookback window (``lookback_bars`` or the
    ``READ_LOOKBACK_BARS`` default) for detection headroom, but when
    ``lookback_bars`` is provided the card window is clamped to exactly the
    last ``lookback_bars`` bars so card mini-charts span the Lookback. When
    ``lookback_bars`` is None (Auto) the whole fetched window is shown.
    Items already carrying fresh scan-time ``trend_lines`` (non-empty with a
    matching ``trend_lines_sig``) keep them; stale or blank lines are
    recomputed with the detector and overwritten.
    """
    _ = max_bars  # kept for backwards compatibility; cards now span the Lookback
    fetch_lb = lookback_bars or config.READ_LOOKBACK_BARS
    items = list(items or [])

    def _fetch_one(key) -> object:
        return _fetch_candles_retry(key[0], key[1], fetch_lb, log_failure=True)

    # Phase 1: collect the distinct fetch keys in first-seen order, then fan
    # the disk-cached ``fetch_for_timeframe`` calls out over a bounded thread
    # pool. Serial fetching is the market-hours bottleneck (each fetch is
    # ~0.5-3s under contention, so a 24-card page takes 20-40s); threads
    # overlap the I/O waits while pandas work stays on this thread below.
    # ``run_symbols`` does not fit (its worker takes a bare symbol, but each
    # key also carries its own timeframe), so only ``max_workers()`` is
    # reused for the pool bound.
    ordered_keys = _distinct_fetch_keys(items, default_timeframe)
    cache: dict = {}
    if len(ordered_keys) == 1:
        cache[ordered_keys[0]] = _fetch_one(ordered_keys[0])
    elif ordered_keys:
        try:
            workers = max(1, min(int(_parallel_max_workers()), len(ordered_keys)))
        except Exception:
            workers = min(8, len(ordered_keys))
        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for key, df in zip(ordered_keys, pool.map(_fetch_one, ordered_keys)):
                    cache[key] = df
        except Exception:
            # Pool failure (never expected): fall back to serial fetches so
            # the endpoint still returns rather than raising.
            for key in ordered_keys:
                if key not in cache:
                    cache[key] = _fetch_one(key)
    tl_cache: dict = {}
    # One detector signature per batch (instead of one rebuild per item).
    current_sig = config.trendline_signature()
    # Phase 2: per-item enrichment in the original order (clamp, series,
    # last close/day change, stored-vs-recomputed trendlines) — unchanged.
    for item in items:
        key = _item_fetch_key(item, default_timeframe)
        _finalize_item(
            item, cache.get(key) if key is not None else None, key=key,
            lookback_bars=lookback_bars, compute_trendlines=compute_trendlines,
            tl_cache=tl_cache, current_sig=current_sig,
        )
    return items


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class DetectRequest(BaseModel):
    """Single-symbol, synchronous pattern check (no job queue)."""

    symbol: str
    timeframe: str
    lookback_bars: Optional[int] = 150


class ScanRequest(BaseModel):
    universe: str = ""
    timeframe: str
    force: bool = False
    refresh: bool = False
    compute_trendlines: bool = True
    # Optional explicit symbol scope. When present, only these symbols are
    # scanned (the job is stored under the reserved ``custom`` universe), so a
    # caller can run detection on a hand-picked list without computing a whole
    # universe.
    symbols: Optional[list[str]] = None
    # Optional trailing window in bars. None = Auto (fetch max_lookback_days,
    # no slicing). When set, history covers N bars and detection sees only
    # the last N bars.
    lookback_bars: Optional[int] = None
    # Optional TradingView volume pre-filter (scan-time, before any candle
    # fetch). Percent for rel-volume, millions of shares for volume.
    min_rel_volume: Optional[float] = None
    min_volume_m: Optional[float] = None
    # Optional 10-day average volume floor in thousands of shares (K).
    min_avg_volume_10d: Optional[float] = None
    # Optional as-of replay window (IST ``YYYY-MM-DD`` or
    # ``YYYY-MM-DDTHH:MM[:SS]``). ``as_of_date`` pins the window end (and
    # truncates detection input to it); ``from_date`` pins the window start
    # and drops hits ending before it.
    as_of_date: Optional[str] = None
    from_date: Optional[str] = None
    # Optional current-session bar for daily scans. None (default) means on
    # for 1D (intraday frames already carry today's tape); explicit False
    # forces it off. Never applied to an as-of replay (scan forces it off).
    include_partial_today: Optional[bool] = None


# Upper bound on a custom scan's symbol list (matches the picker's practical
# size; keeps one request from enqueuing a universe-sized job by accident).
# Env-overridable via chart_patterns.config (default 200); kept importable
# here for backwards compatibility.
MAX_CUSTOM_SYMBOLS = config.CUSTOM_SYMBOLS_MAX


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
    return _json_response({"timeframes": _timeframes_payload()})


@router.get("/universes")
async def get_universes():
    return _json_response({"universes": _universes_payload(), "default": "nifty50"})


@router.get("/patterns")
async def get_patterns():
    return _json_response({"families": list(_FAMILIES), "patterns": _patterns_payload()})


@router.post("/detect")
def detect_one(request: DetectRequest, user: User = Depends(get_current_user)):
    """Run the detector on ONE symbol now and return the hits.

    The Nifty chart's PATTERNS button needs an answer in seconds. The queued
    scan can sit behind a 500-symbol universe job for minutes, so this bypasses
    the queue: fetch candles (disk-cached after the first call) → detect →
    return. No job row, no store writes.
    """
    symbol = (request.symbol or "").strip().upper()
    if not symbol:
        raise HTTPException(status_code=422, detail="symbol is required")
    tf = request.timeframe
    if tf not in _valid_timeframe_ids():
        raise HTTPException(status_code=422, detail=f"unknown timeframe {tf!r}")
    lookback = request.lookback_bars if isinstance(request.lookback_bars, int) else 150
    lookback = max(config.LOOKBACK_MIN, min(config.LOOKBACK_MAX, lookback))
    try:
        df = candles.fetch_for_timeframe(symbol, tf, lookback_bars=lookback)
    except Exception as exc:  # noqa: BLE001 - surface a clean 502
        raise HTTPException(status_code=502, detail=f"candles unavailable: {exc}") from exc
    if df is None or getattr(df, "empty", True):
        return _json_response({"symbol": symbol, "timeframe": tf, "data_through": None, "hits": [], "count": 0})
    data_through = candles.frame_last_date(df)
    if len(df) < scan_mod._resolve_min_bars(tf):
        return _json_response({"symbol": symbol, "timeframe": tf, "data_through": data_through, "hits": [], "count": 0})
    if len(df) > lookback:
        df = df.iloc[-lookback:]
    try:
        hits = scan_mod._detect(df, tf, symbol) or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"detector failed: {exc}") from exc
    items = []
    for hit in hits:
        try:
            items.append(scan_mod._hit_to_dict(hit))
        except Exception:
            continue
    # ONE pattern per symbol/timeframe — the most recent. A chart button shows
    # the live read, not a catalogue; the queued scan applies the same rule
    # (scan._process_symbol → _latest_record).
    if len(items) > 1:
        items = [scan_mod._latest_record(items)]
    # Sanitized like every other endpoint: a NaN in a detector float would
    # otherwise make JSONResponse (allow_nan=False) 500 the request.
    return _json_response({
        "symbol": symbol,
        "timeframe": tf,
        "data_through": data_through,
        "hits": items,
        "count": len(items),
    })


@router.post("/scan")
async def create_scan(request: ScanRequest, user: User = Depends(get_current_user)):
    if request.lookback_bars is not None and not (
        config.LOOKBACK_MIN <= request.lookback_bars <= config.LOOKBACK_MAX
    ):
        raise HTTPException(
            status_code=422,
            detail=f"lookback_bars must be between {config.LOOKBACK_MIN} and {config.LOOKBACK_MAX}",
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
    params["compute_trendlines"] = request.compute_trendlines
    if request.include_partial_today is not None:
        params["include_partial_today"] = request.include_partial_today
    if request.lookback_bars is not None:
        params["lookback_bars"] = request.lookback_bars
    if request.min_rel_volume is not None:
        params["min_rel_volume"] = request.min_rel_volume
    if request.min_volume_m is not None:
        params["min_volume_m"] = request.min_volume_m
    if request.min_avg_volume_10d is not None:
        params["min_avg_volume_10d"] = request.min_avg_volume_10d
    if request.timeframe not in _valid_timeframe_ids():
        raise HTTPException(
            status_code=422,
            detail=f"unknown timeframe {request.timeframe!r}. Known: {sorted(_valid_timeframe_ids())}",
        )
    if request.as_of_date is not None:
        try:
            candles.parse_asof_datetime(request.as_of_date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        params["as_of_date"] = request.as_of_date
    if request.from_date is not None:
        try:
            candles.parse_asof_datetime(request.from_date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        params["from_date"] = request.from_date
    if "as_of_date" in params or "from_date" in params:
        # Replays fetch explicit historical windows per symbol — cap the
        # resolved scope so one request cannot enqueue a universe-sized job.
        # Custom scopes count unique requested symbols *before* the
        # MAX_CUSTOM_SYMBOLS truncation so an oversized list is rejected
        # rather than silently truncated.
        if symbols:
            unique_requested = {
                str(item or "").strip().upper() for item in (request.symbols or [])
            }
            unique_requested.discard("")
            replay_count = len(unique_requested)
        else:
            try:
                from chart_patterns import universes as _universes_mod

                replay_count = _count_universe(_universes_mod, universe)
            except Exception:
                replay_count = 0
        if replay_count > scan_mod.ASOF_SCAN_MAX_SYMBOLS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"as-of replay is capped at {scan_mod.ASOF_SCAN_MAX_SYMBOLS} symbols "
                    f"(requested {replay_count})"
                ),
            )
    if request.refresh:
        if symbols:
            candles.clear_cache(symbols=symbols, timeframe=request.timeframe)
        else:
            candles.clear_cache(timeframe=request.timeframe)
        params["force"] = True
        params["refresh"] = True
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
    return _json_response({
        "job_id": dto["job_id"],
        "status": dto["status"],
        "queue_position": dto["queue_position"],
        "queue_size": jobs.queue_size(),
    })


@router.get("/jobs")
async def list_jobs(active: int = Query(0, ge=0, le=1)):
    rows = jobs.list_active() if active else store.list_jobs(limit=50)
    return _json_response({"jobs": rows})


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    dto = jobs.get_job(job_id)
    if not dto:
        raise HTTPException(status_code=404, detail="job not found")
    return _json_response(dto)


def _build_filters(
    job_id=None, universe=None, timeframe=None, family=None, direction=None,
    status=None, quality=None, formed_within_bars=None, volume_confirmed=None,
    min_rr=None, symbol=None, pattern_id=None,
    min_base_days=None, max_range_pct=None, q=None, sort="confidence",
    max_52w_gap=None, min_range_pos=None, from_date=None, to_date=None,
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
        "max_52w_gap": max_52w_gap,
        "min_range_pos": min_range_pos,
        "from_date": from_date,
        "to_date": to_date,
    }


class _ResultsQuery(NamedTuple):
    """Resolved query for the ``/results`` and ``/results/stream`` twins."""

    filters: dict
    limit: int
    offset: int
    lookback_bars: Optional[int]
    compute_trendlines: bool


def _results_query(
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
    limit: int = Query(100, ge=1, le=config.RESULTS_MAX_LIMIT),
    offset: int = Query(0, ge=0),
    lookback_bars: Optional[int] = Query(None),
    compute_trendlines: bool = Query(True),
    max_52w_gap: Optional[float] = Query(None),
    min_range_pos: Optional[float] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
) -> _ResultsQuery:
    """Query params shared by ``/results`` and ``/results/stream``.

    Declared in the same order as the original endpoint signatures so the
    generated OpenAPI parameter list is unchanged. FastAPI hoists a
    dependency's query params in declaration order; both routes have no other
    query params, so the operation stays byte-identical.
    """
    return _ResultsQuery(
        filters=_build_filters(
            job_id, universe, timeframe, family, direction, status, quality,
            formed_within_bars, volume_confirmed, min_rr, symbol, pattern_id,
            min_base_days, max_range_pct, q, sort=sort, max_52w_gap=max_52w_gap,
            min_range_pos=min_range_pos, from_date=from_date, to_date=to_date,
        ),
        limit=limit,
        offset=offset,
        lookback_bars=lookback_bars,
        compute_trendlines=compute_trendlines,
    )


def _summary_filters(
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
    max_52w_gap: Optional[float] = Query(None),
    min_range_pos: Optional[float] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
) -> dict:
    """Query params for ``/summary`` (same filter set, no paging/chart knobs)."""
    return _build_filters(
        job_id, universe, timeframe, family, direction, status, quality,
        formed_within_bars, volume_confirmed, min_rr, symbol, pattern_id,
        min_base_days, max_range_pct, q, sort=sort, max_52w_gap=max_52w_gap,
        min_range_pos=min_range_pos, from_date=from_date, to_date=to_date,
    )


# ---------------------------------------------------------------------------
# SSE streaming (Patterns screen progressive render).
# ---------------------------------------------------------------------------

#: Defensive cap on streamed items per response (the ``limit`` query param is
#: already bounded by ``RESULTS_MAX_LIMIT``; this guards programmatic callers
#: of the generator against unbounded lists).
_STREAM_MAX_ITEMS = 1000

#: Bounded fan-out for per-item enrichment workers (mirrors the batch path's
#: ``max_workers()`` bound; never exceeds the item count).
_STREAM_POOL_WORKERS = 8

#: SSE keep-alive: the drain emits ``event: heartbeat`` after this many idle
#: seconds so proxies do not close a slow stream.
_STREAM_HEARTBEAT_SEC = 15.0

#: ``watch.live`` batches LTP/TV/vol_adj across its whole input, so the watch
#: live stream fans rows off in chunks instead of one ``live([row])`` call per
#: row (159 armed rows were ~159 separate price/TV/volume calls — the hang).
_STREAM_LIVE_CHUNK = 50

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse_event(name: str, payload) -> str:
    """One SSE frame. Payloads are pre-sanitized, then ``json.dumps``-ed.

    ``sse_starlette`` does NOT auto-serialize dicts, so every payload goes
    through :func:`json.dumps` explicitly (same discipline as
    ``api/paper/live_stream.py`` and the trading-agents stream).
    """
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"


def _iter_completed_results(futs, stop, out):
    """Yield finished futures' results in completion order; abort on stop/failure.

    Shared by the results and watch stream workers: both bridge a
    ``ThreadPoolExecutor`` to ``_drain_stream_queue`` via ``out``. On a task
    failure the error is enqueued once (``("error", message)``) and pending
    futures are cancelled; both exits end iteration so the caller's
    ``finally`` still terminates the queue with ``("end", None)``.
    """
    for fut in as_completed(futs):
        if stop.is_set():
            for pending in futs:
                pending.cancel()
            return
        try:
            yield fut.result()
        except Exception as exc:
            try:
                out.put(("error", str(exc)[:300]))
            except Exception:
                pass
            for pending in futs:
                pending.cancel()
            return


def _stream_results_worker(items, *, default_timeframe, fetch_lb, lookback_bars,
                           compute_trendlines, out, stop):
    """Enrich each item on a bounded pool, enqueueing as results arrive.

    Queue protocol: ``("item", sanitized_dict)`` per enriched card,
    ``("error", message)`` on a task failure, always terminated by
    ``("end", None)``. Never raises (the terminator is sent from ``finally``).
    """
    df_cache: dict = {}
    tl_cache: dict = {}
    lock = threading.Lock()
    current_sig = config.trendline_signature()

    def _cached_fetch(key):
        with lock:
            if key in df_cache:
                return df_cache[key]
        df = _fetch_candles_retry(key[0], key[1], fetch_lb)
        with lock:
            df_cache.setdefault(key, df)
        return df_cache.get(key)

    def _task(item):
        if stop.is_set():
            return None
        key = _item_fetch_key(item, default_timeframe)
        df = _cached_fetch(key) if key is not None else None
        return _finalize_item(
            item, df, key=key, lookback_bars=lookback_bars,
            compute_trendlines=compute_trendlines, tl_cache=tl_cache, lock=lock,
            current_sig=current_sig,
        )

    try:
        workers = max(1, min(_STREAM_POOL_WORKERS, len(items) or 1))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(_task, item) for item in items]
            for enriched in _iter_completed_results(futs, stop, out):
                if enriched is None:
                    continue
                try:
                    out.put(("item", _sanitize_for_json(enriched)))
                except Exception:
                    pass
    except Exception as exc:  # pragma: no cover - defensive; worker never raises
        try:
            out.put(("error", str(exc)[:300]))
        except Exception:
            pass
    finally:
        try:
            out.put(("end", None))
        except Exception:
            pass


async def _drain_stream_queue(out, request, stop):
    """Yield ``(kind, payload)`` queue entries; ``("closed", None)`` on disconnect.

    Polls ``request.is_disconnected()`` (when a request is attached) while
    waiting so a gone client stops production promptly.
    """
    loop = asyncio.get_running_loop()
    while True:
        if request is not None:
            try:
                if await request.is_disconnected():
                    stop.set()
                    yield ("closed", None)
                    return
            except Exception:
                pass
        try:
            kind, payload = await loop.run_in_executor(
                None, lambda: out.get(timeout=_STREAM_HEARTBEAT_SEC)
            )
        except _queue.Empty:
            yield ("heartbeat", {})
            continue
        yield (kind, payload)
        if kind in ("end", "error"):
            return


async def _results_sse_events(items, *, default_timeframe, lookback_bars,
                              compute_trendlines, total, summary, data_through,
                              request=None):
    """Async SSE body for ``GET /results/stream`` (also drives the tests).

    Emits ``meta`` immediately (before any candle fetch), one ``item`` per
    fully enriched card as each enrichment completes, then ``done``. Never
    raises mid-stream: unexpected failures become ``event: error`` and close
    the stream.
    """
    try:
        yield _sse_event("meta", _sanitize_for_json({
            "total": total, "summary": summary, "data_through": data_through,
        }))
    except Exception as exc:
        yield _sse_event("error", {"message": str(exc)[:300]})
        return
    stream_items = list(items or [])[:_STREAM_MAX_ITEMS]
    if not stream_items:
        yield _sse_event("done", {})
        return
    fetch_lb = lookback_bars or config.READ_LOOKBACK_BARS
    out: _queue.Queue = _queue.Queue(maxsize=_STREAM_MAX_ITEMS + 10)
    stop = threading.Event()
    worker = threading.Thread(
        target=_stream_results_worker,
        kwargs={
            "items": stream_items, "default_timeframe": default_timeframe,
            "fetch_lb": fetch_lb, "lookback_bars": lookback_bars,
            "compute_trendlines": compute_trendlines, "out": out, "stop": stop,
        },
        daemon=True,
    )
    worker.start()
    try:
        async for kind, payload in _drain_stream_queue(out, request, stop):
            if kind == "item":
                yield _sse_event("item", payload)
            elif kind == "error":
                message = payload if isinstance(payload, str) else "enrichment failed"
                yield _sse_event("error", {"message": message})
                return
            elif kind == "heartbeat":
                yield _sse_event("heartbeat", {})
            elif kind == "end":
                yield _sse_event("done", {})
                return
            elif kind == "closed":
                return
    finally:
        stop.set()


@router.get("/results")
async def get_results(query: _ResultsQuery = Depends(_results_query)):
    items, total, summary = store.query_results(
        query.filters, limit=query.limit, offset=query.offset,
    )
    # Candle enrichment may hit the (disk-cached) Upstox API on a miss — keep it
    # off the event loop so a slow/hung fetch cannot freeze the whole server.
    # The card window spans the active Lookback so mini-charts match the view.
    await run_in_threadpool(_enrich_with_candles, items, query.filters.get("timeframe"),
                            lookback_bars=query.lookback_bars,
                            compute_trendlines=query.compute_trendlines)
    _strip_risk_fields(items)
    return _json_response({
        "items": items,
        "total": total,
        "summary": summary,
        "data_through": summary.get("data_through"),
    })


@router.get("/index/{index_id}/members")
def get_index_members(index_id: str):
    from chart_patterns.index_members import NO_MEMBERS_INDEX_IDS, members_for_index
    from chart_patterns.indices import INDEX_LABELS

    key = str(index_id or "").strip().upper()
    try:
        symbols = members_for_index(key)
    except Exception as exc:
        import logging as _logging

        _logging.getLogger(__name__).warning("index members failed for %s: %s", key, exc)
        raise HTTPException(status_code=503, detail="Failed to load index constituents") from exc
    if symbols is None:
        raise HTTPException(
            status_code=404,
            detail=f"Constituents are not available for {index_id!r}",
        )
    payload = {
        "index": key,
        "label": INDEX_LABELS.get(key, key),
        "count": len(symbols),
        "symbols": symbols,
    }
    if key in NO_MEMBERS_INDEX_IDS:
        payload["note"] = "Volatility index has no constituent stocks."
    return _json_response(payload)


@router.get("/hit/{hit_id}")
def get_hit(hit_id: int, db: Session = Depends(get_db)):
    from db.models.chart_patterns import PatternHit

    row = db.query(PatternHit).filter(PatternHit.id == hit_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Pattern hit not found")
    return _json_response(row.to_dict())


@router.get("/results/stream")
async def stream_results(request: Request, query: _ResultsQuery = Depends(_results_query)):
    """SSE twin of ``GET /results`` (same query params, read-only, open).

    Events: ``meta`` → ``{total, summary, data_through}`` (immediately, before
    any candle fetch); ``item`` → one fully enriched card (byte-identical to
    the ``/results`` item via :func:`_finalize_item`); ``done`` → ``{}``.
    Items stream as each enrichment completes on a bounded pool (a
    ``queue.Queue`` bridge, like ``api/paper/live_stream.py``); the store
    query itself is instant, only the enrichment is slow. Client disconnect
    stops production. Never raises mid-stream (``event: error`` + close).
    """
    filters = query.filters

    async def _body():
        try:
            items, total, summary = store.query_results(
                filters, limit=query.limit, offset=query.offset,
            )
        except Exception as exc:
            yield _sse_event("error", {"message": str(exc)[:300]})
            return
        _strip_risk_fields(items)
        async for frame in _results_sse_events(
            items, default_timeframe=filters.get("timeframe"),
            lookback_bars=query.lookback_bars,
            compute_trendlines=query.compute_trendlines, total=total,
            summary=summary, data_through=summary.get("data_through"),
            request=request,
        ):
            yield frame

    return StreamingResponse(_body(), media_type="text/event-stream", headers=dict(_SSE_HEADERS))


@router.get("/summary")
async def get_summary(filters: dict = Depends(_summary_filters)):
    cache_key = (
        getattr(store, "_session_factory", None),
        _freeze_filters(filters),
        _last_scan_at_for(filters.get("universe"), filters.get("timeframe")),
    )
    cached = _read_cache_get(_summary_cache, cache_key)
    if cached is not None:
        return JSONResponse(content=cached)
    summary = store.compute_summary(filters)
    payload = _sanitize_for_json({
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
    _read_cache_put(_summary_cache, cache_key, payload)
    return JSONResponse(content=payload)


def _candle_fields(symbol: str, timeframe: str) -> dict:
    try:
        df = candles.fetch_for_timeframe(symbol, timeframe, lookback_bars=config.READ_LOOKBACK_BARS)
    except Exception:
        df = None
    if df is None or getattr(df, "empty", True):
        return {"last_close": None, "day_change_pct": None, "history_bars": 0}
    last_close, day_change = _last_close_change(df)
    return {"last_close": last_close, "day_change_pct": day_change, "history_bars": int(len(df))}


@router.get("/symbol/{symbol}")
async def get_symbol(
    symbol: str,
    timeframe: str = Query("1D"),
    limit: int = Query(0, ge=0, le=50),
    non_overlapping: bool = Query(False),
):
    detail = store.get_symbol_detail(
        symbol, timeframe, limit=limit or None, non_overlapping=non_overlapping
    )
    detail.update(await run_in_threadpool(_candle_fields, symbol, timeframe))
    await run_in_threadpool(_enrich_with_candles, detail.get("patterns", []), timeframe)
    _strip_risk_fields(detail.get("patterns", []))
    if not detail.get("name"):
        detail["name"] = _lookup_name(symbol)
    return _json_response(detail)


def _live_hit_to_dict(hit, symbol: str, timeframe: str) -> Optional[dict]:
    """Serialize a live engine hit to a ``PatternHitDTO``-shaped dict.

    Never raises: unserializable hits return ``None`` (caller drops them).
    """
    try:
        if isinstance(hit, dict):
            record = dict(hit)
        elif dataclasses.is_dataclass(hit):
            record = dataclasses.asdict(hit)
        elif hasattr(hit, "to_dict"):
            record = hit.to_dict()
        elif hasattr(hit, "__dict__"):
            record = {k: v for k, v in vars(hit).items() if not k.startswith("_")}
        else:
            return None
    except Exception:
        return None
    if not isinstance(record, dict):
        return None
    record.setdefault("symbol", symbol.upper())
    record.setdefault("timeframe", timeframe)
    return record


def _live_overlay(hit: dict) -> Optional[dict]:
    """Overlay for one live hit — same shape as the stored-pattern overlays."""
    try:
        if not hit.get("trendlines"):
            return None
        return {
            "pattern_id": hit.get("pattern_id"),
            "pattern_name": hit.get("pattern_name"),
            "direction": hit.get("direction"),
            "trendlines": hit.get("trendlines"),
            "start_date": hit.get("start_date"),
            "end_date": hit.get("end_date"),
            "id": hit.get("id"),
        }
    except Exception:
        return None


async def _asof_symbol_chart(
    symbol: str,
    timeframe: str,
    limit: int,
    lookback_bars: Optional[int],
    compute_trendlines: bool,
    detect_patterns: bool,
    as_of_date: str,
    from_date: Optional[str],
) -> dict:
    """Replay chart: the frame is truncated to ``as_of_date`` (IST).

    Stored overlays/trend lines are "now" and never apply to a replay, so
    they are omitted: ``trend_lines`` are recomputed on the truncated frame
    and ``overlays``/``hits`` come only from live detection on it (windowed
    by ``from_date`` when set). ``include_partial_today`` is forced off —
    a replay frame ends at ``to_dt``, never with a synthetic today bar.
    """
    try:
        to_dt = candles.parse_asof_datetime(as_of_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    from_part = None
    if from_date is not None:
        try:
            from_part = candles.parse_asof_datetime(from_date).strftime("%Y-%m-%d")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    lb = lookback_bars if lookback_bars is not None else config.READ_LOOKBACK_BARS
    fetch_kwargs: dict = {"lookback_bars": lb, "as_of_date": to_dt.strftime("%Y-%m-%d")}
    if from_part is not None:
        fetch_kwargs["from_date"] = from_part
    try:
        df = candles.fetch_for_timeframe(
            symbol, timeframe, include_partial_today=False, **fetch_kwargs
        )
    except Exception:
        df = None
    if df is not None and not getattr(df, "empty", True):
        df = candles.truncate_frame_to(df, to_dt)
    empty = df is None or getattr(df, "empty", True)
    series = _clamped_candle_series(df, lookback_bars, limit)
    if not compute_trendlines:
        trend_lines: list = []
    else:
        try:
            _res = trendlines_mod.detect_trendlines(df, lookback_bars=lookback_bars) if not empty else {}
            trend_lines = [v for v in (_res.get("support"), _res.get("resistance")) if v] if isinstance(_res, dict) else []
        except Exception:
            trend_lines = []
    hits: list = []
    overlays: list = []
    if detect_patterns:
        live: list = []
        if not empty and engine_mod is not None:
            try:
                live = engine_mod.detect_patterns(df, timeframe, symbol) or []
            except Exception:
                live = []
        for hit in live:
            record = _live_hit_to_dict(hit, symbol, timeframe)
            if record is None:
                continue
            if from_part and str(record.get("end_date") or "")[:10] < from_part:
                continue
            hits.append(record)
        for record in hits:
            overlay = _live_overlay(record)
            if overlay is not None:
                overlays.append(overlay)
    return {
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "candles": series,
        "overlays": overlays,
        "trend_lines": trend_lines,
        "hits": hits,
        "as_of": to_dt.isoformat(),
        "from_date": from_date,
    }


@router.get("/symbol/{symbol}/chart")
async def get_symbol_chart(
    symbol: str,
    timeframe: str = Query("1D"),
    limit: int = Query(config.CHART_MAX_BARS, ge=1, le=config.CHART_MAX_BARS),
    lookback_bars: Optional[int] = Query(None),
    compute_trendlines: bool = Query(True),
    detect_patterns: bool = Query(False),
    as_of_date: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
):
    if as_of_date is not None:
        return _json_response(await _asof_symbol_chart(
            symbol, timeframe, limit, lookback_bars, compute_trendlines,
            detect_patterns, as_of_date, from_date,
        ))
    symbol_u = str(symbol).strip().upper()
    session = _ist_session_date()

    # Negative cache hit: this (symbol, timeframe) already returned no
    # candles this session — answer instantly, no upstream fetch at all.
    neg = _chart_neg_cache_get(symbol_u, timeframe, session)
    if neg is not None:
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=0.0, rows=0,
            cache_hit=True, timeout=False, error=None,
        )
        return _json_response(neg)

    start = _time.monotonic()
    try:
        lb = lookback_bars if lookback_bars is not None else config.READ_LOOKBACK_BARS
        df = await asyncio.wait_for(
            run_in_threadpool(
                candles.fetch_for_timeframe,
                symbol_u, timeframe,
                lookback_bars=lb,
                include_partial_today=(timeframe == "1D"),
            ),
            timeout=_CHART_FETCH_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        df = None
        elapsed_ms = (_time.monotonic() - start) * 1000.0
        reason = "fetch_timeout"
        note = (
            f"candle fetch for {symbol_u} {timeframe} exceeded "
            f"{_CHART_FETCH_TIMEOUT_SEC:.0f}s and was aborted"
        )
        payload = _chart_empty_payload(symbol_u, timeframe, reason=reason, note=note)
        _chart_neg_cache_put(symbol_u, timeframe, session, payload)
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=elapsed_ms, rows=0,
            cache_hit=False, timeout=True, error=reason,
        )
        return _json_response(payload)
    except Exception as exc:  # noqa: BLE001 - transient upstream failure, never 500
        df = None
        elapsed_ms = (_time.monotonic() - start) * 1000.0
        reason = "fetch_error"
        note = str(exc)[:200]
        payload = _chart_empty_payload(symbol_u, timeframe, reason=reason, note=note)
        # Transient errors are NOT cached: the next click retries (still bounded
        # by the timeout) so a recovered feed isn't papered over for 5 minutes.
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=elapsed_ms, rows=0,
            cache_hit=False, timeout=False, error=reason,
        )
        return _json_response(payload)

    elapsed_ms = (_time.monotonic() - start) * 1000.0
    rows = 0 if df is None or getattr(df, "empty", True) else int(len(df))
    if df is None or getattr(df, "empty", True):
        reason = "no_data"
        note = f"no candles for {symbol_u} {timeframe} in session {session}"
        payload = _chart_empty_payload(symbol_u, timeframe, reason=reason, note=note)
        _chart_neg_cache_put(symbol_u, timeframe, session, payload)
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=elapsed_ms, rows=0,
            cache_hit=False, timeout=False, error=reason,
        )
        return _json_response(payload)
    # The fetch window carries ~1.5x headroom; clamp the displayed chart to
    # exactly the requested Lookback (Auto keeps the whole window). A trailing
    # synthetic session bar (1D only) is flagged for distinct UI rendering;
    # tail-clamping always keeps the last row, so the flag maps to series[-1].
    partial_last = bool(
        df is not None and getattr(df, "attrs", {}).get("partial_today", False)
    )
    series = _clamped_candle_series(df, lookback_bars, limit)
    if partial_last and series:
        series[-1]["is_partial"] = True
    detail = store.get_symbol_detail(symbol, timeframe)
    overlays = []
    stored_fresh_lines: list = []
    # Reuse fresh scan-time lines so fullscreen agrees with the cards;
    # stale lines (detector changed) fall through to the recompute below.
    chart_sig = config.trendline_signature()
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
        # Reuse fresh scan-time lines so fullscreen agrees with the cards;
        # stale lines (detector changed) fall through to the recompute below.
        if not stored_fresh_lines and _stored_lines_fresh(pattern, chart_sig):
            stored_fresh_lines = list(pattern.get("trend_lines") or [])
    if not compute_trendlines:
        trend_lines = []
    elif stored_fresh_lines:
        trend_lines = stored_fresh_lines
    else:
        try:
            _res = trendlines_mod.detect_trendlines(df, lookback_bars=lookback_bars)
            trend_lines = [v for v in (_res.get("support"), _res.get("resistance")) if v] if isinstance(_res, dict) else []
        except Exception:
            trend_lines = []
    payload = {
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "candles": series,
        "overlays": overlays,
        "trend_lines": trend_lines,
    }
    if detect_patterns:
        hits: list = []
        if df is not None and not getattr(df, "empty", True) and engine_mod is not None:
            try:
                live = engine_mod.detect_patterns(df, timeframe, symbol) or []
            except Exception:
                live = []
            for hit in live:
                record = _live_hit_to_dict(hit, symbol, timeframe)
                if record is not None:
                    hits.append(record)
        for record in hits:
            overlay = _live_overlay(record)
            if overlay is not None:
                overlays.append(overlay)
        payload["hits"] = hits
    return _json_response(payload)


@router.get("/watch/setups")
async def get_watch_setups():
    return _json_response({"setups": watch_mod.public_setups()})


@router.get("/market-status")
async def market_status():
    """Holiday-aware market clock so the frontend can stop polling on holidays.

    Contract: ``{"open": bool, "holiday": bool, "now_ist": iso, "reason": str}``
    where ``reason`` is one of ``market open`` | ``trading holiday`` |
    ``weekend`` | ``outside trading hours``. Uses the canonical
    ``trading.utils.is_market_open()`` (holiday-aware); never raises —
    degraded clock state reports closed with the error as the reason.
    """
    try:
        from trading import utils as _market_utils
        from trading.timezone import IST as _IST2
    except Exception:
        import config as _cfg2

        _market_utils = None
        _IST2 = getattr(_cfg2, "IST", None)
    try:
        from datetime import timezone as _tz

        now = datetime.now(_IST2) if _IST2 is not None else datetime.now(_tz.utc)
    except Exception:
        from datetime import timezone as _tz2

        now = datetime.now(_tz2.utc)
    try:
        is_open = bool(_market_utils.is_market_open(now)) if _market_utils is not None else False
    except Exception:
        return _json_response({
            "open": False, "holiday": False,
            "now_ist": now.isoformat(), "reason": "clock unavailable",
        })
    try:
        holiday = bool(_market_utils.is_trading_holiday(now))
    except Exception:
        holiday = False
    if is_open:
        reason = "market open"
    elif holiday:
        reason = "trading holiday"
    elif now.weekday() >= 5:
        reason = "weekend"
    else:
        reason = "outside trading hours"
    return _json_response({
        "open": is_open,
        "holiday": holiday,
        "now_ist": now.isoformat(),
        "reason": reason,
    })


def _watch_snapshot(setup: str, universe: Optional[str], timeframe: str) -> Optional[dict]:
    """Fresh precomputed ``/watch`` payload, or ``None`` (caller falls back).

    A parallel change adds ``watch.get_snapshot(setup, universe, timeframe)``;
    until it lands (or when it reports a miss/stale cache) this returns
    ``None`` and the endpoint keeps the ``arm`` + ``live`` path. Never raises.
    """
    try:
        getter = getattr(watch_mod, "get_snapshot", None)
    except Exception:
        return None
    if not callable(getter):
        return None
    try:
        snap = getter(setup, universe=universe, timeframe=timeframe)
    except TypeError:
        try:
            snap = getter(setup)
        except Exception:
            return None
    except Exception:
        return None
    if not isinstance(snap, dict) or not isinstance(snap.get("items"), list):
        return None
    return snap


@router.get("/watch")
async def get_watch(
    setup: str = Query("breakout"),
    universe: Optional[str] = Query(None),
    timeframe: str = Query("1D"),
    min_base_days: Optional[int] = Query(None),
    max_range_pct: Optional[float] = Query(None),
    min_rel_volume: float = Query(0.7),
):
    if setup not in watch_mod.SETUPS:
        raise HTTPException(
            status_code=404,
            detail=f"unknown setup {setup!r}. Known: {sorted(watch_mod.SETUPS)}",
        )
    # Fast path: a fresh precomputed snapshot (rebuilt by a background job)
    # returns instantly; only a miss/stale cache falls through to arm + live.
    snap = _watch_snapshot(setup, universe, timeframe)
    if snap is not None:
        return _json_response(snap)
    # Store reads + price/volume fan-out can block — keep them off the loop.
    rows = await run_in_threadpool(
        watch_mod.arm,
        setup,
        universe=universe,
        timeframe=timeframe,
        min_base_days=min_base_days,
        max_range_pct=max_range_pct,
    )
    items = await run_in_threadpool(watch_mod.live, rows, min_rel_volume=min_rel_volume)
    # Surface the actionable rows first: triggered, then armed, then invalidated,
    # each ordered by proximity to the trigger (closest to 0% first).
    _rank = {"triggered": 0, "armed": 1, "invalidated": 2}
    items.sort(key=lambda it: (
        _rank.get(it.get("state"), 3),
        abs(it["pct_to_trigger"]) if it.get("pct_to_trigger") is not None else 1e9,
    ))
    return _json_response({
        "setup": setup,
        "min_rel_volume": min_rel_volume,
        "updated_at": datetime.now(root_config.IST).isoformat(),
        "items": items,
    })


def _stream_watch_live_worker(rows, *, min_rel_volume, out, stop):
    """Run ``watch.live`` in chunks of ``_STREAM_LIVE_CHUNK`` armed rows per
    call, streaming each returned row as an ``item`` in completion order.

    ``watch.live`` batches LTP/TV/vol_adj across its whole input, so one call
    per chunk (instead of one per row) keeps the stream fast: 159 armed rows
    become 3 calls instead of ~159. Each chunk call reuses the exact batch
    logic, so a streamed row matches its ``/watch`` twin; rows are enqueued as
    computed (completion order, not the batch endpoint's ranked order — clients
    re-sort). Queue protocol mirrors :func:`_stream_results_worker`; never
    raises.
    """
    try:
        chunks = [rows[i:i + _STREAM_LIVE_CHUNK] for i in range(0, len(rows), _STREAM_LIVE_CHUNK)]
        workers = max(1, min(_STREAM_POOL_WORKERS, len(chunks) or 1))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [
                pool.submit(watch_mod.live, list(chunk), min_rel_volume=min_rel_volume)
                for chunk in chunks
            ]
            for computed in _iter_completed_results(futs, stop, out):
                for live_row in computed or []:
                    try:
                        out.put(("item", _sanitize_for_json(live_row)))
                    except Exception:
                        pass
    except Exception as exc:  # pragma: no cover - defensive; worker never raises
        try:
            out.put(("error", str(exc)[:300]))
        except Exception:
            pass
    finally:
        try:
            out.put(("end", None))
        except Exception:
            pass


async def _watch_sse_events(setup, *, universe, timeframe, min_base_days,
                            max_range_pct, min_rel_volume, request=None):
    """Async SSE body for ``GET /watch/stream`` (also drives the tests).

    Emits ``meta`` → ``{setup, min_rel_volume}`` immediately, then a second
    ``meta`` → ``{setup, min_rel_volume, total}`` after ``arm()`` so the UI can
    show progress, then one ``item`` per live row (snapshot rows first when a
    fresh snapshot exists, else each ``live()`` row as computed), then
    ``done``. Never raises mid-stream: unexpected failures become ``event:
    error`` and close.
    """
    try:
        yield _sse_event("meta", _sanitize_for_json({
            "setup": setup, "min_rel_volume": min_rel_volume,
        }))
    except Exception as exc:
        yield _sse_event("error", {"message": str(exc)[:300]})
        return
    try:
        snap = _watch_snapshot(setup, universe, timeframe)
    except Exception:
        snap = None
    if snap is not None:
        try:
            for row in list(snap.get("items") or [])[:_STREAM_MAX_ITEMS]:
                yield _sse_event("item", _sanitize_for_json(row))
            yield _sse_event("done", {})
        except Exception as exc:
            yield _sse_event("error", {"message": str(exc)[:300]})
        return
    try:
        rows = await run_in_threadpool(
            watch_mod.arm, setup, universe=universe, timeframe=timeframe,
            min_base_days=min_base_days, max_range_pct=max_range_pct,
        )
    except Exception as exc:
        yield _sse_event("error", {"message": str(exc)[:300]})
        return
    rows = list(rows or [])[:_STREAM_MAX_ITEMS]
    if not rows:
        yield _sse_event("done", {})
        return
    # Second meta (after arm): the UI replaces the immediate first meta with
    # this one so it can show progress against ``total``.
    try:
        yield _sse_event("meta", _sanitize_for_json({
            "setup": setup, "min_rel_volume": min_rel_volume, "total": len(rows),
        }))
    except Exception as exc:
        yield _sse_event("error", {"message": str(exc)[:300]})
        return
    out: _queue.Queue = _queue.Queue(maxsize=_STREAM_MAX_ITEMS + 10)
    stop = threading.Event()
    worker = threading.Thread(
        target=_stream_watch_live_worker,
        kwargs={"rows": rows, "min_rel_volume": min_rel_volume, "out": out, "stop": stop},
        daemon=True,
    )
    worker.start()
    try:
        async for kind, payload in _drain_stream_queue(out, request, stop):
            if kind == "item":
                yield _sse_event("item", payload)
            elif kind == "error":
                message = payload if isinstance(payload, str) else "watch failed"
                yield _sse_event("error", {"message": message})
                return
            elif kind == "heartbeat":
                yield _sse_event("heartbeat", {})
            elif kind == "end":
                yield _sse_event("done", {})
                return
            elif kind == "closed":
                return
    finally:
        stop.set()


@router.get("/watch/stream")
async def stream_watch(
    request: Request,
    setup: str = Query("breakout"),
    universe: Optional[str] = Query(None),
    timeframe: str = Query("1D"),
    min_base_days: Optional[int] = Query(None),
    max_range_pct: Optional[float] = Query(None),
    min_rel_volume: float = Query(0.7),
):
    """SSE twin of ``GET /watch`` (same query params, read-only, open).

    Events: ``meta`` → ``{setup, min_rel_volume}`` (immediately), then a
    second ``meta`` → ``{setup, min_rel_volume, total}`` after ``arm()`` so
    the UI can show progress; ``item`` → one live row; ``done`` → ``{}``.
    ``arm()`` rows are cheap (store read / session cache) so they resolve
    fast; each ``live()`` row streams as computed on a bounded pool
    (``queue.Queue`` bridge, like ``api/paper/live_stream.py``). Rows are
    fanned to ``watch.live`` in ``_STREAM_LIVE_CHUNK``-sized chunks so one
    batched price/volume call serves up to 50 armed names instead of one call
    per row. A fresh precomputed snapshot (``watch.get_snapshot``) is emitted
    item-by-item instead. Client disconnect stops production. Never raises
    mid-stream (``event: error`` + close). Unknown setups 404 before the
    stream starts (same as ``/watch``).
    """
    if setup not in watch_mod.SETUPS:
        raise HTTPException(
            status_code=404,
            detail=f"unknown setup {setup!r}. Known: {sorted(watch_mod.SETUPS)}",
        )

    async def _body():
        async for frame in _watch_sse_events(
            setup, universe=universe, timeframe=timeframe,
            min_base_days=min_base_days, max_range_pct=max_range_pct,
            min_rel_volume=min_rel_volume, request=request,
        ):
            yield frame

    return StreamingResponse(_body(), media_type="text/event-stream", headers=dict(_SSE_HEADERS))


_MATRIX_HIT_KEYS = (
    "id", "symbol", "name", "timeframe", "pattern_id", "pattern_name",
    "family", "direction", "status", "quality", "confidence", "start_date",
    "end_date", "start_price", "end_price", "bars_ago", "volume_confirmed",
    "range_pos", "to_52w_high",
)

_MATRIX_MAX_HITS = 40


def _matrix_number(value) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):
        return None
    return out


def _matrix_desc(value) -> tuple:
    num = _matrix_number(value)
    return (1, 0.0) if num is None else (0, -num)


def _matrix_asc(value) -> tuple:
    num = _matrix_number(value)
    return (1, 0.0) if num is None else (0, num)


def _matrix_rank_key(hit: dict) -> tuple:
    return (
        _matrix_desc(hit.get("confidence")),
        _matrix_asc(hit.get("bars_ago")),
    )


def _matrix_latest(group: list[dict]) -> dict:
    bars = [_matrix_number(hit.get("bars_ago")) for hit in group]
    values = [value for value in bars if value is not None]
    if values:
        floor = min(values)
        pool = [hit for hit, value in zip(group, bars) if value == floor]
    else:
        pool = list(group)
    return max(
        pool,
        key=lambda hit: (str(hit.get("end_date") or ""), _matrix_number(hit.get("id")) or 0),
    )


def _matrix_slim(hit: dict) -> dict:
    return {key: hit.get(key) for key in _MATRIX_HIT_KEYS}


def _matrix_timeframes(requested) -> list[str]:
    if requested:
        valid = _valid_timeframe_ids()
        out: list[str] = []
        for tf in requested:
            key = str(tf or "").strip()
            if key in valid and key not in out:
                out.append(key)
        return out
    return [str(spec["id"]) for spec in _timeframes_payload() if spec.get("id")]


def _matrix_row_key(row: dict) -> tuple:
    best = row.get("best") or {}
    return (
        _matrix_desc(best.get("confidence")),
        str(row.get("symbol") or ""),
    )


def _matrix_rows(pairs) -> list[dict]:
    rows: dict[str, dict] = {}
    for timeframe, items in pairs:
        for item in items or []:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or "").strip().upper()
            if not symbol:
                continue
            row = rows.get(symbol)
            if row is None:
                row = {
                    "symbol": symbol,
                    "name": None,
                    "ltp": None,
                    "day_change_pct": None,
                    "groups": {},
                    "hits": [],
                }
                rows[symbol] = row
            if row["name"] is None and item.get("name"):
                row["name"] = item.get("name")
            if row["ltp"] is None:
                number = _matrix_number(item.get("last_close"))
                if number is not None:
                    row["ltp"] = number
            if row["day_change_pct"] is None and item.get("day_change_pct") is not None:
                row["day_change_pct"] = item.get("day_change_pct")
            hit_tf = str(item.get("timeframe") or timeframe or "")
            row["groups"].setdefault(hit_tf, []).append(item)
            row["hits"].append(item)

    out: list[dict] = []
    for row in rows.values():
        groups = row.pop("groups")
        hits = row.pop("hits")
        cells: dict[str, dict] = {}
        latest_hits: list[dict] = []
        for timeframe, group in groups.items():
            latest = _matrix_latest(group)
            latest_hits.append(latest)
            name = latest.get("pattern_name")
            cells[timeframe] = {
                "direction": latest.get("direction"),
                "status": latest.get("status"),
                "count": len(group),
                "confidence": latest.get("confidence"),
                "patterns": [name] if name else [],
                "best_id": latest.get("id"),
            }
        best_hit = min(latest_hits, key=_matrix_rank_key) if latest_hits else None
        if row["ltp"] is None and hits:
            freshest = min(hits, key=lambda hit: _matrix_asc(hit.get("bars_ago")))
            row["ltp"] = _matrix_number(freshest.get("end_price"))
        row["timeframes"] = cells
        row["hits"] = [_matrix_slim(hit) for hit in latest_hits[:_MATRIX_MAX_HITS]]
        row["best"] = _matrix_slim(best_hit) if best_hit is not None else None
        row["hit_count"] = len(hits)
        out.append(row)
    out.sort(key=_matrix_row_key)
    return out


@router.get("/matrix")
async def get_matrix(
    universe: str = Query(...),
    limit: int = Query(400, ge=1, le=1000),
    timeframes: Optional[list[str]] = Query(None),
):
    """One row per symbol, one compact cell per timeframe, from stored hits."""
    tf_ids = _matrix_timeframes(timeframes)
    cache_key = (
        getattr(store, "_session_factory", None),
        universe,
        tuple(tf_ids),
        limit,
        tuple(_last_scan_at_for(universe, tf) for tf in tf_ids),
    )
    cached = _read_cache_get(_matrix_cache, cache_key)
    if cached is not None:
        return JSONResponse(content=cached)
    pairs: list[tuple[str, list]] = []
    through_values: list = []
    for tf in tf_ids:
        try:
            items, _total, summary = store.query_results(
                {"universe": universe, "timeframe": tf, "sort": "confidence"},
                limit=limit,
                offset=0,
            )
        except Exception:
            items, summary = [], {}
        if not isinstance(summary, dict):
            summary = {}
        if summary.get("data_through") is not None:
            through_values.append(summary["data_through"])
        pairs.append((tf, items or []))
    payload = _sanitize_for_json({
        "universe": universe,
        "timeframes": tf_ids,
        "rows": _matrix_rows(pairs),
        "data_through": max(through_values, key=str) if through_values else None,
    })
    _read_cache_put(_matrix_cache, cache_key, payload)
    return JSONResponse(content=payload)

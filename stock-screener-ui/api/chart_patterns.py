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
import numbers
import os
import queue as _queue
import re
import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import NamedTuple, Optional

import pandas as pd
from sqlalchemy.orm import Session

from db.database import get_db

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from chart_patterns import candles, config, jobs, store
from chart_patterns import indicators as indicators_mod
from chart_patterns import levels as levels_mod
from chart_patterns import scan as scan_mod
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
from api.rate_limit import US_CHART_RATE_DETAIL, us_chart_limiter
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


# Frozen fallbacks (CONTRACT.md §1/§2) — used only if Agent 1's registries are
# unavailable so this router stays functional during integration.

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


# Short-TTL read cache (stale-scan-safe)
#
# ``/summary`` and ``/matrix`` re-query the store on every UI poll, but the
# underlying hit set only changes when a new scan completes. Entries are keyed
# on the ``last_scan_at`` of the latest completed job for the requested
# universe/timeframe(s), plus a 3-second TTL backstop: if a newer scan
# finishes, the key changes and the recompute runs immediately, so no
# response can outlive the scan it was built from by more than the TTL.
# ``/results`` is deliberately *not* cached (enrichment + fresh cards).

_READ_CACHE_TTL_SEC = 3.0
#: Lookup answers are keyed on the scan stamp too, so a longer TTL is safe:
#: the key changes the moment a new scan completes.
_LOOKUP_CACHE_TTL_SEC = 30.0
_summary_cache: dict = {}
_matrix_cache: dict = {}
_lookup_cache: dict = {}
#: Registry/catalog endpoints rebuild their payload from module state on every
#: request. A short TTL removes that churn; the timeframes key carries the
#: enabled-config fingerprint so an admin edit invalidates immediately. Every
#: entry is dropped by ``_clear_read_caches`` (tests + operator resets).
_CATALOG_CACHE_TTL_SEC = float(os.environ.get("CHART_CATALOG_CACHE_TTL_SEC", "60.0"))
_catalog_cache: dict = {}
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


def _scan_stamps_for(universe, tf_ids):
    """One DB round-trip: completed-scan stamp for each requested timeframe.

    /matrix used to call ``_last_scan_at_for`` once per timeframe; a single
    GROUP BY over the same job rows produces the identical key inputs with one
    session instead of one per timeframe.
    """
    if not tf_ids:
        return {}
    try:
        session = store._new_session()
        try:
            return store._last_scan_at_many(session, universe, list(tf_ids))
        finally:
            session.close()
    except Exception:
        return {}


def _last_scan_at_for(universe, timeframe):
    """Latest completed job's ``finished_at`` for a combo (``None``-safe)."""
    return _scan_stamps_for(universe, [timeframe]).get(timeframe)


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


def _read_cache_put(cache: dict, key, payload, ttl: Optional[float] = None) -> None:
    now = _time.monotonic()
    with _read_cache_lock:
        while len(cache) >= _READ_CACHE_MAX_ENTRIES:
            cache.pop(next(iter(cache)), None)
        cache[key] = (now + (_READ_CACHE_TTL_SEC if ttl is None else ttl), payload)


def _catalog_cache_key(name: str, fingerprint=None):
    """Catalog entries are keyed by endpoint plus any input that can change it."""
    return ("catalog", name, fingerprint)


def _clear_read_caches() -> None:
    """Drop the short-TTL read caches (tests + operator resets)."""
    with _read_cache_lock:
        _summary_cache.clear()
        _matrix_cache.clear()
        _lookup_cache.clear()
        _catalog_cache.clear()
    # The frame watermark drives the matrix cache key, so a reset must also
    # forget which frames we have seen (tests rely on this for isolation).
    _clear_all_enrichment()


# Frame-scoped enrichment cache.
#
# A ``last_close``/``day_change_pct`` pair is only meaningful alongside the
# candle frame it was computed from. Every key below carries that frame's
# identity (last-bar timestamp + interior digest), so a rolled frame can never
# be served an older value. The per-(symbol, timeframe) index lets a forced
# refresh drop one symbol without evicting any other.
#
# ``_known_frame`` holds the completed-session frame whose close the matrix
# pairs with stored detection. It is published by result enrichment, the
# ``/symbol`` header and the chart base frame — all of which read a completed
# session — and ``_remember_frame`` refuses to store a frame that still ends
# with today's in-progress bar. Written by all three callers *without* that
# guard, a single (symbol, timeframe) slot let the last writer win, so a chart
# request could leave a partial-session LTP next to completed-session detection
# (KAYNES: 2,986 on 16-Nov vs 3,382 detected through 13-Nov).

_ENRICH_CACHE_TTL_SEC = float(os.environ.get("CHART_ENRICH_CACHE_TTL_SEC", "300.0"))
_ENRICH_CACHE_MAX = 512
#: _known_frame is keyed by (symbol, timeframe) and has no TTL; bound it so a
#: large universe cannot grow it without limit. Eviction only drops the coarse
#: watermark/close for one scope — never a stored hit or a response shape.
_KNOWN_FRAME_MAX = 4096
_enrichment_cache: dict = {}
_enrichment_keys: dict = {}
_known_frame: dict = {}
_enrichment_lock = threading.Lock()


def _frame_identity(df) -> Optional[str]:
    """Fingerprint of the exact frame a series/close was derived from.

    The leading last-bar timestamp catches a rolled/new bar; the interior
    digest catches a backfill that leaves the tail untouched. ``None`` means
    "no frame" — callers must then neither reuse nor persist enrichment.
    """
    if df is None or getattr(df, "empty", True):
        return None
    try:
        stamp = df.index[-1]
        stamp = stamp.isoformat() if hasattr(stamp, "isoformat") else str(stamp)
        close = float(df["close"].iloc[-1])
    except Exception:
        return None
    try:
        interior = scan_mod._frame_interior_digest(df)
    except Exception:
        interior = None
    return f"{stamp}|{len(df)}|{close:.10g}|{interior or ''}"


def _close_bar_date(df) -> Optional[str]:
    """IST calendar date of the frame's last bar, or ``None`` when unavailable.

    Read from the same frame that produced the returned candles/close — never
    from a pattern's start/end date or scan/request time. ``frame_last_date``
    converts a timestamp-like last index into the IST session date, so a daily
    bar stamped 18:30 UTC belongs to the *next* calendar day. No ``DatetimeIndex``
    type gate: a copied/merged frame can carry a parseable timestamp index, and
    a frame with a usable last bar must never silently lose its date.
    """
    if df is None or getattr(df, "empty", True):
        return None
    index = getattr(df, "index", None)
    if index is None or len(index) == 0:
        return None
    if isinstance(index[-1], numbers.Number):
        # A numeric/Range index has no timestamp — `pd.Timestamp(1)` would
        # invent a 1970 date. A usable timestamp string/datetime is accepted.
        return None
    try:
        bar_date = candles.frame_last_date(df)
    except Exception as exc:  # noqa: BLE001 - a label must never fail a chart
        _chart_logger.warning("close_bar_date: frame_last_date failed: %s", exc)
        return None
    if bar_date is None:
        _chart_logger.warning(
            "close_bar_date: no IST session date for frame index=%s len=%d",
            type(getattr(df, "index", None)).__name__, len(df),
        )
    return bar_date


def _remember_frame(key, df, last_close, day_change) -> None:
    """Publish the completed-session frame/close/bar-date for this symbol.

    The matrix pairs this close with completed-session detection, so a frame
    that still ends with a live, still-forming bar is trimmed to its last
    completed bar before it is stored. Without that, a chart request overwrote
    the completed frame with its display frame and the matrix reported a
    partial-session LTP next to 13-Nov detection (KAYNES: 2,986 on 16-Nov vs
    3,382 through 13-Nov).
    """
    if key is None:
        return
    frame = df
    if (
        frame is not None
        and not getattr(frame, "empty", True)
        and (getattr(frame, "attrs", {}) or {}).get("partial_today")
    ):
        # ``iloc[:-1]`` keeps ``attrs``, so clear the marker: trimming is
        # idempotent, and an already-trimmed ``base_df`` is not trimmed twice.
        frame = frame.iloc[:-1].copy()
        frame.attrs = {
            key: value for key, value in (frame.attrs or {}).items()
            if not str(key).startswith("partial_today")
        }
        last_close, day_change = _last_close_change(frame)
    frame_id = _frame_identity(frame)
    if frame_id is None:
        return
    scope = (str(key[0]).upper(), str(key[1]))
    with _enrichment_lock:
        if scope not in _known_frame and len(_known_frame) >= _KNOWN_FRAME_MAX:
            _known_frame.pop(next(iter(_known_frame)))
        _known_frame[scope] = (frame_id, last_close, day_change, _close_bar_date(frame))


def _known_frame_close(symbol, timeframe) -> tuple:
    """``(last_close, day_change_pct, close_bar_date)`` for the current frame."""
    with _enrichment_lock:
        value = _known_frame.get((str(symbol).upper(), str(timeframe)))
    return (value[1], value[2], value[3]) if value else (None, None, None)


def _frame_watermark(timeframes=None) -> Optional[str]:
    """Coarse completed-session stamp for the requested timeframes.

    The old value was the tuple of every known frame identity — including each
    symbol's last-bar timestamp and interior digest. In market hours those
    advance on each symbol's own intraday tick, so the tuple changed on every
    poll and the 3-second matrix cache never hit. The matrix only consumes the
    *completed-session* close, so the newest completed bar date across the
    universe is enough: stable while a session is in progress, advanced when a
    new session is published. A new scan is covered by the scan stamp already in
    the same key, so no stale answer can survive either invalidation source.
    """
    with _enrichment_lock:
        dates = [
            value[3] for scope, value in _known_frame.items()
            if (not timeframes or scope[1] in timeframes) and len(value) > 3 and value[3]
        ]
    return max(dates) if dates else None


def _summary_cache_key(filters: dict):
    tf = filters.get("timeframe")
    return (
        getattr(store, "_session_factory", None),
        _freeze_filters(filters),
        _scan_stamps_for(filters.get("universe"), [tf] if tf else []).get(tf),
    )


def _matrix_cache_key(universe: str, tf_ids: list, limit: int):
    stamps = _scan_stamps_for(universe, tf_ids)
    return (
        getattr(store, "_session_factory", None),
        universe,
        tuple(tf_ids),
        limit,
        tuple(stamps.get(tf) for tf in tf_ids),
        _frame_watermark(tf_ids),
    )


def _lookup_cache_key(timeframe: str, universe, scope: tuple):
    return (
        getattr(store, "_session_factory", None),
        timeframe,
        universe,
        scope,
        _ist_session_date(),
        _scan_stamps_for(universe, [timeframe]).get(timeframe),
    )


def _drop_enrichment_index_locked(key) -> None:
    scope = (key[0], key[1])
    keys = _enrichment_keys.get(scope)
    if keys is not None:
        keys.discard(key)
        if not keys:
            _enrichment_keys.pop(scope, None)


def _enrichment_cache_get(key):
    if key is None:
        return None
    now = _time.monotonic()
    with _enrichment_lock:
        entry = _enrichment_cache.get(key)
        if entry is None:
            return None
        expires, payload = entry
        if now >= expires:
            _enrichment_cache.pop(key, None)
            _drop_enrichment_index_locked(key)
            return None
        return payload


def _enrichment_cache_put(key, payload) -> None:
    if key is None:
        return
    now = _time.monotonic()
    with _enrichment_lock:
        while len(_enrichment_cache) >= _ENRICH_CACHE_MAX:
            victim = next(iter(_enrichment_cache))
            _enrichment_cache.pop(victim, None)
            _drop_enrichment_index_locked(victim)
        _enrichment_cache[key] = (now + _ENRICH_CACHE_TTL_SEC, payload)
        _enrichment_keys.setdefault((key[0], key[1]), set()).add(key)


def _clear_symbol_enrichment(symbol, timeframe) -> None:
    """Drop one symbol+timeframe's enrichment (forced-refresh scope)."""
    scope = (str(symbol).upper(), str(timeframe))
    with _enrichment_lock:
        for key in list(_enrichment_keys.pop(scope, ())):
            _enrichment_cache.pop(key, None)
        _known_frame.pop(scope, None)


def _clear_timeframe_enrichment(timeframe) -> None:
    """Drop a whole timeframe's enrichment (universe refresh).

    ``_known_frame`` is derived from itself, not from ``_enrichment_keys``: an
    entry can exist for a symbol whose enrichment payload aged out of the
    cache, and a refresh that leaves it behind lets the matrix keep serving the
    pre-refresh close.
    """
    tf = str(timeframe)
    with _enrichment_lock:
        scopes = [s for s in _enrichment_keys if s[1] == tf]
        for scope in scopes:
            for key in list(_enrichment_keys.pop(scope, ())):
                _enrichment_cache.pop(key, None)
        for frame_scope in [s for s in _known_frame if s[1] == tf]:
            _known_frame.pop(frame_scope, None)


def _clear_all_enrichment() -> None:
    with _enrichment_lock:
        _enrichment_cache.clear()
        _enrichment_keys.clear()
        _known_frame.clear()


# Symbol chart fetch: hard timeout + negative cache for empty results.
#
# A missing/slow symbol (Upstox DNS failure, hung feed) must not hold
# ``GET /symbol/{symbol}/chart`` for 30s and then repeat the wait on every
# click. The upstream fetch is capped by ``CHART_FETCH_TIMEOUT_SEC``; on
# timeout or an empty frame the endpoint answers ``{"candles":[]}`` with an
# ``error``/``note`` instead of 500. Empty results are cached per
# ``(symbol, timeframe, IST session)`` for ~5 minutes so a repeat click is
# instant; entries never outlive the session they were taken in.
#
# When the upstream fails (timeout / error / no data) and the default
# live-edge disk cache entry holds a completed-session frame, the endpoint
# serves that frame marked ``cached``/``stale`` with ``as_of`` set to the
# frame's last session — never as current data. The read is local disk,
# adds no network call, and never applies to historical/as-of namespaced
# cache files.

#: Hard upper bound on one symbol-chart candle fetch (seconds). Env-overridable
#: for deployments on slower feeds; 0 disables the cap.
_CHART_FETCH_TIMEOUT_SEC = float(os.environ.get("CHART_FETCH_TIMEOUT_SEC", "30.0"))
#: TTL of a negative (empty-result) cache entry (seconds).
_CHART_NEG_CACHE_TTL_SEC = float(os.environ.get("CHART_NEG_CACHE_TTL_SEC", "300.0"))
#: TTL for a *timeout* entry. A timeout is transient (cold feed, one slow
#: request), so it must not suppress retries for the full empty-result TTL —
#: that turned one 7s hiccup into five minutes of empty charts.
_CHART_NEG_CACHE_TIMEOUT_TTL_SEC = float(os.environ.get("CHART_NEG_CACHE_TIMEOUT_TTL_SEC", "20.0"))
_CHART_NEG_CACHE_MAX = 256


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


#: Max calendar-day lag (daily bars only print on NSE sessions, so this is
#: effectively "N sessions behind") beyond which stale-first refuses to serve a
#: cached frame and falls through to the normal (bounded) network path. On
#: network failure the endpoint returns an error instead of an ancient cached
#: frame — a stale frame older than this is never served as current.
#: Env-overridable; default 3 keeps the previous 3-day tolerance.
_MAX_STALE_DAYS = _env_int("CHART_MAX_STALE_DAYS", 3)

#: Background refresh: max fetch attempts and bounded backoff (seconds) between
#: them, so a transient Upstox 429/timeout cannot pin the cache forever.
_MAX_REFRESH_ATTEMPTS = _env_int("CHART_REFRESH_MAX_ATTEMPTS", 3)
_REFRESH_BACKOFF_SEC = (0.0, 2.0, 5.0)


_chart_neg_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}
_chart_neg_cache_lock = threading.Lock()
_chart_logger = logging.getLogger(__name__)


# Live tail merge for the open-market stale-first path.
#
# The cached frame is completed-session data; while NSE is trading the last few
# bars live only upstream. ``chart_patterns.tail_refresh.fetch_live_tail``
# appends/repairs that tail. It is bounded here (default 2s) so a slow provider
# can never hold a populated chart hostage: on timeout/failure the cached frame
# is still served (marked stale) and the existing daemon refresh runs.
_TAIL_TIMEOUT_DEFAULT_SEC = 2.0


class _TailMergeFallback(NamedTuple):
    """Failure-shaped answer when the tail module is not importable yet."""
    frame: Optional[pd.DataFrame]
    appended: int = 0
    updated: int = 0
    cache_through: Optional[datetime] = None
    latest_bar: Optional[datetime] = None
    provider_called: bool = False
    error: Optional[str] = None


def _tail_timeout_sec() -> float:
    try:
        value = float(os.environ.get("CHART_TAIL_TIMEOUT_SEC", str(_TAIL_TIMEOUT_DEFAULT_SEC)))
    except (TypeError, ValueError):
        value = _TAIL_TIMEOUT_DEFAULT_SEC
    return max(0.05, value)


def _last_bar_timestamp(df) -> Optional[pd.Timestamp]:
    if df is None or getattr(df, "empty", True):
        return None
    try:
        index = df.index
        if pd.api.types.is_numeric_dtype(getattr(index, "dtype", None)):
            return None
        return pd.Timestamp(index[-1])
    except Exception:
        return None


def _tail_unavailable(cached, error: str) -> _TailMergeFallback:
    last_bar = _last_bar_timestamp(cached)
    return _TailMergeFallback(
        frame=cached,
        appended=0,
        updated=0,
        cache_through=last_bar,
        latest_bar=last_bar,
        provider_called=False,
        error=str(error)[:200],
    )


def fetch_live_tail(
    symbol: str, timeframe: str, cached, *, now=None, cache_path: Optional[Path] = None,
):
    """Lazy bridge to ``chart_patterns.tail_refresh.fetch_live_tail``.

    The module is owned by a parallel change and may still be landing, so the
    import lives here behind a module-level name (tests monkeypatch it) and a
    missing module degrades to a cache-only answer rather than an import error.
    ``cache_path`` is the exact file the stale-first read served; the tail
    merger must rewrite that entry (not the default) so the next poll sees it.
    Older tail module revisions without the kwarg still work.
    """
    try:
        from chart_patterns.tail_refresh import fetch_live_tail as _impl
    except Exception as exc:  # noqa: BLE001 - module still landing / import cycle
        return _tail_unavailable(cached, f"tail_refresh unavailable: {exc}")
    kwargs = {"now": now}
    try:
        import inspect

        params = inspect.signature(_impl).parameters.values()
        accepts_path = any(
            param.name == "cache_path"
            or param.kind is inspect.Parameter.VAR_KEYWORD
            for param in params
        )
    except Exception:
        accepts_path = False
    if accepts_path:
        kwargs["cache_path"] = cache_path
    return _impl(symbol, timeframe, cached, **kwargs)


def _chart_now_ist() -> datetime:
    """Single clock read for freshness/tail decisions (tests freeze it)."""
    try:
        return candles._now_ist()
    except Exception:
        return datetime.now(root_config.IST)


def _india_market_open(now: Optional[datetime] = None) -> bool:
    """Holiday-aware NSE session predicate. Never raises (closed on failure)."""
    try:
        from trading.utils import is_market_open
        if now is None:
            now = datetime.now(root_config.IST)
        return bool(is_market_open(now))
    except Exception:
        return False


def _timeframe_minutes(timeframe: str) -> int:
    try:
        from chart_patterns import timeframes as _timeframes
        return int(_timeframes.get_timeframe(timeframe).minutes)
    except Exception:
        return 5


def _iso_value(value) -> Optional[str]:
    if value is None:
        return None
    try:
        return value.isoformat() if hasattr(value, "isoformat") else str(value)
    except Exception:
        return None


def _cache_age_sec(latest_bar, now) -> Optional[int]:
    """Seconds since the last bar (never negative); ``None`` when unknown."""
    if latest_bar is None:
        return None
    try:
        bar = pd.Timestamp(latest_bar)
        ref = pd.Timestamp(now)
        if bar.tzinfo is None:
            bar = bar.tz_localize("UTC")
        if ref.tzinfo is None:
            ref = ref.tz_localize(root_config.IST)
        return max(0, int((ref - bar).total_seconds()))
    except Exception:
        return None


def _tail_frame_stale(
    timeframe: str, df, *, market_open: bool, now: datetime,
) -> bool:
    """Staleness for the live-tail path, by bar age and session gap.

    - Intraday open: last bar older than ``max(2 x interval, 2 min)``.
    - Intraday closed: last bar belongs to an earlier session.
    - ``1D`` open: today's session bar is missing.
    - ``1D`` closed: the frame ends before the last completed session.
    - ``1W``/``1M``: the frame covers the last completed period.
    """
    if df is None or getattr(df, "empty", True):
        return True
    last_date = candles.frame_last_date(df)
    if not last_date:
        return True
    last_bar = _last_bar_timestamp(df)
    if timeframe == "1D":
        if market_open:
            return last_date != now.date().isoformat()
        try:
            expected = candles._last_completed_session().isoformat()
        except Exception:
            return True
        return last_date < expected
    if timeframe in ("1W", "1M"):
        try:
            lcs = candles._last_completed_session().isoformat()
        except Exception:
            return True
        expected = _last_completed_period_label(lcs, timeframe)
        return not _period_cache_covers(last_date, lcs, expected, timeframe)
    if market_open:
        if last_bar is None:
            return True
        try:
            bar = pd.Timestamp(last_bar)
            ref = pd.Timestamp(now)
            if bar.tzinfo is None:
                bar = bar.tz_localize("UTC")
            if ref.tzinfo is None:
                ref = ref.tz_localize(root_config.IST)
        except Exception:
            return True
        threshold = max(2 * _timeframe_minutes(timeframe), 2) * 60.0
        return (ref - bar).total_seconds() > threshold
    try:
        expected = candles._last_completed_session().isoformat()
    except Exception:
        return True
    if last_date < expected:
        return True
    return _closed_intraday_stale(timeframe, df, expected_session=expected)


def _closed_intraday_stale(timeframe: str, df, *, expected_session: str) -> bool:
    """Closed-market intraday frame that stops before the session close."""
    if timeframe in ("1D", "1W", "1M"):
        return False
    last_bar = _last_bar_timestamp(df)
    if last_bar is None:
        return True
    try:
        bar = pd.Timestamp(last_bar)
        if bar.tzinfo is None:
            bar = bar.tz_localize("UTC")
        ist_bar = bar.tz_convert(root_config.IST)
        if ist_bar.date().isoformat() < expected_session:
            return True
        hour, minute = 15, 30
        try:
            from trading.utils import MARKET_CLOSE
            hour, minute = int(MARKET_CLOSE[0]), int(MARKET_CLOSE[1])
        except Exception:
            pass
        close = ist_bar.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return ist_bar < close
    except Exception:
        return True


def _closed_1d_superseded(
    timeframe: str, as_of: Optional[str], *, market_open: bool,
) -> bool:
    """A closed daily frame predating the last completed session cannot repair
    itself: there is no live tail after the close, so the normal fetch must run.
    """
    if market_open or timeframe != "1D" or not as_of:
        return False
    try:
        completed = candles._last_completed_session().isoformat()
    except Exception:
        return False
    return as_of < completed


def _unpack_stale_frame(stale_first) -> tuple:
    """Normalize the stale-first read to ``(df, as_of, read_ms, path)``.

    Older callers/tests still supply three values; the fourth is the exact
    on-disk entry the live tail must rewrite when it is an ``lb{N}`` variant.
    """
    if len(stale_first) == 4:
        return stale_first
    df, as_of, read_ms = stale_first
    return df, as_of, read_ms, None


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


def _chart_neg_cache_put(
    symbol: str, timeframe: str, session: str, payload: dict, *, ttl: Optional[float] = None,
) -> None:
    now = _time.monotonic()
    key = (str(symbol).upper(), str(timeframe), session)
    ttl_sec = _CHART_NEG_CACHE_TTL_SEC if ttl is None else ttl
    with _chart_neg_cache_lock:
        while len(_chart_neg_cache) >= _CHART_NEG_CACHE_MAX:
            _chart_neg_cache.pop(next(iter(_chart_neg_cache)), None)
        _chart_neg_cache[key] = (now + ttl_sec, payload)


def _chart_empty_payload(symbol: str, timeframe: str, *, reason: str, note: str) -> dict:
    """Empty chart answer carrying a machine-readable ``error`` + human ``note``."""
    return {
        "symbol": str(symbol).upper(),
        "timeframe": timeframe,
        "candles": [],
        "overlays": [],
        "close_bar_date": None,
        "data_source": "none",
        "market_open": _india_market_open(),
        "cache_through": None,
        "latest_bar": None,
        "appended": 0,
        "updated": 0,
        "cache_age_sec": None,
        "refreshing": False,
        "error": reason,
        "note": note,
    }


def _stale_chart_fallback(
    symbol: str,
    timeframe: str,
    *,
    fetch_lookback: Optional[int],
    clamp_lookback: Optional[int],
    limit: int,
    reason: str,
    from_date: Optional[str] = None,
) -> Optional[dict]:
    """Last good on-disk frame for the live-edge cache entry, else ``None``.

    Read-only and network-free. Only the default live-edge entry the fetch
    itself would have used (matching ``lb{N}`` lookback variant) is
    considered — historical/as-of namespaced files are never served. A frame
    from an earlier session is returned solely with ``cached``/``stale`` set
    and ``as_of`` pinned to the frame's last session date, so it can never
    present itself as current data. ``from_date`` clips the displayed frame
    to the requested start (detection is not part of this fallback). Never
    raises.
    """
    try:
        lb = None if fetch_lookback is None else int(fetch_lookback)
        variant = f"lb{lb}" if lb is not None else None
        path = candles._cache_path(timeframe, symbol, None, variant=variant)
        candidates = [path]
        if variant is not None:
            alt = candles._cache_path(timeframe, symbol, None)
            if alt != path:
                candidates.append(alt)
        df, _chosen, _read_ms = _read_cached_frame(candidates)
        if df is None:
            return None
        as_of = candles.frame_last_date(df)
        if not as_of:
            return None
        series = _clamped_candle_series(
            _filter_frame_from(df, from_date), clamp_lookback, limit
        )
        if not series:
            return None
    except Exception:
        return None
    last_bar = _last_bar_timestamp(df)
    return {
        "symbol": str(symbol).upper(),
        "timeframe": timeframe,
        "candles": series,
        "overlays": [],
        "cached": True,
        "stale": True,
        "as_of": as_of,
        # This fallback serves the frame as-is (no tape append), so detection and
        # display share a date; the field is kept for a uniform payload shape.
        "detection_as_of": as_of,
        "close_bar_date": _close_bar_date(df),
        "data_source": "cache",
        "market_open": _india_market_open(),
        "cache_through": _iso_value(last_bar),
        "latest_bar": _iso_value(last_bar),
        "appended": 0,
        "updated": 0,
        "cache_age_sec": _cache_age_sec(last_bar, datetime.now(root_config.IST)),
        "refreshing": False,
        "warning": f"served last cached frame: {reason}",
        "note": f"served last cached frame (through {as_of}); {reason}",
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
    stale_fallback: bool = False,
) -> None:
    _chart_logger.info(
        "chart_fetch symbol=%s timeframe=%s elapsed_ms=%.0f rows=%d cache_hit=%s timeout=%s error=%s stale_fallback=%s",
        symbol, timeframe, elapsed_ms, rows, bool(cache_hit), bool(timeout), error or "",
        "true" if stale_fallback else "false",
    )


def _session_lag_days(as_of: Optional[str], expected: Optional[str]) -> Optional[int]:
    """Calendar-day lag of ``as_of`` behind ``expected`` (sessions for daily
    frames, which only print on trading days). ``None`` when unparseable."""
    if not as_of or not expected:
        return None
    try:
        return (date.fromisoformat(expected) - date.fromisoformat(as_of)).days
    except (ValueError, TypeError):
        return None


def _log_refresh_result(symbol: str, timeframe: str, *, attempt: int,
                        max_attempts: int, rows: int, as_of: Optional[str],
                        expected_as_of: Optional[str], fresh: bool,
                        lag_days: Optional[int], elapsed_ms: float,
                        error: Optional[str] = None) -> None:
    """One structured line per background refresh attempt / final give-up."""
    _chart_logger.info(
        "chart_stale_first_refresh symbol=%s timeframe=%s attempt=%d/%d rows=%d "
        "as_of=%s expected_as_of=%s fresh=%s lag_days=%s elapsed_ms=%.0f error=%s",
        symbol, timeframe, attempt, max_attempts, rows,
        as_of or "", expected_as_of or "", fresh,
        lag_days if lag_days is not None else "", elapsed_ms, error or "",
    )


# Symbol chart fetch: stale-first serving + pattern-hit cache.
#
# For live ``GET /symbol/{symbol}/chart`` (no replay/as-of) the default
# live-edge disk cache is checked *before* the network. A session-current
# frame is returned immediately with ``cached``/``stale`` set and ``as_of``
# pinned to its last session — never as current data — while a daemon thread
# re-fetches in the background so the next poll sees fresh candles. "Session
# current" means: an intraday frame must carry a bar from today (IST); a 1D
# frame must reach the last completed session. The read is one local pickle,
# size-capped, adds no network call, and never applies to replay/as-of
# requests.
#
# ``detect_patterns`` results (and the trend lines computed alongside them)
# are cached per ``(symbol, timeframe, IST session)`` for ~5 minutes so a
# fullscreen poll does not re-run the detector when nothing changed. Entries
# never apply across sessions.

#: Largest default live-edge pickle the stale-first read will touch (bytes).
_STALE_FIRST_MAX_BYTES = int(os.environ.get("CHART_STALE_FIRST_MAX_BYTES", str(16 * 1024 * 1024)))
#: Expected upper bound (ms) for the stale-first disk read; breaches are logged.
_STALE_FIRST_DISK_BUDGET_MS = float(os.environ.get("CHART_STALE_FIRST_DISK_BUDGET_MS", "250"))
_PATTERN_HIT_CACHE_TTL_SEC = float(os.environ.get("CHART_PATTERN_HIT_CACHE_TTL_SEC", "300.0"))
_PATTERN_HIT_CACHE_MAX = 256

_pattern_hit_cache: dict[tuple[str, str, str], tuple[float, dict]] = {}
_pattern_hit_cache_lock = threading.Lock()
#: (symbol, timeframe) pairs with an in-flight background refresh (dedupe).
_refresh_inflight: set[tuple[str, str]] = set()
_refresh_inflight_lock = threading.Lock()


def _pattern_hit_cache_get(symbol: str, timeframe: str, session: str,
                           frame_id: Optional[str] = None) -> Optional[dict]:
    now = _time.monotonic()
    key = (str(symbol).upper(), str(timeframe), session, frame_id)
    with _pattern_hit_cache_lock:
        entry = _pattern_hit_cache.get(key)
        if entry is None:
            return None
        expires, payload = entry
        if now < expires:
            return payload
        _pattern_hit_cache.pop(key, None)
        return None


def _pattern_hit_cache_put(symbol: str, timeframe: str, session: str, payload: dict,
                           frame_id: Optional[str] = None) -> None:
    now = _time.monotonic()
    key = (str(symbol).upper(), str(timeframe), session, frame_id)
    with _pattern_hit_cache_lock:
        while len(_pattern_hit_cache) >= _PATTERN_HIT_CACHE_MAX:
            _pattern_hit_cache.pop(next(iter(_pattern_hit_cache)), None)
        _pattern_hit_cache[key] = (now + _PATTERN_HIT_CACHE_TTL_SEC, payload)


def _clear_symbol_pattern_hits(symbol, timeframe) -> None:
    symbol_u, tf = str(symbol).upper(), str(timeframe)
    with _pattern_hit_cache_lock:
        for key in [k for k in _pattern_hit_cache if k[0] == symbol_u and k[1] == tf]:
            _pattern_hit_cache.pop(key, None)


def _clear_timeframe_pattern_hits(timeframe) -> None:
    tf = str(timeframe)
    with _pattern_hit_cache_lock:
        for key in [k for k in _pattern_hit_cache if k[1] == tf]:
            _pattern_hit_cache.pop(key, None)


def _clear_pattern_hit_cache() -> None:
    """Drop the pattern-hit cache (tests + operator resets)."""
    with _pattern_hit_cache_lock:
        _pattern_hit_cache.clear()


def _clear_chart_caches() -> None:
    """Drop every symbol-chart cache (tests + operator resets)."""
    with _chart_neg_cache_lock:
        _chart_neg_cache.clear()
    _clear_pattern_hit_cache()
    _clear_all_enrichment()
    with _refresh_inflight_lock:
        _refresh_inflight.clear()


def _read_cached_frame(candidates):
    """First readable, non-empty, size-capped frame among ``candidates``.

    A corrupt/unreadable ``lb{N}`` variant must not mask a valid default
    entry: every candidate is tried in order. Returns
    ``(df, path, read_ms)`` or ``(None, None, 0.0)``.
    """
    for candidate in candidates:
        try:
            size = candidate.stat().st_size
        except OSError:
            continue
        if size <= 0:
            continue
        if size > _STALE_FIRST_MAX_BYTES:
            _chart_logger.info(
                "chart_stale_first skipped=size path=%s bytes=%d", candidate, size,
            )
            continue
        start = _time.monotonic()
        try:
            df = candles._read_pickle_any(candidate)
        except Exception:
            df = None
        read_ms = (_time.monotonic() - start) * 1000.0
        if read_ms > _STALE_FIRST_DISK_BUDGET_MS:
            _chart_logger.warning(
                "chart_stale_first slow disk read path=%s read_ms=%.0f",
                candidate, read_ms,
            )
        if df is not None and not getattr(df, "empty", True):
            return df, candidate, read_ms
    return None, None, 0.0


def _stale_first_frame(symbol: str, timeframe: str, lookback_bars) -> Optional[tuple]:
    """Default live-edge disk frame when session-current, else ``None``.

    Local-disk read only: one size-capped pickle, no network. Returns
    ``(df, as_of, read_ms, path)`` where ``as_of`` is the frame's last IST
    session date and ``path`` is the exact file served (an ``lb{N}`` variant
    or the default), so the live tail rewrites the entry the next poll reads.
    Never raises.

    For ``1W``/``1M`` with no exact (fresh) cache, falls back to resampling
    the default ``1D`` cache locally (``W-FRI`` / month-end) so a weekly or
    monthly chart loads instantly instead of going to the network.
    """
    try:
        lb = None if lookback_bars is None else int(lookback_bars)
        variant = f"lb{lb}" if lb is not None else None
        path = candles._cache_path(timeframe, symbol, None, variant=variant)
        # A chart asks for the READ_LOOKBACK_BARS variant (e.g. lb500); if that
        # file was never written or is corrupt, the default live-edge frame is
        # still a valid stale fallback.
        candidates = [path]
        if variant is not None:
            alt = candles._cache_path(timeframe, symbol, None)
            if alt != path:
                candidates.append(alt)
        df, chosen, read_ms = _read_cached_frame(candidates)
        if df is not None:
            as_of = candles.frame_last_date(df)
            if as_of:
                try:
                    lcs = candles._last_completed_session().isoformat()
                except Exception:
                    lcs = None
                if timeframe == "1D":
                    # One stale session (or a weekend) is still worth serving:
                    # the whole point is instant candles while the background
                    # refresh runs. Anything beyond the max-staleness cap is
                    # refused so the caller falls through to the live fetch.
                    lag = _session_lag_days(as_of, lcs)
                    ok = bool(lcs) and lag is not None and lag <= _MAX_STALE_DAYS
                    if not ok and lcs:
                        _chart_logger.info(
                            "chart_stale_first rejected=stale symbol=%s timeframe=%s "
                            "as_of=%s expected_as_of=%s lag_days=%s max_stale_days=%d",
                            symbol, timeframe, as_of, lcs,
                            lag if lag is not None else "", _MAX_STALE_DAYS,
                        )
                elif timeframe in ("1W", "1M"):
                    # Period-labelled bars end on their Friday/month-end, never
                    # "today" (except on the label day itself), so exact-date
                    # equality rejected almost every warm weekly/monthly cache.
                    # Accept a frame that covers the last completed period and
                    # carries no bar for a period that has not closed yet.
                    expected = _last_completed_period_label(lcs, timeframe)
                    ok = _period_cache_covers(as_of, lcs, expected, timeframe)
                    if not ok and lcs:
                        _chart_logger.info(
                            "chart_stale_first rejected=period symbol=%s timeframe=%s "
                            "as_of=%s expected_as_of=%s lag_days=%s max_stale_days=%d",
                            symbol, timeframe, as_of, expected or lcs,
                            _session_lag_days(as_of, expected or lcs)
                            if expected else "",
                            _MAX_STALE_DAYS,
                        )
                else:
                    ok = as_of == _ist_session_date()
                if ok:
                    return df, as_of, read_ms, chosen
        # Weekly/monthly resample fallback: no exact (fresh) 1W/1M cache, so
        # resample the default 1D cache locally — capped work, no network.
        if timeframe in ("1W", "1M"):
            return _stale_first_resampled_daily(symbol, timeframe)
        return None
    except Exception:
        return None


def _ist_session_dates(index) -> list[str]:
    """IST calendar date (``YYYY-MM-DD``) for each index entry; never raises."""
    try:
        idx = index
        if idx.tz is None:
            idx = idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
        else:
            idx = idx.tz_convert("Asia/Kolkata")
        return [ts.date().isoformat() for ts in idx]
    except Exception:
        return [str(ts)[:10] for ts in index]


def _drop_resampled_after(df: pd.DataFrame, as_of: str) -> pd.DataFrame:
    """Drop resampled bars whose label (period end) is after ``as_of``.

    ``_resample_ohlcv`` labels weekly bars on Friday and monthly bars on
    month-end, so a Wednesday daily frame would otherwise return a Friday /
    month-end candle newer than the data it covers. A bar whose period has not
    ended by the last daily session is incomplete; completed-candle semantics
    mean it is omitted, not back-dated or stamped with a future timestamp.
    """
    if df is None or df.empty:
        return df
    dates = _ist_session_dates(df.index)
    keep = [stamp <= as_of for stamp in dates]
    return df[keep]


def _stale_first_resampled_daily(symbol: str, timeframe: str) -> Optional[tuple]:
    """Resample the default ``1D`` live-edge cache into ``1W`` (``W-FRI``) or
    ``1M`` (month-end) candles. Network-free, local disk only.

    Only periods that end on or before the source frame's last session are
    kept: a partial current week/month is dropped rather than emitted with a
    future label. Returns ``(df, as_of, read_ms, path)`` where ``as_of`` is the
    last session date of the source daily frame (truthful "data through" date)
    and ``path`` is that source entry. ``None`` when there is no usable ``1D``
    cache. The caller marks the result ``stale``.
    """
    try:
        path = candles._cache_path("1D", symbol, None)
        try:
            size = path.stat().st_size
        except OSError:
            return None
        if size > _STALE_FIRST_MAX_BYTES:
            _chart_logger.info(
                "chart_stale_first_resample skipped=size symbol=%s timeframe=%s bytes=%d",
                symbol, timeframe, size,
            )
            return None
        start = _time.monotonic()
        df = candles._read_pickle_any(path)
        read_ms = (_time.monotonic() - start) * 1000.0
        if df is None:
            return None
        as_of = candles.frame_last_date(df)
        if not as_of:
            return None
        # Same 3-day freshness tolerance as the 1D stale-first path.
        try:
            lcs = candles._last_completed_session().isoformat()
        except Exception:
            lcs = None
        if (
            not lcs
            or as_of
            < (datetime.fromisoformat(lcs) - timedelta(days=3)).date().isoformat()
        ):
            return None
        rule = "W-FRI" if timeframe == "1W" else "ME"
        out = candles._resample_ohlcv(df, rule)
        if out is None or out.empty:
            return None
        out = _drop_resampled_after(out, as_of)
        if out is None or out.empty:
            return None
        return out, as_of, read_ms, path
    except Exception:
        return None


def _kick_stale_first_refresh(symbol: str, timeframe: str, lookback_bars) -> bool:
    """Re-fetch the default live-edge frame in a daemon thread, with bounded
    retries so a transient Upstox 429/timeout cannot pin the cache forever.

    The request never waits on this; the fresh frame lands in the disk cache
    for the next poll. ``force_refresh`` bypasses the disk read and the
    empty-result negative caches so the refresh actually rewrites the cache.
    Returns ``False`` when a refresh for the pair is already in flight.
    """
    key = (str(symbol).upper(), str(timeframe))
    with _refresh_inflight_lock:
        if key in _refresh_inflight:
            return False
        _refresh_inflight.add(key)

    def _run() -> None:
        last_exc: Optional[Exception] = None
        try:
            try:
                expected_as_of = candles._last_completed_session().isoformat()
            except Exception:
                expected_as_of = None
            for attempt in range(1, _MAX_REFRESH_ATTEMPTS + 1):
                attempt_started = _time.monotonic()
                exc: Optional[Exception] = None
                try:
                    df = candles.fetch_for_timeframe(
                        key[0], key[1],
                        lookback_bars=None if lookback_bars is None else int(lookback_bars),
                        include_partial_today=(key[1] == "1D"),
                        force_refresh=True,
                    )
                except Exception as e:  # noqa: BLE001 - background refresh never propagates
                    exc = e
                    df = None
                last_exc = exc or last_exc
                rows = 0
                as_of: Optional[str] = None
                fresh = False
                lag_days: Optional[int] = None
                if df is not None and not getattr(df, "empty", True):
                    rows = int(len(df))
                    as_of = candles.frame_last_date(df)
                    lag_days = _session_lag_days(as_of, expected_as_of)
                    fresh = bool(expected_as_of and as_of and as_of >= expected_as_of)
                elapsed_ms = (_time.monotonic() - attempt_started) * 1000.0
                _log_refresh_result(
                    key[0], key[1], attempt=attempt,
                    max_attempts=_MAX_REFRESH_ATTEMPTS, rows=rows, as_of=as_of,
                    expected_as_of=expected_as_of, fresh=fresh, lag_days=lag_days,
                    elapsed_ms=elapsed_ms,
                    error=None if exc is None else str(exc)[:200],
                )
                # A non-empty frame (even one that lags the daily API) is the
                # best available data — fetch_for_timeframe has already written
                # it to the cache — so stop retrying and let the next poll serve
                # it (marked with expected_as_of when it lags).
                if df is not None and not getattr(df, "empty", True):
                    # A rewritten candle file may carry a newer frame: forget
                    # this symbol's old enrichment/close so the next read
                    # recomputes against the frame actually on disk.
                    _clear_symbol_enrichment(key[0], key[1])
                    return
                # Empty frame (Upstox returned nothing this session) or an
                # exception: retry after bounded backoff.
                if attempt < _MAX_REFRESH_ATTEMPTS:
                    try:
                        _time.sleep(_REFRESH_BACKOFF_SEC[
                            min(attempt - 1, len(_REFRESH_BACKOFF_SEC) - 1)])
                    except Exception:
                        pass
        finally:
            with _refresh_inflight_lock:
                _refresh_inflight.discard(key)
        _chart_logger.warning(
            "chart_stale_first_refresh exhausted symbol=%s timeframe=%s "
            "attempts=%d last_error=%s", key[0], key[1], _MAX_REFRESH_ATTEMPTS,
            str(last_exc)[:200] if last_exc else "",
        )

    threading.Thread(target=_run, name=f"chart-stale-refresh-{key[0]}-{key[1]}", daemon=True).start()
    return True


def _stored_hits(symbol_u: str, timeframe: str, detail: Optional[dict] = None) -> list:
    """Stored-scan hits in the chart's ``PatternHitDTO`` shape.

    ``store.get_symbol_detail`` already returns each row as a DTO-shaped dict;
    clone it, tag ``source="stored"`` so a consumer can tell these from
    live-detected hits, and strip the risk-sizing fields the chart never
    exposes. ``detail`` lets a caller that already fetched the symbol reuse it.
    Never raises.
    """
    if detail is None:
        try:
            detail = store.get_symbol_detail(symbol_u, timeframe)
        except Exception:
            detail = {}
    patterns = detail.get("patterns", []) if isinstance(detail, dict) else []
    hits: list = []
    for pattern in patterns:
        if not isinstance(pattern, dict):
            continue
        record = dict(pattern)
        record["source"] = "stored"
        hits.append(record)
    _strip_risk_fields(hits)
    return hits


def _stored_overlays(symbol_u: str, timeframe: str) -> list:
    """Pattern-boundary trendlines from the stored scan. Never raises."""
    overlays: list = []
    try:
        detail = store.get_symbol_detail(symbol_u, timeframe)
    except Exception:
        detail = {}
    for pattern in (detail.get("patterns", []) if isinstance(detail, dict) else []):
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
    return overlays


def _pattern_block(df, symbol_u: str, timeframe: str, session: str) -> dict:
    """Hits for the live chart, pattern-hit-cache aware.

    Shared by the network path and the stale-first path. On a cache hit (same
    IST session) the engine/detector are not re-run. Returns a dict with
    ``hits``, ``live_overlays`` and ``cache_hit``. Never raises.
    """
    frame_id = _frame_identity(df)
    cached = _pattern_hit_cache_get(symbol_u, timeframe, session, frame_id)
    if cached is not None:
        return {
            "hits": list(cached.get("hits") or []),
            "live_overlays": list(cached.get("live_overlays") or []),
            "cache_hit": True,
        }
    hits: list = []
    live_overlays: list = []
    if df is not None and not getattr(df, "empty", True) and engine_mod is not None:
        try:
            live = engine_mod.detect_patterns(df, timeframe, symbol_u) or []
        except Exception:
            live = []
        for hit in live:
            record = _live_hit_to_dict(hit, symbol_u, timeframe)
            if record is not None:
                hits.append(record)
    for record in hits:
        overlay = _live_overlay(record)
        if overlay is not None:
            live_overlays.append(overlay)
    return {
        "hits": hits,
        "live_overlays": live_overlays,
        "cache_hit": False,
    }


def _store_pattern_block(symbol_u: str, timeframe: str, session: str, block: dict,
                         frame_id: Optional[str] = None) -> None:
    _pattern_hit_cache_put(symbol_u, timeframe, session, {
        "hits": list(block["hits"]),
        "live_overlays": list(block["live_overlays"]),
    }, frame_id)


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


def _timeframes_fingerprint():
    """Cheap identity of the enabled timeframe registry for the catalog key.

    ``get_configs`` is itself cached and invalidated by admin edits, so this
    changes the moment a timeframe is added/removed/reordered — the catalog
    entry never outlives the config it was built from. ``None`` means the
    payload builder falls back to the frozen list.
    """
    try:
        from chart_patterns import timeframe_config

        return tuple(
            (
                row.get("id"), row.get("sort_order"), row.get("enabled"),
                row.get("label"), row.get("minutes"), row.get("native"),
                row.get("source_tf"), row.get("max_lookback_days"), row.get("min_bars"),
            )
            for row in timeframe_config.get_configs()
        )
    except Exception:
        return None


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


def _filter_frame_from(df, from_date: Optional[str]):
    """Rows whose IST calendar date is on/after ``from_date``; passthrough else.

    The live fetch keeps its normal window so detection still sees the history
    before ``from_date``; only the displayed frame (candles, indicators and
    warm-up) is clipped to the requested start. Never raises.
    """
    if not from_date or df is None or getattr(df, "empty", True):
        return df
    try:
        keys = _ist_session_dates(df.index)
        keep = [key >= from_date for key in keys]
        if all(keep):
            return df
        return df[keep]
    except Exception:
        return df


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


def _warmup_candles(frame, series: list) -> list:
    """Bars preceding the displayed tail of ``frame`` (indicator warm-up).

    The displayed series is always a tail of the frame, so this is the exact
    earlier slice a session VWAP needs. Never raises; no frame/series → ``[]``.
    """
    if frame is None or not series:
        return []
    try:
        total = len(frame)
        shown = len(series)
        if total <= shown:
            return []
        return _fast_candle_series(frame.iloc[: total - shown], None)
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


def _finalize_item(item, df, *, key, lookback_bars, max_bars=None):
    """Attach a candle window + last close/day change to one item.

    Phase-2 of :func:`_enrich_with_candles`, factored so the SSE stream
    (``GET /results/stream``) reuses the exact per-item logic — a streamed
    item is byte-identical to its batched twin. ``key`` is the
    ``(symbol, timeframe)`` fetch key (``None`` when the item carries no
    symbol/timeframe).

    ``max_bars`` caps the returned candle window (``None`` = the full
    ``CHART_MAX_BARS``). Cards pass :data:`chart_patterns.config.CARD_MAX_BARS`:
    a ~300px sparkline cannot use 700 bars, and shipping them was most of the
    ``/results`` payload. The chart/detail paths keep the full series.
    Mutates and returns ``item``; never raises for a dict item.
    """
    if isinstance(item, dict):
        item.setdefault("tags", tags_for(str(item.get("symbol") or "")))
    candle_limit = config.CHART_MAX_BARS if max_bars is None else int(max_bars)
    frame_id = _frame_identity(df)
    if key is None or frame_id is None:
        # No frame means no close to report. Never keep a value an earlier
        # enrichment may have left on the item — it would read as current.
        if isinstance(item, dict):
            item["candles"] = []
            item["last_close"] = None
            item["day_change_pct"] = None
            item["close_bar_date"] = None
        return item
    # The close, its date, the change and the candles all come from THIS frame.
    # The key carries its identity, so a newer frame can never reuse an older
    # value — within this request or across requests. The candle limit is part
    # of the key: a card (160 bars) and a chart (full) share the frame but not
    # the series.
    enrich_key = (
        str(key[0]).upper(), str(key[1]), lookback_bars,
        candle_limit, frame_id,
    )
    cached = _enrichment_cache_get(enrich_key)
    if cached is None:
        cached = (
            _clamped_candle_series(df, lookback_bars, candle_limit),
            *_last_close_change(df),
            _close_bar_date(df),
        )
        _enrichment_cache_put(enrich_key, cached)
    item["candles"], item["last_close"], item["day_change_pct"], item["close_bar_date"] = cached
    _remember_frame(key, df, item["last_close"], item["day_change_pct"])
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


def _enrich_with_candles(items, default_timeframe: Optional[str] = None, max_bars: Optional[int] = None,
                          lookback_bars: Optional[int] = None, for_cards: bool = False):
    """Attach a real candle window + last close/day change to each result item.

    Candles are served from ``candles.fetch_for_timeframe`` (disk-cached), so
    this also retrofits hits persisted before candle windows were exposed.
    The fetch covers the full Lookback window (``lookback_bars`` or the
    ``READ_LOOKBACK_BARS`` default) for detection headroom, but when
    ``lookback_bars`` is provided the card window is clamped to exactly the
    last ``lookback_bars`` bars so card mini-charts span the Lookback. When
    ``lookback_bars`` is None (Auto) the whole fetched window is shown.

    ``max_bars`` caps the returned series. Cards (``for_cards=True``) default
    to :data:`chart_patterns.config.CARD_MAX_BARS` — a ~300px sparkline does
    not read 700 bars, and shipping them was most of the ``/results`` body.
    The chart/detail paths pass ``for_cards=False`` and keep the full series
    unless a caller asks for an explicit cap.
    """
    if max_bars is None:
        max_bars = config.CARD_MAX_BARS if for_cards else config.CHART_MAX_BARS
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
    # Phase 2: per-item enrichment in the original order (clamp, series,
    # last close/day change) — unchanged.
    for item in items:
        key = _item_fetch_key(item, default_timeframe)
        _finalize_item(
            item, cache.get(key) if key is not None else None, key=key,
            lookback_bars=lookback_bars, max_bars=max_bars,
        )
    return items


class DetectRequest(BaseModel):
    """Single-symbol, synchronous pattern check (no job queue)."""

    symbol: str
    timeframe: str
    lookback_bars: Optional[int] = 150


#: Hard cap on one lookup request. A table page is ~50-300 rows; 500 leaves
#: room for a full universe without letting one call become a bulk export.
_LOOKUP_MAX_SYMBOLS = 500


class PatternsLookupRequest(BaseModel):
    """Batch availability of already-computed patterns (read-only, no detection)."""

    symbols: list[str] = Field(..., max_length=_LOOKUP_MAX_SYMBOLS)
    timeframe: str = "1D"
    # Optional universe scope, so a caller aligned with the matrix gets exactly
    # the matrix's rows. Unscoped reads fall back to the store's usual
    # newest-row-per-pattern dedupe across every stored scan.
    universe: Optional[str] = None


class ScanRequest(BaseModel):
    universe: str = ""
    timeframe: str
    force: bool = False
    refresh: bool = False
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


def _normalize_symbol_list(raw, cap: Optional[int] = None) -> list[str]:
    """Upper-cased, de-duplicated, order-preserving symbol scope (capped)."""
    limit = MAX_CUSTOM_SYMBOLS if cap is None else int(cap)
    out: list[str] = []
    seen: set = set()
    for item in raw or []:
        symbol = str(item or "").strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
        if len(out) >= limit:
            break
    return out


@router.get("/timeframes")
async def get_timeframes():
    key = _catalog_cache_key("timeframes", _timeframes_fingerprint())
    cached = _read_cache_get(_catalog_cache, key)
    if cached is not None:
        return JSONResponse(content=cached)
    payload = _sanitize_for_json({"timeframes": _timeframes_payload()})
    _read_cache_put(_catalog_cache, key, payload, ttl=_CATALOG_CACHE_TTL_SEC)
    return JSONResponse(content=payload)


@router.get("/universes")
async def get_universes():
    key = _catalog_cache_key("universes")
    cached = _read_cache_get(_catalog_cache, key)
    if cached is not None:
        return JSONResponse(content=cached)
    payload = _sanitize_for_json({"universes": _universes_payload(), "default": "nifty50"})
    _read_cache_put(_catalog_cache, key, payload, ttl=_CATALOG_CACHE_TTL_SEC)
    return JSONResponse(content=payload)


@router.get("/patterns")
async def get_patterns():
    key = _catalog_cache_key("patterns")
    cached = _read_cache_get(_catalog_cache, key)
    if cached is not None:
        return JSONResponse(content=cached)
    payload = _sanitize_for_json({"families": list(_FAMILIES), "patterns": _patterns_payload()})
    _read_cache_put(_catalog_cache, key, payload, ttl=_CATALOG_CACHE_TTL_SEC)
    return JSONResponse(content=payload)


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
    # Hits are read off this same frame, so tag them with its IST bar date.
    # No frame date means no tag — never substitute the request/scan time.
    bar_date = _close_bar_date(df)
    if bar_date is not None:
        for hit in items:
            if isinstance(hit, dict):
                hit["close_bar_date"] = bar_date
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
            for symbol in symbols:
                _clear_symbol_enrichment(symbol, request.timeframe)
                _clear_symbol_pattern_hits(symbol, request.timeframe)
        else:
            candles.clear_cache(timeframe=request.timeframe)
            _clear_timeframe_enrichment(request.timeframe)
            _clear_timeframe_pattern_hits(request.timeframe)
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
                           out, stop, max_bars=None):
    """Enrich each item on a bounded pool, enqueueing as results arrive.

    Queue protocol: ``("item", sanitized_dict)`` per enriched card,
    ``("error", message)`` on a task failure, always terminated by
    ``("end", None)``. Never raises (the terminator is sent from ``finally``).
    ``max_bars`` mirrors the batch path's candle cap so a streamed card is
    byte-identical to its ``/results`` twin.
    """
    df_cache: dict = {}
    lock = threading.Lock()

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
            item, df, key=key, lookback_bars=lookback_bars, max_bars=max_bars,
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
                              total, summary, data_through,
                              request=None, max_bars=None):
    """Async SSE body for ``GET /results/stream`` (also drives the tests).

    Emits ``meta`` immediately (before any candle fetch), one ``item`` per
    fully enriched card as each enrichment completes, then ``done``. Never
    raises mid-stream: unexpected failures become ``event: error`` and close
    the stream. ``max_bars`` mirrors the batch path's candle cap.
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
            "out": out, "stop": stop, "max_bars": max_bars,
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
    # Cards are ~300px sparklines, so the series is capped at CARD_MAX_BARS;
    # the chart/detail endpoints keep the full window.
    await run_in_threadpool(_enrich_with_candles, items, query.filters.get("timeframe"),
                            lookback_bars=query.lookback_bars, for_cards=True)
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
            lookback_bars=query.lookback_bars, total=total,
            summary=summary, data_through=summary.get("data_through"),
            request=request, max_bars=config.CARD_MAX_BARS,
        ):
            yield frame

    return StreamingResponse(_body(), media_type="text/event-stream", headers=dict(_SSE_HEADERS))


@router.get("/summary")
async def get_summary(filters: dict = Depends(_summary_filters)):
    cache_key = _summary_cache_key(filters)
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
    # Same completed-session frame as the results enrichment (this fetch never
    # appends today's tape bar), so publishing it keeps the matrix readable for
    # a symbol charted but not currently carrying stored hits.
    _remember_frame((symbol, timeframe), df, last_close, day_change)
    fields = {"last_close": last_close, "day_change_pct": day_change, "history_bars": int(len(df))}
    bar_date = _close_bar_date(df)
    if bar_date is not None:
        fields["close_bar_date"] = bar_date
    return fields


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
    record.setdefault("source", "live")
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


def _live_detect_block(df, symbol_u: str, timeframe: str) -> dict:
    """Pure live detection on a provider frame — no store, no NSE calendar.

    The engine is price geometry over a normalised UTC OHLCV frame; it does not
    read the IST session, the NSE holiday calendar or Upstox. That makes the
    same helpers the India live-chart path uses reusable for a US frame.
    ``hits`` are tagged ``source="live"`` by :func:`_live_hit_to_dict`. Never
    raises: a broken frame yields empty lists.
    """
    hits: list = []
    overlays: list = []
    if df is not None and not getattr(df, "empty", True) and engine_mod is None:
        _chart_logger.error(
            "chart_live_detect_unavailable symbol=%s timeframe=%s: pattern engine not importable",
            symbol_u, timeframe,
        )
    if df is not None and not getattr(df, "empty", True) and engine_mod is not None:
        try:
            live = engine_mod.detect_patterns(df, timeframe, symbol_u) or []
        except Exception:
            # An engine failure used to become a silent empty hit list, which
            # made a broken detector indistinguishable from "no patterns".
            _chart_logger.exception(
                "chart_live_detect_failed symbol=%s timeframe=%s rows=%d",
                symbol_u, timeframe, len(df),
            )
            live = []
        for hit in live:
            record = _live_hit_to_dict(hit, symbol_u, timeframe)
            if record is None:
                continue
            record["source"] = "live"
            hits.append(record)
            overlay = _live_overlay(record)
            if overlay is not None:
                overlays.append(overlay)
    return {"hits": hits, "live_overlays": overlays}


async def _asof_symbol_chart(
    symbol: str,
    timeframe: str,
    limit: int,
    lookback_bars: Optional[int],
    detect_patterns: bool,
    as_of_date: str,
    from_date: Optional[str],
) -> dict:
    """Replay chart: the frame is truncated to ``as_of_date`` (IST).

    Stored overlays are "now" and never apply to a replay, so ``overlays``/``hits``
    come only from live detection on the truncated frame (windowed by
    ``from_date`` when set). ``include_partial_today`` is forced off — a replay
    frame ends at ``to_dt``, never with a synthetic today bar.
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
    return _with_chart_extras(
        {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "candles": series,
            "overlays": overlays,
            "hits": hits,
            "as_of": to_dt.isoformat(),
            "from_date": from_date,
        },
        "india",
        timeframe,
        warmup=_warmup_candles(df, series),
    )


def _chart_display_frame(base_df, symbol_u: str, timeframe: str) -> tuple:
    """Return ``(display_df, is_partial)`` for a live chart response.

    ``base_df`` is the completed-session frame used for detection and caches and
    is never mutated. On the network path ``fetch_for_timeframe`` has already
    appended today's tape bar (and set ``partial_today``), so only its marker is
    read here. When that marker is absent — a stale disk frame, or a fetch whose
    own append bailed — the bar is appended here.

    The append gate is :func:`candles.missing_today_bar` ("does the frame end on
    the last completed session instead of today"), never
    ``as_of < last_completed_session``: the latter only advances at the 15:30
    close, so on a live Monday it still names Friday and a Friday frame would
    look complete for the whole session.

    ``is_partial`` is true only while the session is still trading — once the
    15:30 IST close has passed the bar is final and carries no marker. Never
    raises.
    """
    display = base_df
    is_partial = False
    if base_df is None or getattr(base_df, "empty", True):
        return display, is_partial
    if timeframe != "1D":
        return display, is_partial
    attrs = getattr(base_df, "attrs", {}) or {}
    if attrs.get("partial_today"):
        is_partial = bool(attrs.get(
            "partial_today_in_progress", attrs.get("partial_today", False)
        ))
        return display, is_partial
    if not candles.missing_today_bar(base_df):
        return display, is_partial
    try:
        merged = candles.with_partial_today(base_df, symbol_u)
        if merged is not None and not merged.empty and len(merged) > len(base_df):
            display = merged
            attrs = getattr(merged, "attrs", {}) or {}
            is_partial = bool(attrs.get(
                "partial_today_in_progress", attrs.get("partial_today", False)
            ))
    except Exception:
        pass
    return display, is_partial


def _mark_partial_last(series: list, is_partial: bool) -> list:
    """Flag the trailing displayed candle as in-progress, when applicable."""
    if is_partial and series:
        series[-1]["is_partial"] = True
    return series


def _local_timestamp(value, tz_name: str):
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        return ts.tz_localize(tz_name)
    return ts.tz_convert(tz_name)


def _now_timestamp(now, tz_name: str):
    if now is None:
        return pd.Timestamp.now(tz=tz_name)
    ts = pd.Timestamp(now)
    if ts.tzinfo is None:
        return ts.tz_localize(tz_name)
    return ts.tz_convert(tz_name)


def _period_last_session(day: date, timeframe: str) -> Optional[date]:
    """Last trading day of the week/month containing ``day`` (NSE calendar)."""
    if timeframe == "1M":
        candidate = (
            day.replace(day=28) + timedelta(days=4)
        ).replace(day=1) - timedelta(days=1)
    elif timeframe == "1W":
        candidate = day + timedelta(days=(4 - day.weekday()) % 7)
    else:
        return None
    try:
        if candles._is_trading_day(candidate):
            return candidate
        return candles.previous_trading_day(candidate) or candidate
    except Exception:
        return candidate


def _month_end(day: date) -> date:
    """Calendar month-end date containing ``day``."""
    return (day.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def _last_completed_period_label(lcs: Optional[str], timeframe: str) -> Optional[str]:
    """Provider label (period end) of the last period closed by ``lcs``.

    Weekly bars are labelled on the week's last session (Friday); monthly bars
    on the calendar month end, which may be a weekend/holiday after the last
    session. Before a period's final session, the previous period's label is
    the last completed one.
    """
    if not lcs:
        return None
    try:
        day = date.fromisoformat(lcs)
    except (TypeError, ValueError):
        return None
    if timeframe == "1W":
        end = _period_last_session(day, timeframe)
        if end is not None and end > day:
            end = _period_last_session(day - timedelta(days=7), timeframe)
        return end.isoformat() if end is not None else None
    if timeframe == "1M":
        end = _period_last_session(day, timeframe)
        if end is None:
            return None
        if end > day:
            return _month_end(day.replace(day=1) - timedelta(days=1)).isoformat()
        return _month_end(day).isoformat()
    return None


def _period_key(day: date, timeframe: str) -> tuple[int, int]:
    """Calendar period containing ``day``: ISO week for 1W, year-month for 1M."""
    if timeframe == "1W":
        iso = day.isocalendar()
        return (iso.year, iso.week)
    return (day.year, day.month)


def _period_cache_covers(
    as_of: Optional[str],
    lcs: Optional[str],
    expected: Optional[str],
    timeframe: str,
) -> bool:
    """Whether a period-labelled cache ends at/after the last completed period.

    A label in a later period than the last completed one names a bar for a
    period that has not closed, so it is never served. Either label convention
    is accepted within the completed period (period start, mid-period or end),
    and the daily path's max-staleness tolerance still applies to an older
    period's label.
    """
    if not as_of or not lcs or not expected:
        return False
    try:
        label = date.fromisoformat(as_of)
        last_session = date.fromisoformat(lcs)
        period_end = date.fromisoformat(expected)
    except (TypeError, ValueError):
        return False
    # A weekly label may not run past the last completed session (the current
    # week's Friday is "future" until that week's final session closes).
    if timeframe == "1W" and label > last_session:
        return False
    label_key = _period_key(label, timeframe)
    expected_key = _period_key(period_end, timeframe)
    if label_key == expected_key:
        return True
    if label_key > expected_key:
        return False
    return (period_end - label).days <= _MAX_STALE_DAYS


def _intraday_bar_partial(bar_ts, now, market: str) -> bool:
    """True while the bar's session is still trading.

    A bar dated before today is historical and complete; after the exchange
    close the last bar is final. Only the current session's trailing bar is
    flagged.
    """
    tz_name = indicators_mod.session_for_market(market)
    try:
        bar_local = _local_timestamp(bar_ts, tz_name)
        now_local = _now_timestamp(now, tz_name)
    except (TypeError, ValueError, OverflowError):
        return False
    if bar_local.date() != now_local.date():
        return False
    if market == "usa":
        try:
            from market_data.providers import sessions as us_sessions

            return bool(us_sessions.is_us_open(now_local.to_pydatetime()))
        except Exception:
            return False
    try:
        from trading.utils import MARKET_CLOSE

        close_hour, close_minute = MARKET_CLOSE
    except Exception:
        close_hour, close_minute = 15, 30
    if now_local.hour * 60 + now_local.minute >= close_hour * 60 + close_minute:
        return False
    try:
        if candles.current_session_date(now_local.to_pydatetime()) is None:
            return False
    except Exception:
        pass
    return True


def _period_bar_partial(bar_ts, timeframe: str, now) -> bool:
    """True when the weekly/monthly bar's period has not closed yet."""
    try:
        bar_local = _local_timestamp(bar_ts, "Asia/Kolkata")
        now_local = _now_timestamp(now, "Asia/Kolkata")
    except (TypeError, ValueError, OverflowError):
        return False
    period_end = _period_last_session(bar_local.date(), timeframe)
    if period_end is None:
        return False
    today = now_local.date()
    if today != period_end:
        return today < period_end
    try:
        from trading.utils import MARKET_CLOSE

        close_hour, close_minute = MARKET_CLOSE
    except Exception:
        close_hour, close_minute = 15, 30
    return now_local.hour * 60 + now_local.minute < close_hour * 60 + close_minute


def _infer_partial_last(candles_list: list, timeframe: str, market: str, now=None) -> bool:
    """Whether the trailing candle's forming period is still open.

    The explicit ``is_partial`` marker covers the 1D synthetic bar; intraday
    and weekly/monthly bars are inferred here so a cross on a still-forming
    bar is suppressed on every timeframe, not just ``1D``.
    """
    if not candles_list:
        return False
    last = candles_list[-1]
    if not isinstance(last, dict) or last.get("t") is None:
        return False
    if indicators_mod.is_intraday_timeframe(timeframe):
        return _intraday_bar_partial(last.get("t"), now, market)
    if timeframe in ("1W", "1M"):
        return _period_bar_partial(last.get("t"), timeframe, now)
    return False


def _with_chart_extras(
    payload: dict, market: str, timeframe: str, *,
    warmup: Optional[list] = None, now=None,
) -> dict:
    """Attach ``indicators`` + ``sr_zones`` to one chart payload.

    This is the single source of the extras for every chart return branch:
    live, stale-first, cached/negative-cache, as-of replay, US and empty/error.
    The math runs *after* any cache lookup, on the exact candle list being
    returned, so a cached payload can never serve stale indicator values:
    ``values.length === candles.length`` by construction. ``warmup`` carries
    earlier bars from the source frame when the caller has one, so a displayed
    window that starts mid-session still gets an open-anchored VWAP; without
    it the partial first session stays ``None``. Empty/error payloads carry
    ``indicators: None`` + ``sr_zones: []``. Never raises — a math failure
    degrades to the same empty shape instead of an HTTP 500.
    """
    if not isinstance(payload, dict):
        return payload
    session = indicators_mod.session_for_market(market)
    tf = str(payload.get("timeframe") or timeframe or "")
    payload["indicators"] = None
    payload["sr_zones"] = []
    candles_list = payload.get("candles")
    if not isinstance(candles_list, list) or not candles_list:
        return payload
    try:
        last = candles_list[-1] if isinstance(candles_list[-1], dict) else {}
        if last and _infer_partial_last(candles_list, tf, market, now):
            last["is_partial"] = True
        partial_last = bool(last.get("is_partial"))
        payload["indicators"] = indicators_mod.compute_indicators(
            candles_list, tf, session, warmup=warmup, partial_last=partial_last
        )
        payload["sr_zones"] = levels_mod.compute_sr_zones(
            candles_list, session=session, timeframe=tf
        )
    except Exception:  # noqa: BLE001 - extras must never break a chart
        _chart_logger.warning(
            "chart_extras_failed symbol=%s timeframe=%s market=%s",
            payload.get("symbol"), tf, market, exc_info=True,
        )
        payload["indicators"] = None
        payload["sr_zones"] = []
    return payload


# US-stock chart (market=usa).
#
# The provider/cache/session modules are imported lazily inside the handler so
# the India path never depends on them and stays byte-identical. A US chart is
# deliberately thin: candles come from the provider via its cache. Optional
# pattern detection runs the *pure* price engine on that frame (no store, no
# calendar); the NSE session, Upstox and the stored scan are never touched.
# All failures are mapped to fixed error payloads — no upstream text reaches
# the client.

_US_TIMEFRAMES = frozenset({"1m", "5m", "15m", "1h", "1D"})
_US_UNAVAILABLE_DETAIL = "US market data temporarily unavailable"
_US_DEFAULT_FEED = "yahoo"
_US_DEFAULT_DELAY_LABEL = "~1 min (forming)"
# Public route: only well-formed ticker symbols may reach the provider/cache.
# ``fullmatch`` gives anchored semantics without letting Python's ``$`` slip
# past a trailing newline. Alphanumeric at both ends rejects leading/trailing
# separators; the explicit ``..`` guard below rejects path-traversal dot pairs
# (the interior class allows '.', as ``us_cache._safe_symbol`` does). Uppercase
# + a single dot/hyphen keeps ordinary tickers (AAPL) and share classes
# (BRK.B / BRK-B) valid.
_US_SYMBOL_ALLOWLIST = re.compile(r"[A-Z0-9](?:[A-Z0-9.\-]{0,18}[A-Z0-9])?")
_US_INVALID_SYMBOL_DETAIL = "Invalid US chart symbol"
# A rate-limited upstream may hand back a Retry-After hint. Only a bounded,
# positive integer is safe to echo — never any upstream text.
_US_UPSTREAM_RETRY_DEFAULT = 60
_US_UPSTREAM_RETRY_CAP = 300


def _us_safe_retry_after(value) -> int:
    """Clamp an upstream retry hint to a small positive integer, or a default."""
    try:
        seconds = int(str(value).strip())
    except (TypeError, ValueError):
        return _US_UPSTREAM_RETRY_DEFAULT
    if seconds <= 0:
        return _US_UPSTREAM_RETRY_DEFAULT
    return min(seconds, _US_UPSTREAM_RETRY_CAP)


def _us_tz_aware_frame(df):
    """Copy ``df`` with a tz-aware index; localize a naive one to UTC.

    The frontend pins naive ISO strings to IST, which would place a US bar
    ~9.5h off. The provider contract already promises tz-aware UTC, so this is
    a last-resort guard rather than a normal path.
    """
    if df is None or getattr(df, "empty", False):
        return df
    try:
        if isinstance(getattr(df, "index", None), pd.DatetimeIndex) and df.index.tz is None:
            return df.tz_localize("UTC")
    except Exception:
        return df
    return df


async def _us_symbol_chart(
    symbol: str,
    timeframe: str,
    limit: int,
    lookback_bars: Optional[int],
    as_of_date: Optional[str],
    request: Request,
    detect_patterns: bool = False,
):
    """US chart payload. Returns a JSON response, never touches the NSE stack.

    Detection is opt-in (``detect_patterns``): when requested, the pure price
    engine runs directly on the provider frame and its hits/overlays are
    returned with ``source="live"``. The India-only stored scan, Upstox
    fetch, IST session calendar and NSE holidays are never consulted.
    """
    if as_of_date is not None:
        raise HTTPException(
            status_code=400,
            detail="as_of_date is not supported for US charts (v1 has no US replay)",
        )
    if timeframe not in _US_TIMEFRAMES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported US timeframe {timeframe!r}; "
                f"expected one of {sorted(_US_TIMEFRAMES)}"
            ),
        )
    # Validate before touching the provider or the cache: a public caller must
    # not be able to feed arbitrary strings into yfinance or the disk cache.
    symbol_u = str(symbol).strip().upper()
    if ".." in symbol_u or _US_SYMBOL_ALLOWLIST.fullmatch(symbol_u) is None:
        raise HTTPException(status_code=400, detail=_US_INVALID_SYMBOL_DETAIL)

    import importlib

    try:
        registry = importlib.import_module("market_data.providers.registry")
        us_sessions = importlib.import_module("market_data.providers.sessions")
        us_cache = importlib.import_module("chart_patterns.us_cache")
        try:
            provider_no_data = importlib.import_module(
                "market_data.providers.base"
            ).ProviderNoData
        except (ImportError, AttributeError):
            provider_no_data = importlib.import_module(
                "market_data.providers"
            ).ProviderNoData
    except (ImportError, AttributeError) as exc:
        # A missing US stack is an availability problem, never a 500.
        raise HTTPException(status_code=502, detail=_US_UNAVAILABLE_DETAIL) from exc

    provider = registry.provider_for("usa")

    df = None
    try:
        df = us_cache.get_us_candles(symbol_u, timeframe)
    except Exception:  # noqa: BLE001 - cache is an optimization, not a dependency
        df = None
    if df is None or getattr(df, "empty", False):
        # Cold fetch -> one upstream call, so it spends a token. A warm cache
        # hit returns above without ever reaching this branch.
        client_ip = request.client.host if request.client else "unknown"
        allowed, retry_after = us_chart_limiter.check(client_ip)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail={"code": "rate_limited", "detail": US_CHART_RATE_DETAIL},
                headers={"Retry-After": str(retry_after)},
            )
        try:
            df = await run_in_threadpool(provider.candles, symbol_u, timeframe)
        except provider_no_data as exc:
            # Auth/config and rate-limit failures subclass ProviderNoData so
            # legacy callers keep catching them, but they are not "no data".
            # Distinguish via the neutral ``kind`` marker and map to a fixed
            # payload — upstream text never reaches the client.
            kind = getattr(exc, "kind", "no_data")
            if kind == "auth":
                _chart_logger.warning(
                    "us_chart provider auth failure symbol=%s timeframe=%s",
                    symbol_u, timeframe,
                )
                return JSONResponse(
                    status_code=502,
                    content={
                        "error": "us_data_unavailable",
                        "detail": _US_UNAVAILABLE_DETAIL,
                    },
                )
            if kind == "rate_limit":
                retry_after = _us_safe_retry_after(getattr(exc, "retry_after", None))
                _chart_logger.warning(
                    "us_chart provider rate limited symbol=%s timeframe=%s",
                    symbol_u, timeframe,
                )
                return JSONResponse(
                    status_code=429,
                    content={"code": "rate_limited", "detail": US_CHART_RATE_DETAIL},
                    headers={"Retry-After": str(retry_after)},
                )
            return JSONResponse(
                status_code=404,
                content={"error": "us_no_data", "symbol": symbol_u},
            )
        except Exception as exc:  # noqa: BLE001 - never leak upstream text
            _chart_logger.warning(
                "us_chart provider failure symbol=%s timeframe=%s error=%s",
                symbol_u, timeframe, str(exc)[:200],
            )
            return JSONResponse(
                status_code=502,
                content={
                    "error": "us_data_unavailable",
                    "detail": _US_UNAVAILABLE_DETAIL,
                },
            )
        if df is None or getattr(df, "empty", False):
            return JSONResponse(
                status_code=404,
                content={"error": "us_no_data", "symbol": symbol_u},
            )
        try:
            us_cache.put_us_candles(symbol_u, timeframe, df)
        except Exception:  # noqa: BLE001 - a failed cache write must not fail the chart
            pass

    df = _us_tz_aware_frame(df)
    series = _clamped_candle_series(df, lookback_bars, limit)
    attrs = getattr(df, "attrs", {}) or {}
    # `partial_last` records that the provider *saw* a forming tail, not that
    # the returned tail is incomplete. On the 1m path the zero-volume forming
    # bar is dropped, so the last candle is completed and must not be styled as
    # in-progress. Only a kept forming bar (or an explicit `is_partial`) marks
    # the tail incomplete.
    tail_is_incomplete = bool(attrs.get("is_partial")) or bool(
        attrs.get("partial_last") and not attrs.get("forming_dropped")
    )
    if series and tail_is_incomplete:
        series[-1]["is_partial"] = True

    try:
        session_fn = us_sessions.session_date
        session = session_fn() if callable(session_fn) else session_fn
    except Exception:  # noqa: BLE001 - session label is informational
        session = None

    def _meta(name: str, default: str) -> str:
        value = getattr(provider, name, None)
        if callable(value):
            try:
                value = value()
            except Exception:  # noqa: BLE001
                value = None
        return value or default

    hits: list = []
    overlays: list = []
    if detect_patterns:
        block = _live_detect_block(df, symbol_u, timeframe)
        hits = block["hits"]
        overlays = block["live_overlays"]

    return _json_response(_with_chart_extras({
        "symbol": symbol_u,
        "timeframe": timeframe,
        "candles": series,
        "overlays": overlays,
        "hits": hits,
        "market": "usa",
        "feed": _meta("feed", _US_DEFAULT_FEED),
        "delay_label": _meta("delay_label", _US_DEFAULT_DELAY_LABEL),
        "session_date": session,
    }, "usa", timeframe, warmup=_warmup_candles(df, series)))


def _chart_freshness(
    display_as_of: Optional[str],
    detection_as_of: Optional[str],
    expected_as_of: Optional[str],
    *,
    served_from_cache: bool,
) -> dict:
    """Freshness fields describing what the *chart shows*, not the base frame.

    ``as_of`` is the last displayed bar, so a stale-first serve that appends
    today's tape bar is current even though detection (and its hit ``bars_ago``)
    stay pinned to the completed-session ``detection_as_of`` frame. ``stale`` is
    true only when the displayed series still ends before the last completed
    session — a cache serve of a session-current frame is ``cached``, not stale.
    ``expected_as_of`` is echoed only for the daily path that can actually lag.
    Intraday callers pass ``expected_as_of=None``: their cache serve is always
    flagged stale, since "today" says nothing about the last bar's age.
    """
    if display_as_of and expected_as_of:
        stale = display_as_of < expected_as_of
    else:
        stale = bool(served_from_cache)
    fields = {
        "as_of": display_as_of,
        "stale": stale,
        "detection_as_of": detection_as_of,
    }
    if stale and expected_as_of:
        fields["expected_as_of"] = expected_as_of
    return fields


class IndicatorSeries(BaseModel):
    """One indicator line, aligned 1:1 with the response candles."""
    id: str
    values: list[Optional[float]] = Field(default_factory=list)


class IndicatorCross(BaseModel):
    """A golden/death SMA50×SMA200 event on a candle ``t`` string."""
    t: str
    kind: str


class ChartIndicators(BaseModel):
    """Optional indicator block; ``aligned`` is always ``candles``."""
    aligned: str = "candles"
    timeframe: str
    session: str
    partial_last: bool = False
    series: list[IndicatorSeries] = Field(default_factory=list)
    crosses: list[IndicatorCross] = Field(default_factory=list)


class SRZone(BaseModel):
    """One support/resistance zone, never extended past the last candle."""
    kind: str
    top: float
    bottom: float
    start_date: str
    end_date: str
    touches: int
    score: float
    start_time: Optional[str] = Field(
        default=None,
        description="Exact first-touch bar timestamp (intraday frames only).",
    )
    end_time: Optional[str] = Field(
        default=None,
        description="Exact last-touch bar timestamp (intraday frames only).",
    )


class SymbolChartResponse(BaseModel):
    """Documented shape of the chart payload (India and US paths).

    The US path (``market=usa``) adds ``market``/``feed``/``delay_label``/
    ``session_date`` and returns ``hits`` from live detection on the provider
    frame. Fields are optional because empty/error branches omit most of them.
    The handler writes a ``JSONResponse`` directly, so this model documents the
    OpenAPI contract without re-encoding the candle-heavy payload.
    """
    symbol: str
    timeframe: Optional[str] = None
    candles: list = Field(default_factory=list)
    overlays: list = Field(default_factory=list)
    hits: list = Field(default_factory=list)
    as_of: Optional[str] = None
    stale: Optional[bool] = None
    detection_as_of: Optional[str] = None
    expected_as_of: Optional[str] = None
    note: Optional[str] = None
    warning: Optional[str] = Field(
        default=None,
        description="Non-fatal data warning (e.g. a failed live-tail merge).",
    )
    cached: Optional[bool] = Field(
        default=None,
        description="True when candles were served from the live-edge disk cache.",
    )
    close_bar_date: Optional[str] = Field(
        default=None,
        description="IST session date (YYYY-MM-DD) of the last displayed candle.",
    )
    data_source: Optional[str] = Field(
        default=None,
        description=(
            "Candle provenance for this response: 'provider' (network fetch), "
            "'cache' (disk cache only), 'cache+tail' (cache + live tail merge), "
            "'cache+tail-failed' (tail attempted, cached frame served), or "
            "'none' (empty/error). Never reuse `source`, which tags pattern hits."
        ),
    )
    market_open: Optional[bool] = Field(
        default=None,
        description="Holiday-aware NSE session state at response time.",
    )
    cache_through: Optional[str] = Field(
        default=None,
        description="Timestamp through which the cached frame is complete.",
    )
    latest_bar: Optional[str] = Field(
        default=None,
        description="Timestamp (ISO 8601) of the last bar behind `candles`.",
    )
    appended: Optional[int] = Field(
        default=None,
        description="Bars appended by the live tail merge (0 when none).",
    )
    updated: Optional[int] = Field(
        default=None,
        description="Bars repaired by the live tail merge (0 when none).",
    )
    cache_age_sec: Optional[int] = Field(
        default=None,
        description="Seconds between `latest_bar` and response time (null unknown).",
    )
    refreshing: Optional[bool] = Field(
        default=None,
        description="True when a background cache refresh was kicked for this response.",
    )
    indicators: Optional[ChartIndicators] = Field(
        default=None,
        description=(
            "Backend-computed indicator series aligned to `candles` "
            "(SMA/BB/VWAP + golden/death crosses); null on empty/error."
        ),
    )
    sr_zones: list[SRZone] = Field(
        default_factory=list,
        description=(
            "Backend-computed support/resistance zones (max 4, no rightward "
            "extension past the last candle)."
        ),
    )
    market: Optional[str] = Field(
        default=None, description="Chart market: 'india' (default) or 'usa'."
    )
    feed: Optional[str] = Field(
        default=None,
        description="US price feed: 'yahoo', 'alpaca-iex' or 'alpaca-sip'.",
    )
    delay_label: Optional[str] = Field(
        default=None, description="US quote delay, e.g. '~1 min (forming)'."
    )
    session_date: Optional[str] = Field(
        default=None, description="US session date in ET (YYYY-MM-DD)."
    )


@router.get("/symbol/{symbol}/chart", response_model=SymbolChartResponse)
async def get_symbol_chart(
    request: Request,
    symbol: str,
    timeframe: str = Query("1D"),
    limit: int = Query(config.CHART_MAX_BARS, ge=1, le=config.CHART_MAX_BARS),
    lookback_bars: Optional[int] = Query(None),
    detect_patterns: bool = Query(False),
    as_of_date: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    refresh: bool = Query(False),
    market: str = Query("india"),
):
    if market == "usa":
        return await _us_symbol_chart(
            symbol, timeframe, limit, lookback_bars, as_of_date, request,
            detect_patterns,
        )
    if market != "india":
        raise HTTPException(
            status_code=400,
            detail=f"unknown market {market!r}; expected 'india' or 'usa'",
        )
    if as_of_date is not None:
        replay = await _asof_symbol_chart(
            symbol, timeframe, limit, lookback_bars,
            detect_patterns, as_of_date, from_date,
        )
        return _json_response(replay)
    from_part = None
    if from_date is not None:
        try:
            from_part = candles.parse_asof_datetime(from_date).strftime("%Y-%m-%d")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    symbol_u = str(symbol).strip().upper()
    session = _ist_session_date()
    lb = lookback_bars if lookback_bars is not None else config.READ_LOOKBACK_BARS

    # Stale-first: a session-current frame in the default live-edge disk cache
    # is served immediately (marked cached/stale) while a daemon thread
    # refreshes the cache for the next poll. Replay/as-of never takes this.
    # An explicit refresh always goes to the network path. A `from` window
    # also does: the default stale entry has no guarantee of covering the
    # requested start, and its background refresh would not be the from-window
    # variant either.
    stale_first = (
        None if refresh or from_part
        else _stale_first_frame(symbol_u, timeframe, lb)
    )
    cache_path: Optional[Path] = None
    now_ist = _chart_now_ist()
    market_open = _india_market_open(now_ist)
    if stale_first is not None:
        cached_df, as_of, read_ms, cache_path = _unpack_stale_frame(stale_first)
        if _closed_1d_superseded(timeframe, as_of, market_open=market_open):
            _chart_logger.info(
                "chart_stale_first rejected=closed_lag symbol=%s timeframe=%s "
                "as_of=%s market_open=%s",
                symbol_u, timeframe, as_of, market_open,
            )
            stale_first = None

    if stale_first is not None:
        # Open market: try to merge the live tail within a hard budget. The
        # cached (completed-session) frame is the fallback and the detection
        # base either way — a provider hiccup never blanks a populated chart.
        frame = cached_df
        tail = None
        tail_error: Optional[str] = None
        appended = 0
        updated = 0
        data_source = "cache"
        refreshing = False
        tail_skipped = False
        if market_open:
            try:
                tail = await asyncio.wait_for(
                    run_in_threadpool(
                        fetch_live_tail, symbol_u, timeframe, cached_df,
                        now=now_ist, cache_path=cache_path,
                    ),
                    timeout=_tail_timeout_sec(),
                )
            except asyncio.TimeoutError:
                tail_error = (
                    f"live tail exceeded {_tail_timeout_sec():.1f}s"
                )
            except Exception as exc:  # noqa: BLE001 - cache serve must never fail
                tail_error = str(exc)[:200]

            provider_called = bool(
                getattr(tail, "provider_called", False)
            ) if tail is not None else False
            if tail is not None:
                merge_error = getattr(tail, "error", None)
                merged_frame = getattr(tail, "frame", None)
                # A guard result can carry a diagnostic error without ever
                # calling the provider (e.g. a 1D frame with only today's bar):
                # that is a skip, not a failed tail/refresh.
                if merge_error and provider_called:
                    tail_error = str(merge_error)[:200]
                elif merged_frame is None or getattr(merged_frame, "empty", True):
                    if provider_called:
                        tail_error = "live tail returned no frame"
                else:
                    frame = merged_frame
                    appended = int(getattr(tail, "appended", 0) or 0)
                    updated = int(getattr(tail, "updated", 0) or 0)
                    if provider_called:
                        data_source = "cache+tail"

            if tail_error is not None:
                # Failed tail: keep the cached frame, say so, and let the
                # existing daemon refresh run for the next poll. Refreshing is
                # true even when one is already in flight (dedupe returns False).
                data_source = "cache+tail-failed"
                refreshing = True
                _kick_stale_first_refresh(symbol_u, timeframe, lb)
            elif not provider_called:
                # Cooldown / kill switch / outside the refresh window: the tail
                # never touched the provider, so this is a plain cache serve.
                tail_skipped = True

        display_df = frame
        is_partial = False
        if market_open:
            # The live-tail module keeps 1D completed-only on purpose; the
            # display edge still owns today's synthetic daily bar even when the
            # tail failed — a provider hiccup must not drop it.
            display_df, _display_partial = _chart_display_frame(
                frame, symbol_u, timeframe,
            )
        display_df = _filter_frame_from(display_df, from_part)
        if timeframe == "1D" and market_open:
            # A daily bar newer than the last completed session is still
            # forming; after 15:30 the same bar is final.
            try:
                last_date = candles.frame_last_date(display_df)
                last_done = candles._last_completed_session().isoformat()
                is_partial = bool(last_date and last_date > last_done)
            except Exception:
                is_partial = False
        series = _clamped_candle_series(display_df, lookback_bars, limit)
        _mark_partial_last(series, is_partial)
        warmup = _warmup_candles(display_df, series)
        if series:
            # Only the cached completed-session frame is published for the
            # matrix: detection/enrichment stay on the base, never the live tail.
            _remember_frame((symbol_u, timeframe), cached_df, *_last_close_change(cached_df))
            overlays = _stored_overlays(symbol_u, timeframe)
            if detect_patterns:
                hits_block = _pattern_block(cached_df, symbol_u, timeframe, session)
                overlays.extend(hits_block["live_overlays"])
            display_as_of = candles.frame_last_date(display_df) or as_of
            stale = _tail_frame_stale(
                timeframe, display_df, market_open=market_open, now=now_ist,
            )
            if tail_error is not None:
                stale = True
            latest_bar = _last_bar_timestamp(display_df)
            cache_through = (
                getattr(tail, "cache_through", None) if tail_error is None else None
            ) or _last_bar_timestamp(cached_df)
            payload = {
                "symbol": symbol_u,
                "timeframe": timeframe,
                "candles": series,
                "overlays": overlays,
                "cached": True,
                # Same displayed frame that produced `series`, so the bar date
                # describes the last candle even when the live tail added bars.
                "close_bar_date": _close_bar_date(display_df),
                "as_of": display_as_of,
                "detection_as_of": as_of,
                "stale": stale,
                "data_source": data_source,
                "market_open": market_open,
                "cache_through": _iso_value(cache_through),
                "latest_bar": _iso_value(latest_bar),
                "appended": appended,
                "updated": updated,
                "cache_age_sec": _cache_age_sec(latest_bar, now_ist),
                "refreshing": refreshing,
            }
            if stale and timeframe == "1D":
                if market_open:
                    payload["expected_as_of"] = now_ist.date().isoformat()
                else:
                    try:
                        payload["expected_as_of"] = (
                            candles._last_completed_session().isoformat()
                        )
                    except Exception:
                        pass
            if tail_error is not None:
                payload["note"] = (
                    f"served cached frame (through {as_of}); live tail "
                    f"unavailable ({tail_error}); refreshing in background"
                )
                payload["warning"] = f"live tail unavailable: {tail_error}"
            elif tail_skipped:
                payload["note"] = (
                    f"served cached frame (through {as_of}); "
                    "tail skipped (cooldown/kill switch/not open)"
                )
            elif appended or updated:
                payload["note"] = (
                    f"served cached frame through {as_of} + live tail "
                    f"(+{appended} bars, {updated} updated)"
                )
            elif market_open:
                payload["note"] = (
                    f"served cached frame (through {as_of}); live tail checked, "
                    f"no new bar"
                )
            else:
                payload["note"] = (
                    f"served cached frame (through {as_of}); market closed"
                )
            if stale and "warning" not in payload:
                if not market_open and timeframe not in ("1D", "1W", "1M"):
                    payload["warning"] = (
                        "cached intraday frame ends before session close"
                    )
                else:
                    payload["warning"] = f"cached frame is stale (through {as_of})"
            if detect_patterns:
                payload["hits"] = list(hits_block["hits"])
                _store_pattern_block(
                    symbol_u, timeframe, session, hits_block,
                    _frame_identity(cached_df),
                )
            else:
                # Detection off: the chart must agree with the market table,
                # which shows the stored scan's pattern. Live detection never
                # runs on this path.
                payload["hits"] = _stored_hits(symbol_u, timeframe)
            _log_chart_fetch(
                symbol_u, timeframe, elapsed_ms=read_ms, rows=len(series),
                cache_hit=True, timeout=False,
                error=tail_error, stale_fallback=True,
            )
            _chart_logger.info(
                "chart_stale_first symbol=%s timeframe=%s read_ms=%.0f as_of=%s "
                "market_open=%s data_source=%s appended=%d updated=%d error=%s",
                symbol_u, timeframe, read_ms, as_of, market_open, data_source,
                appended, updated, tail_error or "",
            )
            return _json_response(
                _with_chart_extras(payload, "india", timeframe, warmup=warmup)
            )

    # Negative cache hit: this (symbol, timeframe) already returned no
    # candles this session — answer instantly, no upstream fetch at all.
    neg = (
        None if refresh or from_part
        else _chart_neg_cache_get(symbol_u, timeframe, session)
    )
    if neg is not None:
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=0.0, rows=0,
            cache_hit=True, timeout=False, error=None,
        )
        return _json_response(_with_chart_extras(neg, "india", timeframe))

    start = _time.monotonic()
    fetch_kwargs = {
        "lookback_bars": lb,
        "include_partial_today": timeframe == "1D",
        "force_refresh": bool(refresh),
    }
    # With detection on, keep the normal fetch window: the engine needs the
    # history before `from_date`. With detection off the window itself can
    # start at `from_date` (display is clipped either way below).
    if from_part and not detect_patterns:
        fetch_kwargs["from_date"] = from_part
    try:
        df = await asyncio.wait_for(
            run_in_threadpool(
                candles.fetch_for_timeframe,
                symbol_u, timeframe,
                **fetch_kwargs,
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
        stale = _stale_chart_fallback(
            symbol_u, timeframe,
            fetch_lookback=lb, clamp_lookback=lookback_bars, limit=limit,
            reason=f"upstream timed out after {_CHART_FETCH_TIMEOUT_SEC:.0f}s",
            from_date=from_part,
        )
        if stale is not None:
            _log_chart_fetch(
                symbol_u, timeframe, elapsed_ms=elapsed_ms,
                rows=len(stale["candles"]), cache_hit=True,
                timeout=True, error=reason, stale_fallback=True,
            )
            return _json_response(_with_chart_extras(stale, "india", timeframe))
        payload = _chart_empty_payload(symbol_u, timeframe, reason=reason, note=note)
        if not from_part:
            _chart_neg_cache_put(
                symbol_u, timeframe, session, payload,
                ttl=_CHART_NEG_CACHE_TIMEOUT_TTL_SEC,
            )
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=elapsed_ms, rows=0,
            cache_hit=False, timeout=True, error=reason, stale_fallback=False,
        )
        return _json_response(_with_chart_extras(payload, "india", timeframe))
    except Exception as exc:  # noqa: BLE001 - transient upstream failure, never 500
        df = None
        elapsed_ms = (_time.monotonic() - start) * 1000.0
        reason = "fetch_error"
        note = str(exc)[:200]
        stale = _stale_chart_fallback(
            symbol_u, timeframe,
            fetch_lookback=lb, clamp_lookback=lookback_bars, limit=limit,
            reason="upstream fetch error",
            from_date=from_part,
        )
        if stale is not None:
            _log_chart_fetch(
                symbol_u, timeframe, elapsed_ms=elapsed_ms,
                rows=len(stale["candles"]), cache_hit=True,
                timeout=False, error=reason, stale_fallback=True,
            )
            return _json_response(_with_chart_extras(stale, "india", timeframe))
        payload = _chart_empty_payload(symbol_u, timeframe, reason=reason, note=note)
        # Transient errors are NOT cached: the next click retries (still bounded
        # by the timeout) so a recovered feed isn't papered over for 5 minutes.
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=elapsed_ms, rows=0,
            cache_hit=False, timeout=False, error=reason, stale_fallback=False,
        )
        return _json_response(_with_chart_extras(payload, "india", timeframe))

    elapsed_ms = (_time.monotonic() - start) * 1000.0
    rows = 0 if df is None or getattr(df, "empty", True) else int(len(df))
    if df is None or getattr(df, "empty", True):
        reason = "no_data"
        note = f"no candles for {symbol_u} {timeframe} in session {session}"
        stale = _stale_chart_fallback(
            symbol_u, timeframe,
            fetch_lookback=lb, clamp_lookback=lookback_bars, limit=limit,
            reason=f"upstream returned no candles in session {session}",
            from_date=from_part,
        )
        if stale is not None:
            _log_chart_fetch(
                symbol_u, timeframe, elapsed_ms=elapsed_ms,
                rows=len(stale["candles"]), cache_hit=True,
                timeout=False, error=reason, stale_fallback=True,
            )
            return _json_response(_with_chart_extras(stale, "india", timeframe))
        payload = _chart_empty_payload(symbol_u, timeframe, reason=reason, note=note)
        if not from_part:
            _chart_neg_cache_put(symbol_u, timeframe, session, payload)
        _log_chart_fetch(
            symbol_u, timeframe, elapsed_ms=elapsed_ms, rows=0,
            cache_hit=False, timeout=False, error=reason, stale_fallback=False,
        )
        return _json_response(_with_chart_extras(payload, "india", timeframe))
    # The fetch window carries ~1.5x headroom; clamp the displayed chart to
    # exactly the requested Lookback (Auto keeps the whole window). A trailing
    # synthetic session bar (1D only) is appended for display only — detection
    # and the frame identity use the completed-session base frame so an
    # unfinished bar can never form a hit.
    display_df, is_partial = _chart_display_frame(df, symbol_u, timeframe)
    display_df = _filter_frame_from(display_df, from_part)
    base_df = df
    if getattr(df, "attrs", {}).get("partial_today"):
        base_df = df.iloc[:-1]
    series = _clamped_candle_series(display_df, lookback_bars, limit)
    _mark_partial_last(series, is_partial)
    warmup = _warmup_candles(display_df, series)
    # ``df`` is the fetched frame and may carry today's appended tape bar
    # (``partial_today``); ``_remember_frame`` trims that trailing bar, leaving
    # exactly ``base_df`` — the frame detection used.
    _remember_frame((symbol_u, timeframe), df, *_last_close_change(df))
    overlays = _stored_overlays(symbol_u, timeframe)
    if detect_patterns:
        hits_block = _pattern_block(base_df, symbol_u, timeframe, session)
        overlays.extend(hits_block["live_overlays"])
    payload = {
        "symbol": symbol_u,
        "timeframe": timeframe,
        "candles": series,
        "overlays": overlays,
        "close_bar_date": _close_bar_date(display_df),
        "data_source": "provider",
        "market_open": _india_market_open(_chart_now_ist()),
    }
    # Every successful chart answer carries the same freshness keys — a plain
    # network fetch is no more "current by assumption" than a forced refresh or
    # a cache serve. Describe the displayed series (today's tape bar included)
    # against the base frame detection used; a network fetch is never flagged
    # stale on its own (``served_from_cache=False``), and with no expected date
    # (intraday/weekly/monthly) it simply reports ``as_of`` + ``stale: false``.
    try:
        chart_lcs = candles._last_completed_session().isoformat()
    except Exception:
        chart_lcs = None
    payload.update(_chart_freshness(
        candles.frame_last_date(display_df), candles.frame_last_date(base_df),
        chart_lcs if timeframe == "1D" else None,
        served_from_cache=False,
    ))
    if detect_patterns:
        payload["hits"] = list(hits_block["hits"])
        _store_pattern_block(
            symbol_u, timeframe, session, hits_block, _frame_identity(base_df),
        )
    else:
        # Detection off: serve the stored scan hits so the chart matches the
        # table. Replay (as_of_date) never reaches this branch — it stays live.
        payload["hits"] = _stored_hits(symbol_u, timeframe)
    return _json_response(
        _with_chart_extras(payload, "india", timeframe, warmup=warmup)
    )


@router.get("/watch/setups")
async def get_watch_setups():
    key = _catalog_cache_key("watch_setups")
    cached = _read_cache_get(_catalog_cache, key)
    if cached is not None:
        return JSONResponse(content=cached)
    payload = _sanitize_for_json({"setups": watch_mod.public_setups()})
    _read_cache_put(_catalog_cache, key, payload, ttl=_CATALOG_CACHE_TTL_SEC)
    return JSONResponse(content=payload)


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
                    "close_bar_date": None,
                    "groups": {},
                    "hits": [],
                    "_candidates": [],
                }
                rows[symbol] = row
            if row["name"] is None and item.get("name"):
                row["name"] = item.get("name")
            hit_tf = str(item.get("timeframe") or timeframe or "")
            # A stored hit may carry a close captured at an older frame. A known
            # frame is usable only as a whole triple (date + close + change from
            # that same frame). Some frames have an identity but no bar date
            # (e.g. a non-datetime index); taking their fresh close while falling
            # back to the item's stale date would fabricate a cross-frame pair.
            # In that case use the item's own triple in full instead.
            #
            # ``_known_frame`` holds the completed-session enrichment frame only,
            # so this can never splice an in-progress LTP (from a chart request)
            # onto a completed-session hit — the KAYNES 2,986/13-Nov mismatch.
            # Both triples are kept as candidates and the newest dated one wins:
            # a stored row that is genuinely newer than the remembered frame is
            # not regressed by it, and every candidate stays internally
            # consistent (one date, one close, one change from one frame).
            current_close, current_change, current_bar_date = _known_frame_close(symbol, hit_tf)
            if (
                isinstance(current_bar_date, str) and current_bar_date
                and current_close is not None
                and current_change is not None
            ):
                row["_candidates"].append((current_bar_date, current_close, current_change))
            row["_candidates"].append((
                item.get("close_bar_date"),
                item.get("last_close"),
                item.get("day_change_pct"),
            ))
            row["groups"].setdefault(hit_tf, []).append(item)
            row["hits"].append(item)

    out: list[dict] = []
    for row in rows.values():
        groups = row.pop("groups")
        hits = row.pop("hits")
        candidates = row.pop("_candidates")
        # The newest frame's date wins together with the close/change from that
        # same frame, so a stale item can lend neither an older date to a
        # current close nor a current date to an older close. With no dated
        # frame, keep the legacy first-non-null close for backwards compat and
        # leave the date unset (never fabricate one).
        dated = [
            c for c in candidates
            if isinstance(c[0], str) and c[0] and _matrix_number(c[1]) is not None
        ]
        if dated:
            bar_date, close, change = max(dated, key=lambda c: c[0])
            row["close_bar_date"] = bar_date
            row["ltp"] = _matrix_number(close)
            if change is not None:
                row["day_change_pct"] = change
        else:
            for _bar_date, close, change in candidates:
                if row["ltp"] is None:
                    number = _matrix_number(close)
                    if number is not None:
                        row["ltp"] = number
                if row["day_change_pct"] is None and change is not None:
                    row["day_change_pct"] = change
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
    cache_key = _matrix_cache_key(universe, tf_ids, limit)
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


# Batch pattern availability for the Market table.
#
# Same data path as ``/matrix`` and nothing else: one store read over stored
# hits. No candle fetch, no detector, no upstream call — the table must never
# turn a row render into a detection run. Symbols without a stored hit are
# omitted (the client renders "—") rather than fabricated as "no patterns".

#: Store row cap per requested symbol. The query is deduped to the newest row
#: per pattern identity and the catalogue tops out at 18 patterns, so this is
#: headroom, not a display limit — it only bounds a pathological symbol that
#: carries the same pattern id across many start dates.
_LOOKUP_HITS_PER_SYMBOL = 20

_LOOKUP_HIT_KEYS = (
    "pattern_id", "direction", "status", "quality", "confidence",
    "bars_ago", "start_date", "end_date",
)


def _lookup_pattern(hit: dict) -> dict:
    out = {key: hit.get(key) for key in _LOOKUP_HIT_KEYS}
    # Matrix cells label a hit by ``pattern_name``; the same field travels here
    # so the column and the matrix can never describe one row differently.
    out["name"] = hit.get("pattern_name") or hit.get("name")
    return out


def _lookup_items(items, symbols: list[str]) -> list[dict]:
    """Group stored hits per symbol, emitted in sorted symbol order.

    The store returns confidence order across *all* symbols, so echoing it would
    make one symbol's position depend on unrelated symbols. Clients key the
    answer by symbol; ordering it canonically is what lets a sort change in the
    table reuse the same cache entry.

    The per-symbol cap is applied *here*, after grouping — never as a global SQL
    LIMIT. A global limit lets one high-volume symbol consume the whole budget
    and drop every other symbol from the answer (a stored hit then renders as
    the same dash as "no patterns"). Capping each group keeps the top-N by
    confidence for *every* symbol, in the store's incoming confidence order.
    """
    groups: dict[str, list[dict]] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        groups.setdefault(symbol, []).append(_lookup_pattern(item))
    return [
        {
            "symbol": symbol,
            "patterns": groups[symbol][:_LOOKUP_HITS_PER_SYMBOL],
            "count": min(len(groups[symbol]), _LOOKUP_HITS_PER_SYMBOL),
        }
        for symbol in symbols
        if symbol in groups
    ]


@router.post("/patterns/lookup", summary="Batch stored pattern availability for a symbol list")
def lookup_patterns(
    request: PatternsLookupRequest,
    user: User = Depends(get_current_user),
):
    """Patterns already computed for these symbols on one timeframe.

    DB read only. ``items`` holds just the symbols that have a stored hit; a
    cold scan yields an empty list and clients show a dash. ``source`` is
    always ``"stored"`` — this endpoint cannot produce a fresh detection.
    """
    timeframe = str(request.timeframe or "1D").strip()
    if timeframe not in _valid_timeframe_ids():
        raise HTTPException(status_code=422, detail=f"unknown timeframe {timeframe!r}")
    symbols = _normalize_symbol_list(request.symbols, cap=_LOOKUP_MAX_SYMBOLS)
    universe = (request.universe or "").strip() or None
    if universe is not None:
        universe = _normalize_universe(universe)
        if universe not in _valid_universe_ids():
            raise HTTPException(status_code=422, detail=f"unknown universe {universe!r}")
    # Canonical (sorted) scope: `items` is sorted by symbol too, so a request
    # for the same set in another order — or a table re-sort — hits this entry.
    scope = tuple(sorted(symbols))
    cached_key = _lookup_cache_key(timeframe, universe, scope)
    cached = _read_cache_get(_lookup_cache, cached_key)
    if cached is not None:
        return JSONResponse(content=cached)
    summary: dict = {}
    items: list = []
    if symbols:
        filters = {"symbol": symbols, "timeframe": timeframe, "sort": "confidence"}
        if universe:
            filters["universe"] = universe
        try:
            # Fetch every hit for the requested symbols and let _lookup_items
            # cap each symbol after grouping. A global `len(symbols) * cap` limit
            # starved low-volume symbols whenever one symbol carried more hits
            # than the whole budget; the cap belongs to the per-symbol groups.
            items, _total, summary = store.query_results(filters, limit=None, offset=0)
        except Exception:
            items, summary = [], {}
    if not isinstance(summary, dict):
        summary = {}
    payload = _sanitize_for_json({
        "timeframe": timeframe,
        "session": _ist_session_date(),
        "source": "stored",
        "data_through": summary.get("data_through"),
        "items": _lookup_items(items, list(scope)),
    })
    _read_cache_put(_lookup_cache, cached_key, payload, ttl=_LOOKUP_CACHE_TTL_SEC)
    return JSONResponse(content=payload)

"""Snapshot assembly for GET /api/market/snapshot.

One TradingView scan (``api.tv.scan_frame``) per universe. Shaped rows are
cached per ``(universe, scan_window)`` -- the *scan* window, not the requested
response cap -- with a read-time TTL: 5s while the universe's cash session is
live, 60s while it is closed. An expired frame is served stale while one
background refresh runs: always when the market is closed, and for a live market
only up to ``LIVE_STALE_MAX_SECONDS``; past that window a live request blocks on
a real scan. Hygiene universes (US) scan one full frame so
local filters can drop OTC/preferred rows before the frame is sliced to the
requested ``limit`` per request. Universes without local hygiene (India)
ceiling-map the requested cap onto a small fixed ladder, bounding upstream TV
scans and cache entries to one per rung; the response is still sliced to the
exact requested cap. F&O/ETF membership sets are hoisted once per process.
A singleflight lock collapses N concurrent misses (or ``force`` requests) into
one TV scan. The last shaped payload is persisted to disk; on a cold start the
disk snapshot is served immediately (``stale: true``) while a background
refresh runs.
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from api.tv import scan_frame, to_tv_ticker, tv_name_to_symbol
from api.tv.auth import refresh_tv_cookies
from api.tv.status import tv_feed_status
from chart_patterns.tags import etf_symbols, fno_symbols
from chart_patterns.universes import get_universe
from config import IST

from .config import (
    ALLOWED_UNIVERSES,
    COLUMNS,
    UNIVERSES,
    CapTierSpec,
    UniverseSpec,
)

log = logging.getLogger("market_screen.snapshot")

#: Live-market TTL. The dashboard polls this endpoint, so a live universe is
#: re-scanned every few seconds. Clamped at 3s: a misconfigured env var must not
#: turn every poll into a TradingView scan.
LIVE_TTL_SECONDS = max(3.0, float(os.getenv("MARKET_SCREEN_LIVE_TTL_SEC", "5")))
#: How long an expired live frame stays servable while one background refresh
#: runs. The dashboard polls every ~5s against a 5s TTL, so nearly every poll
#: lands just past expiry: blocking there meant paying the full 2-11s TV scan
#: per request and never hitting the cache. Floored at ``LIVE_TTL_SECONDS`` --
#: a stale window shorter than the fresh window would make the cache pointless.
LIVE_STALE_MAX_SECONDS = max(
    LIVE_TTL_SECONDS, float(os.getenv("MARKET_SCREEN_LIVE_STALE_SEC", "30"))
)
#: Closed-market TTL. Prices do not move between sessions, so reuse is free.
OFF_TTL_SECONDS = 60.0
MAX_LIMIT = 4000
#: Upper bound for the optional `symbols` filter on GET /api/market/snapshot.
MAX_SYMBOLS = 20
#: Bound the shaped-frame cache defensively. India's scan window is quantized
#: (see FETCH_LIMIT_LADDER) and US uses one full frame, so real usage is far
#: below this cap; it stays as a hard safety bound on memory growth.
MAX_CACHE_ENTRIES = 32
#: Alias matching the repo's ``CACHE_MAX_*`` naming used by neighbouring modules.
CACHE_MAX_ENTRIES = MAX_CACHE_ENTRIES

#: India scan-window ladder. The shipped UI always requests the full frame
#: (MARKET_ROW_CAP = 4000), but the API accepts any 1..4000 cap. Ceiling-mapping
#: each request onto a fixed rung bounds TV scans and cache entries to
#: len(FETCH_LIMIT_LADDER) per universe instead of one per client-chosen limit.
#: Rungs are dense at the small end (deliberate caps/tests) and coarse near the
#: full frame: 1/12 -> 50, 51 -> 100, 300 -> 500, 4000 -> 4000.
FETCH_LIMIT_LADDER: tuple[int, ...] = (50, 100, 250, 500, 1000, 2000, MAX_LIMIT)

#: Disk-stale snapshot directory (gitignored experiments data).
_STALE_DIR = Path(__file__).resolve().parents[2] / "experiments" / "data" / "market_screen"
#: Serve a disk snapshot only if it is not older than this (3 days default).
_STALE_MAX_AGE_SEC = float(os.getenv("MARKET_SCREEN_STALE_MAX_AGE_SEC", "259200"))
#: How long a waiter blocks for a singleflight result (seconds).
_SINGLEFLIGHT_WAIT_SEC = 60.0

#: Per-key throttle for ``force=true``. A successful forced scan records its
#: monotonic time under ``(universe, scan_window)``; a follow-up force arriving
#: within this window reuses the freshly cached frame instead of re-scanning.
#: This stops serial forced requests (or varying caps mapped to the same scan
#: bucket) from each launching a full TV scan. Genuine concurrency is still
#: collapsed by the singleflight below, so this only throttles sequential abuse.
#: A live market keeps a 1s window so a manual refresh always reflects the
#: current tape; a closed market can afford the 5s window.
FORCE_COOLDOWN_SEC = 5.0
FORCE_COOLDOWN_LIVE_SEC = 1.0

#: F&O / ETF membership hoisted once per process -- never re-read per row.
_FNO_SYMBOLS: frozenset[str] = fno_symbols()
_ETF_SYMBOLS: frozenset[str] = etf_symbols()

class _BoundedCache(dict):
    """LRU dict: insertion order is recency, oldest entry is evicted at the cap.

    A dict subclass keeps every existing read/write site unchanged; keys and
    values are stored verbatim. Touched reads move an entry to the newest end.
    """

    def _touch(self, key: tuple[str, int]) -> None:
        value = super().pop(key)
        super().__setitem__(key, value)

    def __setitem__(self, key: tuple[str, int], value: dict[str, Any]) -> None:
        if key in self:
            self._touch(key)
        elif len(self) >= MAX_CACHE_ENTRIES:
            super().__delitem__(next(iter(self)))
        super().__setitem__(key, value)

    def __getitem__(self, key: tuple[str, int]) -> dict[str, Any]:
        value = super().__getitem__(key)
        self._touch(key)
        return value

    def get(self, key: tuple[str, int], default=None):
        if key not in self:
            return default
        value = super().get(key)
        self._touch(key)
        return value


#: ``(universe, scan_window) -> {"stored_at", "expires_at", "as_of", "update_mode", "rows"}``
#: Shaped rows for the whole scan window (bucket); the response cap is applied
#: per request, so one bucket frame serves every limit mapped to that bucket.
_cache: dict[tuple[str, int], dict[str, Any]] = _BoundedCache()
_cache_lock = threading.RLock()

#: singleflight: ``(universe, scan_window) -> {"event", "stored_at", "as_of", "update_mode", "rows", "exc"}``
_inflight: dict[tuple[str, int], dict[str, Any]] = {}
_inflight_lock = threading.Lock()

#: ``(universe, scan_window) -> monotonic time of the last successful forced scan``
_force_last_at: dict[tuple[str, int], float] = {}
_force_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Session liveness and read-time freshness
# --------------------------------------------------------------------------- #

def _universe_is_live(universe: str) -> bool:
    """Whether ``universe``'s cash session is open right now.

    The session predicate is chosen by the descriptor's ``tv_market``, never by
    the universe name. Imports are local so this module stays importable when a
    provider is missing (and so tests can swap the predicates), and every
    failure fails safe to the closed-market TTL: a wrong "live" answer would
    multiply TradingView scans.
    """
    spec = UNIVERSES.get(universe)
    if spec is None:
        return False
    try:
        if spec.tv_market == "india":
            from trading.utils import is_market_open

            return bool(is_market_open())
        if spec.tv_market == "america":
            from market_data.providers.sessions import is_us_open

            return bool(is_us_open())
    except Exception:
        return False
    return False


def _ttl_seconds(universe: str) -> float:
    """Freshness window for a cached frame, evaluated at request time."""
    return LIVE_TTL_SECONDS if _universe_is_live(universe) else OFF_TTL_SECONDS


def _is_fresh(entry: dict[str, Any], universe: str, now: float) -> bool:
    """Read-time freshness rule: ``now < stored_at + _ttl_seconds(universe)``.

    The stored ``expires_at`` is diagnostic only. An entry cached shortly
    before the open carries a ~60s ``expires_at``; once the session is live it
    must expire on the 5s window instead of staying fresh for that whole
    minute.
    """
    return now < entry["stored_at"] + _ttl_seconds(universe)


# --------------------------------------------------------------------------- #
# Force cooldown: throttle serial forced scans without touching the cache TTL
# --------------------------------------------------------------------------- #

def _force_in_cooldown(key: tuple[str, int], now_mono: float, universe: str) -> bool:
    """Whether a forced scan for ``key`` finished within the cooldown window."""
    cooldown = (
        FORCE_COOLDOWN_LIVE_SEC
        if _universe_is_live(universe)
        else FORCE_COOLDOWN_SEC
    )
    with _force_lock:
        last = _force_last_at.get(key)
    return last is not None and (now_mono - last) < cooldown


def _note_force_scan(key: tuple[str, int], now_mono: float) -> None:
    """Record the monotonic time of a successful forced scan for ``key``."""
    with _force_lock:
        _force_last_at[key] = now_mono


def _num(value: Any) -> float | None:
    """Coerce to float, yielding ``None`` (JSON null) for missing/NaN/inf."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _text(value: Any) -> str | None:
    """Text column from pandas, where a missing cell is float('nan')."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return str(value)


def _has_local_hygiene(spec: UniverseSpec) -> bool:
    """Whether the spec drops rows locally after the TV scan (US only)."""
    return (
        spec.allowed_exchanges is not None
        or spec.require_stock_type
        or spec.exclude_symbol_pattern is not None
        or spec.exclude_name_pattern is not None
    )


def _scan_window(universe: str, limit: int) -> int:
    """Scan/cache window (bucket) for a universe and a requested response cap.

    Two explicit paths:

    * Hygiene universes (US) always scan the full frame. Local filters drop
      OTC/preferred rows *after* the scan, so fetching only ``limit`` rows could
      under-fill the response. One full frame therefore serves every cap.
    * Universes without local hygiene (India) ceiling-map the cap onto
      ``FETCH_LIMIT_LADDER``. A small cap still gets a small scan, but a client
      can only create one scan/cache entry per rung -- not one per value in
      1..4000. The exact requested cap is applied in ``_envelope``.
    """
    if _has_local_hygiene(UNIVERSES[universe]):
        return MAX_LIMIT
    return next(
        (rung for rung in FETCH_LIMIT_LADDER if rung >= limit),
        FETCH_LIMIT_LADDER[-1],  # defensive clamp for direct callers above MAX_LIMIT
    )


def _apply_frame_filters(df: pd.DataFrame, spec: UniverseSpec) -> pd.DataFrame:
    """Apply the spec's local hygiene (US: listed stocks only).

    The server-side filters are mirrored here so the guarantee holds even when
    the scanner returns extra rows (and for mocked frames).
    """
    if df.empty or not _has_local_hygiene(spec):
        return df
    keep = pd.Series(True, index=df.index)
    if spec.allowed_exchanges is not None and "exchange" in df.columns:
        keep &= df["exchange"].astype(str).str.upper().isin(spec.allowed_exchanges)
    if spec.require_stock_type and "type" in df.columns:
        keep &= df["type"].astype(str).str.lower().eq("stock")
    if spec.exclude_symbol_pattern and "name" in df.columns:
        keep &= ~df["name"].astype(str).str.contains(
            spec.exclude_symbol_pattern, case=False, regex=True, na=False
        )
    if spec.exclude_name_pattern and "description" in df.columns:
        keep &= ~df["description"].astype(str).str.contains(
            spec.exclude_name_pattern, case=False, regex=True, na=False
        )
    return df.loc[keep].reset_index(drop=True)


def _fetch_frame(universe: str, limit: int) -> pd.DataFrame:
    """Run the single TV scan described by ``UNIVERSES[universe]``."""
    spec = UNIVERSES[universe]
    if spec.tickers:
        tickers = [to_tv_ticker(symbol) for symbol in get_universe(universe)]
        return scan_frame(
            spec.tv_market,
            columns=list(spec.columns),
            tickers=tickers,
            limit=limit,
        )
    df = scan_frame(
        spec.tv_market,
        columns=list(spec.columns),
        filters=list(spec.server_filters),
        sort="market_cap_basic",
        order="desc",
        limit=limit,
    )
    return _apply_frame_filters(df, spec)


def _first_update_mode(df: pd.DataFrame) -> str | None:
    """``update_mode`` of the first row, or ``None`` for an empty frame."""
    try:
        if len(df) and "update_mode" in df.columns:
            value = df["update_mode"].iloc[0]
            return str(value) if pd.notna(value) else None
    except Exception:
        return None
    return None


def _is_delayed(mode: str | None) -> bool:
    return isinstance(mode, str) and mode.startswith("delayed")


def _fetch_frame_with_heal(universe: str, limit: int):
    """One TV scan with a single cookie self-heal.

    On HTTP 401 or a delayed feed, refresh the TradingView cookies once and
    retry the scan once. When the feed is already streaming there is no extra
    request -- cookies are never touched.
    """
    try:
        df = _fetch_frame(universe, limit)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 401:
            refresh_tv_cookies()  # self-heal: re-extract cookies
            df = _fetch_frame(universe, limit)  # retry once
        else:
            raise
    update_mode = tv_feed_status().get("mode") or _first_update_mode(df)
    if _is_delayed(update_mode):
        refresh_tv_cookies()  # self-heal: try to regain streaming mode
        df = _fetch_frame(universe, limit)  # retry once
        update_mode = tv_feed_status().get("mode") or _first_update_mode(df)
    return df, update_mode


def _absolute_tier(mcap: float | None, cap: CapTierSpec) -> str:
    """Absolute-cap tier from the spec's thresholds (native cap in billions)."""
    if mcap is None:
        return cap.fallback
    billions = mcap / 1e9
    for minimum, tier in cap.absolute:
        if billions >= minimum:
            return tier
    return cap.fallback


def _cap_tiers(rows: list[dict[str, Any]], spec: UniverseSpec) -> dict[int, str]:
    """Map each row index to a cap tier using the universe's spec.

    Rank mode sorts within the returned universe (India); absolute mode uses
    USD thresholds (US).
    """
    cap = spec.cap_tiers
    if cap.mode == "absolute":
        return {
            index: _absolute_tier(_num(row.get("market_cap_basic")), cap)
            for index, row in enumerate(rows)
        }
    ranked = sorted(
        ((index, _num(row.get("market_cap_basic")))
         for index, row in enumerate(rows)),
        key=lambda item: item[1] if item[1] is not None else -1.0,
        reverse=True,
    )
    tier_by_index: dict[int, str] = {}
    for rank, (index, mcap) in enumerate(ranked, start=1):
        tier = cap.fallback
        if mcap is not None:
            for max_rank, name in cap.ranks:
                if rank <= max_rank:
                    tier = name
                    break
        tier_by_index[index] = tier
    return tier_by_index


def _shape_rows(rows: list[dict[str, Any]], *, universe: str = "all_equity") -> list[dict[str, Any]]:
    """Shape raw scanner rows into the one-page screener contract.

    All per-universe choices (currency, cap units/tiers, F&O/ETF flags) come
    from the registry; this function only assembles the shared field set.
    """
    spec = UNIVERSES[universe]
    tier_by_index = _cap_tiers(rows, spec)
    shaped: list[dict[str, Any]] = []
    for index, raw in enumerate(rows):
        symbol = tv_name_to_symbol(raw.get("name")) or None
        sym = (symbol or "").upper()
        mcap = _num(raw.get("market_cap_basic"))
        close = _num(raw.get("close"))
        low = _num(raw.get("price_52_week_low"))
        high = _num(raw.get("price_52_week_high"))
        pos_52w: float | None = None
        if close is not None and low is not None and high is not None and high != low:
            pos_52w = (close - low) / (high - low) * 100.0
        mcap_fields = {
            field: (mcap / scale) if (mcap is not None and scale is not None) else None
            for field, scale in spec.mcap_outputs
        }
        is_etf = (sym in _ETF_SYMBOLS) if spec.use_nse_tags else False
        non_equity_tier = spec.cap_tiers.non_equity_tier
        # An ETF has AUM, not a market cap; ranking it by size would label every
        # fund a micro-cap company and make the rail's Micro filter lie.
        cap_tier = (
            non_equity_tier
            if is_etf and non_equity_tier is not None
            else tier_by_index.get(index, spec.cap_tiers.fallback)
        )
        row = {
            "symbol": symbol,
            "name": _text(raw.get("description")),
            "sector": _text(raw.get("sector")),
            "exchange": _text(raw.get("exchange")),
            "close": close,
            "change": _num(raw.get("change")),
            "relative_volume": _num(raw.get("relative_volume_10d_calc")),
            **mcap_fields,
            "cap_tier": cap_tier,
            "rsi": _num(raw.get("RSI")),
            "adx": _num(raw.get("ADX")),
            "sma20": _num(raw.get("SMA20")),
            "sma50": _num(raw.get("SMA50")),
            "sma200": _num(raw.get("SMA200")),
            "perf_w": _num(raw.get("Perf.W")),
            "perf_1m": _num(raw.get("Perf.1M")),
            "high_52w": high,
            "low_52w": low,
            "pos_52w": pos_52w,
            # Fundamentals for the treemap's metric selector; None when TV
            # has no coverage, which the UI renders as a dash rather than 0.
            "pe_ratio": _num(raw.get("price_earnings_ttm")),
            "pb_ratio": _num(raw.get("price_book_fq")),
            "dividend_yield": _num(raw.get("dividend_yield_recent")),
            "roe": _num(raw.get("return_on_equity")),
            "fno": (sym in _FNO_SYMBOLS) if spec.use_nse_tags else False,
            "etf": is_etf,
            "currency": spec.currency,
        }
        shaped.append(row)
    return shaped


def filter_rows_by_symbols(
    rows: list[dict[str, Any]], symbols: list[str]
) -> list[dict[str, Any]]:
    """Keep only rows whose symbol is in ``symbols`` (case-insensitive).

    Applied to the already-built, cached snapshot so the TV scan and its TTL
    are never bypassed by a symbol-filtered request. Unknown symbols simply
    contribute no rows; an empty request keeps everything.
    """
    wanted = {s.strip().upper() for s in symbols if s.strip()}
    if not wanted:
        return list(rows)
    return [row for row in rows if str(row.get("symbol") or "").upper() in wanted]


def select_rows(
    rows: list[dict[str, Any]], symbols: list[str], limit: int
) -> tuple[list[dict[str, Any]], int]:
    """Filter by symbol first, then apply the response cap.

    ``build_snapshot`` truncates (and caches) to ``limit``, so filtering its
    rows afterwards hides any symbol outside the returned head: with
    ``limit=12&symbols=KAYNES`` the snapshot holds 12 rows and KAYNES may be
    rank 400. Callers pass the full frame here instead.

    Returns ``(rows_capped, matched_count)``; ``matched_count`` counts the
    matches before the cap, so a filtered response can report how many symbols
    were found even when fewer are returned.
    """
    matched = filter_rows_by_symbols(rows, symbols)
    return matched[:limit], len(matched)


def _compute_once(universe: str, limit: int):
    """One TV scan + shape (+ cookie self-heal). Never falls back to cache.

    Returns ``(rows, update_mode, as_of, stored_at)`` with shaped rows, and
    persists the payload as the disk-stale snapshot (best-effort).
    """
    df, update_mode = _fetch_frame_with_heal(universe, limit)
    rows = _shape_rows(df.to_dict("records"), universe=universe)
    stored_at = time.time()
    as_of = datetime.now(IST).isoformat()
    _save_stale_snapshot(universe, limit, stored_at, as_of, update_mode, rows)
    return rows, update_mode, as_of, stored_at


# --------------------------------------------------------------------------- #
# Disk-stale snapshot (served immediately on a cold start, stale: true)
# --------------------------------------------------------------------------- #

def _stale_path(universe: str, limit: int) -> Path:
    return _STALE_DIR / f"snapshot_stale_{universe}_{limit}.json"


def _json_safe(value: Any) -> Any:
    """Coerce a value into something ``json.dumps`` can serialize.

    Rows are dicts of str/num/bool/None. Any other type (numpy scalars, NaN,
    stray objects) is coerced to a string or None so a single odd field can
    never fail the best-effort cache write.
    """
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    try:
        return str(value)
    except Exception:
        return None


def _save_stale_snapshot(universe, limit, stored_at, as_of, update_mode, rows) -> None:
    """Persist the last shaped payload to disk (best-effort, never raises)."""
    try:
        _STALE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "stored_at": _json_safe(stored_at),
            "as_of": _json_safe(as_of),
            "update_mode": _json_safe(update_mode),
            "rows": [_json_safe(row) for row in rows],
        }
        tmp = _stale_path(universe, limit).with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, allow_nan=False)
        tmp.replace(_stale_path(universe, limit))
    except Exception as exc:  # disk problems must never fail a request
        log.debug("stale snapshot persist failed for %s/%s: %s", universe, limit, exc)


def _load_stale_snapshot(universe: str, limit: int) -> dict[str, Any] | None:
    """Load the disk-stale snapshot if it exists and is not too old."""
    path = _stale_path(universe, limit)
    try:
        if not path.exists():
            return None
        if time.time() - path.stat().st_mtime > _STALE_MAX_AGE_SEC:
            return None
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        if not isinstance(payload, dict) or "rows" not in payload:
            return None
        payload.setdefault("stored_at", path.stat().st_mtime)
        return payload
    except Exception as exc:
        log.debug("stale snapshot load failed for %s/%s: %s", universe, limit, exc)
        return None


# --------------------------------------------------------------------------- #
# Singleflight: N concurrent misses/force requests == one TV scan
# --------------------------------------------------------------------------- #

def _is_dead_inflight(inf: dict[str, Any]) -> bool:
    """A finished-with-error entry is a poisoned slot, not a live computation.

    Callers hold ``_inflight_lock``. Waiting on such an entry re-raises a stale
    failure forever, which is how ``force=true`` used to keep serving the disk
    snapshot after one bad background refresh.
    """
    return inf.get("exc") is not None and inf.get("event") is not None and inf["event"].is_set()


def _claim_slot(key: tuple[str, int]) -> tuple[dict[str, Any], bool]:
    """Return ``(inflight_entry, am_winner)`` for ``key``.

    The winner owns the computation; everyone else waits on its event. A dead
    (failed and already-signalled) entry is discarded so the caller retries as
    the winner instead of inheriting a permanent failure.
    """
    with _inflight_lock:
        inf = _inflight.get(key)
        if inf is not None and not _is_dead_inflight(inf):
            return inf, False
        _inflight.pop(key, None)  # dead slot must not poison later requests
        inf = {
            "event": threading.Event(),
            "stored_at": None, "as_of": None,
            "update_mode": None, "rows": None, "exc": None,
        }
        _inflight[key] = inf
        return inf, True


def _complete_inflight(key: tuple[str, int], inf: dict[str, Any]) -> None:
    """Publish the winner's result (or exception) and clear the inflight slot."""
    with _inflight_lock:
        if _inflight.get(key) is inf:
            _inflight.pop(key, None)
    inf["event"].set()


def _run_singleflight(key: tuple[str, int], universe: str, limit: int) -> dict[str, Any]:
    """Run ``_compute_once`` for ``key``; waiters share the winner's result."""
    inf, am_winner = _claim_slot(key)
    if not am_winner:
        got = inf["event"].wait(timeout=_SINGLEFLIGHT_WAIT_SEC)
        if not got:
            raise TimeoutError(f"snapshot singleflight timed out for {key}")
        if inf["exc"] is not None:
            raise inf["exc"]
        return inf
    # We are the winner: compute once, publish to cache + inflight.
    try:
        rows, update_mode, as_of, stored_at = _compute_once(universe, limit)
        entry = {
            "stored_at": stored_at,
            "expires_at": stored_at + _ttl_seconds(universe),
            "as_of": as_of,
            "update_mode": update_mode,
            "rows": rows,
        }
        with _cache_lock:
            _cache[key] = entry
        inf.update(stored_at=stored_at, as_of=as_of, update_mode=update_mode, rows=rows)
    except Exception as exc:  # waiters surface the upstream failure
        inf["exc"] = exc
        raise
    finally:
        _complete_inflight(key, inf)
    return inf


def _maybe_start_background_refresh(key: tuple[str, int], universe: str, limit: int) -> None:
    """Start a single background refresh for ``key`` unless one is in flight."""
    with _inflight_lock:
        existing = _inflight.get(key)
        if existing is not None:
            if not _is_dead_inflight(existing):
                return
            _inflight.pop(key, None)  # a finished-failed entry is not "in flight"
        inf = {
            "event": threading.Event(),
            "stored_at": None, "as_of": None,
            "update_mode": None, "rows": None, "exc": None,
        }
        _inflight[key] = inf

    def _refresh() -> None:
        try:
            rows, update_mode, as_of, stored_at = _compute_once(universe, limit)
            entry = {
                "stored_at": stored_at,
                "expires_at": stored_at + _ttl_seconds(universe),
                "as_of": as_of,
                "update_mode": update_mode,
                "rows": rows,
            }
            with _cache_lock:
                _cache[key] = entry
            inf.update(stored_at=stored_at, as_of=as_of, update_mode=update_mode, rows=rows)
        except Exception as exc:
            log.warning("background snapshot refresh failed for %s/%s: %s", universe, limit, exc)
            inf["exc"] = exc
        finally:
            # Must match _run_singleflight: leaving the slot behind poisons
            # every later request for this key, including force=true.
            _complete_inflight(key, inf)

    thread = threading.Thread(target=_refresh, daemon=True, name=f"snapshot-refresh-{universe}-{limit}")
    try:
        thread.start()
    except Exception as exc:
        # Starting a thread can fail (resource exhaustion). The slot must not
        # stay claimed by a refresh that will never run, and the stale serve
        # that triggered it must not turn into a 500.
        log.warning("background snapshot refresh could not start for %s/%s: %s", universe, limit, exc)
        inf["exc"] = exc  # a waiter must fall back to stale/disk, not read None rows
        _complete_inflight(key, inf)


def _envelope(
    entry: dict[str, Any], universe: str, *, limit: int, cached: bool, stale: bool
) -> dict[str, Any]:
    """Build the response envelope from a cached/stale entry.

    ``entry["rows"]`` holds the whole scan window; slice to the requested cap
    here so a single cached frame serves every ``limit`` of a universe without
    a separate scan. Slicing a list yields a new list -- the cache is untouched.
    """
    now = time.time()
    rows = entry["rows"][:limit]
    return {
        "as_of": entry["as_of"],
        "universe": universe,
        "total": len(rows),
        "update_mode": entry["update_mode"],
        "rows": rows,
        "cached": cached,
        "stale": stale,
        "age_sec": round(max(0.0, now - entry["stored_at"]), 3),
    }


def _log(t0: float, universe: str, limit: int, rows: int, *, cache: str, stale: bool) -> None:
    """Structured timing log: universe, limit, elapsed_ms, rows, cache, stale."""
    elapsed_ms = (time.perf_counter() - t0) * 1000
    log.info(
        "snapshot universe=%s limit=%s elapsed_ms=%.1f rows=%d cache=%s stale=%s",
        universe, limit, elapsed_ms, rows, cache, stale,
    )


def build_snapshot(
    universe: str = "all_equity", limit: int = MAX_LIMIT, force: bool = False
) -> dict[str, Any]:
    """Assemble the full snapshot response for one universe.

    A fresh in-memory entry (within the live/closed TTL) returns the shaped
    rows directly. An expired entry is served stale while one background refresh
    runs: always when the market is closed, and for a live market only while the
    frame is no older than ``LIVE_STALE_MAX_SECONDS``. A live frame past that
    window blocks on a real scan, as does ``force``. A cold miss follows the
    same split -- disk-stale serve when closed, a blocking scan when live. On
    upstream failure both paths fall back to whatever memory/disk frame exists.
    """
    t0 = time.perf_counter()
    universe = (universe or "all_equity").strip().lower()
    if universe not in ALLOWED_UNIVERSES:
        raise ValueError(
            f"unknown universe '{universe}'; expected one of "
            + ", ".join(ALLOWED_UNIVERSES)
        )
    limit = int(limit)
    # Cache/singleflight key is the scan window (bucket), not the response cap.
    # US: every limit shares the one full hygienized frame. India: every limit
    # in a ladder rung shares that rung's scan; each request slices the frame
    # to its own cap in _envelope. This bounds scans/cache entries per universe.
    fetch_limit = _scan_window(universe, limit)
    key = (universe, fetch_limit)
    now = time.time()
    live = _universe_is_live(universe)

    with _cache_lock:
        entry = _cache.get(key)

    # Force cooldown: a forced scan that just completed already refreshed the
    # cached frame. A rapid follow-up force reuses it instead of paying for
    # another TV scan; genuinely concurrent forces are still collapsed by the
    # singleflight below. Only a usable memory frame is reused -- with no cache
    # entry the force request proceeds to a real scan.
    if force and entry is not None and entry.get("rows") is not None:
        if _force_in_cooldown(key, time.monotonic(), universe):
            cached = _is_fresh(entry, universe, now)
            _log(t0, universe, limit, min(len(entry["rows"]), limit),
                 cache="force_cooldown", stale=not cached)
            return _envelope(entry, universe, limit=limit, cached=cached, stale=not cached)

    # 1. Warm memory hit: shaped rows returned directly, no per-row work.
    if entry is not None and not force and _is_fresh(entry, universe, now):
        _log(t0, universe, limit, min(len(entry["rows"]), limit), cache="hit", stale=False)
        return _envelope(entry, universe, limit=limit, cached=True, stale=False)

    # 2. Recently expired live frame: serve it immediately and refresh once in
    #    the background. The poll interval sits right at the live TTL, so
    #    blocking here turned every poll into a full TV scan (p50 2.3s, max
    #    10.9s, no cache hits). Past the window the frame is too old to hand out
    #    and the request blocks below.
    if entry is not None and not force and live:
        if (now - entry["stored_at"]) <= LIVE_STALE_MAX_SECONDS:
            _maybe_start_background_refresh(key, universe, fetch_limit)
            _log(t0, universe, limit, min(len(entry["rows"]), limit), cache="hit", stale=True)
            return _envelope(entry, universe, limit=limit, cached=True, stale=True)

    # 3. Expired memory entry on a closed market: serve stale immediately and
    #    refresh in the background. A live market gets the same serve only
    #    inside the window above -- handing out older rows indefinitely would
    #    keep showing pre-open prices during the session.
    if entry is not None and not force and not live:
        _maybe_start_background_refresh(key, universe, fetch_limit)
        _log(t0, universe, limit, min(len(entry["rows"]), limit), cache="hit", stale=True)
        return _envelope(entry, universe, limit=limit, cached=True, stale=True)

    # 4. Closed-market miss: serve the disk-stale snapshot immediately on a
    #    cold start. Live requests skip this too -- a days-old disk frame is
    #    worse than blocking for one scan.
    if not force and not live:
        disk = _load_stale_snapshot(universe, fetch_limit)
        if disk is not None:
            _maybe_start_background_refresh(key, universe, fetch_limit)
            _log(t0, universe, limit, min(len(disk["rows"]), limit), cache="miss", stale=True)
            return _envelope(disk, universe, limit=limit, cached=False, stale=True)

    # 5. Live request past the stale window, force, or no disk snapshot:
    #    singleflight TV scan (blocks this request, but N concurrent requests
    #    collapse to one scan).
    try:
        result = _run_singleflight(key, universe, fetch_limit)
    except Exception:
        # Upstream failure: serve whatever we have (memory or disk), else 502.
        with _cache_lock:
            entry = _cache.get(key)
        if entry is not None:
            _log(t0, universe, limit, min(len(entry["rows"]), limit), cache="hit", stale=True)
            return _envelope(entry, universe, limit=limit, cached=True, stale=True)
        disk = _load_stale_snapshot(universe, fetch_limit)
        if disk is not None:
            _log(t0, universe, limit, min(len(disk["rows"]), limit), cache="miss", stale=True)
            return _envelope(disk, universe, limit=limit, cached=False, stale=True)
        raise

    # Only a successful forced scan arms the cooldown; failure paths above
    # return stale/disk or re-raise before reaching here.
    if force:
        _note_force_scan(key, time.monotonic())

    entry = {
        "stored_at": result["stored_at"],
        "expires_at": result["stored_at"] + _ttl_seconds(universe),
        "as_of": result["as_of"],
        "update_mode": result["update_mode"],
        "rows": result["rows"],
    }
    _log(t0, universe, limit, min(len(entry["rows"]), limit), cache="miss", stale=False)
    return _envelope(entry, universe, limit=limit, cached=False, stale=False)

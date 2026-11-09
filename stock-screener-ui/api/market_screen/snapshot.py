"""Snapshot assembly for GET /api/market/snapshot.

One TradingView scan (``api.tv.scan_frame``) per universe. Shaped rows are
cached per ``(universe, limit)`` with a 60s TTL so a cache hit returns rows
directly -- no reshaping, cap-tier ranking or per-row tag lookups. F&O/ETF
membership sets are hoisted once per process. A singleflight lock collapses
N concurrent misses (or ``force`` requests) into one TV scan. The last
shaped payload is persisted to disk; on a cold start the disk snapshot is
served immediately (``stale: true``) while a background refresh runs.
"""

from __future__ import annotations

import logging
import math
import os
import pickle
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

log = logging.getLogger("market_screen.snapshot")

ALLOWED_UNIVERSES = ("all_equity", "nifty50", "nifty500", "nse_fo")

COLUMNS = [
    "name",
    "description",
    "sector",
    "industry",
    "exchange",
    "close",
    "change",
    "volume",
    "relative_volume_10d_calc",
    "market_cap_basic",
    "RSI",
    "ADX",
    "ATR",
    "SMA20",
    "SMA50",
    "SMA200",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "price_52_week_high",
    "price_52_week_low",
    "update_mode",
]

CACHE_TTL_SECONDS = 60.0
MAX_LIMIT = 4000

#: Disk-stale snapshot directory (gitignored experiments data).
_STALE_DIR = Path(__file__).resolve().parents[2] / "experiments" / "data" / "market_screen"
#: Serve a disk snapshot only if it is not older than this (3 days default).
_STALE_MAX_AGE_SEC = float(os.getenv("MARKET_SCREEN_STALE_MAX_AGE_SEC", "259200"))
#: How long a waiter blocks for a singleflight result (seconds).
_SINGLEFLIGHT_WAIT_SEC = 60.0

#: F&O / ETF membership hoisted once per process -- never re-read per row.
_FNO_SYMBOLS: frozenset[str] = fno_symbols()
_ETF_SYMBOLS: frozenset[str] = etf_symbols()

#: ``(universe, limit) -> {"stored_at", "expires_at", "as_of", "update_mode", "rows"}``
#: Shaped rows only; a hit returns ``rows`` directly with no per-row work.
_cache: dict[tuple[str, int], dict[str, Any]] = {}
_cache_lock = threading.RLock()

#: singleflight: ``(universe, limit) -> {"event", "stored_at", "as_of", "update_mode", "rows", "exc"}``
_inflight: dict[tuple[str, int], dict[str, Any]] = {}
_inflight_lock = threading.Lock()


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


def _fetch_frame(universe: str, limit: int) -> pd.DataFrame:
    """Run the single TV scan for ``universe`` with the fixed column set."""
    if universe == "all_equity":
        filters = [
            {"left": "type", "operation": "equal", "right": "stock"},
            {"left": "exchange", "operation": "equal", "right": "NSE"},
        ]
        return scan_frame(
            "india",
            columns=COLUMNS,
            filters=filters,
            sort="market_cap_basic",
            order="desc",
            limit=limit,
        )
    tickers = [to_tv_ticker(symbol) for symbol in get_universe(universe)]
    return scan_frame(
        "india",
        columns=COLUMNS,
        tickers=tickers,
        limit=limit,
    )


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


def _cap_tiers(rows: list[dict[str, Any]]) -> dict[int, str]:
    """Rank rows by market cap desc within the returned universe (1-based).

    1-100 large, 101-250 mid, 251-500 small, 501+ micro; missing cap -> micro.
    """
    ranked = sorted(
        ((index, _num(row.get("market_cap_basic")))
         for index, row in enumerate(rows)),
        key=lambda item: item[1] if item[1] is not None else -1.0,
        reverse=True,
    )
    tier_by_index: dict[int, str] = {}
    for rank, (index, mcap) in enumerate(ranked, start=1):
        if mcap is None or rank > 500:
            tier = "micro"
        elif rank <= 100:
            tier = "large"
        elif rank <= 250:
            tier = "mid"
        else:
            tier = "small"
        tier_by_index[index] = tier
    return tier_by_index


def _shape_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Shape raw scanner rows into the one-page screener contract.

    Membership checks use the hoisted ``_FNO_SYMBOLS``/_`ETF_SYMBOLS` sets --
    no ``tags_for`` call and no instruments-file read per row.
    """
    shaped: list[dict[str, Any]] = []
    tier_by_index = _cap_tiers(rows)
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
        shaped.append(
            {
                "symbol": symbol,
                "name": raw.get("description"),
                "sector": raw.get("sector"),
                "industry": raw.get("industry"),
                "exchange": raw.get("exchange"),
                "close": close,
                "change": _num(raw.get("change")),
                "volume": _num(raw.get("volume")),
                "relative_volume": _num(raw.get("relative_volume_10d_calc")),
                "market_cap": mcap,
                "market_cap_cr": (mcap / 1e7) if mcap is not None else None,
                "cap_tier": tier_by_index.get(index, "micro"),
                "rsi": _num(raw.get("RSI")),
                "adx": _num(raw.get("ADX")),
                "atr": _num(raw.get("ATR")),
                "sma20": _num(raw.get("SMA20")),
                "sma50": _num(raw.get("SMA50")),
                "sma200": _num(raw.get("SMA200")),
                "perf_w": _num(raw.get("Perf.W")),
                "perf_1m": _num(raw.get("Perf.1M")),
                "perf_3m": _num(raw.get("Perf.3M")),
                "high_52w": high,
                "low_52w": low,
                "pos_52w": pos_52w,
                "fno": sym in _FNO_SYMBOLS,
                "etf": sym in _ETF_SYMBOLS,
            }
        )
    return shaped


def _compute_once(universe: str, limit: int):
    """One TV scan + shape (+ cookie self-heal). Never falls back to cache.

    Returns ``(rows, update_mode, as_of, stored_at)`` with shaped rows, and
    persists the payload as the disk-stale snapshot (best-effort).
    """
    df, update_mode = _fetch_frame_with_heal(universe, limit)
    rows = _shape_rows(df.to_dict("records"))
    stored_at = time.time()
    as_of = datetime.now(IST).isoformat()
    _save_stale_snapshot(universe, limit, stored_at, as_of, update_mode, rows)
    return rows, update_mode, as_of, stored_at


# --------------------------------------------------------------------------- #
# Disk-stale snapshot (served immediately on a cold start, stale: true)
# --------------------------------------------------------------------------- #

def _stale_path(universe: str, limit: int) -> Path:
    return _STALE_DIR / f"snapshot_stale_{universe}_{limit}.pkl"


def _save_stale_snapshot(universe, limit, stored_at, as_of, update_mode, rows) -> None:
    """Persist the last shaped payload to disk (best-effort, never raises)."""
    try:
        _STALE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "stored_at": stored_at,
            "as_of": as_of,
            "update_mode": update_mode,
            "rows": rows,
        }
        tmp = _stale_path(universe, limit).with_suffix(".pkl.tmp")
        with open(tmp, "wb") as fh:
            pickle.dump(payload, fh, protocol=pickle.HIGHEST_PROTOCOL)
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
        with open(path, "rb") as fh:
            payload = pickle.load(fh)
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

def _claim_slot(key: tuple[str, int]) -> tuple[dict[str, Any], bool]:
    """Return ``(inflight_entry, am_winner)`` for ``key``.

    The winner owns the computation; everyone else waits on its event.
    """
    with _inflight_lock:
        inf = _inflight.get(key)
        if inf is not None:
            return inf, False
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
            "expires_at": stored_at + CACHE_TTL_SECONDS,
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
        if key in _inflight:
            return
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
                "expires_at": stored_at + CACHE_TTL_SECONDS,
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
            inf["event"].set()

    thread = threading.Thread(target=_refresh, daemon=True, name=f"snapshot-refresh-{universe}-{limit}")
    thread.start()


def _envelope(entry: dict[str, Any], universe: str, *, cached: bool, stale: bool) -> dict[str, Any]:
    """Build the response envelope from a cached/stale entry."""
    now = time.time()
    return {
        "as_of": entry["as_of"],
        "universe": universe,
        "total": len(entry["rows"]),
        "update_mode": entry["update_mode"],
        "rows": entry["rows"],
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

    Cache hit (within TTL) returns the shaped rows directly. An expired
    in-memory entry is served stale while a background refresh runs. A cold
    miss serves the disk-stale snapshot immediately (``stale: true``) and
    refreshes in the background; only when there is no disk snapshot does a
    request block on the singleflight TV scan.
    """
    t0 = time.perf_counter()
    universe = (universe or "all_equity").strip().lower()
    if universe not in ALLOWED_UNIVERSES:
        raise ValueError(
            f"unknown universe '{universe}'; expected one of "
            + ", ".join(ALLOWED_UNIVERSES)
        )
    limit = int(limit)
    key = (universe, limit)
    now = time.time()

    with _cache_lock:
        entry = _cache.get(key)

    # 1. Warm memory hit: shaped rows returned directly, no per-row work.
    if entry is not None and not force and now < entry["expires_at"]:
        _log(t0, universe, limit, len(entry["rows"]), cache="hit", stale=False)
        return _envelope(entry, universe, cached=True, stale=False)

    # 2. Expired memory entry: serve stale immediately, refresh in background.
    if entry is not None and not force:
        _maybe_start_background_refresh(key, universe, limit)
        _log(t0, universe, limit, len(entry["rows"]), cache="hit", stale=True)
        return _envelope(entry, universe, cached=True, stale=True)

    # 3. Miss: serve the disk-stale snapshot immediately on a cold start.
    if not force:
        disk = _load_stale_snapshot(universe, limit)
        if disk is not None:
            _maybe_start_background_refresh(key, universe, limit)
            _log(t0, universe, limit, len(disk["rows"]), cache="miss", stale=True)
            return _envelope(disk, universe, cached=False, stale=True)

    # 4. Force or no disk snapshot: singleflight TV scan (blocks this request,
    #    but N concurrent requests collapse to one scan via _run_singleflight).
    try:
        result = _run_singleflight(key, universe, limit)
    except Exception:
        # Upstream failure: serve whatever we have (memory or disk), else 502.
        with _cache_lock:
            entry = _cache.get(key)
        if entry is not None:
            _log(t0, universe, limit, len(entry["rows"]), cache="hit", stale=True)
            return _envelope(entry, universe, cached=True, stale=True)
        disk = _load_stale_snapshot(universe, limit)
        if disk is not None:
            _log(t0, universe, limit, len(disk["rows"]), cache="miss", stale=True)
            return _envelope(disk, universe, cached=False, stale=True)
        raise

    entry = {
        "stored_at": result["stored_at"],
        "expires_at": result["stored_at"] + CACHE_TTL_SECONDS,
        "as_of": result["as_of"],
        "update_mode": result["update_mode"],
        "rows": result["rows"],
    }
    _log(t0, universe, limit, len(entry["rows"]), cache="miss", stale=False)
    return _envelope(entry, universe, cached=False, stale=False)

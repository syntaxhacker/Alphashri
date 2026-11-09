"""Snapshot assembly for GET /api/market/snapshot.

One TradingView scan (``api.tv.scan_frame``) per universe; results are cached
in-process for 15 seconds and shaped into the one-page screener contract:
cap tiers by market-cap rank, 52-week position, F&O/ETF tags and JSON nulls
(never NaN) for missing numerics.
"""

from __future__ import annotations

import math
import threading
import time
from datetime import datetime
from typing import Any

import pandas as pd

from api.tv import scan_frame, to_tv_ticker, tv_name_to_symbol
from api.tv.status import tv_feed_status
from chart_patterns.tags import tags_for
from chart_patterns.universes import get_universe
from config import IST

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

_CACHE_TTL_SECONDS = 15.0
_MAX_LIMIT = 4000

#: ``(universe, limit) -> {"expires_at", "rows", "update_mode"}``.
_cache: dict[tuple[str, int], dict[str, Any]] = {}
_cache_lock = threading.RLock()


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


def _cache_get(universe: str, limit: int):
    with _cache_lock:
        entry = _cache.get((universe, limit))
        if entry is not None and time.time() < entry["expires_at"]:
            return entry["rows"], entry["update_mode"]
        return None


def _cache_set(universe: str, limit: int, rows, update_mode: str | None) -> None:
    with _cache_lock:
        _cache[(universe, limit)] = {
            "expires_at": time.time() + _CACHE_TTL_SECONDS,
            "rows": rows,
            "update_mode": update_mode,
        }


def _fetch_cached(universe: str, limit: int, force: bool):
    """Return ``(rows, update_mode)``, honouring the 15s cache and ``force``."""
    if not force:
        cached = _cache_get(universe, limit)
        if cached is not None:
            return cached
    df = _fetch_frame(universe, limit)
    rows = df.to_dict("records")
    update_mode = tv_feed_status().get("mode") or (
        rows[0].get("update_mode") if rows else None
    )
    _cache_set(universe, limit, rows, update_mode)
    return rows, update_mode


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


def _shape_rows(rows: list[dict[str, Any]], tier_by_index: dict[int, str]):
    shaped: list[dict[str, Any]] = []
    for index, raw in enumerate(rows):
        symbol = tv_name_to_symbol(raw.get("name")) or None
        mcap = _num(raw.get("market_cap_basic"))
        close = _num(raw.get("close"))
        low = _num(raw.get("price_52_week_low"))
        high = _num(raw.get("price_52_week_high"))
        pos_52w: float | None = None
        if close is not None and low is not None and high is not None and high != low:
            pos_52w = (close - low) / (high - low) * 100.0
        row_tags = tags_for(symbol) if symbol else []
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
                "fno": "F&O" in row_tags,
                "etf": "ETF" in row_tags,
            }
        )
    return shaped


def build_snapshot(
    universe: str = "all_equity", limit: int = _MAX_LIMIT, force: bool = False
) -> dict[str, Any]:
    """Assemble the full snapshot response for one universe."""
    universe = (universe or "all_equity").strip().lower()
    if universe not in ALLOWED_UNIVERSES:
        raise ValueError(
            f"unknown universe '{universe}'; expected one of "
            + ", ".join(ALLOWED_UNIVERSES)
        )
    limit = int(limit)
    try:
        rows, update_mode = _fetch_cached(universe, limit, force)
    except Exception:
        # Upstream failure: serve the last good frame if we have one cached,
        # even if expired; otherwise let the caller (router) return 502.
        with _cache_lock:
            entry = _cache.get((universe, limit))
        if entry is not None:
            rows, update_mode = entry["rows"], entry["update_mode"]
        else:
            raise
    return {
        "as_of": datetime.now(IST).isoformat(),
        "universe": universe,
        "total": len(rows),
        "update_mode": update_mode,
        "rows": _shape_rows(rows, _cap_tiers(rows)),
    }

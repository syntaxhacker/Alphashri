"""Bulk Redis cache for 52W ranges, importable without the FastAPI app.

The batch runner used to pull these helpers out of ``api_server_fastapi``, which
imports the whole application (routers, background tasks, Redis at import time).
Scheduled compute runs must stay standalone, so the bulk load/store pair lives
here instead.

TTL defaults to 24h because the scheduled job refreshes ranges once a day.
Override per call (``ttl=``) or with ``SCREENER_52W_CACHE_TTL`` (seconds).
"""
from __future__ import annotations

import math
import os
import shutil
from pathlib import Path

from trading.week52.keys import BULK, PAPER_52W_CACHE_DIR

DEFAULT_TTL_SECONDS = 24 * 60 * 60
TTL_ENV = "SCREENER_52W_CACHE_TTL"

_PROJECT_ROOT = Path(__file__).resolve().parents[1]


def resolve_ttl(ttl: int | None = None) -> int:
    """Explicit TTL wins; then the env override; then 24h."""
    if ttl is not None:
        return max(0, int(ttl))
    raw = os.getenv(TTL_ENV)
    if raw:
        try:
            return max(0, int(float(raw)))
        except (TypeError, ValueError):
            pass
    return DEFAULT_TTL_SECONDS


def sanitize_entry(info) -> dict | None:
    """Return {high, low, close[, days_ago][, updated_at]} or None when unusable."""
    if not isinstance(info, dict):
        return None
    out = {}
    for key in ("high", "low", "close"):
        val = info.get(key)
        if val is None:
            return None
        try:
            fval = float(val)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(fval):
            return None
        out[key] = fval
    days = info.get("days_ago")
    if days is not None:
        try:
            out["days_ago"] = max(0, int(days))
        except (TypeError, ValueError):
            pass
    ts = info.get("updated_at")
    if isinstance(ts, str) and ts:
        out["updated_at"] = ts
    elif hasattr(ts, "isoformat"):
        out["updated_at"] = ts.isoformat()
    return out


def sanitize_bulk(data: dict) -> dict:
    if not isinstance(data, dict):
        return {}
    return {
        symbol: entry
        for symbol, info in data.items()
        if (entry := sanitize_entry(info)) is not None
    }


def load_52w_ranges() -> dict[str, dict]:
    """Read the bulk key; an absent Redis or a bad payload yields {}."""
    from cache.redis_client import cache_get

    data = cache_get(BULK)
    return data if isinstance(data, dict) else {}


def _db_updated_at_stamps() -> dict[str, str]:
    try:
        from db.database import SessionLocal
        from db.models.stock_52w_touch import Stock52WeekRange

        db = SessionLocal()
        try:
            return {
                row.symbol: row.updated_at.isoformat()
                for row in db.query(Stock52WeekRange.symbol, Stock52WeekRange.updated_at).all()
                if row.updated_at is not None
            }
        finally:
            db.close()
    except Exception:
        # A compute-only host has no DB; entries simply keep the stamp they had.
        return {}


def store_52w_ranges(
    data: dict,
    *,
    ttl: int | None = None,
    stamp_from_db: bool = True,
    clear_paper_cache: bool = True,
) -> dict[str, dict]:
    """Write every range in one bulk SET and return the sanitized payload."""
    from cache.redis_client import cache_set

    clean = sanitize_bulk(data)

    if stamp_from_db and clean:
        stamps = _db_updated_at_stamps()
        for symbol, entry in clean.items():
            if "updated_at" not in entry and symbol in stamps:
                entry["updated_at"] = stamps[symbol]

    cache_set(BULK, clean, ttl=resolve_ttl(ttl))

    if clear_paper_cache:
        paper_cache_dir = _PROJECT_ROOT / PAPER_52W_CACHE_DIR
        if paper_cache_dir.exists():
            shutil.rmtree(paper_cache_dir)
            paper_cache_dir.mkdir(parents=True, exist_ok=True)

    return clean

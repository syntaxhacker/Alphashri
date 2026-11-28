"""Bulk Redis cache for 52W ranges, importable without the FastAPI app.

The on-demand admin batch and the release-asset sync both need these helpers
without importing ``api_server_fastapi`` (which pulls in routers, background
tasks and Redis at import time), so the bulk load/store pair lives here instead.

TTL resolution and range sanitization belong to ``trading.week52``; this module
only wires them to Redis and the paper-trading file cache.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from trading.week52.config import cache_ttl_sec
from trading.week52.keys import BULK, PAPER_52W_CACHE_DIR, RANGE_TTL
from trading.week52.ranges import sanitize_bulk, sanitize_entry

_PROJECT_ROOT = Path(__file__).resolve().parents[1]


def resolve_ttl(ttl: int | None = None) -> int:
    """Explicit TTL wins; then the canonical env-backed reader; then 24h."""
    if ttl is not None:
        try:
            return max(0, int(ttl))
        except (TypeError, ValueError, OverflowError):
            pass
    try:
        return cache_ttl_sec()
    except Exception:
        return RANGE_TTL


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

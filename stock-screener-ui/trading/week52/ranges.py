"""Canonical 52W range lookups: bulk Redis cache first, then the DB table.

The batch writes one bulk key (``keys.BULK``) only, so a single-symbol lookup
reads that payload rather than a per-symbol key.
"""
import math

from db.database import SessionLocal
from db.models.stock_52w_touch import Stock52WeekRange

from .keys import BULK


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


# Kept as aliases for callers that still use the private names.
_sanitize_52w_range_entry = sanitize_entry
_sanitize_52w_ranges_bulk = sanitize_bulk


def _sanitize_db_row(row) -> dict | None:
    return sanitize_entry(
        {
            "high": row.high_52w,
            "low": row.low_52w,
            "close": row.close,
            "updated_at": getattr(row, "updated_at", None),
        }
    )


def get_52w_range(symbol: str) -> dict | None:
    """Read the bulk cache entry for one symbol, then fall back to its DB row."""
    from cache.redis_client import cache_get

    bulk = cache_get(BULK)
    if isinstance(bulk, dict) and symbol in bulk:
        entry = sanitize_entry(bulk[symbol])
        if entry is not None:
            return entry

    db = SessionLocal()
    try:
        row = db.query(Stock52WeekRange).filter(Stock52WeekRange.symbol == symbol).first()
        if row is None:
            return None
        return _sanitize_db_row(row)
    finally:
        db.close()


def load_all_52w_ranges() -> dict[str, dict]:
    """Bulk Redis key 52w_range:all, else all Stock52WeekRange rows."""
    from cache.redis_client import cache_get

    bulk = cache_get(BULK)
    if isinstance(bulk, dict) and bulk:
        clean = sanitize_bulk(bulk)
        if clean:
            return clean

    db = SessionLocal()
    try:
        rows = db.query(Stock52WeekRange).all()
        return {
            row.symbol: entry
            for row in rows
            if (entry := _sanitize_db_row(row)) is not None
        }
    finally:
        db.close()


__all__ = ["sanitize_entry", "sanitize_bulk", "get_52w_range", "load_all_52w_ranges"]

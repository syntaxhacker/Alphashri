"""Load 52-week high/low/close from Redis cache or stock_52w_range table."""
import math

from db.database import SessionLocal
from db.models.stock_52w_touch import Stock52WeekRange


def _sanitize_52w_range_entry(info) -> dict | None:
    """Return {high, low, close} floats or None if any value is missing/non-finite."""
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


def _sanitize_52w_ranges_bulk(data: dict) -> dict:
    if not isinstance(data, dict):
        return {}
    return {
        symbol: entry
        for symbol, info in data.items()
        if (entry := _sanitize_52w_range_entry(info)) is not None
    }


def get_52w_range(symbol: str) -> dict | None:
    """Pick one symbol out of the bulk cache, then fall back to its DB row.

    Per-symbol ``52w_range:{symbol}`` keys were dropped: the batch writes one
    bulk key, and a single-symbol lookup reads that same payload.
    """
    from cache.redis_client import cache_get

    bulk = cache_get("52w_range:all")
    if isinstance(bulk, dict) and symbol in bulk:
        entry = _sanitize_52w_range_entry(bulk[symbol])
        if entry is not None:
            return entry

    db = SessionLocal()
    try:
        row = db.query(Stock52WeekRange).filter(Stock52WeekRange.symbol == symbol).first()
        if row is None:
            return None
        return _sanitize_52w_range_entry(
            {"high": row.high_52w, "low": row.low_52w, "close": row.close}
        )
    finally:
        db.close()


def load_all_52w_ranges() -> dict[str, dict]:
    """Bulk Redis key 52w_range:all, else all Stock52WeekRange rows."""
    from cache.redis_client import cache_get

    bulk = cache_get("52w_range:all")
    if isinstance(bulk, dict) and bulk:
        clean = _sanitize_52w_ranges_bulk(bulk)
        if clean:
            return clean

    db = SessionLocal()
    try:
        rows = db.query(Stock52WeekRange).all()
        return {
            row.symbol: entry
            for row in rows
            if (
                entry := _sanitize_52w_range_entry(
                    {"high": row.high_52w, "low": row.low_52w, "close": row.close}
                )
            )
            is not None
        }
    finally:
        db.close()
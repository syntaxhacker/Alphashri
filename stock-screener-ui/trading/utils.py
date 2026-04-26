"""
Shared trading utilities.

Unified is_market_open() with weekend + holiday + time checks.
Holidays are cached in-memory and refreshed daily to avoid per-call DB queries.
"""

import time as _time
from datetime import date, datetime, timedelta
from typing import Optional, Set

from trading.timezone import IST

MARKET_OPEN = (9, 15)
MARKET_CLOSE = (15, 30)

_cache: Optional[dict] = None
_cache_timestamp: float = 0
_CACHE_TTL_SECONDS = 3600


def _refresh_cache() -> dict:
    global _cache, _cache_timestamp
    try:
        from db.database import SessionLocal
        from db.models.holiday import MarketHoliday, HolidayType

        db = SessionLocal()
        try:
            rows = db.query(MarketHoliday.date, MarketHoliday.type).all()
            trading: Set[date] = set()
            clearing: Set[date] = set()
            for dt, htype in rows:
                if htype == HolidayType.TRADING:
                    trading.add(dt)
                else:
                    clearing.add(dt)
            _cache = {"trading": trading, "clearing": clearing}
            _cache_timestamp = _time.time()
            return _cache
        finally:
            db.close()
    except Exception:
        return _cache or {"trading": set(), "clearing": set()}


def _get_cache() -> dict:
    if _cache is None or (_time.time() - _cache_timestamp > _CACHE_TTL_SECONDS):
        return _refresh_cache()
    return _cache


def is_trading_holiday(dt: Optional[datetime] = None) -> bool:
    if dt is None:
        dt = datetime.now(IST)
    d = dt.date() if isinstance(dt, datetime) else dt
    return d in _get_cache()["trading"]


def is_clearing_holiday(dt: Optional[datetime] = None) -> bool:
    if dt is None:
        dt = datetime.now(IST)
    d = dt.date() if isinstance(dt, datetime) else dt
    return d in _get_cache()["clearing"]


def is_market_open(dt: Optional[datetime] = None) -> bool:
    if dt is None:
        dt = datetime.now(IST)
    if dt.weekday() >= 5:
        return False
    if is_trading_holiday(dt):
        return False
    open_time = datetime(dt.year, dt.month, dt.day, *MARKET_OPEN, tzinfo=IST)
    close_time = datetime(dt.year, dt.month, dt.day, *MARKET_CLOSE, tzinfo=IST)
    return open_time <= dt <= close_time


def is_trading_hours(dt: Optional[datetime] = None) -> bool:
    if dt is None:
        dt = datetime.now(IST)
    if dt.weekday() >= 5:
        return False
    if is_trading_holiday(dt):
        return False
    or_end = datetime(dt.year, dt.month, dt.day, 9, 45, tzinfo=IST)
    force_exit = datetime(dt.year, dt.month, dt.day, 15, 30, tzinfo=IST)
    return or_end <= dt <= force_exit


def is_force_exit_time(dt: Optional[datetime] = None) -> bool:
    if dt is None:
        dt = datetime.now(IST)
    return dt.hour > 15 or (dt.hour == 15 and dt.minute >= 30)

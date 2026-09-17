"""
Shared trading utilities.

Unified is_market_open() with weekend + holiday + time checks.
Holidays are cached in-memory and refreshed daily to avoid per-call DB queries.
"""

import time as _time
from datetime import date, datetime, timedelta
from typing import Optional, Set

from trading.timezone import IST

# Market time constants (single source of truth)
PRE_MARKET = (9, 0)
MARKET_OPEN = (9, 15)
OR_END = (10, 0)
MARKET_CLOSE = (15, 30)
# Safety-net exit. Was 15:30, set when 15:30 was continuous trading — since the
# Closing Auction Session it is not, so a forced market order at 15:30 would
# execute in the auction instead of the live book. Kept inside continuous
# trading (which ends at CONTINUOUS_CLOSE) so a forced exit is always fillable.
# A strategy's own `eod_exit_hour/minute` still takes precedence.
FORCE_EXIT = (15, 10)

#: End of *continuous* cash-market trading. NSE's Closing Auction Session (CAS,
#: introduced Aug 2026) runs from here to MARKET_CLOSE and determines the
#: official closing price, so from this minute on there are no further trades —
#: depth keeps updating but volume, prints and CVD stop. Anything measuring how
#: much of the *trading* session was captured must use this boundary, not
#: MARKET_CLOSE, or a flawless day can never reach 100%.
CONTINUOUS_CLOSE = (15, 15)

#: NSE cash-market session phases, in order, for display.
MARKET_PHASES = (
    ("pre-open", PRE_MARKET),
    ("open", MARKET_OPEN),
    ("cas", CONTINUOUS_CLOSE),
    ("closed", MARKET_CLOSE),
)

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


def minutes_of_day(dt: datetime) -> int:
    """Minutes since midnight — the only safe way to compare times of day."""
    return dt.hour * 60 + dt.minute


def at_or_after(dt: datetime, hhmm: tuple) -> bool:
    """True when ``dt`` has reached ``hhmm`` (hour, minute).

    Comparing ``hour`` and ``minute`` separately is a trap: ``hour >= 15 and
    minute >= 30`` is False at 16:05, so the guard silently stops firing just
    after the hour it was meant to trigger in.
    """
    return minutes_of_day(dt) >= hhmm[0] * 60 + hhmm[1]


def is_force_exit_time(dt: Optional[datetime] = None) -> bool:
    if dt is None:
        dt = datetime.now(IST)
    return at_or_after(dt, FORCE_EXIT)

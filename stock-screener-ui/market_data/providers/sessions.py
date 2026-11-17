"""US (NYSE/Nasdaq) session clock for runtime charts.

Deliberately independent of ``config.IST``: US bars plotted with an Indian
session clock land ~9.5 h off. All wall-clock reads here are in
``America/New_York`` (``ET``), and a naive datetime is interpreted as ET wall
time (same convention as ``chart_patterns.candles.parse_asof_datetime``).

When ``exchange_calendars`` or ``pandas_market_calendars`` is installed it is
used as the source of truth; otherwise a small, explicit NYSE full-day holiday
set below covers the years this service is likely to serve. That set is a
fallback, not a full calendar — install one of the libraries for broad coverage.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional, Union
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
OPEN_TIME = time(9, 30)
CLOSE_TIME = time(16, 0)

DateLike = Union[str, date, datetime]

#: NYSE full-day closures (observed dates) used only when no calendar library
#: is available. Kept small and explicit on purpose — do not grow this into a
#: home-grown calendar; install ``exchange_calendars`` instead.
NYSE_HOLIDAYS = frozenset({
    # 2024
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
    "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    # 2025
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    # 2026 (Jul 4 falls on a Saturday -> observed Fri Jul 3)
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    # 2027 (Jun 19 Sat -> Fri Jun 18; Jul 4 Sun -> Mon Jul 5; Dec 25 Sat -> Fri Dec 24)
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
    "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
})


def _calendar_session(d: date) -> Optional[bool]:
    """``True/False`` from an installed calendar library, else ``None``."""
    try:
        import exchange_calendars  # type: ignore

        calendar = exchange_calendars.get_calendar("XNYS")
        return bool(calendar.is_session(d.isoformat()))
    except Exception:
        pass
    try:
        import pandas_market_calendars  # type: ignore

        calendar = pandas_market_calendars.get_calendar("NYSE")
        return len(calendar.valid_days(start_date=d, end_date=d)) > 0
    except Exception:
        return None


def _is_session(d: date) -> bool:
    from_library = _calendar_session(d)
    if from_library is not None:
        return from_library
    return d.weekday() < 5 and d.isoformat() not in NYSE_HOLIDAYS


def _coerce_date(value: DateLike) -> Optional[date]:
    """Interpret a string/date/datetime as an ET calendar date."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if len(text) != 10 or text[4] != "-" or text[7] != "-":
            return None
        try:
            return date.fromisoformat(text)
        except ValueError:
            return None
    return None


def now_et(now: Optional[datetime] = None) -> datetime:
    """The current (or supplied) instant expressed in ET.

    Aware inputs are converted with ``astimezone``; naive inputs are read as ET
    wall time. The single clock seam is ``now=None``.
    """
    if now is None:
        return datetime.now(ET)
    if not isinstance(now, datetime):
        raise TypeError("now must be a datetime or None")
    if now.tzinfo is None or now.utcoffset() is None:
        return now.replace(tzinfo=ET)
    return now.astimezone(ET)


def is_us_session_date(value: DateLike) -> bool:
    """True when ``value`` is a weekday that is not a NYSE full-day closure."""
    d = _coerce_date(value)
    return d is not None and _is_session(d)


def is_us_open(now: Optional[datetime] = None) -> bool:
    """True inside 09:30–16:00 ET on a US session (09:30 inclusive, 16:00 exclusive)."""
    et = now_et(now)
    if not _is_session(et.date()):
        return False
    return OPEN_TIME <= et.time() < CLOSE_TIME


def previous_us_session(value: DateLike) -> date:
    """Most recent US session strictly before ``value`` (walks weekends/holidays).

    Falls back to ``value - 1 day`` if no session is found within a year, which
    only happens with a broken holiday calendar — never a real date.
    """
    d = _coerce_date(value)
    if d is None:
        raise ValueError(f"invalid US session date: {value!r}")
    cursor = d - timedelta(days=1)
    for _ in range(366):
        if _is_session(cursor):
            return cursor
        cursor -= timedelta(days=1)
    return d - timedelta(days=1)


def session_date(now: Optional[datetime] = None) -> str:
    """ET date of the current session, or the previous one when none is open.

    Returns ``YYYY-MM-DD`` always (the API contract has no nullable variant): on
    a weekday it names that day even before the open or after the close, and on
    a weekend/holiday it names the last prior session.
    """
    d = now_et(now).date()
    return (d if _is_session(d) else previous_us_session(d)).isoformat()


__all__ = [
    "ET",
    "OPEN_TIME",
    "CLOSE_TIME",
    "NYSE_HOLIDAYS",
    "now_et",
    "is_us_open",
    "is_us_session_date",
    "previous_us_session",
    "session_date",
]

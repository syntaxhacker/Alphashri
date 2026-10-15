"""Market-calendar helper: trading days and session boundaries (IST)."""

from datetime import date, datetime, timedelta
from typing import Optional, Union

from trading.timezone import IST
from trading.utils import MARKET_CLOSE, MARKET_OPEN, is_trading_holiday

DateLike = Union[date, datetime]


def _as_date(d: Optional[DateLike]) -> date:
    if d is None:
        return datetime.now(IST).date()
    if isinstance(d, datetime):
        return d.date()
    return d


def _as_datetime(now: Optional[DateLike]) -> datetime:
    if now is None:
        return datetime.now(IST)
    if isinstance(now, datetime):
        if now.tzinfo is None:
            return now.replace(tzinfo=IST)
        return now
    # plain date -> midnight IST on that date
    return datetime(now.year, now.month, now.day, tzinfo=IST)


def _at_or_after(dt: datetime, hhmm: tuple) -> bool:
    return (dt.hour * 60 + dt.minute) >= hhmm[0] * 60 + hhmm[1]


def is_trading_day(d: Optional[DateLike] = None) -> bool:
    """True when ``d`` is a weekday Mon-Fri and not a trading holiday."""
    day = _as_date(d)
    if day.weekday() >= 5:
        return False
    return not is_trading_holiday(day)


def last_completed_session(now: Optional[DateLike] = None) -> date:
    """Most recent trading day whose 15:30 IST close has passed.

    If ``now`` is a trading day at/after 15:30 IST, returns ``now``'s date;
    otherwise walks back day-by-day to the previous trading day.
    """
    ts = _as_datetime(now)
    day = ts.date()
    if is_trading_day(day) and _at_or_after(ts, MARKET_CLOSE):
        return day
    candidate = day
    if is_trading_day(candidate):
        # Trading day but close hasn't passed yet -> previous session.
        candidate = candidate - timedelta(days=1)
    while not is_trading_day(candidate):
        candidate = candidate - timedelta(days=1)
    return candidate


def next_session_open(now: Optional[DateLike] = None) -> datetime:
    """Next trading day's 09:15 IST session open.

    If ``now`` is a trading day before 09:15, returns 09:15 today;
    otherwise returns 09:15 on the next trading day.
    """
    ts = _as_datetime(now)
    day = ts.date()
    open_today = datetime(day.year, day.month, day.day, *MARKET_OPEN, tzinfo=IST)
    if is_trading_day(day) and ts < open_today:
        return open_today
    candidate = day + timedelta(days=1)
    while not is_trading_day(candidate):
        candidate = candidate + timedelta(days=1)
    return datetime(
        candidate.year, candidate.month, candidate.day, *MARKET_OPEN, tzinfo=IST
    )


def session_stamp(now: Optional[DateLike] = None) -> str:
    """``last_completed_session(now)`` as an ISO date string."""
    return last_completed_session(now).isoformat()

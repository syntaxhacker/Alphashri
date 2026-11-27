"""IST session candle boundaries for NSE/BSE indices."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .config import UTC

IST = ZoneInfo("Asia/Kolkata")
IST_HOUR_CLOSES = (10, 11, 12, 13, 14, 15)
IST_FOUR_HOUR_CLOSE_HOUR = 13


def _session_days(start, count):
    day = start
    for _ in range(count):
        if day.weekday() < 5:
            yield day
        day += timedelta(days=1)


def next_close_ist(tf_minutes: int, now: datetime) -> datetime:
    """Next IST close strictly after now; 4H closes once a day at 13:15 IST."""
    ist_now = now.astimezone(IST)
    hours = IST_HOUR_CLOSES if tf_minutes == 60 else (IST_FOUR_HOUR_CLOSE_HOUR,)
    for day in _session_days(ist_now.date(), 5):
        for hour in hours:
            close = datetime(day.year, day.month, day.day, hour, 15, tzinfo=IST)
            if close > ist_now:
                return close.astimezone(UTC)
    raise RuntimeError("no upcoming IST candle close found")


def previous_4h_close_ist(now: datetime) -> datetime:
    """Most recent completed 13:15 IST candle, used as the 4H comparison bar."""
    ist_now = now.astimezone(IST)
    close = ist_now.replace(
        hour=IST_FOUR_HOUR_CLOSE_HOUR, minute=15, second=0, microsecond=0
    )
    if close > ist_now:
        close -= timedelta(days=1)
    while close.weekday() >= 5:
        close -= timedelta(days=1)
    return close.astimezone(UTC)

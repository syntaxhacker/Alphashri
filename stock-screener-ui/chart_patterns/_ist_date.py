"""Shared IST session-date helpers for the chart-patterns package.

Single source of truth for converting UTC candle indexes to IST session
dates (``YYYY-MM-DD``). A bar stamped 18:30+ UTC belongs to the next IST
session date, so formatting the raw UTC index mislabels it. ``config.IST``
is the canonical IST timezone (repo-wide single source of truth); these
helpers must never construct their own zone. Never raises unless noted.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd

_tz = None


def _ist_tz():
    global _tz
    if _tz is None:
        import config

        _tz = config.IST
    return _tz


def ist_date(ts) -> Optional[date]:
    """IST session calendar date of a UTC timestamp; ``None`` on failure.

    Candle indexes are UTC; naive values are localized to UTC before the
    IST conversion so an 18:30Z bar lands on the next session date.
    """
    try:
        stamp = pd.Timestamp(ts)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        converted = stamp.tz_convert(_ist_tz())
        if pd.isna(converted):
            return None
        return converted.date()
    except Exception:
        return None


def ist_session_date(ts) -> Optional[str]:
    """IST session date (YYYY-MM-DD) of a UTC timestamp; ``None`` on failure."""
    session = ist_date(ts)
    return session.isoformat() if session is not None else None


def ist_session_dates(index) -> list[str]:
    """IST session dates (``YYYY-MM-DD``) for every entry of an index.

    A non-datetime index falls back to the raw first ten characters, matching
    the historical API behaviour; never raises.
    """
    try:
        idx = index
        if idx.tz is None:
            idx = idx.tz_localize("UTC").tz_convert(_ist_tz())
        else:
            idx = idx.tz_convert(_ist_tz())
        return [ts.date().isoformat() for ts in idx]
    except Exception:
        return [str(ts)[:10] for ts in index]


def ist_calendar_date(value) -> Optional[str]:
    """IST calendar date of a timestamp that already carries its own zone.

    Unlike :func:`ist_session_date`, naive values keep their own date rather
    than being read as UTC candle indexes. Raises on an unparseable zone,
    matching the levels API contract this helper replaces.
    """
    ts = value
    if hasattr(ts, "to_pydatetime"):
        ts = ts.to_pydatetime()
    if getattr(ts, "tzinfo", None) is not None:
        ts = ts.astimezone(_ist_tz())
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10] if ts is not None else None


def ist_datetime(value, *, naive_as_ist: bool = True):
    """Tz-aware IST datetime for ``value``; ``NaT`` raises ``ValueError``.

    An injected naive clock means an IST wall clock by default (the chart tail
    refresh contract). Timestamp-derived callers pass an aware value.
    """
    stamp = pd.Timestamp(value)
    if pd.isna(stamp):
        raise ValueError("now is NaT")
    if stamp.tzinfo is None:
        stamp = stamp.tz_localize(_ist_tz() if naive_as_ist else "UTC")
    else:
        stamp = stamp.tz_convert(_ist_tz())
    return stamp.to_pydatetime()


def today_ist_iso() -> str:
    """Today's IST session date (``YYYY-MM-DD``)."""
    from api.reports_api._time import today_str

    return today_str()

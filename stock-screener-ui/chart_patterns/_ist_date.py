"""Shared IST session-date helpers for the chart-patterns package.

Single source of truth for converting UTC candle indexes to IST session
dates (``YYYY-MM-DD``). A bar stamped 18:30+ UTC belongs to the next IST
session date, so formatting the raw UTC index mislabels it. ``config.IST``
is the canonical IST timezone (repo-wide single source of truth); falls
back to ``ZoneInfo("Asia/Kolkata")``. Never raises.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import pandas as pd

_tz = None


def _ist_tz():
    """Resolve the canonical IST timezone once (config.IST, else Asia/Kolkata)."""
    global _tz
    if _tz is None:
        try:
            import config

            _tz = config.IST
        except Exception:
            from zoneinfo import ZoneInfo

            _tz = ZoneInfo("Asia/Kolkata")
    return _tz


def ist_session_date(ts) -> Optional[str]:
    """IST session date (YYYY-MM-DD) of a UTC timestamp; ``None`` on failure.

    Candle indexes are UTC; converting via IST avoids mislabeling a bar
    stamped 18:30+ UTC as the previous session date.
    """
    try:
        stamp = pd.Timestamp(ts)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        converted = stamp.tz_convert(_ist_tz())
        if pd.isna(converted):
            return None
        return converted.date().isoformat()
    except Exception:
        return None


def today_ist_iso() -> str:
    """Today's date in IST as ``YYYY-MM-DD``; falls back to the UTC date."""
    try:
        import config

        return datetime.now(config.IST).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

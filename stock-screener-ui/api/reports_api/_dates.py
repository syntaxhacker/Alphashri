"""Shared ``YYYY-MM-DD`` validation for the reports API.

One copy of the guard so every reader returns the same 400 envelope instead of
a 500 on ``None`` or on a non-string value.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import HTTPException

from api.reports_api._time import today_str


def validate_date(date_str: str) -> str:
    """Validate ``YYYY-MM-DD``; a bad date is always a 400, never a 500.

    The value is coerced with ``str()`` before parsing so ``None`` (and any
    other non-string) degrades to a 400 instead of a ``TypeError``.
    """
    text = str(date_str)
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=f"bad date: {date_str!r}, want YYYY-MM-DD",
        )
    return text


def parse_day(value: Optional[str], *, default_today: bool = True) -> str:
    """Parse ``YYYY-MM-DD`` (first 10 chars) or fall back to today.

    ``None`` / empty / unparseable -> today's IST date (``YYYY-MM-DD``) when
    ``default_today`` is set, otherwise an empty string. One shared copy so
    every report reader returns the same value; callers keep their private
    names via ``from ... import parse_day as _parse_date``.
    """
    text = (value or "").strip()
    if not text:
        return today_str() if default_today else ""
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return today_str() if default_today else ""

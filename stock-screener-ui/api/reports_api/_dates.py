"""Shared ``YYYY-MM-DD`` validation for the reports API.

One copy of the guard so every reader returns the same 400 envelope instead of
a 500 on ``None`` or on a non-string value.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException


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

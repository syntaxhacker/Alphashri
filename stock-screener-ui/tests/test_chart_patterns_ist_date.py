"""Shared IST session-date helpers (``chart_patterns._ist_date``).

Covers ``ist_session_date`` (UTC timestamp -> IST session date) and
``today_ist_iso`` (today's IST date), including the UTC 18:30 -> IST
next-day session labeling.
"""

from __future__ import annotations

import re

import pandas as pd
import pytest

from chart_patterns._ist_date import ist_session_date, today_ist_iso


def test_ist_session_date_converts_utc_to_ist():
    # 18:30 UTC on 2026-01-29 -> 00:00 IST on 2026-01-30 (next session day).
    assert ist_session_date(pd.Timestamp("2026-01-29 18:30", tz="UTC")) == "2026-01-30"
    # 00:00 UTC -> 05:30 IST same day.
    assert ist_session_date(pd.Timestamp("2026-01-29 00:00", tz="UTC")) == "2026-01-29"
    # tz-naive timestamps are treated as UTC.
    assert ist_session_date(pd.Timestamp("2026-01-29")) == "2026-01-29"
    # A pandas Timestamp carries its tz; converting is idempotent.
    ts = pd.Timestamp("2026-01-29 18:30", tz="UTC")
    assert ist_session_date(ts) == ist_session_date(ts)


def test_ist_session_date_invalid_never_raises():
    assert ist_session_date(None) is None
    assert ist_session_date("not-a-timestamp") is None
    assert ist_session_date(object()) is None


def test_today_ist_iso_shape():
    today = today_ist_iso()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", today) is not None
    # Round-trips through a date parse.
    pd.Timestamp(today)

"""Session-expiry helpers shared by the SIM and walls payloads.

A tape can be recorded on a holiday-shifted expiry day and still carry the
**next** weekly chain. That is real data for the wrong contract: the UI must
label the session separately from the recorded chain instead of presenting the
next weekly's DTE as the session's DTE.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from trading.holidays_seed import CLEARING_HOLIDAYS_2026, TRADING_HOLIDAYS_2026

#: Weekly expiry weekday (Mon=0): NIFTY Tuesday, SENSEX Thursday.
EXPIRY_WEEKDAY = {"NIFTY": 1, "SENSEX": 3}


def preponed_expiry_note(
    symbol: str,
    session_date: str,
    recorded_expiry: str | None,
) -> str | None:
    """Explain a tape that captured the next weekly on a preponed expiry day.

    On 2026-11-09 the nominal NIFTY expiry (Tuesday 2026-11-10) was a holiday,
    so the 0-DTE contract expired on Monday 2026-11-09. The recorder's old
    strictly-future rule skipped it and wrote the 2026-11-17 weekly — still a
    real chain, but not the session's expiry.
    """
    weekday = EXPIRY_WEEKDAY.get(symbol)
    if weekday is None:
        return None
    try:
        day = date.fromisoformat(session_date)
        expiry_day = date.fromisoformat(recorded_expiry) if recorded_expiry else None
    except (TypeError, ValueError):
        return None
    if expiry_day is None or expiry_day <= day:
        return None

    nominal = day
    while nominal.weekday() != weekday:
        nominal += timedelta(days=1)
    holidays = {
        value for value, _ in TRADING_HOLIDAYS_2026
    } | {
        value for value, _ in CLEARING_HOLIDAYS_2026
    }
    preponed = nominal
    while preponed.weekday() >= 5 or preponed in holidays:
        preponed -= timedelta(days=1)
    if preponed != day:
        return None
    return (
        f"{session_date} was the 0-DTE expiry: the {nominal.isoformat()} expiry "
        f"was preponed because that day is a holiday. The tape captured the next "
        f"expiry ({recorded_expiry}), so its DTE is not the session's true 0."
    )


def session_expiry_info(
    symbol: str,
    session_date: str,
    recorded_expiry: str | None,
) -> tuple[Optional[int], Optional[str]]:
    """Return ``(true_session_dte, mismatch_note)``.

    The note is set only when the session was the preponed expiry but the tape
    recorded a later weekly. Otherwise the recorded expiry *is* the session's
    contract and its calendar DTE is returned unchanged.
    """
    note = preponed_expiry_note(symbol, session_date, recorded_expiry)
    if note:
        return 0, note
    try:
        session = date.fromisoformat(session_date)
        expiry = date.fromisoformat(recorded_expiry) if recorded_expiry else None
    except (TypeError, ValueError):
        return None, None
    if expiry is None:
        return None, None
    return max(0, (expiry - session).days), None

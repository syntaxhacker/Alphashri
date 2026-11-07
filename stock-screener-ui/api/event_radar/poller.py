"""Background poller for Event Radar: calendar refresh + intraday tripwire.

Two clocks run in one task:

* **calendar** — every ``interval_calendar_sec`` (default 30 min), once
  immediately on start so a restart after a long outage backfills at once.
* **tripwire** — every ``interval_tripwire_sec`` (default 60 s), but only while
  the US cash session is open. Polling Yahoo after the close burns quota to
  discover that nothing moved.

Configuration (environment, read once at task start):

``EVENT_RADAR_TRIPWIRE_SYMBOLS``
    Comma-separated US tickers to watch, e.g. ``ORCL,MSFT,NVDA``. **Empty (the
    default) disables the tripwire** — a scanner that scans nothing is the safe
    default; enabling it is an explicit opt-in.
``EVENT_RADAR_MARKET``
    ``us`` (default) or ``india``. Only US has a stable free 1-minute source
    today (yfinance); India goes through the Upstox wrapper in ``anomaly.py``.

The loop is deliberately unkillable: ``CancelledError`` exits, everything else
is logged and swallowed. A poller that dies on one bad symbol stops the feature
silently, which is worse than a skipped cycle.

Nothing here imports a data source at module scope: the DB session, yfinance and
Upstox are all imported lazily inside the worker functions so that CI (where the
task never starts) can import this module freely.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
from collections.abc import Sequence
from dataclasses import replace
from typing import Any, Optional

from .contract import Anomaly

logger = logging.getLogger("event_radar.poller")

#: US cash session in UTC, as (start_hour, start_minute, end_hour, end_minute).
#:
#: DELIBERATE APPROXIMATION: 09:30-16:00 ET is 13:30-20:00 UTC under EDT and
#: 14:30-21:00 UTC under EST. Using the summer window all year means the task
#: wakes up one hour early in winter and stops one hour early — it never *misses*
#: the open, and the tripwire itself only fires on real bars, so the cost of the
#: skew is a handful of empty scans per winter morning. A DST-correct check would
#: need a tz database plus the NYSE holiday calendar, neither of which belongs in
#: a 60-second loop.
US_MARKET_HOURS_UTC = (13, 30, 20, 0)

_DEFAULT_CALENDAR_INTERVAL = 1800
_DEFAULT_TRIPWIRE_INTERVAL = 60
#: The digest goes out on the first tick at/after 07:30 ET: before the US open,
#: after the European close, i.e. when the calendar is stable.
_DIGEST_AFTER_ET = (7, 30)

_US_TZ = dt.timezone(dt.timedelta(hours=-4))


# --------------------------------------------------------------------------- #
# Clock
# --------------------------------------------------------------------------- #


def _utc_now() -> dt.datetime:
    """Patch point for tests: the loop's only source of "now"."""
    return dt.datetime.now(dt.timezone.utc)


def _et_now(now_utc: Optional[dt.datetime] = None) -> dt.datetime:
    stamp = now_utc or _utc_now()
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.timezone.utc)
    try:
        from zoneinfo import ZoneInfo

        return stamp.astimezone(ZoneInfo("America/New_York"))
    except Exception:  # pragma: no cover - tzdata missing
        return stamp.astimezone(_US_TZ)


def is_us_market_open(now_utc: Optional[dt.datetime] = None) -> bool:
    """Mon-Fri inside :data:`US_MARKET_HOURS_UTC` (see the DST note there).

    Holidays are not excluded: the tripwire no-ops on missing bars anyway, and a
    wrong "closed" answer would suppress a live session, which is the expensive
    mistake.
    """
    stamp = now_utc or _utc_now()
    if stamp.tzinfo is not None:
        stamp = stamp.astimezone(dt.timezone.utc)
    if stamp.weekday() >= 5:  # Saturday/Sunday
        return False
    start_hour, start_minute, end_hour, end_minute = US_MARKET_HOURS_UTC
    start = stamp.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
    end = stamp.replace(hour=end_hour, minute=end_minute, second=0, microsecond=0)
    return start <= stamp < end


def _digest_due(now_utc: dt.datetime, last_digest_day: Optional[dt.date]) -> bool:
    """Once per ET calendar day, at the first tick after 07:30 ET."""
    et = _et_now(now_utc)
    if et.date() == last_digest_day:
        return False
    return (et.hour, et.minute) >= _DIGEST_AFTER_ET


def _tripwire_symbols() -> list[str]:
    raw = os.environ.get("EVENT_RADAR_TRIPWIRE_SYMBOLS", "")
    return [part.strip().upper() for part in raw.split(",") if part.strip()]


def _tripwire_market() -> str:
    value = os.environ.get("EVENT_RADAR_MARKET", "us").strip().lower()
    return value or "us"


# --------------------------------------------------------------------------- #
# Workers (sync, so they can run off the event loop)
# --------------------------------------------------------------------------- #


def _session():
    """Short-lived session: the poller wakes up hours apart, never pool one."""
    from db.database import SessionLocal

    return SessionLocal()


def _refresh_and_store() -> dict[str, Any]:
    from .router import refresh_calendar
    from .store import upsert_events

    events = refresh_calendar()
    session = _session()
    try:
        inserted = upsert_events(session, events)
    finally:
        session.close()
    return {"ok": True, "inserted": inserted, "fetched": len(events)}


async def refresh_calendar_once() -> dict[str, Any]:
    """One calendar refresh, executed off the event loop (blocking HTTP + DB)."""
    return await asyncio.to_thread(_refresh_and_store)


def _scan_and_store(symbols: Sequence[str], market: str) -> list[Anomaly]:
    from .alerts import send_anomaly
    from .anomaly import scan_symbol
    from .router import market_today
    from .store import event_symbols_on, save_anomalies

    ordered: list[str] = [str(symbol).upper() for symbol in symbols if str(symbol).strip()]
    if not ordered:
        return []

    session = _session()
    try:
        known_today = event_symbols_on(session, market_today(market))
        found: list[Anomaly] = []
        for symbol in ordered:
            try:
                anomalies = scan_symbol(symbol, market)
            except Exception as exc:  # noqa: BLE001 - one symbol must not stop the scan
                logger.warning("event radar: scan failed for %s: %s", symbol, exc)
                continue
            # Frozen dataclass: replace() rather than mutation at the boundary.
            found.extend(
                replace(anomaly, has_known_event=anomaly.symbol.upper() in known_today)
                for anomaly in anomalies
            )

        if not found:
            return []
        try:
            save_anomalies(session, found, market=market)
        except Exception as exc:  # noqa: BLE001 - storage is not worth a cycle
            logger.warning("event radar: anomaly persist failed: %s", exc)
    finally:
        session.close()

    for anomaly in found:
        if anomaly.has_known_event:
            # Defence in depth: ``send_anomaly`` suppresses these too, but the
            # poller should not even try to page about a move the calendar
            # already explains.
            continue
        send_anomaly(anomaly)
    return found


async def anomaly_scan_once(symbols: Sequence[str], market: str = "us") -> list[Anomaly]:
    """One tripwire pass over ``symbols``, off the event loop."""
    return await asyncio.to_thread(_scan_and_store, list(symbols), market)


def _deliver_digest() -> int:
    from .alerts import send_daily_digest
    from .router import market_today
    from .store import list_events

    today = market_today("us")
    session = _session()
    try:
        events = list_events(
            session,
            market="us",
            start=today,
            end=today + dt.timedelta(days=1),
            upcoming_only=False,
            today=today,
            limit=40,
        )
    finally:
        session.close()
    return send_daily_digest(events, today)


# --------------------------------------------------------------------------- #
# Loop
# --------------------------------------------------------------------------- #


async def event_radar_poller(
    interval_calendar_sec: float = _DEFAULT_CALENDAR_INTERVAL,
    interval_tripwire_sec: float = _DEFAULT_TRIPWIRE_INTERVAL,
) -> None:
    """Run until cancelled. Never raises except for ``CancelledError``."""
    last_calendar: Optional[dt.datetime] = None
    last_digest_day: Optional[dt.date] = None
    symbols = _tripwire_symbols()
    market = _tripwire_market()

    logger.info(
        "event radar poller started (calendar %ss, tripwire %ss, %d symbols, market %s)",
        interval_calendar_sec,
        interval_tripwire_sec,
        len(symbols),
        market,
    )

    while True:
        try:
            now = _utc_now()

            due = last_calendar is None or (
                (now - last_calendar).total_seconds() >= interval_calendar_sec
            )
            if due:
                await refresh_calendar_once()
                last_calendar = now

            if _digest_due(now, last_digest_day):
                await asyncio.to_thread(_deliver_digest)
                last_digest_day = _et_now(now).date()

            if symbols and is_us_market_open(now):
                await anomaly_scan_once(symbols, market)
        except asyncio.CancelledError:
            logger.info("event radar poller cancelled")
            raise
        except Exception as exc:  # noqa: BLE001 - the loop must outlive a bad cycle
            logger.warning("event radar cycle failed: %s", exc)

        await asyncio.sleep(max(0.0, float(interval_tripwire_sec)))


__all__ = [
    "US_MARKET_HOURS_UTC",
    "anomaly_scan_once",
    "event_radar_poller",
    "is_us_market_open",
    "refresh_calendar_once",
]

"""Persistence for Event Radar — the only place that talks to the database.

Why a store module at all: the router (HTTP), the poller (background) and the
tests (in-memory SQLite) all need the same three behaviours — a precedence-aware
upsert, a filtered read, and a day-scoped symbol lookup for anomaly suppression.
Duplicating those rules at three call sites is how a "seed beats EDGAR" rule
silently becomes "last writer wins".

Every function takes an **explicit** ``Session``. There is no ``SessionLocal()``
hidden in here: that is what lets the tests bind an in-memory engine, and what
keeps transaction boundaries visible to the caller.

Precedence is applied at the *event identity* level ``(symbol, event_date,
event_type)``, not at the row level. The DB unique constraint includes
``source``, so two sources could coexist; the store collapses them so the
calendar shows one row per event and EDGAR can replace a TradingView guess in
place (rather than sitting next to it as a duplicate).
"""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Iterable, Sequence
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import config

from api.event_radar.contract import (
    EVENT_TYPES,
    SOURCE_PRECEDENCE,
    Anomaly,
    Event,
)
from api.event_radar.normalize import dedupe
from db.models.event import CorporateEvent, EventAnomaly

logger = logging.getLogger("event_radar.store")

#: Exchange -> market. TradingView/EDGAR spell these a dozen ways, so the match
#: is on the leading token rather than on the whole string ("NYSE ARCA",
#: "NYSE American", "NASDAQGS" all have to land in "us").
_US_EXCHANGE_PREFIXES: tuple[str, ...] = (
    "NASDAQ",
    "NYSE",
    "AMEX",
    "ARCA",
    "BATS",
    "OTC",
    "CBOE",
)
_INDIA_EXCHANGE_PREFIXES: tuple[str, ...] = ("NSE", "BSE", "NFO", "BFO")

_IST = config.IST
_TYPE_PRIORITY: dict[str, int] = {name: index for index, name in enumerate(EVENT_TYPES)}


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def market_for_exchange(exchange: str | None) -> str:
    """Map a vendor exchange string onto ``"us" | "india" | "other"``.

    Prefix matching (not equality) because the same venue arrives as
    ``NASDAQ``, ``NASDAQGS``, ``NYSE ARCA`` and ``NYSE American`` depending on
    the source; an unknown exchange degrades to ``"other"`` instead of raising,
    so a new listing never blocks an insert.
    """
    if not exchange:
        return "other"
    text = " ".join(str(exchange).split()).upper()
    if not text:
        return "other"
    for prefix in _US_EXCHANGE_PREFIXES:
        if text.startswith(prefix):
            return "us"
    for prefix in _INDIA_EXCHANGE_PREFIXES:
        if text.startswith(prefix):
            return "india"
    return "other"


def _us_today() -> dt.date:
    """Today in New York. Never a naive ``date.today()`` (server may be IST)."""
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # pragma: no cover - tzdata missing in a slim image
        return dt.datetime.now(dt.timezone(dt.timedelta(hours=-4))).date()


def _market_today(market: str) -> dt.date:
    if (market or "").lower() == "india":
        return dt.datetime.now(_IST).date()
    return _us_today()


def _as_date(value: object) -> Optional[dt.date]:
    """Coerce date/datetime/ISO-string to ``date``; ``None`` when unusable.

    The ``Date`` column hands back a ``datetime`` on SQLite when the value was
    written as one, so every comparison in this module funnels through here.
    """
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value).strip()[:10])
    except (ValueError, TypeError):
        return None


def _as_utc(value: object, market: str) -> Optional[dt.datetime]:
    """Normalise an anomaly timestamp to UTC (naive input == market-local)."""
    stamp: Optional[dt.datetime]
    if isinstance(value, dt.datetime):
        stamp = value
    elif isinstance(value, str):
        try:
            stamp = dt.datetime.fromisoformat(value.strip())
        except (ValueError, TypeError):
            return None
    else:
        return None
    if stamp.tzinfo is None:
        if market == "india":
            stamp = stamp.replace(tzinfo=_IST)
        elif market == "us":
            try:
                from zoneinfo import ZoneInfo

                stamp = stamp.replace(tzinfo=ZoneInfo("America/New_York"))
            except Exception:  # pragma: no cover
                stamp = stamp.replace(tzinfo=dt.timezone(dt.timedelta(hours=-4)))
        else:
            stamp = stamp.replace(tzinfo=dt.timezone.utc)
    return stamp.astimezone(dt.timezone.utc)


def _precedence(source: str | None) -> int:
    return SOURCE_PRECEDENCE.get(str(source or ""), 0)


def _materially_better(existing: CorporateEvent, event: Event) -> bool:
    """Equal-precedence tie-break: longer title, then higher confidence.

    A longer title is the source that actually says *what* the event is
    ("Oracle Investor Day" beats "ORCL investor day"); confidence breaks the
    remaining ties. Identical re-inserts return ``False`` so a refresh is a
    no-op instead of a write storm.
    """
    old_title = existing.title or ""
    new_title = event.title or ""
    if len(new_title) != len(old_title):
        return len(new_title) > len(old_title)
    return float(event.confidence) > float(existing.confidence or 0.0)


# --------------------------------------------------------------------------- #
# Events
# --------------------------------------------------------------------------- #


def _apply(row: CorporateEvent, event: Event) -> None:
    """Copy a contract Event onto a row (source fields only, never ids)."""
    row.symbol = event.symbol
    row.market = market_for_exchange(event.exchange)
    row.exchange = event.exchange
    row.name = event.name
    row.event_type = event.event_type
    row.title = event.title
    row.event_date = _as_date(event.event_date)
    row.announced_at = _as_date(event.announced_at)
    row.source = event.source
    row.source_url = event.source_url
    row.confidence = float(event.confidence)
    row.recurring = bool(event.recurring)
    row.notes = event.notes
    row.external_id = event.id


def _find_candidates(
    session: Session, symbol: str, event_date: dt.date, event_type: str
) -> list[CorporateEvent]:
    """All rows describing this event, highest precedence first."""
    stmt = select(CorporateEvent).where(
        CorporateEvent.symbol == symbol,
        CorporateEvent.event_date == event_date,
        CorporateEvent.event_type == event_type,
    )
    rows = list(session.execute(stmt).scalars().all())
    rows.sort(key=lambda row: _precedence(row.source), reverse=True)
    return rows


def upsert_events(session: Session, events: Iterable[Event]) -> int:
    """Upsert ``events`` by event identity, honouring source precedence.

    Return value is the number of rows *inserted or materially updated* — a
    second identical refresh returns ``0``, which is what makes the poller
    idempotent and the "inserted" counter in ``POST /refresh`` trustworthy.

    The caller's iterable is never mutated and the ``Event`` objects are frozen,
    so re-reading the same list after a failure is safe.
    """
    batch = list(events)
    changed = 0

    for event in batch:
        event_date = _as_date(event.event_date)
        if event_date is None:
            logger.warning("store: skipping %s — unusable event_date", event.id)
            continue

        candidates = _find_candidates(session, event.symbol, event_date, event.event_type)
        if not candidates:
            row = CorporateEvent()
            _apply(row, event)
            session.add(row)
            changed += 1
            continue

        winner = candidates[0]  # highest precedence already
        if _precedence(winner.source) > event.precedence:
            # A more trustworthy source already covers this event; the newcomer
            # must not downgrade it.
            continue
        if _precedence(winner.source) == event.precedence and not _materially_better(
            winner, event
        ):
            continue

        _apply(winner, event)
        changed += 1

    session.commit()
    return changed


def list_events(
    session: Session,
    *,
    market: str = "all",
    start: Optional[dt.date | dt.datetime] = None,
    end: Optional[dt.date | dt.datetime] = None,
    types: Optional[Sequence[str]] = None,
    symbols: Optional[Sequence[str]] = None,
    upcoming_only: bool = True,
    today: Optional[dt.date | dt.datetime] = None,
    limit: int = 500,
) -> list[Event]:
    """Return calendar rows as contract Events, newest-window first.

    ``upcoming_only`` is a *floor* on ``event_date`` (defaulting to the market's
    own today), not a filter on announcement recency: the whole point of the tab
    is seeing "Oracle Investor Day in 3 days" that was announced five days ago.
    """
    stmt = select(CorporateEvent)
    if market and market.lower() != "all":
        stmt = stmt.where(CorporateEvent.market == market.lower())

    start_date = _as_date(start)
    end_date = _as_date(end)
    if start_date is not None:
        stmt = stmt.where(CorporateEvent.event_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(CorporateEvent.event_date <= end_date)

    if upcoming_only:
        floor = _as_date(today) or _market_today(market)
        stmt = stmt.where(CorporateEvent.event_date >= floor)

    wanted_types = [t for t in (types or []) if t]
    if wanted_types:
        stmt = stmt.where(CorporateEvent.event_type.in_(wanted_types))

    wanted_symbols = sorted({str(s).upper() for s in (symbols or []) if str(s).strip()})
    if wanted_symbols:
        stmt = stmt.where(CorporateEvent.symbol.in_(wanted_symbols))

    # Over-fetch a little so a legacy duplicate cannot starve the page; the
    # dedupe below is what actually protects the caller.
    safe_limit = max(1, min(int(limit or 500), 5000))
    stmt = stmt.order_by(CorporateEvent.event_date.asc(), CorporateEvent.symbol.asc())
    stmt = stmt.limit(safe_limit * 2)

    rows = session.execute(stmt).scalars().all()
    events = [event for event in (row.to_contract() for row in rows) if event is not None]
    collapsed = dedupe(events)
    collapsed.sort(
        key=lambda ev: (
            ev.event_date,
            _TYPE_PRIORITY.get(ev.event_type, len(EVENT_TYPES)),
            ev.symbol,
        )
    )
    return collapsed[:safe_limit]


def event_symbols_on(session: Session, day: dt.date | dt.datetime) -> set[str]:
    """Symbols with a calendar row on ``day`` — the anomaly suppression set.

    A move on an event day is *explained*; alerting on it is the failure mode
    this feature exists to avoid.
    """
    date_value = _as_date(day)
    if date_value is None:
        return set()
    stmt = select(CorporateEvent.symbol).where(CorporateEvent.event_date == date_value)
    return {str(symbol).upper() for symbol in session.execute(stmt).scalars().all() if symbol}


def prune_old_events(session: Session, keep_days: int = 400) -> int:
    """Delete events that happened more than ``keep_days`` ago.

    400 days keeps a full annual cadence visible (a "recurring" investor day
    from last year is useful context) without growing the table forever.
    """
    cutoff = _us_today() - dt.timedelta(days=max(0, int(keep_days)))
    result = session.execute(
        delete(CorporateEvent).where(CorporateEvent.event_date < cutoff)
    )
    session.commit()
    return int(result.rowcount or 0)


# --------------------------------------------------------------------------- #
# Anomalies
# --------------------------------------------------------------------------- #


def save_anomalies(
    session: Session,
    anomalies: Iterable[Anomaly],
    *,
    market: str | None = None,
) -> int:
    """Upsert anomalies by ``(symbol, ts)``; returns rows inserted or changed.

    A rescan of the same bar rewrites the row (session volumes settle as the
    tape fills in) but must not duplicate it — the tripwire runs every minute
    and would otherwise fill the table within a day.

    ``market`` is an optional override because ``Anomaly`` carries no market
    field: the poller knows whether it scanned US or India, but a bare
    ``Anomaly`` built by hand in a test does not.
    """
    batch = list(anomalies)
    changed = 0

    for anomaly in batch:
        symbol = str(anomaly.symbol or "").upper()
        if not symbol:
            continue
        # The market comes off ``market=`` when the poller supplies it, else off
        # the contract's ``exchange`` field; US is the only live tripwire market
        # today, so an unfilled exchange is treated as US, not as "other".
        anomaly_market = (market or "").lower() or market_for_exchange(anomaly.exchange)
        if anomaly_market in ("", "other"):
            anomaly_market = "us"
        stamp = _as_utc(anomaly.ts, anomaly_market)
        if stamp is None:
            logger.warning("store: skipping anomaly with bad ts %r", anomaly.ts)
            continue

        existing = session.execute(
            select(EventAnomaly).where(
                EventAnomaly.symbol == symbol, EventAnomaly.ts == stamp
            )
        ).scalars().first()

        if existing is None:
            session.add(
                EventAnomaly(
                    symbol=symbol,
                    market=anomaly_market,
                    ts=stamp,
                    price=float(anomaly.price),
                    ret_pct=float(anomaly.ret_pct),
                    ret_sigma=float(anomaly.ret_sigma),
                    vol_ratio=float(anomaly.vol_ratio),
                    has_known_event=bool(anomaly.has_known_event),
                    suspected=anomaly.suspected,
                    notified=False,
                )
            )
            changed += 1
            continue

        signature = (
            float(existing.price or 0.0),
            float(existing.ret_pct or 0.0),
            float(existing.ret_sigma or 0.0),
            float(existing.vol_ratio or 0.0),
            bool(existing.has_known_event),
            existing.suspected,
        )
        incoming = (
            float(anomaly.price),
            float(anomaly.ret_pct),
            float(anomaly.ret_sigma),
            float(anomaly.vol_ratio),
            bool(anomaly.has_known_event),
            anomaly.suspected,
        )
        if signature == incoming:
            continue
        existing.price = incoming[0]
        existing.ret_pct = incoming[1]
        existing.ret_sigma = incoming[2]
        existing.vol_ratio = incoming[3]
        existing.has_known_event = incoming[4]
        existing.suspected = incoming[5]
        changed += 1

    session.commit()
    return changed


def list_anomalies(
    session: Session, day: dt.date | dt.datetime, market: str = "all"
) -> list[Anomaly]:
    """Anomalies whose bar falls inside ``day`` (in the market's local clock).

    Day bounds are converted to UTC because that is how the column is stored;
    comparing on market-local wall time would silently shift the window by the
    DST offset twice a year.
    """
    date_value = _as_date(day)
    if date_value is None:
        return []

    tz = _IST if (market or "").lower() == "india" else dt.timezone(dt.timedelta(hours=-4))
    try:
        from zoneinfo import ZoneInfo

        if (market or "").lower() != "india":
            tz = ZoneInfo("America/New_York")
    except Exception:  # pragma: no cover - tzdata missing
        pass

    day_start = dt.datetime.combine(date_value, dt.time.min, tzinfo=tz).astimezone(
        dt.timezone.utc
    ).replace(tzinfo=None)
    day_end = day_start + dt.timedelta(days=1)

    stmt = select(EventAnomaly).where(
        EventAnomaly.ts >= day_start, EventAnomaly.ts < day_end
    )
    if market and market.lower() != "all":
        stmt = stmt.where(EventAnomaly.market == market.lower())
    stmt = stmt.order_by(EventAnomaly.ts.asc())

    rows = session.execute(stmt).scalars().all()
    return [row.to_contract() for row in rows]


__all__ = [
    "event_symbols_on",
    "list_anomalies",
    "list_events",
    "market_for_exchange",
    "prune_old_events",
    "save_anomalies",
    "upsert_events",
]

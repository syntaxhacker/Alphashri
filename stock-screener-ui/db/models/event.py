"""Event Radar tables: the corporate-event calendar and the intraday tripwire.

Two tables, two different lifetimes:

* ``corporate_events`` — one row per (symbol, event day, event type). Written by
  the calendar refresh, read by the UI. It is a *cache of upstream truth*: the
  row can be replaced by a more trustworthy source at any time, which is why
  ``source`` and ``confidence`` live on the row rather than in a side table.
* ``event_anomalies`` — one row per (symbol, bar timestamp). Append-mostly; the
  row is rewritten when a later scan recomputes the same bar (a refreshed
  session changes volumes, so the same bar must be re-evaluated, not duplicated).

``to_contract()`` fuses the two halves of the feature onto the frozen contract
dataclasses. It tolerates dirty rows by returning ``None``: a hand-edited or
half-written row must degrade to "missing event", never to a 500 on the whole
calendar.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    String,
    Text,
    UniqueConstraint,
)

import config

from .base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:  # pragma: no cover - typing only, keeps db.models free of api imports
    from api.event_radar.contract import Anomaly, Event

logger = logging.getLogger("event_radar.models")

#: Market-local timezone used to re-attach an offset to a stored anomaly ts.
_IST = config.IST
_US_TZ: dt.tzinfo = dt.timezone(dt.timedelta(hours=-4))


def _iso_date(value: object) -> Optional[str]:
    """Render a Date/DateTime/str column as a bare ``YYYY-MM-DD`` string.

    SQLite hands back ``datetime`` even for a ``Date`` column when the value was
    written as a datetime, so the caller cannot rely on the declared type.
    """
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    try:
        return dt.date.fromisoformat(text[:10]).isoformat()
    except (ValueError, TypeError):
        return None


class CorporateEvent(Base, IdMixin, TimestampMixin):
    """One row per announced corporate event on one symbol.

    The unique constraints encode two different identities on purpose:

    * ``external_id`` (== ``Event.id``) is the source's stable id, so a re-run
      of the same source cannot insert the same announcement twice;
    * ``(symbol, event_date, event_type, source)`` is the human identity of the
      event. The store collapses across ``source`` using
      :data:`api.event_radar.contract.SOURCE_PRECEDENCE`; the constraint keeps a
      legacy duplicate from appearing if two writers race.
    """

    __tablename__ = "corporate_events"

    symbol = Column(String(20), nullable=False, index=True)
    market = Column(String(10), nullable=True, index=True)  # "us" | "india" | "other"
    exchange = Column(String(20), nullable=True)
    name = Column(String(200), nullable=True)
    event_type = Column(String(40), nullable=True, index=True)
    title = Column(String(500), nullable=False)
    event_date = Column(Date, nullable=False, index=True)
    announced_at = Column(Date, nullable=True)
    source = Column(String(20), nullable=False)
    source_url = Column(String(1000), nullable=True)
    confidence = Column(Float, nullable=True, default=0.5)
    recurring = Column(Boolean, nullable=True, default=False)
    notes = Column(Text, nullable=True)
    #: == ``Event.id``; the stable per-source id.
    external_id = Column(String(200), nullable=False)

    __table_args__ = (
        UniqueConstraint("external_id", name="uq_corporate_event_external_id"),
        UniqueConstraint(
            "symbol",
            "event_date",
            "event_type",
            "source",
            name="uq_corporate_event_natural",
        ),
    )

    def to_contract(self) -> Optional["Event"]:
        """Rebuild the frozen ``Event`` dataclass from this row.

        Returns ``None`` when the row cannot be represented — a stale
        ``event_type`` after a taxonomy change, a non-ISO date, a bad source.
        The contract dataclass is the validator; letting it raise here would
        turn one dirty row into a 502 for the whole calendar.
        """
        from api.event_radar.contract import Event

        try:
            return Event(
                id=self.external_id,
                symbol=self.symbol or "",
                event_type=self.event_type or "",
                title=self.title or "",
                event_date=_iso_date(self.event_date) or "",
                source=self.source or "",
                exchange=self.exchange,
                name=self.name,
                announced_at=_iso_date(self.announced_at),
                source_url=self.source_url,
                confidence=0.5 if self.confidence is None else float(self.confidence),
                recurring=bool(self.recurring),
                notes=self.notes,
            )
        except (ValueError, TypeError, AttributeError) as exc:
            logger.warning(
                "corporate_events: dropping unrepresentable row id=%s (%s)",
                self.id,
                exc,
            )
            return None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"<CorporateEvent {self.symbol} {self.event_type} "
            f"{_iso_date(self.event_date)} {self.source}>"
        )


class EventAnomaly(Base, IdMixin, TimestampMixin):
    """One statistically abnormal 1-minute bar.

    ``ts`` is stored in **UTC** (the dialect drops the offset, so the wall value
    is what matters); ``to_contract`` re-attaches the market's offset so the UI
    always sees the exchange's local clock. ``notified`` is the send-once latch
    the poller uses — a crashed poller must not re-alert every restart.
    """

    __tablename__ = "event_anomalies"

    symbol = Column(String(20), nullable=False, index=True)
    market = Column(String(10), nullable=True)
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    price = Column(Float, nullable=True)
    ret_pct = Column(Float, nullable=True)
    ret_sigma = Column(Float, nullable=True)
    vol_ratio = Column(Float, nullable=True)
    has_known_event = Column(Boolean, nullable=True)
    suspected = Column(String(200), nullable=True)
    notified = Column(Boolean, nullable=True, default=False)

    __table_args__ = (
        UniqueConstraint("symbol", "ts", name="uq_event_anomaly_symbol_ts"),
    )

    def _market_tz(self) -> dt.tzinfo:
        market = (self.market or "").lower()
        if market == "india":
            return _IST
        if market == "us":
            try:
                from zoneinfo import ZoneInfo

                return ZoneInfo("America/New_York")
            except Exception:  # pragma: no cover - tzdata missing
                return _US_TZ
        return dt.timezone.utc

    def to_contract(self) -> "Anomaly":
        """Rebuild the frozen ``Anomaly``, restoring a real UTC offset on ``ts``."""
        from api.event_radar.contract import Anomaly

        stamp = self.ts
        if stamp is None:
            stamp = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
        elif stamp.tzinfo is None:
            # Stored naive == stored UTC (see the class docstring).
            stamp = stamp.replace(tzinfo=dt.timezone.utc)
        else:
            stamp = stamp.astimezone(dt.timezone.utc)
        return Anomaly(
            symbol=self.symbol or "",
            ts=stamp.astimezone(self._market_tz()).isoformat(),
            price=float(self.price or 0.0),
            ret_pct=float(self.ret_pct or 0.0),
            ret_sigma=float(self.ret_sigma or 0.0),
            vol_ratio=float(self.vol_ratio or 0.0),
            has_known_event=bool(self.has_known_event),
            suspected=self.suspected,
            exchange=None,
        )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<EventAnomaly {self.symbol} {self.ts} {self.ret_pct}%>"


__all__ = ["CorporateEvent", "EventAnomaly"]

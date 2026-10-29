"""Frozen contract for Event Radar.

This module is the single source of truth for the wire format. Every source
adapter yields ``Event`` objects; the router emits ``Event.to_dict()``; the
frontend mirrors it in ``src/types/events.ts``.

Do not add source-specific fields here. If a source needs extra detail, put it
in ``notes`` or in the source module's own Raw* dataclass.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass
from typing import Final, Literal, Optional

# --------------------------------------------------------------------------- #
# Taxonomies
# --------------------------------------------------------------------------- #

#: Ordered by how much the market cares (used for sort tie-breaks + UI badges).
EVENT_TYPES: Final[tuple[str, ...]] = (
    "investor_day",
    "analyst_day",
    "capital_markets_day",
    "strategy_day",
    "rnd_day",
    "business_update",
    "guidance",
    "shareholder_meeting",
    "earnings",
    "dividend",
    "split",
    "other",
)

#: The subset that TradingView / yfinance never expose. This is the product.
ALPHA_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "investor_day",
        "analyst_day",
        "capital_markets_day",
        "strategy_day",
        "rnd_day",
        "business_update",
        "guidance",
    }
)

EventType = Literal[
    "investor_day",
    "analyst_day",
    "capital_markets_day",
    "strategy_day",
    "rnd_day",
    "business_update",
    "guidance",
    "shareholder_meeting",
    "earnings",
    "dividend",
    "split",
    "other",
]

EventSource = Literal["seed", "edgar", "ir", "wire", "tv"]

#: Higher wins when two sources report the same (symbol, date, type).
SOURCE_PRECEDENCE: Final[dict[str, int]] = {
    "seed": 5,   # curated by hand — most trustworthy, carries recurring cadence
    "edgar": 4,  # official filing
    "ir": 3,     # company's own events page
    "wire": 2,   # press release / RSS
    "tv": 1,     # TradingView earnings & dividends
}

# --------------------------------------------------------------------------- #
# Tripwire thresholds (pitfall: these are policy, not magic numbers sprinkled
# through anomaly.py — the UI shows them verbatim in the tooltip)
# --------------------------------------------------------------------------- #

ANOMALY_RET_SIGMA: Final[float] = 4.0     # robust sigma multiplier
ANOMALY_VOL_MULT: Final[float] = 8.0      # vs same-minute median
ANOMALY_MIN_ABS_RET: Final[float] = 1.0   # percent floor, kills noise on quiet names
ANOMALY_COOLDOWN_MIN: Final[int] = 30     # per symbol, minutes
#: 5 completed sessions. Yahoo caps 1-min history at 8 days per request, so a
#: 20-session baseline would need 3 extra chunked calls per symbol for a
#: precision gain we do not need — a robust MAD stabilises well before 5.
ANOMALY_BASELINE_SESSIONS: Final[int] = 5


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _parse_iso(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def days_until(event_date: str, today: Optional[str] = None) -> int:
    """Whole days from ``today`` (default: real today) to ``event_date``.

    Negative for past events. Never raises — a malformed date returns 0 so a
    bad row degrades to "today" instead of taking down the calendar.
    """
    try:
        target = _parse_iso(event_date)
    except (ValueError, TypeError):
        return 0
    if today is None:
        base = dt.date.today()
    else:
        try:
            base = _parse_iso(today)
        except (ValueError, TypeError):
            base = dt.date.today()
    return (target - base).days


# --------------------------------------------------------------------------- #
# Event
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class Event:
    """One corporate event on one symbol.

    ``event_date`` is when the event happens. ``announced_at`` is when it was
    announced — the gap between the two is the whole point of the feature
    (Oracle: announced Oct 23, happened Oct 28).
    """

    id: str
    symbol: str
    event_type: EventType
    title: str
    event_date: str                     # YYYY-MM-DD, the day it happens
    source: EventSource
    exchange: Optional[str] = None
    name: Optional[str] = None
    announced_at: Optional[str] = None  # YYYY-MM-DD, the day it was announced
    source_url: Optional[str] = None
    confidence: float = 0.5             # 0..1
    recurring: bool = False             # known annual cadence
    notes: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Event.id is required")
        if not self.symbol:
            raise ValueError("Event.symbol is required")
        if self.event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event_type: {self.event_type!r}")
        if self.source not in SOURCE_PRECEDENCE:
            raise ValueError(f"unknown source: {self.source!r}")
        # Normalise to bare ISO dates so dedupe and range filters are trivial.
        for field in ("event_date", "announced_at"):
            raw = getattr(self, field)
            if raw is None:
                continue
            try:
                object.__setattr__(self, field, _parse_iso(raw).isoformat())
            except (ValueError, TypeError) as exc:
                raise ValueError(f"bad {field}: {raw!r}") from exc
        object.__setattr__(self, "symbol", self.symbol.upper().strip())
        object.__setattr__(
            self, "confidence", min(1.0, max(0.0, float(self.confidence)))
        )

    # -- serialisation ----------------------------------------------------- #

    def to_dict(self, today: Optional[str] = None) -> dict:
        """Public wire shape. Mirrors ``EventDTO`` in src/types/events.ts."""
        payload = asdict(self)
        payload["days_until"] = days_until(self.event_date, today)
        payload["is_alpha"] = self.event_type in ALPHA_EVENT_TYPES
        return payload

    # -- ordering / dedupe -------------------------------------------------- #

    @property
    def dedupe_key(self) -> tuple[str, str, str]:
        return (self.symbol, self.event_date, self.event_type)

    @property
    def precedence(self) -> int:
        return SOURCE_PRECEDENCE[self.source]


# --------------------------------------------------------------------------- #
# Anomaly
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class Anomaly:
    """A statistically abnormal 1-minute move.

    ``has_known_event`` is the suppression flag: when a calendar row covers the
    symbol-day, the move is explained and must NOT raise an alert. It is still
    returned by the API so the UI can show "explained" vs "unexplained".
    """

    symbol: str
    ts: str                 # ISO-8601 with offset, the bar's close time
    price: float
    ret_pct: float          # signed percent, e.g. +9.4
    ret_sigma: float        # signed, in robust sigmas
    vol_ratio: float        # 1-min volume / same-minute 20-session median
    has_known_event: bool = False
    suspected: Optional[str] = None   # human hint, e.g. "see 14:19 wire"
    exchange: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


__all__ = [
    "ALPHA_EVENT_TYPES",
    "ANOMALY_BASELINE_SESSIONS",
    "ANOMALY_COOLDOWN_MIN",
    "ANOMALY_MIN_ABS_RET",
    "ANOMALY_RET_SIGMA",
    "ANOMALY_VOL_MULT",
    "EVENT_TYPES",
    "SOURCE_PRECEDENCE",
    "Anomaly",
    "Event",
    "EventSource",
    "EventType",
    "days_until",
]

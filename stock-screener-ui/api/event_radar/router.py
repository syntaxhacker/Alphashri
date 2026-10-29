"""HTTP surface for Event Radar: ``/api/events/*``.

Four endpoints, two shapes:

``GET /calendar`` and ``GET /today``
    the calendar. ``/today`` is not a convenience wrapper: it sorts by *event
    type priority* (an investor day outranks an ex-dividend on the same day)
    and defaults to all markets, which is what the front page wants.

``GET /anomalies`` and ``POST /refresh``
    the tripwire and the manual refresh.

Every handler is wrapped. The rule is that an unreachable upstream produces a
structured 502/503 with a stable machine-readable detail, never an unhandled
500: a scraped vendor changing its HTML must not page anyone as "the API is
broken", and the UI can branch on 503 + ``event_source_unavailable``.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections import Counter
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import config
from db.database import get_db

from .contract import (
    ANOMALY_COOLDOWN_MIN,
    ANOMALY_MIN_ABS_RET,
    ANOMALY_RET_SIGMA,
    ANOMALY_VOL_MULT,
    EVENT_TYPES,
    Event,
)
from .normalize import dedupe
from .store import list_anomalies, list_events, upsert_events

logger = logging.getLogger("event_radar.router")

router = APIRouter(prefix="/api/events", tags=["events"])

_ALLOWED_MARKETS = ("us", "india", "all")
_MAX_LIMIT = 2000
_DEFAULT_WINDOW_DAYS = 90
#: EDGAR is searched backwards from today: an 8-K filed yesterday describing an
#: investor day three weeks out is the canonical hit, so the window is about
#: announcement recency, not event date.
_EDGAR_LOOKBACK_DAYS = 7

_TYPE_PRIORITY: dict[str, int] = {name: index for index, name in enumerate(EVENT_TYPES)}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _market_tz(market: str) -> dt.tzinfo:
    """India -> ``config.IST``, everything else -> New York."""
    if (market or "").lower() == "india":
        return config.IST
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("America/New_York")
    except Exception:  # pragma: no cover - tzdata missing in a slim image
        return dt.timezone(dt.timedelta(hours=-4))


def market_today(market: str = "us") -> dt.date:
    """Today in the market's own timezone (never a naive ``date.today()``)."""
    return dt.datetime.now(_market_tz(market)).date()


def _now_iso(market: str) -> str:
    return dt.datetime.now(_market_tz(market)).isoformat(timespec="seconds")


def _csv(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def _parse_filters(
    types_raw: Optional[str], symbols_raw: Optional[str], warnings: list[str]
) -> tuple[list[str], list[str]]:
    """Split comma lists, dropping (and reporting) anything not in the taxonomy.

    The caller's *intent* is preserved: if they asked for ``types=`` and nothing
    they named exists, the handlers return nothing (rather than silently
    dropping the filter and returning the whole calendar, which looks like the
    filter did not work).
    """
    wanted_types: list[str] = []
    for value in _csv(types_raw):
        candidate = value.lower()
        if candidate in EVENT_TYPES:
            wanted_types.append(candidate)
        else:
            warnings.append(f"unknown_event_type:{value}")
    wanted_symbols = [value.upper() for value in _csv(symbols_raw)]
    return wanted_types, wanted_symbols


def _impossible_filter(types_raw: Optional[str], wanted_types: list[str]) -> bool:
    """True when the caller named event types and none of them are real."""
    return bool(_csv(types_raw)) and not wanted_types


def _market_or_400(market: str) -> str:
    value = (market or "").strip().lower()
    if value not in _ALLOWED_MARKETS:
        raise HTTPException(status_code=400, detail=f"unknown market '{market}'")
    return value


def _limit_or_400(limit: int) -> int:
    """Clamp rather than reject: a too-large limit is a UI bug, not an attack."""
    if limit is None:
        return 500
    return max(1, min(int(limit), _MAX_LIMIT))


def _shape(events: list[Event], market: str, warnings: list[str]) -> dict[str, Any]:
    """The calendar envelope shared by ``/calendar`` and ``/today``."""
    clock = market_today(market)
    today_iso = clock.isoformat()
    sources = Counter(event.source for event in events)
    return {
        "events": [event.to_dict(today_iso) for event in events],
        "meta": {
            "as_of": _now_iso(market),
            "scanned": len(events),
            "sources": dict(sources),
            "warnings": warnings,
        },
    }


# --------------------------------------------------------------------------- #
# Calendar refresh (shared with the poller)
# --------------------------------------------------------------------------- #


def _default_client() -> Any:
    """A ``requests`` session; the injected-client contract is ``get``/``post``."""
    try:
        import requests

        return requests.Session()
    except ImportError as exc:  # pragma: no cover - requests is a hard dependency
        raise RuntimeError("http_client_unavailable") from exc


def refresh_calendar(
    *,
    today: Optional[dt.date] = None,
    client: Any = None,
    tv_days_ahead: int = 120,
) -> list[Event]:
    """Fetch the calendar: EDGAR full text (last 7 days) + TradingView earnings.

    A partial failure is tolerated and logged — TradingView timing out must not
    hide an investor-day 8-K that EDGAR already returned. Only when *both*
    sources fail does this raise, and then with a message the router maps onto a
    503 rather than letting a raw vendor traceback escape.
    """
    from .sources import edgar, tradingview

    clock = today if isinstance(today, dt.date) else market_today("us")
    http = client if client is not None else _default_client()

    collected: list[Event] = []
    failures: list[str] = []

    try:
        collected.extend(
            edgar.fetch_events(
                http,
                clock - dt.timedelta(days=_EDGAR_LOOKBACK_DAYS),
                clock,
                clock,
            )
        )
    except Exception as exc:  # noqa: BLE001 - one dead source is not fatal
        failures.append(f"edgar:{exc}")
        logger.warning("event radar: EDGAR refresh failed: %s", exc)

    try:
        collected.extend(
            tradingview.fetch_events(
                http,
                market="america",
                days_ahead=tv_days_ahead,
                now=dt.datetime.now(dt.timezone.utc),
            )
        )
    except Exception as exc:  # noqa: BLE001 - one dead source is not fatal
        failures.append(f"tv:{exc}")
        logger.warning("event radar: TradingView refresh failed: %s", exc)

    if not collected and failures:
        raise RuntimeError("event_source_unavailable: " + "; ".join(failures))

    return dedupe(collected)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


@router.get("/calendar")
def get_calendar(
    market: str = Query(default="us"),
    from_date: Optional[dt.date] = Query(default=None, alias="from"),
    to: Optional[dt.date] = Query(default=None),
    types: Optional[str] = Query(default=None),
    symbols: Optional[str] = Query(default=None),
    upcoming_only: bool = Query(default=True),
    limit: int = Query(default=500),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The calendar window, defaulting to today → today + 90 days."""
    market_value = _market_or_400(market)
    warnings: list[str] = []
    wanted_types, wanted_symbols = _parse_filters(types, symbols, warnings)

    if _impossible_filter(types, wanted_types):
        return _shape([], market_value, warnings)

    start = from_date or market_today(market_value)
    end = to or (start + dt.timedelta(days=_DEFAULT_WINDOW_DAYS))

    try:
        events = list_events(
            db,
            market=market_value,
            start=start,
            end=end,
            types=wanted_types,
            symbols=wanted_symbols,
            upcoming_only=upcoming_only,
            today=market_today(market_value),
            limit=_limit_or_400(limit),
        )
    except Exception as exc:  # noqa: BLE001 - never an unhandled 500
        logger.warning("event radar: calendar read failed: %s", exc)
        raise HTTPException(status_code=503, detail="event_calendar_unavailable") from exc

    return _shape(events, market_value, warnings)


@router.get("/today")
def get_today(
    market: str = Query(default="all"),
    types: Optional[str] = Query(default=None),
    limit: int = Query(default=200),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Everything happening today, ordered by event-type priority."""
    market_value = _market_or_400(market)
    warnings: list[str] = []
    wanted_types, _ = _parse_filters(types, None, warnings)
    if _impossible_filter(types, wanted_types):
        return _shape([], market_value, warnings)
    clock = market_today(market_value)

    try:
        events = list_events(
            db,
            market=market_value,
            start=clock,
            end=clock,
            types=wanted_types,
            upcoming_only=False,
            today=clock,
            limit=_limit_or_400(limit),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("event radar: today read failed: %s", exc)
        raise HTTPException(status_code=503, detail="event_calendar_unavailable") from exc

    # A same-day list is scanned top-down, so specificity beats alphabetical.
    ordered = sorted(
        events,
        key=lambda ev: (_TYPE_PRIORITY.get(ev.event_type, len(EVENT_TYPES)), ev.symbol),
    )
    return _shape(ordered, market_value, warnings)


@router.get("/anomalies")
def get_anomalies(
    date: Optional[dt.date] = Query(default=None),
    market: str = Query(default="us"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Stored tripwire rows for one day (default: today in New York)."""
    market_value = _market_or_400(market)
    day = date or market_today(market_value)

    try:
        anomalies = list_anomalies(db, day, market_value)
    except Exception as exc:  # noqa: BLE001
        logger.warning("event radar: anomaly read failed: %s", exc)
        raise HTTPException(status_code=503, detail="event_anomalies_unavailable") from exc

    return {
        "anomalies": [anomaly.to_dict() for anomaly in anomalies],
        "meta": {
            "as_of": _now_iso(market_value),
            "date": day.isoformat(),
            "scanned": len(anomalies),
            "thresholds": {
                "ret_sigma": ANOMALY_RET_SIGMA,
                "vol_mult": ANOMALY_VOL_MULT,
                "min_abs_ret": ANOMALY_MIN_ABS_RET,
                "cooldown_min": ANOMALY_COOLDOWN_MIN,
            },
            "warnings": [],
        },
    }


@router.post("/refresh")
def post_refresh(
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Run the calendar refresh now and upsert the result.

    Returns the number of rows inserted *or materially updated* — a no-op
    refresh is ``{"inserted": 0}``, not an error.
    """
    try:
        events = refresh_calendar()
    except Exception as exc:  # noqa: BLE001
        logger.warning("event radar: refresh upstream failed: %s", exc)
        raise HTTPException(status_code=503, detail="event_source_unavailable") from exc

    try:
        inserted = upsert_events(db, events)
    except Exception as exc:  # noqa: BLE001
        logger.warning("event radar: refresh write failed: %s", exc)
        raise HTTPException(status_code=503, detail="event_store_unavailable") from exc

    return {"ok": True, "inserted": inserted}


__all__ = ["market_today", "refresh_calendar", "router"]

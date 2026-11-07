"""TradingView scanner adapter — the earnings / ex-dividend backbone.

This is the boring half of the calendar, and it is the half users open the tab
for on any given day. The public scanner (no auth) exposes
``earnings_release_next_date`` and ``dividend_ex_date_upcoming`` as **one** row
per symbol, so a single POST covers the whole US market window.

The important quirks:
  * timestamps are Unix **seconds**, not milliseconds;
  * the scanner returns ``null`` (``None``) for names with no scheduled event,
    and occasionally ``0`` — both mean "nothing", never "1970";
  * ``name`` is either ``ORCL`` or ``NASDAQ:ORCL`` depending on the market, so
    it always goes through :func:`clean_symbol`.
"""

from __future__ import annotations

import datetime as dt
import logging
import math
from typing import Any

from ..contract import Event
from ..normalize import clean_symbol, dedupe, make_event_id

logger = logging.getLogger("event_radar.tradingview")

SCANNER_URL = "https://scanner.tradingview.com/{market}/scan"
REQUEST_TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

#: Column order is the response row order — do not reorder without updating
#: :func:`_row_values` and the fixture.
COLUMNS: tuple[str, ...] = (
    "name",
    "description",
    "exchange",
    "earnings_release_next_date",
    "dividend_ex_date_upcoming",
)

EARNINGS_CONFIDENCE = 0.9
DIVIDEND_CONFIDENCE = 0.85

#: The ``america`` scanner universe is *not* "US-listed": it also returns OTC
#: and foreign cross-listings (IPOAF, SGIOF, CILJF), which have no business in
#: a US earnings calendar. Anything outside this set is dropped. ARCA/\"NYSE
#: ARCA\" are the same venue under two vendor spellings.
US_EXCHANGES: frozenset[str] = frozenset(
    {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "ARCA"}
)

#: Filtering only makes sense where the pollution exists. Other markets use
#: their own exchange codes (NSE, BSE, ...) and must pass through untouched.
_EXCHANGE_FILTERED_MARKETS: frozenset[str] = frozenset({"america"})


def _epoch_date(value: Any) -> dt.date | None:
    """Unix seconds -> UTC date. None/NaN/0/junk all mean "no event"."""
    if value is None or isinstance(value, bool):
        return None
    try:
        epoch = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(epoch) or epoch <= 0:
        return None
    try:
        return dt.datetime.fromtimestamp(epoch, tz=dt.timezone.utc).date()
    except (OverflowError, OSError, ValueError):
        return None


def _request_body(market: str, now_epoch: int, limit: int) -> dict[str, Any]:
    return {
        "markets": [market],
        "symbols": {"tickers": [], "query": {"types": []}},
        "columns": list(COLUMNS),
        "filter": [
            {
                "left": "earnings_release_next_date",
                "operation": "greater",
                "right": now_epoch,
            }
        ],
        "sort": {"sortBy": "earnings_release_next_date", "sortOrder": "asc"},
        "range": [0, limit],
        "ignore_unknown_fields": True,
    }


def _row_values(entry: Any) -> list[Any] | None:
    if isinstance(entry, dict):
        values = entry.get("d")
    elif isinstance(entry, (list, tuple)):
        values = list(entry)
    else:
        return None
    return list(values) if isinstance(values, (list, tuple)) else None


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def fetch_events(
    client: Any,
    market: str = "america",
    days_ahead: int = 120,
    limit: int = 1500,
    now: dt.datetime | None = None,
) -> list[Event]:
    """Earnings + ex-dividend events inside ``[today, today + days_ahead]``.

    The server-side filter only drops already-reported earnings; the horizon and
    the dividend window are applied here so one scan can serve several UI
    windows without a second request.
    """
    clock = now or dt.datetime.now(dt.timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=dt.timezone.utc)
    clock = clock.astimezone(dt.timezone.utc)
    today = clock.date()
    horizon = today + dt.timedelta(days=days_ahead)

    body = _request_body(market, int(clock.timestamp()), limit)
    url = SCANNER_URL.format(market=market)
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}

    try:
        response = client.post(url, json=body, headers=headers, timeout=REQUEST_TIMEOUT)
    except OSError as exc:
        raise RuntimeError(f"tv_source_unavailable: request failed ({exc})") from exc

    status = getattr(response, "status_code", 200)
    if status != 200:
        raise RuntimeError(f"tv_source_unavailable: HTTP {status} from {market} scan")

    try:
        payload = response.json()
    except (ValueError, TypeError):
        logger.warning("tv: unparseable payload from %s scan", market)
        return []

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        logger.warning("tv: no data array from %s scan", market)
        return []

    events: list[Event] = []
    for entry in data:
        values = _row_values(entry)
        if values is None or len(values) < 4:
            logger.warning("tv: skipping malformed row from %s scan", market)
            continue

        symbol = clean_symbol(_text(values[0]))
        if symbol is None:
            continue

        name = _text(values[1])
        exchange = _text(values[2])
        earnings = _epoch_date(values[3])
        dividend = _epoch_date(values[4]) if len(values) > 4 else None

        # OTC/foreign listings and rows with no exchange at all are not part of
        # a US calendar. Applying this after the column parse (not in the query)
        # keeps the single-request contract: one scan, filtered locally.
        if market in _EXCHANGE_FILTERED_MARKETS and (
            exchange is None or exchange.upper() not in US_EXCHANGES
        ):
            logger.debug(
                "tv: dropping %s (%s) from %s scan — not a US primary listing",
                symbol,
                exchange or "no exchange",
                market,
            )
            continue

        if earnings is not None and today <= earnings <= horizon:
            events.append(
                _make_event(
                    symbol=symbol,
                    name=name,
                    exchange=exchange,
                    event_type="earnings",
                    event_date=earnings,
                    title=f"{symbol} earnings",
                    confidence=EARNINGS_CONFIDENCE,
                    market=market,
                )
            )
        if dividend is not None and today <= dividend <= horizon:
            events.append(
                _make_event(
                    symbol=symbol,
                    name=name,
                    exchange=exchange,
                    event_type="dividend",
                    event_date=dividend,
                    title=f"{symbol} ex-dividend",
                    confidence=DIVIDEND_CONFIDENCE,
                    market=market,
                )
            )

    return dedupe(events)


def _make_event(
    *,
    symbol: str,
    name: str | None,
    exchange: str | None,
    event_type: str,
    event_date: dt.date,
    title: str,
    confidence: float,
    market: str,
) -> Event:
    iso = event_date.isoformat()
    return Event(
        id=make_event_id("tv", f"{symbol}-{iso}-{event_type}"),
        symbol=symbol,
        event_type=event_type,  # type: ignore[arg-type]
        title=title,
        event_date=iso,
        source="tv",
        exchange=exchange,
        name=name,
        confidence=confidence,
        notes=f"TradingView {market} scanner",
    )


__all__ = [
    "COLUMNS",
    "DIVIDEND_CONFIDENCE",
    "EARNINGS_CONFIDENCE",
    "SCANNER_URL",
    "US_EXCHANGES",
    "fetch_events",
]

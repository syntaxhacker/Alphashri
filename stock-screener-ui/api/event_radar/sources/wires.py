"""Yahoo Finance headline RSS adapter — the confirmation feed.

Wires are where the announcement actually reads like an announcement ("Oracle
to Host Investor Day on October 28, 2026"), so they carry the date the filing
excerpt often omits. They are also the noisiest source: a feed is mostly price
commentary. This module therefore keeps *only* items whose TITLE classifies to
an event type, and only when a date can be attached.

RSS and Atom disagree about element names and about where the link lives
(``<link>text`` vs ``<link href="..."/>``), so parsing is by local element name
rather than by prefix.
"""

from __future__ import annotations

import datetime as dt
import email.utils
import logging
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Sequence

from ..contract import Event
from ..keywords import match as match_keyword
from ..normalize import clean_symbol, dedupe, make_event_id, parse_date

logger = logging.getLogger("event_radar.wires")

YAHOO_RSS_URL = (
    "https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"
)

#: Politeness gap between symbols; Yahoo throttles bursts. Zeroed in tests.
WIRE_SPACING_SECONDS: float = 0.1
REQUEST_TIMEOUT = 20
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

_TITLE_KEYS = ("title",)
_LINK_KEYS = ("link",)
_PUBLISHED_KEYS = ("pubdate", "published", "updated", "date", "issued")
_SUMMARY_KEYS = ("description", "summary", "content", "encoded")


@dataclass(frozen=True, slots=True)
class WireItem:
    """One feed item, already flattened to text."""

    symbol: str
    title: str
    link: str
    published: str
    summary: str


def _local(tag: str) -> str:
    """Element local name, namespace stripped and lower-cased."""
    return str(tag).rsplit("}", 1)[-1].lower()


def _child_text(element: ET.Element, keys: Sequence[str]) -> str:
    for child in element:
        if _local(child.tag) in keys:
            text = " ".join((child.text or "").split())
            if text:
                return text
    return ""


def _child_link(element: ET.Element) -> str:
    for child in element:
        if _local(child.tag) not in _LINK_KEYS:
            continue
        href = (child.get("href") or "").strip()
        if href:
            return href
        text = (child.text or "").strip()
        if text:
            return text
    return ""


def fetch_feed(client: Any, symbol: str) -> list[WireItem]:
    """Fetch and flatten one symbol's headline feed.

    A malformed feed is logged and treated as empty: one broken XML body should
    not stop the other symbols in a batch.
    """
    ticker = symbol.strip()
    url = YAHOO_RSS_URL.format(symbol=ticker)
    response = client.get(
        url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT
    )
    status = getattr(response, "status_code", 200)
    if status != 200:
        raise RuntimeError(f"wire: HTTP {status} for {ticker}")

    raw = getattr(response, "text", "") or ""
    if not raw.strip():
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        logger.warning("wire: unparseable feed for %s: %s", ticker, exc)
        return []

    items: list[WireItem] = []
    for element in root.iter():
        if _local(element.tag) not in ("item", "entry"):
            continue
        title = _child_text(element, _TITLE_KEYS)
        if not title:
            continue
        items.append(
            WireItem(
                symbol=ticker,
                title=title,
                link=_child_link(element),
                published=_child_text(element, _PUBLISHED_KEYS),
                summary=_child_text(element, _SUMMARY_KEYS),
            )
        )
    return items


def _published_date(raw: str) -> dt.date | None:
    """RFC-822 (RSS) first, then the generic date parser as a fallback."""
    if not raw:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        parsed = None
    if parsed is not None:
        return parsed.astimezone(dt.timezone.utc).date() if parsed.tzinfo else parsed.date()
    return parse_date(raw)


def to_events(items: Sequence[WireItem], today: dt.date | None = None) -> list[Event]:
    """Keep dated, classified headlines as events.

    An undated headline has no calendar slot, so it is dropped — except when it
    literally says "today", where the feed timestamp *is* the event date. That
    single exception is what stops "Oracle hosting investor day today" from
    disappearing on the morning it matters.
    """
    events: list[Event] = []
    clock = today or dt.date.today()

    for item in items:
        event_type, phrase = match_keyword(item.title)
        if event_type is None:
            continue

        published = _published_date(item.published)
        event_date = parse_date(item.title)
        if event_date is None:
            if "today" not in item.title.lower():
                logger.debug("wire: undated event title skipped: %r", item.title)
                continue
            event_date = published or clock

        symbol = clean_symbol(item.symbol)
        if symbol is None:
            logger.warning("wire: no usable symbol on %r", item.title)
            continue

        events.append(
            Event(
                id=make_event_id("wire", f"{symbol}-{event_date.isoformat()}-{event_type}"),
                symbol=symbol,
                event_type=event_type,  # type: ignore[arg-type]
                title=item.title[:200],
                event_date=event_date.isoformat(),
                source="wire",
                announced_at=published.isoformat() if published else None,
                source_url=item.link or None,
                confidence=0.7,
                notes=f"matched: {phrase}",
            )
        )
    return events


def fetch_events(
    client: Any,
    symbols: Sequence[str],
    today: dt.date | None = None,
) -> list[Event]:
    """Sequential per-symbol fetch; one failing feed is skipped, not fatal."""
    collected: list[Event] = []
    for index, symbol in enumerate(symbols):
        if index and WIRE_SPACING_SECONDS > 0:
            time.sleep(WIRE_SPACING_SECONDS)
        try:
            items = fetch_feed(client, symbol)
        except (RuntimeError, OSError) as exc:
            logger.warning("wire: feed failed for %s: %s", symbol, exc)
            continue
        collected.extend(to_events(items, today))
    return dedupe(collected)


__all__ = [
    "WIRE_SPACING_SECONDS",
    "YAHOO_RSS_URL",
    "WireItem",
    "fetch_events",
    "fetch_feed",
    "to_events",
]

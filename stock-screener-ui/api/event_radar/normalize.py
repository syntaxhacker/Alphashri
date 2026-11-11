"""Normalisation helpers shared by every Event Radar source.

Sources disagree about almost everything — EDGAR writes symbols as
``(ORCL, ORCL-PD)``, TradingView writes ``NASDAQ:ORCL``, wires publish
``October 28, 2026 4:00 PM ET`` and filings use bare ISO. The contract
(:mod:`api.event_radar.contract`) only accepts a bare upper-case symbol and an
ISO date, so every adapter funnels through this module.

Everything here is total: malformed vendor input returns ``None`` instead of
raising. A single junk row must not take down a whole refresh.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Iterable

from .contract import Event

#: Strings vendors emit instead of a ticker. Compared lower-case, post-strip.
_JUNK_SYMBOLS: frozenset[str] = frozenset(
    {"", "-", "--", "n/a", "n.a.", "na", "none", "null", "nil", "unknown", "tbd"}
)

#: Letter-led, dot/dash separated class suffixes are legal ("BRK.B", "ORCL-PD").
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:[.\-][A-Z0-9]+)*$")

_SYMBOL_MAX_LEN = 15

#: ``(ORCL, ORCL-PD)`` / ``(CIK 0001341439)`` — display_names use both.
_PAREN_RE = re.compile(r"\(([^()]*)\)")
_CIK_RE = re.compile(r"\bCIK\s*#?\s*(\d{4,})\b", re.IGNORECASE)

#: ISO is unambiguous, so it is tried before the month-name patterns.
_ISO_DATE_RE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")

#: "October 28, 2026" / "Oct. 28 2026" / "28 October 2026" / "28th Oct, 2026".
_MONTH_DATE_RE = re.compile(
    r"""
    (?<![A-Za-z0-9])
    (?:
        (?P<month_first>[A-Za-z]{3,9})\.?\s+
        (?P<day_first>\d{1,2})(?:st|nd|rd|th)?,?\s+
        (?P<year_first>\d{4})
      |
        (?P<day_last>\d{1,2})(?:st|nd|rd|th)?\s+
        (?P<month_last>[A-Za-z]{3,9})\.?,?\s+
        (?P<year_last>\d{4})
    )
    (?![A-Za-z0-9])
    """,
    re.VERBOSE,
)

_DATE_FORMATS: tuple[str, ...] = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y%m%d",
    "%B %d, %Y",
    "%b %d, %Y",
    "%B %d %Y",
    "%b %d %Y",
    "%d %B %Y",
    "%d %b %Y",
    "%d %B, %Y",
    "%d %b, %Y",
    "%m/%d/%Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
)

#: "28th" -> "28": strptime has no ordinal directive.
_ORDINAL_RE = re.compile(r"(?<=\d)(?:st|nd|rd|th)\b", re.IGNORECASE)

#: "Oct. 28" -> "Oct 28": the dot is a typographic habit, not information.
_ABBREV_DOT_RE = re.compile(r"(?<=[A-Za-z])\.(?=\s)")


# --------------------------------------------------------------------------- #
# Symbols
# --------------------------------------------------------------------------- #


def clean_symbol(raw: str | None) -> str | None:
    """Reduce any vendor symbol spelling to a bare upper-case ticker.

    Keeps class suffixes (``BRK.B``) because dropping them would silently merge
    two different securities. Drops exchange prefixes and the trailing
    preferred-share leg of EDGAR's ``ORCL, ORCL-PD`` list — the common stock is
    the tradable line and the one every other source reports.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    # "ORCL, ORCL-PD" -> "ORCL" (first listed = the primary line)
    text = text.split(",")[0].strip()
    # "NASDAQ:ORCL" -> "ORCL"; rsplit keeps a hypothetical "A:B:C" sane
    if ":" in text:
        text = text.rsplit(":", 1)[1].strip()
    text = text.strip(" \t\r\n\"'")
    if text.lower() in _JUNK_SYMBOLS:
        return None
    symbol = text.upper().strip(" .")
    if not symbol or len(symbol) > _SYMBOL_MAX_LEN:
        return None
    if symbol.lower() in _JUNK_SYMBOLS:
        return None
    if not _SYMBOL_RE.match(symbol):
        return None
    return symbol


def parse_display_name(raw: str) -> tuple[str | None, list[str], str | None]:
    """Split EDGAR's ``NAME  (SYM1, SYM2)  (CIK 0001341439)`` triple.

    EDGAR puts the CIK in its own parenthesised group *after* the tickers, but
    the order is not guaranteed and either group may be missing, so the parser
    reads groups by content rather than by position.
    """
    if not isinstance(raw, str):
        return (None, [], None)
    text = " ".join(raw.split())
    if not text:
        return (None, [], None)

    cik: str | None = None
    cik_match = _CIK_RE.search(text)
    if cik_match:
        cik = cik_match.group(1)

    symbols: list[str] = []
    for group in _PAREN_RE.findall(text):
        if _CIK_RE.search(group) or "CIK" in group.upper():
            continue
        for part in group.split(","):
            symbol = clean_symbol(part)
            if symbol and symbol not in symbols:
                symbols.append(symbol)

    head = text.split("(", 1)[0].strip(" ,;-")
    name = head or None
    return (name, symbols, cik)


# --------------------------------------------------------------------------- #
# Dates
# --------------------------------------------------------------------------- #


def _parse_candidate(token: str) -> dt.date | None:
    cleaned = _ORDINAL_RE.sub("", token.strip(" .,;:"))
    cleaned = _ABBREV_DOT_RE.sub("", cleaned)
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(cleaned, fmt).date()
        except (ValueError, TypeError):
            continue
    return None


def parse_date(raw: str | None) -> dt.date | None:
    """First calendar date found in ``raw``, or ``None``.

    Free-text excerpts are the norm ("Investor Day on October 28, 2026 at 9:00
    a.m. ET"), so the whole string is tried first and then date-shaped
    substrings are scanned left to right. Ambiguous slash dates follow the
    vendor convention of US month-first.
    """
    if not isinstance(raw, str):
        return None
    text = " ".join(raw.split())
    if not text:
        return None

    direct = _parse_candidate(text)
    if direct is not None:
        return direct

    iso = _ISO_DATE_RE.search(text)
    if iso is not None:
        parsed = _parse_candidate(iso.group(0))
        if parsed is not None:
            return parsed

    for found in _MONTH_DATE_RE.finditer(text):
        parsed = _parse_candidate(found.group(0))
        if parsed is not None:
            return parsed
    return None


# --------------------------------------------------------------------------- #
# Identity / filtering
# --------------------------------------------------------------------------- #


def make_event_id(source: str, key: str) -> str:
    """Stable ``source:slug`` id.

    Slugging the key (instead of hashing) means a duplicate row is obvious in a
    log or a failing test, and re-running a source produces the same id.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", str(key).lower()).strip("-")
    return f"{source}:{slug}"


def dedupe(events: Iterable[Event]) -> list[Event]:
    """Collapse events sharing ``dedupe_key``, keeping the most trustworthy.

    Precedence wins because the same investor day is announced by a hand-curated
    seed, an 8-K and TradingView's earnings feed; the seed text is the one worth
    showing. On equal precedence the longer title wins — the source that
    actually says *what* the event is beats "ORCL earnings".
    """
    best: dict[tuple[str, str, str], Event] = {}
    for event in events:
        current = best.get(event.dedupe_key)
        if current is None:
            best[event.dedupe_key] = event
            continue
        if event.precedence > current.precedence or (
            event.precedence == current.precedence
            and len(event.title) > len(current.title)
        ):
            best[event.dedupe_key] = event
    return sorted(
        best.values(),
        key=lambda ev: (ev.event_date, -ev.precedence, ev.symbol),
    )


def in_range(ev: Event, start: dt.date, end: dt.date) -> bool:
    """Whether ``ev`` lands in the inclusive ``[start, end]`` window.

    The contract guarantees ``event_date`` is ISO, but a hand-built Event in a
    test may not be — a bad date is out of range rather than an exception.
    """
    try:
        event_date = dt.date.fromisoformat(str(ev.event_date))
    except (ValueError, TypeError):
        return False
    return start <= event_date <= end


__all__ = [
    "clean_symbol",
    "dedupe",
    "in_range",
    "make_event_id",
    "parse_date",
    "parse_display_name",
]

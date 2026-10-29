"""EDGAR full-text search adapter — the alpha feed.

TradingView knows earnings dates; nobody exposes "Oracle is hosting an Investor
Day on Oct 28" except the 8-K/6-K the company furnishes about it. EDGAR's
full-text search (EFTS) indexes the *body* of every filing, so a phrase query
like ``"investor day"`` finds exactly the announcements this feature exists for.

SEC access rules that shape this module:
  * a descriptive ``User-Agent`` with a contact address is mandatory, and a
    generic one gets throttled/blocked;
  * no more than 10 requests/second, so search calls and document fetches are
    both spaced by module constants (:data:`REQUEST_SPACING_SECONDS`,
    :data:`DOCUMENT_SPACING_SECONDS`) that tests zero out.

Why the queries are *scheduled-event* phrases only
--------------------------------------------------
``_source.file_description`` is an exhibit label (``"EX-99.1"``), not a
headline, and every earnings release carries forward-looking-statement
boilerplate that mentions "guidance" or a "business update". Those matches are
news, not calendar entries — the tripwire headlines already cover them — and
dating them off the filing date made the same row reappear as "today" on every
single refresh (89 of 153 rows in one measured 7-day window). ``QUERIES``
therefore contains only phrases that name an event that *happens on a date*.

8-K items
---------
An earnings release is furnished under Item 2.02; a scheduled-event
announcement is Item 7.01 (Reg FD) or 8.01 (other events). EFTS returns the
item list in ``_source.items``, so 2.02-only hits are dropped before any
document is downloaded. 6-Ks often carry no items at all, and those are kept.

Event-date policy
-----------------
* a date parsed out of the filing text -> ``confidence 0.8`` and notes
  ``"SEC {form} · announced {filed}"``;
* no date found (or the document could not be read) -> ``event_date`` becomes
  the filing date, ``confidence 0.4`` and the notes say
  ``"filed-date fallback — verify"``. The row is still emitted — a deck
  furnished the morning of a same-day event is real — but the low confidence is
  the signal the UI flags for a human check.

Response shape (``hits.hits[]._source``) is deliberately parsed defensively:
SEC has changed field names before, and a silent skip is always better than a
500 on the calendar.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import re
import time
from dataclasses import dataclass
from html import unescape
from typing import Any, Iterator, Sequence
from urllib.parse import urlencode

from ..contract import Event, EventType
from ..normalize import (
    clean_symbol,
    dedupe,
    make_event_id,
    parse_date,
    parse_display_name,
)

logger = logging.getLogger("event_radar.edgar")

EDGAR_FTS_URL = "https://efts.sec.gov/LATEST/search-index"
EDGAR_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{adsh}/{doc}"

#: SEC asks for <= 10 req/s and bans clients that hammer the index.
REQUEST_SPACING_SECONDS: float = 0.15
#: Same rule for the Archives host: every candidate costs one document GET.
DOCUMENT_SPACING_SECONDS: float = 0.15
REQUEST_TIMEOUT = 30

#: Hard ceiling on document downloads per refresh. A busy earnings day can
#: match hundreds of filings; without a cap a refresh degrades into ten minutes
#: of exhibit fetching. Candidates past the cap still become events, and they
#: take the low-confidence filed-date fallback.
MAX_ENRICH_PER_RUN: int = 40

#: Exhibit bodies are frequently multi-MB XBRL-laden HTML; only the prose near
#: the matched phrase matters, so the download is truncated.
MAX_DOCUMENT_BYTES: int = 2_000_000

#: Contact address embedded in the UA. SEC blocks generic agents in practice.
_CONTACT_ENV = "EVENT_RADAR_CONTACT"
_DEFAULT_CONTACT = "contact@example.com"

#: (event_type, EFTS phrase query). Phrases are quoted so EFTS treats them as a
#: phrase rather than an OR of words.
#:
#: "guidance" and "business update" are deliberately absent: every earnings
#: release says something like "we are updating our guidance", so those queries
#: matched the boilerplate of ordinary results decks (Item 2.02). They describe
#: news, not a scheduled event, and they carry no future date — which is the
#: only thing this adapter is for. The tripwire covers that news flow.
#:
#: "annual meeting of stockholders" is absent for a measured reason too: of 48
#: hits in one 7-day window, almost none were the meeting date. The phrase sits
#: in bylaw amendments and director-departure paragraphs, so the date parser
#: picked up "advised the Board on October 20, 2026 of his decision not to stand
#: for re-election" as an AGM. Proxy season noise, no tradable edge.
QUERIES: tuple[tuple[EventType, str], ...] = (
    ("investor_day", '"investor day"'),
    ("analyst_day", '"analyst day"'),
    ("capital_markets_day", '"capital markets day"'),
    ("strategy_day", '"strategy day"'),
    ("rnd_day", '"r&d day"'),
)

#: Phrases used to locate the sentence that dates an event, when the caller did
#: not pass the query it searched with. Mirrors :data:`QUERIES`.
_PHRASE_BY_EVENT_TYPE: dict[str, str] = {
    "investor_day": "investor day",
    "analyst_day": "analyst day",
    "capital_markets_day": "capital markets day",
    "strategy_day": "strategy day",
    "rnd_day": "r&d day",
    "shareholder_meeting": "annual meeting of stockholders",
}

#: Human labels used when the filing text yields no usable headline. A bare
#: exhibit label ("EX-99.1") is a document part, not a description of an event.
_HUMAN_LABELS: dict[str, str] = {
    "investor_day": "Investor Day",
    "analyst_day": "Analyst Day",
    "capital_markets_day": "Capital Markets Day",
    "strategy_day": "Strategy Day",
    "rnd_day": "R&D Day",
    "shareholder_meeting": "Shareholder Meeting",
}

#: 8-K items that actually announce something scheduled. 2.02 is an earnings
#: release (news), 9.01 is the exhibit list (bookkeeping), 5.07 is a vote tally.
_EVENT_ITEMS: frozenset[str] = frozenset({"7.01", "8.01"})

#: A parsed date is only credible if it sits near the filing: at most two weeks
#: before it (a same-week deck) and no more than ~13 months after it (the
#: annual cadence).
_DATE_WINDOW_BACK_DAYS = 14
_DATE_WINDOW_FORWARD_DAYS = 400

#: Characters inspected either side of the matched phrase when hunting for the
#: sentence that dates the event.
_SENTENCE_WINDOW = 400
_HEADLINE_MAX_CHARS = 160

DOCUMENT_DATE_CONFIDENCE = 0.8
FILED_DATE_CONFIDENCE = 0.4
#: Legacy (non-enriched) confidences, kept so ``client=None`` callers keep the
#: exact snippets-only behaviour they had before document enrichment existed.
SNIPPET_DATE_CONFIDENCE = 0.6
SNIPPET_FALLBACK_CONFIDENCE = 0.45

_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_MONTH_ALT = "|".join(_MONTH_NAMES)

#: "December 9, 2026" and "9 December 2026" are the two spellings EDGAR prose
#: actually uses. Numeric slugs are ambiguous across markets, so they are not
#: accepted here (``parse_date`` still handles them for vendor snippets).
_DATE_MONTH_FIRST_RE = re.compile(
    rf"\b(?:{_MONTH_ALT})\s+\d{{1,2}},\s*\d{{4}}\b", re.IGNORECASE
)
_DATE_DAY_FIRST_RE = re.compile(
    rf"\b\d{{1,2}}\s+(?:{_MONTH_ALT})\s+\d{{4}}\b", re.IGNORECASE
)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

#: Document-part labels that must never be shown as a headline. Matches
#: "EX-99.1", "EXHIBIT 99.1", "6-K", "8-K", "PRESS RELEASE", "99.1".
_EXHIBIT_LABEL_RE = re.compile(
    r"^(?:"
    r"ex(?:hibit)?[\s\-_.]*\d+(?:[.\-]\d+)?"
    r"|press\s+release"
    r"|news\s+release"
    r"|[68]-k"
    r"|99(?:[.\-]\d+)?"
    r")$",
    re.IGNORECASE,
)

_SCRIPT_STYLE_RE = re.compile(r"(?is)<(script|style)\b[^>]*>.*?</\1>")
_TAG_RE = re.compile(r"(?s)<[^>]+>")

_last_request_at: float = 0.0
_last_document_at: float = 0.0


def _user_agent() -> str:
    """Descriptive UA required by SEC's fair-access policy."""
    contact = os.environ.get(_CONTACT_ENV, "").strip() or _DEFAULT_CONTACT
    return f"alphashri-event-radar {contact}"


def _throttle() -> None:
    """Keep the gap between EDGAR calls at/above the documented rate limit."""
    global _last_request_at
    spacing = REQUEST_SPACING_SECONDS
    if spacing <= 0:
        return
    now = time.monotonic()
    wait = spacing - (now - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def _document_throttle() -> None:
    """Same spacing rule for Archives document downloads.

    Separate clock from :func:`_throttle` so an FTS call does not reset the
    document gap (they hit the same host but different endpoints, and the
    per-document budget makes the two streams independent in practice).
    """
    global _last_document_at
    spacing = DOCUMENT_SPACING_SECONDS
    if spacing <= 0:
        return
    now = time.monotonic()
    wait = spacing - (now - _last_document_at)
    if wait > 0:
        time.sleep(wait)
    _last_document_at = time.monotonic()


@dataclass(frozen=True, slots=True)
class EdgarHit:
    """One EFTS hit, flattened to what an Event needs."""

    symbol: str | None
    name: str | None
    cik: str | None
    form: str
    filed: str
    url: str
    snippet: str
    #: 8-K item numbers from ``_source.items`` (empty for most 6-Ks).
    items: tuple[str, ...] = ()


@dataclass(slots=True)
class _DocumentBudget:
    """Documents one refresh is still allowed to download.

    Shared by every query in a :func:`fetch_events` run so the cap is per
    refresh, not per phrase (the same exhibit often matches two phrases).
    ``remaining`` defaults through ``__post_init__`` rather than a literal
    default so a test can monkeypatch :data:`MAX_ENRICH_PER_RUN` and see the
    effect.
    """

    remaining: int | None = None

    def __post_init__(self) -> None:
        if self.remaining is None:
            self.remaining = MAX_ENRICH_PER_RUN

    def spend(self) -> bool:
        if not self.remaining or self.remaining <= 0:
            return False
        self.remaining -= 1
        return True


def _json_payload(response: Any, query: str) -> dict[str, Any]:
    status = getattr(response, "status_code", 200)
    if status != 200:
        raise RuntimeError(f"edgar: HTTP {status} for query {query!r}")
    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f"edgar: unparseable response for {query!r}") from exc
    return payload if isinstance(payload, dict) else {}


def _build_url(cik: str, adsh: str, doc: str) -> str | None:
    try:
        cik_int = int(cik)
    except (TypeError, ValueError):
        return None
    if not adsh or not doc:
        return None
    return EDGAR_ARCHIVES_URL.format(
        cik=cik_int, adsh=adsh.replace("-", ""), doc=doc
    )


def _items_from_source(source: dict[str, Any]) -> tuple[str, ...]:
    """``_source.items`` as a tuple of strings.

    EFTS returns a list today, but a comma-separated string has appeared for
    some form types, and shape drift must not drop a whole filing.
    """
    raw = source.get("items")
    if isinstance(raw, (list, tuple)):
        return tuple(str(item).strip() for item in raw if str(item).strip())
    if isinstance(raw, str):
        return tuple(part.strip() for part in raw.split(",") if part.strip())
    return ()


def passes_item_filter(items: Sequence[str]) -> bool:
    """Whether an 8-K/6-K hit can describe a scheduled event.

    Kept: no items at all (normal for a 6-K) or an Item 7.01/8.01 match.
    Dropped: an earnings release (Item 2.02) and everything else — 9.01 alone
    is an exhibit list with no event content, 5.07 is a vote tally.
    """
    if not items:
        return True
    return any(str(item).strip() in _EVENT_ITEMS for item in items)


def _hit_from_source(source: dict[str, Any], hit_id: str) -> EdgarHit | None:
    """Map one ``_source`` block to an :class:`EdgarHit`.

    Returns ``None`` when the row cannot be turned into a usable link or a
    symbol — those are logged and skipped by the caller.
    """
    ciks = source.get("ciks") or []
    cik = str(ciks[0]).strip() if ciks else None
    if not cik or not hit_id:
        return None

    display_names = source.get("display_names") or []
    display = str(display_names[0]) if display_names else ""
    name, symbols, _cik_from_name = parse_display_name(display)
    symbol = symbols[0] if symbols else None

    adsh = str(source.get("adsh") or hit_id.split(":", 1)[0]).strip()
    doc = hit_id.split(":", 1)[1].strip() if ":" in hit_id else ""
    url = _build_url(cik, adsh, doc)
    if url is None:
        return None

    snippet = str(
        source.get("snippet") or source.get("file_description") or ""
    ).strip()

    return EdgarHit(
        symbol=symbol,
        name=name,
        cik=cik,
        form=str(source.get("form") or "").strip(),
        filed=str(source.get("file_date") or "").strip(),
        url=url,
        snippet=snippet,
        items=_items_from_source(source),
    )


def search(
    client: Any,
    query: str,
    start: dt.date,
    end: dt.date,
    forms: Sequence[str] = ("8-K", "6-K"),
    limit: int = 100,
) -> list[EdgarHit]:
    """Run one EFTS phrase query over ``[start, end]`` for the given form types.

    Parameters travel in the query string (not ``params=``) so an injected
    client only needs ``get(url, headers=..., timeout=...)``.

    Hits that are unmistakably earnings releases (Item 2.02 and nothing else)
    are dropped here rather than in :func:`to_events`: every surviving hit
    costs one document download, so the cheap filter must run first.
    """
    params = {
        "q": query,
        "forms": ",".join(forms),
        "dateRange": "custom",
        "startdt": start.isoformat(),
        "enddt": end.isoformat(),
        "from": 0,
        "size": limit,
    }
    url = f"{EDGAR_FTS_URL}?{urlencode(params)}"
    headers = {"User-Agent": _user_agent(), "Accept": "application/json"}

    _throttle()
    response = client.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
    payload = _json_payload(response, query)

    hits_block = payload.get("hits")
    raw_hits = hits_block.get("hits") if isinstance(hits_block, dict) else None
    if not isinstance(raw_hits, list):
        logger.warning("edgar: no hits array for query %r", query)
        return []

    results: list[EdgarHit] = []
    for raw in raw_hits:
        if not isinstance(raw, dict):
            logger.warning("edgar: skipping non-dict hit for query %r", query)
            continue
        source = raw.get("_source")
        if not isinstance(source, dict):
            logger.warning("edgar: skipping hit without _source for %r", query)
            continue
        hit_id = str(raw.get("_id") or source.get("_id") or "").strip()
        parsed = _hit_from_source(source, hit_id)
        if parsed is None:
            logger.warning(
                "edgar: skipping unusable hit %r for query %r", hit_id, query
            )
            continue
        if not passes_item_filter(parsed.items):
            logger.debug(
                "edgar: dropping earnings-only hit %s (items=%s)",
                hit_id,
                ",".join(parsed.items) or "-",
            )
            continue
        results.append(parsed)
    return results


def _html_to_text(markup: str) -> str:
    """Crude but total HTML -> prose. Exhibit markup is never well-formed."""
    text = _SCRIPT_STYLE_RE.sub(" ", markup)
    text = _TAG_RE.sub(" ", text)
    return " ".join(unescape(text).split())


def fetch_document_text(client: Any, url: str, max_bytes: int = MAX_DOCUMENT_BYTES) -> str:
    """Download one Archives document and return its visible text.

    Never raises: a dead exhibit only costs that candidate its high-confidence
    date (it degrades to the filed-date fallback), and a calendar must not be
    blanked because one PDF-ish attachment 404s.
    """
    if not url:
        return ""
    headers = {
        "User-Agent": _user_agent(),
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    }
    try:
        _document_throttle()
        response = client.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - one bad document is not fatal
        logger.warning("edgar: document fetch failed for %s: %s", url, exc)
        return ""

    status = getattr(response, "status_code", 200)
    if status != 200:
        logger.warning("edgar: HTTP %s fetching %s", status, url)
        return ""

    payload: bytes | None = None
    try:
        raw = getattr(response, "content", None)
        if isinstance(raw, (bytes, bytearray)):
            payload = bytes(raw)
        else:
            text = getattr(response, "text", "")
            payload = str(text or "").encode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001 - encoding drift on vendor HTML
        logger.warning("edgar: unreadable body for %s: %s", url, exc)
        return ""

    # Truncating *before* decoding keeps a 40 MB inline-XBRL monster cheap.
    decoded = payload[: max(0, int(max_bytes))].decode("utf-8", errors="replace")
    return _html_to_text(decoded)[: max(0, int(max_bytes))]


def _phrase_sentences(text: str, phrase: str) -> Iterator[str]:
    """Yield the sentences that contain ``phrase`` (case-insensitive).

    Each occurrence is examined inside a +/- :data:`_SENTENCE_WINDOW` character
    window: filings are one long blob of prose with no reliable line structure,
    so "the sentence around the match" is the most context we can trust.
    """
    needle = " ".join(str(phrase or "").split()).strip().strip('"').strip("'").strip().lower()
    if not needle:
        return
    lowered = text.lower()
    seen: set[str] = set()
    cursor = 0
    while True:
        position = lowered.find(needle, cursor)
        if position < 0:
            return
        cursor = position + len(needle)
        window_start = max(0, position - _SENTENCE_WINDOW)
        window_end = min(len(text), position + len(needle) + _SENTENCE_WINDOW)
        for chunk in _SENTENCE_SPLIT_RE.split(text[window_start:window_end]):
            if needle not in chunk.lower():
                continue
            sentence = " ".join(chunk.split()).strip()
            if sentence and sentence not in seen:
                seen.add(sentence)
                yield sentence


def _first_date_in(sentence: str) -> dt.date | None:
    """The earliest date-shaped match in ``sentence`` (month names only)."""
    matches = [
        match
        for match in (
            _DATE_MONTH_FIRST_RE.search(sentence),
            _DATE_DAY_FIRST_RE.search(sentence),
        )
        if match is not None
    ]
    if not matches:
        return None
    first = min(matches, key=lambda match: match.start())
    return parse_date(first.group(0))


def extract_event_date(
    text: str, filed: dt.date, matched_phrase: str
) -> tuple[dt.date | None, str | None]:
    """Find the date the filing *announces*, plus the sentence that says it.

    The snippet EFTS returns is usually an exhibit label and the filing date is
    never the event date, so the announcement has to be read out of the prose:
    look for the phrase that was searched, keep the sentence around it, and
    take the first real date in that sentence.

    A date outside ``[filed - 14d, filed + 400d]`` is rejected — it is last
    year's event or a stale reference, not the announcement — and the search
    moves to the next matching sentence. When nothing survives, the caller
    falls back to the filing date at low confidence.
    """
    if not isinstance(text, str) or not text or not matched_phrase:
        return (None, None)

    earliest = filed - dt.timedelta(days=_DATE_WINDOW_BACK_DAYS)
    latest = filed + dt.timedelta(days=_DATE_WINDOW_FORWARD_DAYS)

    for sentence in _phrase_sentences(text, matched_phrase):
        parsed = _first_date_in(sentence)
        if parsed is None:
            continue
        if not earliest <= parsed <= latest:
            logger.debug(
                "edgar: ignoring out-of-window date %s in %r", parsed, sentence[:80]
            )
            continue
        return (parsed, sentence[:_HEADLINE_MAX_CHARS].strip())
    return (None, None)


def is_exhibit_label(value: str | None) -> bool:
    """Whether ``value`` is a document part ("EX-99.1") rather than a headline."""
    text = " ".join(str(value or "").split()).strip(" .,:;-–—()[]")
    if not text:
        return True
    return bool(_EXHIBIT_LABEL_RE.match(text))


#: 8-K bodies open with the item caption before any prose
#: ("Section 7—Regulation FD Item 7.01 Regulation FD Disclosure On October 28,
#: 2026, ..."). Taken as the title it reads like a form number, so the caption is
#: peeled off first. Both the section caption and the item caption may appear,
#: in that order, and the loop in :func:`strip_filing_boilerplate` removes them
#: one at a time so a filing that repeats a caption still gets cleaned.
_ITEM_TITLE = (
    r"(?:regulation\s+fd(?:\s+disclosure)?|other\s+events|"
    r"financial\s+statements\s+and\s+exhibits|"
    r"results\s+of\s+operations(?:\s+and\s+financial\s+condition)?|"
    r"completion\s+of\s+acquisition\s+or\s+disposition\s+of\s+assets|"
    r"departure\s+of\s+directors\s+or\s+certain\s+officers|"
    r"amendments\s+to\s+articles\s+of\s+incorporation\s+or\s+bylaws|"
    r"material\s+impairments)"
)

_BOILERPLATE_PREFIX = re.compile(
    r"^\s*(?:[\u2610\u2611\u25a1\u25a0]\s*)?"
    rf"(?:(?:section\s+\d+\s*[\u2014\u2013-]\s*)?{_ITEM_TITLE}\s*)?"
    rf"(?:(?:item\s+\d+\.\d+\s*)?{_ITEM_TITLE}\s*[\u2014\u2013:\-]?\s*)?",
    re.IGNORECASE,
)

#: Exhibit captions and machine filenames lead the text of an EX-99.1 document
#: ("EX-99.1 2 dp255384_ex9901.htm EXHIBIT 99.1 Auna Announces ..."). They are
#: document plumbing, never a headline.
_EXHIBIT_NOISE = re.compile(
    r"^\s*(?:ex(?:hibit)?[-\s]?\d+(?:\.\d+)?\b\s*\d*\s*)+"
    r"|^\s*(?:\d+\s+)?\S+\.(?:htm|html|txt)\b\s*",
    re.IGNORECASE,
)


def strip_filing_boilerplate(value: str | None) -> str:
    """Drop the item caption and exhibit plumbing so a title starts at prose."""
    text = " ".join(str(value or "").split()).strip()
    for _ in range(6):
        stripped = _BOILERPLATE_PREFIX.sub("", text, count=1)
        stripped = _EXHIBIT_NOISE.sub("", stripped, count=1)
        if stripped == text:
            break
        text = stripped.strip()
    return text


def extract_title(
    text: str, name: str | None, event_type: str, headline: str | None
) -> str:
    """A human-readable title, never a document label.

    ``text`` is accepted so this stays the single place a smarter headline
    extractor can live; today the headline comes from the sentence that dates
    the event, which is already the most informative line in the filing.

    When there is no usable sentence the title becomes
    ``"{company} — {human label}"``. A bare exhibit label ("EX-99.1", "8-K",
    "PRESS RELEASE") is explicitly rejected: it describes a document part, says
    nothing about the event, and was the measured failure mode.
    """
    del text  # headline already carries the prose this function needs
    candidate = strip_filing_boilerplate(headline)
    if candidate and not is_exhibit_label(candidate):
        return candidate[:_HEADLINE_MAX_CHARS]

    label = _HUMAN_LABELS.get(event_type, "Event")
    who = " ".join(str(name or "").split()).strip()
    return f"{who} — {label}"[:_HEADLINE_MAX_CHARS] if who else label[:_HEADLINE_MAX_CHARS]


def _phrase_for(event_type: str, phrase: str | None) -> str:
    if phrase:
        return str(phrase).strip().strip('"').strip("'").strip()
    return _PHRASE_BY_EVENT_TYPE.get(event_type, "")


def _build_event(
    *,
    hit: EdgarHit,
    symbol: str,
    event_type: EventType,
    event_date: dt.date,
    announced: dt.date | None,
    title: str,
    confidence: float,
    notes: str,
) -> Event:
    return Event(
        id=make_event_id("edgar", f"{symbol}-{event_date.isoformat()}-{event_type}"),
        symbol=symbol,
        event_type=event_type,
        title=title,
        event_date=event_date.isoformat(),
        source="edgar",
        name=hit.name,
        announced_at=announced.isoformat() if announced else None,
        source_url=hit.url,
        confidence=confidence,
        notes=notes,
    )


def to_events(
    hits: Sequence[EdgarHit],
    event_type: EventType,
    today: dt.date | None = None,
    client: Any = None,
    *,
    phrase: str | None = None,
    budget: _DocumentBudget | None = None,
) -> list[Event]:
    """Turn hits into events, dating them from the filing text.

    With ``client`` the adapter downloads each filing and reads the announced
    date out of the prose — that is the whole fix: the filing date is *not* the
    event date for an investor day announced weeks ahead. The resulting row is
    high confidence and titled with the announcing sentence.

    Without ``client`` (``None``, the default) nothing is downloaded and the
    pre-enrichment behaviour is preserved exactly: the date comes from the
    snippet, then from the filing date, at 0.6/0.45 confidence. That keeps
    offline callers and existing tests working.

    ``today`` exists because every adapter shares one signature; EDGAR needs no
    clock, since each filing carries its own date.
    """
    del today  # signature parity only — see docstring

    matched_phrase = _phrase_for(event_type, phrase)
    document_budget = budget if budget is not None else _DocumentBudget()

    events: list[Event] = []
    for hit in hits:
        symbol = clean_symbol(hit.symbol)
        if symbol is None:
            logger.warning("edgar: no usable symbol on %s", hit.url)
            continue

        # Defensive: ``search`` already drops these, but a hand-built hit (or a
        # future caller) must not smuggle an earnings release into the calendar.
        if not passes_item_filter(hit.items or ()):
            logger.debug("edgar: dropping earnings-only hit %s", hit.url)
            continue

        filed = parse_date(hit.filed)

        if client is not None:
            if filed is None:
                logger.warning("edgar: no filing date on %s", hit.url)
                continue

            text = ""
            if matched_phrase and document_budget.spend():
                text = fetch_document_text(client, hit.url)

            stated, headline = (
                extract_event_date(text, filed, matched_phrase)
                if text and matched_phrase
                else (None, None)
            )
            title = extract_title(text, hit.name, event_type, headline)
            form = hit.form or "filing"

            if stated is not None:
                events.append(
                    _build_event(
                        hit=hit,
                        symbol=symbol,
                        event_type=event_type,
                        event_date=stated,
                        announced=filed,
                        title=title,
                        confidence=DOCUMENT_DATE_CONFIDENCE,
                        notes=f"SEC {form} · announced {filed.isoformat()}",
                    )
                )
            else:
                # No announced date (or no document): emit it anyway — a deck
                # furnished the morning of a same-day event is real — but the
                # confidence and the note tell the UI to flag it for a human.
                events.append(
                    _build_event(
                        hit=hit,
                        symbol=symbol,
                        event_type=event_type,
                        event_date=filed,
                        announced=filed,
                        title=title,
                        confidence=FILED_DATE_CONFIDENCE,
                        notes=f"SEC {form} · filed-date fallback — verify",
                    )
                )
            continue

        # ---- legacy, snippet-only path (client=None) ---------------------- #
        stated = parse_date(hit.snippet)
        event_date = stated or filed
        if event_date is None:
            logger.warning("edgar: no usable date on %s", hit.url)
            continue

        title = hit.snippet.strip()[:160] or f"{hit.name or symbol} {event_type}"
        notes = f"SEC {hit.form}" if hit.form else "SEC filing"
        if hit.cik:
            notes = f"{notes} · CIK {hit.cik}"

        events.append(
            _build_event(
                hit=hit,
                symbol=symbol,
                event_type=event_type,
                event_date=event_date,
                announced=filed,
                title=title,
                confidence=SNIPPET_DATE_CONFIDENCE if stated else SNIPPET_FALLBACK_CONFIDENCE,
                notes=notes,
            )
        )
    return events


def fetch_events(
    client: Any,
    start: dt.date,
    end: dt.date,
    today: dt.date | None = None,
) -> list[Event]:
    """Every keyword query for the window, deduped into one list.

    One shared :class:`_DocumentBudget` caps the whole run so six phrases
    cannot each spend 40 downloads.
    """
    collected: list[Event] = []
    budget = _DocumentBudget()
    for event_type, query in QUERIES:
        try:
            hits = search(client, query, start, end)
        except RuntimeError as exc:
            # One dead query must not blank the whole calendar; the other
            # phrases still describe real events.
            logger.warning("edgar: query %r failed: %s", query, exc)
            continue
        collected.extend(
            to_events(
                hits,
                event_type,
                today,
                client=client,
                phrase=query,
                budget=budget,
            )
        )
    return dedupe(collected)


__all__ = [
    "DOCUMENT_DATE_CONFIDENCE",
    "DOCUMENT_SPACING_SECONDS",
    "EDGAR_FTS_URL",
    "FILED_DATE_CONFIDENCE",
    "MAX_DOCUMENT_BYTES",
    "MAX_ENRICH_PER_RUN",
    "QUERIES",
    "REQUEST_SPACING_SECONDS",
    "EdgarHit",
    "extract_event_date",
    "extract_title",
    "fetch_document_text",
    "fetch_events",
    "is_exhibit_label",
    "passes_item_filter",
    "search",
    "to_events",
]

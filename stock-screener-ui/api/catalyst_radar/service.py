"""Assembly for ``GET /api/catalysts/today``.

Two real sources, one derivation:

* the existing market snapshot (``api.market_screen.snapshot.build_snapshot``)
  supplies the selected sector's constituents, live move, relative volume and
  the 52-week position -- no second TradingView scan;
* Google News RSS supplies the headline.

Price/volume/breadth rows are allowed only as ``kind="positioning"`` and their
``reasons`` say the trigger is the sector move alone. A dead source becomes a
warning, never an exception: the endpoint always answers with whatever it can
verify.
"""

from __future__ import annotations

import asyncio
import email.utils
import logging
import math
import re
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote_plus

import requests

from api.market_screen.snapshot import MAX_LIMIT, build_snapshot
from api.tv import scan_frame
from config import IST

from .contract import (
    BREAKING_MAX_AGE_HOURS,
    BREADTH_CONFIRM_RATIO,
    DEFAULT_SECTOR,
    MARKET_LABEL,
    MARKET_SECTOR,
    MOVE_CONFIRM_PCT,
    VOLUME_CONFIRM_REL,
    CatalystCounts,
    CatalystRow,
    CatalystToday,
    Constituent,
    IndexQuote,
    MarketIndices,
    SectorBreadth,
    SectorOption,
    SectorRead,
)

logger = logging.getLogger("catalyst_radar.service")

#: The snapshot universe already excludes OTC/preferred noise and is the frame
#: the dashboard prewarms; the Auto members are filtered locally.
SNAPSHOT_UNIVERSE = "all_equity"
SNAPSHOT_LIMIT = MAX_LIMIT

GOOGLE_NEWS_RSS = (
    "https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
)
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
MARKET_QUERY = "NIFTY 50 when:1d"

NEWS_TIMEOUT = 8
NEWS_CACHE_TTL = 300.0
NEWS_FAILURE_TTL = 60.0
MAX_NEWS_REQUESTS = 3
MAX_SYMBOL_QUERIES = MAX_NEWS_REQUESTS - 1
MAX_NEWS_ROWS = 8
MAX_POSITIONING_ROWS = 3
MAX_ROWS = 12

INDEX_CACHE_TTL = 60.0
INDEX_FAILURE_TTL = 15.0

RESPONSE_CACHE_TTL = 30.0

WARN_MARKET = "market_source_unavailable"
WARN_INDEX = "index_source_unavailable"
WARN_INDEX_PARTIAL = "index_source_partial"
WARN_NEWS = "news_source_unavailable"
WARN_NEWS_PARTIAL = "news_source_partial"
WARN_NO_NEWS = "no_recent_news"

_INDEX_TICKERS = ("NSE:NIFTY", "BSE:SENSEX", "NSE:INDIAVIX")
#: `scan_frame` returns the display name, not the ticker we requested.
_INDEX_FIELDS = {
    "NIFTY": "nifty",
    "SENSEX": "sensex",
    "INDIAVIX": "vix",
}

_HEADLINE_NOISE = (
    "TAKES DELIVERY",
    "TAKES HOME",
    "SPOTTED",
    "BUYING GUIDE",
    "COMPARISON",
    "REVIEW",
    "PHOTOS",
    "VIDEO",
    "USED CAR",
    "PRICE IN",
    "OFFERS",
    "DISCOUNT",
)

#: A sector headline must say something about the business, not just name a
#: product. Without this, a celebrity car-delivery post ranks beside an upgrade.
_HEADLINE_SIGNALS = (
    "SALES",
    "DISPATCH",
    "WHOLESALE",
    "RETAIL",
    "BOOKING",
    "DEMAND",
    "UPGRADE",
    "DOWNGRADE",
    "TARGET",
    "UPSIDE",
    "INVESTOR",
    "ANALYST",
    "RESULTS",
    "EARNINGS",
    "PROFIT",
    "MARGIN",
    "REVENUE",
    "GST",
    "POLICY",
    "SUBSIDY",
    "PRICE HIKE",
    "PRICE CUT",
    "LAUNCH",
    "CAPACITY",
    "PLANT",
    "JOINT VENTURE",
    "STAKE",
    "BUYBACK",
    "DIVIDEND",
    "RECALL",
    "GUIDANCE",
    "RALLY",
    "GAIN",
    "JUMP",
    "SURGE",
    "SLUMP",
    "FALL",
    "DROP",
)

_EVENT_TOKENS = (
    "INVESTOR",
    "ANALYST",
    "BOARD MEETING",
    "AGM",
    "EARNINGS",
    "RESULTS",
    "GUIDANCE",
    "BUYBACK",
    "DIVIDEND",
    "DEMERGER",
    "LAUNCH",
    "RECALL",
    "PRICE HIKE",
    "CAPACITY",
    "PLANT",
    "JOINT VENTURE",
    "STAKE",
)

_SCORE_RANK = {"high": 0, "medium": 1, "low": 2}


# --------------------------------------------------------------------------- #
# Small numeric / time helpers
# --------------------------------------------------------------------------- #


def _num(value: Any) -> Optional[float]:
    """Coerce to a finite float, or ``None`` -- never a zero-filled gap."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _round(value: Optional[float], digits: int = 2) -> Optional[float]:
    return None if value is None else round(value, digits)


def _now_iso(moment: Optional[datetime] = None) -> str:
    return (moment or datetime.now(IST)).isoformat(timespec="seconds")


def _local(tag: str) -> str:
    """Element local name (namespace stripped, lower-cased)."""
    return str(tag).rsplit("}", 1)[-1].lower()


def _published_at(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    try:
        moment = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(IST)


# --------------------------------------------------------------------------- #
# Caches (process-local; one build per 30s, one feed per 5 min)
# --------------------------------------------------------------------------- #

_response_cache: dict[tuple[str, str], tuple[float, CatalystToday]] = {}
_loop_locks: dict[int, asyncio.Lock] = {}

_first_seen: dict[str, str] = {}
_first_seen_limit = 500

_news_cache: dict[str, tuple[float, list["NewsItem"]]] = {}
_news_fail_until: dict[str, float] = {}

_index_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_index_state: dict[str, float] = {"fail_until": 0.0}
_index_lock = threading.Lock()


def _reset_cache() -> None:
    """Clear every process-level cache (tests; also the escape hatch)."""
    _response_cache.clear()
    _loop_locks.clear()
    _first_seen.clear()
    _news_cache.clear()
    _news_fail_until.clear()
    with _index_lock:
        _index_cache.clear()
        _index_state["fail_until"] = 0.0


def _loop_lock() -> asyncio.Lock:
    """A lock per running loop.

    ``asyncio.Lock`` is bound to the loop that first uses it; a module-level
    lock would break the second ``TestClient`` (and any worker reuse) with a
    different loop. One app loop therefore means one lock.
    """
    loop = asyncio.get_running_loop()
    key = id(loop)
    lock = _loop_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _loop_locks[key] = lock
    return lock


def _first_seen_for(key: str) -> str:
    moment = _first_seen.get(key)
    if moment is None:
        if len(_first_seen) >= _first_seen_limit:
            _first_seen.pop(next(iter(_first_seen)), None)
        moment = _now_iso()
        _first_seen[key] = moment
    return moment


# --------------------------------------------------------------------------- #
# Index quotes (one small ticker query, not the full market scan)
# --------------------------------------------------------------------------- #


def _index_quotes() -> dict[str, Any]:
    """Fetch NIFTY / SENSEX / INDIAVIX. Raises when the source is dead."""
    frame = scan_frame(
        "india",
        columns=["name", "close", "change"],
        tickers=list(_INDEX_TICKERS),
        limit=10,
        timeout=15,
    )
    values: dict[str, Any] = {}
    if frame is None or frame.empty:
        raise RuntimeError("index quote frame is empty")
    for record in frame.to_dict("records"):
        field = _INDEX_FIELDS.get(str(record.get("name") or "").upper())
        if field is None:
            continue
        last = _num(record.get("close"))
        if field == "vix":
            values["vix"] = _round(last)
        else:
            values[field] = IndexQuote(
                last=_round(last),
                change_pct=_round(_num(record.get("change"))),
            )
    if not values:
        raise RuntimeError("index quote frame has no recognised ticker")
    return values


def _cached_index_quotes() -> tuple[dict[str, Any], bool]:
    """Return ``(values, ok)``; a failure is cached briefly to stop hammering."""
    now = time.monotonic()
    with _index_lock:
        hit = _index_cache.get("india")
        if hit is not None and hit[0] > now:
            return hit[1], True
        if _index_state.get("fail_until", 0.0) > now:
            return {}, False

    try:
        values = _index_quotes()
    except Exception as exc:
        logger.warning("catalyst index source unavailable: %s", exc)
        with _index_lock:
            _index_state["fail_until"] = time.monotonic() + INDEX_FAILURE_TTL
        return {}, False

    with _index_lock:
        _index_cache["india"] = (time.monotonic() + INDEX_CACHE_TTL, values)
        _index_state["fail_until"] = 0.0
    return values, True


# --------------------------------------------------------------------------- #
# Google News RSS
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class NewsItem:
    """One parsed headline. ``published`` is IST-aware when the feed dates it."""

    title: str
    link: str
    source: Optional[str]
    published: Optional[datetime]


def _child_text(element: ET.Element, names: tuple[str, ...]) -> str:
    for child in element:
        if _local(child.tag) in names:
            text = " ".join((child.text or "").split())
            if text:
                return text
    return ""


def _child_link(element: ET.Element) -> str:
    for child in element:
        if _local(child.tag) != "link":
            continue
        href = (child.get("href") or "").strip()
        if href:
            return href
        text = (child.text or "").strip()
        if text:
            return text
    return ""


def parse_rss(raw: str) -> list[NewsItem]:
    """Parse RSS/Atom item titles, links, publication and source.

    A malformed body is an empty feed, not an exception: one broken XML body
    must not take down the endpoint.
    """
    if not raw or not raw.strip():
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        logger.warning("catalyst news feed is unparseable: %s", exc)
        return []

    items: list[NewsItem] = []
    for element in root.iter():
        if _local(element.tag) not in ("item", "entry"):
            continue
        title = _child_text(element, ("title",))
        if not title:
            continue
        source = _child_text(element, ("source", "author")) or None
        if source and title.endswith(f" - {source}"):
            title = title[: -(len(source) + 3)].strip()
        published = _published_at(
            _child_text(element, ("pubdate", "published", "updated", "date"))
        )
        items.append(
            NewsItem(
                title=title,
                link=_child_link(element),
                source=source,
                published=published,
            )
        )
    return items


def _fetch_news_query(query: str) -> list[NewsItem]:
    """Fetch one query, cached for five minutes. Raises on an upstream failure."""
    now = time.monotonic()
    hit = _news_cache.get(query)
    if hit is not None and hit[0] > now:
        return hit[1]
    if _news_fail_until.get(query, 0.0) > now:
        raise RuntimeError(f"news query recently failed: {query}")

    url = GOOGLE_NEWS_RSS.format(query=quote_plus(query))
    try:
        response = requests.get(
            url, headers={"User-Agent": USER_AGENT}, timeout=NEWS_TIMEOUT
        )
        response.raise_for_status()
        items = parse_rss(response.text)
    except Exception:
        _news_fail_until[query] = time.monotonic() + NEWS_FAILURE_TTL
        raise

    _news_cache[query] = (time.monotonic() + NEWS_CACHE_TTL, items)
    _news_fail_until.pop(query, None)
    return items


def _name_aliases(name: str, symbol: str) -> tuple[str, ...]:
    """Aliases are the ticker plus the company name without legal suffixes."""
    upper = (name or "").upper()
    for suffix in (" LIMITED", " LTD", " INDIA", " INDUSTRIES"):
        if upper.endswith(suffix):
            upper = upper[: -len(suffix)]
    aliases = {symbol.upper()} if symbol else set()
    if upper:
        aliases.add(upper)
    return tuple(sorted(aliases))


def _sector_id(raw: str) -> str:
    """Stable slug from a raw snapshot sector; no sector list to maintain."""
    text = "".join(ch.lower() if ch.isalnum() else "-" for ch in raw.strip())
    return "-".join(part for part in text.split("-") if part) or "other"


def _sector_catalog(
    rows: list[dict[str, Any]],
) -> tuple[list[SectorOption], dict[str, tuple[str, list[dict[str, Any]]]]]:
    """Derive selector options from the snapshot's own sector field."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        raw = str(row.get("sector") or "").strip()
        if not raw or raw.lower() == "none":
            continue
        groups.setdefault(raw, []).append(row)

    options = [SectorOption(id=MARKET_SECTOR, label=MARKET_LABEL, count=len(rows))]
    by_id: dict[str, tuple[str, list[dict[str, Any]]]] = {}
    used: set[str] = {MARKET_SECTOR}
    for raw, group in sorted(
        groups.items(), key=lambda item: (-len(item[1]), item[0].lower())
    ):
        base = _sector_id(raw)
        value = base
        suffix = 2
        while value in used:
            value = f"{base}-{suffix}"
            suffix += 1
        used.add(value)
        label = raw.upper()
        by_id[value] = (label, group)
        options.append(SectorOption(id=value, label=label, count=len(group)))
    return options, by_id


def _constituents_for(
    rows: list[dict[str, Any]],
    *,
    max_constituents: int,
    rank_by_move: bool = False,
) -> list[tuple[Constituent, Optional[dict[str, Any]]]]:
    """Promote snapshot rows to news-matchable constituents.

    No hardcoded membership: the selected sector's rows are ranked from the
    snapshot itself. Market-wide view uses the biggest absolute movers so the
    news budget is spent where it can matter; a selected sector uses market cap
    to keep its major names.
    """
    candidates = sorted(
        rows,
        key=lambda row: (
            abs(_num(row.get("change")) or 0.0)
            if rank_by_move
            else (_num(row.get("market_cap_cr")) or 0.0)
        ),
        reverse=True,
    )[:max_constituents]
    resolved: list[tuple[Constituent, Optional[dict[str, Any]]]] = []
    for row in candidates:
        symbol = str(row.get("symbol") or "").upper()
        if not symbol:
            continue
        name = str(row.get("name") or symbol)
        sector = str(row.get("sector") or "").strip() or None
        resolved.append(
            (
                Constituent(symbol, name, _name_aliases(name, symbol), sector=sector),
                row,
            )
        )
    return resolved


def _alias_in_text(alias: str, text: str) -> bool:
    """A ticker must be a token, not a substring of a longer word.

    Short tickers are the dangerous case: ``HAL`` occurs inside "challenging"
    and ``BEL`` inside "bell". Word boundaries keep a headline from becoming a
    catalyst for an unrelated company.
    """
    wanted = alias.strip().upper()
    if not wanted:
        return False
    pattern = rf"(?<![A-Z0-9]){re.escape(wanted)}(?![A-Z0-9])"
    return re.search(pattern, text) is not None


def _match_constituent(
    title: str,
    constituents: list[tuple[Constituent, Optional[dict[str, Any]]]],
    hint_symbol: Optional[str] = None,
) -> Optional[Constituent]:
    """Match a headline to one member, preferring the query's own symbol."""
    upper = title.upper()
    hinted = next(
        (candidate for candidate, _ in constituents if candidate.symbol == hint_symbol),
        None,
    )
    if hinted is not None and any(
        _alias_in_text(alias, upper)
        for alias in (hinted.symbol.upper(), *hinted.aliases)
    ):
        return hinted
    for constituent, _ in constituents:
        if any(
            _alias_in_text(alias, upper)
            for alias in (constituent.symbol.upper(), *constituent.aliases)
        ):
            return constituent
    return None


# --------------------------------------------------------------------------- #
# Grading (pure, deterministic)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class Grade:
    score: str
    state: str
    confidence: float
    confirmed: bool


def grade_row(
    *,
    has_headline: bool,
    move_pct: Optional[float],
    rel_volume: Optional[float],
    advancing: int,
    declining: int,
    total: int,
    direction: int,
    published: Optional[datetime],
    now: datetime,
) -> Grade:
    """Score a row from two independent sides: a real headline and live tape.

    * high -- both sides present;
    * medium -- exactly one side;
    * low -- neither.

    ``state=confirmed`` requires the live side; a headline alone is
    ``breaking`` (fresh) or ``fading`` (older than the freshness window).
    """
    move_confirmed = move_pct is not None and abs(move_pct) >= MOVE_CONFIRM_PCT
    volume_confirmed = rel_volume is not None and rel_volume >= VOLUME_CONFIRM_REL
    breadth_confirmed = False
    if total > 0:
        if direction > 0:
            breadth_confirmed = advancing / total >= BREADTH_CONFIRM_RATIO
        elif direction < 0:
            breadth_confirmed = declining / total >= BREADTH_CONFIRM_RATIO
    confirmed = move_confirmed or volume_confirmed or breadth_confirmed

    if has_headline and confirmed:
        score = "high"
    elif has_headline or confirmed:
        score = "medium"
    else:
        score = "low"

    if confirmed:
        state = "confirmed"
    elif has_headline:
        if published is None:
            state = "breaking"
        else:
            age_hours = (now - published).total_seconds() / 3600.0
            state = "breaking" if age_hours <= BREAKING_MAX_AGE_HOURS else "fading"
    else:
        state = "scheduled"

    confidence = 0.2
    if has_headline:
        confidence += 0.25
    if move_confirmed:
        confidence += 0.2
    if volume_confirmed:
        confidence += 0.15
    if breadth_confirmed:
        confidence += 0.1
    if has_headline and confirmed:
        confidence += 0.05
    return Grade(
        score=score,
        state=state,
        confidence=round(min(confidence, 0.95), 2),
        confirmed=confirmed,
    )


# --------------------------------------------------------------------------- #
# Row assembly
# --------------------------------------------------------------------------- #


def _kind_for_headline(title: str) -> str:
    upper = title.upper()
    return "event" if any(token in upper for token in _EVENT_TOKENS) else "news"


def _is_qualifying_headline(title: str) -> bool:
    """Reject product/lifestyle posts that merely mention an auto brand."""
    upper = title.upper()
    if any(token in upper for token in _HEADLINE_NOISE):
        return False
    return any(token in upper for token in _HEADLINE_SIGNALS)


def _direction(move_pct: Optional[float], sector_change: Optional[float]) -> int:
    value = move_pct if move_pct is not None else sector_change
    if value is None or value == 0:
        return 0
    return 1 if value > 0 else -1


def _invalidations(direction: int, total: int, sector_label: str) -> list[str]:
    line = (
        f"{sector_label} recovers >1.5%"
        if direction < 0
        else f"{sector_label} gives back >1.5%"
    )
    checks = [line]
    if total > 0:
        threshold = math.ceil(total / 2)
        if direction < 0:
            checks.append(f"Breadth improves above {threshold}/{total}")
        else:
            checks.append(f"Breadth falls below {threshold}/{total}")
    return checks


def _reasons_for(
    *,
    symbol: str,
    has_headline: bool,
    source: Optional[str],
    move_pct: Optional[float],
    rel_volume: Optional[float],
    pos_52w: Optional[float],
    sector_change: Optional[float],
    sector_label: str,
    advancing: int,
    declining: int,
    total: int,
    direction: int,
) -> list[str]:
    reasons: list[str] = []
    if has_headline:
        reasons.append(f"Headline via {source or 'Google News'}")
    else:
        reasons.append("No qualifying headline; sector move only")

    if move_pct is not None:
        reasons.append(f"{symbol} {move_pct:+.2f}% today")
    if rel_volume is not None and rel_volume >= VOLUME_CONFIRM_REL:
        reasons.append(f"Relative volume {rel_volume:.1f}x")
    if total > 0:
        if direction > 0:
            reasons.append(f"Sector breadth {advancing}/{total} advancing")
        elif direction < 0:
            reasons.append(f"Sector breadth {declining}/{total} declining")
    if pos_52w is not None:
        if pos_52w <= 10:
            reasons.append(f"Near 52-week low ({pos_52w:.0f}% of 52-week range)")
        elif pos_52w >= 90:
            reasons.append(f"Near 52-week high ({pos_52w:.0f}% of 52-week range)")
    if sector_change is not None and not has_headline:
        reasons.append(
            f"{sector_label} {sector_change:+.2f}% (equal-weight, {total} constituents)"
        )
    if has_headline and len(reasons) == 1:
        reasons.append("No live price/volume/breadth confirmation")
    return reasons


def _news_row(
    constituent: Constituent,
    row: Optional[dict[str, Any]],
    item: NewsItem,
    *,
    sector_change: Optional[float],
    sector_label: str,
    advancing: int,
    declining: int,
    total: int,
    now: datetime,
) -> CatalystRow:
    move_pct = _num(row.get("change")) if row else None
    rel_volume = _num(row.get("relative_volume")) if row else None
    pos_52w = _num(row.get("pos_52w")) if row else None
    direction = _direction(move_pct, sector_change)
    grade = grade_row(
        has_headline=True,
        move_pct=move_pct,
        rel_volume=rel_volume,
        advancing=advancing,
        declining=declining,
        total=total,
        direction=direction,
        published=item.published,
        now=now,
    )
    return CatalystRow(
        symbol=constituent.symbol,
        name=constituent.name,
        sector=sector_label,
        kind=_kind_for_headline(item.title),  # type: ignore[arg-type]
        headline=item.title,
        source=item.source,
        source_url=item.link or None,
        first_seen=_first_seen_for(f"news:{item.link or item.title}"),
        event_at=_now_iso(item.published) if item.published else None,
        state=grade.state,  # type: ignore[arg-type]
        score=grade.score,  # type: ignore[arg-type]
        confidence=grade.confidence,
        move_pct=_round(move_pct),
        rel_volume=_round(rel_volume),
        reasons=_reasons_for(
            symbol=constituent.symbol,
            has_headline=True,
            source=item.source,
            move_pct=move_pct,
            rel_volume=rel_volume,
            pos_52w=pos_52w,
            sector_change=sector_change,
            sector_label=sector_label,
            advancing=advancing,
            declining=declining,
            total=total,
            direction=direction,
        ),
        invalidates=_invalidations(direction, total, sector_label),
    )


def _positioning_row(
    constituent: Constituent,
    row: dict[str, Any],
    *,
    sector_change: Optional[float],
    sector_label: str,
    advancing: int,
    declining: int,
    total: int,
    now: datetime,
) -> CatalystRow:
    move_pct = _num(row.get("change"))
    rel_volume = _num(row.get("relative_volume"))
    pos_52w = _num(row.get("pos_52w"))
    direction = _direction(move_pct, sector_change)
    grade = grade_row(
        has_headline=False,
        move_pct=move_pct,
        rel_volume=rel_volume,
        advancing=advancing,
        declining=declining,
        total=total,
        direction=direction,
        published=None,
        now=now,
    )
    session = now.date().isoformat()
    return CatalystRow(
        symbol=constituent.symbol,
        name=constituent.name,
        sector=sector_label,
        kind="positioning",
        headline=None,
        source=None,
        source_url=None,
        first_seen=_first_seen_for(f"positioning:{session}:{constituent.symbol}"),
        event_at=None,
        state=grade.state,  # type: ignore[arg-type]
        score=grade.score,  # type: ignore[arg-type]
        confidence=grade.confidence,
        move_pct=_round(move_pct),
        rel_volume=_round(rel_volume),
        reasons=_reasons_for(
            symbol=constituent.symbol,
            has_headline=False,
            source=None,
            move_pct=move_pct,
            rel_volume=rel_volume,
            pos_52w=pos_52w,
            sector_change=sector_change,
            sector_label=sector_label,
            advancing=advancing,
            declining=declining,
            total=total,
            direction=direction,
        ),
        invalidates=_invalidations(direction, total, sector_label),
    )


def _news_queries(
    available: list[tuple[Constituent, Optional[dict[str, Any]]]],
    sector_label: str,
    *,
    market_view: bool = False,
) -> list[str]:
    """Sector query plus the two largest absolute movers (three requests max)."""
    movers = sorted(
        (
            (abs(_num(row.get("change")) or 0.0) if row else 0.0, constituent)
            for constituent, row in available
        ),
        key=lambda item: item[0],
        reverse=True,
    )[:MAX_SYMBOL_QUERIES]
    queries = [MARKET_QUERY if market_view else f"{sector_label} when:1d"]
    queries.extend(f"{constituent.name} when:1d" for _, constituent in movers)
    return queries[:MAX_NEWS_REQUESTS]


async def _collect_news(
    queries: list[str],
    warnings: list[str],
    constituents: list[tuple[Constituent, Optional[dict[str, Any]]]],
) -> tuple[dict[str, NewsItem], bool]:
    """Fetch queries concurrently through threads; one failure is a warning."""
    from_symbol: dict[str, NewsItem] = {}
    failures = 0
    successes = 0
    saw_item = False

    results = await asyncio.gather(
        *(asyncio.to_thread(_fetch_news_query, query) for query in queries),
        return_exceptions=True,
    )

    for query, result in zip(queries, results):
        if isinstance(result, BaseException):
            logger.warning("catalyst news query failed (%s): %s", query, result)
            failures += 1
            continue
        successes += 1
        items = result
        if items:
            saw_item = True
        hint = None
        for constituent, _ in constituents:
            if constituent.name in query:
                hint = constituent.symbol
                break
        for item in items:
            if not _is_qualifying_headline(item.title):
                continue
            constituent = _match_constituent(item.title, constituents, hint)
            if constituent is None:
                continue
            previous = from_symbol.get(constituent.symbol)
            if previous is None or _newer(item, previous):
                from_symbol[constituent.symbol] = item

    if failures:
        warnings.append(WARN_NEWS if successes == 0 else WARN_NEWS_PARTIAL)
    if successes and not saw_item:
        warnings.append(WARN_NO_NEWS)
    return from_symbol, saw_item


def _newer(left: NewsItem, right: NewsItem) -> bool:
    if left.published is None:
        return False
    if right.published is None:
        return True
    return left.published > right.published


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #


async def _assemble(market: str, sector_id: str = DEFAULT_SECTOR) -> CatalystToday:
    warnings: list[str] = []
    now = datetime.now(IST)

    index_task = asyncio.create_task(asyncio.to_thread(_cached_index_quotes))

    snapshot: Optional[dict[str, Any]] = None
    try:
        snapshot = await asyncio.to_thread(
            build_snapshot, SNAPSHOT_UNIVERSE, SNAPSHOT_LIMIT
        )
    except Exception as exc:
        logger.warning("catalyst snapshot unavailable: %s", exc)
        warnings.append(WARN_MARKET)

    all_rows = [
        row
        for row in (snapshot or {}).get("rows") or []
        if str(row.get("symbol") or "").strip()
    ]
    catalog, by_id = _sector_catalog(all_rows)
    selected = (sector_id or DEFAULT_SECTOR).strip().lower()
    if selected not in (MARKET_SECTOR, *by_id.keys()):
        if selected:
            warnings.append(f"unknown_sector:{sector_id}")
        selected = MARKET_SECTOR
    selected_rows = all_rows if selected == MARKET_SECTOR else by_id[selected][1]
    sector_label = MARKET_LABEL if selected == MARKET_SECTOR else by_id[selected][0]

    available = _constituents_for(
        selected_rows,
        max_constituents=80 if selected == MARKET_SECTOR else 20,
        rank_by_move=False,
    )
    if not selected_rows:
        warnings.append(f"sector_empty:{selected}")

    changes = [
        change
        for change in (_num(row.get("change")) for row in selected_rows)
        if change is not None
    ]
    sector_change = _round(sum(changes) / len(changes)) if changes else None
    advancing = sum(1 for change in changes if change > 0)
    declining = sum(1 for change in changes if change < 0)
    total = len(changes)

    index_values, index_ok = await index_task
    if not index_ok:
        warnings.append(WARN_INDEX)
    nifty = index_values.get("nifty")
    sensex = index_values.get("sensex")
    vix = index_values.get("vix")
    if index_ok and (nifty is None or sensex is None or vix is None):
        warnings.append(WARN_INDEX_PARTIAL)
    nifty_change = nifty.change_pct if isinstance(nifty, IndexQuote) else None
    relative_strength = (
        _round(sector_change - nifty_change)
        if sector_change is not None and nifty_change is not None
        else None
    )

    news_by_symbol, _ = await _collect_news(
        _news_queries(available, sector_label, market_view=selected == MARKET_SECTOR),
        warnings,
        available,
    )

    rows: list[CatalystRow] = []
    for constituent, row in available:
        item = news_by_symbol.get(constituent.symbol)
        if item is None:
            continue
        rows.append(
            _news_row(
                constituent,
                row,
                item,
                sector_change=sector_change,
                sector_label=constituent.sector or sector_label,
                advancing=advancing,
                declining=declining,
                total=total,
                now=now,
            )
        )
    rows = rows[:MAX_NEWS_ROWS]

    candidates = [
        (constituent, row)
        for constituent, row in available
        if row is not None
        and constituent.symbol not in news_by_symbol
        and abs(_num(row.get("change")) or 0.0) >= MOVE_CONFIRM_PCT
    ]
    candidates.sort(
        key=lambda item: abs(_num(item[1].get("change")) or 0.0), reverse=True
    )
    for constituent, row in candidates[:MAX_POSITIONING_ROWS]:
        rows.append(
            _positioning_row(
                constituent,
                row,
                sector_change=sector_change,
                sector_label=constituent.sector or sector_label,
                advancing=advancing,
                declining=declining,
                total=total,
                now=now,
            )
        )

    rows.sort(
        key=lambda row: (
            _SCORE_RANK.get(row.score, 3),
            -abs(row.move_pct) if row.move_pct is not None else 0.0,
            row.symbol,
        )
    )
    rows = rows[:MAX_ROWS]

    counts = CatalystCounts(
        high=sum(1 for row in rows if row.score == "high"),
        medium=sum(1 for row in rows if row.score == "medium"),
        low=sum(1 for row in rows if row.score == "low"),
        total=len(rows),
    )

    return CatalystToday(
        as_of=_now_iso(),
        market=MarketIndices(nifty=nifty, sensex=sensex, vix=vix),
        sector=SectorRead(
            id=selected,
            label=sector_label,
            change_pct=sector_change,
            relative_strength_pct=relative_strength,
            breadth=SectorBreadth(
                advancing=advancing, declining=declining, total=total
            ),
        ),
        available_sectors=catalog,
        rows=rows,
        counts=counts,
        warnings=list(dict.fromkeys(warnings)),
    )


async def build_catalysts(
    market: str = "india", sector: str = DEFAULT_SECTOR
) -> CatalystToday:
    """Return the assembled payload, cached for 30s with a single-flight lock."""
    market_key = (market or "india").strip().lower()
    sector_key = (sector or DEFAULT_SECTOR).strip().lower()
    key = (market_key, sector_key)
    now = time.monotonic()
    hit = _response_cache.get(key)
    if hit is not None and hit[0] > now:
        return hit[1]

    async with _loop_lock():
        hit = _response_cache.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return hit[1]
        payload = await _assemble(market_key, sector_key)
        _response_cache[key] = (time.monotonic() + RESPONSE_CACHE_TTL, payload)
        return payload


__all__ = [
    "GOOGLE_NEWS_RSS",
    "Grade",
    "NEWS_CACHE_TTL",
    "NewsItem",
    "MARKET_QUERY",
    "RESPONSE_CACHE_TTL",
    "build_catalysts",
    "grade_row",
    "parse_rss",
]

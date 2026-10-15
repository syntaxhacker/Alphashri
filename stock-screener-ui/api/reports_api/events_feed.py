"""Pre-week watchlist events feed (``/api/reports/events/upcoming|recent``).

Merges two free, key-less sources into one date-sorted feed for a watchlist:

* ``GET /api/reports/events/upcoming?days=14&universe=nifty500``
  yfinance earnings-calendar dates in ``[today, today+days]`` plus
  news-DB catalysts from the last 14 days (Q2 updates, QIPs, orders,
  upgrades) classified by keyword.
* ``GET /api/reports/events/recent?days=7&universe=nifty500``
  Same shape for the trailing ``[today-days, today]`` window: what just
  fired (results, dividends/splits, updates, QIPs, upgrades).

``kind`` is one of ``results | update | qip | order | upgrade | dividend
| split | bonus | agm``. yfinance covers results/dividend/split (bonus
and AGM are not exposed by yfinance, by design — see ``delivery.py``);
the news DB additionally covers update/qip/order/upgrade/bonus/agm via
keyword classification, with ``update`` as the default kind.

Conventions reused from ``api/reports_api/delivery.py`` (extended, not
duplicated): per-symbol yfinance facts with 24 h on-disk JSON cache
(``experiments/data/reports/events/{SYM}.json``), bounded thread-pool
fan-out, explicit symbol caps, per-symbol fail-soft. The news DB is
queried READ-ONLY (no commit, no write); every failure mode returns a
200 with an empty ``events`` list (never 500). No secrets or API keys.
"""

from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query

from api.reports_api.delivery import (
    EVENTS_DIR,
    _facts_to_events,
    _fetch_symbol_events,
    _now_iso,
    _resolve_symbols,
    _today_str,
)
from api.utils import _sanitize_for_json
from trading.symbol_aliases import resolve_symbol

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports/events", tags=["reports"])

_FEED_WORKERS = 6
_FEED_MAX_SYMBOLS = 500
_NEWS_LOOKBACK_DAYS = 14
_FEED_MAX_DAYS = 90
_FEED_MAX_EVENTS = 500
_FEED_MEM_TTL = 300
_FEED_NEWS_ROW_CAP = 5000

FEED_KINDS = (
    "results",
    "update",
    "qip",
    "order",
    "upgrade",
    "dividend",
    "split",
    "bonus",
    "agm",
)

# Ordered (kind, trigger substrings); first match wins. "update" is the
# default when nothing else matches. Business-update/guidance headlines
# are checked before results so "Q2 business updates" -> update while
# "ahead of Q2 results" -> results.
_KEYWORD_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("qip", ("qip", "qualified institutional")),
    ("order", ("order", "contract")),
    ("upgrade", ("upgrad", "target", "outperform", "buy rating", "buy call")),
    ("dividend", ("dividend",)),
    ("split", ("split", "sub-division", "subdivision")),
    ("bonus", ("bonus",)),
    ("agm", ("agm", "annual general meeting", "extraordinary general meeting")),
    ("update", ("business update", "operational update", "guidance", "update", "sales ")),
    ("results", ("result", "earning", "net profit", "quarterly", "q1", "q2", "q3", "q4",
                 "ebitda", "pat ")),
)

_feed_mem: dict[str, tuple[float, dict]] = {}


def classify_news_kind(headline: Any, content: Any = "") -> str:
    """Keyword classify a news item into a feed kind; never raises.

    Matching is headline-first: body text is only consulted when the
    headline is blank. Bodies routinely contain noise phrases ("in order
    to", "court order") that would otherwise swamp the signal.
    """
    try:
        texts = [headline, content] if not (headline or "").strip() else [headline]
        for text in texts:
            lowered = str(text or "").lower()
            for kind, triggers in _KEYWORD_RULES:
                for trig in triggers:
                    if trig in lowered:
                        return kind
    except Exception:
        pass
    return "update"


def _day_of(value: Any) -> Optional[str]:
    """Naive datetime / date / ISO string -> YYYY-MM-DD; None when unknown."""
    try:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.date().isoformat()
        from datetime import date as _date

        if isinstance(value, _date):
            return value.isoformat()
        text = str(value).strip()[:10]
        datetime.strptime(text, "%Y-%m-%d")
        return text
    except Exception:
        return None


def _query_news_rows(start_day: str, end_day: str) -> list[dict]:
    """READ-ONLY join of news_articles x mentions in the window.

    Returns raw dicts (article_id, headline, content, source, day,
    symbol, name). Never raises, never writes.
    """
    try:
        from db.database import SessionLocal
        from db.models.news import NewsArticle, NewsSymbolMention

        db = SessionLocal()
        try:
            pairs = (
                db.query(NewsArticle, NewsSymbolMention)
                .join(NewsSymbolMention, NewsSymbolMention.article_id == NewsArticle.id)
                .order_by(NewsArticle.published_at.desc())
                .limit(_FEED_NEWS_ROW_CAP)
                .all()
            )
        finally:
            try:
                db.close()
            except Exception:
                pass
        rows: list[dict] = []
        for article, mention in pairs:
            try:
                day = _day_of(getattr(article, "published_at", None))
                if day is None:
                    day = _day_of(getattr(article, "fetched_at", None))
                if day is None or not (start_day <= day <= end_day):
                    continue
                sym = (
                    getattr(mention, "trading_symbol", None)
                    or getattr(mention, "symbol_code", None)
                    or ""
                )
                sym = str(sym).strip().upper()
                if not sym:
                    continue
                rows.append(
                    {
                        "article_id": getattr(article, "id", None),
                        "headline": getattr(article, "headline", "") or "",
                        "content": getattr(article, "content", "") or "",
                        "source": getattr(article, "source", "") or "news",
                        "day": day,
                        "symbol": sym,
                        "name": str(getattr(mention, "company_name", None) or sym),
                    }
                )
            except Exception:
                continue
        return rows
    except Exception as exc:
        logger.warning("events feed: news DB query failed, serving without news: %s", exc)
        return []


def _news_to_events(
    rows: list[dict], allowed: set[str], start_day: str, end_day: str
) -> list[dict]:
    """Classify + filter raw news rows into feed events (deduped, sorted)."""
    events: list[dict] = []
    seen: set[tuple[Any, str]] = set()
    try:
        for row in rows:
            try:
                # Resolve news-text symbols to canonical NSE_EQ trading symbols
                # (PTC->PTCIL, WI11->WHEELS, ...). Unresolvable rows keep the
                # legacy normalized value so filtering is otherwise identical.
                raw_sym = str(row.get("symbol") or "")
                try:
                    sym = resolve_symbol(raw_sym) or raw_sym.upper()
                except Exception:
                    sym = raw_sym.upper()
                if not sym or (allowed and sym not in allowed):
                    continue
                day = str(row.get("day") or "")[:10]
                if not (start_day <= day <= end_day):
                    continue
                key = (row.get("article_id"), sym)
                if key in seen:
                    continue
                seen.add(key)
                kind = classify_news_kind(row.get("headline"), row.get("content"))
                if kind not in FEED_KINDS:
                    kind = "update"
                events.append(
                    {
                        "date": day,
                        "symbol": sym,
                        "name": str(row.get("name") or sym),
                        "kind": kind,
                        "title": str(row.get("headline") or ""),
                        "source": str(row.get("source") or "news"),
                    }
                )
            except Exception:
                continue
    except Exception:
        pass
    events.sort(key=lambda e: (e.get("date", ""), e.get("symbol", "")))
    return events


def _yf_feed_events(symbols: list[str], start_day: str, end_day: str) -> list[dict]:
    """yfinance calendar facts -> feed events; per-symbol fail-soft."""
    events: list[dict] = []
    if not symbols:
        return events
    try:
        with ThreadPoolExecutor(max_workers=_FEED_WORKERS) as ex:
            futs = {ex.submit(_fetch_symbol_events, s): s for s in symbols}
            for fut in as_completed(futs):
                try:
                    facts = fut.result()
                except Exception as exc:
                    logger.debug("events feed: yfinance fan-out symbol failed: %s", exc)
                    continue
                try:
                    if not isinstance(facts, dict) or not facts.get("symbol"):
                        continue
                    sym = str(facts["symbol"]).upper()
                    for ev in _facts_to_events(facts, start_day, end_day):
                        kind = str(ev.get("kind") or "")
                        if kind not in FEED_KINDS:
                            continue
                        events.append(
                            {
                                "date": str(ev.get("date") or "")[:10],
                                "symbol": sym,
                                "name": sym,
                                "kind": kind,
                                "title": str(ev.get("title") or ""),
                                "source": "yfinance",
                            }
                        )
                except Exception:
                    continue
    except Exception:
        pass
    return events


def _empty_feed(universe: str, days: int) -> dict:
    return {
        "as_of": _now_iso(),
        "universe": universe,
        "days": days,
        "cached": False,
        "events": [],
    }


def serve_feed(mode: str, days: int, universe: str, symbols_csv: Optional[str]) -> dict:
    """Build the merged upcoming/recent feed; never raises."""
    try:
        days = max(1, min(int(days or 7), _FEED_MAX_DAYS))
    except Exception:
        days = 7
    uid = (universe or "nifty500").strip().lower() or "nifty500"
    mem_key = f"{mode}|{days}|{uid}|{(symbols_csv or '').upper()}"
    try:
        hit = _feed_mem.get(mem_key)
        if hit and time.time() - hit[0] < _FEED_MEM_TTL:
            ts, payload = hit
            out = dict(payload)
            out["cached"] = True
            out["age_sec"] = round(time.time() - ts, 1)
            return _sanitize_for_json(out)
    except Exception:
        pass
    try:
        today = _today_str()
        if mode == "recent":
            start_day = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days)).strftime("%Y-%m-%d")
            yf_start, yf_end = start_day, today
            news_start, news_end = start_day, today
        else:  # upcoming: yfinance looks ahead, news gives the last-14d context
            yf_start = today
            yf_end = (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")
            news_start = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=_NEWS_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
            news_end = today
            start_day = news_start
        syms = _resolve_symbols(symbols_csv, uid, _FEED_MAX_SYMBOLS)
        allowed = set(syms)
        events = _yf_feed_events(syms, yf_start, yf_end)
        rows = _query_news_rows(news_start, news_end)
        events.extend(_news_to_events(rows, allowed, news_start, news_end))
        events.sort(key=lambda e: (e.get("date", ""), e.get("symbol", "")))
        payload = {
            "as_of": _now_iso(),
            "universe": uid,
            "days": days,
            "from": yf_start if mode == "recent" else today,
            "to": yf_end,
            "cached": False,
            "age_sec": 0,
            "events": events[:_FEED_MAX_EVENTS],
            "symbols_covered": len(syms),
        }
        clean = _sanitize_for_json(payload)
        try:
            _feed_mem[mem_key] = (time.time(), clean)
        except Exception:
            pass
        return clean
    except Exception as exc:
        logger.warning("events feed: serve_feed(%s) failed, returning empty feed: %s", mode, exc)
        try:
            return _sanitize_for_json(_empty_feed(uid, days))
        except Exception:
            return {"as_of": "", "universe": uid, "days": days,
                    "cached": False, "events": []}


def clear_cache() -> None:
    """Drop in-process feed cache (tests / admin). Never raises."""
    try:
        _feed_mem.clear()
    except Exception:
        pass
    try:
        global _regime_mem
        _regime_mem = None
    except Exception:
        pass


# --------------------------------------------------------------------------
# Market regime: Nifty 50 close vs its 20-day moving average (``regime_long_ok``).
# --------------------------------------------------------------------------

_REGIME_SYMBOL = "^NSEI"
_REGIME_NAME = "NIFTY 50"
_REGIME_WINDOW = 20
_REGIME_MEM_TTL = 6 * 3600
_REGIME_DISK_TTL = 12 * 3600
_REGIME_DIR = EVENTS_DIR.parent / "regime"

#: Human-readable rule, also surfaced to the UI tooltip.
REGIME_RULE = (
    "regime_long_ok: longs only when Nifty 50 closes above its 20-day moving average"
)

_regime_mem: Optional[tuple[float, dict]] = None


def _regime_disk_path() -> Path:
    return _REGIME_DIR / "NSEI.json"


def _read_regime_disk() -> Optional[list[float]]:
    try:
        path = _regime_disk_path()
        if not path.exists():
            return None
        if time.time() - path.stat().st_mtime > _REGIME_DISK_TTL:
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        closes = (payload or {}).get("closes")
        if not isinstance(closes, list) or not closes:
            return None
        out = [float(c) for c in closes if isinstance(c, (int, float)) and c == c and c > 0]
        return out or None
    except Exception:
        return None


def _write_regime_disk(closes: list[float]) -> None:
    try:
        path = _regime_disk_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"as_of": _now_iso(), "closes": closes}, f)
    except Exception:
        pass


def _fetch_nifty_closes() -> Optional[list[float]]:
    """Daily ``^NSEI`` closes (3 months) via yfinance; None on any failure."""
    try:
        import yfinance as yf  # type: ignore
    except Exception as exc:
        logger.warning("events regime: yfinance import failed: %s", exc)
        return None
    try:
        hist = yf.Ticker(_REGIME_SYMBOL).history(period="3mo", interval="1d")
        if hist is None or getattr(hist, "empty", True) or "Close" not in hist.columns:
            return None
        closes = [
            float(c)
            for c in hist["Close"].dropna().tolist()
            if isinstance(c, (int, float)) and c == c and c > 0
        ]
        return closes or None
    except Exception as exc:
        logger.warning("events regime: yfinance ^NSEI fetch failed: %s", exc)
        return None


def _empty_regime() -> dict:
    return {
        "as_of": _now_iso(),
        "symbol": _REGIME_SYMBOL,
        "name": _REGIME_NAME,
        "close": None,
        "dma20": None,
        "above": None,
        "cached": False,
        "rule": REGIME_RULE,
    }


def serve_regime() -> dict:
    """Nifty 50 close vs 20DMA; never raises (fail-soft with nulls)."""
    global _regime_mem
    try:
        if _regime_mem and time.time() - _regime_mem[0] < _REGIME_MEM_TTL:
            ts, payload = _regime_mem
            out = dict(payload)
            out["cached"] = True
            out["age_sec"] = round(time.time() - ts, 1)
            return _sanitize_for_json(out)
    except Exception:
        pass
    try:
        closes = _read_regime_disk()
        if not closes:
            closes = _fetch_nifty_closes()
            if closes:
                _write_regime_disk(closes)
        if not closes:
            logger.warning("events regime: no Nifty closes available, serving nulls")
            return _sanitize_for_json(_empty_regime())
        close = round(closes[-1], 2)
        window = closes[-_REGIME_WINDOW:]
        dma20 = round(sum(window) / len(window), 2) if len(window) >= _REGIME_WINDOW else None
        payload = {
            "as_of": _now_iso(),
            "symbol": _REGIME_SYMBOL,
            "name": _REGIME_NAME,
            "close": close,
            "dma20": dma20,
            "above": (close > dma20) if dma20 is not None else None,
            "cached": False,
            "age_sec": 0,
            "rule": REGIME_RULE,
        }
        clean = _sanitize_for_json(payload)
        try:
            _regime_mem = (time.time(), clean)
        except Exception:
            pass
        return clean
    except Exception as exc:
        logger.warning("events regime: serve_regime failed, serving nulls: %s", exc)
        try:
            return _sanitize_for_json(_empty_regime())
        except Exception:
            out = _empty_regime()
            out["as_of"] = ""
            return out


@router.get("/upcoming")
def get_upcoming(
    days: int = Query(default=14, ge=1, le=90),
    universe: str = Query(default="nifty500"),
    symbols: Optional[str] = Query(default=None, description="CSV symbols; else universe"),
) -> dict:
    """Upcoming results + recent news catalysts for a pre-week watchlist."""
    try:
        return serve_feed("upcoming", days, universe or "nifty500", symbols)
    except Exception:
        try:
            return _empty_feed("nifty500", 14)
        except Exception:
            return {"as_of": "", "universe": "", "days": 14,
                    "cached": False, "events": []}


@router.get("/recent")
def get_recent(
    days: int = Query(default=7, ge=1, le=90),
    universe: str = Query(default="nifty500"),
    symbols: Optional[str] = Query(default=None, description="CSV symbols; else universe"),
) -> dict:
    """Trailing-window feed: what just fired (results, QIPs, upgrades, updates)."""
    try:
        return serve_feed("recent", days, universe or "nifty500", symbols)
    except Exception:
        try:
            return _empty_feed("nifty500", 7)
        except Exception:
            return {"as_of": "", "universe": "", "days": 7,
                    "cached": False, "events": []}


@router.get("/regime")
def get_regime() -> dict:
    """Nifty 50 close vs its 20DMA (``regime_long_ok``); fail-soft, never 500."""
    try:
        return serve_regime()
    except Exception as exc:
        logger.warning("events regime: endpoint failed, serving nulls: %s", exc)
        try:
            return _sanitize_for_json(_empty_regime())
        except Exception:
            out = _empty_regime()
            out["as_of"] = ""
            return out

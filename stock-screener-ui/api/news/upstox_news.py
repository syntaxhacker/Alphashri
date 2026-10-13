"""Upstox News API client (`GET /v2/news`).

Docs: https://upstox.com/developer/api-documentation/get-news

Key facts that shape this integration:
  - The feed is **instrument-keyed**, not a general market wire. You ask for up
    to 30 instrument keys and get back news for those instruments. A purely
    macro/policy story only shows up if it is tagged to one of the instruments
    you asked for.
  - Only the **past 7 days** are available.
  - `published_time` is **Unix milliseconds**.
  - Requires the user's OAuth access token (the same one the app stores in
    `broker_connections`). Tokens expire daily, so a stale token must be
    treated as "no news", never as an error that breaks a caller.

Everything here is best-effort: every public function returns `[]`/`None`
instead of raising, so a missing or dead token can never break the poller or a
report endpoint.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Iterable, Optional

import requests

logger = logging.getLogger(__name__)

UPSTOX_NEWS_URL = "https://api.upstox.com/v2/news"

#: Docs: max 30 instrument keys per request.
MAX_INSTRUMENT_KEYS = 30
#: Docs: page_size 1..100.
MAX_PAGE_SIZE = 100


def resolve_upstox_token() -> Optional[str]:
    """DB (`broker_connections`) first, then env. Never raises."""
    # 1. Shared broker connection (what the app actually uses).
    try:
        from db.database import SessionLocal
        from db.models.broker import BrokerConnection

        db = SessionLocal()
        try:
            row = (
                db.query(BrokerConnection)
                .filter(BrokerConnection.broker_name == "upstox")
                .order_by(BrokerConnection.id.desc())
                .first()
            )
            if row and row.access_token:
                return str(row.access_token)
        finally:
            db.close()
    except Exception as exc:  # pragma: no cover - import/env dependent
        logger.debug("upstox token lookup failed: %s", exc)

    # 2. Environment fallback.
    token = os.getenv("UPSTOX_ACCESS_TOKEN")
    return token or None


def fetch_upstox_news(
    instrument_keys: Iterable[str],
    *,
    category: str = "instrument_keys",
    page_number: int = 1,
    page_size: int = MAX_PAGE_SIZE,
    token: Optional[str] = None,
    timeout: float = 20.0,
) -> list[dict[str, Any]]:
    """Fetch news, flattened to one dict per article.

    Returns::

        [{"instrument_key": "NSE_EQ|INE040H01021", "heading": ..., "summary": ...,
          "article_link": ..., "published_time": 1776251261821}, ...]

    Returns `[]` on any failure (bad/missing token, HTTP error, bad payload).
    """
    if category == "instrument_keys":
        keys = [str(k) for k in (instrument_keys or []) if k][:MAX_INSTRUMENT_KEYS]
        if not keys:
            return []
    else:
        keys = []

    token = token or resolve_upstox_token()
    if not token:
        logger.info("upstox news: no access token available")
        return []

    params: dict[str, Any] = {
        "category": category,
        "page_number": max(1, min(int(page_number), 100)),
        "page_size": max(1, min(int(page_size), MAX_PAGE_SIZE)),
    }
    if keys:
        params["instrument_keys"] = ",".join(keys)

    try:
        resp = requests.get(
            UPSTOX_NEWS_URL,
            params=params,
            headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
            timeout=timeout,
        )
    except requests.RequestException as exc:
        logger.warning("upstox news request failed: %s", exc)
        return []

    if resp.status_code != 200:
        # 401 UDAPI100050 = expired/invalid token. Expected most days until the
        # user reconnects; not an error worth shouting about.
        logger.info("upstox news HTTP %s", resp.status_code)
        return []

    try:
        payload = resp.json()
    except ValueError:
        logger.warning("upstox news: non-JSON response")
        return []

    if not isinstance(payload, dict) or payload.get("status") != "success":
        logger.info("upstox news: status=%s", (payload or {}).get("status"))
        return []

    data = payload.get("data")
    if not isinstance(data, dict):
        return []

    out: list[dict[str, Any]] = []
    for instrument_key, items in data.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            heading = item.get("heading") or item.get("headline")
            if not heading:
                continue
            out.append(
                {
                    "instrument_key": instrument_key,
                    "heading": str(heading),
                    "summary": item.get("summary") or "",
                    "thumbnail": item.get("thumbnail") or "",
                    "article_link": item.get("article_link") or item.get("link") or "",
                    "published_time": item.get("published_time") or item.get("published_at"),
                    "source": "upstox",
                }
            )
    return out


def fetch_upstox_news_for_positions(
    *, token: Optional[str] = None, page_size: int = MAX_PAGE_SIZE
) -> list[dict[str, Any]]:
    """News for the account's open positions (no instrument keys needed)."""
    return fetch_upstox_news([], category="positions", token=token, page_size=page_size)


def ingest_upstox_news(
    *,
    instrument_keys: Optional[Iterable[str]] = None,
    category: str = "positions",
    token: Optional[str] = None,
    limit: int = 200,
) -> dict[str, int]:
    """Fetch Upstox news and UPSERT into `news_articles`.

    Dedupes on `url` (the column is UNIQUE). Best-effort: returns a small
    counter dict and never raises.

        {"fetched": n, "inserted": n, "skipped": n}
    """
    stats = {"fetched": 0, "inserted": 0, "skipped": 0}
    items = fetch_upstox_news(
        instrument_keys or [], category=category, token=token
    )
    if not items:
        return stats
    if limit:
        items = items[: int(limit)]
    stats["fetched"] = len(items)

    try:
        from datetime import datetime, timezone

        from db.database import SessionLocal
        from db.models.news import NewsArticle

        db = SessionLocal()
        try:
            for item in items:
                url = (item.get("article_link") or "").strip()
                heading = (item.get("heading") or "").strip()
                if not url or not heading:
                    stats["skipped"] += 1
                    continue
                if db.query(NewsArticle.id).filter(NewsArticle.url == url).first():
                    stats["skipped"] += 1
                    continue
                published = None
                ms = item.get("published_time")
                if isinstance(ms, (int, float)) and ms > 0:
                    published = datetime.fromtimestamp(float(ms) / 1000.0, tz=timezone.utc)
                db.add(
                    NewsArticle(
                        url=url,
                        headline=heading[:500],
                        content=item.get("summary") or None,
                        source="upstox",
                        source_url=url,
                        published_at=published,
                    )
                )
                stats["inserted"] += 1
            db.commit()
        finally:
            db.close()
    except Exception as exc:  # pragma: no cover - env dependent
        logger.warning("upstox news ingest failed: %s", exc)
    return stats

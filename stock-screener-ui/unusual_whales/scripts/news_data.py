#!/usr/bin/env python3
"""News headlines feed with ticker tags — data builder for the dashboard.

Wraps `/api/news/headlines`, which is live through the premarket and the
session (unlike options data, which only exists for completed sessions).
Keeps the fields the News views need and caches briefly so the browser stays
fast and the UW quota is respected.
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402
import market_status  # noqa: E402

_CACHE: dict = {"ts": 0.0, "key": "", "payload": None}
MAX_LIMIT = 120


def _rows(client: UWClient, path: str, **params):
    try:
        r = client.get(path, timeout=30, **params)
        if r.status_code != 200:
            return []
        j = r.json()
        data = j.get("data") if isinstance(j, dict) else j
        if isinstance(data, dict):
            return [data]
        return data or []
    except Exception:  # noqa: BLE001
        return []


def _tickers(r) -> list[str]:
    t = r.get("tickers") or []
    if isinstance(t, str):
        t = [t]
    out: list[str] = []
    for x in t:
        x = str(x or "").strip().upper()
        if x and x not in out:
            out.append(x)
    return out


def _item(r: dict) -> dict:
    headline = str(r.get("headline") or "").strip()
    created = r.get("created_at")
    return {
        # stable id for "seen" tracking on the client (the API sends none)
        "id": f"{created}|{headline[:90]}",
        "created_at": created,
        "source": r.get("source"),
        "headline": headline,
        "tickers": _tickers(r),
        "tags": r.get("tags") or [],
        "is_major": bool(r.get("is_major")),
        "sentiment": (r.get("sentiment") or "").lower() or None,
        "meta": r.get("meta") or {},
    }


def build_news(ticker: str | None = None, q: str | None = None,
               major_only: bool = False, limit: int = 60) -> dict:
    """Return headline items (newest first) with ticker tags."""
    ticker = (ticker or "").strip().upper() or None
    q = (q or "").strip() or None
    limit = max(1, min(int(limit or 60), MAX_LIMIT))
    key = f"{ticker or ''}|{q or ''}|{int(bool(major_only))}|{limit}"
    now = time.time()
    if _CACHE["payload"] is not None and _CACHE["key"] == key and now - _CACHE["ts"] < market_status.ttl():
        return _CACHE["payload"]

    params: dict = {"limit": limit}
    if major_only:
        params["major_only"] = "true"
    if ticker:
        params["ticker"] = ticker
    if q:
        params["search_term"] = q

    try:
        client = UWClient()
        items = [_item(r) for r in _rows(client, "/api/news/headlines", **params)]
    except Exception:  # noqa: BLE001
        items = []
    items = [it for it in items if it["headline"]]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ticker": ticker,
        "query": q,
        "major_only": bool(major_only),
        "count": len(items),
        "items": items,
    }
    _CACHE.update(ts=now, key=key, payload=payload)
    return payload


if __name__ == "__main__":
    import json

    t = sys.argv[1] if len(sys.argv) > 1 else None
    print(json.dumps(build_news(ticker=t), indent=2)[:1200])

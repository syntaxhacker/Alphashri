"""Index breadth for the Nifty desk — 5 indices, one cached quote call.

The desk check has always printed breadth; the report tab did not, so a narrow
rally (index up, smallcaps down) looked the same as a broad one. This endpoint
reuses the same Upstox quote path and caches for 60s so a 20px strip can poll it
without touching the rate budget.

Never raises: a missing token or a failed call returns ``available: false`` and
the strip renders nothing.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/api/reports", tags=["reports"])

# (label, Upstox instrument key) — same set the desk check uses.
KEYS: tuple[tuple[str, str], ...] = (
    ("NIFTY", "NSE_INDEX|Nifty 50"),
    ("BANK", "NSE_INDEX|Nifty Bank"),
    ("MID", "NSE_INDEX|NIFTY MIDCAP 150"),
    ("SMALL", "NSE_INDEX|Nifty Smallcap 500"),
    ("BROAD", "NSE_INDEX|Nifty 500"),
)

_TTL_SECONDS = 60.0
_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def _fetch() -> dict[str, Any]:
    from scripts import upstox_common

    joined = ",".join(key for _, key in KEYS)
    data: dict[str, Any] = {}
    try:
        payload = upstox_common.get(
            "/market-quote/quotes",
            {"instrument_key": joined},
            timeout=8.0,
        )
        data = payload.get("data") or {}
    except Exception:
        data = {}

    rows: list[dict[str, Any]] = []
    for label, key in KEYS:
        # Upstox echoes the quote map with ':' separators even when the request
        # used '|' (NSE_INDEX:Nifty 50) — accept both spellings.
        row = data.get(key) or data.get(key.replace("|", ":")) or {}
        last = row.get("last_price")
        ohlc = row.get("ohlc") or {}
        close = ohlc.get("close")
        net = row.get("net_change")
        try:
            last = float(last) if last is not None else None
            close = float(close) if close is not None else None
            net = float(net) if net is not None else None
        except (TypeError, ValueError):
            last = close = net = None
        # After the session the quote's `ohlc.close` IS the close, so the only
        # usable day change is `net_change` (last − prev close).
        if last is not None and net is not None:
            prev = last - net
            pct = (net / prev * 100.0) if prev else None
        else:
            pct = ((last - close) / close * 100.0) if last and close else None
        rows.append(
            {
                "label": label,
                "last": round(last, 2) if last is not None else None,
                "close": round(last - net, 2) if last is not None and net is not None else (
                    round(close, 2) if close is not None else None
                ),
                "change_pct": round(pct, 2) if pct is not None else None,
            }
        )

    priced = [r for r in rows if r["change_pct"] is not None]
    up = sum(1 for r in priced if (r["change_pct"] or 0) > 0)
    return {
        "available": len(priced) > 0,
        "rows": rows,
        "up": up,
        "count": len(priced),
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


@router.get("/breadth")
def get_breadth() -> dict[str, Any]:
    """Cached index breadth (60s). Shape: rows[label,last,close,change_pct]."""
    now = time.time()
    if _cache["payload"] is None or now - float(_cache["at"]) > _TTL_SECONDS:
        _cache["payload"] = _fetch()
        _cache["at"] = now
    return _cache["payload"]

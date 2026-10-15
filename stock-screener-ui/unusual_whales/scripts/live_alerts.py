#!/usr/bin/env python3
"""Live intraday alert stream — sweeps, unusual prints and dark-pool blocks.

Unlike `/api/market/oi-change` (which the spec says updates *once* a day around
06:45 ET), these sources are real-time during the session, so this is the fast
alert feed that rings the bell while the market is open.

Sources (all free-tier working):
  /api/option-trades/flow-alerts     rule-based tape alerts (sweeps / repeated hits)
  /api/option-activity/unusual       live "unusual options flow" contracts
  /api/darkpool/recent               latest off-exchange blocks

Each row is normalised to one shape so the UI can mix kinds in a single feed.
"""
from __future__ import annotations

import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402
import alert_store  # noqa: E402
import asset_class as AC  # noqa: E402
import market_status  # noqa: E402

_CACHE: dict = {"ts": 0.0, "key": "", "payload": None}
# fast while open; these feeds are worthless to hammer when shut
_TTL = {"open": 15, "premarket": 45, "afterhours": 60, "closed": 300}
DEFAULT_MIN = 250_000
KINDS = ("flow", "unusual", "darkpool")
MAX_ALERTS = 80


def _f(v, d=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return d
    return f if math.isfinite(f) else d


def _rows(client, path, **params):
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


def _side(type_, ask, bid):
    """Aggressive side: which side paid the premium (call+buy = bullish)."""
    t = str(type_ or "").lower()
    if ask <= 0 and bid <= 0:
        return t
    aggro = ask >= bid
    if t == "call":
        return "bullish" if aggro else "bearish"
    if t == "put":
        return "bearish" if aggro else "bullish"
    return "buy" if aggro else "sell"


def _flow(r):
    prem = _f(r.get("total_premium"))
    if prem <= 0:
        return None
    ask, bid = _f(r.get("total_ask_side_prem")), _f(r.get("total_bid_side_prem"))
    typ = str(r.get("type") or "").lower()
    return {
        "id": "flow:" + str(r.get("id") or f"{r.get('created_at')}|{r.get('option_chain')}|{prem}"),
        "kind": "flow",
        "ticker": str(r.get("ticker") or "").upper(),
        "created_at": r.get("created_at"),
        "premium": prem,
        "type": typ,
        "strike": r.get("strike"),
        "expiry": r.get("expiry"),
        "contract": r.get("option_chain"),
        "sweep": bool(r.get("has_sweep")),
        "multileg": bool(r.get("has_multileg")),
        "opening": bool(r.get("all_opening_trades")),
        "rule": r.get("alert_rule"),
        "size": int(_f(r.get("total_size"))),
        "volume": int(_f(r.get("volume"))),
        "oi": int(_f(r.get("open_interest"))),
        "vol_oi": _f(r.get("volume_oi_ratio")),
        "delta": _f(r.get("delta")),
        "iv": _f(r.get("iv")),
        "underlying": _f(r.get("underlying_price")),
        "ask_prem": ask,
        "bid_prem": bid,
        "side": _side(typ, ask, bid),
        "sector": r.get("sector"),
        "asset_class": AC.classify(str(r.get("ticker") or ""), r.get("issue_type")),
        "issue_type": r.get("issue_type"),
        "note": r.get("alert_rule"),
    }


def _unusual(r):
    prem = _f(r.get("premium"))
    if prem <= 0:
        return None
    ask, bid = _f(r.get("ask_side_volume")), _f(r.get("bid_side_volume"))
    typ = str(r.get("option_type") or "").lower()
    return {
        "id": "unusual:" + str(r.get("option_symbol") or "") + "|" + str(r.get("last_fill") or ""),
        "kind": "unusual",
        "ticker": str(r.get("ticker_symbol") or r.get("underlying_symbol") or "").upper(),
        "created_at": r.get("last_fill"),
        "premium": prem,
        "type": typ,
        "strike": r.get("strike"),
        "expiry": r.get("expiry"),
        "contract": r.get("option_symbol"),
        "sweep": bool(_f(r.get("sweep_volume"))),
        "multileg": False,
        "opening": bool(r.get("is_new")),
        "rule": "unusual",
        "size": int(_f(r.get("volume"))),
        "volume": int(_f(r.get("volume"))),
        "oi": int(_f(r.get("open_interest"))),
        "vol_oi": None,
        "delta": _f(r.get("delta")),
        "iv": None,
        "iv_change": _f(r.get("iv_change")),
        "underlying": _f(r.get("stock_price")),
        "ask_prem": ask,
        "bid_prem": bid,
        "side": _side(typ, ask, bid),
        "sector": r.get("sector"),
        "asset_class": AC.classify(str(r.get("ticker_symbol") or r.get("underlying_symbol") or ""), r.get("issue_type")),
        "issue_type": r.get("issue_type"),
        "note": "unusual",
    }


def _darkpool(r):
    prem = _f(r.get("premium"))
    if prem <= 0:
        return None
    return {
        "id": "dp:" + str(r.get("tracking_id") or f"{r.get('ticker')}|{r.get('executed_at')}|{r.get('price')}|{r.get('size')}"),
        "kind": "darkpool",
        "ticker": str(r.get("ticker") or "").upper(),
        "created_at": r.get("executed_at"),
        "premium": prem,
        "type": "",
        "strike": None,
        "expiry": "",
        "contract": "",
        "sweep": False,
        "multileg": False,
        "opening": False,
        "rule": "darkpool",
        "size": int(_f(r.get("size"))),
        "volume": int(_f(r.get("volume"))),
        "oi": 0,
        "vol_oi": None,
        "delta": 0.0,
        "iv": None,
        "underlying": _f(r.get("price")),
        "price": _f(r.get("price")),
        "ask_prem": 0, "bid_prem": 0,
        "side": "ext" if r.get("ext_hour_sold_codes") else "",
        "sector": None,
        "asset_class": AC.classify(str(r.get("ticker") or "")),
        "issue_type": None,
        "note": "darkpool",
    }


def build_live_alerts(min_premium: int = DEFAULT_MIN, kinds: str = "flow,unusual,darkpool", max_age=None) -> dict:
    min_premium = max(0, int(_f(min_premium, DEFAULT_MIN)))
    want = tuple(k.strip() for k in str(kinds or "flow,unusual,darkpool").split(",") if k.strip() in KINDS) or KINDS
    key = f"{min_premium}|{','.join(want)}"
    now = time.time()
    if max_age is None:
        ttl = _TTL.get(market_status.phase(), 60)
    else:
        # explicit override: max_age=0 forces a fresh rebuild every call
        ttl = max(0.0, _f(max_age, 0.0))
    if _CACHE["payload"] is not None and _CACHE["key"] == key and now - _CACHE["ts"] < ttl:
        return _CACHE["payload"]

    client = None
    try:
        client = UWClient()
    except Exception:  # noqa: BLE001
        client = None

    alerts: list = []
    if client is not None:
        if "flow" in want:
            for r in _rows(client, "/api/option-trades/flow-alerts", limit=200, min_premium=min_premium):
                a = _flow(r)
                if a and a["premium"] >= min_premium:
                    alerts.append(a)
        if "unusual" in want:
            for r in _rows(client, "/api/option-activity/unusual", limit=150, min_premium=min_premium):
                a = _unusual(r)
                if a and a["premium"] >= min_premium:
                    alerts.append(a)
        if "darkpool" in want:
            # min_premium on this route is unreliable — fetch recent and filter locally
            for r in _rows(client, "/api/darkpool/recent", limit=200):
                a = _darkpool(r)
                if a and a["premium"] >= min_premium:
                    alerts.append(a)

    # dedupe by id, newest first then biggest premium
    seen: set = set()
    uniq = []
    for a in alerts:
        if a["id"] in seen:
            continue
        seen.add(a["id"])
        uniq.append(a)
    uniq.sort(key=lambda a: (str(a.get("created_at") or ""), a["premium"]), reverse=True)

    # "unusual" is a CONTRACT-level view, so the same option can be re-reported as
    # its stats update — collapse to the newest row per contract so it isn't listed
    # twice. (Flow alerts stay per-trade; dark pool stays per-print.)
    collapsed: dict = {}
    out: list = []
    for a in uniq:
        if a["kind"] == "unusual":
            key = a.get("contract") or a["id"]
            prev = collapsed.get(key)
            if prev is None or str(a.get("created_at") or "") >= str(prev.get("created_at") or ""):
                collapsed[key] = a
        else:
            out.append(a)
    uniq = sorted(out + list(collapsed.values()), key=lambda a: (str(a.get("created_at") or ""), a["premium"]), reverse=True)

    counts = {k: sum(1 for a in uniq if a["kind"] == k) for k in KINDS}
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "phase": market_status.phase(),
        "min_premium": min_premium,
        "kinds": list(want),
        "counts": counts,
        "total": len(uniq),
        "alerts": uniq[:MAX_ALERTS],
    }
    _CACHE.update(payload=payload, ts=now, key=key)
    try:
        alert_store.upsert(payload["alerts"], "live")
    except Exception:  # noqa: BLE001
        pass
    return payload


if __name__ == "__main__":
    import json

    d = build_live_alerts()
    print(json.dumps({"counts": d["counts"], "total": d["total"], "phase": d["phase"]}, indent=2))
    for a in d["alerts"][:5]:
        print(a["kind"], a["ticker"], a["type"], a["premium"], a["sweep"], a["created_at"])

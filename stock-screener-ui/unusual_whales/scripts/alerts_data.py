#!/usr/bin/env python3
"""OI-change alerts — market-wide fresh open-interest builds, ranked by severity.

Wraps `/api/market/oi-change` (biggest open-interest jumps vs the prior
session) and turns each row into a notification-shaped alert:

    {id, ticker, contract, type, expiry, strike, oi_ratio, oi_delta,
     curr_oi, last_oi, volume, vol_oi, premium, notional, severity, ...}

NOTE: options (and therefore open interest) only exist for *completed*
sessions. Premarket the list reflects the most recent session — that is the
freshest positioning available before the open.
"""
from __future__ import annotations

import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402
import alert_store  # noqa: E402
import asset_class as AC  # noqa: E402
import market_status  # noqa: E402

_CACHE: dict = {"ts": 0.0, "payload": None}
# OI updates once/day (~06:45 ET), so this cache is deliberately slow; the fast
# stream lives in live_alerts.py (/api/live).
_TTL = {"open": 600, "premarket": 300, "afterhours": 600, "closed": 1800}
MAX_ALERTS = 60

# `/api/market/oi-change` rejects `limit >= 200` on this tier (a 400 request
# returns HTTP 422), so we ask for breadth first and fall back to the largest
# accepted value. `offset` is IGNORED upstream (page 2 returns the identical
# page 1), so we deliberately do NOT page — paging would only duplicate rows.
OI_LIMIT_ATTEMPTS = (400, 200, 150)

# Native (account) alerts have their own short-lived cache — they are cheap but
# we still avoid hammering UW when the UI polls. Kept separate from the OI
# cache so either feed can refresh on its own cadence.
_NATIVE_CACHE: dict = {"ts": 0.0, "payload": None}
_NATIVE_TTL = {"open": 30, "premarket": 45, "afterhours": 90, "closed": 300}
NATIVE_LIMIT = 50
_SYM_RE = re.compile(r"^(?P<t>[A-Z.]+?)(?P<d>\d{6})(?P<cp>[CP])(?P<s>\d{8})$")

_SEV_RANK = {"critical": 3, "high": 2, "watch": 1}


def _f(v, d=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return d
    return f if math.isfinite(f) else d


def _safe_alert(r):
    """_alert must never raise — one bad row must not 500 the whole feed."""
    try:
        return _alert(r)
    except Exception:  # noqa: BLE001
        return None


def _parse_contract(symbol: str) -> dict:
    """NVDA260925C00225000 -> {type, expiry, strike}."""
    m = _SYM_RE.match(str(symbol or "").upper())
    if not m:
        cp = "C" if "C0" in str(symbol) else ("P" if "P0" in str(symbol) else "")
        return {"type": "call" if cp == "C" else ("put" if cp == "P" else ""), "expiry": "", "strike": None}
    d = m.group("d")
    expiry = f"20{d[0:2]}-{d[2:4]}-{d[4:6]}"
    strike = _f(m.group("s")) / 1000.0
    return {"type": "call" if m.group("cp") == "C" else "put", "expiry": expiry, "strike": strike}


def _severity(oi_ratio: float, oi_delta: float, volume: float) -> str:
    if oi_delta >= 30000 and volume >= 25000:
        return "critical"
    if oi_ratio >= 5.0 and oi_delta >= 5000 and volume >= 10000:
        return "critical"
    if (oi_delta >= 15000 and volume >= 15000) or (oi_ratio >= 3.0 and volume >= 15000):
        return "high"
    return "watch"


def _alert(r: dict) -> dict | None:
    oi_ratio = _f(r.get("oi_change"))
    oi_delta = _f(r.get("oi_diff_plain"))
    volume = _f(r.get("volume"))
    curr_oi = _f(r.get("curr_oi"))
    last_oi = _f(r.get("last_oi"))
    if oi_delta <= 0:  # only fresh/added open interest
        return None
    parsed = _parse_contract(r.get("option_symbol"))
    avg = _f(r.get("avg_price"))
    premium = _f(r.get("prev_total_premium"))
    sev = _severity(oi_ratio, oi_delta, volume)
    return {
        "id": f"{r.get('option_symbol')}|{r.get('curr_date')}",
        "ticker": str(r.get("underlying_symbol") or "").upper(),
        "contract": r.get("option_symbol"),
        "type": parsed["type"],
        "expiry": parsed["expiry"],
        "strike": parsed["strike"],
        "oi_ratio": round(oi_ratio, 2),
        "oi_delta": int(oi_delta),
        "curr_oi": int(curr_oi),
        "last_oi": int(last_oi),
        "volume": int(volume),
        "trades": int(_f(r.get("trades"))),
        "vol_oi": round(volume / curr_oi, 2) if curr_oi else None,
        "premium": premium,
        "notional": int(oi_delta * avg * 100),  # approx $ of the fresh OI
        "avg_price": round(avg, 3),
        "days_of_oi_increases": int(_f(r.get("days_of_oi_increases"))),
        "severity": sev,
        "session": r.get("curr_date"),
        "kind": "oi",
        "asset_class": AC.classify(str(r.get("underlying_symbol") or "")),
        "score": round(oi_ratio * (volume ** 0.5), 1),  # ratio weighted by activity
    }


def _s(v) -> str:
    """Coerce any JSON value to a trimmed string; never raises."""
    if v is None or isinstance(v, bool):
        return "" if v is None else ("true" if v else "false")
    if isinstance(v, (list, tuple)):
        for x in v:
            s = _s(x)
            if s:
                return s
        return ""
    if isinstance(v, dict):
        return ""
    try:
        return str(v).strip()
    except Exception:  # noqa: BLE001
        return ""


def _obj(v) -> dict:
    return v if isinstance(v, dict) else {}


def _norm_native_alert(row) -> dict:
    """Defensively shape one `/api/alerts` row into a stable dict.

    UW has changed key names across versions, so we accept the common aliases
    (ticker/ticker_symbol/symbol/underlying_symbol, message/description/body,
    noti_type/type/alert_type, ...) and always return the same keys. Any input
    type is tolerated — this function never raises.
    """
    r = _obj(row)
    raw_cfg = r.get("config")
    config_name = _s(r.get("config_name") or r.get("configuration_name"))
    if not config_name:
        config_name = _s(raw_cfg.get("name")) if isinstance(raw_cfg, dict) else _s(raw_cfg)
    title = _s(r.get("title") or r.get("headline"))
    message = _s(
        r.get("message")
        or r.get("description")
        or r.get("body")
        or r.get("text")
        or r.get("content")
        or title
    )
    return {
        "id": _s(r.get("id") or r.get("alert_id") or r.get("uuid") or r.get("_id")),
        "created_at": _s(
            r.get("created_at")
            or r.get("created")
            or r.get("timestamp")
            or r.get("time")
            or r.get("date")
        ),
        "ticker": _s(
            r.get("ticker")
            or r.get("ticker_symbol")
            or r.get("symbol")
            or r.get("underlying_symbol")
            or r.get("tickers")
        ).upper(),
        "noti_type": _s(r.get("noti_type") or r.get("type") or r.get("alert_type")),
        "title": title,
        "message": message,
        "config_name": config_name,
    }


def _norm_config(row) -> dict:
    """Defensively shape one `/api/alerts/configuration` row; never raises."""
    r = _obj(row)
    return {
        "id": _s(r.get("id") or r.get("config_id")),
        "name": _s(r.get("name") or r.get("title")),
        "noti_type": _s(r.get("noti_type") or r.get("type")),
        "status": _s(r.get("status")) or "unknown",
        "description": _s(r.get("description")),
        "created_at": _s(r.get("created_at")),
        "updated_at": _s(r.get("updated_at")),
        "config": _obj(r.get("config")),
    }


def _norm_filters(payload) -> list:
    """Compact the `/api/alerts/filters` catalogue into a stable list.

    The endpoint is a dict of dicts; we flatten the useful bits into
    `{type, description, enabled}` rows. Any shape is tolerated.
    """
    j = _obj(payload)
    desc = _obj(j.get("noti_type_descriptions"))
    access = _obj(j.get("access"))
    keys = set(desc.keys()) | set(access.keys())
    out = []
    for k in sorted(keys):
        out.append(
            {
                "type": _s(k),
                "description": _s(desc.get(k)),
                # absent access map -> assume available rather than hide it
                "enabled": bool(access.get(k, True)) if access else True,
            }
        )
    return out


def _rows_from(payload) -> list:
    """Extract a list of rows from a `{data:[...]}` or bare-array response."""
    if isinstance(payload, dict):
        rows = payload.get("data")
    else:
        rows = payload
    if isinstance(rows, dict):
        return [rows]
    return rows if isinstance(rows, list) else []


def _fetch(client, path: str, **params) -> object:
    """GET and return parsed JSON, or None on any failure."""
    try:
        r = client.get(path, timeout=30, **params)
        if getattr(r, "status_code", None) == 200:
            return r.json()
    except Exception:  # noqa: BLE001
        return None
    return None


def _fetch_oi_rows(client) -> list:
    """Fetch `/api/market/oi-change` rows, tolerating the upstream `limit` cap.

    Tries ever-smaller limits (see `OI_LIMIT_ATTEMPTS`) until one is accepted;
    the first non-empty page wins. Returns [] when every attempt fails.
    """
    for lim in OI_LIMIT_ATTEMPTS:
        try:
            r = client.get("/api/market/oi-change", limit=lim, timeout=45)
        except Exception:  # noqa: BLE001
            continue
        if getattr(r, "status_code", None) != 200:
            continue
        try:
            j = r.json()
        except Exception:  # noqa: BLE001
            continue
        rows = j.get("data") if isinstance(j, dict) else j
        if isinstance(rows, dict):
            rows = [rows]
        if rows:
            return rows
    return []


def build_native_alerts(limit: int = NATIVE_LIMIT) -> dict:
    """Unusual Whales' own account alerts + configurations.

    Returns `{generated_at, count, configured, filters, alerts, note}`. The
    account may have zero alert configs (then everything degrades to empty
    lists) or zero fired alerts even when configs exist — callers must handle
    both. Fully defensive: a UW outage yields an empty payload, never raises.
    """
    now = time.time()
    if _NATIVE_CACHE["payload"] is not None and now - _NATIVE_CACHE["ts"] < _NATIVE_TTL.get(market_status.phase(), 45):
        payload = _NATIVE_CACHE["payload"]
    else:
        alerts: list = []
        configured: list = []
        filters: list = []
        client = None
        try:
            client = UWClient()
        except Exception:  # noqa: BLE001
            client = None
        if client is not None:
            j = _fetch(client, "/api/alerts", limit=limit)
            alerts = [_norm_native_alert(x) for x in _rows_from(j)] if j is not None else []
            j = _fetch(client, "/api/alerts/configuration")
            configured = [_norm_config(x) for x in _rows_from(j)] if j is not None else []
            j = _fetch(client, "/api/alerts/filters")
            filters = _norm_filters(j) if j is not None else []
        alerts = alerts[:limit]

        if not alerts and not configured:
            note = "0 native alerts — no alert configurations on this account"
        elif not alerts:
            note = f"0 native alerts — {len(configured)} configuration(s) on this account, none fired yet"
        else:
            note = f"{len(alerts)} native alert(s)"

        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(alerts),
            "configured": configured,
            "filters": filters,
            "alerts": alerts,
            "note": note,
        }
        _NATIVE_CACHE.update(ts=now, payload=payload)

    return {
        "generated_at": payload["generated_at"],
        "count": payload["count"],
        "configured": payload["configured"],
        "filters": payload["filters"],
        "alerts": payload["alerts"],
        "note": payload["note"],
    }


def build_alerts(min_severity: str = "watch", limit: int = MAX_ALERTS) -> dict:
    now = time.time()
    if _CACHE["payload"] is not None and now - _CACHE["ts"] < _TTL.get(market_status.phase(), 60):
        payload = _CACHE["payload"]
    else:
        rows: list = []
        try:
            rows = _fetch_oi_rows(UWClient())
        except Exception:  # noqa: BLE001
            rows = []
        alerts = [a for a in (_safe_alert(x) for x in (rows or [])) if a]
        alerts.sort(key=lambda a: (-_SEV_RANK[a["severity"]], -a["oi_delta"]))
        by_ticker: dict = {}
        for a in alerts:
            b = by_ticker.setdefault(a["ticker"], {"ticker": a["ticker"], "count": 0, "max_severity": "watch", "oi_delta": 0})
            b["count"] += 1
            b["oi_delta"] += a["oi_delta"]
            if _SEV_RANK[a["severity"]] > _SEV_RANK[b["max_severity"]]:
                b["max_severity"] = a["severity"]
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "session": alerts[0]["session"] if alerts else None,
            "counts": {s: sum(1 for a in alerts if a["severity"] == s) for s in _SEV_RANK},
            "tickers": sorted(by_ticker.values(), key=lambda b: (-_SEV_RANK[b["max_severity"]], -b["oi_delta"])),
            "alerts": alerts,
        }
        _CACHE.update(payload=payload, ts=now)
        try:
            alert_store.upsert(payload["alerts"], "oi")
        except Exception:  # noqa: BLE001
            pass

    floor = _SEV_RANK.get(min_severity, 1)
    alerts = [a for a in payload["alerts"] if _SEV_RANK[a["severity"]] >= floor][:limit]
    native = build_native_alerts()
    return {
        "generated_at": payload["generated_at"],
        "session": payload["session"],
        "counts": payload["counts"],
        "total": len(payload["alerts"]),
        "tickers": payload["tickers"][:40],
        "alerts": alerts,
        # --- new keys appended (existing keys/values above are untouched) ---
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        # Native account alerts (Unusual Whales' own feed). `native` is the
        # canonical key; `nat` is a short alias kept for convenience.
        "native": native,
        "nat": native,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(build_alerts(), indent=2)[:1500])

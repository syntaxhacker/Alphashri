#!/usr/bin/env python3
"""Market-wide options sentiment data for the Market Pulse view.

Pulls a handful of Unusual Whales market-wide endpoints, normalises them into a
single JSON-safe payload, and caches it for a short TTL so the browser stays
snappy. Every upstream call is best-effort: any failure degrades that section to
an empty value instead of breaking the whole view.
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402
import market_status  # noqa: E402

_CACHE: dict = {"ts": 0.0, "payload": None}
_TTL = {"open": 40, "premarket": 60, "afterhours": 90, "closed": 300}

_INF = float("inf")


# --------------------------------------------------------------------------- #
# pure helpers (offline / unit-testable)
# --------------------------------------------------------------------------- #
def _num(v):
    """Coerce a value to a finite float; None when it is not numeric."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f == _INF or f == -_INF:  # NaN / ±inf
        return None
    return f


def _list(payload):
    """Extract a list from a UW payload (`{data:[...]}`) or a bare list."""
    d = payload.get("data") if isinstance(payload, dict) else payload
    return d if isinstance(d, list) else []


def _obj(payload):
    """Extract a dict from a UW payload (`{data:{...}}`) or a bare dict."""
    d = payload.get("data") if isinstance(payload, dict) else payload
    return d if isinstance(d, dict) else {}


def _pulse_latest(raw):
    """Normalise the `latest` pulse object, adding a put/call txn ratio."""
    r = raw if isinstance(raw, dict) else {}
    call = _num(r.get("call_txn"))
    put = _num(r.get("put_txn"))
    ratio = (put / call) if put is not None and call not in (None, 0) else None
    return {
        "date": r.get("trd_dt") or "",
        "hr_min": r.get("hr_min") or "",
        "call_txn": call,
        "put_txn": put,
        "put_call_ratio": ratio,
        "sntm_score": _num(r.get("sntm_score")),
        "intvl_sntm_score": _num(r.get("intvl_sntm_score")),
        "mkt_sntm": _num(r.get("mkt_sntm")),
    }


def _pulse_intraday(rows):
    """Normalise the intraday pulse series, ordered by time label."""
    out = []
    for r in _list(rows):
        if not isinstance(r, dict):
            continue
        out.append(
            {
                "hr_min": r.get("hr_min") or "",
                "call_txn": _num(r.get("call_txn")),
                "put_txn": _num(r.get("put_txn")),
                "sntm_score": _num(r.get("sntm_score")),
                "intvl_sntm_score": _num(r.get("intvl_sntm_score")),
                "mkt_sntm": _num(r.get("mkt_sntm")),
            }
        )
    out.sort(key=lambda x: x["hr_min"])
    return out


def _sentiment_row(r):
    """Normalise one option-sentiment name (top-level fields win over components)."""
    comp = r.get("components") if isinstance(r.get("components"), dict) else {}
    avar = comp.get("avar") if isinstance(comp.get("avar"), dict) else {}
    vwks = comp.get("vwks") if isinstance(comp.get("vwks"), dict) else {}
    avar_v = _num(r.get("avar"))
    if avar_v is None:
        avar_v = _num(avar.get("value"))
    vwks_v = _num(r.get("vwks"))
    if vwks_v is None:
        vwks_v = _num(vwks.get("value"))
    return {
        "ticker": r.get("ticker") or "",
        "direction": str(r.get("direction") or "").lower(),
        "score": _num(r.get("score")),
        "avar": avar_v,
        "vwks": vwks_v,
        "sample_size": _num(r.get("sample_size")),
        "date": r.get("date") or "",
    }


def _sentiment_split(rows):
    """Split sentiment rows into bullish/bearish lists (other directions dropped)."""
    out = {"bullish": [], "bearish": []}
    for r in _list(rows):
        if not isinstance(r, dict):
            continue
        row = _sentiment_row(r)
        if row["direction"] in out:
            out[row["direction"]].append(row)
    return out


def _sector_rows(rows):
    """Normalise sector pulse rows, keep usable ones, sort by sentiment desc."""
    out = []
    for r in _list(rows):
        if not isinstance(r, dict):
            continue
        name = (r.get("classification") or "").strip()
        score = _num(r.get("sntm_score"))
        if not name or score is None:
            continue
        out.append(
            {
                "name": name,
                "category": (r.get("category") or "").strip(),
                "call_txn": _num(r.get("call_txn")),
                "put_txn": _num(r.get("put_txn")),
                "sntm_score": score,
                "intvl_sntm_score": _num(r.get("intvl_sntm_score")),
                "hr_min": r.get("hr_min") or "",
            }
        )
    out.sort(key=lambda x: x["sntm_score"], reverse=True)
    return out


def _volume_row(payload):
    """Normalise the single-row total-options-volume series."""
    rows = _list(payload)
    r = rows[0] if rows and isinstance(rows[0], dict) else {}
    call_v = _num(r.get("call_volume"))
    put_v = _num(r.get("put_volume"))
    if call_v is None and put_v is None:
        total = None
    else:
        total = (call_v or 0) + (put_v or 0)
    return {
        "date": r.get("date") or "",
        "call_volume": call_v,
        "put_volume": put_v,
        "call_premium": _num(r.get("call_premium")),
        "put_premium": _num(r.get("put_premium")),
        "call_share": (call_v / total) if total else None,
        "put_call_ratio": (put_v / call_v) if put_v is not None and call_v not in (None, 0) else None,
    }


# --------------------------------------------------------------------------- #
# network
# --------------------------------------------------------------------------- #
def _safe_get(client, path: str, **params) -> dict:
    """GET a UW endpoint; return {} on any error or non-200."""
    try:
        resp = client.get(path, timeout=30, **params)
        if resp.status_code == 200:
            return resp.json()
    except Exception:  # noqa: BLE001
        return {}
    return {}


def build_pulse() -> dict:
    """Build the cached Market Pulse payload (never raises)."""
    now = time.time()
    if _CACHE["payload"] is not None and now - _CACHE["ts"] < _TTL.get(market_status.phase(), 60):
        return _CACHE["payload"]

    pulse: dict = {"latest": _pulse_latest({}), "intraday": []}
    volume: dict = _volume_row({})
    sentiment: dict = {"bullish": [], "bearish": []}
    sectors: list = []
    usage: dict = {}

    try:
        client = UWClient()
    except Exception:  # noqa: BLE001
        client = None

    if client is not None:
        raw_pulse = _safe_get(client, "/api/options-pulse/total")
        raw_sectors = _safe_get(client, "/api/options-pulse/sectors")
        raw_bull = _safe_get(client, "/api/volatility/option-sentiment/top", limit=25, direction="bullish")
        raw_bear = _safe_get(client, "/api/volatility/option-sentiment/top", limit=25, direction="bearish")
        raw_volume = _safe_get(client, "/api/market/total-options-volume")

        try:
            usage = client.usage() or {}
        except Exception:  # noqa: BLE001
            usage = client.last_usage or {}

        pdata = _obj(raw_pulse)
        pulse = {
            "latest": _pulse_latest(pdata.get("latest")),
            "intraday": _pulse_intraday(pdata.get("intraday")),
        }
        sectors = _sector_rows(raw_sectors)
        sentiment = _sentiment_split(_list(raw_bull) + _list(raw_bear))
        volume = _volume_row(raw_volume)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "usage": usage,
        "pulse": pulse,
        "volume": volume,
        "sentiment": sentiment,
        "sectors": sectors,
    }
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload


if __name__ == "__main__":  # pragma: no cover - manual smoke
    import json

    print(json.dumps(build_pulse(), indent=2)[:4000])

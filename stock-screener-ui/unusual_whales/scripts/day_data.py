#!/usr/bin/env python3
"""Day-trader board data — reshaped from the cached snapshot + opps builders.

Adds ZERO new API calls: build_snapshot() and build_opps() both cache.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from opps_data import build_opps  # noqa: E402
from snapshot_data import build_snapshot  # noqa: E402

_CACHE: dict = {"ts": 0.0, "payload": None}
_TTL = 120


def _f(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def build_day() -> dict:
    now = time.time()
    if _CACHE["payload"] is not None and now - _CACHE["ts"] < _TTL:
        return _CACHE["payload"]
    snap = build_snapshot()
    opps = build_opps()
    s = snap.get("sections", {})
    rows = opps.get("rows") or []

    def top(key, n=12, rev=True, flt=None):
        r = [x for x in rows if (flt(x) if flt else True) and x.get(key) is not None]
        return sorted(r, key=lambda x: _f(x.get(key)), reverse=rev)[:n]

    squeeze = [
        {"ticker": r.get("ticker"), "si_float": r.get("short_int"), "day": r.get("one_day_perc"), "relvol": r.get("relative_volume")}
        for r in top("short_int", 12, flt=lambda r: (r.get("short_int") or 0) > 0.01)
    ]
    longs = [
        {"ticker": r.get("ticker"), "net_premium": r.get("net_premium"), "day": r.get("one_day_perc")}
        for r in top("net_premium", 8)
    ]
    shorts_bias = [
        {"ticker": r.get("ticker"), "net_premium": r.get("net_premium"), "day": r.get("one_day_perc")}
        for r in top("net_premium", 8, rev=False)
    ]
    gainers = [
        {"ticker": r.get("ticker"), "day": r.get("one_day_perc"), "relvol": r.get("relative_volume")}
        for r in top("one_day_perc", 8)
    ]
    losers = [
        {"ticker": r.get("ticker"), "day": r.get("one_day_perc"), "relvol": r.get("relative_volume")}
        for r in top("one_day_perc", 8, rev=False)
    ]
    uvol = [
        {"ticker": r.get("ticker"), "relvol": r.get("relative_volume"), "day": r.get("one_day_perc")}
        for r in top("relative_volume", 12)
    ]
    payload = {
        "generated_at": snap.get("generated_at"),
        "usage": snap.get("usage"),
        "sections": {
            "squeeze": squeeze,
            "longs": longs,
            "shorts_bias": shorts_bias,
            "gainers": gainers,
            "losers": losers,
            "uvol": uvol,
            "oi_change": s.get("oi_change") or [],
            "darkpool": s.get("darkpool") or [],
            "unusual": s.get("unusual") or [],
        },
    }
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload

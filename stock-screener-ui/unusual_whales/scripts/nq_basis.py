#!/usr/bin/env python3
"""MNQ dealer levels — Nasdaq (NDX) gamma walls translated into MNQ futures terms.

Why this exists
---------------
``/api/stock/NDX/gex-levels`` returns the Nasdaq call wall / put wall / gamma
flip / magnet in **NDX index points**, but MNQ quotes in **futures points**.
The two differ by the futures basis (index carry + premium), ~+290 pts in
Sep-2026. Reading 30400 off the dashboard and treating it as a futures level is
off by ~40-55 MNQ points near the wall — enough to change the trade.

This module bridges the two feeds:

* UW  -> NDX call wall / put wall / gamma flip / magnet
* UW  -> NDX cash estimate (QQQ live x most recent NDX/QQQ daily ratio, because
        ``/api/stock/NDX/stock-state`` 422s on this plan — same workaround as
        ``snapshot_data.py``)
* MotiveWave/Rithmic -> live MNQ futures price (``mw_tickstore``)

and emits the levels in MNQ points with the distance to each one.

Read-only. No orders, no writes to broker or data stores. Not investment advice.
"""
from __future__ import annotations

import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mw_tickstore import latest_tick, symbol_from  # noqa: E402

LEVEL_NAMES = (
    ("call_wall", "call wall"),
    ("gamma_flip", "gamma flip"),
    ("gamma_magnet", "magnet"),
    ("put_wall", "put wall"),
)


def _num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _get(client, path, **params):
    try:
        resp = client.get(path, **params)
        if resp.status_code != 200:
            return []
        data = resp.json().get("data")
        if isinstance(data, dict):
            return [data]
        return data or []
    except Exception:  # noqa: BLE001
        return []


def ndx_cash(client, ratio: float | None = None) -> dict:
    """Estimate NDX cash from QQQ x ratio (NDX has no live quote on this plan).

    Pass a cached ``ratio`` to skip the two /ohlc/1d calls — the NDX/QQQ ratio
    is a daily quantity, so a watcher should compute it once per day rather than
    on every poll.
    """
    qqq = _num((_get(client, "/api/stock/QQQ/stock-state") or [{}])[0].get("close"))
    if not qqq:
        return {"value": None, "qqq": None, "ratio": None}
    if ratio:
        return {"value": qqq * ratio, "qqq": qqq, "ratio": ratio, "ratio_cached": True}
    qqq_daily = {r.get("date"): _num(r.get("close")) for r in _get(client, "/api/stock/QQQ/ohlc/1d")}
    for row in _get(client, "/api/stock/NDX/ohlc/1d"):
        q = qqq_daily.get(row.get("date"))
        n = _num(row.get("close"))
        if q and n:
            ratio = n / q
            return {"value": qqq * ratio, "qqq": qqq, "ratio": ratio, "ratio_date": row.get("date")}
    return {"value": None, "qqq": qqq, "ratio": None}


def fetch_gex(client, ticker: str) -> dict | None:
    """One `/api/stock/{ticker}/gex-levels` row (current value only — no history)."""
    rows = _get(client, f"/api/stock/{ticker}/gex-levels")
    return rows[0] if rows else None


def mnq_levels(client, prefix: str = "MNQ", root: Path | None = None, *, ratio: float | None = None) -> dict:
    """Dealer levels in MNQ futures points, plus live price and regime."""
    out: dict = {
        "symbol": None,
        "instrument": None,
        "price": None,
        "price_age_s": None,
        "price_stale": False,
        "index_levels": {},
        "ndx_cash": None,
        "qqq": None,
        "ratio": None,
        "basis": None,
        "levels": [],
        "regime": None,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "errors": [],
    }

    gex_row = fetch_gex(client, "NDX")
    if not gex_row:
        out["errors"].append("ndx gex-levels unavailable")
    else:
        out["index_levels"] = {
            k: gex_row.get(k)
            for k in ("call_wall", "put_wall", "gamma_flip", "gamma_magnet")
        }
    gex = [gex_row] if gex_row else []
    ndx = ndx_cash(client, ratio=ratio)
    out["ndx_cash"] = round(ndx["value"], 1) if ndx.get("value") else None
    out["qqq"] = round(ndx["qqq"], 2) if ndx.get("qqq") else None
    out["ratio"] = round(ndx["ratio"], 4) if ndx.get("ratio") else None
    if not ndx.get("value"):
        out["errors"].append("ndx cash estimate unavailable")

    tick = latest_tick(prefix, root)
    if tick:
        out["symbol"] = symbol_from(tick.get("instrument", ""))
        out["instrument"] = tick.get("instrument")
        out["price"] = round(float(tick["price"]), 2)
        out["price_ts"] = tick.get("ts")
        age = (datetime.now(timezone.utc).timestamp() * 1000 - tick["ts"]) / 1000.0
        out["price_age_s"] = round(age, 1)
        out["price_source"] = "motivewave-tickstore"
        try:
            from mw_session import staleness

            st = staleness(prefix, root)
            out["price_stale"] = bool(st["stale"])
            out["market_open"] = bool(st["open"])
            if st["stale"]:
                out["errors"].append(st["reason"] or "feed stale")
        except Exception as exc:  # noqa: BLE001
            out["errors"].append(f"staleness check failed: {exc}")
    else:
        out["errors"].append(f"no live {prefix} price in the MotiveWave tick store")

    if ndx.get("value") and tick:
        out["basis"] = round(out["price"] - ndx["value"], 1)

    if gex and out.get("basis") is not None:
        basis = out["basis"]
        for key, label in LEVEL_NAMES:
            raw = _num(gex[0].get(key))
            if raw is None:
                continue
            mnq = raw + basis
            out["levels"].append(
                {
                    "key": key,
                    "label": label,
                    "ndx": round(raw, 2),
                    "mnq": round(mnq, 1),
                    "dist": round(mnq - out["price"], 1),
                }
            )
        flip = next((l for l in out["levels"] if l["key"] == "gamma_flip"), None)
        if flip and out.get("price") is not None:
            # The basis is derived from the futures price, so it cancels out of
            # this test: price >= (flip_ndx + basis)  <=>  ndx_cash >= flip_ndx.
            # i.e. the regime is really "where is NDX cash vs the NDX flip",
            # which is the economically correct framing (futures and cash move
            # together; only the basis is common to both sides).
            out["regime"] = "long-gamma" if out["price"] >= flip["mnq"] else "short-gamma"
            out["above_flip"] = out["price"] >= flip["mnq"]
        out["gex_as_of"] = gex[0].get("time") or gex[0].get("date")
        out["gex_source"] = gex[0].get("source")

    return out


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path as _P

    sys.path.insert(0, str(_P(__file__).resolve().parent))
    from uw_client import UWClient  # noqa: E402

    print(json.dumps(mnq_levels(UWClient()), indent=2))

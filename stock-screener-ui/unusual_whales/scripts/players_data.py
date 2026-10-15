#!/usr/bin/env python3
"""Named players — congress + insider trades scored against subsequent price.

These are the only alert sources we can *attribute* to a person (option flow is
anonymous). For each disclosure we ask: has the stock moved with or against the
person since they traded?

    /api/congress/recent-trades   -> name, ticker, txn_type, transaction_date,
                                     amounts, filed_at_date
    /api/insider/transactions     -> ticker, transaction_code, price, amount,
                                     owner_name, transaction_date

Entry rule (documented, single choice): the **transaction date**'s session
close — the first daily close at or after `transaction_date`. (Filing dates lag
the actual trade by up to ~45 days for congress, so they are a poor entry.)
`last_px` is the most recent daily close. `pnl_pct` is signed for the person:
Buy => long, Sell => short.

Only open-market insider codes `P` (buy) and `S` (sell) count toward the
per-person aggregate; awards/exercises (A/M/F/G/...) are listed but marked
`status="unknown"`. Daily bars are cached in `edge_store` and each ticker is
fetched at most once per `_FETCH_TTL`, capped by `max_fetches`.
"""
from __future__ import annotations

import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edge_store  # noqa: E402
import market_status  # noqa: E402
from uw_client import UWClient  # noqa: E402

ET = market_status.ET
UTC = timezone.utc

_CONGRESS_LIMIT = 200
_INSIDER_LIMIT = 200
_FETCH_TTL = 21600          # 6h — daily bars only change once a session
_FLAT_BAND = 0.25           # +/-% inside which a trade is "flat"
_STATE_TTL = 300            # cache the built payload for 5 min
_MAX_RETURN = 150           # cap each list in the response

_last_fetch: dict = {}
_cache: dict = {"ts": 0.0, "payload": None}
_lock = threading.Lock()


def _f(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def _rows(client, path: str, **params) -> list:
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


def _fetch_daily(client, ticker: str) -> int:
    try:
        r = client.get(f"/api/stock/{ticker}/ohlc/1d", timeout=30)
        if r.status_code != 200:
            return 0
        payload = r.json()
        data = payload.get("data") if isinstance(payload, dict) else payload
        rows = []
        for x in data or []:
            if not isinstance(x, dict) or not x.get("date"):
                continue
            rows.append(
                {
                    "ticker": ticker,
                    "ts": f"{x['date']}T00:00:00Z",
                    "o": x.get("open"),
                    "h": x.get("high"),
                    "l": x.get("low"),
                    "c": x.get("close"),
                    "v": x.get("volume"),
                }
            )
        return edge_store.put_bars(rows)
    except Exception:  # noqa: BLE001
        return 0


def _ensure_daily(client, ticker: str, fetches: list, max_fetches: int) -> None:
    if len(fetches) >= max_fetches:
        return
    now_mono = time.monotonic()
    if now_mono - _last_fetch.get(ticker, 0.0) < _FETCH_TTL:
        return
    span = edge_store.bars_span(ticker, daily=True)
    if span:
        try:
            mx = span["max"][:10]
            today = datetime.now(ET).date().isoformat()
            # only refetch when the newest daily bar is not from today/last session
            if mx >= today:
                return
        except Exception:  # noqa: BLE001
            pass
    _last_fetch[ticker] = now_mono
    if _fetch_daily(client, ticker):
        fetches.append(ticker)


def _entry_exit(daily: list, date_str: str):
    """(entry_px, last_px) using the first close at/after `date_str`."""
    if not daily:
        return None, None
    entry = None
    for b in daily:  # ascending
        if str(b.get("ts", ""))[:10] >= date_str:
            entry = _f(b.get("c"))
            break
    last = _f(daily[-1].get("c"))
    return entry, last


def _status(pnl):
    if pnl is None:
        return "unknown"
    if pnl > _FLAT_BAND:
        return "winning"
    if pnl < -_FLAT_BAND:
        return "wrecked"
    return "flat"


def _congress_trade(r: dict) -> dict | None:
    name = str(r.get("name") or r.get("reporter") or "").strip()
    ticker = str(r.get("ticker") or "").upper().strip()
    date = str(r.get("transaction_date") or r.get("filed_at_date") or "").strip()[:10]
    if not name or not ticker or not date:
        return None
    txn = str(r.get("txn_type") or "").strip().lower()
    if txn.startswith("buy"):
        dir_ = 1
    elif txn.startswith("sell"):
        dir_ = -1
    else:
        dir_ = 0
    return {
        "source": "congress",
        "name": name,
        "ticker": ticker,
        "date": date,
        "txn": r.get("txn_type"),
        "dir": dir_,
        "amounts": r.get("amounts"),
        "chamber": r.get("member_type"),
        "filed": str(r.get("filed_at_date") or "")[:10] or None,
        "txn_price": None,
    }


def _insider_trade(r: dict) -> dict | None:
    name = str(r.get("owner_name") or "").strip()
    ticker = str(r.get("ticker") or "").upper().strip()
    date = str(r.get("transaction_date") or r.get("filing_date") or "").strip()[:10]
    if not name or not ticker or not date:
        return None
    code = str(r.get("transaction_code") or "").strip().upper()
    dir_ = 1 if code == "P" else (-1 if code == "S" else 0)
    return {
        "source": "insider",
        "name": name,
        "ticker": ticker,
        "date": date,
        "txn": code or None,
        "dir": dir_,
        "amounts": None,
        "chamber": None,
        "filed": str(r.get("filing_date") or "")[:10] or None,
        "txn_price": _f(r.get("price")),
    }


def _price_trade(client, trade: dict, daily_cache: dict, fetches: list, max_fetches: int) -> dict:
    t = trade["ticker"]
    if t not in daily_cache:
        _ensure_daily(client, t, fetches, max_fetches)
        daily_cache[t] = [b for b in edge_store.get_bars(t) if str(b.get("ts", "")).endswith("T00:00:00Z")]
    entry, last = _entry_exit(daily_cache[t], trade["date"])
    entry_px = trade.get("txn_price") or entry
    dir_ = trade["dir"]
    pnl = None
    if entry_px and last and dir_:
        pnl = dir_ * (last / entry_px - 1.0) * 100.0
        pnl = round(pnl, 2)
    out = dict(trade)
    out["entry_px"] = round(entry_px, 4) if entry_px else None
    out["last_px"] = round(last, 4) if last else None
    out["pnl_pct"] = pnl
    out["status"] = _status(pnl)
    return out


def build_players(max_fetches: int = 40) -> dict:
    """Congress + insider trades scored since their transaction date. Never raises."""
    now = time.time()
    if _cache["payload"] is not None and now - _cache["ts"] < _STATE_TTL:
        return _cache["payload"]

    congress: list = []
    insider: list = []
    note = ""
    client = None
    try:
        client = UWClient()
    except Exception:  # noqa: BLE001
        client = None

    if client is not None:
        congress = [c for c in (_congress_trade(r) for r in _rows(client, "/api/congress/recent-trades", limit=_CONGRESS_LIMIT)) if c]
        insider = [t for t in (_insider_trade(r) for r in _rows(client, "/api/insider/transactions", limit=_INSIDER_LIMIT)) if t]
    else:
        note = "UW client unavailable — no API key"

    raw = congress + insider
    raw.sort(key=lambda x: x["date"], reverse=True)
    fetches: list = []
    daily_cache: dict = {}
    priced = [
        _price_trade(client, t, daily_cache, fetches, max_fetches) if client is not None
        else dict(t, entry_px=None, last_px=None, pnl_pct=None, status="unknown")
        for t in raw
    ]

    # per-person aggregate over directional, priced trades
    agg: dict = {}
    for t in priced:
        if not t.get("dir") or t.get("pnl_pct") is None:
            continue
        key = (t["source"], t["name"])
        a = agg.setdefault(key, {"source": t["source"], "name": t["name"], "n": 0, "wins": 0, "sum": 0.0})
        a["n"] += 1
        a["sum"] += t["pnl_pct"]
        if t["pnl_pct"] > 0:
            a["wins"] += 1
    persons = []
    for a in agg.values():
        persons.append(
            {
                "source": a["source"],
                "name": a["name"],
                "n": a["n"],
                "win_rate": round(a["wins"] / a["n"], 3) if a["n"] else None,
                "avg_pnl_pct": round(a["sum"] / a["n"], 2) if a["n"] else None,
            }
        )
    persons.sort(key=lambda p: (-(p["n"] or 0), -(p["avg_pnl_pct"] or 0)))

    # keep the response balanced: cap each source rather than letting one bury it
    per_source = max(1, _MAX_RETURN // 2)
    trades = []
    for src in ("congress", "insider"):
        src_rows = [t for t in priced if t["source"] == src]
        src_rows.sort(key=lambda x: x["date"], reverse=True)
        trades += src_rows[:per_source]
    trades.sort(key=lambda x: x["date"], reverse=True)

    payload = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "persons": persons,
        "trades": trades,
        "counts": {"congress": len(congress), "insider": len(insider), "priced": len(priced)},
        "note": note or "entry = close on/after transaction date; pnl_pct signed for Buy/Sell; daily bars cached",
    }
    _cache.update(ts=now, payload=payload)
    return payload


if __name__ == "__main__":
    import json

    d = build_players()
    print(json.dumps({"counts": d["counts"], "persons": d["persons"][:8]}, indent=2))
    for t in d["trades"][:8]:
        print(t["source"], t["name"], t["ticker"], t["date"], t["dir"], t["entry_px"], t["last_px"], t["pnl_pct"], t["status"])

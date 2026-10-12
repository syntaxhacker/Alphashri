#!/usr/bin/env python3
"""Live intraday tape — 1m/5m/15m/30m % change + volume surge + sparkline.

Per watched ticker (watchlist + liquid defaults, capped). 1m candles are
trimmed server-side to the last 60 bars. TTL is market-aware: 60s while the
US market is open, 15 min otherwise (weekend data is static).
"""
from __future__ import annotations

import concurrent.futures as cf
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402
import market_status  # noqa: E402

_CACHE: dict = {"ts": 0.0, "key": "", "payload": None}
_TTL = {"open": 60, "premarket": 90, "afterhours": 120, "closed": 900}
MAX_TICKERS = 20


def _market_open() -> bool:
    try:
        et = datetime.now(ZoneInfo("America/New_York"))
        if et.weekday() >= 5:
            return False
        mins = et.hour * 60 + et.minute
        return 9 * 60 + 30 <= mins < 16 * 60
    except Exception:  # noqa: BLE001
        return False


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _et_hm(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return dt.astimezone(ZoneInfo("America/New_York")).strftime("%H:%M")
    except Exception:  # noqa: BLE001
        return str(iso or "")[11:16]


def _one(client: UWClient, ticker: str) -> dict:
    rows: list = []
    for _ in range(2):  # one retry — the API intermittently 429s/empties
        try:
            r = client.get(f"/api/stock/{ticker}/ohlc/1m", timeout=25)
            j = r.json() if r.status_code == 200 else None
            rows = j.get("data") if isinstance(j, dict) else j or []
        except Exception:  # noqa: BLE001
            rows = []
        if rows:
            break
        time.sleep(1.0)
    rows = [b for b in (rows or []) if _f(b.get("close")) is not None]
    if not rows:
        return {"ticker": ticker, "error": True}
    rows.sort(key=lambda b: str(b.get("start_time") or ""))
    bars = rows[-60:]
    closes = [_f(b.get("close")) for b in bars]
    last = closes[-1]

    def chg(back: int):
        if len(closes) > back:
            return (last / closes[-1 - back] - 1) * 100
        return None

    vols = [_f(b.get("volume")) or 0 for b in bars]
    base = sorted(vols[:-5] or vols)
    med = base[len(base) // 2] if base else 0
    surge = (sum(vols[-5:]) / 5 / med) if med else None
    return {
        "ticker": ticker,
        "last": round(last, 2),
        "time": _et_hm(bars[-1].get("start_time")),
        "c1": chg(1),
        "c5": chg(5),
        "c15": chg(15),
        "c30": chg(30),
        "surge": round(surge, 2) if surge is not None else None,
        "spark": [round(v, 2) for v in closes[-40:]],
    }


def build_tape(tickers: list[str]) -> dict:
    tickers = [t for t in tickers if t][:MAX_TICKERS]
    key = ",".join(tickers)
    now = time.time()
    ttl = _TTL.get(market_status.phase(), _TTL["closed"])
    if _CACHE["payload"] is not None and _CACHE["key"] == key and now - _CACHE["ts"] < ttl:
        return _CACHE["payload"]
    c = UWClient()
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(lambda t: _one(c, t), tickers))
    payload = {"tickers": tickers, "market_open": _market_open(), "rows": rows}
    _CACHE["ts"] = now
    _CACHE["key"] = key
    _CACHE["payload"] = payload
    return payload

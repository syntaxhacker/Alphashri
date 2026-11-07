"""US futures + options chain analysis — the single source of truth for wall math.

Data sources
------------
* Barchart's internal quotes API: exchange open interest, volume, quotes, IV.
  No auth, no cookies — the gate is ``sec-fetch-site: same-origin`` plus a
  browser TLS fingerprint (``curl_cffi``).
* TradingView scanner: live futures last price.

All timestamps are **America/New_York**. US tape dates must never use IST —
00:00 IST is still the previous US session.
"""
from __future__ import annotations

import datetime as dt
import json
import urllib.request
from typing import Any
from zoneinfo import ZoneInfo

from curl_cffi import requests

ET = ZoneInfo("America/New_York")

BASE = "https://www.barchart.com/proxies/core-api/v1"
HEADERS = {
    "Accept": "application/json",
    "sec-fetch-site": "same-origin",
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
    ),
}
FIELDS = (
    "strike,optionType,openInterest,volume,lastPrice,bidPrice,askPrice,"
    "delta,gamma,impliedVolatility"
)
MONTH_CODE = "FGHJKMNQUVXZ"  # Jan..Dec futures month codes

#: root -> (TradingView ticker, Barchart root). NQ only for now.
ROOTS: dict[str, dict[str, str]] = {
    "NQ": {"tv": "CME_MINI:NQ1!", "root": "NQ", "label": "Nasdaq-100 E-mini"},
    "ES": {"tv": "CME_MINI:ES1!", "root": "ES", "label": "S&P 500 E-mini"},
    "GC": {"tv": "COMEX:GC1!", "root": "GC", "label": "Gold"},
}


def now_et() -> dt.datetime:
    return dt.datetime.now(ET)


def _api(path: str, timeout: int = 30) -> dict[str, Any]:
    r = requests.get(BASE + path, headers=HEADERS, impersonate="chrome", timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"barchart {r.status_code}: {r.text[:160]}")
    return r.json()


def front_contract(root: str = "NQ") -> dict[str, Any]:
    """Resolve ``NQ*0`` -> front contract, last, change % and points."""
    d = _api(f"/quotes/get?symbol={root}%2A0&fields=symbol,lastPrice,percentChange,priceChange,volume&raw=1")
    row = d["data"][0]["raw"]
    pct = row.get("percentChange")
    pts = row.get("priceChange")
    return {
        "symbol": row["symbol"],
        "last": float(row["lastPrice"]),
        "change_pct": float(pct) * 100 if pct is not None else None,
        "change_pts": float(pts) if pts is not None else None,
        "volume": int(row.get("volume") or 0),
    }


def tv_price(ticker: str, timeout: int = 20) -> float | None:
    """Live-ish last price from TradingView's futures scanner."""
    body = {"symbols": {"tickers": [ticker], "query": {"types": []}}, "columns": ["close"]}
    req = urllib.request.Request(
        "https://scanner.tradingview.com/futures/scan",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            return float(json.load(r)["data"][0]["d"][0])
    except Exception:  # noqa: BLE001
        return None


def live_price(root: str = "NQ") -> float | None:
    """Futures last price only (one TradingView request, no chain)."""
    meta = ROOTS.get(root)
    if meta is None:
        return None
    return tv_price(meta["tv"])


def weekly_series(on: dt.date) -> tuple[str, dt.date]:
    """``MQ<week-of-month><month><yy>`` for the Friday of ``on``'s week."""
    fri = on + dt.timedelta(days=(4 - on.weekday()) % 7)
    week = (fri.day - 1) // 7 + 1
    return f"MQ{week}{MONTH_CODE[fri.month - 1]}{fri.year % 100:02d}", fri


def fetch_chain(series: str) -> dict[str, dict[float, dict[str, Any]]]:
    """Full chain with exchange OI/volume and Barchart's greeks.

    No ``groupBy`` — grouping drops the greeks columns. The side comes from the
    ``optionType`` field, which is present on every row.
    """
    d = _api(
        f"/quotes/get?symbol={series}&list=futures.options&fields={FIELDS}"
        "&orderBy=strike&orderDir=asc&raw=1"
    )
    rows = d["data"] if isinstance(d.get("data"), list) else list(d["data"].values())
    out: dict[str, dict[float, dict[str, Any]]] = {"Call": {}, "Put": {}}
    for wrapper in rows:
        r = wrapper.get("raw", wrapper)
        side = r.get("optionType")
        if side not in out:
            continue
        out[side][float(r["strike"])] = {
            "oi": float(r.get("openInterest") or 0),
            "vol": float(r.get("volume") or 0),
            "last": r.get("lastPrice"),
            "bid": r.get("bidPrice"),
            "ask": r.get("askPrice"),
            "iv": r.get("impliedVolatility"),
            "delta": r.get("delta"),
            "gamma": float(r.get("gamma") or 0.0),
        }
    if not out["Call"] and not out["Put"]:
        raise RuntimeError(f"empty chain for {series}")
    return out


def max_pain(calls: dict, puts: dict) -> float:
    """Strike that minimises total in-the-money payout across the chain."""
    best_k, best = 0.0, None
    for k in sorted(set(calls) | set(puts)):
        pain = sum((k - s) * calls[s]["oi"] for s in calls if s < k)
        pain += sum((s - k) * puts[s]["oi"] for s in puts if s > k)
        if best is None or pain < best:
            best, best_k = pain, k
    return best_k


def _mid(v: dict[str, Any]) -> float | None:
    bid, ask, last = v.get("bid"), v.get("ask"), v.get("last")
    if isinstance(bid, (int, float)) and isinstance(ask, (int, float)) and ask > bid > 0:
        return (bid + ask) / 2
    if isinstance(last, (int, float)) and last > 0:
        return float(last)
    return None


def atm_straddle(calls: dict, puts: dict, spot: float) -> tuple[float | None, float | None]:
    """``(implied move %, ATM strike)`` from the ATM call+put mid."""
    strikes = [k for k in calls if k in puts]
    if not strikes:
        return None, None
    k = min(strikes, key=lambda x: abs(x - spot))
    c, p = _mid(calls[k]), _mid(puts[k])
    if not c or not p:
        return None, k
    return (c + p) / spot * 100, k


def gamma_profile(calls: dict, puts: dict, spot: float) -> dict[str, Any]:
    """Dealer-convention GEX: calls +, puts −, per 1% move in dollars."""
    scale = 100 * spot * spot * 0.01
    per: dict[float, float] = {}
    for k, v in calls.items():
        per[k] = per.get(k, 0.0) + (v.get("gamma") or 0.0) * v["oi"] * scale
    for k, v in puts.items():
        per[k] = per.get(k, 0.0) - (v.get("gamma") or 0.0) * v["oi"] * scale
    if not per:
        return {"net": 0.0, "flip": None, "per_strike": {}}

    net = sum(per.values())
    cum = 0.0
    flip = None
    for k in sorted(per):
        prev = cum
        cum += per[k]
        if (prev < 0 <= cum or prev > 0 >= cum) and flip is None and k != sorted(per)[0]:
            flip = k
    return {"net": net, "flip": flip, "per_strike": per}


def analyse(series: str, spot: float, window: float = 0.08) -> dict[str, Any]:
    """Walls / PCR / max pain / expected move / GEX plus a per-strike ladder."""
    chain = fetch_chain(series)
    calls, puts = chain["Call"], chain["Put"]
    call_oi = sum(v["oi"] for v in calls.values())
    put_oi = sum(v["oi"] for v in puts.values())
    call_vol = sum(v["vol"] for v in calls.values())
    put_vol = sum(v["vol"] for v in puts.values())

    c_otm = {k: v for k, v in calls.items() if k >= spot and v["oi"] > 0}
    p_otm = {k: v for k, v in puts.items() if k <= spot and v["oi"] > 0}
    cw, pw = (max(c_otm, key=lambda k: c_otm[k]["oi"]) if c_otm else spot,
              max(p_otm, key=lambda k: p_otm[k]["oi"]) if p_otm else spot)

    exp_pct, atm = atm_straddle(calls, puts, spot)
    gamma = gamma_profile(calls, puts, spot)
    per_gex = gamma["per_strike"]

    lo, hi = spot * (1 - window), spot * (1 + window)
    strikes = []
    for k in sorted(set(calls) | set(puts)):
        if not lo <= k <= hi:
            continue
        c, p = calls.get(k), puts.get(k)
        if not ((c and (c["oi"] or c["vol"])) or (p and (p["oi"] or p["vol"]))):
            continue
        strikes.append({
            "k": k,
            "c_oi": int(c["oi"]) if c else 0,
            "c_vol": int(c["vol"]) if c else 0,
            "p_oi": int(p["oi"]) if p else 0,
            "p_vol": int(p["vol"]) if p else 0,
            "g": round(per_gex.get(k, 0.0) / 1e6, 3),
        })

    return {
        "series": series,
        "call_oi": int(call_oi),
        "put_oi": int(put_oi),
        "call_vol": int(call_vol),
        "put_vol": int(put_vol),
        "pcr_oi": round(put_oi / call_oi, 3) if call_oi else None,
        "pcr_vol": round(put_vol / call_vol, 3) if call_vol else None,
        "max_pain": max_pain(calls, puts),
        "call_wall": cw,
        "call_wall_oi": int(calls[cw]["oi"]) if cw in calls else 0,
        "put_wall": pw,
        "put_wall_oi": int(puts[pw]["oi"]) if pw in puts else 0,
        "exp_move_pct": round(exp_pct, 3) if exp_pct is not None else None,
        "atm_strike": atm,
        "net_gex": round(gamma["net"] / 1e6, 2),
        "gex_flip": gamma["flip"],
        "strikes": strikes,
        "n_strikes": len(strikes),
    }


def resolve_series(contract: str, on: dt.date) -> tuple[str, dt.date]:
    """Front weekly; fall back to the monthly when the weekly is not listed."""
    series, expiry = weekly_series(on)
    try:
        fetch_chain(series)
        return series, expiry
    except Exception:  # noqa: BLE001
        return contract, expiry


def snapshot(root: str = "NQ") -> dict[str, Any]:
    """One complete tape row for ``root`` (live spot + front weekly chain)."""
    meta = ROOTS.get(root)
    if meta is None:
        raise ValueError(f"unsupported root {root}")

    quote = front_contract(meta["root"])
    spot = tv_price(meta["tv"]) or quote["last"]
    chg = quote["change_pct"]
    pts = quote["change_pts"]
    if chg is not None and quote["last"]:
        prev_close = quote["last"] / (1 + chg / 100)
        chg = (spot / prev_close - 1) * 100
        pts = spot - prev_close

    now = now_et()
    series, expiry = resolve_series(quote["symbol"], now.date())
    a = analyse(series, spot)

    return {
        "t": now.isoformat(),
        "root": root,
        "contract": quote["symbol"],
        "series": series,
        "expiry": expiry.isoformat(),
        "spot": round(spot, 2),
        "change_pct": round(chg, 3) if chg is not None else None,
        "change_pts": round(pts, 2) if pts is not None else None,
        "volume": quote.get("volume") or 0,
        **a,
    }

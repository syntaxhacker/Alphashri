#!/usr/bin/env python3
"""NQ options call/put walls straight from Barchart's JSON API — no browser, no cookies.

Barchart's internal endpoint is not publicised but is open with two headers:
    Accept: application/json
    sec-fetch-site: same-origin
plus a browser-like TLS fingerprint (curl_cffi — already in api/requirements.txt).
No auth, no WAF token, no cookies.  Rate limit: 60 req/min.

Series symbols (no lookup needed):
    monthly : NQ<MONTH><YY>       e.g. NQZ26  -> Dec 2026
    weekly  : MQ<week><MONTH><YY> e.g. MQ4V26 -> 4th Friday of Oct 2026

Open interest is the previous session's (OCC publishes it once, after the close).
`volume` / `lastPrice` / IV are current, so the volume columns are the live part.

Usage:
    python scripts/market/nq_walls.py                  # front weekly + front monthly
    python scripts/market/nq_walls.py --series MQ4V26  # one expiry
    python scripts/market/nq_walls.py --json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.request
from typing import Any

from curl_cffi import requests

BASE = "https://www.barchart.com/proxies/core-api/v1"
HEADERS = {
    "Accept": "application/json",
    "sec-fetch-site": "same-origin",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
}
FIELDS = "strike,openInterest,volume,lastPrice,bidPrice,askPrice,impliedVolatility,optionType"
MONTH_CODE = "FGHJKMNQUVXZ"  # Jan..Dec futures month codes


def api(path: str) -> dict[str, Any]:
    r = requests.get(BASE + path, headers=HEADERS, impersonate="chrome", timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code} {r.text[:200]}")
    return r.json()


def front_contract(root: str = "NQ") -> tuple[str, float, float | None, float | None]:
    """Resolve NQ*0 -> (contract symbol, last price, change %, change pts)."""
    d = api(f"/quotes/get?symbol={root}%2A0&fields=symbol,lastPrice,percentChange,priceChange&raw=1")
    row = d["data"][0]["raw"]
    chg = row.get("percentChange")
    pts = row.get("priceChange")
    return (row["symbol"], float(row["lastPrice"]),
            float(chg) * 100 if chg is not None else None,
            float(pts) if pts is not None else None)


def weekly_series(when: dt.date) -> tuple[str, dt.date]:
    """MQ<week-of-month><month><yy> for the Friday of `when`'s week."""
    fri = when + dt.timedelta(days=(4 - when.weekday()) % 7)
    week = (fri.day - 1) // 7 + 1
    return f"MQ{week}{MONTH_CODE[fri.month - 1]}{fri.year % 100:02d}", fri


def fetch_chain(series: str) -> dict[str, dict[float, dict[str, Any]]]:
    d = api(f"/quotes/get?symbol={series}&list=futures.options&fields={FIELDS}"
            "&groupBy=optionType&orderBy=strike&orderDir=asc&raw=1")
    out: dict[str, dict[float, dict[str, Any]]] = {"Call": {}, "Put": {}}
    for side in ("Call", "Put"):
        for row in d["data"].get(side, []):
            r = row["raw"]
            out[side][float(r["strike"])] = {
                "oi": float(r.get("openInterest") or 0),
                "vol": float(r.get("volume") or 0),
                "last": r.get("lastPrice"),
                "bid": r.get("bidPrice"),
                "ask": r.get("askPrice"),
                "iv": r.get("impliedVolatility"),
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


def atm_straddle(calls: dict, puts: dict, spot: float) -> float | None:
    """Implied move (%) from the ATM call+put mid, when both are quoted."""
    ks = [k for k in calls if k in puts and k > 0]
    if not ks:
        return None
    k = min(ks, key=lambda x: abs(x - spot))

    def mid(side: dict) -> float | None:
        v = side[k]
        bid, ask, last = v.get("bid"), v.get("ask"), v.get("last")
        if isinstance(bid, (int, float)) and isinstance(ask, (int, float)) and ask > bid > 0:
            return (bid + ask) / 2
        if isinstance(last, (int, float)) and last > 0:
            return float(last)
        return None

    c, p = mid(calls), mid(puts)
    if not c or not p:
        return None
    return (c + p) / spot * 100


def analyse(series: str, spot: float, label: str) -> dict[str, Any]:
    ch = fetch_chain(series)
    c, p = ch["Call"], ch["Put"]
    call_oi = sum(v["oi"] for v in c.values())
    put_oi = sum(v["oi"] for v in p.values())

    c_otm = {k: v for k, v in c.items() if k >= spot and v["oi"] > 0}
    p_otm = {k: v for k, v in p.items() if k <= spot and v["oi"] > 0}
    cw = max(c_otm, key=lambda k: c_otm[k]["oi"])
    pw = max(p_otm, key=lambda k: p_otm[k]["oi"])

    def top(d: dict, n: int = 5, by: str = "oi") -> list[tuple[float, float]]:
        return sorted(((k, v[by]) for k, v in d.items() if v[by] > 0),
                      key=lambda kv: -kv[1])[:n]

    return {
        "series": series,
        "label": label,
        "spot": spot,
        "call_wall": (cw, c[cw]["oi"]),
        "put_wall": (pw, p[pw]["oi"]),
        "call_top": top(c_otm),
        "put_top": top(p_otm),
        "call_vol_top": top(c_otm, 5, "vol"),
        "put_vol_top": top(p_otm, 5, "vol"),
        "pcr": round(put_oi / call_oi, 2) if call_oi else None,
        "call_oi": call_oi,
        "put_oi": put_oi,
        "max_pain": max_pain(c, p),
        "strikes": len(set(c) | set(p)),
        "exp_move": atm_straddle(c, p, spot),
        "calls": c,
        "puts": p,
    }


def show(r: dict[str, Any]) -> None:
    s = r["spot"]
    print(f"\n{r['label']}  ({r['series']})   spot {s:,.2f}   {r['strikes']} strikes")
    print(f"  call wall {r['call_wall'][0]:>9,.0f}  OI {r['call_wall'][1]:>8,.0f}"
          f"   ({(r['call_wall'][0] / s - 1) * 100:+.2f}%)")
    print(f"  put  wall {r['put_wall'][0]:>9,.0f}  OI {r['put_wall'][1]:>8,.0f}"
          f"   ({(r['put_wall'][0] / s - 1) * 100:+.2f}%)")
    print(f"  PCR(OI) {r['pcr']}   calls {r['call_oi']:,.0f} / puts {r['put_oi']:,.0f}"
          f"   max pain {r['max_pain']:,.0f} ({(r['max_pain'] / s - 1) * 100:+.2f}%)")
    print("  top call OI : " + ", ".join(f"{k:,.0f}:{v:,.0f}" for k, v in r["call_top"]))
    print("  top put  OI : " + ", ".join(f"{k:,.0f}:{v:,.0f}" for k, v in r["put_top"]))
    print("  call volume : " + ", ".join(f"{k:,.0f}:{v:,.0f}" for k, v in r["call_vol_top"]))
    print("  put  volume : " + ", ".join(f"{k:,.0f}:{v:,.0f}" for k, v in r["put_vol_top"]))


def render_ascii(r: dict[str, Any], change_pct: float | None = None,
                 live_tag: str = "") -> None:
    """Mirror-histogram ladder: put OI left, call OI right, spot/walls/pain marked."""
    spot = r["spot"]
    calls, puts = r["calls"], r["puts"]
    cw = r["call_wall"][0]
    pw = r["put_wall"][0]
    mp = r["max_pain"]

    # always show both walls, plus 3% around spot
    lo = min(pw * 0.99, spot * 0.97)
    hi = max(cw * 1.01, spot * 1.03)
    span = hi - lo
    bucket = next((b for b in (25, 50, 100, 250, 500) if span / b <= 30), 500)

    def agg(src: dict) -> dict[float, dict[str, float]]:
        out: dict[float, dict[str, float]] = {}
        for k, v in src.items():
            if not lo - bucket <= k <= hi + bucket:
                continue
            key = round(k / bucket) * bucket
            d = out.setdefault(key, {"oi": 0.0, "vol": 0.0})
            d["oi"] += v["oi"]
            d["vol"] += v["vol"]
        return out

    bc, bp = agg(calls), agg(puts)
    keys = sorted(set(bc) | set(bp), reverse=True)
    max_oi = max([v["oi"] for v in bc.values()] + [v["oi"] for v in bp.values()] + [1])
    vol_top = {
        k for k, _ in sorted(((k, v["vol"]) for k, v in bc.items() if v["vol"] > 0),
                             key=lambda kv: -kv[1])[:3]
    } | {
        k for k, _ in sorted(((k, v["vol"]) for k, v in bp.items() if v["vol"] > 0),
                             key=lambda kv: -kv[1])[:3]
    }
    bar_w = 24
    top = "+" + "-" * 86 + "+"
    title = f"{r['series']}  {r['label']}"
    chg = f"{change_pct:+.2f}%" if change_pct is not None else ""
    print(top)
    print(f"| {title:<52}{spot:>12,.2f} {chg:>9}  {live_tag:<9}|")
    print(f"| {'exp move +/-%.2f%%' % r['exp_move'] if r['exp_move'] else 'exp move n/a':<52}"
          f"{'PCR ' + str(r['pcr']):>12} {'max pain':>9}  {mp:>9,.0f} |")
    print(top)
    print(f"  {'PUT OI':>7} {'':>{bar_w}}   {'STRIKE':>8}   {'':<{bar_w}} {'CALL OI':>7}")
    spot_done = False
    for k in keys:
        if not spot_done and k < spot:
            print(f"  {'':>7} {'':>{bar_w}} | {spot:>8,.0f} | {'':<{bar_w}} {'':>7}  <== SPOT")
            spot_done = True
        p = bp.get(k, {"oi": 0.0, "vol": 0.0})
        c = bc.get(k, {"oi": 0.0, "vol": 0.0})
        pb = "#" * max(0, round(p["oi"] / max_oi * bar_w))
        cb = "#" * max(0, round(c["oi"] / max_oi * bar_w))
        note = ""
        if abs(k - pw) < bucket / 2:
            note = f"  <- PUT WALL {r['put_wall'][1]:,.0f}"
        elif abs(k - cw) < bucket / 2:
            note = f"  CALL WALL {r['call_wall'][1]:,.0f} ->"
        elif abs(k - mp) < bucket / 2:
            note = "  <- max pain"
        if k in vol_top:
            note += " *"
        print(f"  {p['oi']:>7,.0f} {pb:>{bar_w}} | {k:>8,.0f} | {cb:<{bar_w}} {c['oi']:>7,.0f}{note}")
    if not spot_done:
        print(f"  {'':>7} {'':>{bar_w}} | {spot:>8,.0f} | {'':<{bar_w}} {'':>7}  <== SPOT")
    print(f"  bars = open interest, {bucket:.0f}-pt buckets   * = top-3 live volume bucket")


def render_map(r: dict[str, Any]) -> None:
    """One-line level map: put wall --- spot --- max pain --- call wall."""
    s, pw, cw, mp = r["spot"], r["put_wall"][0], r["call_wall"][0], r["max_pain"]
    lo, hi = min(pw, s, mp), max(cw, s, mp)
    pad = (hi - lo) * 0.04
    lo, hi = lo - pad, hi + pad
    width = 66

    def pos(x: float) -> int:
        return max(0, min(width - 1, round((x - lo) / (hi - lo) * (width - 1))))

    row = ["-"] * width
    for x, ch in ((pw, "|"), (mp, "+"), (s, "*"), (cw, "|")):
        row[pos(x)] = ch
    print("  " + "".join(row))
    print(f"  | put wall {pw:,.0f}    + max pain {mp:,.0f}    * spot {s:,.0f}    | call wall {cw:,.0f}")


def render_summary(r: dict[str, Any]) -> None:
    s = r["spot"]
    print(f"  PCR(OI) {r['pcr']:<5} calls {r['call_oi']:>7,.0f} / puts {r['put_oi']:>7,.0f}"
          f"   max pain {r['max_pain']:>7,.0f} ({(r['max_pain'] / s - 1) * 100:+.2f}%)")
    print(f"  call wall {r['call_wall'][0]:>7,.0f} (OI {r['call_wall'][1]:,.0f},"
          f" {(r['call_wall'][0] / s - 1) * 100:+.2f}%)"
          f"   put wall {r['put_wall'][0]:>7,.0f} (OI {r['put_wall'][1]:,.0f},"
          f" {(r['put_wall'][0] / s - 1) * 100:+.2f}%)")
    print("  live call vol : " + ", ".join(f"{k:,.0f}:{v:,.0f}" for k, v in r["call_vol_top"][:3]))
    print("  live put  vol : " + ", ".join(f"{k:,.0f}:{v:,.0f}" for k, v in r["put_vol_top"][:3]))


def tv_price(symbol: str = "CME_MINI:NQ1!") -> float | None:
    """Live-ish last price from TradingView's scanner (falls back to None)."""
    body = {"symbols": {"tickers": [symbol], "query": {"types": []}}, "columns": ["close"]}
    req = urllib.request.Request(
        "https://scanner.tradingview.com/futures/scan",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310
            return float(json.load(r)["data"][0]["d"][0])
    except Exception:  # noqa: BLE001
        return None


def snapshot(args: argparse.Namespace) -> tuple[str, float, float | None, float | None, list[dict]]:
    """Fetch front contract + live price + chains; returns (contract, spot, chg, pts, rows)."""
    contract, spot, chg, pts = front_contract(args.root)
    live = args.spot if args.spot else tv_price()
    if live:
        if chg is not None:
            prev_close = spot / (1 + chg / 100)
            spot = live
            chg = (spot / prev_close - 1) * 100
            pts = spot - prev_close
        else:
            spot = live

    if args.series:
        specs = [(args.series, "requested")]
    else:
        wk, fri = weekly_series(dt.date.today())
        specs = [(wk, f"weekly (exp {fri:%Y-%m-%d})"), (contract, f"monthly ({contract})")]

    rows = [analyse(series, spot, label) for series, label in specs]
    return contract, spot, chg, pts, rows


def render_all(contract: str, spot: float, chg: float | None, pts: float | None,
               rows: list[dict], ascii_mode: bool) -> None:
    if ascii_mode:
        print(f"NQ WALLS  |  front {contract}  {spot:,.2f}"
              f"{f'  {chg:+.2f}%  {pts:+,.2f}' if chg is not None and pts is not None else ''}"
              f"  |  OI = prior session, volume = live")
        for r in rows:
            render_ascii(r, chg, live_tag="live")
            render_map(r)
            render_summary(r)
            print()
    else:
        print(f"front contract {contract}  last {spot:,.2f}")
        for r in rows:
            show(r)


def watch(args: argparse.Namespace, interval: int) -> None:
    args.spot = None  # always re-read the live price each cycle
    try:
        while True:
            stamp = dt.datetime.now().strftime("%H:%M:%S")
            try:
                contract, spot, chg, pts, rows = snapshot(args)
            except Exception as exc:  # noqa: BLE001
                print(f"[{stamp}] fetch failed: {exc}", file=sys.stderr)
                time.sleep(interval)
                continue

            if sys.stdout.isatty():
                print("\033[2J\033[H", end="")
            print(f"== {stamp} =======================================================================")
            if rows:
                r = rows[0]

                def lv(seq: list, i: int) -> str:
                    return f"{seq[i][0]:,.0f}" if len(seq) > i else "-"

                print(f"  LEVELS  spot {spot:,.0f}  |  put wall {r['put_wall'][0]:,.0f}"
                      f" ({(r['put_wall'][0] / spot - 1) * 100:+.1f}%)"
                      f"  |  next {lv(r['put_top'], 1)} / {lv(r['put_top'], 2)}"
                      f"   ||   {lv(r['call_top'], 1)} / {lv(r['call_top'], 2)}"
                      f"  |  call wall {r['call_wall'][0]:,.0f}"
                      f" ({(r['call_wall'][0] / spot - 1) * 100:+.1f}%)"
                      f"  |  max pain {r['max_pain']:,.0f}  PCR {r['pcr']}")
            render_all(contract, spot, chg, pts, rows, True)
            print(f"-- next update in {interval}s (ctrl-c to stop) --")
            sys.stdout.flush()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nstopped")


def main() -> None:
    ap = argparse.ArgumentParser(description="NQ call/put walls from Barchart's JSON API")
    ap.add_argument("--series", help="explicit series, e.g. MQ4V26 or NQZ26")
    ap.add_argument("--root", default="NQ", help="futures root (default NQ)")
    ap.add_argument("--spot", type=float, help="override spot with a live price (e.g. from TradingView)")
    ap.add_argument("--watch", type=int, metavar="SEC", help="refresh every SEC seconds (e.g. 60)")
    ap.add_argument("--ascii", action="store_true", help="price ladder + summary panel")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    if args.watch:
        watch(args, args.watch)
        return

    try:
        contract, spot, chg, pts, rows = snapshot(args)
    except RuntimeError as exc:
        print(f"failed: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps(
            [{**r, "call_wall": list(r["call_wall"]), "put_wall": list(r["put_wall"])} for r in rows],
            indent=2, default=str,
        ))
        return

    render_all(contract, spot, chg, pts, rows, args.ascii)




if __name__ == "__main__":
    main()

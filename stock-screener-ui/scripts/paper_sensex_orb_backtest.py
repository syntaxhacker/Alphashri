#!/usr/bin/env python3
"""ORB (Opening Range Breakout) backtest on SENSEX — wide grid, background-friendly.

Tests OR duration {1,3,5,10,15,30,45} × buffer {0.0,0.1,0.3,0.5} ×
SL {0.5,1.0,1.5,2.0} × TP {1.5,2.0,3.0,4.0} (+ optional trailing), on the
1-min SENSEX cache (~23 days) and 60-min cache (3 months).

Writes ranked results to experiments/data/orb_backtest_results.txt and a CSV.
Usage: python3 scripts/paper_sensex_orb_backtest.py [--tf 1|60] [--trail]
"""
from __future__ import annotations

import argparse
import csv
import math
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "experiments" / "data"
sys.path.insert(0, str(ROOT))

from scripts.paper_sensex import load_candle_days, option_costs  # noqa: E402

IST_TZ = __import__("config").IST


def bs(side, spot, strike, t, iv=0.19, r=0.05):
    def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    v = (spot * ncdf(d1) - strike * math.exp(-r * t) * ncdf(d2)) if side == "CE" \
        else (strike * math.exp(-r * t) * ncdf(-d2) - spot * ncdf(-d1))
    intr = max(spot - strike, 0) if side == "CE" else max(strike - spot, 0)
    return max(v, intr)


def orb_day(rows, or_min, buf, sl, tp, eod_hm="15:20", trail_trig=1e9, trail_dist=250):
    """rows: raw [ts,o,h,l,c,v,oi] ascending. Returns per-trade net P&L list."""
    mkt = 9 * 60 + 15
    or_end = mkt + or_min
    pre = [x for x in rows if mkt <= int(x[0][11:13]) * 60 + int(x[0][14:16]) < or_end]
    if not pre:
        return []
    or_high = max(float(x[2]) for x in pre)
    or_low = min(float(x[3]) for x in pre)
    if or_high <= or_low:
        return []
    buy = or_high * (1 + buf / 100)
    sell = or_low * (1 - buf / 100)
    trades = []
    pos = None
    for r in rows:
        hm = r[0][11:16]
        spot = float(r[4]); hi = float(r[2]); lo = float(r[3])
        tmin = int(r[0][11:13]) * 60 + int(r[0][14:16])
        if tmin < or_end:
            continue
        if not pos:
            side = None
            if spot > buy:
                side = "CE"; strike = round(spot / 100) * 100 + 100
            elif spot < sell:
                side = "PE"; strike = round(spot / 100) * 100 - 100
            if not side:
                continue
            prem = bs(side, spot, strike, T_YEARS)
            pos = {"side": side, "strike": strike, "prem": prem, "peak": 0.0}
        else:
            pnl_hi = (bs(pos["side"], hi, pos["strike"], T_YEARS) - pos["prem"]) * 20
            pnl_lo = (bs(pos["side"], lo, pos["strike"], T_YEARS) - pos["prem"]) * 20
            pos["peak"] = max(pos["peak"], pnl_hi, pnl_lo)
            reason = None; ep = None
            if pnl_lo <= -sl * pos["prem"] * 20 / 100:
                reason = "SL"; ep = pos["prem"] * (1 - sl / 100)
            elif pnl_hi >= tp * pos["prem"] * 20 / 100:
                reason = "TP"; ep = pos["prem"] * (1 + tp / 100)
            elif pos["peak"] >= trail_trig and pnl_hi <= pos["peak"] - trail_dist:
                reason = "TRAIL"
            elif hm >= eod_hm:
                reason = "EOD"; ep = bs(pos["side"], spot, pos["strike"], T_YEARS)
            if reason:
                if ep is None:
                    ep = pos["prem"] + pos["peak"] / 20
                gross = (ep - pos["prem"]) * 20 if pos["side"] == "CE" else (pos["prem"] - ep) * 20
                trades.append(gross - option_costs(pos["prem"], ep, 20))
                pos = None
    return trades


def load_60m_days():
    import pickle
    import pandas as pd
    p = DATA / "sensex_60m_cache.pkl"
    if not p.exists():
        return []
    df = pickle.load(open(p, "rb"))
    df.index = df.index.tz_convert("Asia/Kolkata")
    days = []
    for d, g in df.groupby(df.index.date):
        rows = []
        for ts, r in g.iterrows():
            iso = ts.isoformat()
            rows.append([iso, float(r["Open"]), float(r["High"]), float(r["Low"]),
                         float(r["Close"]), 0, 0])
        rows.sort(key=lambda x: x[0])
        days.append((d.isoformat(), rows))
    days.sort(key=lambda x: x[0])
    return days


def main():
    global T_YEARS
    parser = argparse.ArgumentParser()
    parser.add_argument("--tf", type=int, default=1, help="1 or 60 (minutes)")
    parser.add_argument("--trail", action="store_true", help="enable trailing (400/250)")
    parser.add_argument("--out", default=str(DATA / "orb_backtest_results.txt"))
    args = parser.parse_args()

    dte = (datetime(2026, 8, 6, tzinfo=IST_TZ) - datetime.now(IST_TZ)).total_seconds() / 86400.0
    T_YEARS = max(dte, 1) / 365.0

    if args.tf == 1:
        days = load_candle_days()
        or_mins = [1, 3, 5, 10, 15, 30, 45]
        eod = "15:20"
    else:
        days = load_60m_days()
        or_mins = [1, 2, 3, 4, 5, 6]
        eod = "15:00"
    print(f"tf={args.tf} days={len(days)} ({days[0][0]}..{days[-1][0]}) or_mins={or_mins}", file=sys.stderr)

    trail_trig, trail_dist = (400, 250) if args.trail else (1e9, 250)
    results = []
    total_cells = len(or_mins) * 4 * 4 * 4
    cell = 0
    t0 = time.time()
    for or_min in or_mins:
        for buf in [0.0, 0.1, 0.3, 0.5]:
            for sl in [0.5, 1.0, 1.5, 2.0]:
                for tp in [1.5, 2.0, 3.0, 4.0]:
                    cell += 1
                    nets = []; nt = 0
                    for date, rows in days:
                        tr = orb_day(rows, or_min, buf, sl, tp, eod, trail_trig, trail_dist)
                        nets.append(sum(tr)); nt += len(tr)
                    med = statistics.median(nets) if nets else 0
                    posd = sum(1 for n in nets if n > 0) / len(nets) * 100 if nets else 0
                    results.append({
                        "or": or_min, "buf": buf, "sl": sl, "tp": tp, "trail": bool(args.trail),
                        "med": round(med, 2), "posd": round(posd, 1), "net": round(sum(nets), 2),
                        "trades": nt,
                    })
                    if cell % 100 == 0:
                        el = time.time() - t0
                        print(f"  {cell}/{total_cells} ({el:.0f}s)", file=sys.stderr, flush=True)

    results.sort(key=lambda x: (x["med"], x["posd"]), reverse=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        f.write(f"ORB BACKTEST tf={args.tf}min days={len(days)} "
                f"({days[0][0]}..{days[-1][0]}) trail={bool(args.trail)} costs=ON\n")
        f.write(f"{'OR':>3} {'buf':>5} {'SL':>5} {'TP':>5} {'trail':>6} {'med/day':>9} {'%pos':>6} {'net':>10} {'trades':>6}\n")
        for r in results:
            f.write(f"{r['or']:>3} {r['buf']:>5.1f} {r['sl']:>5.1f} {r['tp']:>5.1f} "
                    f"{'Y' if r['trail'] else 'N':>6} {r['med']:>9,.0f} {r['posd']:>5.0f}% "
                    f"{r['net']:>10,.0f} {r['trades']:>6}\n")
    csv_out = out.with_suffix(".csv")
    with open(csv_out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["or", "buf", "sl", "tp", "trail", "med", "posd", "net", "trades"])
        w.writeheader(); w.writerows(results)
    print(f"wrote {out} + {csv_out} ({len(results)} configs)", file=sys.stderr)
    # print top 20 to stdout
    print(f"\nORB tf={args.tf}min — TOP 20 (by median day P&L)")
    print(f"{'OR':>3} {'buf':>5} {'SL':>5} {'TP':>5} {'med/day':>9} {'%pos':>6} {'net':>10} {'tr':>6}")
    for r in results[:20]:
        print(f"{r['or']:>3} {r['buf']:>5.1f} {r['sl']:>5.1f} {r['tp']:>5.1f} "
              f"{r['med']:>9,.0f} {r['posd']:>5.0f}% {r['net']:>10,.0f} {r['trades']:>6}")


if __name__ == "__main__":
    main()

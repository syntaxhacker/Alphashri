#!/usr/bin/env python3
"""Scalping strategy backtest on SENSEX — momentum / range / VWAP / breakout scalp.

Tests several scalping styles on 1-min SENSEX candles (23d) and 60-min (3mo),
priced with Black-Scholes options + costs. Runs in background, writes ranked results.

Scalp styles:
  momentum  — enter on spot moving X pts over the last N bars (direction of move)
  range     — fade extremes: buy near N-bar low, sell near N-bar high
  vwap      — fade deviation from rolling VWAP (reversion)
  breakout  — buy break of N-bar high / sell break of N-bar low (quick scalp)

Exit: tight target (₹ per lot) / tight SL / EOD. Cooldown 1-3 bars.

Usage: python3 scripts/paper_sensex_scalp_backtest.py [--tf 1|60] [--style all]
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

T_YEARS = 0.003  # ~1 day to expiry, set below


def bs(side, spot, strike, t, iv=0.19, r=0.05):
    def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    v = (spot * ncdf(d1) - strike * math.exp(-r * t) * ncdf(d2)) if side == "CE" \
        else (strike * math.exp(-r * t) * ncdf(-d2) - spot * ncdf(-d1))
    intr = max(spot - strike, 0) if side == "CE" else max(strike - spot, 0)
    return max(v, intr)


def scalp_day(rows, style, lookback, thr_pts, target, sl, cooldown, eod_hm="15:20"):
    """rows: raw [ts,o,h,l,c,v,oi] ascending. Returns list of per-trade net P&L."""
    trades = []
    pos = None
    closes = []
    highs = []
    lows = []
    cd_until = -1
    for i, r in enumerate(rows):
        hm = r[0][11:16]
        spot = float(r[4]); hi = float(r[2]); lo = float(r[3])
        closes.append(spot); highs.append(hi); lows.append(lo)
        if len(closes) < lookback + 1:
            continue
        if not pos:
            if i < cd_until:
                continue
            side = None
            if style == "momentum":
                mom = closes[-1] - closes[-lookback - 1]
                if mom >= thr_pts:
                    side = "CE"
                elif mom <= -thr_pts:
                    side = "PE"
            elif style == "range":
                hi_n = max(highs[-lookback:])
                lo_n = min(lows[-lookback:])
                if spot <= lo_n + 5:
                    side = "CE"
                elif spot >= hi_n - 5:
                    side = "PE"
            elif style == "vwap":
                vwap = sum(closes[-lookback:]) / lookback
                dev = (spot - vwap) / vwap * 100
                if dev <= -thr_pts / 100:
                    side = "CE"
                elif dev >= thr_pts / 100:
                    side = "PE"
            elif style == "breakout":
                hi_n = max(highs[-lookback - 1:-1])
                lo_n = min(lows[-lookback - 1:-1])
                if spot > hi_n:
                    side = "CE"
                elif spot < lo_n:
                    side = "PE"
            if not side:
                continue
            strike = round(spot / 100) * 100 + (100 if side == "CE" else -100)
            prem = bs(side, spot, strike, T_YEARS)
            pos = {"side": side, "strike": strike, "prem": prem, "entry": spot, "i": i}
        else:
            pnl_hi = (bs(pos["side"], hi, pos["strike"], T_YEARS) - pos["prem"]) * 20
            pnl_lo = (bs(pos["side"], lo, pos["strike"], T_YEARS) - pos["prem"]) * 20
            reason = None; ep = None
            if pnl_lo <= sl:
                reason = "SL"
            elif pnl_hi >= target:
                reason = "TP"
            elif hm >= eod_hm:
                reason = "EOD"; ep = bs(pos["side"], spot, pos["strike"], T_YEARS)
            if reason:
                if ep is None:
                    # approx exit premium at SL/TP by interpolating from P&L level
                    pnl_at = sl if reason == "SL" else target
                    ep = pos["prem"] + (pnl_at / 20) * (1 if pos["side"] == "CE" else -1)
                gross = (ep - pos["prem"]) * 20 if pos["side"] == "CE" else (pos["prem"] - ep) * 20
                trades.append(gross - option_costs(pos["prem"], ep, 20))
                pos = None
                cd_until = i + cooldown
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
        rows = [[ts.isoformat(), float(r["Open"]), float(r["High"]), float(r["Low"]),
                 float(r["Close"]), 0, 0] for ts, r in g.iterrows()]
        rows.sort(key=lambda x: x[0])
        days.append((d.isoformat(), rows))
    days.sort(key=lambda x: x[0])
    return days


def main():
    global T_YEARS
    parser = argparse.ArgumentParser()
    parser.add_argument("--tf", type=int, default=1)
    parser.add_argument("--style", default="all", choices=["all", "momentum", "range", "vwap", "breakout"])
    parser.add_argument("--out", default=str(DATA / "scalp_backtest_results.txt"))
    args = parser.parse_args()

    dte = (datetime(2026, 8, 6, tzinfo=IST_TZ) - datetime.now(IST_TZ)).total_seconds() / 86400.0
    T_YEARS = max(dte, 1) / 365.0

    if args.tf == 1:
        days = load_candle_days(); eod = "15:20"
        lookbacks = [3, 5, 10, 15, 30]
        thrs = [10, 25, 50]
    else:
        days = load_60m_days(); eod = "15:00"
        lookbacks = [2, 3, 5]
        thrs = [50, 100, 200]
    styles = ["momentum", "range", "vwap", "breakout"] if args.style == "all" else [args.style]
    print(f"tf={args.tf} days={len(days)} ({days[0][0]}..{days[-1][0]}) styles={styles}", file=sys.stderr)

    results = []
    total = len(styles) * len(lookbacks) * len(thrs) * 4
    cell = 0
    t0 = time.time()
    for style in styles:
        for lb in lookbacks:
            for thr in thrs:
                for target, sl in [(200, -150), (300, -150), (300, -200), (500, -200)]:
                    cell += 1
                    nets = []; nt = 0
                    for date, rows in days:
                        tr = scalp_day(rows, style, lb, thr, target, sl, cooldown=2, eod_hm=eod)
                        nets.append(sum(tr)); nt += len(tr)
                    med = statistics.median(nets) if nets else 0
                    posd = sum(1 for n in nets if n > 0) / len(nets) * 100 if nets else 0
                    results.append({
                        "style": style, "lb": lb, "thr": thr, "target": target, "sl": sl,
                        "med": round(med, 2), "posd": round(posd, 1),
                        "net": round(sum(nets), 2), "trades": nt,
                    })
                    if cell % 200 == 0:
                        print(f"  {cell}/{total} ({time.time()-t0:.0f}s)", file=sys.stderr, flush=True)

    results.sort(key=lambda x: (x["med"], x["posd"]), reverse=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        f.write(f"SCALP BACKTEST tf={args.tf}min days={len(days)} ({days[0][0]}..{days[-1][0]}) costs=ON\n")
        f.write(f"{'style':<10} {'lb':>4} {'thr':>5} {'tgt':>5} {'SL':>6} {'med/day':>9} {'%pos':>6} {'net':>10} {'tr':>6}\n")
        for r in results:
            f.write(f"{r['style']:<10} {r['lb']:>4} {r['thr']:>5} {r['target']:>5} {r['sl']:>6} "
                    f"{r['med']:>9,.0f} {r['posd']:>5.0f}% {r['net']:>10,.0f} {r['trades']:>6}\n")
    csv_out = out.with_suffix(".csv")
    with open(csv_out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["style", "lb", "thr", "target", "sl", "med", "posd", "net", "trades"])
        w.writeheader(); w.writerows(results)
    print(f"wrote {out} + {csv_out} ({len(results)} configs)", file=sys.stderr)
    print(f"\nSCALP tf={args.tf}min — TOP 25 (by median day P&L)")
    print(f"{'style':<10} {'lb':>4} {'thr':>5} {'tgt':>5} {'SL':>6} {'med/day':>9} {'%pos':>6} {'net':>10} {'tr':>6}")
    for r in results[:25]:
        print(f"{r['style']:<10} {r['lb']:>4} {r['thr']:>5} {r['target']:>5} {r['sl']:>6} "
              f"{r['med']:>9,.0f} {r['posd']:>5.0f}% {r['net']:>10,.0f} {r['trades']:>6}")


if __name__ == "__main__":
    main()

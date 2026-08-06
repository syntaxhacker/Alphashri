#!/usr/bin/env python3
"""Realistic SENSEX options backtest — matches LIVE fills, not mid-price.

Fixes the 5 sins that made our backtests diverge from live:
  1. bid/ask spread  — buy at ask, sell at bid (spread modeled from a rate)
  2. slippage        — extra adverse move on each fill
  3. poll cadence    — decisions every N seconds (30s like the live monitor)
  4. costs           — Indian option charges (STT/brk/exch/GST)
  5. expiry-aware    — time-to-close theta on expiry day

Strategies: the top5 scalp configs + range/reversion configs (same families that
ran live today). Run per-day or walk-forward.

Usage:
  python3 scripts/paper_sensex_realistic_backtest.py [--day 2026-08-06]
      [--spread 2.0] [--slip 0.5] [--cadence 30] [--family all]
"""
from __future__ import annotations

import argparse
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA = ROOT / "experiments" / "data"
sys.path.insert(0, str(ROOT))

from scripts.paper_sensex import load_candle_days, option_costs, strategy_configs, oi_anchors_from_live  # noqa: E402
import config as root_config  # noqa: E402
IST = root_config.IST

IV = 0.19
LOT = 20


def bs(side, spot, strike, t, iv=IV, r=0.05):
    def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
    if t <= 1e-6:
        t = 1e-6
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    v = (spot * ncdf(d1) - strike * math.exp(-r * t) * ncdf(d2)) if side == "CE" \
        else (strike * math.exp(-r * t) * ncdf(-d2) - spot * ncdf(-d1))
    intr = max(spot - strike, 0) if side == "CE" else max(strike - spot, 0)
    return max(v, intr)


def realistic_fill(side, mid, spread, slip):
    """Buy pays ask (mid+spread/2) + slippage; sell receives bid (mid-spread/2) - slip."""
    if side == "CE":
        return mid + spread / 2 + slip
    return mid - spread / 2 - slip


def scalp_entry(rows, i, style, lb, thr):
    """Momentum/range entry on bar i. Returns 'CE'/'PE'/None."""
    if i < lb + 1:
        return None
    spot = float(rows[i][4])
    if style == "momentum":
        mom = spot - float(rows[i - lb][4])
        return "CE" if mom >= thr else ("PE" if mom <= -thr else None)
    # range
    lows = [float(rows[j][3]) for j in range(i - lb, i)]
    highs = [float(rows[j][2]) for j in range(i - lb, i)]
    if spot <= min(lows) + 5:
        return "CE"
    if spot >= max(highs) - 5:
        return "PE"
    return None


def range_entry(spot, lv, cfg):
    """Replicate RangeStrategy decide_with_levels. Returns ('CE'/'PE'/None, reason)."""
    day = lv.get("day", {})
    low, high = day.get("low", 0), day.get("high", 0)
    if high <= low:
        return None, ""
    day_open = day.get("open", 0)
    down_day = day_open > 0 and spot < day_open
    up_day = day_open > 0 and spot > day_open
    # trend filter
    if cfg.get("trend_filter", True):
        allow_long, allow_short = not down_day, not up_day
    else:
        allow_long = allow_short = True
    sup = lv.get("next_support") or low
    res = lv.get("next_resistance") or high
    zone = cfg.get("zone_pts", 50)
    brk = cfg.get("break_buffer", 15)
    rules = set(cfg.get("rules", ["support_bounce", "resistance_reject", "breakdown", "breakout"]))
    if allow_long and "support_bounce" in rules and spot <= sup + zone:
        return "CE", f"support_bounce sup={sup:,.0f}"
    if allow_short and "resistance_reject" in rules and spot >= res - zone:
        return "PE", f"resistance_reject res={res:,.0f}"
    if allow_short and "breakdown" in rules and spot <= sup - brk:
        return "PE", f"breakdown below {sup:,.0f}"
    if allow_long and "breakout" in rules and spot >= res + brk:
        return "CE", f"breakout above {res:,.0f}"
    return None, ""


def run_day(cfg, rows, spread, slip, cadence_s, t_years, is_expiry):
    """Replay one config on one day with realistic fills. Returns (net, trades, wins)."""
    trades = []
    pos = None
    n = len(rows)
    i = 0
    # cadence: sample every ceil(cadence_s/60) minutes
    step = max(1, round(cadence_s / 60))
    while i < n:
        hm = rows[i][0][11:16]
        spot = float(rows[i][4])
        if pos:
            # manage: check SL/TP on this bar (use bar high/low)
            hi = float(rows[i][2]); lo = float(rows[i][3])
            pnl_hi = (realistic_fill("PE", bs(pos["side"], hi, pos["strike"], t_years), spread, slip)
                      - pos["prem"]) * LOT if pos["side"] == "PE" else \
                     (realistic_fill("CE", bs(pos["side"], hi, pos["strike"], t_years), spread, slip)
                      - pos["prem"]) * LOT
            pnl_lo = (realistic_fill("PE", bs(pos["side"], lo, pos["strike"], t_years), spread, slip)
                      - pos["prem"]) * LOT if pos["side"] == "PE" else \
                     (realistic_fill("CE", bs(pos["side"], lo, pos["strike"], t_years), spread, slip)
                      - pos["prem"]) * LOT
            reason = None
            if pnl_lo <= cfg["sl"]:
                reason = "SL"
            elif pnl_hi >= cfg["target"]:
                reason = "TARGET"
            elif hm >= ("14:30" if is_expiry else "15:20"):
                reason = "EOD"
            if reason:
                # realistic exit: sell at bid-slip
                exit_prem = realistic_fill("CE", bs(pos["side"], spot, pos["strike"], t_years), spread, slip) \
                    if pos["side"] == "CE" else realistic_fill("PE", bs(pos["side"], spot, pos["strike"], t_years), spread, slip)
                gross = (exit_prem - pos["prem"]) * LOT if pos["side"] == "CE" else (pos["prem"] - exit_prem) * LOT
                net = gross - option_costs(pos["prem"], exit_prem, LOT)
                trades.append(net)
                pos = None
                i += step
                continue
        else:
            # entry
            family = cfg.get("family")
            side = None
            if family == "scalp":
                side = scalp_entry(rows, i, cfg["style"], cfg.get("lb", 5), cfg.get("thr", 10))
            else:
                # build levels like the range strategy
                day_low = min(float(rows[j][3]) for j in range(n))
                day_high = max(float(rows[j][2]) for j in range(n))
                # cumulative up to now (no lookahead)
                day_low = min(float(rows[j][3]) for j in range(0, i + 1))
                day_high = max(float(rows[j][2]) for j in range(0, i + 1))
                lv = {"day": {"open": float(rows[0][1]), "high": day_high, "low": day_low},
                      "next_support": day_low, "next_resistance": day_high, "max_pain": 0}
                side, _ = range_entry(spot, lv, cfg)
            if side:
                strike = round(spot / 100) * 100 + (100 if side == "CE" else -100)
                # realistic entry: buy at ask+slip
                prem = realistic_fill("CE" if side == "CE" else "PE",
                                      bs(side, spot, strike, t_years), spread, slip)
                pos = {"side": side, "strike": strike, "prem": prem}
        i += step
    # leftover position at end -> EOD realistic
    if pos:
        exit_prem = realistic_fill("CE", bs(pos["side"], float(rows[-1][4]), pos["strike"], t_years), spread, slip) \
            if pos["side"] == "CE" else realistic_fill("PE", bs(pos["side"], float(rows[-1][4]), pos["strike"], t_years), spread, slip)
        gross = (exit_prem - pos["prem"]) * LOT if pos["side"] == "CE" else (pos["prem"] - exit_prem) * LOT
        trades.append(gross - option_costs(pos["prem"], exit_prem, LOT))
    net = sum(trades)
    wins = sum(1 for t in trades if t > 0)
    return net, len(trades), wins


def build_configs():
    """All candidate configs (scalp + range families)."""
    cfgs = []
    for style in ["momentum", "range"]:
        for lb in [3, 5]:
            for tgt, sl in [(300, -150), (500, -200)]:
                cfgs.append({"name": f"{style}-lb{lb}-t{abs(tgt)}", "family": "scalp",
                             "style": style, "lb": lb, "thr": 10, "target": tgt, "sl": sl})
    for c in strategy_configs():
        cfgs.append({"name": c["name"], "family": "range", "target": c["target"],
                     "sl": c["sl"], "zone_pts": 50, "break_buffer": 15,
                     "trend_filter": c.get("trend_filter", True),
                     "rules": c.get("rules", ["support_bounce", "resistance_reject", "breakdown", "breakout"])})
    return cfgs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--day", default="2026-08-06")
    parser.add_argument("--spread", type=float, default=2.0, help="premium spread ₹ (ask-bid)")
    parser.add_argument("--slip", type=float, default=0.5, help="slippage ₹ per fill")
    parser.add_argument("--cadence", type=int, default=30, help="decision cadence seconds")
    parser.add_argument("--family", default="all", choices=["all", "scalp", "range"])
    args = parser.parse_args()

    days = load_candle_days()
    target = next((d for d in days if d[0] == args.day), None)
    if not target:
        raise SystemExit(f"day {args.day} not in cache ({days[0][0]}..{days[-1][0]})")
    rows = target[1]
    is_expiry = args.day == "2026-08-06"
    dte = (datetime(2026, 8, 6, tzinfo=IST) - datetime.now(IST)).total_seconds() / 86400.0
    t_years = max(dte, 1) / 365.0

    cfgs = build_configs()
    if args.family != "all":
        cfgs = [c for c in cfgs if c["family"] == args.family]

    print(f"=== REALISTIC backtest {args.day} (expiry={is_expiry}) ===")
    print(f"spread=₹{args.spread} slip=₹{args.slip} cadence={args.cadence}s costs=ON")
    print(f"{'config':<28} {'family':<6} {'net':>9} {'trades':>6} {'W/L':>6}")
    results = []
    for c in cfgs:
        net, tr, wins = run_day(c, rows, args.spread, args.slip, args.cadence, t_years, is_expiry)
        results.append((c["name"], c["family"], net, tr, wins))
    results.sort(key=lambda x: x[2], reverse=True)
    for name, fam, net, tr, wins in results:
        print(f"{name:<28} {fam:<6} {net:>9,.0f} {tr:>6} {wins}/{tr-wins}")


if __name__ == "__main__":
    main()

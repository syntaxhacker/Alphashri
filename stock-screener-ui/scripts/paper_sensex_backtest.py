#!/usr/bin/env python3
"""Backtest the FIXED SENSEX range strategy on today's actual 1-min path.

Replays the fixed strategy (trend filter + frozen breakdown anchor) on today's
intraday candles WITHOUT lookahead: day-high/low are cumulative up to each
minute, and options are priced with Black-Scholes (IV from today's chain) with
t in years. SL/TP in ₹ net per lot.

Data: /tmp/sensex_1m.json (upstox 1-min, reverse chrono) or --file.
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.paper_sensex import fetch_chain  # noqa: E402

LOT = 20
EXPIRY = datetime(2026, 8, 6)
IV = 0.19          # SENSEX ATM IV observed today
NOW = datetime(2026, 8, 5, 12, 45)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_premium(side: str, spot: float, strike: float, t_years: float, iv: float, r: float = 0.05) -> float:
    if t_years <= 1e-6:
        t_years = 1e-6
    if side == "CE":
        intrinsic = max(spot - strike, 0)
    else:
        intrinsic = max(strike - spot, 0)
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t_years) / (iv * math.sqrt(t_years))
    d2 = d1 - iv * math.sqrt(t_years)
    if side == "CE":
        bs = spot * norm_cdf(d1) - strike * math.exp(-r * t_years) * norm_cdf(d2)
    else:
        bs = strike * math.exp(-r * t_years) * norm_cdf(-d2) - spot * norm_cdf(-d1)
    return max(bs, intrinsic)


def load_1m(path: str) -> list:
    with open(path) as f:
        raw = json.load(f)
    raw.sort(key=lambda r: r[0])
    out = []
    for r in raw:
        ts = r[0]
        try:
            dt = datetime.fromisoformat(ts)
        except Exception:
            dt = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S%z")
        out.append({"ts": dt, "open": float(r[1]), "high": float(r[2]),
                    "low": float(r[3]), "close": float(r[4])})
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="/tmp/sensex_1m.json")
    parser.add_argument("--start", default="09:15")
    parser.add_argument("--end", default="15:30")
    parser.add_argument("--target", type=float, default=600.0)
    parser.add_argument("--sl", type=float, default=-400.0)
    parser.add_argument("--trail-trigger", type=float, default=300.0)
    parser.add_argument("--trail-dist", type=float, default=250.0)
    parser.add_argument("--strike-offset", type=float, default=0.0,
                        help="strike offset pts (CE: base+offset, PE: base-offset)")
    args = parser.parse_args()

    candles = load_1m(args.file)
    if not candles:
        print("no candles")
        return
    day_open = candles[0]["open"]

    # static OI magnets from today's chain (resistances = high CE OI, supports = high PE OI)
    try:
        chain = fetch_chain()
        ce_oi, pe_oi = [], []
        for c in chain.get("data", []):
            st = c.get("strike_price")
            if not st:
                continue
            ce = ((c.get("call_options") or {}).get("market_data") or {}).get("oi", 0) or 0
            pe = ((c.get("put_options") or {}).get("market_data") or {}).get("oi", 0) or 0
            if ce > 2_000_000:
                ce_oi.append((st, float(ce)))
            if pe > 1_500_000:
                pe_oi.append((st, float(pe)))
        ce_oi.sort(key=lambda x: x[1], reverse=True)
        pe_oi.sort(key=lambda x: x[1], reverse=True)
        oi_res = min(ce_oi[:3], key=lambda x: abs(x[0] - day_open))[0] if ce_oi else day_open
        oi_sup = max(pe_oi[:3], key=lambda x: abs(x[0] - day_open))[0] if pe_oi else day_open
    except Exception:
        oi_res = oi_sup = day_open

    # replay with cumulative day low/high (no lookahead)
    trades = []
    pos = None
    cum_low = float("inf")
    cum_high = 0.0
    dte_days = (EXPIRY - NOW).total_seconds() / 86400.0
    t_years = max(dte_days, 1) / 365.0
    COOLDOWN_MIN = 5  # minutes after a close before re-entry (matches real cooldown)
    cooldown_until = 0.0
    anchor_low = None

    for i, c in enumerate(candles):
        ts = c["ts"]
        hm = ts.strftime("%H:%M")
        if hm < args.start or hm > args.end:
            continue
        spot = c["close"]
        cum_low = min(cum_low, c["low"])
        cum_high = max(cum_high, c["high"])

        # levels as the strategy would see them at this minute
        sup_cands = [x for x in [oi_sup, cum_low] if x < spot]
        res_cands = [x for x in [oi_res, cum_high] if x > spot]
        sup = max(sup_cands) if sup_cands else cum_low
        res = min(res_cands) if res_cands else cum_high
        down_day = spot < day_open
        up_day = spot > day_open

        # ---- frozen anchor: first day-low seen on a down-day (fixed reference) ----
        if down_day and anchor_low is None:
            anchor_low = cum_low
        sup_anchor = anchor_low if anchor_low is not None else cum_low

        # ---- manage open position ----
        if pos:
            pnl_hi = (bs_premium(pos["side"], c["high"], pos["strike"], t_years, IV) - pos["premium"]) * LOT
            pnl_lo = (bs_premium(pos["side"], c["low"], pos["strike"], t_years, IV) - pos["premium"]) * LOT
            pos["peak"] = max(pos.get("peak", pnl_lo), pnl_hi, pnl_lo)
            if pnl_lo <= args.sl:
                pos.update(reason="SL", pnl=args.sl, exit=spot)
            elif pos.get("peak") >= args.trail_trigger and pnl_hi <= pos["peak"] - args.trail_dist:
                pos.update(reason="TRAIL", pnl=round(pos["peak"] - 250, 2), exit=spot)
            elif pnl_hi >= args.target:
                pos.update(reason="TARGET", pnl=args.target, exit=spot)
            elif hm >= "15:20":
                pos.update(reason="EOD", pnl=round((bs_premium(pos["side"], spot, pos["strike"], t_years, IV) - pos["premium"]) * LOT, 2), exit=spot)
            if pos.get("reason"):
                trades.append(pos)
                next_entry = hm  # cooldown: no entry for COOLDOWN_MIN minutes
                pos = None
                cooldown_until = ts.timestamp() + COOLDOWN_MIN * 60
            continue

        # cooldown after a close
        if pos is None and ts.timestamp() < cooldown_until:
            continue

        # ---- entry signals (fixed strategy rules) ----
        mom = (spot - candles[i - 1]["close"]) if i > 0 else 0.0
        signal = None
        side = None
        if not down_day:
            # support bounce (CE) — only on up/flat day
            if spot <= sup + 50 and mom >= 0:
                signal = f"support bounce {sup:,.0f}"; side = "CE"
        if not up_day:
            # resistance reject (PE) on down/flat day
            if spot >= res - 50 and mom <= 0:
                signal = f"resistance reject {res:,.0f}"; side = "PE"
            # breakdown (PE) below frozen anchor on down-day
            if spot <= sup_anchor - 15 and mom <= 0:
                signal = f"breakdown below {sup_anchor:,.0f}"; side = "PE"
        if signal and side:
            # strike selection: nearest 100-strike + optional offset (positive=above spot, negative=below)
            base = round(spot / 100) * 100
            if side == "CE":
                strike = base + args.strike_offset
            else:
                strike = base - args.strike_offset
            premium = bs_premium(side, spot, strike, t_years, IV)
            pos = {"side": side, "strike": strike, "entry": spot, "premium": premium,
                   "time": hm, "signal": signal}

    if pos:
        pos.update(reason="EOD", pnl=round((bs_premium(pos["side"], spot, pos["strike"], t_years, IV) - pos["premium"]) * LOT, 2))
        trades.append(pos)

    total = sum(t["pnl"] for t in trades)
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    print(f"\n=== BACKTEST: FIXED strategy on today's 1-min path (no lookahead) ===")
    print(f"Day: open {day_open:,.0f}  high {cum_high:,.0f}  low {cum_low:,.0f}  last {spot:,.0f}")
    print(f"OI anchors: support {oi_sup:,.0f}  resistance {oi_res:,.0f}")
    print(f"Params: target +{args.target:.0f} / SL {args.sl:.0f} / lot {LOT} / IV {IV:.0%} / t {t_years:.4f}y")
    print(f"Trades: {len(trades)}  Wins: {len(wins)}  Losses: {len(losses)}")
    for t in trades:
        print(f"  {t['time']}  {t['side']:<3} {t['strike']:>7,.0f}  entry {t['entry']:>9,.0f} "
              f"prem {t['premium']:>7.2f}  {t['reason']:<6}  P&L {t['pnl']:>+8,.0f}  [{t['signal']}]")
    print(f"NET: {total:+,.2f}")


if __name__ == "__main__":
    main()

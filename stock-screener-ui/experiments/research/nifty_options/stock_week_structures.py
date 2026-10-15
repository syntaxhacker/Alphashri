"""Evaluate every standard structure on one stock over a past week, real FYERS premiums.

Answers "how much could we have made, and what would have worked" without hindsight
bias in the *pricing* (real quotes) — the hindsight is only in choosing the window.

Usage:
  .venv/bin/python stock_week_structures.py --symbol TMPV --entry 2026-09-21 --exit 2026-09-25
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402
import costs  # noqa: E402
from costs import ExecutionModel  # noqa: E402

EX = ExecutionModel()
UNIVERSE = {
    "TMPV":     {"fyers": "NSE:TMPV-EQ", "step": 5,  "lot": 1600},
    "RELIANCE": {"fyers": "NSE:RELIANCE-EQ", "step": 10, "lot": 500},
}


def last_tuesday(year, month):
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)
    d = nxt - timedelta(days=1)
    while d.weekday() != 1:
        d -= timedelta(days=1)
    return d


def contract(sym, exp, K, opt):
    return f"NSE:{sym}{exp:%y}{fd._MONTH3[exp.month - 1]}{K}{opt}"


class Pricer:
    def __init__(self, min_interval=0.6):
        self.c = fd.FyersData(min_interval=min_interval, verbose=False)
        self.cache = {}

    def prem(self, sym, exp, K, opt, ts):
        key = contract(sym, exp, K, opt)
        if key not in self.cache:
            frm = (date(exp.year, exp.month, 1) - timedelta(days=60)).isoformat()
            df = fd.fetch_candles_cached(self.c, key, "5", frm, date.today().isoformat())
            self.cache[key] = df.set_index("ts").sort_index() if df is not None and len(df) else None
        df = self.cache[key]
        if df is None:
            return None
        idx = df.index[df.index <= ts]
        return float(df.loc[idx[-1], "close"]) if len(idx) else None


def fill(p, side):
    return p * (1 + EX.half_spread_pct + EX.slippage_pct) if side == "BUY" \
        else p * (1 - EX.half_spread_pct - EX.slippage_pct)


def evaluate(sym, entry, exit_, exp, spot0, spot1, structures, ts_in, ts_out):
    lot = UNIVERSE[sym]["lot"]
    step = UNIVERSE[sym]["step"]
    pr = Pricer()
    rows = []
    for name, legs in structures.items():
        entry_net = 0.0
        exit_net = 0.0
        fees = 0.0
        ok = True
        legs_dbg = []
        for opt, side, off in legs:
            if opt == "STK":
                pin, pout = spot0, spot1
            else:
                K = int(round(spot0 / step) * step) + off * step
                pin = pr.prem(sym, exp, K, opt, ts_in)
                pout = pr.prem(sym, exp, K, opt, ts_out)
                if pin is None or pout is None or pin <= 0:
                    ok = False
                    break
            ei = pin if opt == "STK" else fill(pin, side)
            xo = pout if opt == "STK" else fill(pout, "SELL" if side == "BUY" else "BUY")
            s = 1 if side == "BUY" else -1
            entry_net += s * ei
            exit_net += s * xo
            fees += costs.leg_costs(ei, lot, side) + costs.leg_costs(xo, lot, "SELL" if side == "BUY" else "BUY")
            legs_dbg.append(("L" if side == "BUY" else "S") + (opt if opt == "STK" else f"{opt}{K}"))
        if not ok:
            rows.append({"structure": name, "legs": "-", "entry": None, "exit": None,
                         "net_pct": None, "net_lot": None, "note": "illiquid/missing"})
            continue
        # gross P&L = (exit_net - entry_net) * lot  (works for debit and credit)
        gross = (exit_net - entry_net) * lot
        net = gross - fees
        rows.append({
            "structure": name, "legs": " ".join(legs_dbg),
            "entry": round(entry_net, 2), "exit": round(exit_net, 2),
            "gross_lot": round(gross, 0), "fees": round(fees, 0),
            "net_lot": round(net, 0),
            "net_pct_stock": round(net / (spot0 * lot) * 100, 2),
            "note": "" if exp > exit_ else "settled",
        })
    return rows


def brief(sym, entry, exit_):
    meta = UNIVERSE[sym]
    c = fd.FyersData(min_interval=0.5, verbose=False)
    q = c.quotes([meta["fyers"]])
    spot1 = q[meta["fyers"]]["lp"]
    # entry spot from daily history
    df = fd.fetch_candles_cached(c, meta["fyers"], "D", str(entry), str(exit_))
    df = df.set_index("ts")
    spot0 = float(df.loc[df.index[df.index.date == entry], "open"].iloc[0])
    spot1 = float(df.loc[df.index[df.index.date == exit_], "close"].iloc[0])
    exp = last_tuesday(entry.year, entry.month)
    ts_in = pd.Timestamp(entry).tz_localize("Asia/Kolkata") + pd.Timedelta(hours=9, minutes=30)
    ts_out = pd.Timestamp(exit_).tz_localize("Asia/Kolkata") + pd.Timedelta(hours=15, minutes=15)
    step = meta["step"]
    atm = int(round(spot0 / step) * step)
    S = {
        "Buy & hold (stock only)": [("STK", "BUY", 0)],
        "Covered call (stock + sell CE 0)": [("STK", "BUY", 0), ("CE", "SELL", 0)],
        "Covered call (stock + sell CE +2)": [("STK", "BUY", 0), ("CE", "SELL", 2)],
        "Protective put (stock + buy PE -2)": [("STK", "BUY", 0), ("PE", "BUY", -2)],
        "Long call (ATM)": [("CE", "BUY", 0)],
        "Long call (OTM +1)": [("CE", "BUY", 1)],
        "Long put (ATM)": [("PE", "BUY", 0)],
        "Long put (OTM -1)": [("PE", "BUY", -1)],
        "Long put (OTM -2)": [("PE", "BUY", -2)],
        "Long straddle (ATM)": [("CE", "BUY", 0), ("PE", "BUY", 0)],
        "Long strangle (CE+1 / PE-1)": [("CE", "BUY", 1), ("PE", "BUY", -1)],
        "Short straddle (ATM)": [("CE", "SELL", 0), ("PE", "SELL", 0)],
        "Short strangle (CE+1 / PE-1)": [("CE", "SELL", 1), ("PE", "SELL", -1)],
        "Bear call spread (sell CE0 / buy CE+2)": [("CE", "SELL", 0), ("CE", "BUY", 2)],
        "Bear put spread (buy PE0 / sell PE-2)": [("PE", "BUY", 0), ("PE", "SELL", -2)],
        "Bull put spread (sell PE-2 / buy PE-3)": [("PE", "SELL", -2), ("PE", "BUY", -3)],
        "Iron condor (sell CE+1/PE-1, buy CE+3/PE-3)": [("CE", "SELL", 1), ("PE", "SELL", -1),
                                                        ("CE", "BUY", 3), ("PE", "BUY", -3)],
        "Iron fly (sell ATM straddle, buy CE+3/PE-3)": [("CE", "SELL", 0), ("PE", "SELL", 0),
                                                        ("CE", "BUY", 3), ("PE", "BUY", -3)],
        "Risk reversal (sell PE-2 / buy CE+2)": [("PE", "SELL", -2), ("CE", "BUY", 2)],
    }
    rows = evaluate(sym, entry, exit_, exp, spot0, spot1, S, ts_in, ts_out)
    return spot0, spot1, exp, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="TMPV")
    ap.add_argument("--entry", default="2026-09-21")
    ap.add_argument("--exit", default="2026-09-25")
    args = ap.parse_args()
    e = date.fromisoformat(args.entry)
    x = date.fromisoformat(args.exit)
    spot0, spot1, exp, rows = brief(args.symbol, e, x)
    lot = UNIVERSE[args.symbol]["lot"]
    print(f"\n=== {args.symbol}  {args.entry} -> {args.exit}  spot {spot0} -> {spot1} "
          f"({(spot1-spot0)/spot0*100:+.2f}%)  expiry {exp}  lot {lot}  "
          f"[{'SETTLED' if exp <= x else 'MARK-TO-MARKET'}] ===")
    print(f"{'strategy':46s} {'entry':>8} {'exit':>8} {'net ₹/lot':>11} {'% of capital':>13}  legs")
    for r in sorted(rows, key=lambda r: (r["net_lot"] is None, -(r["net_lot"] or -1e18))):
        if r["net_lot"] is None:
            print(f"{r['structure']:46s} {'-':>8} {'-':>8} {'N/A':>11} {'-':>13}  {r['note']}")
        else:
            print(f"{r['structure']:46s} {r['entry']:>8} {r['exit']:>8} {r['net_lot']:>11,.0f} "
                  f"{r['net_pct_stock']:>12.2f}%  {r['legs']}")


if __name__ == "__main__":
    main()

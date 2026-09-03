"""Validate SMCIFVGEngine on Dukascopy tick data — thin wrapper over the clean module.

Usage:
  source .venv/bin/activate && python scripts/smc_ifvg_eval.py --date 2026-09-02 [--from-ist 14:10 --to-ist 19:00]
  python scripts/smc_ifvg_eval.py --matrix          # all 6 cached sessions, summary only
"""
import argparse
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, __file__.rsplit("/", 2)[0])

from scripts.smc_tick_eval import fetch_ticks, build_1m_bars
from trading.smc_ifvg import SMCIFVGEngine

IST = timezone(timedelta(hours=5, minutes=30))
DATES = ["2026-07-02", "2026-07-10", "2026-07-22", "2026-07-24", "2026-08-26", "2026-09-02"]


def ist(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(IST).strftime("%H:%M:%S")


def run_session(date, engines=None, from_ist=None, to_ist=None, verbose=True):
    from trading.smc_ifvg import SMCIFVGEngine
    ticks = fetch_ticks(date)
    bars = build_1m_bars(ticks)
    trades = []
    for _name, eng in (engines or [("both", SMCIFVGEngine())]):
        trades.extend(eng.run(bars, ticks))
    win = [t for t in trades
           if (not from_ist or ist(t["t_in"])[:5] >= from_ist)
           and (not to_ist or ist(t["t_in"])[:5] <= to_ist)]
    if verbose:
        print(f"\n=== {date} — {len(bars)} bars / {len(ticks):,} ticks — {len(trades)} trades ===")
        for t in trades:
            tp_s = f"{t['tp']:.2f}" if t["tp"] else "trail"
            print(f"  {ist(t['t_in']):<9}{ist(t['t_out']):<9}{t['side']:<6}{t['kind']:<7}fill {t['entry']:>9.2f}  "
                  f"SL {t['sl']:>9.2f}  TP {tp_s:>9}  exit {t['exit']:>9.2f} {t['result']:<6}"
                  f"{t['pnl']:>+8.2f}{t['rr']:>+7.2f}R")
    return win


def summary_line(trades):
    n = len(trades)
    net = sum(t["pnl"] for t in trades)
    w = sum(1 for t in trades if t["pnl"] > 0)
    gp = sum(t["pnl"] for t in trades if t["pnl"] > 0)
    gl = abs(sum(t["pnl"] for t in trades if t["pnl"] < 0))
    pf = f"{gp / gl:.2f}" if gl else "inf"
    return n, net, w, pf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--from-ist")
    ap.add_argument("--to-ist")
    ap.add_argument("--min-rr", type=float)
    ap.add_argument("--cooldown", type=int)
    ap.add_argument("--divided", action="store_true", help="run inv + retest stacks independently")
    ap.add_argument("--dedupe", action="store_true", help="skip same-side entries within 5 min across stacks")
    ap.add_argument("--tp-mode", default="far", choices=["far", "near"])
    ap.add_argument("--partials", action="store_true")
    ap.add_argument("--matrix", action="store_true")
    args = ap.parse_args()

    shared = {"fills": []} if args.dedupe else None
    base = {"min_rr": args.min_rr} if args.min_rr is not None else {}
    if args.cooldown is not None:
        base["cooldown"] = args.cooldown
    base.update({"tp_mode": args.tp_mode, "partials": args.partials})
    def make_engines():
        sh = {"fills": []} if args.dedupe else None
        if args.divided:
            return [("inv", SMCIFVGEngine(entries="inv", shared=sh, **base)),
                    ("retest", SMCIFVGEngine(entries="retest", shared=sh, **base))]
        return [("both", SMCIFVGEngine(shared=sh, **base))]

    if args.matrix:
        grand_n = grand_w = 0
        grand_net = 0.0
        for d in DATES:
            trades = run_session(d, make_engines(), verbose=False)
            n, net, w, pf = summary_line(trades)
            grand_n += n; grand_net += net; grand_w += w
            print(f"{d}  {n:>3} trades  net {net:>+9.2f}  win {w}/{n}  PF {pf}")
        print(f"\nTOTAL  {grand_n} trades  net {grand_net:+.2f}  win {grand_w}/{grand_n}  "
              f"({100 * grand_w / max(1, grand_n):.0f}%)  avg {grand_net / max(1, grand_n):+.2f}/trade")
    else:
        date = args.date or "2026-09-02"
        trades = run_session(date, make_engines(), from_ist=args.from_ist, to_ist=args.to_ist)
        n, net, w, pf = summary_line(trades)
        print(f"\n  window: {n} trades · net {net:+.2f} pts · win {w}/{n} · PF {pf}")


if __name__ == "__main__":
    main()

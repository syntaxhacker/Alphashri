#!/usr/bin/env python3
"""Run the NiftyMaxPain bot over every recorded tape day and print metrics.

Replays the *actual strategy* through ``Strategy.run`` (same engine, costs and
exit rules as the live paper runner) — no separate simulator.

    .venv/bin/python scripts/market/run_maxpain_bot.py
    .venv/bin/python scripts/market/run_maxpain_bot.py --reclaim 5 --touches 99
"""
from __future__ import annotations

import argparse
import pathlib
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from options_paper import tape  # noqa: E402
from options_paper.strategies import build  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reclaim", type=float, default=0.0,
                    help="exit the PE when spot reclaims max pain + this many pts")
    ap.add_argument("--touches", type=int, default=4,
                    help="only trade max-pain touches 1..N")
    ap.add_argument("--confirm", type=int, default=5)
    ap.add_argument("--date", default=None)
    args = ap.parse_args(argv)

    dates = [args.date] if args.date else tape.available_dates()
    trades = []
    for d in dates:
        ticks = tape.load_tape(d)
        if len(ticks) < 60:
            continue
        st = build("nifty_maxpain", lots=1, reclaim_pts=args.reclaim,
                   max_touches=args.touches, confirm_min=args.confirm)
        trades.extend(st.run(ticks, {}))

    if not trades:
        print("no trades")
        return 1
    net = sum(t.net_pnl for t in trades)
    wins = sum(1 for t in trades if t.net_pnl > 0)
    gp = sum(t.net_pnl for t in trades if t.net_pnl > 0)
    gl = sum(-t.net_pnl for t in trades if t.net_pnl < 0)
    print(f"reclaim +{args.reclaim:g}  touches<={args.touches}  confirm {args.confirm}m")
    print(f"trades {len(trades)}  win {wins/len(trades):.0%}  net ₹{net:+,.0f}  "
          f"avg ₹{net/len(trades):+,.0f}  PF {gp/max(gl,1):.2f}")
    by = defaultdict(list)
    for t in trades:
        by[t.entry_time[:10]].append(t.net_pnl)
    for day, pnls in sorted(by.items()):
        print(f"  {day}  n={len(pnls)}  net ₹{sum(pnls):+,.0f}  "
              f"win {sum(1 for x in pnls if x > 0)}/{len(pnls)}")
    print("\ntrades:")
    for t in trades:
        print(f"  {t.entry_time[:16]}  {t.opt} K{t.strike:.0f}  "
              f"{t.entry_premium:7.2f} -> {t.exit_premium:7.2f}  "
              f"{t.exit_reason:<24}  net ₹{t.net_pnl:+,.0f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

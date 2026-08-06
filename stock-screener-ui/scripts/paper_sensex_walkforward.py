#!/usr/bin/env python3
"""Walk-forward validation for SENSEX strategies (1-min cache).

Walk-forward = the honest test: at each step, pick the best config using ONLY
past days (train window), then evaluate it on the NEXT day (test). Roll forward.
This shows what you'd ACTUALLY have made trading the backtest winner — instead
of the in-sample "best of N" illusion.

Strategy candidates: the 5 scalp configs (from paper_sensex_scalp_backtest) +
range/reversion configs (from paper_sensex strategy_configs).

Usage:
  python3 scripts/paper_sensex_walkforward.py [--train 12] [--test 1] [--step 1]
"""
from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.paper_sensex import load_candle_days, run_day_sweep, strategy_configs, oi_anchors_from_live  # noqa: E402
sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util
_spec = importlib.util.spec_from_file_location("scalp", ROOT / "scripts" / "paper_sensex_scalp_backtest.py")
_scalp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_scalp)

import config as root_config  # noqa: E402
from datetime import datetime  # noqa: E402


def scalp_day_pnl(cfg, rows, t_years):
    """Reuse scalp backtest's per-day replay for a scalp config."""
    nets = []
    tr = _scalp.scalp_day(rows, cfg["style"], cfg["lb"], cfg["thr"],
                          cfg["target"], cfg["sl"], cooldown=2, eod_hm="15:20")
    return sum(tr), len(tr)


def range_day_pnl(cfg, rows, oi_sup, oi_res, t_years):
    r = run_day_sweep(cfg, rows, oi_sup, oi_res, cfg["target"], cfg["sl"],
                      cfg.get("trail_trigger", 1e9), cfg.get("trail_dist", 250),
                      t_years, iv=0.19)
    return r["net"], r["trades"]


def build_candidates():
    """Scalp configs (from the scalp backtest grid) + range/reversion configs."""
    cands = []
    # scalp family — the 5 that mattered
    for style in ["momentum", "range"]:
        for lb in [3, 5]:
            for thr in [10]:
                for tgt, sl in [(300, -150), (500, -200)]:
                    cands.append({
                        "name": f"{style}-lb{lb}-t{tgt}",
                        "family": "scalp", "style": style, "lb": lb, "thr": thr,
                        "target": tgt, "sl": sl,
                    })
    # range/reversion family
    for cfg in strategy_configs():
        cands.append({
            "name": cfg["name"], "family": "range", "config": cfg["name"],
            "target": cfg["target"], "sl": cfg["sl"],
            "trail_trigger": cfg["trail_trigger"], "trail_dist": cfg["trail_dist"],
        })
    return cands


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=int, default=12, help="train window days")
    parser.add_argument("--test", type=int, default=1, help="test days per step")
    parser.add_argument("--step", type=int, default=1, help="roll-forward step")
    args = parser.parse_args()

    days = load_candle_days()
    n = len(days)
    oi_sup, oi_res = oi_anchors_from_live()
    dte = (datetime(2026, 8, 6, tzinfo=root_config.IST) - datetime.now(root_config.IST)).total_seconds() / 86400.0
    t_years = max(dte, 1) / 365.0

    cands = build_candidates()
    print(f"candidates: {len(cands)} | days: {n} | train={args.train} test={args.test} step={args.step}")
    print(f"date range: {days[0][0]} .. {days[-1][0]}")
    print(f"Walk-forward: select best on train window, evaluate on next {args.test} day(s)\n")

    # Precompute per-day P&L for every candidate × day
    print("precomputing per-day P&L...", file=sys.stderr)
    day_pnl = {}   # (cand_name, date) -> (net, trades)
    for c in cands:
        for date, rows in days:
            if c["family"] == "scalp":
                day_pnl[(c["name"], date)] = scalp_day_pnl(c, rows, t_years)
            else:
                day_pnl[(c["name"], date)] = range_day_pnl(c, rows, oi_sup, oi_res, t_years)
    print("precompute done", file=sys.stderr)

    # Walk forward
    steps = []
    i = args.train
    while i + args.test <= n:
        train_dates = [d for d, _ in days[i - args.train:i]]
        test_dates = [d for d, _ in days[i:i + args.test]]
        # pick best candidate by median day P&L on train
        scores = []
        for c in cands:
            nets = [day_pnl[(c["name"], d)][0] for d in train_dates]
            scores.append((statistics.median(nets) if nets else 0, c["name"]))
        scores.sort(reverse=True)
        best = scores[0][1]
        # evaluate on test
        test_net = sum(day_pnl[(best, d)][0] for d in test_dates)
        test_trades = sum(day_pnl[(best, d)][1] for d in test_dates)
        steps.append({
            "train": f"{train_dates[0][5:]}..{train_dates[-1][5:]}",
            "test": f"{test_dates[0][5:]}..{test_dates[-1][5:]}",
            "picked": best, "train_med": scores[0][0],
            "test_net": test_net, "test_trades": test_trades,
        })
        i += args.step

    print(f"{'step':<4} {'train window':<20} {'test window':<12} {'picked':<28} {'train_med':>9} {'test_net':>9} {'tr':>4}")
    total_test = 0.0
    total_trades = 0
    for idx, s in enumerate(steps, 1):
        print(f"{idx:<4} {s['train']:<20} {s['test']:<12} {s['picked']:<28} {s['train_med']:>9,.0f} {s['test_net']:>9,.0f} {s['test_trades']:>4}")
        total_test += s["test_net"]
        total_trades += s["test_trades"]
    print(f"\nTOTAL walk-forward net: {total_test:+,.0f}  ({total_trades} trades, {len(steps)} steps)")

    # Baseline: in-sample 'best of all days' — the illusion we're testing against
    print("\n--- comparison: in-sample 'best of all days' ---")
    in_sample = []
    for c in cands:
        nets = [day_pnl[(c["name"], d)][0] for d, _ in days]
        in_sample.append((statistics.median(nets) if nets else 0, c["name"], sum(nets)))
    in_sample.sort(reverse=True)
    for m, name, tot in in_sample[:5]:
        print(f"  {name:<28} median {m:>9,.0f}  total {tot:>9,.0f}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""Inspect / stress a candidate double-VWAP config on the cached Dukascopy bars.

  .venv/bin/python scripts/research/double_vwap/inspect.py --preset chart
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

import strategy as S


PRESETS = {
    # the literal chart read: fade the ON-range break, add under NY VWAP, ON VWAP target
    "chart": S.base_cfg(range_src="on", legs="AB", stop_src="range", stop_buf=10.0,
                        target_a="onvwap", target_b="onvwap", dir_filter="away_on",
                        require_untouched=True),
    # the widest-sample version of the same idea
    "wide": S.base_cfg(range_src="or60", legs="A", stop_src="sigext", stop_buf=20.0,
                       target_a="mid", dir_filter="away_on"),
    # the second-leg-only (NY VWAP continuation) version
    "legb": S.base_cfg(range_src="on", legs="B", stop_src="range", stop_buf=20.0,
                       target_b="onvwap"),
}


def dist(trades):
    if not trades:
        return "none"
    R = np.array([t["R"] for t in trades])
    q = np.percentile(R, [5, 25, 50, 75, 95])
    return (f"n={len(R)} mean={R.mean():+.2f} sd={R.std(ddof=1):.2f} "
            f"min={R.min():+.2f} p5={q[0]:+.2f} p25={q[1]:+.2f} med={q[2]:+.2f} "
            f"p75={q[3]:+.2f} p95={q[4]:+.2f} max={R.max():+.2f}")


def show(trades, days, tag):
    print(f"\n=== {tag} ===")
    print("  all   ", S.stats(trades, len(days)), dist(trades))
    for k in ("A", "B"):
        sub = [t for t in trades if t["kind"] == k]
        print(f"  leg {k} ", S.stats(sub, len(days)), dist(sub))
    for sd, nm in ((1, "long"), (-1, "short")):
        sub = [t for t in trades if t["side"] == sd]
        print(f"  {nm:5s} ", S.stats(sub, len(days)))
    mix = pd.Series([t["exit"] for t in trades]).value_counts().to_dict()
    print("  exits ", mix)
    df = pd.DataFrame(trades)
    df["q"] = pd.to_datetime(df["date"]).dt.to_period("Q")
    g = df.groupby("q")["R"].agg(["count", "mean", "sum"]).round(3)
    print("  by quarter:\n", g.to_string())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", default="chart", choices=list(PRESETS))
    args = ap.parse_args()
    cfg = PRESETS[args.preset]

    df = S.load()
    days = S.build_days(df)
    cost = 1.1
    trades = S.collect(days, cfg, cost)
    show(trades, days, f"{args.preset} @ {cost}pt")

    print("\ncost sensitivity")
    for c in (0.0, 1.1, 2.0, 3.0, 4.0):
        tr = S.collect(days, cfg, c)
        st = S.stats(tr, len(days))
        print(f"  cost {c:>4.1f}pt  n={st['n']:3d} avgR={st['avgR']:+.3f} "
              f"t={st['t']:+.2f} PF={st['PF']:.2f}")

    print("\nyear halves")
    for y, sub in pd.DataFrame(trades).groupby(pd.to_datetime(pd.DataFrame(trades)["date"]).dt.year):
        print(f"  {y}: n={len(sub)} avgR={sub['R'].mean():+.3f} sum={sub['R'].sum():+.1f}")

    # timing/level placebos live in validate.py (random-range, same geometry)


if __name__ == "__main__":
    raise SystemExit(main())

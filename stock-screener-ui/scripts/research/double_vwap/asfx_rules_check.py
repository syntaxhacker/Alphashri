#!/usr/bin/env python
"""Test Austin Silver's stated rules against our engine, on both years.

From his own posts (2026-11-13..20):
  - setup: sweep of premarket/overnight extreme -> failed break -> Double Break
  - first entry fades the sweep; second entry is the NY-VWAP reclaim/break
  - exits "because of the location of NY VWAP, the size of the opening range,
    or how extended the move is" — i.e. NOT held to the overnight-VWAP magnet
  - "one and done", done before 10:30 ET

So this checks: A target = NY VWAP (not ON VWAP), B target = untouched ON VWAP,
entries cut off at 10:30, and the 2026 vs 2023 comparison.

  .venv/bin/python scripts/research/double_vwap/asfx_rules_check.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S
from holdout_random_days import load_csv

OUT = os.path.join(S.OUTDIR, "asfx_rules.json")
CUT_1030 = 10 * 60 + 30


def stat(trades, n_days):
    if not trades:
        return dict(n=0, avgR=0.0, t=0.0, PF=0.0, win=0.0)
    R = np.array([t["R"] for t in trades], float)
    pos, neg = R[R > 0].sum(), R[R <= 0].sum()
    sd = R.std(ddof=1)
    return dict(n=int(len(R)), avgR=round(float(R.mean()), 4),
                win=round(100 * float((R > 0).mean()), 1),
                PF=round(float(pos / -neg), 2) if neg < 0 else 99.0,
                t=round(float(R.mean() / (sd / np.sqrt(len(R)) + 1e-12)), 2) if len(R) > 2 else 0.0,
                rm=round(float(R.sum()) * 21 / max(n_days, 1), 1))


def cfgs():
    return {
        # reference: our frozen OR30 fade, target 1.75R, entries to 13:00
        "ref_or30_rr1.75": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                      stop_buf=30.0, target_a="rr1.75", sess_end=13 * 60),
        # his first entry: fade the sweep, target NY VWAP, done by 10:30
        "A_on_ny_1030": S.base_cfg(range_src="on", legs="A", stop_src="range",
                                   stop_buf=20.0, target_a="ny", sess_end=CUT_1030),
        "A_or30_ny_1030": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                     stop_buf=30.0, target_a="ny", sess_end=CUT_1030),
        # his second entry: under NY VWAP, target untouched overnight VWAP
        "B_on_onvwap_1030": S.base_cfg(range_src="on", legs="B", stop_src="range",
                                       stop_buf=30.0, target_b="onvwap", sess_end=CUT_1030),
        "AB_on_1030": S.base_cfg(range_src="on", legs="AB", stop_src="range", stop_buf=20.0,
                                 target_a="ny", target_b="onvwap", sess_end=CUT_1030),
        "AB_or30_1030": S.base_cfg(range_src="or30", legs="AB", stop_src="sigext", stop_buf=30.0,
                                   target_a="ny", target_b="onvwap", sess_end=CUT_1030),
        # cutoff effect on the reference
        "ref_or30_rr1.75_1030": S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                                           stop_buf=30.0, target_a="rr1.75", sess_end=CUT_1030),
    }


def main():
    d26 = S.build_days(S.load())
    d23 = S.build_days(load_csv("/tmp/opencode/nqhold/USATECH_M1.csv"))
    print(f"2026 sessions={len(d26)}  2023 sessions={len(d23)}")

    rows = {}
    print(f"\n{'config':24s} | {'2026 n':>6s} {'avgR':>7s} {'t':>6s} {'PF':>5s} "
          f"| {'2023 n':>6s} {'avgR':>7s} {'t':>6s} {'PF':>5s} | both>0")
    for name, cfg in cfgs().items():
        t26 = S.collect(d26, cfg, 1.1)
        t23 = S.collect(d23, cfg, 1.1)
        a, b = stat(t26, len(d26)), stat(t23, len(d23))
        both = a["avgR"] > 0 and b["avgR"] > 0 and a["n"] >= 25 and b["n"] >= 25
        rows[name] = dict(y2026=a, y2023=b, both_positive=bool(both))
        print(f"{name:24s} | {a['n']:6d} {a['avgR']:+7.3f} {a['t']:+6.2f} {a['PF']:5.2f} "
              f"| {b['n']:6d} {b['avgR']:+7.3f} {b['t']:+6.2f} {b['PF']:5.2f} "
              f"| {'YES' if both else ''}")

    with open(OUT, "w") as fh:
        json.dump(rows, fh, indent=1)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())

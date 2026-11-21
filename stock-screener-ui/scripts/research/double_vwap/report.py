#!/usr/bin/env python
"""Cumulative-R chart + final numbers for the double-VWAP report.

  .venv/bin/python scripts/research/double_vwap/report.py
"""
from __future__ import annotations

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import strategy as S

COST = 1.1
OUT = S.OUTDIR

A_CFG = S.base_cfg(range_src="on", legs="A", stop_src="sigext", stop_buf=30.0,
                   target_a="rr1.75", sess_end=13 * 60)
B_CFG = S.base_cfg(range_src="on", legs="B", stop_src="range", stop_buf=30.0,
                   target_b="onvwap", sess_end=13 * 60)
BEST_CFG = S.base_cfg(range_src="or30", legs="A", stop_src="sigext", stop_buf=30.0,
                      target_a="rr1.75", sess_end=13 * 60)


def curve(trades):
    df = pd.DataFrame(trades).sort_values(["date", "entry_t"])
    df["cum"] = df["R"].cumsum()
    return df


def main():
    df = S.load()
    days = S.build_days(df)
    n = len(days)
    a, b = S.collect(days, A_CFG, COST), S.collect(days, B_CFG, COST)
    ab = sorted(a + b, key=lambda t: (t["date"], t["entry_t"]))

    fig, ax = plt.subplots(figsize=(11, 4.5), dpi=150)
    for tr, nm, col in ((a, "A · fade the overnight-range break", "#2563EB"),
                        (b, "B · NY-VWAP cross → untouched overnight VWAP", "#DC2626"),
                        (ab, "A+B (the chart's double entry)", "#111827")):
        c = curve(tr)
        ax.plot(pd.to_datetime(c["date"]), c["cum"], label=f"{nm}  ({len(tr)} trades, "
                f"{c['cum'].iloc[-1]:+.0f}R)", color=col, lw=1.6)
    ax.axhline(0, color="#9CA3AF", lw=0.8, ls=":")
    ax.set_ylabel("cumulative R (cost 1.1 pt)")
    ax.set_title("Double-VWAP study — NQ proxy, 143 sessions (Mar–Sep 2026)")
    ax.legend(loc="upper left", fontsize=8, frameon=False)
    ax.grid(alpha=0.25)
    fig.tight_layout()
    p = os.path.join(OUT, "equity.png")
    fig.savefig(p)
    print("wrote", p)

    best = S.collect(days, BEST_CFG, COST)
    summary = dict(
        sessions=n, cost=COST,
        A=S.stats(a, n), B=S.stats(b, n), AB=S.stats(ab, n),
        best_OR30=S.stats(best, n),
        first_day=str(days[0].date), last_day=str(days[-1].date),
    )
    with open(os.path.join(OUT, "summary.json"), "w") as fh:
        json.dump(summary, fh, indent=1, default=str)
    print(json.dumps(summary, indent=1, default=str))


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S
from holdout_random_days import load_csv

OUT = os.path.join(S.OUTDIR, "orb_width_sweep.json")
CSV_2023 = "/tmp/opencode/nqhold/USATECH_M1.csv"
WIDTHS = (1, 2, 3, 5, 10, 15, 20, 30, 45, 60)
BUF = 30.0
EPS = 0.25
CUTOFF = 13 * 60
TARGETS = (1.5, 2.0)


def first_break_width(d, width, eps=EPS):
    end = S.RTH_OPEN + width
    m = (d.t >= S.RTH_OPEN) & (d.t < end)
    if m.sum() < max(1, width // 2):
        return None
    hi, lo = float(d.h[m].max()), float(d.l[m].min())
    start = int(np.flatnonzero(m)[-1]) + 1
    for i in range(start, len(d.c)):
        if d.t[i] >= 15 * 60 + 30:
            break
        if d.c[i] > hi + eps:
            return i, 1, hi, lo
        if d.c[i] < lo - eps:
            return i, -1, hi, lo
    return None


def signal(d, brk, mode, rr):
    i, dr, hi, lo = brk
    j = i + 1
    if j >= len(d.c) or d.t[j] >= CUTOFF:
        return None
    side = dr if mode == "breakout" else -dr
    entry = d.o[j]
    if side < 0:
        stop = d.h[i] + BUF
    else:
        stop = d.l[i] - BUF
    risk = (entry - stop) if side > 0 else (stop - entry)
    if risk <= 0:
        return None
    target = entry + side * rr * risk
    return dict(day=d, idx=j, side=side, entry=entry, stop=stop, target=target, kind=mode)


def run(days, mode, rr):
    trades = []
    for d in days:
        for w in WIDTHS:
            brk = first_break_width(d, w)
            if brk is None:
                continue
            sig = signal(d, brk, mode, rr)
            if sig is None:
                continue
            tr = S.simulate(sig, 1.1)
            if tr:
                tr["width"] = w
                trades.append(tr)
    return trades


def stat(trades, n_days):
    if not trades:
        return dict(n=0, avgR=0.0, t=0.0, PF=0.0, win=0.0)
    R = np.array([t["R"] for t in trades], float)
    pos, neg = R[R > 0].sum(), R[R <= 0].sum()
    sd = R.std(ddof=1)
    return dict(n=int(len(R)), avgR=round(float(R.mean()), 4),
                win=round(100 * float((R > 0).mean()), 1),
                PF=round(float(pos / -neg), 2) if neg < 0 else 99.0,
                t=round(float(R.mean() / (sd / np.sqrt(len(R)) + 1e-12)), 2) if len(R) > 2 else 0.0)


def main():
    d26 = S.build_days(S.load())
    d23 = S.build_days(load_csv(CSV_2023))
    print(f"2026 sessions={len(d26)}  2023 sessions={len(d23)}")

    out = {}
    print(f"\n{'w':>3s} {'mode':9s} {'rr':>4s} | {'2026 n':>6s} {'avgR':>7s} {'t':>6s} "
          f"| {'2023 n':>6s} {'avgR':>7s} {'t':>6s} | both>0")
    for mode in ("fade", "breakout"):
        for rr in TARGETS:
            all26 = run(d26, mode, rr)
            all23 = run(d23, mode, rr)
            for w in WIDTHS:
                t26 = [t for t in all26 if t["width"] == w]
                t23 = [t for t in all23 if t["width"] == w]
                a26, a23 = stat(t26, len(d26)), stat(t23, len(d23))
                both = a26["avgR"] > 0 and a23["avgR"] > 0 and a26["n"] >= 25 and a23["n"] >= 25
                out[f"{mode}|{rr}|{w}"] = dict(y2026=a26, y2023=a23, both_positive=bool(both))
                print(f"{w:3d} {mode:9s} {rr:4.1f} | {a26['n']:6d} {a26['avgR']:+7.3f} "
                      f"{a26['t']:+6.2f} | {a23['n']:6d} {a23['avgR']:+7.3f} {a23['t']:+6.2f} "
                      f"| {'YES' if both else ''}")

    survivors = [k for k, v in out.items() if v["both_positive"]]
    print(f"\nsurvivors (positive in BOTH regimes, n>=25 each): {len(survivors)}")
    for k in survivors:
        v = out[k]
        print(f"  {k:24s} 2026 {v['y2026']['avgR']:+.3f} (n={v['y2026']['n']}) "
              f"| 2023 {v['y2023']['avgR']:+.3f} (n={v['y2023']['n']})")

    with open(OUT, "w") as fh:
        json.dump(dict(widths=WIDTHS, buf=BUF, cutoff_min=CUTOFF,
                       results=out, survivors=survivors), fh, indent=1)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())

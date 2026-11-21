#!/usr/bin/env python
"""Austin Silver's actual read: sweep the PREMARKET extreme, wait for the break
to FAIL (close back inside), then fade it. Compare with our immediate fade.

His words (2026-11-19): "price swept premarket highs and failed to close ..."
His exit words (2026-11-19): "taking profits because of the location of NY VWAP,
the size of the opening range, or simply how extended the move has become."

Grid: range = premarket 30/60/120 min or opening 30 min; entry = immediate fade
(ours) vs failed-break fade (his); target = NY VWAP / overnight VWAP / 1.5R;
stop = sweep extreme + 10/20/30. Entries <= 10:30 ET, both years.

  .venv/bin/python scripts/research/double_vwap/failed_break.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S
from holdout_random_days import load_csv

OUT = os.path.join(S.OUTDIR, "failed_break.json")
CUT = 10 * 60 + 30
EPS = 0.25
RANGES = {"pre30": ("pre", 30), "pre60": ("pre", 60), "pre120": ("pre", 120),
          "or30": ("or", 30)}
BUF = 20.0
TARGETS = ("ny", "onvwap", "rr1.5")


def window_range(d, kind, mins):
    if kind == "pre":
        lo_t, hi_t = S.RTH_OPEN - mins, S.RTH_OPEN
    else:
        lo_t, hi_t = S.RTH_OPEN, S.RTH_OPEN + mins
    m = (d.t >= lo_t) & (d.t < hi_t)
    if m.sum() < max(2, mins // 5):
        return None
    return float(d.h[m].max()), float(d.l[m].min()), int(np.flatnonzero(m)[-1]) + 1


def find_break(d, start, hi, lo):
    for i in range(start, len(d.c)):
        if d.t[i] >= 15 * 60 + 30:
            break
        if d.c[i] > hi + EPS:
            return i, 1, hi, lo
        if d.c[i] < lo - EPS:
            return i, -1, hi, lo
    return None


def build_signal(d, brk, style, target_mode):
    i, dr, hi, lo = brk
    side = -dr
    if style == "failed":
        # wait for a close back inside the range, then enter the fade
        j = None
        for k in range(i + 1, len(d.c)):
            if d.t[k] >= CUT:
                return None
            if (dr > 0 and d.c[k] < hi - EPS) or (dr < 0 and d.c[k] > lo + EPS):
                j = k
                break
        if j is None:
            return None
        sweep = float(d.h[i:j + 1].max()) if dr > 0 else float(d.l[i:j + 1].min())
        entry_idx = j + 1
        if entry_idx >= len(d.c) or d.t[entry_idx] >= CUT:
            return None
        entry = d.o[entry_idx]
        stop = sweep + BUF if side < 0 else sweep - BUF
    else:
        entry_idx = i + 1
        if entry_idx >= len(d.c) or d.t[entry_idx] >= CUT:
            return None
        entry = d.o[entry_idx]
        stop = d.h[i] + BUF if side < 0 else d.l[i] - BUF
    risk = (entry - stop) if side > 0 else (stop - entry)
    if risk <= 0:
        return None
    if target_mode == "ny":
        target = d.ny_vwap[i]
    elif target_mode == "onvwap":
        target = d.on_vwap
    else:
        target = entry + side * 1.5 * risk
    if (side < 0 and target >= entry) or (side > 0 and target <= entry):
        return None
    return dict(day=d, idx=entry_idx, side=side, entry=entry, stop=stop,
                target=target, kind=style)


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


def run(days, rsrc, style, tgt):
    tr = []
    kind, mins = RANGES[rsrc]
    for d in days:
        w = window_range(d, kind, mins)
        if w is None:
            continue
        hi, lo, start = w
        brk = find_break(d, start, hi, lo)
        if brk is None:
            continue
        sig = build_signal(d, brk, style, tgt)
        if sig is None:
            continue
        t = S.simulate(sig, 1.1)
        if t:
            tr.append(t)
    return tr


def main():
    d26 = S.build_days(S.load())
    d23 = S.build_days(load_csv("/tmp/opencode/nqhold/USATECH_M1.csv"))
    print(f"2026 sessions={len(d26)}  2023 sessions={len(d23)}")

    rows = {}
    print(f"\n{'range':6s} {'entry':8s} {'target':8s} | {'26 n':>5s} {'avgR':>7s} {'t':>6s} "
          f"| {'23 n':>5s} {'avgR':>7s} {'t':>6s} | both")
    for rsrc in RANGES:
        for style in ("immediate", "failed"):
            for tgt in TARGETS:
                a = stat(run(d26, rsrc, style, tgt), len(d26))
                b = stat(run(d23, rsrc, style, tgt), len(d23))
                both = a["avgR"] > 0 and b["avgR"] > 0 and a["n"] >= 25 and b["n"] >= 25
                rows[f"{rsrc}|{style}|{tgt}"] = dict(y2026=a, y2023=b, both=bool(both))
                print(f"{rsrc:6s} {style:8s} {tgt:8s} | {a['n']:5d} {a['avgR']:+7.3f} "
                      f"{a['t']:+6.2f} | {b['n']:5d} {b['avgR']:+7.3f} {b['t']:+6.2f} "
                      f"| {'YES' if both else ''}")

    surv = [k for k, v in rows.items() if v["both"]]
    print(f"\nboth-positive cells: {len(surv)}/{len(rows)}")
    for k in sorted(surv, key=lambda x: -min(rows[x]['y2026']['avgR'], rows[x]['y2023']['avgR'])):
        v = rows[k]
        print(f"  {k:28s} 2026 {v['y2026']['avgR']:+.3f} (n={v['y2026']['n']}) "
              f"| 2023 {v['y2023']['avgR']:+.3f} (n={v['y2023']['n']})")
    with open(OUT, "w") as fh:
        json.dump(rows, fh, indent=1)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())

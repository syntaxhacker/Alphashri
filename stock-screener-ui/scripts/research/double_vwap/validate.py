#!/usr/bin/env python
"""Validate the surviving shape: OR-break fade, wide stop, 1.5-2R / mid target.

Three questions the grid cannot answer on its own:
  1. is the OR30 window special, or does fading ANY 30-min range work?
  2. does walk-forward selection by t-stat (not by luckiest mean) hold up?
  3. does the result survive cost, side split and quarter-by-quarter?

  .venv/bin/python scripts/research/double_vwap/validate.py
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

import strategy as S

COST = 1.1
OUT = os.path.join(S.OUTDIR, "validate.json")


def family():
    out = []
    for rs in ("on", "or15", "or30", "or60"):
        for buf in (20.0, 30.0, 40.0):
            for tg in ("mid", "rr1.5", "rr1.75", "rr2.0"):
                for dirf in ("none", "away_on"):
                    out.append(S.base_cfg(range_src=rs, legs="A", stop_src="sigext",
                                          stop_buf=buf, target_a=tg, target_b="onvwap",
                                          dir_filter=dirf, sess_end=13 * 60))
    return out


def stat(trades, days):
    return S.stats(trades, days if isinstance(days, int) else len(days))


def random_range_placebo(days, cfg, draws=200, seed=3):
    """Fade a random 30-min window instead of the real opening range."""
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(draws):
        R = []
        for d in days:
            if len(d.c) < 120:
                continue
            start = int(rng.integers(S.RTH_OPEN + 15, 13 * 60))
            end = start + 30
            m = (d.t >= start) & (d.t < end)
            if m.sum() < 5:
                continue
            hi, lo = float(d.h[m].max()), float(d.l[m].min())
            start_idx = int(np.flatnonzero(m)[-1]) + 1
            brk = None
            for i in range(start_idx, len(d.c)):
                if d.t[i] >= 15 * 60 + 30:
                    break
                if d.c[i] > hi + cfg["eps"]:
                    brk = (i, 1, hi, lo)
                    break
                if d.c[i] < lo - cfg["eps"]:
                    brk = (i, -1, hi, lo)
                    break
            if brk is None:
                continue
            sig = S.leg_a_signal(d, brk, cfg)
            if sig is None:
                continue
            tr = S.simulate(sig, COST)
            if tr:
                R.append(tr["R"])
        if R:
            out.append(float(np.mean(R)))
    return np.array(out)


def main():
    df = S.load()
    days = S.build_days(df)
    n_days = len(days)
    dates = sorted({d.date for d in days})
    cut = dates[int(n_days * 0.6)]
    fold_of = {d.date: min(5, i * 6 // n_days) for i, d in enumerate(days)}

    cfgs = family()
    rows = []
    for cfg in cfgs:
        tr = S.collect(days, cfg, COST)
        if len(tr) < 20:
            continue
        rows.append((cfg, tr, stat(tr, n_days)))
    rows.sort(key=lambda x: x[2]["t"], reverse=True)

    print(f"sessions={n_days}  family={len(rows)} configs (n>=20)\n")
    print("family top 12 by t")
    for cfg, tr, st in rows[:12]:
        print(f"  {cfg['range_src']:5s} buf={cfg['stop_buf']:>4.0f} tgt={cfg['target_a']:8s} "
              f"dir={cfg['dir_filter']:7s} | n={st['n']:3d} avgR={st['avgR']:+.3f} "
              f"t={st['t']:+.2f} PF={st['PF']:.2f} win={st['win']:4.1f} "
              f"Rm={st['Rm']:+.1f}")

    # family aggregate (overlapping trades -> sign test only, not a t-stat)
    allR = []
    for cfg, tr, st in rows:
        allR += [t["R"] for t in tr]
    print(f"\nfamily pooled (overlapping, sign only): n={len(allR)} "
          f"avgR={np.mean(allR):+.3f} win={100 * np.mean(np.array(allR) > 0):.1f}%")

    best_cfg, best_tr, best_st = rows[0]
    print(f"\nfinalist: {best_cfg}")
    print("  by quarter:")
    tdf = pd.DataFrame(best_tr)
    tdf["q"] = pd.to_datetime(tdf["date"]).dt.to_period("Q")
    print(tdf.groupby("q")["R"].agg(["count", "mean", "sum"]).round(3).to_string())
    print("  sides:", {int(k): round(float(v), 3) for k, v in
                       tdf.groupby("side")["R"].mean().items()},
          " counts:", tdf["side"].value_counts().to_dict())
    print("  exits:", tdf["exit"].value_counts().to_dict())
    print("  buckets:")
    bins = [-99, -1.01, -0.5, 0.0, 0.5, 1.0, 1.74, 99]
    print(pd.cut(tdf["R"], bins).value_counts().sort_index().to_string())
    print("  cost sweep:")
    for c in (0.0, 1.1, 2.0, 3.0, 4.0):
        tr = S.collect(days, best_cfg, c)
        st = stat(tr, n_days)
        print(f"    {c:>4.1f}pt n={st['n']:3d} avgR={st['avgR']:+.3f} t={st['t']:+.2f} "
              f"PF={st['PF']:.2f}")

    # walk-forward by t-stat (min 25 trades in train)
    print("\nwalk-forward, selection by train t (n>=25)")
    wf = []
    for k in range(1, 6):
        cand = []
        for cfg, tr, st in rows:
            trn = [t["R"] for t in tr if fold_of[t["date"]] < k]
            if len(trn) < 25:
                continue
            R = np.array(trn)
            t = R.mean() / (R.std(ddof=1) / np.sqrt(len(R)))
            cand.append((t, cfg, tr))
        if not cand:
            continue
        cand.sort(key=lambda x: x[0], reverse=True)
        tbest, cfg, tr = cand[0]
        tst = [x["R"] for x in tr if fold_of[x["date"]] == k]
        if not tst:
            print(f"  fold {k}: train t={tbest:+.2f} -> no test trades")
            continue
        wf.append(float(np.mean(tst)))
        print(f"  fold {k}: train t={tbest:+.2f} {cfg['range_src']}/{cfg['stop_buf']:.0f}/"
              f"{cfg['target_a']} -> test n={len(tst):3d} avgR={np.mean(tst):+.3f}")
    if wf:
        print(f"  WF mean {np.mean(wf):+.3f}  positive {sum(1 for x in wf if x > 0)}/{len(wf)}")

    # random-range placebo
    print("\nrandom-range placebo (fade a random 30-min window, same geometry)")
    pl = random_range_placebo(days, best_cfg, draws=200)
    print(f"  real avgR {best_st['avgR']:+.3f} | placebo mean {pl.mean():+.3f} "
          f"sd {pl.std():.3f} p5 {np.percentile(pl, 5):+.3f} p95 {np.percentile(pl, 95):+.3f} "
          f"| p(placebo>=real)={np.mean(pl >= best_st['avgR']):.02f}")

    # how does the real config rank inside its own placebo distribution?
    print(f"  real percentile inside placebo: {100 * np.mean(pl < best_st['avgR']):.0f}%")

    with open(OUT, "w") as fh:
        json.dump(dict(finalist=best_cfg, stats=best_st,
                       wf=wf, placebo=dict(mean=float(pl.mean()), sd=float(pl.std()),
                                           p_ge_real=float(np.mean(pl >= best_st["avgR"])))),
                  fh, indent=1, default=str)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())

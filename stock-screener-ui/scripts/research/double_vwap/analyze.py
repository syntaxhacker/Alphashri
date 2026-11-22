#!/usr/bin/env python
from __future__ import annotations

import itertools
import json
import os

import numpy as np
import pandas as pd

import strategy as S

OUTDIR = S.OUTDIR
COST = 1.1


def grid2():
    cfgs = []
    for rs in ("on", "or15", "or30", "or60"):
        for dirf in ("none", "away_on"):
            for aside in ("none", "stretched"):
                for sess in (None, 11 * 60 + 30, 13 * 60):
                    for stop_src in ("range", "sigext", "atr"):
                        bufs = (5.0, 10.0, 20.0, 30.0) if stop_src == "range" else \
                               (5.0, 10.0, 20.0, 30.0, 40.0, 50.0) if stop_src == "sigext" else (10.0,)
                        for buf in bufs:
                            for tg in ("mid", "opp", "onvwap", "onvwap_rr",
                                       "rr1.0", "rr1.25", "rr1.5", "rr1.75", "rr2.0", "rr3.0"):
                                for leg in ("A", "AB"):
                                    for unt in ((False, True) if tg.startswith("onvwap") else (False,)):
                                        cfgs.append(S.base_cfg(
                                            range_src=rs, legs=leg, stop_src=stop_src,
                                            stop_buf=buf, target_a=tg, target_b="onvwap",
                                            dir_filter=dirf, require_untouched=unt,
                                            a_side_filter=aside, sess_end=sess))
                    for stop_src in ("range", "swing", "atr"):
                        for buf in (5.0, 10.0, 20.0, 30.0):
                            if stop_src == "atr" and buf != 10.0:
                                continue
                            for tg in ("onvwap", "onvwap_rr", "rr1.5", "rr2.0", "rr3.0"):
                                for allow in ((False, True) if tg == "onvwap" else (False,)):
                                    for leg in ("B", "AB"):
                                        cfgs.append(S.base_cfg(
                                            range_src=rs, legs=leg, stop_src=stop_src,
                                            stop_buf=buf, target_a="mid", target_b=tg,
                                            allow_touched=allow, dir_filter=dirf,
                                            sess_end=sess))
    seen, uniq = set(), []
    for c in cfgs:
        k = json.dumps(c, sort_keys=True, default=str)
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    return uniq


def agg(R):
    R = np.asarray(R, float)
    if len(R) == 0:
        return dict(n=0, sum=0.0, ss=0.0, win=0, pos=0.0, neg=0.0, mx=0.0, mn=0.0)
    return dict(n=int(len(R)), sum=float(R.sum()), ss=float((R ** 2).sum()),
                win=int((R > 0).sum()), pos=float(R[R > 0].sum()),
                neg=float(R[R <= 0].sum()), mx=float(R.max()), mn=float(R.min()))


def merge_agg(items):
    out = dict(n=0, sum=0.0, ss=0.0, win=0, pos=0.0, neg=0.0, mx=-1e9, mn=1e9)
    for a in items:
        if not a:
            continue
        for k in ("n", "sum", "ss", "win", "pos", "neg"):
            out[k] += a[k]
        out["mx"] = max(out["mx"], a["mx"])
        out["mn"] = min(out["mn"], a["mn"])
    if out["n"] == 0:
        out["mx"] = out["mn"] = 0.0
    return out


def describe(a):
    n = a["n"]
    if n == 0:
        return dict(n=0, avgR=0.0, t=0.0, PF=0.0, win=0.0)
    mean = a["sum"] / n
    var = max(a["ss"] / n - mean ** 2, 0.0) * n / max(n - 1, 1)
    sd = float(np.sqrt(var))
    t = mean / (sd / np.sqrt(n)) if sd > 0 and n > 2 else 0.0
    pf = a["pos"] / -a["neg"] if a["neg"] < 0 else 99.0
    return dict(n=n, avgR=round(mean, 4), t=round(float(t), 2),
                PF=round(float(pf), 2), win=round(100.0 * a["win"] / n, 1),
                maxR=round(a["mx"], 2))


def main():
    df = S.load()
    days = S.build_days(df)
    n_days = len(days)
    cfgs = grid2()
    print(f"sessions={n_days}  configs={len(cfgs)}")

    fold_of = {d.date: min(5, i * 6 // n_days) for i, d in enumerate(days)}
    dates = sorted(fold_of)
    cut = dates[int(n_days * 0.6)]

    rows = []
    for ci, cfg in enumerate(cfgs):
        trades = S.collect(days, cfg, COST)
        if not trades:
            continue
        folds = {}
        for t in trades:
            folds.setdefault(fold_of[t["date"]], []).append(t["R"])
        R = [t["R"] for t in trades]
        isR = [t["R"] for t in trades if t["date"] < cut]
        oosR = [t["R"] for t in trades if t["date"] >= cut]
        a = agg(R)
        d = describe(a)
        d.update(cfg=cfg, IS=describe(agg(isR)), OOS=describe(agg(oosR)),
                 fold_agg={str(k): agg(v) for k, v in sorted(folds.items())},
                 folds={str(k): describe(agg(v)) for k, v in sorted(folds.items())},
                 nA=sum(1 for t in trades if t["kind"] == "A"),
                 nB=sum(1 for t in trades if t["kind"] == "B"))
        rows.append(d)
        if (ci + 1) % 1000 == 0:
            print(f"  {ci + 1}/{len(cfgs)}")

    rows = [r for r in rows if r["n"] >= 30]
    rows.sort(key=lambda r: r["t"], reverse=True)
    print(f"\n{len(rows)} configs with n>=30")

    def label(r):
        c = r["cfg"]
        return (f"{c['range_src']:5s} {c['legs']:2s} {c['stop_src']:6s}/{c['stop_buf']:>4.0f} "
                f"A={c['target_a']:9s} B={c['target_b']:9s} dir={c['dir_filter']:7s} "
                f"side={c['a_side_filter']:9s} sess={str(c['sess_end']):>4s} "
                f"unt={int(c['require_untouched'])} tch={int(c['allow_touched'])}")

    print("\ntop 20 by pooled t (n>=30)")
    for r in rows[:20]:
        print(f"  {label(r)} | n={r['n']:4d} avgR={r['avgR']:+.3f} t={r['t']:+.2f} "
              f"PF={r['PF']:.2f} win={r['win']:4.1f} maxR={r['maxR']:6.2f} "
              f"IS={r['IS']['avgR']:+.3f} OOS={r['OOS']['avgR']:+.3f}")

    both = [r for r in rows if r["IS"]["n"] >= 10 and r["OOS"]["n"] >= 10
            and r["IS"]["avgR"] > 0 and r["OOS"]["avgR"] > 0]
    both.sort(key=lambda r: min(r["IS"]["avgR"], r["OOS"]["avgR"]), reverse=True)
    print(f"\n{len(both)} configs positive in BOTH halves (>=10 trades each)")
    for r in both[:15]:
        print(f"  {label(r)} | n={r['n']:4d} avgR={r['avgR']:+.3f} t={r['t']:+.2f} "
              f"IS={r['IS']['avgR']:+.3f} OOS={r['OOS']['avgR']:+.3f} maxR={r['maxR']:.1f}")

    print("\nplateau around the top config (one knob at a time)")
    top = rows[0]["cfg"]
    base_rs = top["range_src"]
    variations = []
    for b in (10.0, 20.0, 30.0, 40.0, 50.0):
        variations.append(("buf", b, {**top, "stop_buf": b}))
    for tg in ("mid", "opp", "rr1.0", "rr1.25", "rr1.5", "rr1.75", "rr2.0", "rr3.0"):
        variations.append(("target_a", tg, {**top, "target_a": tg}))
    for rs in ("on", "or15", "or30", "or60"):
        variations.append(("range_src", rs, {**top, "range_src": rs}))
    for ss in (None, 11 * 60 + 30, 13 * 60):
        variations.append(("sess_end", ss, {**top, "sess_end": ss}))
    for knob, val, cfg in variations:
        tr = S.collect(days, cfg, COST)
        st = describe(agg([t["R"] for t in tr]))
        print(f"  {knob:10s}={str(val):>5s}  n={st['n']:4d} avgR={st['avgR']:+.3f} "
              f"t={st['t']:+.2f} PF={st['PF']:.2f} win={st['win']:4.1f}")

    print("\nwalk-forward (select best on prior folds, score next fold)")
    wf = []
    for k in range(1, 6):
        cand = []
        for r in rows:
            tr = [r["fold_agg"].get(str(f)) for f in range(k)]
            merged = merge_agg(tr)
            if merged["n"] >= 20:
                cand.append((merged["sum"] / merged["n"], r))
        if not cand:
            continue
        cand.sort(key=lambda x: x[0], reverse=True)
        best_mean, best = cand[0]
        fo = best["folds"].get(str(k))
        if not fo or fo["n"] == 0:
            print(f"  fold {k}: best={label(best)[:70]} train={best_mean:+.3f} "
                  f"-> no trades")
            continue
        wf.append(fo["avgR"])
        print(f"  fold {k}: train={best_mean:+.3f} -> test n={fo['n']:3d} "
              f"avgR={fo['avgR']:+.3f}")
    if wf:
        print(f"  WF pooled mean {np.mean(wf):+.3f}  positive folds "
              f"{sum(1 for x in wf if x > 0)}/{len(wf)}")

    print("\noutlier sensitivity (drop best and worst trade)")
    for r in rows[:8]:
        cfg = r["cfg"]
        trades = S.collect(days, cfg, COST)
        R = np.array([t["R"] for t in trades])
        print(f"  {label(r)}")
        print(f"     full {R.mean():+.3f} | ex-best {np.delete(R, R.argmax()).mean():+.3f} "
              f"| ex-3best {np.sort(R)[:-3].mean():+.3f} "
              f"| top3 share {np.sort(R)[-3:].sum() / max(R.sum(), 1e-9):.0%}")

    print("\nplacebo (same side + same stop/target distance, random entry 09:30-11:30)")
    rng = np.random.default_rng(11)
    for r in rows[:5]:
        cfg = r["cfg"]
        real = S.collect(days, cfg, COST)
        byday = {d.date: d for d in days}
        pl = []
        for _ in range(200):
            fake = []
            for t in real:
                d = byday[t["date"]]
                lo, hi = d.rth_start, d.rth_start + 120
                if hi <= lo:
                    continue
                k = int(rng.integers(lo, hi))
                entry = d.o[k]
                risk = t["risk"]
                reward = abs(t["pts"] + COST) / risk * risk if risk else 0.0
                side = t["side"]
                stop = entry - side * risk
                target = entry + side * reward
                sig = dict(day=d, idx=k, side=side, entry=entry, stop=stop,
                           target=target, kind="P")
                tr = S.simulate(sig, COST)
                if tr:
                    fake.append(tr["R"])
            if fake:
                pl.append(np.mean(fake))
        print(f"  {label(r)}")
        print(f"     real {r['avgR']:+.3f}  | placebo mean {np.mean(pl):+.3f} "
              f"sd {np.std(pl):.3f}  p(placebo>=real)="
              f"{np.mean(np.array(pl) >= r['avgR']):.2f}")

    with open(os.path.join(OUTDIR, "analysis.json"), "w") as fh:
        json.dump(rows, fh, indent=1, default=str)
    print(f"\nwrote {os.path.join(OUTDIR, 'analysis.json')}")


if __name__ == "__main__":
    raise SystemExit(main())

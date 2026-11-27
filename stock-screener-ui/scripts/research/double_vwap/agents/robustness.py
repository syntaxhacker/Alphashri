#!/usr/bin/env python
"""Adversarial robustness audit for the Double-VWAP finalist.

Pre-registered checks (no tuning, no new filters): moving-block bootstrap,
drop-top-k, six folds, entry timing, cost regime, parameter neighbourhood,
date-ordered subsamples. Uses the honest engine unchanged.

Run from the repo root: .venv/bin/python scripts/research/double_vwap/agents/robustness.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "research", "double_vwap"))
import strategy as S  # noqa: E402

OUTDIR = os.path.join(ROOT, "reports", "DOUBLE_VWAP", "agents")
COST = 1.1
SEED = 42
FINAL = dict(range_src="or30", legs="A", stop_src="sigext", stop_buf=30.0,
             target_a="rr1.75", sess_end=13 * 60)
EXPECTED = dict(n=133, avgR=0.3598, t=3.02, PF=1.71, win=51.1)


def cfg(**kw):
    return S.base_cfg(**{**FINAL, **kw})


def tstat(R):
    R = np.asarray(R, float)
    if len(R) < 3:
        return 0.0
    return float(R.mean() / (R.std(ddof=1) / np.sqrt(len(R)) + 1e-12))


def mstats(R):
    R = np.asarray(R, float)
    if len(R) == 0:
        return dict(n=0, avgR=None, t=None, win=None, PF=None, sumR=0.0)
    wins, losses = R[R > 0], R[R <= 0]
    pf = float(wins.sum() / -losses.sum()) if losses.sum() < 0 else 99.0
    return dict(n=int(len(R)), avgR=round(float(R.mean()), 4),
                t=round(tstat(R), 2), win=round(100 * float((R > 0).mean()), 1),
                PF=round(pf, 2), sumR=round(float(R.sum()), 4))


def collect_pairs(days, c, cost):
    pairs = []
    for d in days:
        brk = S.first_break(d, c["range_src"], c["eps"])
        if brk is None:
            continue
        sigs = []
        if "A" in c["legs"]:
            s = S.leg_a_signal(d, brk, c)
            if s:
                sigs.append(s)
        if "B" in c["legs"]:
            s = S.leg_b_signal(d, brk, c)
            if s:
                sigs.append(s)
        for s in sigs:
            tr = S.simulate(s, cost)
            if tr:
                pairs.append((s, tr))
    return pairs


def shifted_levels(sig, new_entry):
    side = sig["side"]
    stop_dist = abs(sig["stop"] - sig["entry"])
    tgt_dist = abs(sig["target"] - sig["entry"])
    return new_entry - side * stop_dist, new_entry + side * tgt_dist


def sim_at(sig, cost, entry_idx, entry_px, stop, target):
    d = sig["day"]
    side = sig["side"]
    if entry_idx < 0 or entry_idx >= len(d.c):
        return None
    entry = float(entry_px)
    if (side > 0 and entry <= stop) or (side < 0 and entry >= stop):
        return None
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    exit_px, exit_kind, bars = None, None, 0
    for j in range(entry_idx, len(d.c)):
        bars = j - entry_idx
        if side > 0 and d.o[j] <= stop:
            exit_px, exit_kind = d.o[j], "stop_gap"
            break
        if side < 0 and d.o[j] >= stop:
            exit_px, exit_kind = d.o[j], "stop_gap"
            break
        if j > entry_idx:
            if side > 0:
                if d.l[j] <= stop:
                    exit_px, exit_kind = stop, "stop"
                    break
                if d.h[j] >= target:
                    exit_px, exit_kind = max(d.o[j], target), "target"
                    break
            else:
                if d.h[j] >= stop:
                    exit_px, exit_kind = stop, "stop"
                    break
                if d.l[j] <= target:
                    exit_px, exit_kind = min(d.o[j], target), "target"
                    break
        else:
            if side > 0 and d.l[j] <= stop:
                exit_px, exit_kind = stop, "stop"
                break
            if side < 0 and d.h[j] >= stop:
                exit_px, exit_kind = stop, "stop"
                break
        if d.t[j] >= S.EOD:
            exit_px, exit_kind = d.c[j], "time"
            break
    if exit_px is None:
        exit_px, exit_kind = d.c[-1], "time"
    net = (exit_px - entry) * side - cost
    return dict(R=float(net / risk), pts=float(net), exit=exit_kind, bars=bars)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    out = {"meta": {}}

    df = S.load()
    days = S.build_days(df)
    dates = sorted({d.date for d in days})
    pairs = collect_pairs(days, cfg(), COST)
    trades = [tr for _, tr in pairs]
    Rs = np.array([t["R"] for t in trades], float)
    base = S.stats(trades, len(days))
    reproduces = all(base[k] == v for k, v in EXPECTED.items())
    out["meta"] = dict(cost_pt=COST, seed=SEED, sessions=len(days),
                       session_first=str(dates[0]), session_last=str(dates[-1]),
                       final_cfg=FINAL, final_stats=base,
                       reproduces_expected=reproduces, expected=EXPECTED)
    print(f"sessions={len(days)}  finalist n={base['n']} avgR={base['avgR']:+.4f} "
          f"t={base['t']:.2f} PF={base['PF']:.2f} win={base['win']:.1f}%  "
          f"reproduces_expected={reproduces}")

    by_date = defaultdict(list)
    for tr in trades:
        by_date[tr["date"]].append(tr["R"])
    blocks = [np.asarray(by_date.get(dt, []), float) for dt in dates]
    rng = np.random.default_rng(SEED)
    block, n_sess = 5, len(dates)
    n_blocks = int(np.ceil(n_sess / block))
    avg_draws, cum_draws = [], []
    for _ in range(2000):
        starts = rng.integers(0, n_sess - block + 1, size=n_blocks)
        res = []
        for st in starts:
            for k in range(block):
                res.extend(blocks[int(st) + k].tolist())
        res = np.asarray(res, float)
        avg_draws.append(float(res.mean()) if len(res) else 0.0)
        cum_draws.append(float(res.sum()))
    avg_draws = np.asarray(avg_draws)
    cum_draws = np.asarray(cum_draws)
    out["bootstrap"] = dict(
        block_sessions=block, draws=2000, seed=SEED,
        original_cumR=round(float(Rs.sum()), 3),
        avgR_ci90=[round(float(x), 4) for x in np.percentile(avg_draws, [5, 95])],
        avgR_median=round(float(np.median(avg_draws)), 4),
        avgR_share_le0=round(float((avg_draws <= 0).mean()), 4),
        cumR_ci90=[round(float(x), 3) for x in np.percentile(cum_draws, [5, 95])],
        cumR_median=round(float(np.median(cum_draws)), 3),
        cumR_share_le0=round(float((cum_draws <= 0).mean()), 4))
    b = out["bootstrap"]
    print(f"[1] bootstrap5  avgR 90%CI [{b['avgR_ci90'][0]:+.3f}, {b['avgR_ci90'][1]:+.3f}] "
          f"median {b['avgR_median']:+.3f}  P(avgR<=0)={b['avgR_share_le0']:.1%} | "
          f"cumR 90%CI [{b['cumR_ci90'][0]:+.1f}, {b['cumR_ci90'][1]:+.1f}] "
          f"P(cumR<=0)={b['cumR_share_le0']:.1%}")

    order = np.argsort(-Rs)
    dropk = {f"k{k}": mstats(np.delete(Rs, order[:k])) for k in (1, 3, 5, 10)}
    months = defaultdict(list)
    for tr in trades:
        months[(tr["date"].year, tr["date"].month)].append(tr["R"])
    mstats_map = {m: mstats(v) for m, v in months.items()}
    best_m = max(mstats_map, key=lambda m: mstats_map[m]["avgR"])
    worst_m = min(mstats_map, key=lambda m: mstats_map[m]["avgR"])
    month_drop = {}
    for label, m in (("drop_best_month", best_m), ("drop_worst_month", worst_m)):
        kept = np.concatenate([np.asarray(v, float) for k, v in months.items() if k != m])
        month_drop[label] = dict(month=f"{m[0]}-{m[1]:02d}",
                                 removed=mstats_map[m], kept=mstats(kept))
    out["drop_topk"] = dict(
        drop_top_k=dropk,
        months={f"{m[0]}-{m[1]:02d}": v for m, v in mstats_map.items()},
        month_drop=month_drop)
    print("[2] drop-top-k " + "  ".join(
        f"{k}:{v['avgR']:+.3f}(n={v['n']})" for k, v in dropk.items()))
    print("     " + " | ".join(
        f"{label} {v['month']} (n={v['removed']['n']}, {v['removed']['avgR']:+.3f}) "
        f"-> {v['kept']['avgR']:+.3f} (n={v['kept']['n']})"
        for label, v in month_drop.items()))

    fold_dates = [list(x) for x in np.array_split(np.array(dates, dtype=object), 6)]
    folds = []
    for n, fd in enumerate(fold_dates, 1):
        fset = set(fd)
        ftr = [tr for tr in trades if tr["date"] in fset]
        st = mstats([t["R"] for t in ftr])
        st.update(fold=n, sessions=len(fd), first=str(fd[0]), last=str(fd[-1]))
        folds.append(st)
    n_pos = sum(1 for f in folds if (f["avgR"] or 0) > 0)
    out["folds"] = dict(n_positive=n_pos, n_folds=6, folds=folds)
    print(f"[3] folds positive {n_pos}/6  " + " ".join(
        f"F{f['fold']}:{f['avgR']:+.3f}(n={f['n']},t={f['t']})" if f["avgR"] is not None
        else f"F{f['fold']}:empty" for f in folds))

    timing = {}
    mismatches = 0
    variants = {}
    for s, tr in pairs:
        d = s["day"]
        side = s["side"]
        j = s["idx"]
        i = j - 1
        base_sim = sim_at(s, COST, j, d.o[j], s["stop"], s["target"])
        if base_sim is None or abs(base_sim["R"] - tr["R"]) > 1e-9:
            mismatches += 1
        for name in ("a_base", "b_sigclose_rescaled", "c_late_rescaled",
                     "b_sigclose_fixedlevel", "c_late_fixedlevel"):
            sim = None
            if name == "a_base":
                sim = base_sim
            elif name in ("b_sigclose_rescaled", "b_sigclose_fixedlevel"):
                if i >= 0:
                    px = d.c[i] + side * 0.5
                    stop, target = (shifted_levels(s, px) if "rescaled" in name
                                    else (s["stop"], s["target"]))
                    sim = sim_at(s, COST, i, px, stop, target)
            else:
                k = j + 1
                if k < len(d.c):
                    px = d.o[k]
                    stop, target = (shifted_levels(s, px) if "rescaled" in name
                                    else (s["stop"], s["target"]))
                    sim = sim_at(s, COST, k, px, stop, target)
            if sim is not None:
                variants.setdefault(name, []).append(sim["R"])
    timing = {name: mstats(v) for name, v in variants.items()}
    timing["baseline_custom_sim_mismatches"] = mismatches
    out["entry_timing"] = timing
    print("[4] entry timing (same R geometry, rescaled levels)  " + " | ".join(
        f"{k}:{v['avgR']:+.3f}(n={v['n']},t={v['t']})"
        for k, v in timing.items() if k.startswith(("a_", "b_", "c_"))))
    print("     fixed-level control  " + " | ".join(
        f"{k}:{v['avgR']:+.3f}(n={v['n']})" for k, v in timing.items()
        if k.endswith("fixedlevel")) + f"  baseline mismatches={mismatches}")

    cost_res = {}
    for c in (1.1, 2.5, 4.0):
        rr = [S.simulate(s, c)["R"] for s, _ in pairs]
        cost_res[f"fixed_{c:g}"] = mstats(rr)
    idx = df.index
    keys = pd.MultiIndex.from_arrays([idx.date, idx.hour * 60 + idx.minute])
    spread_s = pd.Series(df["spread_pts"].to_numpy(), index=keys)
    day_med = df.groupby(idx.date)["spread_pts"].median().to_dict()
    entry_sp = np.array([spread_s.get((t["date"], t["entry_t"]), np.nan) for t in trades])
    matched = int(np.isfinite(entry_sp).sum())
    if matched == len(trades):
        med_sp = float(np.median(entry_sp))
        rr = [S.simulate(s, med_sp)["R"] for s, _ in pairs]
        cost_res["median_entry_spread_all"] = dict(median_spread=round(med_sp, 4),
                                                   **mstats(rr))
        rr = [S.simulate(s, float(sp))["R"] for (s, _), sp in zip(pairs, entry_sp)]
        cost_res["per_trade_entry_spread"] = mstats(rr)
        rr = [S.simulate(s, float(day_med.get(t["date"], med_sp)))["R"]
              for (s, t) in pairs]
        day_medians = np.array([day_med.get(t["date"], np.nan) for t in trades])
        cost_res["per_trade_day_median_spread"] = dict(
            median_day_median=round(float(np.nanmedian(day_medians)), 4),
            **mstats(rr))
    out["cost"] = dict(matched_entry_spreads=matched, n_trades=len(trades),
                       median_spread_all_bars=round(float(df["spread_pts"].median()), 4),
                       regimes=cost_res)
    print("[5] cost regimes  " + " | ".join(
        f"{k}:{v['avgR']:+.3f}(t={v['t']},PF={v['PF']})" for k, v in cost_res.items())
          + f"  entry-spread matched {matched}/{len(trades)}")

    ranges = ["on", "or15", "or30", "or60"]
    bufs = [10.0, 20.0, 30.0, 40.0, 50.0]
    targets = [f"rr{v:g}" for v in np.arange(1.0, 3.0001, 0.25)]
    cells = {}
    for rs in ranges:
        for buf in bufs:
            for tg in targets:
                c = cfg(range_src=rs, stop_buf=buf, target_a=tg)
                rr = [t["R"] for t in S.collect(days, c, COST)]
                cells[f"{rs}|{buf:g}|{tg}"] = mstats(rr)
    ri, bi, ti = ranges.index("or30"), bufs.index(30.0), targets.index("rr1.75")
    nb_keys = [f"{ranges[ri+dr]}|{bufs[bi+db]:g}|{targets[ti+dt]}"
               for dr in (-1, 0, 1) for db in (-1, 0, 1) for dt in (-1, 0, 1)]
    nb_vals = np.array([cells[k]["avgR"] for k in nb_keys], float)
    fkey = "or30|30|rr1.75"
    ranked = sorted(((v["avgR"], k) for k, v in cells.items()), reverse=True)
    out["neighbourhood"] = dict(
        axis_range=ranges, axis_buf=bufs, axis_target=targets,
        cells=cells, neighbourhood_keys=nb_keys,
        neighbourhood_median=round(float(np.median(nb_vals)), 4),
        neighbourhood_values=[round(float(x), 4) for x in nb_vals],
        finalist_avgR=cells[fkey]["avgR"],
        finalist_minus_nb_median=round(cells[fkey]["avgR"] - float(np.median(nb_vals)), 4),
        finalist_rank_in_nb=1 + int((nb_vals > cells[fkey]["avgR"]).sum()),
        nb_size=len(nb_keys), grid_median=round(float(np.median(
            [v["avgR"] for v in cells.values()])), 4),
        grid_best=ranked[0], grid_second=ranked[1], n_cells=len(cells),
        flag_overfit_spike=(cells[fkey]["avgR"] - float(np.median(nb_vals)) > 0.10
                            and (nb_vals > cells[fkey]["avgR"]).sum() == 0))
    nb = out["neighbourhood"]
    print(f"[6] neighbourhood 3x3x3 median={nb['neighbourhood_median']:+.3f} "
          f"finalist={nb['finalist_avgR']:+.3f} delta={nb['finalist_minus_nb_median']:+.3f} "
          f"rank {nb['finalist_rank_in_nb']}/{nb['nb_size']}  "
          f"grid {nb['n_cells']} cells median={nb['grid_median']:+.3f} "
          f"best={nb['grid_best'][1]}={nb['grid_best'][0]:+.3f} "
          f"flag={nb['flag_overfit_spike']}")

    half = len(dates) // 2
    halves = {}
    for name, ds in (("first_50pct", dates[:half]), ("second_50pct", dates[half:])):
        dset = set(ds)
        rr = [t["R"] for t in trades if t["date"] in dset]
        halves[name] = dict(sessions=len(ds), first=str(ds[0]), last=str(ds[-1]),
                            **mstats(rr))
    clean = [d for d in dates if d.year >= 2026]
    ch = len(clean) // 2
    clean_halves = {}
    for name, ds in (("first_50pct", clean[:ch]), ("second_50pct", clean[ch:])):
        dset = set(ds)
        rr = [t["R"] for t in trades if t["date"] in dset]
        clean_halves[name] = dict(sessions=len(ds), first=str(ds[0]), last=str(ds[-1]),
                                  **mstats(rr))
    out["subsample_split"] = dict(all_sessions=halves,
                                  excluding_2025_strays=clean_halves)
    print("[7] date halves  " + " | ".join(
        f"{k}:n={v['n']},avgR={v['avgR']:+.3f},t={v['t']}" for k, v in halves.items()))
    print("     ex-strays    " + " | ".join(
        f"{k}:n={v['n']},avgR={v['avgR']:+.3f},t={v['t']}"
        for k, v in clean_halves.items()))

    with open(os.path.join(OUTDIR, "robustness.json"), "w") as fh:
        json.dump(out, fh, indent=1, default=str)
    write_md(out)
    print(f"wrote {os.path.join(OUTDIR, 'robustness.json')} and robustness.md")
    return 0


def write_md(o):
    b, t, c = o["bootstrap"], o["entry_timing"], o["cost"]
    nb, sp = o["neighbourhood"], o["subsample_split"]
    dk, f = o["drop_topk"], o["folds"]
    lines = [
        "# Double-VWAP finalist — adversarial robustness audit",
        "",
        f"Finalist: `{o['meta']['final_cfg']}` — n={o['meta']['final_stats']['n']}, "
        f"avgR={o['meta']['final_stats']['avgR']:+.4f}, t={o['meta']['final_stats']['t']}, "
        f"PF={o['meta']['final_stats']['PF']}, win={o['meta']['final_stats']['win']}%. "
        f"Expected result reproduced: **{o['meta']['reproduces_expected']}**.",
        f"Sessions: {o['meta']['sessions']} ({o['meta']['session_first']} .. "
        f"{o['meta']['session_last']}), of which 5 are stray 2025-07 days.",
        "Engine unchanged; cost 1.1 pt unless stated. Seed 42. No tuning.",
        "",
        "## 1. Moving-block bootstrap (5 consecutive sessions, 2000 draws)",
        "",
        f"- avgR 90% CI **[{b['avgR_ci90'][0]:+.4f}, {b['avgR_ci90'][1]:+.4f}]**, "
        f"median {b['avgR_median']:+.4f}; P(avgR<=0) = **{b['avgR_share_le0']:.1%}**.",
        f"- cumulative R 90% CI [{b['cumR_ci90'][0]:+.1f}, {b['cumR_ci90'][1]:+.1f}] "
        f"(original {b['original_cumR']:+.1f}); P(cumR<=0) = {b['cumR_share_le0']:.1%}.",
        "",
        "## 2. Drop-top-k trades / best-worst month",
        "",
        "| removed | n | avgR |",
        "|---|---:|---:|",
    ]
    for k, v in dk["drop_top_k"].items():
        lines.append(f"| top {k[1:]} trades | {v['n']} | {v['avgR']:+.4f} |")
    for label, v in dk["month_drop"].items():
        lines.append(f"| {label} {v['month']} (n={v['removed']['n']}, "
                     f"avgR {v['removed']['avgR']:+.3f}) | {v['kept']['n']} | "
                     f"{v['kept']['avgR']:+.4f} |")
    lines += [
        "",
        "## 3. Six contiguous date-ordered folds",
        "",
        "| fold | sessions | date range | n | avgR | t |",
        "|---:|---:|---|---:|---:|---:|",
    ]
    for x in f["folds"]:
        lines.append(f"| {x['fold']} | {x['sessions']} | {x['first']} .. {x['last']} | "
                     f"{x['n']} | {x['avgR'] if x['avgR'] is not None else 'n/a'} | "
                     f"{x['t']} |")
    lines += [f"", f"Positive folds: **{f['n_positive']}/6**.",
              "", "## 4. Entry-timing honesty", "",
              "| fill | n | avgR | t |", "|---|---:|---:|---:|"]
    for k in ("a_base", "b_sigclose_rescaled", "c_late_rescaled",
              "b_sigclose_fixedlevel", "c_late_fixedlevel"):
        v = t[k]
        lines.append(f"| {k} | {v['n']} | {v['avgR']:+.4f} | {v['t']} |")
    lines += [
        "",
        "(b)=signal-bar close +0.5 pt adverse slippage; (c)=one bar late. "
        "`rescaled` keeps stop/target distances identical (pre-registered reading of "
        "\"same stop/target distances\"); `fixedlevel` keeps absolute levels as a "
        f"control. Baseline custom-sim mismatches: {t['baseline_custom_sim_mismatches']}.",
        "",
        "## 5. Cost regime and observed spread",
        "",
        "| cost | n | avgR | t | PF |", "|---|---:|---:|---:|---:|",
    ]
    for k, v in c["regimes"].items():
        lines.append(f"| {k} | {v['n']} | {v['avgR']:+.4f} | {v['t']} | {v['PF']} |")
    lines += [
        "",
        f"Entry-minute spread matched {c['matched_entry_spreads']}/{c['n_trades']} trades; "
        f"median spread over all bars {c['median_spread_all_bars']:.4f} pt.",
        "", "## 6. Parameter neighbourhood (range x stop_buf x target, sess<=13:00)",
        "",
        f"3x3x3 neighbourhood (or15/or30/or60 x 20/30/40 x rr1.5/rr1.75/rr2.0) median "
        f"avgR = **{nb['neighbourhood_median']:+.4f}**; finalist "
        f"{nb['finalist_avgR']:+.4f}; delta **{nb['finalist_minus_nb_median']:+.4f}**, "
        f"rank {nb['finalist_rank_in_nb']}/{nb['nb_size']}.",
        f"Full grid: {nb['n_cells']} cells, median {nb['grid_median']:+.4f}; "
        f"best cell {nb['grid_best'][1]} at {nb['grid_best'][0]:+.4f}; "
        f"second {nb['grid_second'][1]} at {nb['grid_second'][0]:+.4f}. "
        f"Overfit-spike flag: **{nb['flag_overfit_spike']}**.",
        f"All {nb['n_cells']} cell values are in `robustness.json` under "
        "`neighbourhood.cells`.",
        "", "## 7. First vs second 50% of sessions by date", "",
        "| split | sessions | range | n | avgR | t |", "|---|---:|---|---:|---:|---:|",
    ]
    for k, v in sp["all_sessions"].items():
        lines.append(f"| {k} | {v['sessions']} | {v['first']} .. {v['last']} | {v['n']} | "
                     f"{v['avgR']:+.4f} | {v['t']} |")
    lines += ["", "Excluding the five 2025-07 stray sessions:", "",
              "| split | sessions | range | n | avgR | t |", "|---|---:|---|---:|---:|---:|"]
    for k, v in sp["excluding_2025_strays"].items():
        lines.append(f"| {k} | {v['sessions']} | {v['first']} .. {v['last']} | {v['n']} | "
                     f"{v['avgR']:+.4f} | {v['t']} |")
    lines += [
        "", "## Verdict", "",
        "**REJECT.** The trade-level statistics survive every resampling and cost "
        "check, but the configuration itself does not survive its neighbourhood: "
        f"the finalist is {nb['finalist_avgR']:+.4f}R versus a "
        f"{nb['neighbourhood_median']:+.4f}R 3x3x3 neighbourhood median "
        f"(delta {nb['finalist_minus_nb_median']:+.4f}, rank "
        f"{nb['finalist_rank_in_nb']}/{nb['nb_size']}) after a 10,248-config search. "
        "The pre-registered overfit-spike flag is TRUE. Supporting fact from the "
        "engine source: `run_grid` ranks by min(IS,OOS), so the quoted OOS half was "
        "part of the selection objective, not a holdout.", ""]
    with open(os.path.join(OUTDIR, "robustness.md"), "w") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    raise SystemExit(main())

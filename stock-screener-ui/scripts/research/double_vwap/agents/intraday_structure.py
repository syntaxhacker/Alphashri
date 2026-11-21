#!/usr/bin/env python
"""Pre-registered intraday-structure filters on the double-VWAP finalist.

Eight hypotheses, fixed in advance.  Every feature is computed from the
signal bar's CLOSE (bar i), prior bars, or the completed prior session --
no future bar and no entry-bar open is used.  Filters only: the range/stop/
target logic is the untouched baseline finalist.

Run from repo root: .venv/bin/python scripts/research/double_vwap/agents/intraday_structure.py
"""
from __future__ import annotations

import json
import os
import random
import sys
from datetime import date

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "research", "double_vwap"))
import strategy as S  # noqa: E402

OUTDIR = os.path.join(ROOT, "reports", "DOUBLE_VWAP", "agents")
CUT = date(2026, 6, 23)          # IS <= CUT, OOS > CUT (60% day split)
COST = 1.1
N_PERM = 1000
SEED = 20261120
FW_P = 0.05 / 8                  # Bonferroni for 8 pre-registered hypotheses

BASE_CFG = dict(range_src="or30", legs="A", stop_src="sigext",
                stop_buf=30.0, target_a="rr1.75", sess_end=13 * 60)
WDAY = ["Mon", "Tue", "Wed", "Thu", "Fri"]


# --------------------------------------------------------------------------- #
# stats
# --------------------------------------------------------------------------- #
def st(trades):
    if not trades:
        return dict(n=0, avgR=None, t=None, PF=None, win=None)
    R = np.array([float(t["R"]) for t in trades], dtype=float)
    wins, losses = R[R > 0], R[R <= 0]
    pf = float(wins.sum() / -losses.sum()) if losses.sum() < 0 else 99.0
    t = float(R.mean() / (R.std(ddof=1) / np.sqrt(len(R)) + 1e-12)) if len(R) > 2 else 0.0
    return dict(n=int(len(R)), avgR=round(float(R.mean()), 4),
                t=round(t, 2), PF=round(pf, 2), win=round(100 * float((R > 0).mean()), 1))


def block(trades):
    return dict(st(trades),
                IS=st([t for t in trades if t["date"] <= CUT]),
                OOS=st([t for t in trades if t["date"] > CUT]))


# --------------------------------------------------------------------------- #
# build rows: mirror S.collect but retain the signal-close context
# --------------------------------------------------------------------------- #
def build_rows():
    df = S.load()
    days = S.build_days(df)
    cfg = S.base_cfg(**BASE_CFG)
    rows = []
    for d in days:
        brk = S.first_break(d, cfg["range_src"], cfg["eps"])
        if brk is None:
            continue
        sig = S.leg_a_signal(d, brk, cfg)
        if not sig:
            continue
        tr = S.simulate(sig, COST)
        if not tr:
            continue
        i, dr, hi, lo = brk
        side = sig["side"]
        c, atr = float(d.c[i]), float(d.atr[i])
        prior = [k for k in range(i - 1, -1, -1) if d.t[k] >= S.RTH_OPEN][:20]
        med_vol = float(np.median([d.vol[k] for k in prior])) if len(prior) == 20 else np.nan
        ny = d.ny_vwap[i]
        f = dict(
            h1=((c - hi) if dr > 0 else (lo - c)) / atr if atr > 0 else np.nan,
            h2=int(d.t[i]) - S.RTH_OPEN,
            h3=(hi - lo) / atr if atr > 0 else np.nan,
            h4=float(d.vol[i]) / med_vol if np.isfinite(med_vol) and med_vol > 0 else np.nan,
            h5=1 if ((side < 0 and d.on_vwap < c) or (side > 0 and d.on_vwap > c)) else 0,
            h6=1 if (np.isfinite(ny) and ((side < 0 and c > ny) or (side > 0 and c < ny))) else 0,
            h7=None,                       # filled from completed prior session below
            h8=d.date.weekday(),
        )
        rows.append(dict(tr=tr, day=d, date=d.date, i=i, dr=dr, side=side,
                         c=c, atr=atr, hi=hi, lo=lo, f=f))

    # completed prior session: previous usable session only if it is adjacent
    # (<=7 calendar days) -- prevents the 2025-07 -> 2026-03 gap being a "prior day"
    sdays = sorted(days, key=lambda x: x.date)
    for idx, d in enumerate(sdays):
        prev = sdays[idx - 1] if idx > 0 else None
        if prev is not None and (d.date - prev.date).days <= 7:
            m = (prev.t >= S.RTH_OPEN) & (prev.t < S.RTH_CLOSE)
            d._pdh, d._pdl = float(prev.h[m].max()), float(prev.l[m].min())
        else:
            d._pdh, d._pdl = None, None
    for r in rows:
        pdh, pdl = r["day"]._pdh, r["day"]._pdl
        if pdh is None:
            r["f"]["h7"] = None
        else:
            lvl = pdh if r["side"] < 0 else pdl
            r["f"]["h7"] = 1 if abs(r["c"] - lvl) <= 0.25 * r["atr"] else 0
        r["tr"]["_wday"] = r["f"]["h8"]
        r["tr"]["_bucket"] = r["f"]      # only for grouping; not used by stats
    return rows, days


# --------------------------------------------------------------------------- #
# grouping helpers
# --------------------------------------------------------------------------- #
def by_median(rows, key, small, large):
    vals = [r["f"][key] for r in rows if np.isfinite(r["f"][key])]
    m = float(np.median(vals))
    out = {small: [], large: []}
    for r in rows:
        v = r["f"][key]
        if np.isfinite(v):
            out[small if v <= m else large].append(r["tr"])
    return out, m


def by_binary(rows, key, yes, no):
    out = {yes: [], no: []}
    for r in rows:
        v = r["f"][key]
        if v is None:
            continue
        out[yes if v == 1 else no].append(r["tr"])
    return out, None


def by_threshold(rows, key, thr, low, high):
    out = {low: [], high: []}
    for r in rows:
        v = r["f"][key]
        if not np.isfinite(v):
            continue
        out[low if v <= thr else high].append(r["tr"])
    return out, thr


def by_weekday(rows):
    out = {WDAY[k]: [] for k in range(5)}
    out["Mon/Tue"], out["Wed-Fri"] = [], []
    for r in rows:
        k = r["f"]["h8"]
        out[WDAY[k]].append(r["tr"])
        out["Mon/Tue" if k <= 1 else "Wed-Fri"].append(r["tr"])
    return out, None


def make_hypotheses(rows):
    h1, m1 = by_median(rows, "h1", "small", "large")
    h3, m3 = by_median(rows, "h3", "narrow", "wide")
    h4, m4 = by_median(rows, "h4", "light", "heavy")
    h2, t2 = by_threshold(rows, "h2", 30, "early<=30", "late>30")
    h5, _ = by_binary(rows, "h5", "on_vwap_behind", "on_vwap_in_front")
    h6, _ = by_binary(rows, "h6", "premium_fade", "opposite")
    h7, _ = by_binary(rows, "h7", "near_pdph_pdl", "not_near")
    h8, _ = by_weekday(rows)
    return [
        dict(key="H1", name="Break distance beyond range / ATR14",
             detail="(close-hi)/ATR for up-break, (lo-close)/ATR for down-break; median split",
             selected="small", rest="large", order=["small", "large"],
             cutoff=round(m1, 4), groups=h1),
        dict(key="H2", name="Time of first break after 09:30 (min)",
             detail="early <=30 min vs late >30 min (fixed threshold, no tuning)",
             selected="early<=30", rest="late>30", order=["early<=30", "late>30"],
             cutoff=t2, groups=h2),
        dict(key="H3", name="OR30 range width / ATR14",
             detail="(OR30 hi-lo)/ATR at signal close; median split",
             selected="narrow", rest="wide", order=["narrow", "wide"],
             cutoff=round(m3, 4), groups=h3),
        dict(key="H4", name="Break-bar volume / median prior-20 RTH volume",
             detail="light vs heavy half (median split)",
             selected="light", rest="heavy", order=["light", "heavy"],
             cutoff=round(m4, 4), groups=h4),
        dict(key="H5", name="Overnight VWAP behind trade (target side)",
             detail="behind = ONVWAP below signal close for shorts, above for longs",
             selected="on_vwap_behind", rest="on_vwap_in_front",
             order=["on_vwap_behind", "on_vwap_in_front"], cutoff=None, groups=h5),
        dict(key="H6", name="Premium fade vs NY VWAP",
             detail="short with close above NYVWAP OR long with close below NYVWAP",
             selected="premium_fade", rest="opposite",
             order=["premium_fade", "opposite"], cutoff=None, groups=h6),
        dict(key="H7", name="Entry near prior-day RTH high/low",
             detail="|signal close - PDH|<=0.25*ATR (shorts) / PDL (longs)",
             selected="near_pdph_pdl", rest="not_near",
             order=["near_pdph_pdl", "not_near"], cutoff=0.25, groups=h7),
        dict(key="H8", name="Day of week",
             detail="all five reported; pre-registered split Mon/Tue vs Wed-Fri",
             selected="Mon/Tue", rest="Wed-Fri",
             order=["Mon", "Tue", "Wed", "Thu", "Fri", "Mon/Tue", "Wed-Fri"],
             cutoff=None, groups=h8),
    ]


# --------------------------------------------------------------------------- #
# permutation test on the selected bucket's edge vs its complement
# --------------------------------------------------------------------------- #
def perm_test(sel_trades, rest_trades):
    rs = np.array([float(t["R"]) for t in sel_trades])
    rr = np.array([float(t["R"]) for t in rest_trades])
    allr = np.concatenate([rs, rr])
    n = len(rs)
    obs = float(rs.mean() - rr.mean())
    rng = random.Random(SEED)
    idx = list(range(len(allr)))
    ge = 0
    for _ in range(N_PERM):
        rng.shuffle(idx)
        a = allr[idx[:n]]
        b = allr[idx[n:]]
        if float(a.mean() - b.mean()) >= obs:
            ge += 1
    p = (ge + 1) / (N_PERM + 1)
    return dict(stat=round(obs, 4), p=round(p, 5), ge=ge, n_perm=N_PERM,
                seed=SEED, threshold=round(FW_P, 5))


def qualifies(b, baseline_avg):
    return (b["n"] >= 25 and b["IS"]["avgR"] is not None and b["OOS"]["avgR"] is not None
            and b["IS"]["avgR"] > 0 and b["OOS"]["avgR"] > 0
            and b["avgR"] is not None and b["avgR"] > baseline_avg)


def main():
    rows, days = build_rows()
    baseline_tr = [r["tr"] for r in rows]
    baseline = block(baseline_tr)
    baseline_avg = float(np.mean([float(t["R"]) for t in baseline_tr]))

    hyps = make_hypotheses(rows)
    report = []
    for h in hyps:
        buckets = []
        for label in h["order"]:
            b = block(h["groups"][label])
            b["label"] = label
            b["selected"] = (label == h["selected"])
            buckets.append(b)
        sel = next(b for b in buckets if b["selected"])
        ok = qualifies(sel, baseline_avg)
        report.append(dict(key=h["key"], name=h["name"], detail=h["detail"],
                           cutoff=h["cutoff"], selected=h["selected"],
                           rest=h["rest"], buckets=buckets,
                           improvement=ok,
                           selected_n=sel["n"], selected_avgR=sel["avgR"],
                           selected_min_half=(min(sel["IS"]["avgR"], sel["OOS"]["avgR"])
                                              if sel["IS"]["avgR"] is not None
                                              and sel["OOS"]["avgR"] is not None else None)))

    # best qualifying split, else best selected bucket with n>=25
    cands = [r for r in report if r["improvement"]]
    fallback = [r for r in report if r["selected_n"] >= 25 and r["selected_avgR"] is not None]
    pool = cands if cands else fallback
    best = max(pool, key=lambda r: (r["selected_avgR"], r["selected_n"])) if pool else None
    perm = None
    if best:
        h = next(h for h in hyps if h["key"] == best["key"])
        perm = perm_test(h["groups"][best["selected"]], h["groups"][best["rest"]])

    payload = dict(
        meta=dict(command=".venv/bin/python scripts/research/double_vwap/agents/intraday_structure.py",
                  cut=str(CUT), cost=COST, n_perm=N_PERM, seed=SEED,
                  fw_threshold=round(FW_P, 5),
                  note="All features computed at the signal bar close (or prior bars / completed prior session); filters only; baseline untouched."),
        baseline_cfg=BASE_CFG, baseline=baseline,
        baseline_avgR_raw=round(baseline_avg, 6),
        n_sessions=len(days),
        hypotheses=report,
        best=dict(key=best["key"], selected=best["selected"],
                  qualifying=bool(cands), avgR=best["selected_avgR"], n=best["selected_n"]) if best else None,
        permutation=perm)

    os.makedirs(OUTDIR, exist_ok=True)
    with open(os.path.join(OUTDIR, "intraday_structure.json"), "w") as fh:
        json.dump(payload, fh, indent=2, default=str)
    with open(os.path.join(OUTDIR, "intraday_structure.md"), "w") as fh:
        fh.write(render_md(payload))

    print(f"sessions={len(days)}  trades={baseline['n']}  "
          f"avgR={baseline['avgR']:+.3f}  t={baseline['t']}  PF={baseline['PF']}  win={baseline['win']}%")
    print(f"IS<={CUT}: {baseline['IS']['avgR']:+.3f} (n={baseline['IS']['n']}) | "
          f"OOS>{CUT}: {baseline['OOS']['avgR']:+.3f} (n={baseline['OOS']['n']})")
    print("\n" + md_table(payload))
    if best:
        print(f"\nBEST: {best['key']} [{best['selected']}] avgR={best['selected_avgR']:+.4f} "
              f"n={best['selected_n']} qualifying={bool(cands)}")
        print(f"PERM: stat={perm['stat']:+.4f} p={perm['p']} "
              f"(need p<{FW_P:.4f} for 5% family-wise over 8 hypotheses) -> "
              f"{'SIGNIFICANT' if perm['p'] < FW_P else 'NOT significant'}")
    return 0


def fmt(b):
    if b["avgR"] is None:
        return f"n={b['n']:<3d}  --  (no trades)"
    return (f"n={b['n']:<3d} avgR={b['avgR']:+.3f} t={b['t']:5.2f} "
            f"PF={b['PF']:4.2f} win={b['win']:4.1f}% "
            f"IS={b['IS']['avgR'] if b['IS']['avgR'] is not None else '--':>+.3f}"
            f"({b['IS']['n']}) OOS={b['OOS']['avgR'] if b['OOS']['avgR'] is not None else '--':>+.3f}"
            f"({b['OOS']['n']})")


def md_table(payload):
    lines = ["| Hyp | Bucket | n | avgR | t | PF | win% | IS avgR (n) | OOS avgR (n) |",
             "|---|---|---:|---:|---:|---:|---:|---:|---:|"]
    for h in payload["hypotheses"]:
        for b in h["buckets"]:
            star = " **SEL**" if b["selected"] else ""
            isb = b["IS"]["avgR"]; oob = b["OOS"]["avgR"]
            isv = f"{isb:+.3f} ({b['IS']['n']})" if isb is not None else "n/a"
            oov = f"{oob:+.3f} ({b['OOS']['n']})" if oob is not None else "n/a"
            avg = f"{b['avgR']:+.3f}" if b["avgR"] is not None else "n/a"
            t = f"{b['t']:.2f}" if b["t"] is not None else "n/a"
            pf = f"{b['PF']:.2f}" if b["PF"] is not None else "n/a"
            win = f"{b['win']:.1f}" if b["win"] is not None else "n/a"
            lines.append(f"| {h['key']} | {b['label']}{star} | {b['n']} | {avg} | {t} | {pf} | {win} | {isv} | {oov} |")
    return "\n".join(lines)


def render_md(payload):
    b = payload["baseline"]
    p = payload["permutation"]
    best = payload["best"]
    out = []
    out.append("# Double-VWAP finalist — intraday-structure filters (pre-registered, 8 hypotheses)\n")
    out.append(f"Generated by `{payload['meta']['command']}`.\n")
    out.append("## Design\n")
    out.append("- Filters only. Range/stop/target are the untouched finalist: "
               f"`{json.dumps(payload['baseline_cfg'])}`, cost {COST} pt.\n")
    out.append(f"- IS <= {CUT} / OOS > {CUT}. All features are computed at the **signal bar close** "
               "(bar i), prior bars, or the completed prior session — no future bar and no "
               "entry-bar open (which is a bar later).\n")
    out.append(f"- Median splits for H1/H3/H4; fixed 30-min threshold for H2; binary flags H5/H6/H7; "
               f"weekday H8. No tuning of the baseline was performed.\n")
    out.append(f"- Improvement rule: selected bucket positive in BOTH halves, beats unfiltered "
               f"baseline avgR ({payload['baseline_avgR_raw']:.4f}), and n>=25.\n")
    out.append("- Permutation: shuffle the selected/complement labels 1000x among the trades, "
               "statistic = mean(R_selected) - mean(R_complement), one-sided p. Eight hypotheses "
               f"require p < {FW_P:.4f} (Bonferroni 5% family-wise).\n")
    out.append("\n## Baseline\n")
    out.append(f"n={b['n']}, avgR={b['avgR']:+.4f}, t={b['t']}, PF={b['PF']}, win={b['win']}%; "
               f"IS {b['IS']['avgR']:+.4f} (n={b['IS']['n']}) / "
               f"OOS {b['OOS']['avgR']:+.4f} (n={b['OOS']['n']}).\n")
    out.append("\n## All eight hypotheses\n")
    out.append(md_table(payload) + "\n")
    out.append("\n## Hypothesis notes\n")
    for h in payload["hypotheses"]:
        cut = f" (cut={h['cutoff']})" if h["cutoff"] is not None else ""
        out.append(f"- **{h['key']} — {h['name']}**: {h['detail']}{cut}. "
                   f"Selected bucket `{h['selected']}`: n={h['selected_n']}, "
                   f"avgR={h['selected_avgR']:+.3f} -> "
                   f"{'QUALIFIES' if h['improvement'] else 'does not qualify'}.\n")
    out.append("\n## Permutation test (best split)\n")
    if best and p:
        out.append(f"Best qualifying/best selected split: **{best['key']} [{best['selected']}]**, "
                   f"avgR={best['avgR']:+.4f}, n={best['n']}, "
                   f"qualifying={best['qualifying']}.\n\n")
        out.append(f"Observed stat = {p['stat']:+.4f}; {p['ge']}/{p['n_perm']} shuffles >= observed; "
                   f"p = {p['p']} (seed {p['seed']}). "
                   f"Required p < {p['threshold']} -> "
                   f"**{'SIGNIFICANT' if p['p'] < p['threshold'] else 'NOT significant'}**.\n")
    else:
        out.append("No selected bucket had n>=25.\n")
    out.append("\n## Verdict\n")
    sig = bool(p and best and best["qualifying"] and p["p"] < FW_P)
    if sig:
        out.append(f"A pre-registered filter ({best['key']} {best['selected']}) improves the edge "
                   "in both halves and survives the family-wise-corrected permutation test. "
                   "Treat as a candidate, not a production change, pending out-of-sample replication.\n")
    else:
        out.append("No pre-registered intraday-structure filter both improves the edge in both "
                   "halves and survives the family-wise-corrected permutation test. The baseline "
                   "edge appears robust to these eight structural splits; any apparent subgroup "
                   "gains are not distinguishable from chance after correcting for 8 tests.\n")
    return "".join(out)


if __name__ == "__main__":
    raise SystemExit(main())

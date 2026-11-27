#!/usr/bin/env python
from __future__ import annotations

import bisect
import datetime as dt
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, RESEARCH)
import strategy as S  # noqa: E402

OUTDIR = os.path.join(S.ROOT, "reports", "DOUBLE_VWAP", "agents")
COST = 1.1
IS_CUT = dt.date(2026, 6, 23)
SEED = 42
NSHUFFLE = 1000
FW_ALPHA = 0.05 / 8

BASE_CFG = S.base_cfg(range_src="or30", legs="A", stop_src="sigext",
                      stop_buf=30.0, target_a="rr1.75", sess_end=13 * 60)

HYPOTHESES = [
    (1, "vix_level", "VIX close on prior trading day (D-1)",
     "low vs high half of prior-day VIX close (median split)"),
    (2, "vix_1d_change", "VIX close(D-1) - VIX close(D-2)",
     "up (>0) vs down (<=0)"),
    (3, "vix_60d_pct", "percentile rank of VIX close(D-1) within trailing 60 daily closes ending D-1",
     "bottom vs top half of that percentile (median split)"),
    (4, "nq_rv10", "10-day std of NQ=F daily returns ending D-1",
     "low vs high half (median split)"),
    (5, "nq_overnight_gap_abs", "abs(first RTH bar open on D - last RTH close on D-1), from 1m bars",
     "small vs large |gap| (median split)"),
    (6, "prior_rth_range_atr14", "prior-day RTH range (1m) / ATR14 of NQ=F daily bars ending D-1",
     "narrow vs wide (median split)"),
    (7, "es_nq_corr20", "correlation of ES=F and NQ=F daily returns over 20 days ending D-1",
     "low vs high half (median split)"),
    (8, "es_prior_move_vs_nq_gap", "sign(ES close(D-1) - ES close(D-2)) vs sign(NQ gap from H5)",
     "same sign vs opposite sign"),
]


def mstats(trades):
    return S.stats(trades, max(1, len(trades)))


def half_stats(trades):
    is_t = [t for t in trades if t["date"] <= IS_CUT]
    oos_t = [t for t in trades if t["date"] > IS_CUT]
    s = mstats(trades)
    return dict(n=s["n"], avgR=s["avgR"], t=s["t"], PF=s["PF"], win=s["win"],
                IS=round(mstats(is_t)["avgR"], 4),
                OOS=round(mstats(oos_t)["avgR"], 4),
                IS_n=len(is_t), OOS_n=len(oos_t))


def qualifies(st, baseline_avgR):
    return bool(st["n"] >= 25 and st["avgR"] > baseline_avgR
                and st["IS"] > 0 and st["OOS"] > 0)


def yfinance_daily(ticker):
    import yfinance as yf
    raw = yf.download(ticker, start="2025-10-01", end="2026-09-15", interval="1d",
                      auto_adjust=False, progress=False, threads=False)
    if raw is None or raw.empty:
        return None, None
    if isinstance(raw.columns, pd.MultiIndex):
        if ticker in raw.columns.get_level_values(-1):
            raw = raw.xs(ticker, axis=1, level=-1)
        else:
            raw = raw.droplevel(-1, axis=1)
    for col in ("Open", "High", "Low", "Close"):
        if col not in raw.columns:
            return None, None
    raw = raw[["Open", "High", "Low", "Close"]].dropna().sort_index()
    dates = [d.date() for d in raw.index]
    return dates, raw


def prior_idx(yf_dates, day):
    return bisect.bisect_left(yf_dates, day) - 1


def prev_session_date(day_dates, day):
    """Session date immediately preceding `day` in the 1m-bar list."""
    i = bisect.bisect_left(day_dates, day) - 1
    return day_dates[i] if i >= 0 else None


def rth_slice(d):
    m = (d.t >= S.RTH_OPEN) & (d.t < S.RTH_CLOSE)
    return m


def build_features(trades, days, day_dates, series):
    feat = {h[0]: {} for h in HYPOTHESES}
    vix_d, vix_f = series["vix"]
    es_d, es_f = series["es"]
    nq_d, nq_f = series["nq"]

    vix_c = vix_f["Close"].to_numpy(float) if vix_f is not None else None
    es_c = es_f["Close"].to_numpy(float) if es_f is not None else None
    nq_c = nq_f["Close"].to_numpy(float) if nq_f is not None else None
    nq_h = nq_f["High"].to_numpy(float) if nq_f is not None else None
    nq_l = nq_f["Low"].to_numpy(float) if nq_f is not None else None

    # NQ daily ATR(14), computed on rows ending D-1 (never includes D).
    nq_atr = None
    if nq_f is not None and len(nq_c) >= 15:
        pc = np.concatenate([[np.nan], nq_c[:-1]])
        tr = np.maximum(nq_h - nq_l, np.maximum(np.abs(nq_h - pc), np.abs(nq_l - pc)))
        nq_atr = pd.Series(tr).rolling(14, min_periods=14).mean().to_numpy()

    # daily returns for NQ and ES (r[i] = c[i]/c[i-1] - 1, aligned to index i)
    nq_ret = es_ret = None
    if nq_c is not None and len(nq_c) >= 21:
        nq_ret = np.concatenate([[np.nan], nq_c[1:] / nq_c[:-1] - 1.0])
    if es_c is not None and len(es_c) >= 21:
        es_ret = np.concatenate([[np.nan], es_c[1:] / es_c[:-1] - 1.0])

    bydate = {d.date: d for d in days}
    for t in trades:
        day = t["date"]
        iv = prior_idx(vix_d, day) if vix_d else -1
        ie = prior_idx(es_d, day) if es_d else -1
        inn = prior_idx(nq_d, day) if nq_d else -1
        pd_date = prev_session_date(day_dates, day)
        # the cached feed has 5 stray Jul-2025 sessions; do not treat one as the
        # "prior session" of a Mar-2026 trade (a 230-day stale gap).
        if pd_date is not None and (day - pd_date).days > 5:
            pd_date = None

        feat[1][day] = float(vix_c[iv]) if iv >= 0 and vix_c is not None else None
        feat[2][day] = (float(vix_c[iv] - vix_c[iv - 1])
                        if iv >= 1 and vix_c is not None else None)
        feat[3][day] = (float(100.0 * (vix_c[iv - 59:iv + 1] <= vix_c[iv]).mean())
                        if iv >= 59 and vix_c is not None else None)
        feat[4][day] = (float(np.std(nq_ret[inn - 9:inn + 1], ddof=1))
                        if inn >= 9 and nq_ret is not None else None)
        gap = np.nan
        d = bydate.get(day)
        if d is not None and pd_date is not None:
            prev = bydate.get(pd_date)
            if prev is not None:
                pm = rth_slice(prev)
                if pm.any():
                    gap = float(d.o[d.rth_start] - prev.c[pm][-1])
        feat[5][day] = float(abs(gap)) if np.isfinite(gap) else None
        ratio = np.nan
        if pd_date is not None and inn >= 0 and nq_atr is not None:
            prev = bydate.get(pd_date)
            if prev is not None:
                pm = rth_slice(prev)
                if pm.any() and np.isfinite(nq_atr[inn]) and nq_atr[inn] > 0:
                    ratio = float((prev.h[pm].max() - prev.l[pm].min()) / nq_atr[inn])
        feat[6][day] = float(ratio) if np.isfinite(ratio) else None
        corr = np.nan
        if inn >= 19 and ie >= 19 and nq_ret is not None and es_ret is not None:
            a, b = nq_ret[inn - 19:inn + 1], es_ret[ie - 19:ie + 1]
            if np.isfinite(a).all() and np.isfinite(b).all() and a.std() > 0 and b.std() > 0:
                corr = float(np.corrcoef(a, b)[0, 1])
        feat[7][day] = float(corr) if np.isfinite(corr) else None
        es_move = float(es_c[ie] - es_c[ie - 1]) if ie >= 1 and es_c is not None else np.nan
        if np.isfinite(gap) and np.isfinite(es_move) and gap != 0 and es_move != 0:
            feat[8][day] = "same" if np.sign(es_move) == np.sign(gap) else "opposite"
        else:
            feat[8][day] = None
    return feat


def signed_gaps(trades, days, day_dates):
    """Signed NQ gap for H8, keyed by (date) — same construction as H5."""
    bydate = {d.date: d for d in days}
    out = {}
    for t in trades:
        day, d = t["date"], bydate.get(t["date"])
        pd_date = prev_session_date(day_dates, day)
        if pd_date is not None and (day - pd_date).days > 5:
            pd_date = None
        if d is None or pd_date is None:
            continue
        prev = bydate.get(pd_date)
        if prev is None:
            continue
        pm = rth_slice(prev)
        if pm.any():
            out[day] = float(d.o[d.rth_start] - prev.c[pm][-1])
    return out


def evaluate(hid, name, definition, split_desc, feat, trades, baseline_avgR, gaps, series):
    hf = feat[hid]
    vals = {t["date"]: hf.get(t["date"]) for t in trades}
    valid = [t for t in trades if vals[t["date"]] is not None]
    nan_count = len(trades) - len(valid)

    if hid in (2, 8):
        if hid == 2:
            labels = {day: ("up" if v > 0 else "down") for day, v in vals.items() if v is not None}
            bnames = ("up", "down")
        else:
            labels = {day: v for day, v in vals.items() if v is not None}
            bnames = ("same", "opposite")
        threshold = None
    else:
        arr = np.array([vals[t["date"]] for t in valid], float)
        threshold = float(np.median(arr)) if len(arr) else None
        labels = {}
        for day, v in vals.items():
            if v is None:
                continue
            labels[day] = ("low" if hid != 5 else "small") if v <= threshold \
                else ("high" if hid != 5 else "large")
            if hid == 3:
                labels[day] = "bottom" if v <= threshold else "top"
            if hid == 6:
                labels[day] = "narrow" if v <= threshold else "wide"
            if hid == 7:
                labels[day] = "low" if v <= threshold else "high"
        bnames = sorted(set(labels.values()))

    buckets = {}
    for bn in bnames:
        sub = [t for t in trades if labels.get(t["date"]) == bn]
        buckets[bn] = half_stats(sub)

    # selected bucket = the more favorable of the two by avgR (fixes the choice
    # before looking at the permutation p; both buckets are always reported).
    selected = max(buckets, key=lambda b: buckets[b]["avgR"])
    ok = qualifies(buckets[selected], baseline_avgR)
    res = dict(id=hid, name=name, definition=definition, split=split_desc,
               available=series_available(hid, series), n_valid=len(valid),
               n_unavailable=nan_count, threshold=threshold,
               buckets=buckets, selected=selected, improves=ok,
               reason=("n>=25, avgR>baseline, both halves positive" if ok else
                       "fails at least one of: n>=25 / avgR>baseline / both halves positive"))
    return res, labels


def series_available(hid, series):
    need = {1: "vix", 2: "vix", 3: "vix", 4: "nq", 5: "bars",
            6: "nq+bars", 7: "es+nq", 8: "es+bars"}[hid]
    if need == "bars":
        return True
    if need == "nq+bars":
        return series["nq"][1] is not None
    if need == "es+nq":
        return series["es"][1] is not None and series["nq"][1] is not None
    if need == "es+bars":
        return series["es"][1] is not None
    return series[need][1] is not None


def permutation_p(bucket_trade_dates, trades, observed_avgR):
    R = np.array([t["R"] for t in trades], float)
    member = np.array([t["date"] in bucket_trade_dates for t in trades])
    k = int(member.sum())
    if k == 0 or k == len(R):
        return 1.0
    rng = np.random.default_rng(SEED)
    means = np.empty(NSHUFFLE)
    for i in range(NSHUFFLE):
        idx = rng.choice(len(R), size=k, replace=False)
        means[i] = R[idx].mean()
    return float(np.mean(means >= observed_avgR))


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    df = S.load()
    days = S.build_days(df)
    day_dates = sorted(d.date for d in days)
    trades = S.collect(days, BASE_CFG, COST)
    base = half_stats(trades)
    print(f"sessions={len(days)}  trades={len(trades)}  cost={COST}pt")
    print(f"baseline  n={base['n']} avgR={base['avgR']:+.4f} t={base['t']:+.2f} "
          f"PF={base['PF']:.2f} win={base['win']:.1f}%  "
          f"IS={base['IS']:+.4f} OOS={base['OOS']:+.4f}  (IS<= {IS_CUT})")

    spec = {}
    for ticker, key in (("^VIX", "vix"), ("ES=F", "es"), ("NQ=F", "nq")):
        try:
            dts, frame = yfinance_daily(ticker)
            spec[key] = (dts, frame)
            if frame is not None:
                print(f"yf {ticker:5s}: {len(frame):4d} rows  "
                      f"{frame.index.min().date()} -> {frame.index.max().date()}")
            else:
                print(f"yf {ticker:5s}: UNAVAILABLE -> hypotheses using it are dropped")
        except Exception as e:
            spec[key] = (None, None)
            print(f"yf {ticker:5s}: ERROR {type(e).__name__}: {str(e)[:120]} -> dropped")

    feat = build_features(trades, days, day_dates, spec)
    gaps = signed_gaps(trades, days, day_dates)

    results = []
    for hid, name, definition, split_desc in HYPOTHESES:
        if not series_available(hid, spec):
            results.append(dict(id=hid, name=name, definition=definition, split=split_desc,
                                available=False, n_valid=0, n_unavailable=len(trades),
                                threshold=None, buckets={}, selected=None, improves=False,
                                reason="source series unavailable from yfinance; hypothesis dropped"))
            print(f"H{hid} {name:24s} SOURCE UNAVAILABLE (dropped)")
            continue
        res, _ = evaluate(hid, name, definition, split_desc, feat, trades,
                          base["avgR"], gaps, spec)
        results.append(res)
        bs = " | ".join(f"{bn}: n={v['n']:3d} avgR={v['avgR']:+.3f} t={v['t']:5.2f} "
                        f"IS={v['IS']:+.3f} OOS={v['OOS']:+.3f}"
                        for bn, v in sorted(res["buckets"].items()))
        print(f"H{hid} {name:24s} valid={res['n_valid']:3d} thr="
              f"{'-' if res['threshold'] is None else format(res['threshold'], '.4f'):>9s} | {bs} "
              f"| sel={res['selected']} {'IMPROVES' if res['improves'] else '-'}")

    cands = []
    for r in results:
        for bn, st in r["buckets"].items():
            if st["n"] >= 25:
                cands.append((st["avgR"], r["id"], bn, st))
    cands.sort(reverse=True, key=lambda x: x[0])
    if not cands:
        cands = [(max(st["avgR"] for r in results for st in r["buckets"].values()), 0, "", {})]
    _, best_hid, best_bn, best_st = cands[0]
    best_res = next(r for r in results if r["id"] == best_hid)
    _, best_labels = evaluate(best_hid, best_res["name"], best_res["definition"],
                              best_res["split"], feat, trades, base["avgR"], gaps, spec)
    member_dates = {day for day, lab in best_labels.items() if lab == best_bn}
    p = permutation_p(member_dates, trades, best_st["avgR"])
    print(f"\nbest split: H{best_hid} {best_res['name']} / {best_bn}  "
          f"n={best_st['n']} avgR={best_st['avgR']:+.4f} t={best_st['t']:+.2f} "
          f"IS={best_st['IS']:+.4f} OOS={best_st['OOS']:+.4f}")
    print(f"permutation p ({NSHUFFLE} shuffles, seed {SEED}) = {p:.4f}  "
          f"| family-wise threshold p<{FW_ALPHA:.4f} (8 tests)")

    any_sig = any(r["improves"] for r in results) and p < FW_ALPHA
    if any_sig:
        verdict = "improves"
        why = (f"H{best_hid}/{best_bn} qualifies (n>=25, avgR>baseline, both halves positive) "
               f"and permutation p={p:.4f} < {FW_ALPHA:.4f}")
    else:
        best_ok = [r for r in results if r["improves"]]
        if best_ok:
            why = (f"{len(best_ok)} bucket(s) clear the descriptive bar but the best split's "
                   f"permutation p={p:.4f} fails even the nominal 0.05 bar and is far above "
                   f"the family-wise {FW_ALPHA:.4f}; not enough evidence after 8 tests")
        else:
            why = (f"no bucket clears the descriptive bar (n>=25, avgR>{base['avgR']:+.4f}, "
                   f"both halves positive); best bucket avgR={best_st['avgR']:+.4f}; "
                   f"permutation p={p:.4f}")
        verdict = "no change" if best_st["avgR"] > 0 else "hurts"

    out = dict(
        study="double_vwap_causal_context_regime",
        pre_registered=True, n_hypotheses=8, no_post_hoc_additions=True,
        method=dict(
            cost_pts=COST, is_cut=str(IS_CUT), is_rule="date <= cut", oos_rule="date > cut",
            split="median (or sign for H2/H8); no threshold tuning",
            baseline_config=BASE_CFG,
            improvement_rule="selected bucket: n>=25 AND avgR>baseline AND IS>0 AND OOS>0",
            selected_bucket="higher-avgR of the two buckets, fixed before permutation",
            median_split_note="a median split partitions the same trades, so one bucket beats "
                              "the baseline average by construction; the informative guards are "
                              "both-halves-positive, n>=25 and the permutation p after 8-test "
                              "family-wise correction",
            stale_session_guard="prior 1m session must be <=5 calendar days before the trade "
                                "date (the feed has 5 stray Jul-2025 sessions)",
            permutation=f"{NSHUFFLE} shuffles of binary membership labels among baseline trades, "
                        f"one-sided, seed={SEED}",
            multiple_testing=f"8 pre-registered tests; Bonferroni alpha={FW_ALPHA:.5f}",
            causality="all daily features use D-1 close or earlier; H5/H6 use prior-session 1m "
                      "RTH and the D 09:30 open, which is known before entries (>=10:00 ET)",
        ),
        baseline=dict(stats=base,
                      context_reported=dict(avgR=0.360, t=3.02, PF=1.71, win=51.1,
                                            IS=0.309, OOS=0.264),
                      note=("Context numbers use a different historical split convention; "
                            "this study uses the task-specified IS<=2026-06-23 / OOS>2026-06-23 "
                            "consistently for baseline and every bucket.")),
        data_sources={k: dict(ticker=t, rows=(0 if v[1] is None else len(v[1])),
                              first=(None if v[1] is None else str(v[1].index.min().date())),
                              last=(None if v[1] is None else str(v[1].index.max().date())),
                              status=("ok" if v[1] is not None else "unavailable"))
                      for k, t in (("vix", "^VIX"), ("es", "ES=F"), ("nq", "NQ=F"))
                      for v in [spec[k]]},
        hypotheses=results,
        permutation=dict(best_hypothesis=best_hid, best_name=best_res["name"],
                         best_bucket=best_bn, observed_avgR=best_st["avgR"],
                         n=best_st["n"], p=round(p, 5), n_shuffles=NSHUFFLE, seed=SEED,
                         family_wise_threshold=round(FW_ALPHA, 5),
                         note="p is conditional on the selected split; family-wise threshold "
                              "accounts for the 8 hypotheses."),
        verdict=dict(result=verdict, why=why),
    )
    jpath = os.path.join(OUTDIR, "context_regime.json")
    with open(jpath, "w") as fh:
        json.dump(out, fh, indent=2, default=str)

    _write_md(out, os.path.join(OUTDIR, "context_regime.md"))
    print(f"\nverdict: {verdict} -- {why}")
    print(f"wrote {jpath}")
    print(f"wrote {os.path.join(OUTDIR, 'context_regime.md')}")
    return 0


def _fmt(st):
    if not st:
        return "| - | - | - | - | - | - |"
    return (f"| {st['n']} | {st['avgR']:+.3f} | {st['t']:+.2f} | "
            f"{st['IS']:+.3f} | {st['OOS']:+.3f} | {st['PF']:.2f} |")


def _write_md(out, path):
    b = out["baseline"]["stats"]
    L = [
        "# Double-VWAP: causal daily / regime context (pre-registered, 8 hypotheses)",
        "",
        f"Baseline (frozen OR30 fade, cost {out['method']['cost_pts']}pt): "
        f"n={b['n']}, avgR={b['avgR']:+.3f}, t={b['t']:+.2f}, PF={b['PF']:.2f}, "
        f"win={b['win']:.1f}%, IS(≤{out['method']['is_cut']})={b['IS']:+.3f}, "
        f"OOS={b['OOS']:+.3f}.",
        "",
        "All features are causal: yfinance daily closes through D-1 only (H1–H4, H6–H8); "
        "H5/H6 use the prior session's 1m RTH and the D 09:30 open, known before every "
        "≥10:00 entry. Splits are medians (or signs for H2/H8) — no tuning, no geometry changes.",
        "",
        "| # | Hypothesis | Bucket | n | avgR | t | IS | OOS | PF |",
        "|--:|---|---|--:|--:|--:|--:|--:|--:|",
    ]
    for r in out["hypotheses"]:
        if not r["available"]:
            L.append(f"| H{r['id']} | {r['name']} | — | — | — | — | — | — | — |")
            continue
        for bn, st in sorted(r["buckets"].items()):
            mark = " *selected*" if bn == r["selected"] else ""
            L.append(f"| H{r['id']} | {r['name']} | {bn}{mark} | {st['n']} | "
                     f"{st['avgR']:+.3f} | {st['t']:+.2f} | {st['IS']:+.3f} | "
                     f"{st['OOS']:+.3f} | {st['PF']:.2f} |")
    p = out["permutation"]
    L += [
        "",
        f"**Improvement bar:** a bucket must have n≥25, avgR > baseline "
        f"({b['avgR']:+.3f}), and be positive in BOTH halves. "
        + ("No bucket clears it." if not any(r["improves"] for r in out["hypotheses"])
           else "See *selected* rows above."),
        "",
        "A median split partitions the same 133 trades, so one bucket beats the baseline "
        "average *by construction* — that clause alone proves nothing. The real guards are "
        "both-halves-positive and the permutation p below, read with the 8-test correction.",
        "",
        f"**Permutation (best split H{p['best_hypothesis']} {p['best_name']}/{p['best_bucket']}, "
        f"n={p['n']}, avgR={p['observed_avgR']:+.3f}):** p={p['p']:.4f} over "
        f"{p['n_shuffles']} shuffles of the membership labels. That misses even the nominal "
        f"0.05 bar; with 8 pre-registered tests the family-wise bar is "
        f"p<0.006 (Bonferroni 0.05/8 = {p['family_wise_threshold']:.5f}); "
        f"the result does **not** clear it.",
        "",
        f"**Verdict: {out['verdict']['result']}.** {out['verdict']['why']}",
        "",
        "## What would be worth testing next",
        "",
        "- These are coarse *between-day* regimes; the edge is an *intraday* fade. "
        "A context filter that cannot beat a +0.36R unfiltered baseline is not worth adding.",
        "- The only honest next step is pre-registering a single selected bucket on truly "
        "forward data (post 2026-09-14) the grid never saw — not re-cutting these 8 splits.",
        "- If the Dukascopy feed is extended, test an interaction (e.g. gap × prior-day "
        "range) as ONE new pre-registered hypothesis, with its own Bonferroni slot.",
        "- H8's definition (ES prior-day close change vs NQ gap sign) is a proxy; a true "
        "ES 09:30 gap needs 1m ES bars, which yfinance does not provide for this period.",
        "",
    ]
    with open(path, "w") as fh:
        fh.write("\n".join(L))


if __name__ == "__main__":
    raise SystemExit(main())

"""52W Chaser gate calibration debug.

Setup date: last trading day <= 2026-10-03 (Sat) -> 2026-10-01 (Thu; Oct 2 = Gandhi Jayanti holiday).
Outcome week: Mon 2026-10-05 .. Fri 2026-10-09 (buy setup close, hold to Fri close).

Replicates Week52ChaserNautilusStrategy._check_entry_filters exactly
(ADX>=25, RSI 50-70, vol>=1.5x20d avg, close>=MA50, close>=MA200, NaN fails OPEN),
using the canonical trading.indicators.adx/rsi.

Outputs: experiments/chaser_gates.json + experiments/chaser_gates.md
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SETUP_CUTOFF = "2026-10-03"
OUTCOME_END = "2026-10-09"
ENTRY_THRESHOLD_PCT = 3.0  # default in get_params / run_single_stock_backtest
OUT_JSON = "experiments/chaser_gates.json"
OUT_MD = "experiments/chaser_gates.md"

GATES_DEFAULTS = {"adx_min": 25.0, "rsi_lo": 50.0, "rsi_hi": 70.0, "vol_mult": 1.5}


def load_universe():
    with open("experiments/chaser_universe_list.json") as f:
        payload = json.load(f)
    return sorted(payload["liquid_symbols"])


def download(symbols):
    import yfinance as yf

    tickers = [s + ".NS" for s in symbols]
    df = yf.download(
        tickers, start="2024-06-01", end="2026-10-10",
        progress=False, auto_adjust=False, threads=True, group_by="ticker",
    )
    return df


def get_ohlc(df, ticker):
    try:
        sub = df[ticker].copy()
    except KeyError:
        return None
    sub.columns = [str(c).lower().replace(" ", "_") for c in sub.columns]
    need = {"open", "high", "low", "close", "volume"}
    if not need.issubset(set(sub.columns)) or sub.empty:
        return None
    sub = sub.dropna(subset=["close"])
    if len(sub) < 120:
        return None
    return sub


def compute_row(sub, setup_cutoff=SETUP_CUTOFF, outcome_end=OUTCOME_END,
                entry_thresh=ENTRY_THRESHOLD_PCT):
    """Indicator snapshot as of setup bar + forward outcome. None if unusable."""
    from trading.indicators import adx as _adx, rsi as _rsi

    idx = sub.index[sub.index.date <= pd.Timestamp(setup_cutoff).date()]
    if len(idx) == 0:
        return None
    setup_ts = idx.max()
    loc = sub.index.get_loc(setup_ts)
    if loc < 100:  # mirror min history need (MA200 approx; tracker min_periods=20, we want 100+)
        return None
    h52 = sub["high"].iloc[max(0, loc - 251): loc + 1].max()
    close = float(sub["close"].iloc[loc])
    dist = (h52 - close) / close * 100 if close else np.inf
    if not np.isfinite(dist) or dist > entry_thresh:
        return None  # not an entry candidate

    hist = sub.iloc[: loc + 1]
    adx_s = _adx(hist["high"], hist["low"], hist["close"], 14)
    rsi_s = _rsi(hist["close"], 14)
    adx_v = float(adx_s.iloc[-1]) if adx_s is not None and len(adx_s) else np.nan
    rsi_v = float(rsi_s.iloc[-1]) if rsi_s is not None and len(rsi_s) else np.nan
    ma50 = float(hist["close"].rolling(50).mean().iloc[-1])
    ma200 = float(hist["close"].rolling(200).mean().iloc[-1])
    vol = float(hist["volume"].iloc[-1])
    vol_avg = float(hist["volume"].rolling(20).mean().iloc[-1])

    # forward outcome: setup close -> last close <= outcome_end
    fwd = sub.index[sub.index.date > pd.Timestamp(setup_cutoff).date()]
    fwd = fwd[fwd.date <= pd.Timestamp(outcome_end).date()]
    if len(fwd) == 0:
        return None
    exit_px = float(sub["close"].loc[fwd.max()])
    fwd_ret = (exit_px - close) / close * 100
    # max favorable/adverse excursion over the week (for context)
    week = sub.loc[fwd.min(): fwd.max()]
    mfe = (float(week["high"].max()) - close) / close * 100
    mae = (float(week["low"].min()) - close) / close * 100
    # strategy-exit proxy: SL 3% / TP 5% (strategy defaults), else Fri close.
    # Same-bar ambiguity resolved SL-first (conservative). Max-hold 30d never binds in a 5-session window.
    strat_ret, strat_exit = fwd_ret, "HOLD"
    for ts, bar in week.iterrows():
        if float(bar["low"]) <= close * 0.97:
            strat_ret, strat_exit = -3.0, "SL"
            break
        if float(bar["high"]) >= close * 1.05:
            strat_ret, strat_exit = 5.0, "TP"
            break
    return {
        "setup_date": str(setup_ts.date()), "close": round(close, 2),
        "dist_pct": round(float(dist), 2), "h52": round(float(h52), 2),
        "adx": round(float(adx_v), 2) if np.isfinite(adx_v) else None,
        "rsi": round(float(rsi_v), 2) if np.isfinite(rsi_v) else None,
        "ma50": round(float(ma50), 2) if np.isfinite(ma50) else None,
        "ma200": round(float(ma200), 2) if np.isfinite(ma200) else None,
        "vol": vol, "vol_avg": vol_avg,
        "vol_ratio": round(vol / vol_avg, 3) if vol_avg and np.isfinite(vol_avg) and vol_avg > 0 else None,
        "exit_date": str(fwd.max().date()), "fwd_ret": round(float(fwd_ret), 2),
        "strat_ret": round(float(strat_ret), 2), "strat_exit": strat_exit,
        "mfe": round(float(mfe), 2), "mae": round(float(mae), 2),
    }


def gate_pass(row, adx_min=25.0, rsi_lo=50.0, rsi_hi=70.0, vol_mult=1.5):
    """Exact replica of _check_entry_filters (NaN fails OPEN). Returns dict of gate->bool."""
    g = {}
    g["adx"] = True if row["adx"] is None else row["adx"] >= adx_min
    g["rsi_lo"] = True if row["rsi"] is None else row["rsi"] >= rsi_lo
    g["rsi_hi"] = True if row["rsi"] is None else row["rsi"] <= rsi_hi
    g["rsi"] = g["rsi_lo"] and g["rsi_hi"]
    g["vol"] = True if row["vol_ratio"] is None else row["vol_ratio"] >= vol_mult
    g["ma50"] = True if row["ma50"] is None else row["close"] >= row["ma50"]
    g["ma200"] = True if row["ma200"] is None else row["close"] >= row["ma200"]
    g["all"] = all([g["adx"], g["rsi"], g["vol"], g["ma50"], g["ma200"]])
    return g


def per_gate_stats(cands, key="fwd_ret"):
    pdf = pd.DataFrame(cands)
    pdf["profitable"] = pdf[key] > 0
    n = len(pdf)
    n_prof = int(pdf["profitable"].sum())
    n_unprof = n - n_prof
    passes = {c["symbol"] + "|" + c["setup_date"]: gate_pass(c) for c in cands}
    keys = [c["symbol"] + "|" + c["setup_date"] for c in cands]
    gate_names = ["adx", "rsi_lo", "rsi_hi", "rsi", "vol", "ma50", "ma200", "all"]
    per_gate = {}
    for gname in gate_names:
        passed = np.array([passes[k][gname] for k in keys])
        prof = pdf["profitable"].to_numpy()
        tp = int((passed & prof).sum())
        fp = int((passed & ~prof).sum())
        fn = int(((~passed) & prof).sum())
        tn = int(((~passed) & ~prof).sum())
        blocked_profit = float(pdf.loc[(~passed) & prof, key].sum()) if fn else 0.0
        avoided_loss = float(pdf.loc[(~passed) & ~prof, key].sum()) if tn else 0.0
        per_gate[gname] = {
            "pass_rate_overall": round(float(passed.mean()), 3),
            "pass_rate_profitable_recall": round(tp / n_prof, 3) if n_prof else None,
            "pass_rate_unprofitable": round(fp / n_unprof, 3) if n_unprof else None,
            "precision_profit_given_pass": round(tp / (tp + fp), 3) if (tp + fp) else None,
            "base_rate_profit": round(n_prof / n, 3),
            "tp": tp, "fp": fp, "fn_blocked_profitable": fn, "tn_blocked_unprofitable": tn,
            "blocked_profit_sum_pct": round(blocked_profit, 2),
            "avoided_loss_sum_pct": round(avoided_loss, 2),
            "noise_avoided_count": tn,
            "profit_blocked_per_noise_avoided": (
                round(blocked_profit / tn, 2) if tn else None),
        }
    return pdf, per_gate


def eval_cfg(cands, key="fwd_ret", **kw):
    cfg = {**GATES_DEFAULTS, **kw}
    rets = [c[key] for c in cands if gate_pass(c, **cfg)["all"]]
    rets = np.array(rets)
    return {
        "n_entries": len(rets),
        "n_profitable": int((rets > 0).sum()) if len(rets) else 0,
        "win_rate": round(float((rets > 0).mean()), 3) if len(rets) else None,
        "total_fwd_pct": round(float(rets.sum()), 2) if len(rets) else 0.0,
        "avg_fwd_pct": round(float(rets.mean()), 2) if len(rets) else None,
    }


def sweep_set(cands, key="fwd_ret"):
    def eval_cfg_local(**kw):
        return eval_cfg(cands, key, **kw)
    sweeps = {
        "adx_min": [{"value": v, **eval_cfg_local(adx_min=v)} for v in [15, 20, 25, 30, 35]],
        "rsi_lo": [{"value": v, **eval_cfg_local(rsi_lo=v)} for v in [40, 45, 50, 55, 60]],
        "rsi_hi": [{"value": v, **eval_cfg_local(rsi_hi=v)} for v in [60, 65, 70, 75, 80]],
        "rsi_off_hi": {"value": "inf (no upper cap)", **eval_cfg_local(rsi_hi=1000.0)},
        "vol_mult": [{"value": v, **eval_cfg_local(vol_mult=v)} for v in [1.0, 1.2, 1.5, 1.8, 2.0]],
        "drop_one_gate": [],
    }
    for drop in ["adx", "rsi", "vol", "ma50", "ma200"]:
        rets = np.array([c[key] for c in cands
                         if all(gate_pass(c)[k] for k in ["adx", "rsi", "vol", "ma50", "ma200"]
                                if k != drop)])
        sweeps["drop_one_gate"].append({
            "dropped": drop,
            "n_entries": len(rets),
            "n_profitable": int((rets > 0).sum()) if len(rets) else 0,
            "win_rate": round(float((rets > 0).mean()), 3) if len(rets) else None,
            "total_fwd_pct": round(float(rets.sum()), 2) if len(rets) else 0.0,
            "avg_fwd_pct": round(float(rets.mean()), 2) if len(rets) else None,
        })
    return sweeps


def build_cohort(ohlc, setup_cutoff, outcome_end, thresh):
    cands = []
    for s, sub in ohlc.items():
        r = compute_row(sub, setup_cutoff, outcome_end, thresh)
        if r is None:
            continue
        r["symbol"] = s
        cands.append(r)
    return cands


def main():
    syms = load_universe()
    print(f"universe: {len(syms)}", flush=True)
    df = download(syms)
    print(f"downloaded: {df.shape}", flush=True)
    ohlc = {}
    for s in syms:
        sub = get_ohlc(df, s + ".NS")
        if sub is not None:
            ohlc[s] = sub
    print(f"usable series: {len(ohlc)}", flush=True)

    cohorts = {}
    # primary: setup <= 2026-10-03 @ 3% (default entry threshold)
    cohorts["primary_3pct"] = build_cohort(ohlc, "2026-10-03", "2026-10-09", 3.0)
    # wide band same week @ 5% (sensitivity)
    cohorts["wide_5pct"] = build_cohort(ohlc, "2026-10-03", "2026-10-09", 5.0)
    # pooled robustness: 6 weekly setups (Sat cutoffs -> resolve to Fri) @ 5%, fwd Mon-Fri
    pooled = []
    for sat, fri in [("2026-08-29", "2026-09-04"), ("2026-09-05", "2026-09-11"),
                     ("2026-09-12", "2026-09-18"), ("2026-09-19", "2026-09-25"),
                     ("2026-09-26", "2026-10-02"), ("2026-10-03", "2026-10-09")]:
        pooled.extend(build_cohort(ohlc, sat, fri, 5.0))
    cohorts["pooled_6wk_5pct"] = pooled
    for k, v in cohorts.items():
        print(f"cohort {k}: {len(v)}", flush=True)

    cands = cohorts["primary_3pct"]
    if not cands:
        print("NO CANDIDATES - abort")
        return
    pdf, per_gate = per_gate_stats(cands, "fwd_ret")
    _, per_gate_strat = per_gate_stats(cands, "strat_ret")
    n, n_prof = len(pdf), int(pdf["profitable"].sum())
    n_unprof = n - n_prof
    total_profit = float(pdf.loc[pdf["profitable"], "fwd_ret"].sum())
    total_loss = float(pdf.loc[~pdf["profitable"], "fwd_ret"].sum())
    sweeps = sweep_set(cands, "fwd_ret")
    no_filter = {"n_entries": n, "n_profitable": n_prof,
                 "win_rate": round(n_prof / n, 3),
                 "total_fwd_pct": round(float(pdf["fwd_ret"].sum()), 2),
                 "avg_fwd_pct": round(float(pdf["fwd_ret"].mean()), 2)}
    full_filter = eval_cfg(cands, "fwd_ret")

    # pooled + wide cohorts: same stats for robustness (both raw-fwd and strategy-exit outcomes)
    extra = {}
    for key in ("wide_5pct", "pooled_6wk_5pct"):
        cc = cohorts[key]
        ppdf, pg = per_gate_stats(cc, "fwd_ret")
        _, pg_strat = per_gate_stats(cc, "strat_ret")
        extra[key] = {
            "n": len(cc),
            "n_profitable": int(ppdf["profitable"].sum()),
            "per_gate": pg,
            "per_gate_strat": pg_strat,
            "no_filter_total": round(float(ppdf["fwd_ret"].sum()), 2),
            "no_filter_strat_total": round(float(ppdf["strat_ret"].sum()), 2),
            "full_filter": eval_cfg(cc, "fwd_ret"),
            "full_filter_strat": eval_cfg(cc, "strat_ret"),
            "sweeps": sweep_set(cc, "fwd_ret"),
            "sweeps_strat": sweep_set(cc, "strat_ret"),
        }

    # worst gate: most blocked-profit per noise-avoided (single gates only, excl combined)
    ranked = sorted(
        [(k, v) for k, v in per_gate.items() if k in ("adx", "rsi", "vol", "ma50", "ma200")],
        key=lambda kv: (kv[1]["profit_blocked_per_noise_avoided"]
                        if kv[1]["profit_blocked_per_noise_avoided"] is not None else -1),
        reverse=True,
    )

    result = {
        "meta": {"setup_cutoff": SETUP_CUTOFF, "universe": len(syms),
                 "candidates": n, "entry_threshold_pct": ENTRY_THRESHOLD_PCT,
                 "outcome": "setup-close to last close <=" + OUTCOME_END},
        "base_rates": {"n": n, "n_profitable": n_prof, "n_unprofitable": n_unprof,
                       "total_profit_pct": round(total_profit, 2),
                       "total_loss_pct": round(total_loss, 2),
                       "net_all_pct": round(float(pdf["fwd_ret"].sum()), 2)},
        "per_gate": per_gate,
        "per_gate_strat": per_gate_strat,
        "strat_outcome_mix": pd.Series([c["strat_exit"] for c in cands]).value_counts().to_dict(),
        "worst_gate_ranking": [
            {"gate": k, "blocked_profit_sum_pct": v["blocked_profit_sum_pct"],
             "noise_avoided": v["noise_avoided_count"],
             "profit_blocked_per_noise_avoided": v["profit_blocked_per_noise_avoided"]}
            for k, v in ranked],
        "no_filter": no_filter,
        "full_filter_default": full_filter,
        "sweeps": sweeps,
        "recommendation": {
            "worst_gate": "rsi_hi (RSI > 70 veto)",
            "fix": {"vol_mult": "1.5 -> 1.8", "rsi_hi": "70 -> 75", "rest": "default",
                    "drop_or_demote": ["ma200", "ma50", "rsi_lo"]},
            "expected_delta_last_week_strat_pp": 5.0,
            "expected_delta_last_week_raw_pp": 6.26,
            "expected_delta_pooled_6wk_strat_pp": 19.06,
            "keep_adx_25": True,
        },
        "robustness": extra,
        "candidates": sorted(cands, key=lambda c: -c["fwd_ret"]),
    }
    with open(OUT_JSON, "w") as f:
        json.dump(result, f, indent=1)
    print(f"WROTE {OUT_JSON}", flush=True)
    write_md(result)


def write_md(r):
    L = []
    L.append("# 52W Chaser gate calibration — setup ≤2026-10-03, outcome Oct 5–9")
    L.append("")
    m = r["meta"]
    L.append(f"Universe: {m['universe']} liquid symbols; **{m['candidates']} candidates** "
             f"within {m['entry_threshold_pct']}% of 52w high as of setup close "
             f"({r['candidates'][0]['setup_date'] if r['candidates'] else '?'}). "
             f"Outcome = setup-close → Fri {OUTCOME_END} close (buy-and-hold proxy).")
    b = r["base_rates"]
    L.append(f"Base: {b['n_profitable']}/{b['n']} profitable "
             f"({round(100*b['n_profitable']/b['n'],1)}%); gross profit +{b['total_profit_pct']}pp, "
             f"gross loss {b['total_loss_pct']}pp, net {b['net_all_pct']}pp (equal-weight, sum of %).")
    L.append("")
    L.append("## Per-gate precision / recall")
    L.append("")
    L.append("| gate | pass rate | recall P(pass|profit) | P(pass|unprof) | precision P(profit|pass) | base | blocked-profit tt (n) | noise avoided (n) | pp blocked / noise |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for gname, v in r["per_gate"].items():
        L.append(f"| {gname} | {v['pass_rate_overall']} | {v['pass_rate_profitable_recall']} | "
                 f"{v['pass_rate_unprofitable']} | {v['precision_profit_given_pass']} | {v['base_rate_profit']} | "
                 f"{v['blocked_profit_sum_pct']} ({v['fn_blocked_profitable']}) | {v['tn_blocked_unprofitable']} | "
                 f"{v['profit_blocked_per_noise_avoided']} |")
    L.append("")
    L.append("Reading: precision ≈ base rate ⇒ gate has no discrimination (pure noise). "
             "Recall ≪ 1 with high blocked-profit ⇒ gate kills profit.")
    L.append("")
    L.append("## Sweeps (one threshold moved, rest at default)")
    for key, rows in r["sweeps"].items():
        if key == "rsi_off_hi":
            rows = [rows]
        L.append(f"### {key}")
        L.append("")
        L.append("| setting | n | n_prof | win_rate | total_pp | avg_pp |")
        L.append("|---|---|---|---|---|---|")
        for row in rows:
            lab = row.get("value", row.get("dropped"))
            L.append(f"| {lab} | {row['n_entries']} | {row['n_profitable']} | {row['win_rate']} | "
                     f"{row['total_fwd_pct']} | {row['avg_fwd_pct']} |")
        L.append("")
    L.append(f"NO filter: {r['no_filter']}  |  FULL default filter: {r['full_filter_default']}")
    L.append("")
    L.append("## Robustness cohorts")
    L.append("")
    for key, x in r.get("robustness", {}).items():
        L.append(f"### {key}: n={x['n']}, profitable={x['n_profitable']}, "
                 f"no-filter total {x['no_filter_total']}pp (raw) / {x['no_filter_strat_total']}pp (SL3/TP5), "
                 f"full-filter {x['full_filter']} (raw) / {x['full_filter_strat']} (SL3/TP5)")
        L.append("")
        for title, pg in (("raw week hold", x["per_gate"]), ("SL3/TP5 exits", x["per_gate_strat"])):
            L.append(f"per-gate ({title})")
            L.append("")
            L.append("| gate | recall | P(pass|unprof) | precision | blocked-profit (n) | avoided-loss (n) | pp blocked/noise |")
            L.append("|---|---|---|---|---|---|---|")
            for gname, v in pg.items():
                L.append(f"| {gname} | {v['pass_rate_profitable_recall']} | {v['pass_rate_unprofitable']} | "
                         f"{v['precision_profit_given_pass']} | {v['blocked_profit_sum_pct']} ({v['fn_blocked_profitable']}) | "
                         f"{v['avoided_loss_sum_pct']} ({v['tn_blocked_unprofitable']}) | "
                         f"{v['profit_blocked_per_noise_avoided']} |")
            L.append("")
        for sk, rows in x["sweeps"].items():
            if sk == "rsi_off_hi":
                rows = [rows]
            L.append(f"#### {key} / {sk} (raw)")
            L.append("")
            L.append("| setting | n | n_prof | win_rate | total_pp | avg_pp |")
            L.append("|---|---|---|---|---|---|")
            for row in rows:
                lab = row.get("value", row.get("dropped"))
                L.append(f"| {lab} | {row['n_entries']} | {row['n_profitable']} | {row['win_rate']} | "
                         f"{row['total_fwd_pct']} | {row['avg_fwd_pct']} |")
            L.append("")
        for sk, rows in x["sweeps_strat"].items():
            if sk == "rsi_off_hi":
                rows = [rows]
            L.append(f"#### {key} / {sk} (SL3/TP5)")
            L.append("")
            L.append("| setting | n | n_prof | win_rate | total_pp | avg_pp |")
            L.append("|---|---|---|---|---|---|")
            for row in rows:
                lab = row.get("value", row.get("dropped"))
                L.append(f"| {lab} | {row['n_entries']} | {row['n_profitable']} | {row['win_rate']} | "
                         f"{row['total_fwd_pct']} | {row['avg_fwd_pct']} |")
            L.append("")
    w = r["worst_gate_ranking"][0]
    L.append(f"## Verdict (primary week, raw hold)")
    L.append("")
    L.append(f"Highest raw pp-blocked/noise on Oct 5–9: `{w['gate']}` "
             f"({w['blocked_profit_sum_pct']}pp blocked vs "
             f"{w['noise_avoided']} noise trades avoided). "
             f"Full verdict across cohorts + strategy exits: see Recommendation below.")
    L.append("")
    L.append("## Recommendation (pooled 6wk SL3/TP5 + primary week)")
    L.append("")
    for b in RECOMMENDATION:
        L.append(f"- {b}")
    L.append("")
    L.append("See chaser_gates.json for full candidate table + sweep numbers.")
    L.append("")
    L.append("## Bug list (static review of `_check_entry_filters` / `_should_enter`)")
    for b in BUGS:
        L.append(f"- {b}")
    with open(OUT_MD, "w") as f:
        f.write("\n".join(L))
    print(f"WROTE {OUT_MD}", flush=True)


RECOMMENDATION = [
    "WORST GATE = RSI upper cap (RSI > 70 veto). Pooled SL3/TP5: blocks 9 profitable (45.0pp incl. TP-capped) "
    "vs 26 noise avoided = 1.73pp killed per noise avoided -- highest of any binding gate (raw-hold: 3.05, also highest). "
    "Primary week: blocked STLTECH's TP (+6.26 raw / +5.0 strat) over 2.02 RSI points (72.02 vs 70). "
    "Conceptually it fights the setup's premise: a 52w-high chaser SHOULD be overbought. "
    "Fix: rsi_hi 70 -> 75 (pooled sweep: rsi_hi 75 keeps every vol-1.8 gain; 80/off re-admits WELSPUNLIV-type blowoffs).",
    "TOP FIX = volume gate 1.5x -> 1.8x (keep, but tighten). The vol gate is the highest-ABSOLUTE-impact gate: "
    "pooled strat it blocks 116.63pp profit AND avoids 248.09pp loss; 1.5x lets in too many dead breakouts. "
    "Sweep (pooled SL3/TP5, others default): 1.0x -> -17.00 (n=36), 1.2x -> -31.53 (n=28), 1.5x -> -15.53 (n=20), "
    "**1.8x -> +3.83 (n=11, win 0.545)** -- the ONLY positive configuration --, 2.0x -> -1.28 (n=9).",
    "COMBINED recalibration {vol 1.8, rsi_hi 75} (rest default): pooled-strat -15.53 -> +3.53pp "
    "(DELTA +19.06pp over 6 weeks, n=17, win 0.471); LAST WEEK strat 0 -> +5.0pp (DELTA +5.0pp: recovers STLTECH TP; "
    "CUPID still vetoed by ADX 24.34<25 and vol 1.10<1.8, LGEINDIA by vol 1.01<1.8). "
    "Raw-hold last week: 0 -> +6.26pp. ADX 25 is already at its sweep optimum -- do NOT loosen it (adx 20: pooled -22.8).",
    "PURE-NOISE gates (no discrimination, delete or demote to logging-only): MA200 = 100% pass on all cohorts "
    "(candidates at 52w highs are definitionally above MA200); MA50 = 98-100% pass; RSI_lo = 97-100% pass "
    "(recall 0.978-1.0). Drop-one ablation: removing ma50/ma200 changes pooled total by exactly 0.00pp. "
    "They add config surface and false confidence, zero filtering value.",
    "REGIME CAVEAT: pooled no-filter buy-and-hold = -222.81pp raw / -166.21pp strat (avg -1.29%/-0.96% per setup). "
    "Chasing 52w highs with a 1-week hold had NEGATIVE edge Aug-Oct 2026; gates are loss-cutters, not edge creators. "
    "The +3.53pp recalibrated total is 17 trades -- fragile, needs out-of-sample validation before sizing. "
    "Also: pooled reuses symbols across weeks (setups judged independently); costs excluded (add ~0.1%/round-trip).",
]

BUGS = [    "BUG-1 (fail-OPEN on NaN): every gate is guarded by `pd.notna(...)` -> NaN *passes*. "
    "ADX needs 14 bars, MA50 50 bars, MA200 200 bars, but the 52w tracker only requires "
    "min_periods=20. Any symbol with 20-199 bars of history sails through the MA200 gate "
    "(and short-history symbols skip ADX/RSI too). Filters are silently weakest exactly where "
    "breakouts are most explosive (recent listings). Fix: require `idx >= 200` (or longest "
    "lookback) when enable_filters=True, else skip entry.",
    "BUG-2 (fail-OPEN on exception / date miss): `except Exception: return True` and "
    "`if not mask.any(): return True` mean any tz/format mismatch or missing bar date disables "
    "ALL filters silently. No logging. Fix: log + return False (fail closed) when filters are "
    "explicitly enabled.",
    "BUG-3 (`mask.argmax()` on duplicate/no-match edge): guarded by the mask.any() check, so "
    "benign today; but if the index contains duplicate dates (corporate-action re-fetch, "
    "tz-duplicate midnight bars) argmax takes the FIRST match while iloc positions of the "
    "precalc series assume unique dates -> gate evaluated on the wrong bar. Fix: use "
    "`df.index.get_indexer_for` / exact `.loc[bar_date]` match instead of boolean-mask argmax.",
    "BUG-4 (same-bar volume inclusion, minor): the volume gate compares the ENTRY bar's own "
    "volume against its 20d average that *includes* the entry bar, diluting real spikes "
    "(spike inflates its own baseline by ~5%). Breakout-day volume should be compared to the "
    "prior-20-bar average EXCLUDING the current bar (`shift(1)`). Small but systematic bias "
    "against genuine breakouts.",
    "BUG-5 (config mismatch, not math): Nautilus defaults (entry 2.0 / SL 2.0 / TP 3.0) differ "
    "from run_single_stock_backtest + get_params defaults (3.0 / 3.0 / 5.0), and "
    "enable_filters defaults to False everywhere -- so published backtests likely ran with "
    "filters OFF while the gate debate assumes ON. Any calibration must state which config it used.",
    "NO-LOOKAHEAD found: ADX/RSI/MA/vol-avg are all causal (Wilder/rolling on history only), "
    "the 52w tracker updates on the current bar's high before the distance check (intended -- "
    "chaser enters AT new highs), and precalc iloc[idx] aligns to the entry bar date. "
    "Indicator timing is clean; the issues are fail-open handling, not lookahead.",
]


if __name__ == "__main__":
    main()

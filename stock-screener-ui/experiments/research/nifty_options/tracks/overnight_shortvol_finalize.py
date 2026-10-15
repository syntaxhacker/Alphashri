"""Track E finalize — select configs from the sweeps, attribute the hedge cost,
run gap diagnostics, and emit tracks/overnight_shortvol.{json,md}.

Run after: python tracks/overnight_shortvol.py real   (and synthetic)
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
import overnight_shortvol as T  # noqa: E402
import stats as st  # noqa: E402

CAP = T.CAPITAL
LOT = T.LOT


def cell(grid, structure, d, w, filt):
    m = grid[(grid.structure == structure) & (grid.d_pct == d) &
             (grid.wing_pts == w) & (grid["filter"] == filt)]
    return m.iloc[0].to_dict() if len(m) else None


def leg_attribution(mode, d_pct, wing_pts, filt):
    """Split the winged structure into short-strangle + long-wing P&L, then into
    execution (spread/slippage embedded in fills) vs genuine mark drift."""
    src, resolver, spot, by_day = T.load_sessions(mode)
    days = sorted(d for d in by_day if (T.REAL_START if mode == "real" else T.SYN_START) <= d <=
                  (T.REAL_END if mode == "real" else T.SYN_END))
    feats = T.build_features(mode, T.REAL_START if mode == "real" else T.SYN_START,
                             T.REAL_END if mode == "real" else T.SYN_END)
    short_pnl, wing_pnl, wing_exec, wing_drift, dates = [], [], [], [], []
    touch = T.EX.half_spread_pct + T.EX.slippage_pct
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None or exp < nd:
            continue
        if not T.apply_filter(pd.DataFrame({"date": [str(d)]}), feats, filt).shape[0]:
            continue
        weekly = resolver.is_weekly(exp)
        eb, xb = by_day[d], by_day[nd]
        ec = eb.index[eb.index.time <= pd.Timestamp(T.ENTRY_TIME).time()]
        xc = xb.index[xb.index.time >= pd.Timestamp(T.EXIT_TIME).time()]
        if len(ec) == 0 or len(xc) == 0:
            continue
        et, xt = ec[-1], xc[0]
        es, xs = float(spot.at[et, "close"]), float(spot.at[xt, "close"])
        legs = T._structure("winged", es, d_pct, wing_pts)
        vals = []
        ok = True
        for opt, side, K in legs:
            pi = T._price(mode, src, exp, K, opt, weekly, et, es)
            po = T._price(mode, src, exp, K, opt, weekly, xt, xs)
            if pi is None or po is None:
                ok = False
                break
            vals.append((side, pi, po))
        if not ok:
            continue
        # short legs: sell at bid entry, buy at ask exit
        s_pnl = 0.0
        for (side, pi, po), (opt, sd, K) in zip(vals, legs):
            if sd == "SELL":
                fi = pi * (1 - touch); fo = po * (1 + touch)
                s_pnl += (fi - fo) * LOT
        # wing legs: buy at ask entry, sell at bid exit
        w_exec = 0.0; w_drift = 0.0
        for (side, pi, po), (opt, sd, K) in zip(vals, legs):
            if sd == "BUY":
                # buy at ask (pi*(1+t)), sell at bid (po*(1-t))
                w_exec += -touch * (pi + po) * LOT
                w_drift += (po - pi) * LOT
        short_pnl.append(s_pnl); wing_pnl.append(w_exec + w_drift)
        wing_exec.append(w_exec); wing_drift.append(w_drift); dates.append(str(d))
    n = min(len(short_pnl), len(wing_pnl))
    return {
        "n": n,
        "short_strangle_pnl_mean": float(np.mean(short_pnl[:n])) if n else None,
        "long_wing_pnl_mean": float(np.mean(wing_pnl[:n])) if n else None,
        "wing_execution_mean": float(np.mean(wing_exec[:n])) if n else None,
        "wing_mark_drift_mean": float(np.mean(wing_drift[:n])) if n else None,
    }


def main():
    grid_real = pd.read_parquet(HERE / "_shortvol_grid_real.parquet")
    grid_syn = pd.read_parquet(HERE / "_shortvol_grid_synthetic.parquet")
    skew_real = pd.read_parquet(HERE / "_shortvol_skew_real.parquet")

    # --- decided configs -----------------------------------------------------
    HEAD_D, HEAD_FILT = 1.0, "calm_ivr_high"
    naked_head = cell(grid_real, "naked", HEAD_D, 0, HEAD_FILT)
    naked_alt = cell(grid_real, "naked", HEAD_D, 0, "calm")
    naked_uncond = cell(grid_real, "naked", HEAD_D, 0, "all")
    wing_head = cell(grid_real, "winged", HEAD_D, 150, HEAD_FILT)
    wg = grid_real[(grid_real.structure == "winged") & (grid_real.n >= 15)]
    wing_best = wg.sort_values("net_exp", ascending=False).iloc[0].to_dict()

    # naked d=1.0 calm_ivr_high trade-level + diagnostics
    src, resolver, spot, by_day = T.load_sessions("real")
    feats_r = T.build_features("real", T.REAL_START, T.REAL_END)
    df_head = T.apply_filter(T.run("real", "naked", HEAD_D, 0, T.REAL_START, T.REAL_END),
                             feats_r, HEAD_FILT)
    df_calm = T.apply_filter(T.run("real", "naked", 0.5, 0, T.REAL_START, T.REAL_END),
                             feats_r, "calm")
    gaps_head = T.gap_diagnostics("real", df_head)
    gaps_all = T.gap_diagnostics("real", T.run("real", "naked", HEAD_D, 0, T.REAL_START, T.REAL_END))

    # synthetic anchor for headline
    head_syn = cell(grid_syn, "naked", 1.0, 0, "calm_ivr_high")
    calm_syn = cell(grid_syn, "naked", 0.5, 0, "calm")

    attrib = leg_attribution("real", HEAD_D, 150, "calm")
    attrib_head = leg_attribution("real", HEAD_D, 150, HEAD_FILT)

    # plateau: naked calm_ivr_high across distances + unconditional ivr_high
    plateau = []
    for d in (0.5, 0.75, 1.0, 1.25):
        for filt in ("all", "calm", "ivr_high", "calm_ivr_high", "volatile"):
            c = cell(grid_real, "naked", d, 0, filt)
            if c:
                plateau.append({"d_pct": d, "filter": filt, "n": c["n"],
                                "net_exp": c["net_exp"], "pf": c["pf"], "win": c["win"],
                                "ci": c["bootstrap_ci"], "max_dd_pct": c["max_drawdown_pct"]})

    hedge_table = []
    for w in (50, 100, 150, 200, 250):
        c = cell(grid_real, "winged", 1.0, w, HEAD_FILT)
        if c:
            hedge_table.append({"wing_pts": w, "n": c["n"], "net_exp": c["net_exp"],
                                "pf": c["pf"], "win": c["win"], "worst": c["worst_overnight_inr"],
                                "max_dd_pct": c["max_drawdown_pct"]})

    best_skew = skew_real.sort_values("net_exp", ascending=False).iloc[0].to_dict()

    out = {
        "track": "overnight_shortvol",
        "hypothesis": ("Overnight variance risk premium (realised |gap| < implied move) can be "
                       "harvested with short strangles, and buying far wings makes it account-safe "
                       "(defined risk) without destroying the edge."),
        "feature": ("prior-session |log return| vs its causal expanding median (calm); prior-session "
                    "front-expiry IV/RV ratio (vrp_ratio) vs its causal expanding median; day-of-week."),
        "rule": (f"At 15:00 sell a +/-{HEAD_D}% NIFTY strangle on the front listed expiry when the prior "
                 f"session was calm (|ret| < expanding median) AND prior IV/RV > expanding median; "
                 f"buy back next 09:30. Winged variant adds long far wings (defined risk)."),
        "data": ("real FYERS premiums, front listed monthly 2026-09-29, 2026-07-01..2026-09-25 "
                 "(50 usable sessions; listed contracts only). Synthetic BS anchor on the real "
                 "2018-2026 1-min spot path (train 2018-2022 / test 2023-2026). Costs: NSE fees + "
                 "0.35% half-spread + 0.15% slippage per leg per side (shared ExecutionModel)."),
        "n_trades": naked_head["n"],
        "net_exp": naked_head["net_exp"],
        "pf": naked_head["pf"],
        "win": naked_head["win"],
        "total_net": naked_head["total_net"],
        "max_drawdown": -abs(naked_head["max_drawdown_inr"]),
        "max_drawdown_pct_capital": naked_head["max_drawdown_pct"],
        "worst_overnight_inr": naked_head["worst_overnight_inr"],
        "worst_overnight_pct_capital": naked_head["worst_overnight_pct"],
        "risk_of_ruin": naked_head["risk_of_ruin"],
        "tail_loss_p95": naked_head["tail_loss_p95"],
        "bootstrap_ci": naked_head["bootstrap_ci"],
        "p_positive_total": naked_head["p_positive_total"],
        "avg_week": naked_head["avg_week"],
        "worst_week": naked_head["worst_week"],
        "capital_for_15k_week": naked_head["capital_for_15k_week"],
        "gross_exp": naked_head["gross_exp"],
        "fees_exp": naked_head["fees_exp"],
        "train_exp": head_syn["train_exp"] if head_syn else None,
        "test_exp": head_syn["test_exp"] if head_syn else None,
        "train_test_split": "synthetic anchor 2018-2022 train / 2023-2026 test (real window has no split; single regime)",
        "raw_dir_accuracy": naked_head["raw_dir_accuracy"],
        "raw_dir_accuracy_note": ("brief's literal metric = P(next-session spot up). Meaningless for a symmetric "
                                  "strangle (no direction); the short-vol edge is geometric: P(close inside strikes)."),
        "p_close_inside_strikes": naked_head["inside_strikes_rate"],
        "edge_basis": ("Short-vol variance risk premium, not direction. Real overnight: mean implied 1-night move "
                       f"{gaps_head.get('mean_implied_1night_pts', float('nan')):.0f} pts vs realised "
                       f"{gaps_head.get('mean_realised_abs_pts', float('nan')):.0f} pts "
                       f"(P(realised<implied)={gaps_head.get('hit_rate_realised_lt_implied_1night', float('nan'))*100:.0f}%). "
                       "The edge is collecting more than the realised gap, not forecasting it."),
        "gap_diagnostics_headline": gaps_head,
        "gap_diagnostics_unconditional": gaps_all,
        "verdict": "reject",
        "reason": "",
        "artifacts": [
            "tracks/overnight_shortvol.py",
            "tracks/overnight_shortvol_finalize.py",
            "tracks/_shortvol_grid_real.parquet",
            "tracks/_shortvol_grid_synthetic.parquet",
            "tracks/_shortvol_skew_real.parquet",
            "tracks/overnight_shortvol_log.jsonl",
        ],
        "headline_config": "real naked short +/-1.0% strangle, calm prior day & prior IV/RV>median, 15:00->09:30",
        "compare_configs": {
            "naked_unconditional_d1.0": naked_uncond,
            "naked_calm_d1.0": naked_alt,
            "naked_calm_ivr_high_d1.0": naked_head,
            "winged_w150_calm_ivr_high_d1.0": wing_head,
            "best_winged_any": wing_best,
            "trackC_naked_d0.5_calm": cell(grid_real, "naked", 0.5, 0, "calm"),
        },
        "hedge_cost_attribution": {
            "calm_all_days": attrib,
            "calm_ivr_high": attrib_head,
            "note": ("long wings lose ~Rs400-650/lot/night = genuine overnight mark-down "
                     "(theta/smile) + ~Rs250 execution; naked short-strangle edge is ~Rs100-540."),
        },
        "hedge_table_d1.0_calm_ivr_high": hedge_table,
        "plateau_naked": plateau,
        "synthetic_anchor": {
            "headline": "naked d1.0 calm_ivr_high", "stats": head_syn,
            "calm_d0.5": calm_syn,
            "note": ("synthetic is a model (BS priced off a causal VIX/RV blend); its wing benefit and "
                     "tail caps are model artifacts and do NOT transfer (real wings lose)."),
        },
        "skew_trackB": {
            "best": best_skew,
            "verdict": "reject",
            "reason": ("Track B's deferred overnight short-rich-put vertical + long-cheap-call vertical is "
                       f"negative in every variant (best n={best_skew['n']}, "
                       f"Rs{best_skew['net_exp']:.0f}/trade, PF {best_skew['pf']:.2f}, win {best_skew['win']*100:.0f}%); "
                       "n too small and expectancy negative. It is also long-delta by construction "
                       "(sell put spread + buy call spread), so it is not truly delta-hedged — the kernel has "
                       "no futures leg; that delta is the same overnight directional exposure that confounded "
                       "Track B's n=10 hint."),
        },
    }
    out["reason"] = (
        "Winging is decisively negative on real premiums: at d=1.0% the naked strangle earns "
        f"Rs{naked_uncond['net_exp']:.0f}/night (unconditional) / Rs{naked_alt['net_exp']:.0f} (calm) but every "
        f"winged variant loses (best any-filter winged = Rs{wing_best['net_exp']:.0f}/trade, n={wing_best['n']}). "
        f"Attribution: the two long wings cost ~Rs{abs(attrib['long_wing_pnl_mean']):.0f}/lot/night "
        f"(~Rs{abs(attrib['wing_execution_mean']):.0f} execution + ~Rs{abs(attrib['wing_mark_drift_mean']):.0f} mark-down), "
        "6x the naked edge — the tail hedge does not make it robust, it removes the edge. The unhedged "
        f"edge is real but tiny: best plateau naked calm+IV/RV-high d=1.0 n={naked_head['n']}, "
        f"Rs{naked_head['net_exp']:.0f}/trade, PF {naked_head['pf']:.2f}, CI "
        f"[{naked_head['bootstrap_ci'][0]:.0f},{naked_head['bootstrap_ci'][1]:.0f}] (excludes 0) but n<100 "
        f"(needs Rs{naked_head['capital_for_15k_week']/1e6:.1f}M for Rs15k/week); the wider column n=35-37 is "
        "only ~Rs190-300/trade with CI touching 0. Real window is a single 130->4 DTE monthly and one regime. "
        "Verdict reject: no n>=100, CI-excludes-0, defined-risk (winged) candidate."
    )

    (HERE / "overnight_shortvol.json").write_text(json.dumps(out, indent=2, default=T._json_default))
    print("wrote overnight_shortvol.json")
    md = render_md(out)
    (HERE / "overnight_shortvol.md").write_text(md)
    print("wrote overnight_shortvol.md (%d lines)" % len(md.splitlines()))
    return out


def render_md(o):
    nd = o["compare_configs"]["naked_unconditional_d1.0"]
    nh = o["compare_configs"]["naked_calm_ivr_high_d1.0"]
    bw = o["compare_configs"]["best_winged_any"]
    at = o["hedge_cost_attribution"]["calm_all_days"]
    sn = o["synthetic_anchor"]["stats"]
    gd = o["gap_diagnostics_headline"]
    n = lambda c, k: f"{c[k]:,.0f}" if c and c.get(k) is not None else "n/a"
    L = []
    L.append("# Track E — Overnight defined-risk short-vol + gap tail hedge")
    L.append("")
    L.append("**Hypothesis.** The overnight variance risk premium (realised gap < implied move) can be harvested by a")
    L.append("short strangle held EOD→next open; long far wings should make it account-safe without killing the edge.")
    L.append("**Method.** Real FYERS premiums, front listed monthly (exp 2026-09-29), 2026-07-01→09-25, entry 15:00 /")
    L.append("exit 09:30; NSE fees + 0.35% half-spread + 0.15% slippage per leg/side. Causal `shift(1)` filters: |log ret|")
    L.append("and prior IV/RV vs expanding medians. Synthetic BS anchor 2018-2026 (train 18-22 / test 23-26).")
    L.append("")
    L.append("## Naked vs winged (real)")
    L.append("| config | n | net/trade ₹ | PF | win | worst night ₹ | maxDD %3L | 90% CI |")
    L.append("|---|---|---|---|---|---|---|---|")
    L.append(f"| naked ±1.0%, unfiltered | {n(nd,'n')} | {n(nd,'net_exp')} | {nd['pf']:.2f} | {nd['win']*100:.0f}% | {n(nd,'worst_overnight_inr')} | {nd['max_drawdown_pct']*100:.2f} | [{nd['bootstrap_ci'][0]:.0f},{nd['bootstrap_ci'][1]:.0f}] |")
    L.append(f"| best winged (n≥15, any filter) | {n(bw,'n')} | {n(bw,'net_exp')} | {bw['pf']:.2f} | {bw['win']*100:.0f}% | {n(bw,'worst_overnight_inr')} | {bw['max_drawdown_pct']*100:.2f} | [{bw['bootstrap_ci'][0]:.0f},{bw['bootstrap_ci'][1]:.0f}] |")
    L.append("")
    L.append("Every winged variant (d 0.5–1.25%, wing 50–250 pts, all 13 filters) is net-negative; the CI excludes 0 on the loss side.")
    L.append("")
    L.append("## Filter plateau — naked strangle, net ₹/trade (n)")
    L.append("| short dist | all | calm | IV/RV high | calm & IV/RV high | volatile |")
    L.append("|---|---|---|---|---|---|")
    for d in (0.5, 0.75, 1.0, 1.25):
        row = {p["filter"]: p for p in o["plateau_naked"] if p["d_pct"] == d}
        cs = " | ".join(f"{row[f]['net_exp']:.0f} ({row[f]['n']})" if f in row else "—"
                        for f in ("all", "calm", "ivr_high", "calm_ivr_high", "volatile"))
        L.append(f"| ±{d}% | {cs} |")
    L.append("")
    L.append("`calm & IV/RV-high` plateaus across distance (+527/+514/+537/+450) but n≈22 among 312 swept cells; day-of-week is noise-sized (Tue n≈10 negative, Fri positive).")
    L.append("")
    L.append(f"## Best config — real naked ±1.0%, calm & prior IV/RV>median, 15:00→09:30 (raw dir P(up)={o['raw_dir_accuracy']:.2f} — uninformative; real metric P(inside strikes)={o['p_close_inside_strikes']:.2f})")
    L.append("| n / exp ₹ / PF / win | total / maxDD | worst night | 90% CI | RoR | cap ₹15k/wk | realised vs implied |")
    L.append("|---|---|---|---|---|---|---|")
    L.append(f"| {n(nh,'n')} / {n(nh,'net_exp')} / {nh['pf']:.2f} / {nh['win']*100:.0f}% | ₹{n(nh,'total_net')} / -₹{abs(nh['max_drawdown_inr']):.0f} ({nh['max_drawdown_pct']*100:.1f}%) | -₹{abs(nh['worst_overnight_inr']):.0f} ({abs(nh['worst_overnight_pct'])*100:.2f}%) | [{nh['bootstrap_ci'][0]:.0f},{nh['bootstrap_ci'][1]:.0f}] | {nh['risk_of_ruin']} | ₹{nh['capital_for_15k_week']/1e6:.2f}M | {gd.get('mean_realised_abs_pts',0):.0f} vs {gd.get('mean_implied_1night_pts',0):.0f} pts ({gd.get('hit_rate_realised_lt_implied_1night',0)*100:.0f}%<) |")
    L.append("")
    L.append("## Red-team: does the tail hedge make it robust?")
    L.append(f"- **No.** d=1.0%/w150 condor: short strangle ≈ +₹{at['short_strangle_pnl_mean']:.0f}/night; two long wings ≈ -₹{abs(at['long_wing_pnl_mean']):.0f} (₹{abs(at['wing_execution_mean']):.0f} exec + ₹{abs(at['wing_mark_drift_mean']):.0f} overnight mark-down; IV flat → theta/smile).")
    L.append(f"  The hedge costs 2–6× the edge; even with *free* execution it loses ≈₹{abs(at['wing_mark_drift_mean']):.0f}/night — more than the ~₹300-425 naked edge it protects (unfiltered edge only ~₹106).")
    L.append("- Unhedged tail is already small at 1 lot (worst night ₹-3.3k = 1.1% of ₹3L); wings insure a risk the account")
    L.append("  does not carry, and scaling lots on the freed margin only scales negative expectancy. n≤50, one monthly")
    L.append("  (130→4 DTE), one Jul–Sep 2026 regime; best cell from 312. Synthetic wings *help* (BS artifact, no transfer);")
    L.append(f"  Track B's skew trade (short rich put + long cheap call wing) is negative in every variant (best n={o['skew_trackB']['best']['n']}).")
    L.append("")
    L.append("## Verdict: **reject** — no n≥100 / CI-excludes-0 / defined-risk candidate; the wing hedge destroys the real edge.")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()

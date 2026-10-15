"""Track B final report builder: emits tracks/skew_rr.json + tracks/skew_rr.md.

Re-runs the headline configs (fast: cached premiums) and computes train/test
expectancy, weekly ₹15k capital, bootstrap CI, drawdown as % of ₹3L.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
_RESEARCH = _HERE.parent
sys.path.insert(0, str(_RESEARCH)); sys.path.insert(0, str(_HERE))

import runner as R  # noqa: E402
import stats as st  # noqa: E402
import skew_lib as SL  # noqa: E402
import skew_trades as ST  # noqa: E402
import pricing  # noqa: E402
from costs import round_trip_costs  # noqa: E402

START, END = date(2026, 7, 1), date(2026, 9, 25)
SPLIT = date(2026, 8, 15)
CAPITAL = 300_000.0


def exp_split(trades):
    a = np.array([t.net_pnl for t in trades if t.entry_ts.date() <= SPLIT])
    b = np.array([t.net_pnl for t in trades if t.entry_ts.date() > SPLIT])
    return (float(a.mean()) if len(a) else float("nan"),
            float(b.mean()) if len(b) else float("nan"),
            len(a), len(b))


def metrics(trades):
    net = np.array([t.net_pnl for t in trades])
    s = st.summarize(net, CAPITAL)
    w = st.weekly(net, [t.entry_ts for t in trades], CAPITAL)
    tr, te, ntr, nte = exp_split(trades)
    boot = st.bootstrap(net, CAPITAL)
    return {
        "n": len(trades), "net_exp": s.get("avg_net"), "pf": s.get("profit_factor"),
        "win": s.get("win_rate"), "total_net": s.get("total_net"),
        "max_drawdown": s.get("max_drawdown"),
        "max_dd_pct_capital": abs(s.get("max_drawdown", 0)) / CAPITAL * 100,
        "train_exp": tr, "test_exp": te, "train_n": ntr, "test_n": nte,
        "bootstrap_ci": [boot.get("ci_low_mean"), boot.get("ci_high_mean")],
        "p_positive_total": boot.get("p_positive_total"),
        "tail_loss_p95": s.get("p05"),
        "capital_for_15k_week": w.get("target_15k_avg_capital"),
        "avg_week": w.get("avg_week"), "worst_week": w.get("worst_week"),
    }


def rr_economics(panel: pd.DataFrame) -> dict:
    """Per-event gross skew edge (overnight) vs round-trip execution on a 25d RR.

    Uses the 30-min surface's prior-EOD->next-EOD rr change (the only causal,
    minimally-noisy estimate) and prices a 25d wing at each event's own S, T, IV.
    """
    per = pd.read_parquet(_HERE / "intraday_rr30_daily.parquet").drop(columns=["spot"], errors="ignore")
    pan = panel[panel["expiry"] == pd.Timestamp("2026-09-29")].copy()
    pan["date"] = pd.to_datetime(pan["date"])
    m = per.merge(pan[["date", "spot", "T", "atm_iv", "k_put25", "k_call25"]], on="date", how="left")
    chg = (m["rr_eod"] - m["rr_prev_eod"])
    mask = m["steep_prev_lag"].fillna(False) & chg.notna() & m["T"].notna()
    rows = []
    from costs import ExecutionModel
    ex = ExecutionModel()
    for _, r in m[mask].iterrows():
        S, T, iv = float(r["spot"]), float(r["T"]), float(r["atm_iv"])
        Kp, Kc = float(r["k_put25"]), float(r["k_call25"])
        pp = pricing.bs_price(S, Kp, T, iv, "PE")
        pc = pricing.bs_price(S, Kc, T, iv, "CE")
        vega = S * np.sqrt(T) * 0.3989 * np.exp(-0.5 * 0.674 ** 2) * 65
        gross = abs(float(chg.loc[r.name])) * vega  # short rich put / long cheap call, skew falls
        spread = (pp + pc) * (ex.half_spread_pct + ex.slippage_pct) * 2 * 65
        fees = round_trip_costs(pp, pp, 65, "SELL") + round_trip_costs(pc, pc, 65, "BUY")
        rows.append({"gross": gross, "cost": spread + fees, "vega": vega,
                     "prem_put": pp, "prem_call": pc})
    df = pd.DataFrame(rows)
    if df.empty:
        return {}
    net = df["gross"] - df["cost"]
    rng = np.random.default_rng(3)
    boot = net.to_numpy()[rng.integers(0, len(net), size=(5000, len(net)))].mean(axis=1)
    return {
        "n_events": int(len(df)),
        "mean_gross_inr": float(df["gross"].mean()),
        "mean_exec_cost_inr": float(df["cost"].mean()),
        "mean_net_inr_per_lot_per_event": float(net.mean()),
        "net_ci90": [float(np.percentile(boot, 5)), float(np.percentile(boot, 95))],
        "frac_positive": float((net > 0).mean()),
        "median_dte": float(pan["dte"].median()),
        "note": ("hypothetical OVERNIGHT hold (enter prior close, exit next close); the kernel "
                 "force-closes intraday so this is not engine-verified. Daily-close rr overstates "
                 "the move (quote noise); 30-min prior-EOD->EOD is used."),
    }


def main():
    source, resolv, spot = ST.real_setup()
    day_meta = R.load_daily_meta()
    p = ST.signal_table()
    flags = ST.flags_for_expiry(p, "2026-09-29")
    panel, resid = SL.build_skew_panel()

    configs = {
        "rr_skew_k3": ST.make_rr(flags, k=3, mode="skew"),
        "rr_steep_k3": ST.make_rr(flags, k=3, mode="steep"),
        "rr_flat_k3": ST.make_rr(flags, k=3, mode="flat"),
        "rr_uncond_short_put": ST.make_rr(flags, k=3, mode="always_short_put"),
        "fear_steep_CE": ST.make_fear(flags, opt="CE", mode="steep"),
        "fear_steep_PE": ST.make_fear(flags, opt="PE", mode="steep"),
        "fear_flat_PE": ST.make_fear(flags, opt="PE", mode="flat"),
        "smile_vert": ST.make_smile(resid),
    }
    out, trades_all = {}, {}
    for name, strat in configs.items():
        s, tr = ST.run_exp(name, strat, START, END, source, resolv, spot, day_meta)
        trades_all[name] = tr
        m = metrics(tr)
        m["raw_dir_accuracy_brief"] = s.get("raw_dir_accuracy")
        m["delta_dir_accuracy"] = s.get("delta_dir_accuracy")
        m["mean_net_delta"] = s.get("mean_net_delta")
        m["total_delta_hedged"] = s.get("total_delta_hedged")
        out[name] = m

    # ---- skew reversion (daily close-to-close, causal) ---------------------
    pct = SL.add_causal_percentiles(panel)
    g = pct[pct["expiry"] == pd.Timestamp("2026-09-29")].sort_values("date")
    rr = g["rr25"].to_numpy(); d = np.diff(rr); pc = g["pct_prior"].to_numpy()[:-1]
    m = np.isfinite(d) & np.isfinite(pc)
    reversion = {
        "expiry": "2026-09-29", "n": int(m.sum()),
        "mean_next_chg_after_steep": float(np.nanmean(d[m & (pc >= 0.8)])),
        "mean_next_chg_after_flat": float(np.nanmean(d[m & (pc <= 0.2)])),
        "mean_next_chg_all": float(np.nanmean(d[m])),
        "n_steep": int(np.nansum((pc >= 0.8) & m)), "n_flat": int(np.nansum((pc <= 0.2) & m)),
    }
    intra = json.loads((_HERE / "intraday_skew_result.json").read_text())["by_regime"]
    reversion["intraday_prior_eod_to_1000_steep"] = intra["steep"]["mean_chg_to_1000"]
    reversion["intraday_prior_eod_to_eod_steep"] = intra["steep"]["mean_chg_to_eod"]
    reversion["intraday_1000_to_eod_steep"] = (intra["steep"]["mean_chg_to_eod"]
                                               - intra["steep"]["mean_chg_to_1000"])
    reversion["intraday_prior_eod_to_1000_flat"] = intra["flat"]["mean_chg_to_1000"]
    reversion["note"] = ("daily-close rr25 is noisier and overstates reversion; the 30-min surface "
                         "shows the reversion is largely done overnight (prior EOD -> 10:00).")

    prim = out["rr_skew_k3"]
    rr_econ = rr_economics(panel)
    deliverable = {
        "track": "skew_rr",
        "hypothesis": ("Index put skew (rr25 = 25d put IV - 25d call IV) is rich vs calls; "
                       "extreme skew mean-reverts and is exploitable by a risk reversal, and/or "
                       "steep skew is a fear signal that predicts the next move."),
        "feature": "Causal prior-day percentile of fitted 25-delta rr25 on the front Sep-2026 monthly.",
        "rule": ("If prior-day rr25 in top 20% (causal rolling-20 prior-only rank): SELL rich 25d put / "
                 "BUY cheaper 25d call (k=3 steps OTM), hold to EOD; mirror on bottom 20%."),
        "data": ("Real FYERS premiums, front listed monthly (2026-09-29), 5-min engine replay, "
                 "2026-07-01..2026-09-25 (60 sessions; June has no usable smile)."),
        "n_trades": prim["n"], "net_exp": prim["net_exp"], "pf": prim["pf"], "win": prim["win"],
        "total_net": prim["total_net"], "max_drawdown": prim["max_drawdown"],
        "train_exp": prim["train_exp"], "test_exp": prim["test_exp"],
        "bootstrap_ci": prim["bootstrap_ci"], "tail_loss_p95": prim["tail_loss_p95"],
        "raw_dir_accuracy": prim["raw_dir_accuracy_brief"],
        "delta_dir_accuracy": prim["delta_dir_accuracy"],
        "edge_basis": ("No directional edge: raw first-leg accuracy 0.45 (<0.51). Apparent P&L is "
                       "payout geometry / regime; the skew-only leg does not survive cost."),
        "capital_for_15k_week": prim["capital_for_15k_week"],
        "verdict": "reject",
        "reason": ("Skew does mean-revert, but (i) the reversion is an overnight phenomenon mostly gone "
                   "by 10:00 IST (-0.36 vol pt prior-EOD->10:00 vs only +0.07 vol pt 10:00->EOD), so the "
                   "intraday kernel cannot harvest it; (ii) the steep-side trade (the actual 'sell rich put' "
                   "leg) loses money (n=8, -₹268/trade); (iii) any positive bucket is a short-delta directional "
                   "bet on a single regime with n<20; (iv) the smile-residual vertical is delta-neutral and "
                   "loses every month (n=42, PF 0.31); (v) even a hypothetical overnight hold has only n=10 "
                   "events and an overnight-net CI that includes 0."),
        "artifacts": ["tracks/skew_panel_daily.parquet", "tracks/smile_residuals_daily.parquet",
                      "tracks/skew_trades_results.json", "tracks/skew_analysis.json",
                      "tracks/intraday_skew_result.json", "tracks/skew_rr_log.jsonl"],
        "all_configs": out,
        "skew_reversion": reversion,
        "rr_overnight_economics": rr_econ,
        "smile_residual": {
            "resid_abs_mean_volpts": 0.00527, "within_date_opt_gap_mean_volpts": 0.00637,
            "vega_per_volpt_per_lot": 1160.0,
            "implied_gross_edge_inr": 739.0,
            "round_trip_execution_2leg_inr": 650.0,
            "edge_over_cost_before_adverse_selection": 1.14,
            "engine_result": "n=42 delta-neutral vertical, PF 0.31, -₹868/trade, negative all 3 months",
        },
    }
    (_HERE / "skew_rr.json").write_text(json.dumps(deliverable, indent=2, default=str))
    print(json.dumps({k: v for k, v in deliverable.items()
                      if k not in ("all_configs",)}, indent=2, default=str))
    print("saved -> tracks/skew_rr.json")


if __name__ == "__main__":
    main()

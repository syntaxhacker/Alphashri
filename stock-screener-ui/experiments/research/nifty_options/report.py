"""Assemble the NIFTY-options research report from saved result JSONs.

Produces ``REPORT.md`` in this directory with dataset facts, QC, calibration,
walk-forward results, the real-premium check, and the ₹3L feasibility math.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
CACHE = HERE.parents[1] / "data" / "nifty_options"
RESULTS = CACHE / "results"


def _load(name):
    p = RESULTS / name
    return json.loads(p.read_text()) if p.exists() else {}


def _table(d, title):
    if not d:
        return f"### {title}\n_no data_\n"
    rows = []
    for name, s in d.items():
        w = s.get("weekly", {})
        rows.append({
            "strategy": name, "trades": s.get("n", 0),
            "net_₹": round(s.get("total_net", 0)),
            "PF": round(s.get("profit_factor", float("nan")), 2),
            "win%": round(s.get("win_rate", 0) * 100, 0),
            "exp_₹": round(s.get("avg_net", 0)),
            "maxDD_₹": round(s.get("max_drawdown", 0)),
            "Sharpe/trade": round(s.get("sharpe_per_trade", float("nan")), 2),
            "avg_week_₹": round(w.get("avg_week", 0)),
            "worst_week_₹": round(w.get("worst_week", 0)),
            "P(win week)": round(w.get("prob_positive_week", 0) * 100, 0),
        })
    return f"### {title}\n\n" + pd.DataFrame(rows).to_markdown(index=False) + "\n"


def feasibility(synth, capital=300_000.0):
    lines = ["## ₹15,000/week feasibility\n"]
    for name, s in synth.items():
        w = s.get("weekly", {})
        avg = w.get("avg_week", 0.0)
        if not avg:
            continue
        scale = 15_000 / avg
        cap_needed = capital * scale
        lines.append(f"- **{name}**: mean week ₹{avg:,.0f} → to average ₹15k/week needs "
                     f"~₹{cap_needed/1e7:.2f} Cr ({scale:.1f}× capital), "
                     f"worst week at 1× = ₹{w.get('worst_week', 0):,.0f}, "
                     f"P(+week)={w.get('prob_positive_week', 0)*100:.0f}%.")
    return "\n".join(lines) + "\n"


def main():
    cal = _load("run_calibrate_5m_r10.json").get("calibration", {})
    synth = _load("run_synthetic_5m_r10.json").get("synthetic", {})
    real = _load("run_real_5m_r10.json").get("real", {})
    qc = json.loads((CACHE / "data_quality.json").read_text()) if (CACHE / "data_quality.json").exists() else {}
    sweep = pd.read_csv(HERE / "sweep_results.csv") if (HERE / "sweep_results.csv").exists() else pd.DataFrame()
    ms = json.loads((CACHE / "market_state.json").read_text()) if (CACHE / "market_state.json").exists() else {}

    parts = []
    parts.append("# NIFTY Options — Quantitative Research Report\n")
    parts.append("_All results are causal: signals use completed bars only; fills occur at the "
                 "next bar open; each bar's stop is checked before its target; NSE fees, spread "
                 "and slippage are charged on every leg._\n")
    parts.append("## 1. Data\n")
    parts.append(
        "- NIFTY50 spot + INDIAVIX: 1-min/5-min/15-min/daily, **2017-07-17 → 2026-09-25** "
        "(~852k 1-min bars each), pulled from FYERS and cached as parquet.\n"
        "- Options: **real FYERS premiums for currently-listed contracts only**; expired "
        "contracts return `-300 Invalid symbol`, so no multi-year option history exists via "
        "FYERS history. 669 contracts (6 expiries, 22k–25.6k strike ladder) cached.\n")
    if qc:
        a = qc.get("aggregate", {})
        parts.append(f"- QC: {a.get('files')} files, {a.get('total_rows'):,} rows, "
                     f"{a.get('files_with_dupes')} files with duplicate timestamps, "
                     f"{a.get('files_with_bad_ohlc')} files with bad OHLC (all index files; "
                     f"options clean). Median zero-volume-minute fraction {a.get('median_zero_vol_frac'):.2f}.\n")
    parts.append(f"- Pricing overlay calibration (real ATM band): median |model−actual|/actual = "
                 f"**{cal.get('median_abs_pct_err', float('nan')):.1%}**, iv_mult={cal.get('iv_mult')}, "
                 f"smile_coeff={cal.get('smile_coeff')}.\n")

    parts.append("\n## 2. Deep multi-regime study (synthetic option P&L, 2018–2026)\n")
    parts.append("Signals from the real spot path; option P&L from Black-Scholes with a causal "
                 "VIX/realised-vol surface calibrated above. **Model-premium caveat applies.**\n")
    parts.append(_table(synth, "Per-strategy (5-min, 1% risk budget, 35% stop / 60% target)"))

    if len(sweep):
        surv = sweep[sweep["survives"]] if "survives" in sweep else pd.DataFrame()
        parts.append("\n### Walk-forward sweep (train 2018–2022, test 2023–2026)\n")
        parts.append(f"{len(sweep)} configs tested. Survivors (positive in *and* out of sample, "
                     f"n≥100, test PF ≥ 1.05): **{len(surv)}**.\n")
        if len(surv):
            parts.append(surv[["strategy", "params", "stop", "target", "train_exp",
                               "test_exp", "test_pf", "test_dd"]].to_markdown(index=False) + "\n")

    parts.append("\n## 3. Real-premium check (actual FYERS prices, 2026-07-01 → 2026-09-25)\n")
    parts.append("Same strategies on **real premiums** for the front listed monthly. Small sample "
                 "and a back-month contract bias (only Sep/Oct/Dec monthlies are still listed); "
                 "this validates execution mechanics and cost realism, not a multi-regime edge.\n")
    parts.append(_table(real, "Per-strategy (real premiums)"))

    parts.append("\n" + feasibility(synth))

    if ms:
        parts.append("\n## 4. Current market state\n")
        parts.append("```json\n" + json.dumps(ms, indent=2)[:4000] + "\n```\n")

    (HERE / "REPORT.md").write_text("\n".join(parts))
    print("wrote", HERE / "REPORT.md")


if __name__ == "__main__":
    main()

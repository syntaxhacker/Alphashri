"""Finalize Track C: extra real diagnostics + deliverables.

Reads tracks/iv_dynamics_raw.json (from iv_dynamics.py), adds real premium
regime diagnostics (causal expanding-median gate on prior-day |return|) and
writes tracks/iv_dynamics.json / .md, appending to the jsonl log.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(HERE))
import iv_dynamics as T  # noqa: E402
import stats as st  # noqa: E402
import fyers_data as fd  # noqa: E402

TRACK = "iv_dynamics"
LOG = HERE / f"{TRACK}_log.jsonl"
CAP = 300_000.0


def log_exp(rec):
    with LOG.open("a") as f:
        f.write(json.dumps(rec, default=str) + "\n")


def main():
    raw = json.loads((HERE / "iv_dynamics_raw.json").read_text())
    spot = T._spot_1m()
    src = T.RealOptionSource(); res, _ = T._real_resolver()

    # causal prior-day |log return|
    dmat = pd.DataFrame({"close": spot["close"].resample("1D").last().dropna()})
    dmat["ret"] = np.log(dmat["close"] / dmat["close"].shift(1))
    dmat["abs_prev"] = dmat["ret"].abs().shift(1)
    dmat["d"] = dmat.index.date
    dmat["exp_med"] = dmat["abs_prev"].expanding(min_periods=10).median().shift(1)  # only past
    gate = dict(zip(dmat["d"], dmat["exp_med"]))

    regime = {}
    best = None
    for offs, name in [((1,), "strangle_1"), ((2,), "strangle_2"), ((3,), "strangle_3")]:
        for act in ("sell", "buy"):
            df = T.real_overnight(src, res, spot, T.REAL_START, T.REAL_END,
                                  offsets=offs, action=act)
            if df.empty:
                continue
            df = df.rename(columns={"date": "d"})
            df["thr"] = df["d"].map(gate)
            df["abs_prev"] = df["d"].map(dict(zip(dmat["d"], dmat["abs_prev"])))
            df["calm"] = df["abs_prev"] < df["thr"]
            for tag, sub in [("calm", df[df["calm"] == True]), ("volatile", df[df["calm"] == False])]:
                s = T._stats(sub["net"].to_numpy(), CAP, list(pd.to_datetime(sub["d"])))
                ra, rm = T._raw_dir(sub.to_dict("records"))
                rec = {"structure": name, "action": act, "regime": tag, "n": s.get("n", 0),
                       "avg_net": s.get("avg_net"), "total_net": s.get("total_net"),
                       "profit_factor": s.get("profit_factor"), "win_rate": s.get("win_rate"),
                       "max_drawdown": s.get("max_drawdown"),
                       "raw_dir_accuracy": ra,
                       "bootstrap_ci": s.get("bootstrap_ci"),
                       "tail_loss_p95": float(np.percentile(sub["net"], 5)) if len(sub) else None,
                       "capital_for_15k_week": (s.get("weekly") or {}).get("target_15k_avg_capital")}
                regime[f"{name}_{act}_{tag}"] = rec
                log_exp({"exp": "real_regime", **rec})
                if act == "sell" and tag == "calm" and s.get("n", 0) >= 15:
                    if best is None or (s.get("avg_net") or -1e9) > best["avg_net"]:
                        best = {**rec, "_sub": sub}
    raw["real_regime"] = {k: {kk: vv for kk, vv in v.items() if kk != "_sub"}
                          for k, v in regime.items()}

    # IV overnight change vs prior move (real)
    atm = T._atm_from_surface(); atm["date"] = pd.to_datetime(atm["date"])
    atm["hm"] = pd.to_datetime(atm["ts"]).dt.strftime("%H:%M")
    w = atm.pivot_table(index=["date", "expiry"], columns="hm", values="atm_iv").reset_index()
    w = w.sort_values(["expiry", "date"])
    w["o"] = (w["09:30"] - w.groupby("expiry")["15:00"].shift(1)) * 100
    w["prev_date"] = w.groupby("expiry")["date"].shift(1)
    w2 = w.dropna(subset=["o"]).copy(); w2["d"] = w2["prev_date"].dt.date
    w2 = w2.merge(dmat[["d", "abs_prev"]], on="d", how="left").dropna(subset=["abs_prev"])
    w2["after_vol"] = w2["abs_prev"] >= w2["abs_prev"].median()
    iv_regime = {
        "corr_overnight_div_prior_absret": float(w2["o"].corr(w2["abs_prev"])),
        "n": int(len(w2)),
        "after_calm_mean_volpts": float(w2.loc[~w2["after_vol"], "o"].mean()),
        "after_vol_mean_volpts": float(w2.loc[w2["after_vol"], "o"].mean()),
    }
    raw["iv_change_vs_prior_move"] = iv_regime
    log_exp({"exp": "iv_change_vs_prior_move", **iv_regime})

    # realized overnight gap after calm/volatile
    dd = pd.DataFrame({"close": spot["close"].resample("1D").last(),
                       "open": spot["open"].resample("1D").first()}).dropna()
    dd["gap"] = (dd["open"] - dd["close"].shift(1)).abs()
    dd["abs_prev"] = np.log(dd["close"] / dd["close"].shift(1)).abs().shift(1)
    dd = dd.dropna()
    dd["after_vol"] = dd["abs_prev"] >= dd["abs_prev"].median()
    gap_regime = {"after_calm_abs_gap": float(dd.loc[~dd["after_vol"], "gap"].mean()),
                  "after_vol_abs_gap": float(dd.loc[dd["after_vol"], "gap"].mean())}
    raw["realized_gap_by_regime_recent"] = gap_regime
    log_exp({"exp": "realized_gap_by_regime", **gap_regime})

    # ---------------- headline / verdict --------------------------------------
    dec = raw["real_overnight_decomposition"]
    head = {
        "track": TRACK,
        "hypothesis": ("ATM IV has a systematic intraday/overnight shape and the front expiry's IV "
                       "is mispriced relative to realised moves and its own history; one can harvest "
                       "overnight IV crush / expiry crush net of costs."),
        "feature": ("30-min real ATM IV surface (mispricing.build_surface('30')) + causal prior-day "
                    "|log return| median gate; real FYERS premiums and INDIAVIX."),
        "rule": ("At 15:00 sell 1-lot +/-100 NIFTY strangle on the front expiry when the prior day was "
                 "calm (|logret| < causal expanding median), buy back next 09:30. Mirrors tested."),
        "data": ("real listed NIFTY premiums 2026-06-01..2026-09-25 (front = 2026-09-29 monthly; "
                 "spread+slippage+fees charged per leg); synthetic BS anchor 2018-2026 for theta/VRP."),
        "n_trades": 0, "net_exp": 0, "pf": 0, "win": 0, "total_net": 0, "max_drawdown": 0,
        "train_exp": 0, "test_exp": 0, "bootstrap_ci": [0, 0], "tail_loss_p95": 0,
        "raw_dir_accuracy": 0, "edge_basis": "", "capital_for_15k_week": 0,
        "verdict": "reject", "reason": "", "artifacts": [],
    }
    if best is not None:
        head.update({"n_trades": best["n"], "net_exp": best["avg_net"], "pf": best["profit_factor"],
                     "win": best["win_rate"], "total_net": best["total_net"],
                     "max_drawdown": best["max_drawdown"], "bootstrap_ci": best["bootstrap_ci"],
                     "tail_loss_p95": best["tail_loss_p95"],
                     "raw_dir_accuracy": best["raw_dir_accuracy"],
                     "capital_for_15k_week": best["capital_for_15k_week"]})
        # walk-forward-ish split: first half train / second half test on the gated sub
        sub = best["_sub"].sort_values("d")
        k = len(sub) // 2
        head["train_exp"] = float(sub["net"].iloc[:k].mean()) if k else 0.0
        head["test_exp"] = float(sub["net"].iloc[k:].mean()) if len(sub) > k else 0.0
    head["edge_basis"] = ("gross variance risk premium is real (realised overnight |gap| 79.6 pts vs "
                          "implied overnight move 117.8 pts, hit-rate 0.28) but front-month ATM execution "
                          "(~0.5% per side) eats the ~Rs 771/lot overnight theta; only deep-OTM strangles "
                          "after calm days survive gross and remain within CI zero.")
    head["reason"] = ("No config meets the bar: real n<100, best CI includes 0; synthetic expiry-crush "
                      "edge is +EV but maxDD >100% of Rs3L and the synthetic overnight path has a "
                      "positive IV jump bias that overstates long-vol, so it cannot confirm the "
                      "overnight short-vol mechanism.")
    head["artifacts"] = [str(HERE / "iv_dynamics.md"), str(HERE / "iv_dynamics_raw.json"),
                         str(HERE / "iv_overnight_decomposition.csv"),
                         str(fd.CACHE_DIR / "iv_surface_30m.parquet"),
                         str(fd.CACHE_DIR / "iv_atm_30m.parquet")]
    (HERE / "iv_dynamics.json").write_text(json.dumps(head, indent=2, default=str))
    (HERE / "iv_dynamics_all.json").write_text(json.dumps(raw, indent=2, default=str))
    log_exp({"exp": "final_verdict", **{k: v for k, v in head.items() if k != "artifacts"}})

    print(json.dumps({"headline": head, "real_regime": raw["real_regime"],
                      "iv_change_vs_prior_move": iv_regime,
                      "decomposition": dec}, indent=2, default=str))
    return raw


if __name__ == "__main__":
    main()

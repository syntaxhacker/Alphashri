"""Intraday skew: build a 30-min real IV surface and test whether the daily
skew reversion is still capturable once we trade after the open (i.e. after the
close-of-day quote bounce has decayed).

Writes tracks/intraday_surface_30.parquet (cache) so reruns are fast.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
_RESEARCH = _HERE.parent
sys.path.insert(0, str(_RESEARCH)); sys.path.insert(0, str(_HERE))

import fyers_data as fd  # noqa: E402
import mispricing  # noqa: E402
import skew_lib as SL  # noqa: E402

CACHE = _HERE / "intraday_surface_30.parquet"
EXPIRY = pd.Timestamp("2026-09-29")


def get_surface():
    if CACHE.exists():
        return pd.read_parquet(CACHE)
    print("building 30-min surface from real premiums (slow) ...")
    surf = mispricing.build_surface("30")
    surf["date"] = pd.to_datetime(surf["date"])
    surf["expiry"] = pd.to_datetime(surf["expiry"])
    surf.to_parquet(CACHE, index=False)
    return surf


def fitted_series(surf: pd.DataFrame, expiry=EXPIRY, min_strikes: int = 6) -> pd.DataFrame:
    g = surf[surf["expiry"] == expiry].copy()
    rows = []
    for (d, ts), gg in g.groupby(["date", "ts"]):
        S = float(gg["spot"].iloc[-1]); T = float(gg["T"].iloc[-1])
        if S <= 0 or T <= 0:
            continue
        piv = gg.groupby(["strike", "opt"])["iv"].mean().unstack("opt")
        for c in ("CE", "PE"):
            if c not in piv:
                piv[c] = np.nan
        iv_avg = piv[["CE", "PE"]].mean(axis=1, skipna=True).dropna()
        if len(iv_avg) < min_strikes:
            continue
        K = iv_avg.index.to_numpy(float); ivv = iv_avg.to_numpy(float)
        x = np.log(K / S)
        vol = gg.groupby("strike")["volume"].sum().reindex(iv_avg.index).fillna(0).to_numpy(float)
        coeff = SL._fit_smile(x, ivv, vol, deg=2)
        if coeff is None:
            continue
        Kc = SL._solve_strike_for_delta(0.25, S, T, coeff, "CE")
        Kp = SL._solve_strike_for_delta(-0.25, S, T, coeff, "PE")
        if Kc is None or Kp is None:
            continue
        rows.append({"date": d, "ts": ts, "spot": S,
                     "atm_iv": SL._iv_at(coeff, 0.0),
                     "rr25": SL._iv_at(coeff, np.log(Kp / S)) - SL._iv_at(coeff, np.log(Kc / S))})
    return pd.DataFrame(rows).sort_values("ts").reset_index(drop=True)


def main():
    surf = get_surface()
    fs = fitted_series(surf)
    fs.to_parquet(_HERE / "intraday_rr30.parquet", index=False)
    print("fitted bars", len(fs), "days", fs['date'].nunique())
    fs["time"] = fs["ts"].dt.time
    out = {}
    # per-day: EOD (last bar) rr; morning 10:00 rr; first bar rr
    per = []
    for d, g in fs.groupby("date"):
        g = g.sort_values("ts")
        def rr_at(hh, mm):
            q = g[(g["ts"].dt.hour == hh) & (g["ts"].dt.minute == mm)]
            return float(q["rr25"].iloc[0]) if len(q) else np.nan
        per.append({"date": d, "rr_prev_eod": np.nan, "rr_1000": rr_at(10, 0),
                    "rr_1030": rr_at(10, 30), "rr_1200": rr_at(12, 0),
                    "rr_eod": float(g["rr25"].iloc[-1]),
                    "rr_first": float(g["rr25"].iloc[0]), "spot": float(g["spot"].iloc[-1])})
    per = pd.DataFrame(per).sort_values("date").reset_index(drop=True)
    per["rr_prev_eod"] = per["rr_eod"].shift(1)
    # causal percentile of prior EOD rr using only prior days
    rr = per["rr_eod"].to_numpy()
    pct = np.full(len(per), np.nan)
    for i in range(len(per)):
        prior = rr[max(0, i - 20):i]; prior = prior[np.isfinite(prior)]
        if len(prior) >= 8 and np.isfinite(rr[i]):
            pct[i] = float((prior < rr[i]).mean())
    per["pct_prior"] = pct
    per["steep_prev"] = per["pct_prior"] >= 0.8
    per["flat_prev"] = per["pct_prior"] <= 0.2
    # regime is known at the *previous* day's close -> use pct_prior.shift(1)
    for c in ("steep_prev", "flat_prev"):
        per[c + "_lag"] = per[c].shift(1)
    # change captured at different entry times, conditioned on *prior-day* regime
    for tcol in ("rr_first", "rr_1000", "rr_1030", "rr_1200", "rr_eod"):
        per[f"chg_prev_{tcol}"] = per[tcol] - per["rr_prev_eod"]
    for label, mask in (("steep", per["steep_prev_lag"]), ("flat", per["flat_prev_lag"]),
                        ("normal", ~(per["steep_prev_lag"].fillna(False) |
                                     per["flat_prev_lag"].fillna(False)))):
        m = mask.fillna(False) & per["rr_prev_eod"].notna()
        out[label] = {
            "n": int(m.sum()),
            "mean_chg_to_1000": float(per.loc[m, "chg_prev_rr_1000"].mean()),
            "mean_chg_to_eod": float(per.loc[m, "chg_prev_rr_eod"].mean()),
            "mean_chg_first_to_eod": float((per.loc[m, "rr_eod"] - per.loc[m, "rr_first"]).mean()),
        }
    res = {"by_regime": out,
           "note": "chg_to_1000 = prior EOD rr -> next day 10:00 rr; chg_to_eod = prior EOD -> next EOD"}
    (_HERE / "intraday_skew_result.json").write_text(json.dumps(res, indent=2, default=str))
    per.to_parquet(_HERE / "intraday_rr30_daily.parquet", index=False)
    print(json.dumps(res, indent=2, default=str))


if __name__ == "__main__":
    main()

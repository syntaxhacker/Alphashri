"""Track B helper library: fitted-smile 25-delta skew, causal percentiles, smile residuals.

Everything here is *causal*: a row for (date, expiry) uses only premiums observable
on that date. Percentile ranks are computed from **prior** days only (shifted).
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
_RESEARCH = _HERE.parent
if str(_RESEARCH) not in sys.path:
    sys.path.insert(0, str(_RESEARCH))

import fyers_data as fd  # noqa: E402
import mispricing  # noqa: E402
import pricing  # noqa: E402

LOT = 65


# ---------------------------------------------------------------------------
# smile fitting
# ---------------------------------------------------------------------------
def _fit_smile(x: np.ndarray, iv: np.ndarray, w: np.ndarray | None = None, deg: int = 2):
    """Weighted polynomial fit of IV vs log-moneyness x = ln(K/S)."""
    if len(x) < deg + 2:
        return None
    if w is None:
        w = np.ones_like(x)
    # normalise weights; clip huge volume weights so one print cannot dominate
    w = np.clip(w, 1.0, None)
    w = w / w.sum()
    try:
        coeff = np.polyfit(x, iv, deg, w=np.sqrt(w))
    except Exception:
        return None
    return coeff


def _iv_at(coeff, x: float) -> float:
    return float(np.polyval(coeff, x))


def _delta(S, K, T, sigma, opt, r=pricing.RISK_FREE):
    return pricing.bs_delta(S, K, T, max(sigma, 1e-4), opt, r)


def _solve_strike_for_delta(target_delta, S, T, coeff, opt, r=pricing.RISK_FREE):
    """Find K such that BS delta with the fitted smile equals target_delta.

    target_delta: +0.25 for a 25-delta call, -0.25 for a 25-delta put.
    Monotone in K -> bisection on log K.
    """
    lo, hi = S * 0.70, S * 1.30

    def g(K):
        x = np.log(K / S)
        sig = _iv_at(coeff, x)
        return _delta(S, K, T, sig, opt, r) - target_delta

    glo, ghi = g(lo), g(hi)
    if not np.isfinite(glo) or not np.isfinite(ghi) or glo * ghi > 0:
        return None
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        gm = g(mid)
        if gm == 0:
            return mid
        if glo * gm <= 0:
            hi, ghi = mid, gm
        else:
            lo, glo = mid, gm
    return 0.5 * (lo + hi)


def build_skew_panel(surf: pd.DataFrame | None = None, min_strikes: int = 6) -> pd.DataFrame:
    """Per (date, expiry): fitted ATM IV, 25d put/call IV, rr25, butterfly."""
    if surf is None:
        surf = pd.read_parquet(fd.CACHE_DIR / "iv_surface_daily.parquet")
    surf = surf.copy()
    surf["date"] = pd.to_datetime(surf["date"])
    surf["expiry"] = pd.to_datetime(surf["expiry"])
    rows = []
    resid_rows = []
    for (d, exp), g in surf.groupby(["date", "expiry"]):
        S = float(g["spot"].iloc[-1])
        T = float(g["T"].iloc[-1])
        if S <= 0 or T <= 0:
            continue
        # average CE/PE IV per strike to cancel put-call noise
        piv = g.groupby(["strike", "opt"])["iv"].mean().unstack("opt")
        if "CE" not in piv:
            piv["CE"] = np.nan
        if "PE" not in piv:
            piv["PE"] = np.nan
        iv_avg = piv[["CE", "PE"]].mean(axis=1, skipna=True).dropna()
        vol = g.groupby("strike")["volume"].sum()
        if len(iv_avg) < min_strikes:
            continue
        K = iv_avg.index.to_numpy(dtype=float)
        ivv = iv_avg.to_numpy(dtype=float)
        x = np.log(K / S)
        w = vol.reindex(iv_avg.index).fillna(0).to_numpy(dtype=float)
        coeff = _fit_smile(x, ivv, w, deg=2)
        if coeff is None:
            continue
        atm = _iv_at(coeff, 0.0)
        Kc = _solve_strike_for_delta(0.25, S, T, coeff, "CE")
        Kp = _solve_strike_for_delta(-0.25, S, T, coeff, "PE")
        if Kc is None or Kp is None:
            continue
        ivc = _iv_at(coeff, np.log(Kc / S))
        ivp = _iv_at(coeff, np.log(Kp / S))
        rms = float(np.sqrt(np.mean((ivv - np.polyval(coeff, x)) ** 2)))
        rows.append({
            "date": d, "expiry": exp, "dte": int(g["dte"].iloc[-1]), "spot": S, "T": T,
            "atm_iv": atm, "ivc25": ivc, "ivp25": ivp,
            "rr25": ivp - ivc, "bf25": 0.5 * (ivp + ivc) - atm,
            "k_call25": float(Kc), "k_put25": float(Kp),
            "n_strikes": int(len(iv_avg)), "smile_rms": rms,
            "vol_sum": float(vol.sum()),
        })
        # residuals for the smile-residual trade (per strike *and* option type)
        for _, gr in g.iterrows():
            k_ = float(gr["strike"])
            x_ = np.log(k_ / S)
            resid_rows.append({"date": d, "expiry": exp, "strike": k_, "opt": gr["opt"],
                               "iv": float(gr["iv"]), "fit_iv": _iv_at(coeff, x_),
                               "resid": float(gr["iv"]) - _iv_at(coeff, x_),
                               "volume": float(gr.get("volume", 0) or 0),
                               "moneyness": float(k_ - S)})
    panel = pd.DataFrame(rows).sort_values(["expiry", "date"]).reset_index(drop=True)
    resid = pd.DataFrame(resid_rows)
    return panel, resid


def add_causal_percentiles(panel: pd.DataFrame, window: int = 20, min_obs: int = 8) -> pd.DataFrame:
    """Add prior-only rolling percentile rank + steep/flat flags per expiry.

    `pct_prior` = fraction of the previous `window` days' rr25 below today's rr25.
    Uses only information strictly before `date` (shift(1)), so it is causal.
    """
    out = []
    for exp, g in panel.groupby("expiry"):
        g = g.sort_values("date").reset_index(drop=True)
        rr = g["rr25"].to_numpy()
        pct = np.full(len(g), np.nan)
        for i in range(len(g)):
            prior = rr[max(0, i - window):i]
            prior = prior[np.isfinite(prior)]
            if len(prior) >= min_obs and np.isfinite(rr[i]):
                pct[i] = float((prior < rr[i]).mean())
        g = g.copy()
        g["pct_prior"] = pct
        out.append(g)
    p = pd.concat(out, ignore_index=True)
    p["steep"] = p["pct_prior"] >= 0.80
    p["flat"] = p["pct_prior"] <= 0.20
    return p


def mean_reversion_table(panel: pd.DataFrame, window: int = 20, min_obs: int = 8) -> dict:
    """Does extreme skew predict next-day skew change? (causal, prior-only pct)."""
    p = add_causal_percentiles(panel, window, min_obs)
    res = {}
    for exp, g in p.groupby("expiry"):
        g = g.sort_values("date")
        rr = g["rr25"].to_numpy()
        d = np.diff(rr)
        lvl = rr[:-1]
        pct = g["pct_prior"].to_numpy()[:-1]
        m = np.isfinite(d) & np.isfinite(lvl)
        if m.sum() < 15:
            continue
        # OLS slope of next-day change on today's level
        A = np.vstack([np.ones(m.sum()), lvl[m]]).T
        beta = np.linalg.lstsq(A, d[m], rcond=None)[0]
        ac = float(np.corrcoef(rr[:-1][np.isfinite(rr[:-1]) & np.isfinite(rr[1:])],
                               rr[1:][np.isfinite(rr[:-1]) & np.isfinite(rr[1:])])[0, 1])
        res[str(exp.date())] = {
            "n": int(m.sum()),
            "rr_mean": float(np.nanmean(rr)), "rr_std": float(np.nanstd(rr)),
            "ac1": ac,
            "slope_next_on_level": float(beta[1]),
            "n_steep_next": int(np.nansum(pct >= 0.8)),
            "mean_next_chg_after_steep": float(np.nanmean(d[pct >= 0.8])) if np.any(pct >= 0.8) else float("nan"),
            "mean_next_chg_after_flat": float(np.nanmean(d[pct <= 0.2])) if np.any(pct <= 0.2) else float("nan"),
            "mean_next_chg_all": float(np.nanmean(d[m])),
        }
    return {"window": window, "by_expiry": res}


if __name__ == "__main__":
    panel, resid = build_skew_panel()
    panel.to_parquet(_HERE / "skew_panel_daily.parquet", index=False)
    resid.to_parquet(_HERE / "smile_residuals_daily.parquet", index=False)
    print("panel", panel.shape, "resid", resid.shape)
    print(panel.groupby("expiry").agg(n=("date", "count"), rr=("rr25", "mean"),
                                      dte=("dte", "min")).to_string())
    print(panel.dropna(subset=["rr25"])["rr25"].describe().round(4).to_string())
    import json
    print(json.dumps(mean_reversion_table(panel), indent=2, default=str))

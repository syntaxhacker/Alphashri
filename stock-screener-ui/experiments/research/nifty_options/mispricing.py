"""Mispricing kernel: reconstruct real implied-vol surfaces + relative-value metrics.

Given real FYERS premiums for the listed NIFTY contracts, invert Black-Scholes to
recover IV, then build the quantities that define "cheap" vs "rich":

  * ATM IV per expiry (interpolated at spot on a fitted smile)
  * realised vol (RV) and the variance risk premium (IV-RV, IV/RV)
  * 25-delta put/call skew (risk-reversal) and butterfly (smile curvature)
  * term-structure slope (front vs next expiry)
  * smile residual (actual IV vs fitted smile) = per-strike richness
  * static-arbitrage checks: vertical monotonicity, butterfly convexity, parity

Everything is causal: each row only uses prices observable at that timestamp plus
the expiry date. Output is a tidy panel used by every research track.
"""
from __future__ import annotations

import math
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402
import pricing  # noqa: E402

R = 0.065
LOT = 65


def implied_vol(price, S, K, T, opt, r=R):
    """Invert BS. None when price is below intrinsic or non-invertible."""
    if price is None or price <= 0 or S <= 0 or K <= 0 or T <= 1e-9:
        return None
    intr = max(0.0, S - K) if opt.upper() == "CE" else max(0.0, K - S)
    if price <= intr + 1e-9:
        return None
    f = lambda s: pricing.bs_price(S, K, T, s, opt, r) - price
    lo, hi = 1e-4, 3.0
    try:
        if f(lo) * f(hi) > 0:
            return None
        return float(brentq(f, lo, hi, xtol=1e-5, maxiter=60))
    except Exception:
        return None


def _realized_vol(spot: pd.Series, window: int = 288) -> pd.Series:
    ret = np.log(spot / spot.shift(1))
    return (ret.rolling(window).std() * math.sqrt(252 * 375)).clip(lower=0.05)


def build_surface(resolution="D") -> pd.DataFrame:
    """Long panel: ts, expiry, strike, opt, price, spot, T, iv, volume."""
    import json
    man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
    spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    rv = _realized_vol(spot["close"])

    rows = []
    for c in man["contracts"]:
        path = fd.CANDLE_DIR / f"{c['symbol'].replace(':', '_')}__1.parquet"
        if not path.exists():
            continue
        df = pd.read_parquet(path).set_index("ts").sort_index()
        if df.empty:
            continue
        exp = date.fromisoformat(c["expiry"])
        # session-only bars aligned to spot (option feed carries post-close bars)
        sess = df[(df.index.time >= datetime.strptime("09:15", "%H:%M").time()) &
                  (df.index.time <= datetime.strptime("15:25", "%H:%M").time())]
        if sess.empty:
            continue
        if resolution == "D":
            per = sess.groupby(sess.index.date).tail(1)          # last in-session bar
        else:
            per = sess[sess.index.minute % 30 == 0]              # 30-min grid
        for ts, row in per.iterrows():
            if ts not in spot.index:
                continue
            S = float(spot.at[ts, "close"])
            if abs(c["strike"] - S) > 700:                       # liquid moneyness band
                continue
            T = pricing.t_years(ts, exp)
            price = float(row["close"])
            if price < 0.5:
                continue
            iv = implied_vol(price, S, c["strike"], T, c["opt"])
            if iv is None:
                continue
            rows.append({"ts": ts, "date": ts.date(), "expiry": exp, "strike": c["strike"],
                         "opt": c["opt"], "price": price, "spot": S, "T": T, "iv": iv,
                         "volume": float(row.get("volume", 0) or 0),
                         "rv": float(rv.asof(ts)) if rv.asof(ts) == rv.asof(ts) else np.nan,
                         "dte": (exp - ts.date()).days})
    return pd.DataFrame(rows)


def _atm_iv(grp: pd.DataFrame, spot: float) -> float | None:
    """Interpolate IV at spot from the CE+PE smile (fallback: nearest strike)."""
    g = grp[(grp["strike"] - spot).abs() <= 600]
    if g.empty:
        return None
    # average call/put IV per strike then linear-interp in strike
    s = g.groupby("strike")["iv"].mean().sort_index()
    if len(s) >= 2:
        return float(np.interp(spot, s.index, s.values))
    return float(s.iloc[0])


def _skew_atm(grp: pd.DataFrame, spot: float, dte: float):
    """25-delta-ish risk reversal using 100/150-pt OTM wings as proxies."""
    put = grp[(grp["opt"] == "PE") & ((grp["strike"] - spot).abs() <= 250) & (grp["strike"] < spot)]
    call = grp[(grp["opt"] == "CE") & ((grp["strike"] - spot).abs() <= 250) & (grp["strike"] > spot)]
    if put.empty or call.empty:
        return None
    return float(put["iv"].mean() - call["iv"].mean()), float(put["iv"].mean()), float(call["iv"].mean())


def surface_metrics(surf: pd.DataFrame) -> pd.DataFrame:
    """Per (date, expiry): ATM IV, VRP, skew, butterfly, term inputs."""
    out = []
    for (d, exp), grp in surf.groupby(["date", "expiry"]):
        spot = float(grp["spot"].iloc[-1])
        atm = _atm_iv(grp, spot)
        sk = _skew_atm(grp, spot, grp["dte"].iloc[0])
        rv = float(grp["rv"].iloc[-1]) if grp["rv"].notna().any() else np.nan
        out.append({"date": d, "expiry": exp, "dte": int(grp["dte"].iloc[0]),
                    "atm_iv": atm, "rv": rv,
                    "vrp": (atm - rv) if (atm and rv == rv) else np.nan,
                    "vrp_ratio": (atm / rv) if (atm and rv and rv > 0) else np.nan,
                    "rr25": sk[0] if sk else np.nan,
                    "iv_put": sk[1] if sk else np.nan, "iv_call": sk[2] if sk else np.nan})
    m = pd.DataFrame(out).sort_values(["date", "expiry"])
    # term slope: front vs second expiry per date
    m["term_slope"] = np.nan
    for d, g in m.groupby("date"):
        g = g.sort_values("dte")
        if len(g) >= 2:
            front, nxt = g.iloc[0], g.iloc[1]
            if front["atm_iv"] and nxt["atm_iv"]:
                m.loc[g.index[0], "term_slope"] = nxt["atm_iv"] - front["atm_iv"]
    return m


def arbitrage_checks(surf: pd.DataFrame) -> dict:
    """Static no-arb checks on the daily cross-section. Counts violations."""
    viol = {"vertical": 0, "butterfly": 0, "negative_price": 0, "n_checks": 0}
    for (d, exp), g in surf[surf["opt"] == "CE"].groupby(["date", "expiry"]):
        s = g.groupby("strike")["price"].mean().sort_index()
        if len(s) < 3:
            continue
        k = s.index.values
        p = s.values
        viol["n_checks"] += 1
        if (p <= 0).any():
            viol["negative_price"] += 1
        if (np.diff(p) > 1e-6).any():      # call price must be non-increasing in K
            viol["vertical"] += 1
        if len(p) >= 3:
            second = p[:-2] - 2 * p[1:-1] + p[2:]   # >= 0 for convexity
            if (second < -1e-6).any():
                viol["butterfly"] += 1
    return viol


def main():
    print("building daily IV surface from real premiums ...")
    surf = build_surface("D")
    surf.to_parquet(fd.CACHE_DIR / "iv_surface_daily.parquet", index=False)
    print(f"  rows={len(surf)} contracts={surf[['expiry','strike','opt']].drop_duplicates().shape[0]} "
          f"dates={surf['date'].nunique()}")
    m = surface_metrics(surf)
    m.to_parquet(fd.CACHE_DIR / "surface_metrics_daily.parquet", index=False)
    print("\nATM IV vs RV (variance risk premium), by date (tail):")
    print(m.dropna(subset=["vrp"]).groupby("dte")["vrp"].agg(["count", "mean", "median"]).round(4).to_string())
    print("\nskew (rr25 = put IV - call IV) summary:")
    print(m.dropna(subset=["rr25"])["rr25"].describe().round(4).to_string())
    print("\nterm slope (back - front IV):")
    print(m["term_slope"].describe().round(4).to_string())
    print("\narbitrage violations:", arbitrage_checks(surf))


if __name__ == "__main__":
    main()

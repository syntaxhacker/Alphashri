"""Nifty 50 breadth predictor — does constituent breadth predict the NEXT index move?

Question: can tracking Nifty 50 constituents intraday predict the index's next
30/60-min move well enough to take directional ATM option buys (CE/PE)?

Pipeline: fetch (yfinance 5m, cached) -> per-session features (causal, <=t only)
-> targets (forward index returns) -> evaluation (accuracy + correlation + CIs)
-> frozen candidate rule v2 (in-sample selected on 31 sessions; NOT forward-validated).

Headline (31 sessions 2026-09-01..10-15, yfinance 5m): equal-weight %stocks-above-
prior-close at 10:30 (minus 50) predicts the 10:30->close index direction with
acc 0.71, Wilson [0.53,0.84], pearson +0.41 — the only candidate that beats the
index-momentum baseline (acc 0.55, r +0.14) by a clear margin at decision time.
Pooled 5m-bar forward-30m skill is much weaker (acc 0.567, day-block [0.52,0.61]).
Nothing survives Holm correction over 12 candidates (best holm_p = 0.18):
treat as hypothesis, paper-trade before sizing.

Weights: Tickertape Nifty-50 constituents page fetched 2026-10-15 (live page,
index 22997.35 = Oct-15 close). Cross-check: NSE Indices Sep-30-2026 factsheet
(ind_nifty50.pdf) top-10: HDFCBANK 10.38 / ICICIBANK 9.05 / RELIANCE 7.58 /
BHARTIARTL 5.10 / LT 4.20 / SBIN 3.79 / AXISBANK 3.37 / INFY 3.35 /
KOTAKBANK 2.93 / M&M 2.52 -> top-10 = 52.27%. Tickertape top-10 = 53.35%.
Weights drift daily; research use only.

Run: .venv/bin/python scripts/research/nifty_breadth/breadth_predictor.py [--refetch]
"""

import argparse
import json
import sys
import warnings
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # repo root

IST = ZoneInfo("Asia/Kolkata")
HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
DATA.mkdir(parents=True, exist_ok=True)
CACHE_5M = DATA / "nifty50_5m.pkl"
CACHE_DAILY = DATA / "nifty50_daily.pkl"
SNAP_CSV = DATA / "session_snapshots.csv"

FETCH_START = "2026-09-01"  # 5m history capped at ~60d; covers 2026-09-10..10-15
RTH = (pd.Timestamp("09:15").time(), pd.Timestamp("15:30").time())

# ---- index weights, Tickertape 2026-10-15 (pct) ----
NIFTY50_WEIGHTS = {
    "HDFCBANK": 10.73, "ICICIBANK": 9.23, "RELIANCE": 7.60, "BHARTIARTL": 5.20,
    "LT": 4.08, "AXISBANK": 3.72, "SBIN": 3.64, "INFY": 3.62, "KOTAKBANK": 3.06,
    "M&M": 2.47, "BAJFINANCE": 2.43, "TCS": 2.30, "ITC": 2.24, "ETERNAL": 2.23,
    "SUNPHARMA": 1.80, "SHRIRAMFIN": 1.66, "HINDUNILVR": 1.61, "TITAN": 1.56,
    "TATASTEEL": 1.36, "NTPC": 1.35, "BSE": 1.34, "MARUTI": 1.33, "HCLTECH": 1.31,
    "ADANIPORTS": 1.31, "BEL": 1.24, "HINDALCO": 1.20, "ULTRACEMCO": 1.17,
    "BAJAJ-AUTO": 1.07, "POWERGRID": 1.05, "ASIANPAINT": 1.02, "JSWSTEEL": 1.02,
    "INDIGO": 1.00, "TECHM": 0.98, "BAJAJFINSV": 0.96, "COALINDIA": 0.96,
    "GRASIM": 0.96, "EICHERMOT": 0.93, "TRENT": 0.88, "ADANIENT": 0.88,
    "NESTLEIND": 0.88, "ONGC": 0.83, "APOLLOHOSP": 0.78, "CIPLA": 0.71,
    "JIOFIN": 0.69, "DRREDDY": 0.68, "SBILIFE": 0.66, "TATACONSUM": 0.62,
    "MAXHEALTH": 0.58, "TMPV": 0.57, "HDFCLIFE": 0.49,
}
W = pd.Series(NIFTY50_WEIGHTS, dtype=float)
W = W / W.sum()  # renorm (tickertape sums to ~100.01)
TOP5 = ["HDFCBANK", "ICICIBANK", "RELIANCE", "BHARTIARTL", "LT"]
BANKS = ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK"]
IT = ["INFY", "TCS", "HCLTECH", "TECHM"]

YF = {t: (t + ".NS") for t in NIFTY50_WEIGHTS}
YF["NIFTY"] = "^NSEI"


# ---------------- fetch ----------------
def fetch_all(refetch=False):
    import yfinance as yf

    if CACHE_5M.exists() and CACHE_DAILY.exists() and not refetch:
        return _orient(pd.read_pickle(CACHE_5M)), _orient(pd.read_pickle(CACHE_DAILY))
    syms = sorted(set(YF.values()))
    print(f"yfinance batch: {len(syms)} symbols 5m since {FETCH_START} ...", flush=True)
    df = yf.download(syms, start=FETCH_START, interval="5m", prepost=False,
                     auto_adjust=False, progress=False, threads=True)
    df = _orient(df)
    df.index = pd.to_datetime(df.index).tz_convert(IST)
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")]
    print("5m:", df.shape, df.index.min(), "->", df.index.max(), flush=True)
    dd = yf.download(syms, start="2026-08-15", interval="1d", auto_adjust=False,
                     progress=False, threads=True)
    dd = _orient(dd)
    dd.index = pd.to_datetime(dd.index)
    if dd.index.tz is None:
        dd.index = dd.index.tz_localize(IST)
    else:
        dd.index = dd.index.tz_convert(IST)
    df.to_pickle(CACHE_5M)
    dd.to_pickle(CACHE_DAILY)
    return df, dd


def _orient(df):
    """Normalize yfinance columns to (field, ticker) whatever the download returns."""
    if not isinstance(df.columns, pd.MultiIndex):
        return df
    tickers = set(YF.values())
    lv0 = set(df.columns.get_level_values(0))
    lv1 = set(df.columns.get_level_values(1))
    if len(lv0 & tickers) >= len(lv1 & tickers):
        df = df.copy()
        df.columns = df.columns.swaplevel(0, 1)
    return df.sort_index(axis=1)


def split_panels(df5):
    df5 = _orient(df5)
    """{name: OHLC DataFrame} in IST, RTH only."""
    out = {}
    for name, yfsym in YF.items():
        try:
            sub = df5.xs(yfsym, axis=1, level=1)
        except (KeyError, TypeError):
            continue
        if not isinstance(sub, pd.DataFrame) or "Close" not in sub.columns:
            continue
        sub = sub.dropna(subset=["Close"])
        sub = sub.between_time("09:15", "15:30")
        if len(sub):
            out[name] = sub
    return out


def sessions_index(panels):
    idx = panels["NIFTY"]
    days = sorted(set(idx.index.date))
    return [d for d in days
            if len(idx[idx.index.date == d]) >= 60]  # full sessions only


def prev_closes(daily):
    daily = _orient(daily)
    try:
        px = daily.xs("Close", axis=1, level=0)
    except (KeyError, TypeError):
        px = daily
    out = {}
    for name, yfsym in YF.items():
        try:
            out[name] = px[yfsym].dropna()
        except KeyError:
            pass
    return out


# ---------------- features (all causal: uses bars <= t only) ----------------
def session_frame(day, panels, prev):
    """One row per 5m bar; features known at bar close t; targets forward."""
    g = panels["NIFTY"]
    g = g[g.index.date == day].copy()
    if len(g) < 60:
        return None
    stocks = [t for t in NIFTY50_WEIGHTS if t in panels]
    w = W.reindex(stocks)
    w = w / w.sum()
    # aligned close matrix (forward-fill 1 bar max for late prints, then drop sparse bars)
    px = pd.DataFrame({t: panels[t]["Close"] for t in stocks})
    px = px.reindex(g.index).ffill(limit=1)
    npx = px.notna().sum(axis=1)
    px = px[npx >= 45]
    g = g.loc[px.index]
    if len(g) < 50:
        return None
    n = len(g)
    cov = npx.loc[px.index] / len(stocks)

    # prior closes for this session (prev trading day close from daily)
    pc = {}
    for t in stocks:
        s = prev.get(t)
        if s is None or len(s) == 0:
            continue
        h = s[s.index.date < day]
        if len(h):
            pc[t] = float(h.iloc[-1])
    have_pc = [t for t in stocks if t in pc]
    pcv = pd.Series({t: pc[t] for t in have_pc})
    wpc = W.reindex(have_pc)
    wpc = wpc / wpc.sum()

    tp = (g["High"] + g["Low"] + g["Close"]) / 3
    idx_vwap = tp.expanding().mean()
    idx_close = g["Close"].astype(float)

    above_pc = (px[have_pc].gt(pcv)).astype(float)
    # per-stock session average-price line (no volume in feed — same convention as entry engine)
    tp_s = {}
    for t in stocks:
        d = panels[t].reindex(px.index).ffill(limit=1)
        tp_s[t] = ((d["High"] + d["Low"] + d["Close"]) / 3)
    tp_s = pd.DataFrame(tp_s)
    avg_s = tp_s.expanding().mean()
    above_vw = (px.gt(avg_s)).astype(float)

    wv = W.reindex(px.columns).fillna(0)
    wv = wv / wv.sum()
    fe = {}
    fe["br_eq_pc"] = above_pc.mean(axis=1) * 100
    fe["br_w_pc"] = (above_pc * wpc.values).sum(axis=1) * 100
    fe["br_eq_vwap"] = above_vw.mean(axis=1) * 100
    fe["br_w_vwap"] = (above_vw * wv.values).sum(axis=1) * 100

    # momentum baskets (cap-weighted log-ish simple returns)
    def basket_ret(members, k):
        m = [t for t in members if t in px.columns]
        ww = W.reindex(m)
        ww = ww / ww.sum()
        r = px[m].pct_change(k)
        valid = r.notna().mean(axis=1)
        out = (r * ww.values).sum(axis=1, skipna=True) * 100
        return out.mask(valid < 0.8)

    idx_m15 = idx_close.pct_change(3) * 100
    idx_m30 = idx_close.pct_change(6) * 100
    fe["idx_mom_15"] = idx_m15
    fe["idx_mom_30"] = idx_m30
    fe["top5_mom_30"] = basket_ret(TOP5, 6)
    fe["lead_top5_30"] = fe["top5_mom_30"] - fe["idx_mom_30"]
    fe["bank_mom_30"] = basket_ret(BANKS, 6)
    fe["it_mom_30"] = basket_ret(IT, 6)
    fe["bank_it_spread_30"] = fe["bank_mom_30"] - fe["it_mom_30"]
    fe["rest_mom_30"] = basket_ret([t for t in stocks
                                    if t not in TOP5], 6)
    fe["top5_rest_spread_30"] = fe["top5_mom_30"] - fe["rest_mom_30"]

    # diffusion: % fresh 30m (6-bar) highs minus fresh 30m lows
    roll_max = px.rolling(6, min_periods=6).max()
    roll_min = px.rolling(6, min_periods=6).min()
    fe["diffusion_30"] = ((px >= roll_max).mean(axis=1)
                          - (px <= roll_min).mean(axis=1)) * 100
    # breadth thrust: 30m change in weighted VWAP breadth
    fe["br_thrust_30"] = fe["br_w_vwap"].diff(6)
    # index regime context (not a predictor — reported for conditioning)
    fe["idx_vwap_gap"] = (idx_close - idx_vwap) / idx_close * 100

    F = pd.DataFrame(fe)
    F["coverage"] = cov.loc[F.index] * 100
    F["day"] = str(day)
    F["t"] = F.index.strftime("%H:%M")
    # targets: index forward returns
    F["fwd30"] = idx_close.shift(-6) / idx_close * 100 - 100
    F["fwd60"] = idx_close.shift(-12) / idx_close * 100 - 100
    # forward to 12:30 and to last bar (for day-call framing)
    try:
        px1230 = float(idx_close[idx_close.index.strftime("%H:%M") == "12:30"].iloc[0])
        F["fwd_to_1230"] = px1230 / idx_close * 100 - 100
    except IndexError:
        F["fwd_to_1230"] = np.nan
    F["fwd_to_close"] = float(idx_close.iloc[-1]) / idx_close * 100 - 100
    F["day_ret"] = float(idx_close.iloc[-1] / float(g["Open"].iloc[0]) * 100 - 100)
    return F


# ---------------- stats ----------------
def wilson(p, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def corr_ci(r, n, z=1.96):
    if n < 4 or not np.isfinite(r) or abs(r) >= 1:
        return (np.nan, np.nan)
    f = np.arctanh(np.clip(r, -0.9999, 0.9999))
    lo, hi = f - z / np.sqrt(n - 3), f + z / np.sqrt(n - 3)
    return (np.tanh(lo), np.tanh(hi))


def day_block_bootstrap_acc(day_correct, nrep=1000, seed=7):
    """day_correct: {day: 0/1 np.array}. Resample whole days; pool; percentile CI."""
    rng = np.random.default_rng(seed)
    LAB = list(day_correct.keys())
    est = np.empty(nrep)
    for i in range(nrep):
        samp = rng.choice(LAB, size=len(LAB), replace=True)
        pool = np.concatenate([day_correct[d] for d in samp])
        est[i] = float(pool.mean()) if len(pool) else np.nan
    return float(np.nanpercentile(est, 2.5)), float(np.nanpercentile(est, 97.5))


PREDICTORS = ["br_eq_pc", "br_w_pc", "br_eq_vwap", "br_w_vwap", "top5_mom_30",
              "lead_top5_30", "bank_it_spread_30", "top5_rest_spread_30",
              "diffusion_30", "br_thrust_30", "idx_mom_15", "idx_mom_30"]
BASELINES = ["idx_mom_15", "idx_mom_30"]


# Breadth levels live on 0..100; the directional signal is the DEVIATION from
# neutral (50). Demean here so sign()/corr measure bias, not base-rate.
LEVELS = ["br_eq_pc", "br_w_pc", "br_eq_vwap", "br_w_vwap"]


def pooled_table(ALL, target="fwd30", dust=0.0):
    rows = []
    for p in PREDICTORS:
        d = ALL[[p, target, "day"]].dropna()
        if dust:
            d = d[d[target].abs() >= dust]
        x = d[p].values.astype(float)
        if p in LEVELS:
            x = x - 50.0
        y = d[target].values
        ok = (np.sign(x) == np.sign(y)).astype(float)
        acc = float(ok.mean())
        lo, hi = wilson(acc, len(d))
        day_correct = {dd: ok[d["day"].values == dd] for dd in set(d["day"].values)}
        blo, bhi = day_block_bootstrap_acc(day_correct)
        r = float(pd.Series(x).corr(pd.Series(y)))
        rlo, rhi = corr_ci(r, len(d))
        rs = float(pd.Series(x).corr(pd.Series(y), method="spearman"))
        rows.append(dict(predictor=p, n=len(d), acc=acc,
                         acc_wilson=f"[{lo:.3f},{hi:.3f}]",
                         acc_dayblock=f"[{blo:.3f},{bhi:.3f}]",
                         pearson=r, pearson_ci=f"[{rlo:.3f},{rhi:.3f}]",
                         spearman=rs))
    return pd.DataFrame(rows).sort_values("acc", ascending=False)


def snapshot_table(ALL, at="10:30", target="fwd_to_close"):
    rows = []
    for day, g in ALL.groupby("day"):
        h = g[g["t"] <= at]
        if len(h) == 0:
            continue
        r = h.iloc[-1]
        rows.append(dict(day=day, at=r["t"], day_ret=r["day_ret"],
                         fwd=r[target],
                         **{p: r[p] for p in PREDICTORS},
                         idx_vwap_gap=r["idx_vwap_gap"], coverage=r["coverage"]))
    S = pd.DataFrame(rows).sort_values("day").reset_index(drop=True)
    return S


# ---------------- frozen candidate rule ----------------
# v2 (frozen 2026-10-15): equal-weight above-prior-close breadth + index-vs-avg-line
# confirmation, read at the 10:30 bar close. In-sample selection on 31 sessions
# (Sep-01..Oct-15 2026); NOT forward-validated. v1 (weighted + thrust filter) was
# retired: thrust condition cut hit-rate 0.79 -> 0.62 in-sample with no cost benefit,
# and cap-weighting added nothing over equal-weight (F ~= C in stage-2 cuts).
#   LONG  if (br_eq_pc - 50) > +5 AND idx_vwap_gap > 0
#   SHORT if (br_eq_pc - 50) < -5 AND idx_vwap_gap < 0
#   else FLAT.
FROZEN = dict(br_band=5.0, at="10:30")


def decide_side(snap_row, br_band=None):
    br_band = FROZEN["br_band"] if br_band is None else br_band
    b = snap_row["br_eq_pc"] - 50.0
    gap = snap_row["idx_vwap_gap"]
    if not (np.isfinite(b) and np.isfinite(gap)):
        return "FLAT"
    if b > br_band and gap > 0:
        return "LONG"
    if b < -br_band and gap < 0:
        return "SHORT"
    return "FLAT"


def rule_backtest(S, target="fwd", cost=0.30):
    """Score frozen rule on snapshots. cost = min |fwd move| (%) to clear friction."""
    R = S.copy()
    R["call"] = R.apply(decide_side, axis=1)
    R["fwd_sign"] = np.sign(R[target])
    R["side_sign"] = R["call"].map({"LONG": 1.0, "SHORT": -1.0, "FLAT": np.nan})
    traded = R[R["call"] != "FLAT"].copy()
    traded["right"] = traded["side_sign"] == traded["fwd_sign"]
    traded["ret_signed"] = traded["side_sign"] * traded[target]
    traded["beats_cost"] = traded["ret_signed"] > cost
    return R, traded


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true")
    ap.add_argument("--at", default="10:30")
    args = ap.parse_args()
    warnings.filterwarnings("ignore", category=RuntimeWarning)  # cosmetic NaN-slice noise in corr/rank paths

    df5, daily = fetch_all(args.refetch)
    panels = split_panels(df5)
    prev = prev_closes(daily)
    print("symbols with 5m:", len([k for k in panels if k != 'NIFTY']),
          "| index bars:", len(panels.get("NIFTY", [])))
    days = sessions_index(panels)
    print(f"sessions (>=60 bars): {len(days)}: {days[0]} .. {days[-1]}")

    frames, gaps = [], []
    for d in days:
        F = session_frame(d, panels, prev)
        if F is None:
            gaps.append(str(d))
            continue
        # keep bars with a full forward-60 window for pooled fwd work; snapshots use all
        frames.append(F)
    ALL = pd.concat(frames).reset_index(drop=True)
    print(f"kept {len(frames)} sessions, {len(ALL)} bars; dropped: {gaps}")
    print("median coverage:", round(ALL['coverage'].median(), 1), "%")

    for tgt in ("fwd30", "fwd60"):
        sub = ALL.dropna(subset=[tgt])
        print(f"\n=== pooled next-move skill, target={tgt} (n={len(sub)}) ===")
        T = pooled_table(ALL, tgt)
        print(T.to_string(index=False,
                          formatters={"acc": "{:.3f}".format, "pearson": "{:+.3f}".format,
                                      "spearman": "{:+.3f}".format}))

    print(f"\n=== pooled, |fwd30|>=0.05% dust (tradeable noise filter) ===")
    print(pooled_table(ALL, "fwd30", dust=0.05).to_string(
        index=False, formatters={"acc": "{:.3f}".format, "pearson": "{:+.3f}".format,
                                 "spearman": "{:+.3f}".format}))

    S = snapshot_table(ALL, at=args.at)
    S.to_csv(SNAP_CSV, index=False)
    print(f"\n=== {args.at} snapshot -> close (n={len(S)}) ===")
    cols = ["day", "at", "day_ret", "fwd", "br_w_vwap", "br_thrust_30",
            "idx_vwap_gap", "idx_mom_30", "diffusion_30", "bank_it_spread_30"]
    print(S[cols].to_string(index=False,
                            formatters={c: "{:+.2f}".format for c in cols if c not in ("day", "at")}))
    # snapshot skill per predictor (sign(x) vs sign(fwd_to_close))
    print(f"\n=== snapshot directional skill @ {args.at} (n={len(S)}) ===")
    for p in PREDICTORS + ["idx_vwap_gap"]:
        x = S[p].values.astype(float)
        if p in LEVELS:
            x = x - 50.0
        y = S["fwd"].values
        m = np.isfinite(x) & np.isfinite(y)
        acc = float(np.mean(np.sign(x[m]) == np.sign(y[m])))
        lo, hi = wilson(acc, m.sum())
        r = float(pd.Series(x[m]).corr(pd.Series(y[m])))
        print(f"{p:20s} acc={acc:.3f} wilson=[{lo:.3f},{hi:.3f}] pearson={r:+.3f}")

    R, traded = rule_backtest(S)
    print("\n=== frozen rule v2 calls (br_eq_pc +-5 + avg-line confirm @10:30) ===")
    R["b"] = R["br_eq_pc"] - 50.0
    print(R[["day", "at", "call", "br_eq_pc", "b", "idx_vwap_gap",
             "fwd", "day_ret"]].to_string(index=False))
    if len(traded):
        hr = traded["right"].mean()
        lo, hi = wilson(hr, len(traded))
        print(f"\ntraded {len(traded)}/{len(R)} days; hit={hr:.3f} wilson=[{lo:.3f},{hi:.3f}]"
              f"; beats +0.30% cost: {traded['beats_cost'].mean():.3f}"
              f" | mean signed fwd: {traded['ret_signed'].mean():+.3f}%")
    print(f"\nsnapshots -> {SNAP_CSV}")


if __name__ == "__main__":
    main()

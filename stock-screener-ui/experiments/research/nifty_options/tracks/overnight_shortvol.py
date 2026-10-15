"""Track E — overnight-only, defined-risk short-vol with a gap tail hedge.

Hypothesis
----------
The overnight variance risk premium is real gross (realised |gap| < implied move),
but front-month execution eats the *ATM* theta (Track C). Pushing the short strike
OTM and buying cheap far wings (a short iron condor) should (a) keep the short-vol
edge while (b) capping the gap tail, so the account cannot blow up on one gap.

Structures
----------
* naked   : short CE at +d%, short PE at -d%.
* winged  : naked short strangle + long CE at +(d%+w), long PE at -(d%+w).
            max loss per lot = w*lot - net credit.
* skew    : Track B's deferred trade — short rich put vertical + long cheap call
            vertical (defined risk), overnight. Directional (long delta) by
            construction; reported honestly.

Causality: entry signal at day-D 15:00 uses only data <= D (prior-day features via
shift). Fill = option close at 15:00 / next session 09:30, via the shared
ExecutionModel. No intraday monitoring (you cannot stop out while closed); the
tail hedge is the risk control.

Usage: python tracks/overnight_shortvol.py [real|synthetic]
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
import fyers_data as fd  # noqa: E402
import stats as st  # noqa: E402
from costs import ExecutionModel, round_trip_costs, spread_margin_per_lot, short_margin_per_lot  # noqa: E402
from engine import ExpiryResolver, RealOptionSource, SyntheticOptionSource  # noqa: E402

CAPITAL = 300_000.0
LOT = 65
STEP = 50
EX = ExecutionModel()
ENTRY_TIME = "15:00"
EXIT_TIME = "09:30"

REAL_START, REAL_END = date(2026, 6, 1), date(2026, 9, 25)
SYN_START, SYN_END = date(2018, 1, 1), date(2026, 9, 25)
TRAIN_END = date(2022, 12, 31)


# ---------------------------------------------------------------------------
# session setup
# ---------------------------------------------------------------------------
_SESS_CACHE: dict[str, tuple] = {}


def load_sessions(mode):
    if mode in _SESS_CACHE:
        return _SESS_CACHE[mode]
    spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    if mode == "real":
        src = RealOptionSource()
        man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
        by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
        resolver = ExpiryResolver(list(by_exp.keys()), by_exp)
    else:
        src = SyntheticOptionSource.from_cached()
        import runner as R
        resolver = R.build_weekly_resolver(SYN_START, SYN_END)
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    _SESS_CACHE[mode] = (src, resolver, spot, by_day)
    return _SESS_CACHE[mode]


def _fills(prices, sides, mode):
    out = []
    for p, s in zip(prices, sides):
        touch = EX.half_spread_pct + EX.slippage_pct
        if mode == "entry":
            out.append(p * (1 + touch) if s == "BUY" else max(0.05, p * (1 - touch)))
        else:
            out.append(max(0.05, p * (1 - touch)) if s == "BUY" else p * (1 + touch))
    return out


def _leg_symbol(mode, src, exp, strike, opt, weekly):
    if mode == "real":
        return fd.nifty_symbol(exp, int(strike), opt, weekly=weekly)
    return {"opt": opt, "strike": int(strike), "expiry": exp, "symbol": f"{opt}{strike}"}


def _price(mode, src, exp, strike, opt, weekly, ts, spot):
    leg = _leg_symbol(mode, src, exp, strike, opt, weekly)
    if isinstance(leg, str):
        leg = {"symbol": leg}
    return src.leg_price(ts, leg, spot, field="close")


def _structure(structure, spot, d_pct, wing_pts):
    """Return list of (opt, side, strike). d_pct in %, wing_pts in points."""
    atm = int(round(spot / STEP) * STEP)
    d_steps = int(round(d_pct / 100.0 * spot / STEP))
    w_steps = int(round(wing_pts / STEP))
    Kcs, Kps = atm + d_steps * STEP, atm - d_steps * STEP
    if structure == "naked":
        return [("CE", "SELL", Kcs), ("PE", "SELL", Kps)]
    if structure == "winged":
        return [("CE", "SELL", Kcs), ("PE", "SELL", Kps),
                ("CE", "BUY", Kcs + w_steps * STEP), ("PE", "BUY", Kps - w_steps * STEP)]
    if structure == "skew":
        # short rich put vertical (credit) + long cheap call vertical (debit)
        # sell PE at -(d), buy PE at -(d+w); buy CE at +(d), sell CE at +(d+w)
        return [("PE", "SELL", Kps), ("PE", "BUY", Kps - w_steps * STEP),
                ("CE", "BUY", Kcs), ("CE", "SELL", Kcs + w_steps * STEP)]
    raise ValueError(structure)


def run(mode, structure, d_pct, wing_pts, start, end, exit_time=EXIT_TIME):
    src, resolver, spot, by_day = load_sessions(mode)
    days = sorted(d for d in by_day if start <= d <= end)
    rows = []
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None or exp < nd:            # never hold through expiry
            continue
        weekly = resolver.is_weekly(exp)
        eb, xb = by_day[d], by_day[nd]
        ec = eb.index[eb.index.time <= pd.Timestamp(ENTRY_TIME).time()]
        xc = xb.index[xb.index.time >= pd.Timestamp(exit_time).time()]
        if len(ec) == 0 or len(xc) == 0:
            continue
        et, xt = ec[-1], xc[0]
        es, xs = float(spot.at[et, "close"]), float(spot.at[xt, "close"])
        legs = _structure(structure, es, d_pct, wing_pts)

        pin, pout = [], []
        for opt, side, K in legs:
            pi = _price(mode, src, exp, K, opt, weekly, et, es)
            po = _price(mode, src, exp, K, opt, weekly, xt, xs)
            if pi is None or po is None:
                pin = None
                break
            pin.append(pi)
            pout.append(po)
        if pin is None:
            continue
        sides = [l[1] for l in legs]
        fin = _fills(pin, sides, "entry")
        fout = _fills(pout, sides, "exit")
        gross = sum((1 if s == "BUY" else -1) * (fo - fi) * LOT
                    for s, fi, fo in zip(sides, fin, fout))
        fees = sum(round_trip_costs(pe, px, LOT, s) for pe, px, s in zip(pin, pout, sides))
        # entry net credit/debit (signed cash: SELL collects +, BUY pays -)
        entry_cash = sum((1 if s == "SELL" else -1) * fi * LOT for s, fi in zip(sides, fin))
        width = wing_pts if structure in ("winged", "skew") else None
        max_loss = (width * LOT - entry_cash) if wings_defined(structure, wing_pts) else None
        rows.append({
            "date": str(d), "expiry": exp.isoformat(), "spot_in": es, "spot_out": xs,
            "move": xs - es, "structure": structure, "d_pct": d_pct, "wing_pts": wing_pts,
            "strikes": tuple(l[2] for l in legs), "entry_cash": entry_cash,
            "gross": gross, "fees": fees, "net": gross - fees,
            "max_loss": max_loss,
            "dist_c": int(legs[0][2] - round(es / STEP) * STEP),
            "dist_p": int(round(es / STEP) * STEP - legs[1][2]),
        })
    return pd.DataFrame(rows)


def wings_defined(structure, wing_pts):
    return structure in ("winged", "skew") and wing_pts > 0


# ---------------------------------------------------------------------------
# causal daily features
# ---------------------------------------------------------------------------
def _expanding_rank(s: pd.Series) -> pd.Series:
    """Percentile of the *current* value among prior+current values (causal)."""
    out = np.full(len(s), np.nan)
    vals = s.to_numpy(dtype=float)
    for i in range(len(vals)):
        prior = vals[: i + 1]
        prior = prior[~np.isnan(prior)]
        if len(prior) >= 10 and not np.isnan(vals[i]):
            out[i] = float((prior <= vals[i]).mean())
    return pd.Series(out, index=s.index)


def build_features(mode, start, end):
    spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    daily = spot.groupby(spot.index.date)["close"].last()
    ret = np.log(daily / daily.shift(1))
    absret = ret.abs()
    med = absret.expanding(min_periods=10).median()
    f = pd.DataFrame({"ret": ret, "absret": absret, "med_absret": med})
    f.index = pd.to_datetime(f.index)
    f["prior_absret"] = absret.shift(1).values
    f["calm_med"] = med.shift(1).values
    f["calm"] = f["prior_absret"] < f["calm_med"]
    f["dow"] = f.index.dayofweek

    if mode == "real":
        m = pd.read_parquet(fd.CACHE_DIR / "surface_metrics_daily.parquet")
        m = m.sort_values("dte").groupby("date").first().reset_index()  # front expiry
        m["date"] = pd.to_datetime(m["date"])
        m = m.set_index("date")
        f["ivr"] = m["vrp_ratio"].reindex(f.index).values
        f["atm_iv"] = m["atm_iv"].reindex(f.index).values
        f["ivr_prior"] = pd.Series(f["ivr"], index=f.index).shift(1)
        f["ivr_rank"] = _expanding_rank(f["ivr"].shift(1))
        f["ivr_med"] = f["ivr_prior"].expanding(min_periods=10).median()
    else:
        # causal iv/rv proxy from the synthetic source's own IV + 20d realised
        src = SyntheticOptionSource.from_cached()
        iv_day = src.iv.groupby(src.iv.index.date).last()
        iv_day.index = pd.to_datetime(iv_day.index)
        rv = ret.rolling(20).std() * np.sqrt(252)
        f["ivr"] = (iv_day.reindex(f.index) / rv).values
        f["ivr_prior"] = pd.Series(f["ivr"], index=f.index).shift(1)
        f["ivr_rank"] = _expanding_rank(f["ivr"].shift(1))
        f["ivr_med"] = f["ivr_prior"].expanding(min_periods=10).median()
    return f


FILTERS = {
    "all": lambda r: True,
    "calm": lambda r: bool(r["calm"]) if r["calm"] == r["calm"] else False,
    "volatile": lambda r: (not bool(r["calm"])) if r["calm"] == r["calm"] else False,
    "ivr_low": lambda r: bool(r["ivr_rank"] < 0.5) if r["ivr_rank"] == r["ivr_rank"] else False,
    "ivr_high": lambda r: bool(r["ivr_rank"] >= 0.5) if r["ivr_rank"] == r["ivr_rank"] else False,
    "calm_ivr_low": lambda r: (bool(r["calm"]) and bool(r["ivr_rank"] < 0.5))
                    if r["calm"] == r["calm"] and r["ivr_rank"] == r["ivr_rank"] else False,
    "calm_ivr_high": lambda r: (bool(r["calm"]) and bool(r["ivr_rank"] >= 0.5))
                    if r["calm"] == r["calm"] and r["ivr_rank"] == r["ivr_rank"] else False,
    "dow_mon": lambda r: r["dow"] == 0,
    "dow_tue": lambda r: r["dow"] == 1,
    "dow_wed": lambda r: r["dow"] == 2,
    "dow_thu": lambda r: r["dow"] == 3,
    "dow_fri": lambda r: r["dow"] == 4,
    "calm_notmon": lambda r: bool(r["calm"]) and r["dow"] != 0,
}


def apply_filter(df, feats, name):
    if df.empty:
        return df
    idx = pd.to_datetime(df["date"])
    fn = FILTERS[name]
    mask = []
    for d in idx:
        if d in feats.index:
            mask.append(fn(feats.loc[d]))
        else:
            mask.append(False)
    return df[np.array(mask, dtype=bool)]


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------
def full_stats(df, label, train_end=None):
    if df.empty or len(df) < 2:
        return {"label": label, "n": int(len(df))}
    net = df["net"].to_numpy(dtype=float)
    s = st.summarize(net, CAPITAL)
    boot = st.bootstrap(net, CAPITAL)
    dates = pd.to_datetime(df["date"]).tolist()
    wk = st.weekly(net, dates, CAPITAL)
    ror = st.risk_of_ruin(net, CAPITAL)
    out = {
        "label": label, "n": int(len(net)),
        "net_exp": float(net.mean()), "pf": s.get("profit_factor"),
        "win": s.get("win_rate"), "total_net": float(net.sum()),
        "max_drawdown_inr": s.get("max_drawdown"),
        "max_drawdown_pct": abs(s.get("max_drawdown", 0.0)) / CAPITAL,
        "worst_overnight_inr": float(net.min()),
        "worst_overnight_pct": float(net.min()) / CAPITAL,
        "tail_loss_p95": float(np.percentile(net, 5)),
        "bootstrap_ci": [boot.get("ci_low_mean"), boot.get("ci_high_mean")],
        "p_positive_total": boot.get("p_positive_total"),
        "risk_of_ruin": ror,
        "avg_week": wk.get("avg_week"), "worst_week": wk.get("worst_week"),
        "capital_for_15k_week": wk.get("target_15k_avg_capital"),
        "gross_exp": float(df["gross"].mean()), "fees_exp": float(df["fees"].mean()),
        "avg_entry_cash": float(df["entry_cash"].mean()),
    }
    out["raw_dir_accuracy"] = raw_dir_accuracy(df)
    out["inside_strikes_rate"] = inside_strikes_rate(df)
    if train_end is not None:
        tr = df[pd.to_datetime(df["date"]).dt.date <= train_end]
        te = df[pd.to_datetime(df["date"]).dt.date > train_end]
        out["train_n"] = int(len(tr))
        out["test_n"] = int(len(te))
        out["train_exp"] = float(tr["net"].mean()) if len(tr) else None
        out["test_exp"] = float(te["net"].mean()) if len(te) else None
    return out


def raw_dir_accuracy(df):
    """Brief's literal metric: sign = +1 if first leg is CE else -1, then P(move*sign > 0).

    For a symmetric short strangle this reduces to P(spot up) and is uninformative;
    the structural metric is ``inside_strikes_rate``.
    """
    if df.empty:
        return float("nan")
    sgn = 1.0 if df["strikes"].iloc[0][0] == "CE" or df["structure"].iloc[0] in ("naked", "winged") else -1.0
    mv = (df["spot_out"] - df["spot_in"]).to_numpy(dtype=float)
    return float((mv * sgn > 0).mean())


def inside_strikes_rate(df):
    """P(next-session spot closes between the two short strikes) — the short-vol metric."""
    if df.empty:
        return float("nan")
    structure = df["structure"].iloc[0]
    mv = (df["spot_out"] - df["spot_in"]).to_numpy(dtype=float)
    if structure in ("naked", "winged"):
        d_c = df["dist_c"].to_numpy(dtype=float)
        d_p = df["dist_p"].to_numpy(dtype=float)
        return float(((mv < d_c) & (mv > -d_p)).mean())
    return float("nan")


# ---------------------------------------------------------------------------
# implied vs realised move
# ---------------------------------------------------------------------------
def gap_diagnostics(mode, df):
    """ATM straddle implied move vs realised 15:00->09:30 move."""
    src, resolver, spot, by_day = load_sessions(mode)
    out = []
    for _, row in df.iterrows():
        d = date.fromisoformat(row["date"])
        days = sorted(by_day)
        k = days.index(d) if d in days else None
        if k is None or k + 1 >= len(days):
            continue
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None:
            continue
        weekly = resolver.is_weekly(exp)
        eb, xb = by_day[d], by_day[nd]
        ec = eb.index[eb.index.time <= pd.Timestamp(ENTRY_TIME).time()]
        xc = xb.index[xb.index.time >= pd.Timestamp(EXIT_TIME).time()]
        if len(ec) == 0 or len(xc) == 0:
            continue
        et, xt = ec[-1], xc[0]
        es, xs = float(spot.at[et, "close"]), float(spot.at[xt, "close"])
        atm = int(round(es / STEP) * STEP)
        pce = _price(mode, src, exp, atm, "CE", weekly, et, es)
        ppe = _price(mode, src, exp, atm, "PE", weekly, et, es)
        if pce is None or ppe is None:
            continue
        implied = pce + ppe
        dte = max((exp - d).days, 1)
        # scale the multi-day straddle to a one-night expected move
        implied_1n = implied / np.sqrt(dte)
        out.append({"date": row["date"], "implied": implied, "implied_1night": implied_1n,
                    "realised": abs(xs - es), "dte": dte})
    g = pd.DataFrame(out)
    if g.empty:
        return {}
    return {
        "n": int(len(g)),
        "mean_implied_straddle_pts": float(g["implied"].mean()),
        "mean_implied_1night_pts": float(g["implied_1night"].mean()),
        "mean_realised_abs_pts": float(g["realised"].mean()),
        "hit_rate_realised_lt_implied_1night": float((g["realised"] < g["implied_1night"]).mean()),
        "ratio_realised_over_implied_1night": float(g["realised"].mean() / g["implied_1night"].mean()),
        "median_dte_at_entry": float(g["dte"].median()),
    }


# ---------------------------------------------------------------------------
# sweep driver
# ---------------------------------------------------------------------------
LOG = HERE / "overnight_shortvol_log.jsonl"


def _json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def log(rec):
    with LOG.open("a") as fh:
        fh.write(json.dumps(rec, default=_json_default) + "\n")


def grid(mode, start, end, train_end=None, structures=("naked", "winged"),
         d_pcts=(0.5, 0.75, 1.0, 1.25), wing_pts_sweep=(50, 100, 150, 200, 250),
         filter_names=tuple(FILTERS)):
    feats = build_features(mode, start, end)
    results = []
    for stx in structures:
        combos = [(d, 0) for d in d_pcts] if stx == "naked" else \
            [(d, w) for d in d_pcts for w in wing_pts_sweep]
        for (d_pct, w) in combos:
            df = run(mode, stx, d_pct, w, start, end)
            if df.empty:
                continue
            base = full_stats(df, f"{stx}_d{d_pct}_w{w}|all", train_end)
            base["structure"] = stx
            base["d_pct"] = d_pct
            base["wing_pts"] = w
            base["filter"] = "all"
            base["mode"] = mode
            results.append(base)
            log(base)
            for fn in filter_names:
                if fn == "all":
                    continue
                sub = apply_filter(df, feats, fn)
                s = full_stats(sub, f"{stx}_d{d_pct}_w{w}|{fn}", train_end)
                s.update({"structure": stx, "d_pct": d_pct, "wing_pts": w,
                          "filter": fn, "mode": mode})
                results.append(s)
                log(s)
    return pd.DataFrame(results)


def run_skew(mode, start, end, train_end=None, d_pcts=(0.5, 0.75, 1.0), wings=(50, 100, 150),
             filter_names=("all", "calm", "ivr_low", "ivr_high", "calm_ivr_low")):
    feats = build_features(mode, start, end)
    out = []
    for d in d_pcts:
        for w in wings:
            df = run(mode, "skew", d, w, start, end)
            if df.empty:
                continue
            s = full_stats(df, f"{mode}_skew_d{d}_w{w}|all", train_end)
            s.update({"structure": "skew", "d_pct": d, "wing_pts": w, "filter": "all", "mode": mode})
            # mean net delta proxy: report P(up) as raw dir accuracy already
            out.append(s); log(s)
            for fn in filter_names:
                if fn == "all":
                    continue
                sub = apply_filter(df, feats, fn)
                ss = full_stats(sub, f"{mode}_skew_d{d}_w{w}|{fn}", train_end)
                ss.update({"structure": "skew", "d_pct": d, "wing_pts": w, "filter": fn, "mode": mode})
                out.append(ss); log(ss)
    return pd.DataFrame(out)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "real"
    start, end = (REAL_START, REAL_END) if mode == "real" else (SYN_START, SYN_END)
    tr = None if mode == "real" else TRAIN_END
    print(f"== sweep {mode} ==")
    g = grid(mode, start, end, train_end=tr)
    g.to_parquet(HERE / f"_shortvol_grid_{mode}.parquet", index=False)
    print(f"{len(g)} config-filter rows -> _shortvol_grid_{mode}.parquet")
    sk = run_skew(mode, start, end, train_end=tr)
    sk.to_parquet(HERE / f"_shortvol_skew_{mode}.parquet", index=False)
    print(f"{len(sk)} skew rows")


if __name__ == "__main__":
    main()


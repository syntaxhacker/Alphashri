"""Track C — Intraday & overnight implied-vol dynamics / IV crush.

Questions
  1. Intraday ATM-IV shape: does IV rise into the close / fall at the open?
     Overnight straddle/strangle P&L (sell close -> buy open, and mirror).
  2. IV crush into expiry: does front ATM IV collapse as DTE->0? Is shorting the
     front expiry into expiry +EV? Rule: short front strangle when IV > trailing median.
  3. IV vs the previous day's realised move: buy vol after calm, sell after volatile.

Causal: a signal at bar i uses only completed bars <= i; fills at the next
observable bar. For overnight trades the entry is the 15:00 close (observed) and
the exit is the next session 09:30 close (observed). Costs (fees+spread+slippage)
are charged on every leg by the shared ExecutionModel.

Outputs: tracks/iv_dynamics.json/.md/.jsonl (see AGENT_BRIEF.md).
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, time as dtime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

import fyers_data as fd  # noqa: E402
import stats as st  # noqa: E402
import pricing  # noqa: E402
import mispricing  # noqa: E402
import runner as R  # noqa: E402
from engine import (ExpiryResolver, RealOptionSource, SyntheticOptionSource,  # noqa: E402
                    build_legdicts, has_data, Leg)
from costs import ExecutionModel, round_trip_costs  # noqa: E402

LOT = 65
CAP = 300_000.0
EX = ExecutionModel()
CACHE = fd.CACHE_DIR
TRACK = "iv_dynamics"
LOG = HERE / f"{TRACK}_log.jsonl"

REAL_START = date(2026, 6, 1)
REAL_END = date(2026, 9, 25)
SYN_START = date(2018, 1, 1)
SYN_END = date(2026, 9, 25)

# --------------------------------------------------------------------------- io
def _spot_1m() -> pd.DataFrame:
    df = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    t = df.index.time
    return df[(t >= dtime(9, 15)) & (t <= dtime(15, 29))]


def _real_resolver() -> ExpiryResolver:
    man = json.loads((CACHE / "option_manifest.json").read_text())
    by_exp = {date.fromisoformat(c["expiry"]): bool(c["weekly"]) for c in man["contracts"]}
    return ExpiryResolver(list(by_exp.keys()), by_exp), by_exp


def _atm_from_surface() -> pd.DataFrame:
    """ATM IV per (date, expiry, 30-min bucket) from the 30-min real surface."""
    p = CACHE / "iv_atm_30m.parquet"
    if not p.exists():
        raise SystemExit("run tracks/build_iv30.py first")
    return pd.read_parquet(p)


def _stats(net, capital=CAP, dates=None) -> dict:
    net = np.asarray([x for x in net if x == x], dtype=float)
    if len(net) == 0:
        return {"n": 0}
    s = st.summarize(net, capital)
    b = st.bootstrap(net, capital) if len(net) >= 5 else {}
    s["bootstrap_ci"] = [b.get("ci_low_mean", float("nan")), b.get("ci_high_mean", float("nan"))]
    s["p_positive_total"] = b.get("p_positive_total", float("nan"))
    if dates is not None:
        s["weekly"] = st.weekly(net, dates, capital)
    return s


def _raw_dir(trades) -> tuple[float, float]:
    """Brief's raw directional accuracy (legs[0] = CE) + signed mean spot move."""
    if not trades:
        return float("nan"), float("nan")
    sgn = np.array([1 if t["legs"][0]["opt"] == "CE" else -1 for t in trades])
    mv = np.array([(t["spot_exit"] - t["spot_entry"]) for t in trades]) * sgn
    return float((mv > 0).mean()), float(mv.mean())


def log_exp(rec: dict):
    with LOG.open("a") as f:
        f.write(json.dumps(rec, default=str) + "\n")


# ------------------------------------------------------------------- overnight
def real_overnight(src, resolver, spot, start, end, offsets=(0, 1, 2, 3), action="sell",
                   entry_hm="15:00", exit_hm="09:30") -> pd.DataFrame:
    """Sell (or buy) an ATM straddle (offsets=0) / strangle at entry_hm, exit next open."""
    days = sorted({d for d in spot.index.date if start <= d <= end})
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    ent_t = pd.Timestamp(entry_hm).time()
    ext_t = pd.Timestamp(exit_hm).time()
    rows = []
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None:
            continue
        g, ng = by_day[d], by_day.get(nd)
        if ng is None or g.empty or ng.empty:
            continue
        ec = g.index[g.index.time <= ent_t]
        xc = ng.index[ng.index.time >= ext_t]
        if len(ec) == 0 or len(xc) == 0:
            continue
        ent_ts, ext_ts = ec[-1], xc[0]
        S0 = float(g.at[ent_ts, "close"])
        S1 = float(ng.at[ext_ts, "close"])
        weekly = resolver.is_weekly(exp)
        legs = build_legdicts([Leg("CE", "BUY", o) for o in offsets] +
                              [Leg("PE", "BUY", -o) for o in offsets],
                              exp, S0, 50, weekly)
        if any(not has_data(src, l["symbol"]) for l in legs):
            continue
        pe = [src.leg_price(ent_ts, l, S0, field="close") for l in legs]
        px = [src.leg_price(ext_ts, l, S1, field="close") for l in legs]
        if any(p is None for p in pe) or any(p is None for p in px):
            continue
        # leg ratios: offsets=(0,) -> straddle (1 CE + 1 PE); offsets=(0,1,2)->ladders
        bid_e = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in pe]
        ask_e = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in pe]
        bid_x = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in px]
        ask_x = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in px]
        if action == "sell":
            entry, exit_ = sum(bid_e), sum(ask_x)
            gross = (entry - exit_) * LOT
            side_in, side_out = "SELL", "BUY"
        else:
            entry, exit_ = sum(ask_e), sum(bid_x)
            gross = (exit_ - entry) * LOT
            side_in, side_out = "BUY", "SELL"
        fees = sum(round_trip_costs(a, b, LOT, side_in) for a, b in zip(pe, px))
        rows.append({"date": d, "expiry": exp, "entry_ts": ent_ts, "exit_ts": ext_ts,
                     "n_legs": len(legs), "spot_entry": S0, "spot_exit": S1,
                     "gap_pts": S1 - S0, "entry_net": entry, "exit_net": exit_,
                     "gross": gross, "fees": fees, "net": gross - fees,
                     "mtm_iv_in": None, "mtm_iv_out": None,
                     "legs": legs})
    return pd.DataFrame(rows)


# ------------------------------------------------------- straddle IV decomposition
def _straddle_iv(price_mid, S, K, T):
    from scipy.optimize import brentq
    if price_mid is None or price_mid <= 0 or T <= 1e-9:
        return None
    f = lambda s: (pricing.bs_price(S, K, T, s, "CE") + pricing.bs_price(S, K, T, s, "PE")) - price_mid
    try:
        if f(1e-4) * f(3.0) > 0:
            return None
        return float(brentq(f, 1e-4, 3.0, xtol=1e-5, maxiter=60))
    except Exception:
        return None


def overnight_decomposition(src, resolver, spot, start, end, entry_hm="15:00", exit_hm="09:30"):
    """Split the ATM straddle long P&L into theta / gamma-move / IV-residual / costs."""
    days = sorted({d for d in spot.index.date if start <= d <= end})
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    ent_t = pd.Timestamp(entry_hm).time(); ext_t = pd.Timestamp(exit_hm).time()
    out = []
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None:
            continue
        g, ng = by_day[d], by_day.get(nd)
        if ng is None or g.empty or ng.empty:
            continue
        ec = g.index[g.index.time <= ent_t]; xc = ng.index[ng.index.time >= ext_t]
        if len(ec) == 0 or len(xc) == 0:
            continue
        ent_ts, ext_ts = ec[-1], xc[0]
        S0 = float(g.at[ent_ts, "close"]); S1 = float(ng.at[ext_ts, "close"])
        weekly = resolver.is_weekly(exp)
        legs = build_legdicts([Leg("CE", "BUY", 0), Leg("PE", "BUY", 0)], exp, S0, 50, weekly)
        if any(not has_data(src, l["symbol"]) for l in legs):
            continue
        pe = [src.leg_price(ent_ts, l, S0, field="close") for l in legs]
        px = [src.leg_price(ext_ts, l, S1, field="close") for l in legs]
        if any(p is None for p in pe) or any(p is None for p in px):
            continue
        K = legs[0]["strike"]
        T0 = pricing.t_years(ent_ts, exp); T1 = pricing.t_years(ext_ts, exp)
        mid0 = float(pe[0] + pe[1]); mid1 = float(px[0] + px[1])
        iv = _straddle_iv(mid0, S0, K, T0)
        if iv is None:
            continue
        fair_at_entry_T1 = pricing.bs_price(S0, K, T1, iv, "CE") + pricing.bs_price(S0, K, T1, iv, "PE")
        fair_at_exit_S1 = pricing.bs_price(S1, K, T1, iv, "CE") + pricing.bs_price(S1, K, T1, iv, "PE")
        theta_long = fair_at_entry_T1 - mid0            # <0 for long
        gamma_move = fair_at_exit_S1 - fair_at_entry_T1  # >0 if |move| big
        iv_resid = mid1 - fair_at_exit_S1
        out.append({"date": d, "expiry": exp, "spot_entry": S0, "spot_exit": S1,
                    "gap_pts": S1 - S0, "straddle_in": mid0, "straddle_out": mid1,
                    "iv_in": iv, "T0": T0, "T1": T1,
                    "implied_move_pts": mid0,
                    "theta_long": theta_long, "gamma_move": gamma_move,
                    "iv_resid": iv_resid, "total_long_mid": mid1 - mid0})
    return pd.DataFrame(out)


# --------------------------------------------------------------- daily generic
def synth_daily_trades(src, resolver, spot, start, end, action="sell", offsets=(0,),
                       entry_hm="15:00", hold="next_day", condition=None,
                       cond_lookback=10) -> pd.DataFrame:
    """Daily synthetic-premium strangle/straddle. ``condition(feature, hist)`` -> bool."""
    days = sorted({d for d in spot.index.date if start <= d <= end})
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    ent_t = pd.Timestamp(entry_hm).time()
    iv_series = src.iv
    rows = []
    iv_hist: list[float] = []
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None:
            continue
        g = by_day[d]
        ec = g.index[g.index.time <= ent_t]
        if len(ec) == 0:
            continue
        ent_ts = ec[-1]
        S0 = float(g.at[ent_ts, "close"])
        # causal IV feature (observed at entry timestamp)
        iv_now = float(iv_series.asof(ent_ts)) if iv_series.asof(ent_ts) == iv_series.asof(ent_ts) else np.nan
        if condition is not None:
            if not condition(iv_now, iv_hist):
                iv_hist.append(iv_now)
                continue
        # exit bar
        if hold == "next_day":
            ng = by_day.get(nd)
            if ng is None:
                continue
            exit_day = nd
        else:  # hold to expiry (last available bar on/after expiry; expiry may be future)
            exit_day = exp if exp in by_day else None
            if exit_day is None or exit_day < d:
                # use last available trading day <= expiry
                cands = [x for x in days if x <= exp]
                if not cands:
                    continue
                exit_day = cands[-1]
            ng = by_day.get(exit_day)
            if ng is None or exit_day < d:
                continue
        ext_ts = ng.index[-1]  # exit at session close
        S1 = float(ng.at[ext_ts, "close"])
        weekly = resolver.is_weekly(exp)
        legs = build_legdicts([Leg("CE", "BUY", o) for o in offsets] +
                              [Leg("PE", "BUY", -o) for o in offsets],
                              exp, S0, 50, weekly)
        pe = [src.leg_price(ent_ts, l, S0) for l in legs]
        px = [src.leg_price(ext_ts, l, S1) for l in legs]
        if any(p is None for p in pe) or any(p is None for p in px):
            iv_hist.append(iv_now); continue
        bid_e = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in pe]
        ask_e = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in pe]
        bid_x = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in px]
        ask_x = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in px]
        if action == "sell":
            entry, exit_ = sum(bid_e), sum(ask_x); gross = (entry - exit_) * LOT
            side_in = "SELL"
        else:
            entry, exit_ = sum(ask_e), sum(bid_x); gross = (exit_ - entry) * LOT
            side_in = "BUY"
        fees = sum(round_trip_costs(a, b, LOT, side_in) for a, b in zip(pe, px))
        rows.append({"date": d, "exit_day": exit_day, "expiry": exp, "entry_ts": ent_ts,
                     "spot_entry": S0, "spot_exit": S1, "iv_in": iv_now,
                     "entry_net": entry, "exit_net": exit_, "gross": gross,
                     "fees": fees, "net": gross - fees, "legs": legs})
        iv_hist.append(iv_now)
    return pd.DataFrame(rows)


def _summ(df, label, capital=CAP):
    if df is None or df.empty:
        return {"label": label, "n": 0}
    net = df["net"].to_numpy()
    trades = df.to_dict("records")
    raw_acc, raw_move = _raw_dir(trades)
    s = _stats(net, capital, list(pd.to_datetime(df["date"])))
    s.update({"label": label, "gross_mean": float(df["gross"].mean()),
              "fees_mean": float(df["fees"].mean()),
              "raw_dir_accuracy": raw_acc, "raw_mean_move_pts": raw_move,
              "max_drawdown_pct_cap": float(s.get("max_drawdown", 0.0) / capital),
              "tail_loss_p95": float(np.percentile(net, 5))})
    return s


# ============================================================================ main
def main():
    if LOG.exists():
        LOG.unlink()
    spot = _spot_1m()
    real_src = RealOptionSource()
    real_res, _ = _real_resolver()
    surf30 = _atm_from_surface()
    synth_src = SyntheticOptionSource.from_cached()
    synth_res = R.build_weekly_resolver(SYN_START, SYN_END)

    results = {}

    # ---------------- Part 1: intraday IV shape (real 30-min surface) ----------
    atm = surf30.copy()
    atm["hm"] = pd.to_datetime(atm["ts"]).dt.strftime("%H:%M")
    atm["date"] = pd.to_datetime(atm["date"])
    front = atm[atm["dte"] == atm.groupby("date")["dte"].transform("min")]
    piv = front.pivot_table(index="date", columns="hm", values="atm_iv")
    intraday_path = (piv.mean() * 100).round(3).to_dict()

    w = atm.pivot_table(index=["date", "expiry"], columns="hm", values="atm_iv").reset_index()
    w = w.sort_values(["expiry", "date"])
    w["d_iv_intra"] = (w["15:00"] - w["09:30"]) * 100
    w["iv_prev_close"] = w.groupby("expiry")["15:00"].shift(1)
    w["d_iv_overnight"] = (w["09:30"] - w["iv_prev_close"]) * 100
    # VIX (real) intraday shape, for cross-check
    vix = pd.read_parquet(fd.CANDLE_DIR / "NSE_INDIAVIX-INDEX__1.parquet").set_index("ts").sort_index()
    vix = vix[(vix.index.time >= dtime(9, 15)) & (vix.index.time <= dtime(15, 29))]
    vd = vix["close"].copy()
    vd_hm = pd.to_datetime(vd.index).strftime("%H:%M")
    vix_close = vd.groupby(vd_hm).mean()

    # overnight IV-dynamics descriptive (same expiry, real)
    oiv = w.dropna(subset=["d_iv_overnight"])
    intraday_desc = {
        "n_dates": int(front["date"].nunique()),
        "front_path_iv_pct_by_bucket": intraday_path,
        "front_0930_to_1500_volpts_mean": float(((piv["15:00"] - piv["09:30"]) * 100).mean()),
        "front_0930_to_1500_volpts_median": float(((piv["15:00"] - piv["09:30"]) * 100).median()),
        "front_0930_to_1500_volpts_sd": float(((piv["15:00"] - piv["09:30"]) * 100).std()),
        "overnight_same_expiry_volpts_mean": float(oiv["d_iv_overnight"].mean()),
        "overnight_same_expiry_volpts_median": float(oiv["d_iv_overnight"].median()),
        "overnight_same_expiry_volpts_sd": float(oiv["d_iv_overnight"].std()),
        "overnight_frac_iv_falls": float((oiv["d_iv_overnight"] < 0).mean()),
        "vix_avg_by_bucket": (vix_close.round(3)).to_dict(),
    }
    results["intraday_iv_shape"] = intraday_desc
    log_exp({"exp": "intraday_iv_shape", **intraday_desc})

    # ---------------- Part 1b: overnight trades (real) ------------------------
    for offs, name in [((0,), "straddle"), ((1,), "strangle_1"),
                       ((2,), "strangle_2"), ((3,), "strangle_3")]:
        for act in ("sell", "buy"):
            df = real_overnight(real_src, real_res, spot, REAL_START, REAL_END,
                                offsets=offs, action=act)
            results[f"real_overnight_{name}_{act}"] = _summ(df, f"real_overnight_{name}_{act}")
            log_exp({"exp": "real_overnight", "structure": name, "action": act,
                     **{k: v for k, v in results[f"real_overnight_{name}_{act}"].items()
                        if not isinstance(v, (dict, list))}})

    # decomposition of the real ATM straddle overnight move
    dec = overnight_decomposition(real_src, real_res, spot, REAL_START, REAL_END)
    if not dec.empty:
        results["real_overnight_decomposition"] = {
            "n": int(len(dec)),
            "straddle_in_mean": float(dec["straddle_in"].mean()),
            "abs_gap_mean": float(dec["gap_pts"].abs().mean()),
            "implied_move_mean": float(dec["implied_move_pts"].mean()),
            "theta_long_mean": float(dec["theta_long"].mean()),
            "gamma_move_long_mean": float(dec["gamma_move"].mean()),
            "iv_resid_long_mean": float(dec["iv_resid"].mean()),
            "total_long_mid_mean": float(dec["total_long_mid"].mean()),
            "realized_over_straddle": float(dec["gap_pts"].abs().mean() / dec["straddle_in"].mean()),
        }
        dec.to_csv(HERE / "iv_overnight_decomposition.csv", index=False)
        log_exp({"exp": "real_overnight_decomposition", **results["real_overnight_decomposition"]})
        results["real_overnight_decomposition"]["_dec"] = dec

    # ---------------- Part 2: IV crush into expiry ----------------------------
    # (a) real: does front IV fall as DTE->0? cross-section by DTE
    iv_by_dte = (atm.groupby("dte")["atm_iv"].agg(["count", "mean", "median"]).reset_index()
                 .query("count >= 3"))
    results["real_iv_by_dte"] = iv_by_dte.round(5).to_dict("records")
    # (b) real rule: short front strangle when IV > trailing median, 1-day hold
    def cond_rich(iv_now, hist, lb=10):
        if len(hist) < lb or iv_now != iv_now:
            return False
        return iv_now > float(np.median(hist[-lb:]))
    cond_df = real_overnight_cond(real_src, real_res, spot, REAL_START, REAL_END, cond_rich, offsets=(1,), action="sell")
    results["real_short_strangle_rich_iv"] = _summ(cond_df, "real_short_strangle_rich_iv")
    log_exp({"exp": "real_short_strangle_rich_iv",
             **{k: v for k, v in results["real_short_strangle_rich_iv"].items() if not isinstance(v, (dict, list))}})

    # (c) synthetic anchor: hold to expiry (theta/expiry crush), unconditional + rich-conditioned
    syn_uncond = synth_daily_trades(synth_src, synth_res, spot, SYN_START, SYN_END,
                                    action="sell", offsets=(1,), hold="to_expiry")
    results["synth_short_strangle_to_expiry"] = _summ(syn_uncond, "synth_short_strangle_to_expiry")
    log_exp({"exp": "synth_short_strangle_to_expiry", "n": results["synth_short_strangle_to_expiry"].get("n"),
             "avg_net": results["synth_short_strangle_to_expiry"].get("avg_net"),
             "pf": results["synth_short_strangle_to_expiry"].get("profit_factor"),
             "maxDD": results["synth_short_strangle_to_expiry"].get("max_drawdown")})
    syn_rich = synth_daily_trades(synth_src, synth_res, spot, SYN_START, SYN_END,
                                  action="sell", offsets=(1,), hold="to_expiry", condition=cond_rich)
    results["synth_short_strangle_rich_to_expiry"] = _summ(syn_rich, "synth_short_strangle_rich_to_expiry")
    log_exp({"exp": "synth_short_strangle_rich_to_expiry",
             "n": results["synth_short_strangle_rich_to_expiry"].get("n"),
             "avg_net": results["synth_short_strangle_rich_to_expiry"].get("avg_net")})
    # long mirror
    syn_long = synth_daily_trades(synth_src, synth_res, spot, SYN_START, SYN_END,
                                  action="buy", offsets=(1,), hold="to_expiry")
    results["synth_long_strangle_to_expiry"] = _summ(syn_long, "synth_long_strangle_to_expiry")
    log_exp({"exp": "synth_long_strangle_to_expiry", "n": results["synth_long_strangle_to_expiry"].get("n")})

    # ---------------- Part 3: IV vs previous day's realised move --------------
    # daily features (causal): prior |close-to-close return| and prior rv
    dspot = spot["close"].resample("1D").last().dropna()
    ret = np.log(dspot / dspot.shift(1))
    feat = pd.DataFrame({"close": dspot, "ret": ret})
    feat["abs_ret_prev"] = feat["ret"].abs().shift(1)             # strictly prior day
    feat["rv5_prev"] = (ret.rolling(5).std() * math.sqrt(252)).shift(1)
    # use a dedicated conditional that reads prior-day realised move
    feat_idx = feat.dropna(subset=["abs_ret_prev"])
    med_abs = float(feat_idx["abs_ret_prev"].median())
    calm_days = set(feat_idx.index[feat_idx["abs_ret_prev"] < med_abs].date)
    vol_days = set(feat_idx.index[feat_idx["abs_ret_prev"] >= med_abs].date)

    # synthetic: buy vol after calm days, sell vol after volatile days
    syn_all_sell = synth_daily_trades(synth_src, synth_res, spot, SYN_START, SYN_END,
                                      action="sell", offsets=(0,), hold="next_day")
    if not syn_all_sell.empty:
        syn_all_sell["d"] = pd.to_datetime(syn_all_sell["date"]).dt.date
        sell_vol = syn_all_sell[syn_all_sell["d"].isin(vol_days)]
        sell_calm = syn_all_sell[syn_all_sell["d"].isin(calm_days)]
    else:
        sell_vol = sell_calm = syn_all_sell
    syn_all_buy = synth_daily_trades(synth_src, synth_res, spot, SYN_START, SYN_END,
                                     action="buy", offsets=(0,), hold="next_day")
    if not syn_all_buy.empty:
        syn_all_buy["d"] = pd.to_datetime(syn_all_buy["date"]).dt.date
        buy_calm = syn_all_buy[syn_all_buy["d"].isin(calm_days)]
        buy_vol = syn_all_buy[syn_all_buy["d"].isin(vol_days)]
    else:
        buy_calm = buy_vol = syn_all_buy
    results["synth_sell_vol_after_volatile"] = _summ(sell_vol, "synth_sell_vol_after_volatile")
    results["synth_sell_vol_after_calm"] = _summ(sell_calm, "synth_sell_vol_after_calm")
    results["synth_buy_vol_after_calm"] = _summ(buy_calm, "synth_buy_vol_after_calm")
    results["synth_buy_vol_after_volatile"] = _summ(buy_vol, "synth_buy_vol_after_volatile")
    results["synth_uncond_short_overnight"] = _summ(syn_all_sell, "synth_uncond_short_overnight")
    results["synth_uncond_long_overnight"] = _summ(syn_all_buy, "synth_uncond_long_overnight")
    for k in ("synth_sell_vol_after_volatile", "synth_sell_vol_after_calm",
              "synth_buy_vol_after_calm", "synth_buy_vol_after_volatile",
              "synth_uncond_short_overnight", "synth_uncond_long_overnight"):
        log_exp({"exp": k, "n": results[k].get("n"), "avg_net": results[k].get("avg_net"),
                 "total_net": results[k].get("total_net")})
    results["regime_split"] = {"median_abs_prev_logret": med_abs,
                               "n_calm": len(calm_days), "n_volatile": len(vol_days)}

    # ---------------- save ----------------------------------------------------
    # strip private frames
    clean = {}
    for k, v in results.items():
        if isinstance(v, dict):
            clean[k] = {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
        else:
            clean[k] = v
    (HERE / "iv_dynamics_raw.json").write_text(json.dumps(clean, indent=2, default=str))
    print(json.dumps({k: (v if not isinstance(v, dict) else
                          {kk: vv for kk, vv in v.items() if kk in
                           ("n", "avg_net", "total_net", "profit_factor", "win_rate",
                            "max_drawdown", "raw_dir_accuracy", "bootstrap_ci")})
                      for k, v in clean.items()}, indent=2, default=str))
    return clean


def real_overnight_cond(src, resolver, spot, start, end, condition, offsets=(1,), action="sell",
                        entry_hm="15:00", exit_hm="09:30", lookback=10):
    """Real overnight trades gated by a causal IV condition; IV feature = front ATM IV at entry."""
    atm = _atm_from_surface()
    atm["date"] = pd.to_datetime(atm["date"])
    days = sorted({d for d in spot.index.date if start <= d <= end})
    by_day = {d: g for d, g in spot.groupby(spot.index.date)}
    ent_t = pd.Timestamp(entry_hm).time(); ext_t = pd.Timestamp(exit_hm).time()
    # front ATM IV at entry bucket per date
    fr = atm[atm["dte"] == atm.groupby("date")["dte"].transform("min")].copy()
    fr = fr.sort_values("hm").groupby("date").tail(1)
    fr["d"] = fr["date"].dt.date
    iv_at = dict(zip(fr["d"], fr["atm_iv"]))
    rows = []
    hist = []
    for k, d in enumerate(days[:-1]):
        nd = days[k + 1]
        exp = resolver.front(d)
        if exp is None:
            continue
        iv_now = iv_at.get(d, np.nan)
        ok = condition(iv_now, hist) if condition else True
        hist.append(iv_now)
        if not ok:
            continue
        g, ng = by_day[d], by_day.get(nd)
        if ng is None or g.empty or ng.empty:
            continue
        ec = g.index[g.index.time <= ent_t]; xc = ng.index[ng.index.time >= ext_t]
        if len(ec) == 0 or len(xc) == 0:
            continue
        ent_ts, ext_ts = ec[-1], xc[0]
        S0 = float(g.at[ent_ts, "close"]); S1 = float(ng.at[ext_ts, "close"])
        weekly = resolver.is_weekly(exp)
        legs = build_legdicts([Leg("CE", "BUY", o) for o in offsets] +
                              [Leg("PE", "BUY", -o) for o in offsets], exp, S0, 50, weekly)
        if any(not has_data(src, l["symbol"]) for l in legs):
            continue
        pe = [src.leg_price(ent_ts, l, S0, field="close") for l in legs]
        px = [src.leg_price(ext_ts, l, S1, field="close") for l in legs]
        if any(p is None for p in pe) or any(p is None for p in px):
            continue
        bid_e = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in pe]
        ask_x = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in px]
        if action == "sell":
            entry, exit_ = sum(bid_e), sum(ask_x); gross = (entry - exit_) * LOT; side_in = "SELL"
        else:
            ask_e = [p * (1 + EX.half_spread_pct + EX.slippage_pct) for p in pe]
            bid_x = [p * (1 - EX.half_spread_pct - EX.slippage_pct) for p in px]
            entry, exit_ = sum(ask_e), sum(bid_x); gross = (exit_ - entry) * LOT; side_in = "BUY"
        fees = sum(round_trip_costs(a, b, LOT, side_in) for a, b in zip(pe, px))
        rows.append({"date": d, "expiry": exp, "entry_ts": ent_ts, "spot_entry": S0,
                     "spot_exit": S1, "iv_in": iv_now, "gross": gross, "fees": fees,
                     "net": gross - fees, "legs": legs})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    main()

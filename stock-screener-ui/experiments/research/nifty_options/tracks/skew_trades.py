"""Track B: skew / risk-reversal mispricing experiments.

Runs real-premium engine trades conditioned on a *causal* prior-day 25-delta skew
percentile, plus the smile-residual vertical, plus analytic delta-hedged P&L.

Usage:  python tracks/skew_trades.py [--quick]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
_RESEARCH = _HERE.parent
sys.path.insert(0, str(_RESEARCH))
sys.path.insert(0, str(_HERE))

import fyers_data as fd  # noqa: E402
import mispricing  # noqa: E402
import pricing  # noqa: E402
import runner as R  # noqa: E402
import stats as st  # noqa: E402
import skew_lib as SL  # noqa: E402
from costs import ExecutionModel, round_trip_costs  # noqa: E402
from engine import (EngineConfig, ExpiryResolver, Leg, RealOptionSource, Signal,  # noqa: E402
                    replay)

LOT = 65
CAPITAL = 300_000.0
LOG_PATH = _HERE / "skew_rr_log.jsonl"


def log(rec: dict):
    with LOG_PATH.open("a") as fh:
        fh.write(json.dumps(rec, default=str) + "\n")


# ---------------------------------------------------------------------------
# causal signal table
# ---------------------------------------------------------------------------
def signal_table(track_expiry: str = "2026-09-29", window: int = 20, min_obs: int = 8) -> pd.DataFrame:
    panel, _ = SL.build_skew_panel()
    p = SL.add_causal_percentiles(panel, window, min_obs)
    # trading on day d may only use pct of the *previous* day's skew -> shift(1)
    p["sig_pct"] = p.groupby("expiry")["pct_prior"].shift(1)
    p["sig_rr"] = p.groupby("expiry")["rr25"].shift(1)
    p["rr_chg_prev"] = p.groupby("expiry")["rr25"].diff().shift(1)
    return p


def flags_for_expiry(p: pd.DataFrame, track_expiry: str) -> dict:
    g = p[p["expiry"] == pd.Timestamp(track_expiry)]
    out = {}
    for _, r in g.iterrows():
        if not np.isfinite(r["sig_pct"]):
            continue
        out[r["date"].date()] = {
            "sig_pct": float(r["sig_pct"]),
            "sig_rr": float(r["sig_rr"]) if np.isfinite(r["sig_rr"]) else np.nan,
            "prev_rr": float(r["rr25"]),
            "atm_iv": float(r["atm_iv"]),
        }
    return out


# ---------------------------------------------------------------------------
# meta / resolver
# ---------------------------------------------------------------------------
def real_setup():
    real = RealOptionSource()
    man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
    by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
    resolv = ExpiryResolver(list(by_exp.keys()), by_exp)
    spot = R.load_spot("5")
    return real, resolv, spot


# ---------------------------------------------------------------------------
# strategies
# ---------------------------------------------------------------------------
def make_rr(flags, k=3, entry_min=45, mode="skew", stop=5.0, tgt=5.0, hold=600):
    """Risk reversal: steep -> SELL put wing / BUY call wing; flat -> reverse.

    mode='skew' conditions on the causal percentile; mode='always_short_put'
    and 'always_long_put' are unconditional controls.
    """
    def strat(ctx, i):
        if abs(ctx.minutes(i) - entry_min) > 2:
            return None
        f = flags.get(ctx.day)
        if f is None and mode in ("skew",):
            return None
        pct = f["sig_pct"] if f else np.nan
        if mode == "skew":
            if pct >= 0.80:
                sgn = +1  # sell rich put / buy cheap call  (long skew-risk)
            elif pct <= 0.20:
                sgn = -1  # buy rich put / sell cheap call
            else:
                return None
        elif mode == "steep":
            if pct >= 0.80:
                sgn = +1
            else:
                return None
        elif mode == "flat":
            if pct <= 0.20:
                sgn = -1
            else:
                return None
        elif mode == "always_short_put":
            sgn = +1
        elif mode == "always_long_put":
            sgn = -1
        else:
            return None
        if sgn > 0:
            legs = [Leg("PE", "SELL", -k), Leg("CE", "BUY", k)]
            tag = f"rr_s{k}"
        else:
            legs = [Leg("PE", "BUY", -k), Leg("CE", "SELL", k)]
            tag = f"rr_b{k}"
        return Signal(legs, reason=f"rr pct={pct:.2f}", tag=tag,
                      stop_pct=stop, target_pct=tgt, max_hold_min=hold)
    return strat


def make_fear(flags, opt="CE", entry_min=45, k=0, mode="steep", stop=0.35, tgt=0.60, hold=330):
    """Steep skew = fear. Buy CE (bounce) or PE (continuation), ATM(k=0)/OTM."""
    def strat(ctx, i):
        if abs(ctx.minutes(i) - entry_min) > 2:
            return None
        f = flags.get(ctx.day)
        if f is None:
            return None
        pct = f["sig_pct"]
        if mode == "steep" and not (pct >= 0.80):
            return None
        if mode == "flat" and not (pct <= 0.20):
            return None
        # mode == "all" trades unconditionally
        return Signal([Leg(opt, "BUY", k)], reason=f"fear {opt} pct={pct:.2f}", tag=f"fear{opt}",
                      stop_pct=stop, target_pct=tgt, max_hold_min=hold)
    return strat


def make_smile(resid, entry_min=45, band=400.0, indiff=0.003, min_vol=100.0,
               stop=5.0, tgt=5.0, hold=600):
    """Sell the richest strike / buy the cheapest same-type strike (same expiry).

    The pick uses the most recent *prior trading day's* residual structure, so the
    signal is causal. Both strikes must have traded (volume>0) that day.
    """
    r = resid[(resid["moneyness"].abs() <= band) & (resid["volume"] > min_vol)].copy()
    r["expiry"] = pd.to_datetime(r["expiry"])
    r["date"] = pd.to_datetime(r["date"])
    picks = {}
    for (d, exp, opt), g in r.groupby(["date", "expiry", "opt"]):
        if len(g) < 4:
            continue
        rich = g.loc[g["resid"].idxmax()]
        cheap = g.loc[g["resid"].idxmin()]
        if rich["resid"] - cheap["resid"] < indiff:
            continue
        picks[(d.date(), exp.date(), opt)] = (float(rich["strike"]), float(cheap["strike"]),
                                              float(rich["resid"] - cheap["resid"]))
    pick_dates = sorted({k[0] for k in picks})
    import bisect

    def strat(ctx, i):
        if abs(ctx.minutes(i) - entry_min) > 2:
            return None
        d = ctx.day
        exp = ctx.expiry
        j = bisect.bisect_left(pick_dates, d) - 1
        if j < 0:
            return None
        pd_ = pick_dates[j]
        # prefer the option type with the widest residual gap that day
        cand = [(op, picks[(pd_, exp, op)]) for op in ("CE", "PE")
                if (pd_, exp, op) in picks]
        if not cand:
            return None
        opt, (rich_k, cheap_k, gap) = max(cand, key=lambda z: z[1][2])
        atm = ctx.atm()
        o1 = int(round((rich_k - atm) / ctx.cfg.step))
        o2 = int(round((cheap_k - atm) / ctx.cfg.step))
        if o1 == o2:
            return None
        return Signal([Leg(opt, "SELL", o1), Leg(opt, "BUY", o2)],
                      reason=f"smile sell {rich_k:.0f}({opt})/buy {cheap_k:.0f} gap={gap:.3f}",
                      tag="smile_vert", stop_pct=stop, target_pct=tgt, max_hold_min=hold)
    return strat


# ---------------------------------------------------------------------------
# analytics on a trade list
# ---------------------------------------------------------------------------
def delta_hedged(trades, source: RealOptionSource) -> dict:
    """Analytic delta-hedge: net_delta = sum BS delta (entry IV) * signed ratio.

    hedge_pnl = net_delta * (spot_exit - spot_entry) * lot * lots
    Returns mean stats on (net_pnl - hedge_pnl) = the delta-neutral view.
    """
    dn = []
    deltas = []
    for t in trades:
        net_delta = 0.0
        for L in t.legs:
            px = source.leg_price(t.entry_ts, L, t.spot_entry, field="open")
            if px is None:
                px = source.leg_price(t.entry_ts, L, t.spot_entry, field="close")
            if px is None:
                continue
            K = float(L["strike"])
            T = pricing.t_years(t.entry_ts, L["expiry"])
            iv = mispricing.implied_vol(px, t.spot_entry, K, T, L["opt"])
            if iv is None:
                continue
            d = pricing.bs_delta(t.spot_entry, K, T, iv, L["opt"])
            sgn = 1.0 if L["side"] == "BUY" else -1.0
            net_delta += sgn * d * L.get("ratio", 1)
        deltas.append(net_delta)
        hedge = net_delta * (t.spot_exit - t.spot_entry) * t.lot_size * t.lots
        dn.append((t.net_pnl - hedge, net_delta))
    arr = np.array([x[0] for x in dn], dtype=float)
    return {
        "n": len(arr),
        "mean_hedged_net": float(arr.mean()) if len(arr) else float("nan"),
        "total_hedged_net": float(arr.sum()) if len(arr) else float("nan"),
        "mean_net_delta": float(np.nanmean(deltas)) if deltas else float("nan"),
        "net_deltas": deltas,
        "hedged": arr,
    }


def summarize_trades(trades, source, capital=CAPITAL) -> dict:
    if not trades:
        return {"n": 0}
    net = np.array([t.net_pnl for t in trades])
    s = st.summarize(net, capital)
    s["bootstrap"] = st.bootstrap(net, capital)
    s["walk_forward"] = st.walk_forward(trades)
    s["tail_loss_p95"] = float(np.percentile(net, 5))
    # raw directional accuracy (brief formula; first leg) + delta-based
    sgn0 = np.array([1 if t.legs[0]["opt"] == "CE" else -1 for t in trades])
    mv = np.array([(t.spot_exit - t.spot_entry) for t in trades]) * sgn0
    s["raw_dir_accuracy"] = float((mv > 0).mean())
    s["raw_mean_move_pts"] = float(mv.mean())
    dh = delta_hedged(trades, source)
    dsgn = np.array([1 if d >= 0 else -1 for d in dh["net_deltas"]]) if dh["n"] else np.array([])
    spot_mv = np.array([(t.spot_exit - t.spot_entry) for t in trades])
    s["mean_net_delta"] = dh["mean_net_delta"]
    s["delta_dir_accuracy"] = float((spot_mv * dsgn > 0).mean()) if dh["n"] else float("nan")
    s["total_delta_hedged"] = dh["total_hedged_net"]
    s["mean_delta_hedged"] = dh["mean_hedged_net"]
    s["exit_mix"] = pd.Series([t.exit_reason for t in trades]).value_counts().to_dict()
    return s


def run_exp(name, strat, start, end, source, resolv, spot, day_meta, tag_extra=None):
    cfg = EngineConfig(capital=CAPITAL, risk_pct=0.01, stop_pct=0.35, target_pct=0.60,
                       execution=ExecutionModel(), lot=LOT)
    trades = replay(strat, spot, source, resolv, cfg, start, end,
                    require_data=True, day_meta=day_meta)
    s = summarize_trades(trades, source)
    s.update({"experiment": name, "start": str(start), "end": str(end)})
    if tag_extra:
        s.update(tag_extra)
    log({"experiment": name, "summary": {k: v for k, v in s.items()
                                          if not isinstance(v, (list, dict))},
         "n": s.get("n", 0)})
    print(f"[{name}] n={s.get('n',0)} net=₹{s.get('total_net',0):,.0f} "
          f"exp=₹{s.get('avg_net',0):,.0f} win={s.get('win_rate',0)*100:.0f}% "
          f"PF={s.get('profit_factor',float('nan')):.2f} dd=₹{s.get('max_drawdown',0):,.0f} "
          f"rawacc={s.get('raw_dir_accuracy',float('nan')):.2f} "
          f"delta={s.get('mean_net_delta',float('nan')):.2f} "
          f"dh_net=₹{s.get('total_delta_hedged',float('nan')):,.0f}")
    return s, trades


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()

    start, end = date(2026, 7, 1), date(2026, 9, 25)
    source, resolv, spot = real_setup()
    day_meta = R.load_daily_meta()

    p = signal_table()
    flags = flags_for_expiry(p, "2026-09-29")
    print(f"signal days={len(flags)} "
          f"steep={sum(1 for v in flags.values() if v['sig_pct']>=0.8)} "
          f"flat={sum(1 for v in flags.values() if v['sig_pct']<=0.2)}")

    _, resid = SL.build_skew_panel()

    results = {}
    for k in (2, 3, 4):
        results[f"rr_skew_k{k}"], _ = run_exp(
            f"rr_skew_k{k}", make_rr(flags, k=k, mode="skew"), start, end,
            source, resolv, spot, day_meta)
    for k in (3,):
        results[f"rr_steep_k{k}"], _ = run_exp(
            f"rr_steep_k{k}", make_rr(flags, k=k, mode="steep"), start, end,
            source, resolv, spot, day_meta)
        results[f"rr_flat_k{k}"], _ = run_exp(
            f"rr_flat_k{k}", make_rr(flags, k=k, mode="flat"), start, end,
            source, resolv, spot, day_meta)
    results["rr_uncond_short_put"], _ = run_exp(
        "rr_uncond_short_put", make_rr(flags, k=3, mode="always_short_put"), start, end,
        source, resolv, spot, day_meta)
    results["rr_uncond_long_put"], _ = run_exp(
        "rr_uncond_long_put", make_rr(flags, k=3, mode="always_long_put"), start, end,
        source, resolv, spot, day_meta)
    for opt in ("CE", "PE"):
        results[f"fear_steep_{opt}"], _ = run_exp(
            f"fear_steep_{opt}", make_fear(flags, opt=opt, k=0, mode="steep"), start, end,
            source, resolv, spot, day_meta)
        results[f"fear_flat_{opt}"], _ = run_exp(
            f"fear_flat_{opt}", make_fear(flags, opt=opt, k=0, mode="flat"), start, end,
            source, resolv, spot, day_meta)
        results[f"fear_always_{opt}"], _ = run_exp(
            f"fear_always_{opt}", make_fear(flags, opt=opt, k=0, mode="all"), start, end,
            source, resolv, spot, day_meta)
    results["smile_vert"], _ = run_exp(
        "smile_vert", make_smile(resid), start, end, source, resolv, spot, day_meta)

    out = {"window": [str(start), str(end)], "n_signal_days": len(flags),
           "steep_days": sum(1 for v in flags.values() if v["sig_pct"] >= 0.8),
           "flat_days": sum(1 for v in flags.values() if v["sig_pct"] <= 0.2),
           "results": {k: {kk: vv for kk, vv in v.items()
                           if not isinstance(vv, (list,))} for k, v in results.items()}}
    (_HERE / "skew_trades_results.json").write_text(json.dumps(out, indent=2, default=str))
    print("saved ->", _HERE / "skew_trades_results.json")


if __name__ == "__main__":
    main()

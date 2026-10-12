"""The retail option-buying playbook, measured.

Tests the common ways people buy NIFTY options (long CE/PE) and reports why they
lose: unconditional directional buying at various moneyness, plus the break-even
math (implied move vs realised move vs premium paid).
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd
import runner as R
import stats as st
from engine import EngineConfig, SyntheticOptionSource, RealOptionSource, ExpiryResolver, replay, Leg, Signal, build_legdicts
from costs import ExecutionModel

LOT = 65


def mk(opt, offset, mins, hold):
    def f(ctx, i):
        if abs(ctx.minutes(i) - mins) > 2:
            return None
        return Signal([Leg(opt, "BUY", offset)], f"always {opt}{offset:+d}", f"long_{opt}{offset}",
                      0.35, 0.60, hold)
    return f


def decomp(trades):
    if not trades:
        return {}
    sgn = np.array([1 if t.legs[0]["opt"] == "CE" else -1 for t in trades])
    mv = np.array([(t.spot_exit - t.spot_entry) for t in trades]) * sgn
    net = np.array([t.net_pnl for t in trades])
    gross = np.array([t.gross_pnl for t in trades])
    s = st.summarize(net)
    return {"n": len(net), "net_exp": net.mean(), "gross_exp": gross.mean(),
            "fee_exp": np.array([t.fees for t in trades]).mean(),
            "win": s.get("win_rate", 0), "pf": s.get("profit_factor", float("nan")),
            "raw_acc": (mv > 0).mean(), "raw_move": mv.mean(),
            "avg_win": s.get("avg_win", 0), "avg_loss": s.get("avg_loss", 0),
            "total": net.sum()}


def run_synth():
    spot = R.load_spot("5")
    source = SyntheticOptionSource.from_cached()
    resolver = R.build_weekly_resolver(date(2018, 1, 1), date(2026, 9, 25))
    meta = R.load_daily_meta()
    cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=0.35, target_pct=0.60,
                       execution=ExecutionModel(), lot=LOT)
    out = {}
    for label, fn in {
        "ATM CE @09:45 (intraday)": mk("CE", 0, 45, 300),
        "ATM PE @09:45 (intraday)": mk("PE", 0, 45, 300),
        "OTM +2 CE @09:45 (intraday)": mk("CE", 2, 45, 300),
        "ITM -2 CE @09:45 (intraday)": mk("CE", -2, 45, 300),
        "ATM CE @13:00 (intraday)": mk("CE", 0, 225, 150),
    }.items():
        tr = replay(fn, spot, source, resolver, cfg, date(2018, 1, 1), date(2026, 9, 25), day_meta=meta)
        out[label] = decomp(tr)
    return out


def run_real():
    import json
    spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    r5 = spot.resample("5min").agg({"open": "first", "high": "max", "low": "min",
                                    "close": "last", "volume": "sum"}).dropna()
    t = r5.index.time
    import datetime as dt
    r5 = r5[(t >= dt.time(9, 15)) & (t <= dt.time(15, 29))]
    source = RealOptionSource()
    man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
    by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
    resolver = ExpiryResolver(list(by_exp.keys()), by_exp)
    meta = R.load_daily_meta()
    cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=0.35, target_pct=0.60,
                       execution=ExecutionModel(), lot=LOT)
    out = {}
    for label, fn in {
        "ATM CE @09:45 (intraday)": mk("CE", 0, 45, 300),
        "ATM PE @09:45 (intraday)": mk("PE", 0, 45, 300),
        "OTM +2 CE @09:45 (intraday)": mk("CE", 2, 45, 300),
    }.items():
        tr = replay(fn, r5, source, resolver, cfg, date(2026, 6, 1), date(2026, 9, 25),
                    require_data=True, day_meta=meta)
        out[label] = decomp(tr)
    return out


def move_stats():
    """Break-even reality: distribution of moves vs an ATM option's cost."""
    spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts")
    d = spot.groupby(spot.index.date).agg(o=("open", "first"), c=("close", "last"),
                                          h=("high", "max"), l=("low", "min"))
    d["oc_pct"] = (d.c - d.o) / d.o * 100
    d["mfe_pct"] = (d.h - d.o) / d.o * 100
    d["mae_pct"] = (d.o - d.l) / d.o * 100
    # weekly (Tue-Tue)
    d.index = pd.to_datetime(d.index)
    return {
        "days": len(d),
        "intraday |open->close| mean %": float(d.oc_pct.abs().mean()),
        "intraday open->high mean %": float(d.mfe_pct.mean()),
        "intraday open->low mean %": float(d.mae_pct.mean()),
        "P(intraday close move > 0.7%)": float((d.oc_pct.abs() > 0.7).mean()),
        "P(favourable 0.7% reached): up": float((d.mfe_pct > 0.7).mean()),
        "P(favourable 0.7% reached): down": float((d.mae_pct > 0.7).mean()),
    }


def main():
    print("== move reality (2017-2026, 1-min) ==")
    for k, v in move_stats().items():
        print(f"  {k:38s}: {v:.3f}")
    print("\n== SYNTHETIC 2018-2026: retail long-option playbook ==")
    for k, v in run_synth().items():
        print(f"  {k:30s} n={v['n']:5d} net=₹{v['net_exp']:7.0f} gross=₹{v['gross_exp']:7.0f} "
              f"fee=₹{v['fee_exp']:4.0f} win={v['win']*100:4.0f}% PF={v['pf']:.2f} raw_acc={v['raw_acc']*100:.1f}%")
    print("\n== REAL 2026-06..09: retail long-option playbook ==")
    for k, v in run_real().items():
        print(f"  {k:30s} n={v['n']:5d} net=₹{v['net_exp']:7.0f} gross=₹{v['gross_exp']:7.0f} "
              f"fee=₹{v['fee_exp']:4.0f} win={v['win']*100:4.0f}% PF={v['pf']:.2f} raw_acc={v['raw_acc']*100:.1f}%")


if __name__ == "__main__":
    main()

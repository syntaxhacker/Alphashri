"""Run the NIFTY-options research program and emit results + a report.

Modes
  synthetic : Black-Scholes option P&L off the real 1-min spot path, 2017-2026.
              Multi-regime breadth; model-premium caveat applies.
  real      : actual FYERS premiums for currently-listed contracts (2026-06..).
              Short window, but true execution reality.

Usage
  python runner.py synthetic --start 2018-01-01 --end 2026-09-25
  python runner.py real
  python runner.py all
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402
import stats as st  # noqa: E402
import pricing  # noqa: E402
from engine import EngineConfig, ExpiryResolver, RealOptionSource, SyntheticOptionSource, replay  # noqa: E402
from strategies import REGISTRY  # noqa: E402
from costs import ExecutionModel  # noqa: E402

OUT = fd.CACHE_DIR / "results"
OUT.mkdir(parents=True, exist_ok=True)


def load_spot(tf: str = "5") -> pd.DataFrame:
    df = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    # drop the handful of bad index ticks flagged by qc.py before resampling
    ok = ((df["high"] >= df[["open", "close"]].max(axis=1)) &
          (df["low"] <= df[["open", "close"]].min(axis=1)) &
          (df[["open", "high", "low", "close"]] > 0).all(axis=1))
    df = df[ok]
    rule = {"5": "5min", "3": "3min", "15": "15min"}[tf]
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    r = df.resample(rule).agg(agg).dropna()
    t = r.index.time
    import datetime as _dt
    r = r[(t >= _dt.time(9, 15)) & (t <= _dt.time(15, 29))]
    return r


def load_daily_meta() -> dict:
    d = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__D.parquet").set_index("ts").sort_index()
    d = d.copy()
    d["prev_high"] = d["high"].shift(1)
    d["prev_low"] = d["low"].shift(1)
    d["prev_close"] = d["close"].shift(1)
    meta = {}
    for ts, row in d.iterrows():
        if row["prev_high"] == row["prev_high"]:
            meta[ts.date()] = {"prev_high": float(row["prev_high"]),
                               "prev_low": float(row["prev_low"]),
                               "prev_close": float(row["prev_close"])}
    return meta


def build_weekly_resolver(start: date, end: date) -> ExpiryResolver:
    exps = fd.weekly_expiries(start - timedelta(days=7), end + timedelta(days=7))
    weekly = {}
    for e in exps:
        last_tue = fd.monthly_expiry(e.year, e.month)
        weekly[e] = (e != last_tue)
    return ExpiryResolver(exps, weekly)


def run_mode(mode: str, tf: str, start: date, end: date, capital: float = 300_000.0,
             risk: float = 0.01, stop=0.35, target=0.6, strategies=None):
    spot = load_spot(tf)
    day_meta = load_daily_meta()
    if mode == "synthetic":
        source = SyntheticOptionSource.from_cached()
        resolver = build_weekly_resolver(start, end)
        require_data = False
    else:
        source = RealOptionSource()
        by_exp = {}
        man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
        for c in man["contracts"]:
            by_exp[date.fromisoformat(c["expiry"])] = c["weekly"]
        resolver = ExpiryResolver(list(by_exp.keys()), by_exp)
        require_data = True

    cfg = EngineConfig(capital=capital, risk_pct=risk, stop_pct=stop, target_pct=target,
                       execution=ExecutionModel(), lot=65)
    results = {}
    strategies = strategies or list(REGISTRY)
    for name in strategies:
        fn = REGISTRY[name]
        # per-strategy stop/target defaults
        kw = {}
        if name in ("short_straddle_intraday", "credit_spread_intraday"):
            kw = {"stop_pct": stop, "target_pct": target}
        elif name:
            kw = {"stop_pct": stop, "target_pct": target}
        t0 = time.time()
        trades = replay(lambda ctx, i, fn=fn, kw=kw: fn(ctx, i, **kw), spot, source,
                        resolver, cfg, start, end, require_data=require_data, day_meta=day_meta)
        net = np.array([t.net_pnl for t in trades])
        # raw underlying edge: separates real directional skill from payout geometry
        if trades:
            sgn = np.array([1 if t.legs[0]["opt"] == "CE" else -1 for t in trades])
            mv = np.array([(t.spot_exit - t.spot_entry) for t in trades]) * sgn
            raw = {"raw_mean_move_pts": float(mv.mean()),
                   "raw_dir_accuracy": float((mv > 0).mean()),
                   "raw_median_move_pts": float(np.median(mv))}
        else:
            raw = {"raw_mean_move_pts": 0.0, "raw_dir_accuracy": float("nan"),
                   "raw_median_move_pts": 0.0}
        s = st.summarize(net, capital)
        s.update(raw)
        s["edge_basis"] = ("directional skill" if raw["raw_dir_accuracy"] > 0.51
                           else "payout geometry (sub-50% direction accuracy)")
        s["weekly"] = st.weekly(net, [t.entry_ts for t in trades], capital) if len(net) else {}
        s["bootstrap"] = st.bootstrap(net, capital) if len(net) else {}
        s["risk_of_ruin"] = st.risk_of_ruin(net, capital) if len(net) else float("nan")
        s["walk_forward"] = st.walk_forward(trades)
        s["avg_capital_used"] = float(np.mean([t.capital for t in trades])) if trades else 0.0
        s["exit_mix"] = pd.Series([t.exit_reason for t in trades]).value_counts().to_dict() if trades else {}
        results[name] = s
        print(f"  [{mode}/{name}] n={s.get('n',0)} net=₹{s.get('total_net',0):,.0f} "
              f"PF={s.get('profit_factor',float('nan')):.2f} "
              f"win={s.get('win_rate',0)*100:.0f}% exp=₹{s.get('avg_net',0):,.0f} "
              f"({time.time()-t0:.0f}s)")
    return results


def calibrate_synthetic(band=400, save=True):
    """Fit IV multiplier + smile to the real ATM band, then persist.

    Uses only the real-premium window (listed contracts). Restricting to
    |K-S|<=band and premium>=5 keeps penny/very-far strikes from dominating.
    """
    source = SyntheticOptionSource.from_cached()
    real = RealOptionSource()
    man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
    samples = []
    for c in man["contracts"]:
        df = real._load(c["symbol"])
        if df is None or df.empty:
            continue
        step = max(1, len(df) // 8)
        for ts in list(df.index[::step])[:8]:
            actual = float(df.at[ts, "close"])
            if actual < 5:
                continue
            try:
                sp = float(source.spot.at[ts, "close"])
            except KeyError:
                continue
            if abs(c["strike"] - sp) > band:
                continue
            samples.append((ts, sp, c["strike"], date.fromisoformat(c["expiry"]), c["opt"], actual))
    if not samples:
        return {}
    base_iv = source._atm_vol  # uncalibrated (mult=1 unless json exists)

    def med_err(mult, coeff):
        errs = []
        for ts, sp, k, exp, opt, actual in samples:
            T = pricing.t_years(ts, exp)
            atm = base_iv(ts) * mult
            sig = pricing.IVSurface(smile_coeff=coeff).sigma(atm, sp, k, T)
            model = pricing.bs_price(sp, k, T, sig, opt)
            errs.append(abs(model - actual) / actual)
        return float(np.median(errs))

    best = (1.0, 0.55, med_err(1.0, 0.55))
    for mult in np.arange(0.7, 1.65, 0.05):
        for coeff in (0.0, 0.3, 0.55, 0.8, 1.1):
            e = med_err(mult, coeff)
            if e < best[2]:
                best = (float(mult), float(coeff), e)
    result = {"n": len(samples), "iv_mult": best[0], "smile_coeff": best[1],
              "median_abs_pct_err": best[2]}
    if save:
        (fd.CACHE_DIR / "calibration.json").write_text(json.dumps(result, indent=2))
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["synthetic", "real", "all", "calibrate"])
    ap.add_argument("--start", default="2018-01-01")
    ap.add_argument("--end", default="2026-09-25")
    ap.add_argument("--tf", default="5")
    ap.add_argument("--risk", type=float, default=0.01)
    ap.add_argument("--stop", type=float, default=0.35)
    ap.add_argument("--target", type=float, default=0.60)
    ap.add_argument("--capital", type=float, default=300_000.0)
    args = ap.parse_args()

    out = {"generated": datetime.now().isoformat(), "tf": args.tf, "risk": args.risk,
           "stop": args.stop, "target": args.target, "capital": args.capital}
    if args.mode in ("calibrate", "all"):
        out["calibration"] = calibrate_synthetic()
        print("calibration:", out["calibration"])
    if args.mode in ("synthetic", "all"):
        print("== synthetic (2018-2026) ==")
        out["synthetic"] = run_mode("synthetic", args.tf, date.fromisoformat(args.start),
                                    date.fromisoformat(args.end), args.capital, args.risk,
                                    args.stop, args.target)
    if args.mode in ("real", "all"):
        print("== real premiums (listed contracts) ==")
        out["real"] = run_mode("real", args.tf, date(2026, 6, 1), date(2026, 9, 25),
                               args.capital, args.risk, args.stop, args.target)
    tag = f"{args.mode}_{args.tf}m_r{int(args.risk*1000)}"
    path = OUT / f"run_{tag}.json"
    path.write_text(json.dumps(out, indent=2, default=str))
    print("saved ->", path)


if __name__ == "__main__":
    main()

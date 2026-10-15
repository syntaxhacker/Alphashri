"""Regime conditioning for the one robust survivor (ORB).

Tags each causal trade with the *prior-day* VIX level and daily trend strength,
then reports expectancy inside each regime. Answers: is the edge regime-specific?
"""
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd
import runner as R
import stats as st
from engine import EngineConfig, SyntheticOptionSource, replay
from strategies import orb_breakout
from costs import ExecutionModel

spot = R.load_spot("5")
source = SyntheticOptionSource.from_cached()
resolver = R.build_weekly_resolver(date(2018, 1, 1), date(2026, 9, 25))
meta = R.load_daily_meta()
cfg = EngineConfig(capital=300_000, risk_pct=0.01, stop_pct=0.30, target_pct=0.50,
                   execution=ExecutionModel(), lot=65)
trades = replay(lambda c, i: orb_breakout(c, i, or_min=15, buffer=0.0015, stop_pct=0.30,
                                          target_pct=0.50),
                spot, source, resolver, cfg, date(2018, 1, 1), date(2026, 9, 25),
                day_meta=meta)
print("trades:", len(trades))

# causal daily regime series
d = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__D.parquet").set_index("ts").sort_index()
vix = pd.read_parquet(fd.CANDLE_DIR / "NSE_INDIAVIX-INDEX__D.parquet").set_index("ts")["close"]
d["vix"] = vix.reindex(d.index).ffill()
d["vix_pct_roll"] = d["vix"].expanding().apply(lambda s: (s.rank(pct=True).iloc[-1]))
d["ma20"] = d["close"].rolling(20).mean()
d["ma50"] = d["close"].rolling(50).mean()
d["trend_up"] = (d["close"] > d["ma50"]) & (d["ma20"] > d["ma50"])
d["trend_dn"] = (d["close"] < d["ma50"]) & (d["ma20"] < d["ma50"])
# shift by 1 so it is strictly prior-day information
for c in ("vix", "vix_pct_roll", "trend_up", "trend_dn"):
    d[c + "_prev"] = d[c].shift(1)

rows = []
for t in trades:
    ts = pd.Timestamp(t.date, tz="Asia/Kolkata")
    try:
        prior = d.index[d.index < ts]
        if len(prior) == 0:
            continue
        r = d.loc[prior[-1]]
    except Exception:
        continue
    rows.append({"net": t.net_pnl, "vix": r["vix_prev"], "vix_pct": r["vix_pct_roll_prev"],
                 "trend_up": bool(r["trend_up_prev"]), "trend_dn": bool(r["trend_dn_prev"]),
                 "tag": t.tag})
df = pd.DataFrame(rows)
df["vol_bucket"] = pd.qcut(df["vix_pct"], 3, labels=["low-vol", "mid-vol", "high-vol"])
df["direction"] = np.where(df["trend_up"], "up-trend", np.where(df["trend_dn"], "down-trend", "range"))

print("\nBy volatility regime (prior-day VIX percentile tercile):")
print(df.groupby("vol_bucket", observed=True)["net"].agg(
    n="size", exp="mean", win=lambda x: (x > 0).mean(), total="sum").round(1).to_string())
print("\nBy trend regime (prior-day):")
print(df.groupby("direction", observed=True)["net"].agg(
    n="size", exp="mean", win=lambda x: (x > 0).mean(), total="sum").round(1).to_string())
print("\nORB side (CE=lup / PE=ldn) expectancy:")
print(df.groupby("tag", observed=True)["net"].agg(n="size", exp="mean", win=lambda x: (x > 0).mean()).round(1).to_string())
df.to_csv(Path(__file__).resolve().parent / "orb_regime_trades.csv", index=False)

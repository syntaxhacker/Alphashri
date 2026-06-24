#!/usr/bin/env python3
"""Calculate stock betas against market proxy from cached intraday data.

Uses equal-weighted average of all stocks as market proxy (diverse F&O universe
across sectors, correlates well with Nifty 50).

Usage: python3 experiments/calc_beta.py
  ORB_CACHE_DIR=../experiments/data   path to orb_cache.pkl

Outputs METRIC lines for autoresearch integration.
"""
import os
import sys
import pickle
import pandas as pd
import numpy as np
from scipy import stats

IST = "Asia/Kolkata"
CACHE_DIR = os.environ.get("ORB_CACHE_DIR", "../experiments/data")


def load_data(cache_dir: str) -> dict[str, pd.DataFrame]:
    path = os.path.join(cache_dir, "orb_cache.pkl")
    with open(path, "rb") as f:
        data = pickle.load(f)
    for sym, df in data.items():
        if not df.index.tz:
            df.index = pd.DatetimeIndex(df.index).tz_localize("UTC")
        data[sym] = df.sort_index()
    return data


def calc_betas(data: dict[str, pd.DataFrame]) -> dict[str, float]:
    all_returns = {}
    for sym, df in data.items():
        idx = df.index.tz_convert(IST)
        daily = df["close"].values
        daily_idx = idx.to_series().dt.date.values
        daily_df = pd.DataFrame({"close": daily}, index=idx).resample("D").last().dropna()
        ret = daily_df["close"].pct_change().dropna()
        if len(ret) > 20:
            all_returns[sym] = ret

    rets_df = pd.DataFrame(all_returns)
    market_ret = rets_df.mean(axis=1)

    betas = {}
    for sym in all_returns:
        sr = all_returns[sym]
        common = sr.index.intersection(market_ret.index)
        if len(common) < 20:
            continue
        sr, mr = sr.loc[common], market_ret.loc[common]
        beta, *_ = stats.linregress(mr.values, sr.values)
        betas[sym] = round(beta, 3)

    return dict(sorted(betas.items(), key=lambda x: x[1], reverse=True))


def main():
    data = load_data(CACHE_DIR)
    betas = calc_betas(data)

    print(f"{'Symbol':<14} {'Beta':<8}", file=sys.stderr)
    print("-" * 24, file=sys.stderr)
    for sym, b in betas.items():
        print(f"{sym:<14} {b:<8}", file=sys.stderr)

    high_beta = [s for s, b in betas.items() if b > 1.2]
    print(f"\nHigh beta ( >1.2): {len(high_beta)} stocks: {high_beta}", file=sys.stderr)
    print(f"Medium beta (0.8-1.2): {sum(1 for b in betas.values() if 0.8 <= b <= 1.2)} stocks", file=sys.stderr)
    print(f"Low beta (<0.8): {sum(1 for b in betas.values() if b < 0.8)} stocks", file=sys.stderr)

    for sym, b in betas.items():
        print(f"METRIC beta_{sym}={b}")
    print(f"METRIC high_beta_count={len(high_beta)}")
    print(f"METRIC high_beta_list={','.join(high_beta)}")


if __name__ == "__main__":
    main()

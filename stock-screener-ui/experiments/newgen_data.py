#!/usr/bin/env python3
"""Fetch NEWGEN intraday data from Upstox only, for all experiment timeframes.

Caches to experiments/data/newgen_cache.pkl as {tf_minutes: DataFrame}
with lowercase open/high/low/close/volume/oi columns and tz-aware IST index.

Usage:
  python3 experiments/newgen_data.py            # build cache (Upstox only)
  python3 experiments/newgen_data.py --refresh  # concat today's intraday data

Env:
  NEWGEN_FROM_DATE=2026-05-01   start of history window
  NEWGEN_TO_DATE=2026-08-04     end of history window (default: today)
"""
import os
import sys
import pickle
import argparse
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))       # stock-screener-ui
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # repo root (upstox_trader)

import pandas as pd

import config

TIMEFRAMES = [5, 10, 15, 60]  # minutes

def get_api_client():
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    from backtest.utils import get_upstox_client_from_db
    try:
        return UpstoxAPI(
            api_key=config.UPSTOX_API_KEY,
            api_secret=config.UPSTOX_API_SECRET,
            quiet=True,
        )
    except Exception:
        client, err = get_upstox_client_from_db(quiet=True)
        if err:
            raise RuntimeError(f"No Upstox client available: {err}")
        return client


def fetch_history(api, tf: int, from_date: str, to_date: str) -> pd.DataFrame:
    """Fetch historical candles for NEWGEN at a given tf. Upstox only."""
    if tf == 60:
        df = api.fetch_historical_data_v3(
            symbol="NEWGEN", unit="hours", interval=1,
            to_date=to_date, from_date=from_date,
        )
    else:
        df = api.fetch_historical_data_v3(
            symbol="NEWGEN", unit="minutes", interval=tf,
            to_date=to_date, from_date=from_date,
        )
    if df is None:
        return pd.DataFrame()
    return df


def fetch_intraday_today(api, tf: int) -> pd.DataFrame:
    interval = "1" if tf == 60 else str(tf)  # intraday endpoint uses minute count
    if tf == 60:
        df = api.fetch_intraday_data_v3(symbol="NEWGEN", interval="1")
    else:
        df = api.fetch_intraday_data_v3(symbol="NEWGEN", interval=str(tf))
    if df is None:
        return pd.DataFrame()
    return df


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if df.index.tz is None:
        df.index = pd.DatetimeIndex(df.index).tz_localize(config.IST)
    else:
        df.index = pd.DatetimeIndex(df.index).tz_convert(config.IST)
    for col in ["open", "high", "low", "close", "volume"]:
        if col not in df.columns:
            df[col] = 0.0
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df.sort_index()


def build_cache(from_date: str, to_date: str, refresh: bool = False, cache_dir: str = "experiments/data"):
    api = get_api_client()
    cache_path = Path(cache_dir) / "newgen_cache.pkl"
    cache = {}
    if cache_path.exists():
        with open(cache_path, "rb") as f:
            cache = pickle.load(f)

    for tf in TIMEFRAMES:
        print(f"[newgen] fetching tf={tf}m ...", file=sys.stderr)
        df = fetch_history(api, tf, from_date, to_date)
        if refresh:
            try:
                df_today = fetch_intraday_today(api, tf)
                if not df_today.empty:
                    df = pd.concat([df, df_today])
                    df = df[~df.index.duplicated(keep="last")].sort_index()
            except Exception as e:
                print(f"[newgen] intraday refresh failed tf={tf}: {e}", file=sys.stderr)
        df = normalize(df)
        cache[tf] = df
        print(f"[newgen] tf={tf}m -> {len(df)} rows  {df.index[0] if len(df) else '-'} .. {df.index[-1] if len(df) else '-'}", file=sys.stderr)

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "wb") as f:
        pickle.dump(cache, f)
    print(f"[newgen] saved cache to {cache_path}", file=sys.stderr)
    return cache


def load_cache(cache_dir: str = "experiments/data") -> dict:
    cache_path = Path(cache_dir) / "newgen_cache.pkl"
    if not cache_path.exists():
        raise FileNotFoundError(f"newgen_cache.pkl missing. Run experiments/newgen_data.py first.")
    with open(cache_path, "rb") as f:
        return pickle.load(f)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="concat today's intraday data")
    parser.add_argument("--from-date", default=os.environ.get("NEWGEN_FROM_DATE", "2026-05-01"))
    parser.add_argument("--to-date", default=os.environ.get("NEWGEN_TO_DATE", datetime.now(config.IST).strftime("%Y-%m-%d")))
    parser.add_argument("--cache-dir", default="experiments/data")
    args = parser.parse_args()
    build_cache(args.from_date, args.to_date, refresh=args.refresh, cache_dir=args.cache_dir)

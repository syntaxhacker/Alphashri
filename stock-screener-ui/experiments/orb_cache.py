import sys
import json
import pickle
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
from backtest.utils import get_upstox_client_from_db

POPULAR_SYMBOLS = [
    "SJM", "PEL", "YESBANK", "IRFC", "IEX", "SUZLON", "ZOMATO", "DRREDDY",
    "PIDILITIND", "TATAPOWER", "ADANIENT", "ADANIPORTS", "HDFCAMC", "WIPRO",
    "TECHM", "HINDALCO", "TATASTEEL", "JSWSTEEL", "COALINDIA", "NTPC",
    "POWERGRID", "ONGC", "BPCL", "IOC", "HINDUNILVR", "BAJFINANCE", "RELIANCE",
    "TCS", "HDFCBANK", "INFY", "SBIN", "ICICIBANK", "KOTAKBANK", "AXISBANK",
    "ITC", "HCLTECH", "LT", "BAJAJFINSV", "TITAN", "MARUTI", "M&M", "EICHERMOT",
    "TATAMOTORS", "BOSCHLTD", "SCHAEFFLER", "TORNTPOWER", "TRENT", "DIXON",
    "VEDL", "ASTRAL", "LTIM", "KEI", "DALBHARAT", "CHAMBLFERT", "CANBK", "PNB",
    "UCOBANK", "BANKBARODA", "FEDERALBNK", "INDUSINDBK", "BANDHANBNK", "IOB",
    "IDFC", "TATAMTRDVR", "IFCI", "IBULHSGFIN", "SRF", "COROMANDEL", "ASIANPAINT",
    "DABUR", "COLPAL", "HINDUSTANLVR", "UPL", "GRASIM", "ACC", "AMBUJACEM",
    "ULTRACEMCO", "AMBUJACEMC", "HINDALCO", "VEDL", "JSWENERGY",
]


def _get_api_client():
    try:
        return UpstoxAPI(
            api_key=config.UPSTOX_API_KEY,
            api_secret=config.UPSTOX_API_SECRET,
            quiet=True,
        )
    except Exception:
        return get_upstox_client_from_db()


def fetch_volatile_symbols(limit=25, days=90):
    api = _get_api_client()
    today = datetime.now(config.IST).strftime("%Y-%m-%d")
    from_date = (datetime.now(config.IST) - timedelta(days=days + 30)).strftime("%Y-%m-%d")

    results = []
    for i, symbol in enumerate(POPULAR_SYMBOLS):
        print(f"Fetching {i+1}/{len(POPULAR_SYMBOLS)}: {symbol}...")
        try:
            df = api.fetch_historical_data_v3(
                symbol=symbol,
                unit="days",
                interval=1,
                to_date=today,
                from_date=from_date,
            )
            if df is None or df.empty:
                continue
            df["range_pct"] = (df["high"] - df["low"]) / df["close"] * 100
            avg_range = df["range_pct"].mean()
            results.append((symbol, avg_range))
        except Exception as e:
            print(f"  Skipped {symbol}: {e}")
            continue

    results.sort(key=lambda x: x[1], reverse=True)
    return [s for s, _ in results[:limit]]


def fetch_intraday_data(symbols, days=90, timeframe=5):
    api = _get_api_client()
    today = datetime.now(config.IST).strftime("%Y-%m-%d")
    from_date = (datetime.now(config.IST) - timedelta(days=days + 30)).strftime("%Y-%m-%d")

    cache = {}
    for i, symbol in enumerate(symbols):
        print(f"Fetching {i+1}/{len(symbols)}: {symbol}...")
        try:
            df = api.fetch_historical_data_v3(
                symbol=symbol,
                unit="minutes",
                interval=timeframe,
                to_date=today,
                from_date=from_date,
            )
            if df is None or df.empty:
                print(f"  Skipped {symbol}: no historical data")
                continue

            try:
                df_today = api.fetch_intraday_data_v3(
                    symbol=symbol, interval=str(timeframe)
                )
                if df_today is not None and not df_today.empty:
                    df = pd.concat([df, df_today])
                    df = df[~df.index.duplicated(keep="last")]
                    df.sort_index(inplace=True)
            except Exception:
                pass

            if df.index.tz is None:
                df.index = df.index.tz_localize("UTC")
            else:
                df.index = df.index.tz_convert("UTC")

            cache[symbol] = df
        except Exception as e:
            print(f"  Skipped {symbol}: {e}")
            continue

    return cache


def build_cache(limit=25, days=90, timeframe=5, cache_dir="experiments/data"):
    import pandas as pd

    symbols = fetch_volatile_symbols(limit=limit, days=days)
    print(f"\nTop {len(symbols)} volatile symbols: {symbols}\n")

    cache = fetch_intraday_data(symbols, days=days, timeframe=timeframe)

    cache_path = Path(cache_dir)
    cache_path.mkdir(parents=True, exist_ok=True)

    symbols_path = cache_path / "orb_symbols.json"
    with open(symbols_path, "w") as f:
        json.dump(symbols, f, indent=2)

    cache_file = cache_path / "orb_cache.pkl"
    with open(cache_file, "wb") as f:
        pickle.dump(cache, f)

    total_candles = sum(len(df) for df in cache.values())
    print(f"\nSaved symbols to {symbols_path}")
    print(f"Saved cache to {cache_file}")
    print(f"Cache built: {len(cache)} symbols, {total_candles} total candles")
    return cache


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Pre-fetch data for ORB autoresearch benchmark")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--timeframe", type=int, default=5)
    parser.add_argument("--cache-dir", type=str, default="experiments/data")
    args = parser.parse_args()

    build_cache(limit=args.limit, days=args.days, timeframe=args.timeframe, cache_dir=args.cache_dir)

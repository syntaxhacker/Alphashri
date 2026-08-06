#!/usr/bin/env python3
"""Fetch Nifty 50 spot price data for options backtesting.

Sources (in priority order):
1. Upstox API (1-min tick data, full history) — needs valid access token
2. yfinance (daily data, full history — fallback)

Usage:
  python3 experiments/fetch_nifty_spot.py

Output:
  experiments/data/nifty_spot_daily.csv   — Daily OHLC (always saved)
  experiments/data/nifty_spot_1min.csv     — 1-min OHLC (only if Upstox token available)
"""
import sys, os, json, csv, requests, urllib.parse
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(SCRIPT_DIR, 'experiments', 'data')
os.makedirs(DATA_DIR, exist_ok=True)

# Always save daily data from yfinance
print("Fetching Nifty 50 daily from yfinance...", file=sys.stderr)
import yfinance as yf
import pandas as pd

nifty = yf.download('^NSEI', start='2024-10-01', end='2026-02-10', interval='1d')
if nifty is not None and not nifty.empty:
    nifty.columns = [c[0].lower() for c in nifty.columns]
    nifty.index.name = 'date'
    nifty.to_csv(os.path.join(DATA_DIR, 'nifty_spot_daily.csv'))
    print(f"✅ Daily: {len(nifty)} rows ({nifty.index[0].date()} to {nifty.index[-1].date()})", file=sys.stderr)
    print(f"   Close range: ₹{nifty['close'].min():.0f} – ₹{nifty['close'].max():.0f}", file=sys.stderr)
else:
    print("❌ yfinance daily failed", file=sys.stderr)

# Try to fetch 1-min from Upstox (requires valid access token)
NIFTY_KEY = 'NSE_INDEX|Nifty 50'

# Try loading token from config or file
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..'))
try:
    import config
    token = config.UPSTOX_ACCESS_TOKEN if hasattr(config, 'UPSTOX_ACCESS_TOKEN') else None
except Exception:
    token = None

if not token:
    for p in [os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.upstox_token.json'),
              os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', '.upstox_token.json')]:
        if os.path.exists(p):
            with open(p) as f:
                token = json.load(f).get('access_token')
            break

if not token:
    token = os.environ.get('UPSTOX_ACCESS_TOKEN')

if token:
    print("Fetching Nifty 50 1-min from Upstox...", file=sys.stderr)
    headers = {'Accept': 'application/json', 'Authorization': f'Bearer {token}'}
    BASE = 'https://api.upstox.com/v2'
    enc = urllib.parse.quote(NIFTY_KEY, safe='')

    # Fetch in 30-day chunks (Upstox 1-min limit)
    start = datetime(2024, 10, 1)
    end = datetime(2026, 2, 10)
    all_candles = []
    chunk = start
    while chunk < end:
        chunk_end = min(chunk + timedelta(days=29), end)
        from_str = chunk.strftime('%Y-%m-%d')
        to_str = chunk_end.strftime('%Y-%m-%d')
        url = f"{BASE}/historical-candle/{enc}/minutes/1/{to_str}/{from_str}"
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                candles = data.get('data', {}).get('candles', [])
                all_candles.extend(candles)
                print(f"  {from_str}–{to_str}: {len(candles)} candles", file=sys.stderr)
            else:
                print(f"  {from_str}–{to_str}: HTTP {resp.status_code}", file=sys.stderr)
        except Exception as e:
            print(f"  {from_str}–{to_str}: {e}", file=sys.stderr)
        chunk = chunk_end + timedelta(days=1)

    if all_candles:
        df = pd.DataFrame(all_candles, columns=['datetime','open','high','low','close','volume','oi'])
        df['datetime'] = pd.to_datetime(df['datetime'])
        df = df.sort_values('datetime').set_index('datetime')
        df.to_csv(os.path.join(DATA_DIR, 'nifty_spot_1min.csv'))
        print(f"✅ 1-min: {len(df)} rows ({df.index[0]} to {df.index[-1]})", file=sys.stderr)
    else:
        print("❌ No 1-min data fetched", file=sys.stderr)
else:
    print("⚠️  No Upstox token — 1-min data skipped.", file=sys.stderr)
    print("   To get 1-min data, connect your Upstox broker in Settings > Brokers", file=sys.stderr)
    print("   Or set UPSTOX_ACCESS_TOKEN env var / .upstox_token.json file", file=sys.stderr)

print("\nDone.", file=sys.stderr)

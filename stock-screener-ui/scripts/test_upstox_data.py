#!/usr/bin/env python3
"""Test Upstox V3 API — fetch LTP and intraday data using ISIN-based keys."""

import sys, json, time, requests
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Load token
with open(ROOT / ".upstox_token.json") as f:
    token_data = json.load(f)
access_token = token_data.get("access_token", "")
print(f"Token: {access_token[:30]}...")

HEADERS = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}

# Known NSE_EQ instrument keys (ISIN-based)
SYMBOLS = {
    "RELIANCE": "NSE_EQ|INE002A01018",
    "TCS": "NSE_EQ|INE467B01029",
    "HDFCBANK": "NSE_EQ|INE040A01034",
    "INFY": "NSE_EQ|INE009A01021",
    "ICICIBANK": "NSE_EQ|INE090A01021",
}

# Step 1: LTP for each (quick check)
print("\n1. LTP quotes (V2)...")
for sym, ik in SYMBOLS.items():
    start = time.time()
    resp = requests.get(f"https://api.upstox.com/v2/market-quote/ltp?instrument_key={ik}", headers=HEADERS)
    elapsed = time.time() - start
    if resp.status_code == 200:
        data = resp.json()
        ltp = data.get("data", {}).get(ik, {}).get("last_price", "?")
        print(f"   {sym}: ₹{ltp} ({elapsed:.2f}s)")
    else:
        print(f"   {sym}: HTTP {resp.status_code} ({elapsed:.2f}s)")
    time.sleep(0.3)

# Step 2: Intraday data for first symbol
print("\n2. Intraday 1min for RELIANCE...")
start = time.time()
resp = requests.get(
    f"https://api.upstox.com/v3/historical-candle/intraday/{SYMBOLS['RELIANCE']}/1minute",
    headers=HEADERS,
)
elapsed = time.time() - start
if resp.status_code == 200:
    candles = resp.json().get("data", {}).get("candles", [])
    print(f"   ✅ {elapsed:.2f}s — {len(candles)} candles")
    if candles:
        last = candles[-1]
        print(f"   Last: {last[0]} O={last[1]} H={last[2]} L={last[3]} C={last[4]}")
else:
    print(f"   ❌ {elapsed:.2f}s — HTTP {resp.status_code}: {resp.text[:150]}")

# Step 3: Sequential intraday for remaining (rate limit test)
print("\n3. Rate limit test — sequential intraday fetches...")
for sym in ["TCS", "HDFCBANK", "INFY", "ICICIBANK"]:
    start = time.time()
    resp = requests.get(
        f"https://api.upstox.com/v3/historical-candle/intraday/{SYMBOLS[sym]}/1minute",
        headers=HEADERS,
    )
    elapsed = time.time() - start
    if resp.status_code == 200:
        c = resp.json().get("data", {}).get("candles", [])
        print(f"   {sym}: ✅ {elapsed:.2f}s — {len(c)} candles")
    elif resp.status_code == 429:
        print(f"   {sym}: ❌ 429 RATE LIMITED ({elapsed:.2f}s)")
    else:
        print(f"   {sym}: ❌ HTTP {resp.status_code} ({elapsed:.2f}s)")
    time.sleep(0.5)

print("\nDone!")

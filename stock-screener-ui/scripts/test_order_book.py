#!/usr/bin/env python3
"""Test Upstox V2 Order Book API — what does get_order_book return?"""

import json, sys, time, requests
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "stock-screener-ui"))

# Get token from DB first (broker_connections table), fallback to file
from db.models.broker import get_shared_broker_token

token_row = get_shared_broker_token("upstox")
access_token = token_row["access_token"] if token_row else None

if not access_token:
    try:
        with open(ROOT / ".upstox_token.json") as f:
            token_data = json.load(f)
        access_token = token_data.get("access_token", "")
    except Exception:
        pass

if not access_token:
    print("❌ No token found in DB or file")
    sys.exit(1)

print(f"Token: {access_token[:30]}...")

HEADERS = {
    "Authorization": f"Bearer {access_token}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}

url = "https://api.upstox.com/v2/order/retrieve-all"
print(f"\nGET {url}")
start = time.time()
resp = requests.get(url, headers=HEADERS)
elapsed = time.time() - start

print(f"\nStatus: {resp.status_code} ({elapsed:.2f}s)")
print(f"Headers: {dict(resp.headers)}")

if resp.status_code == 200:
    data = resp.json()
    print(f"\nTop-level keys: {list(data.keys())}")
    print(f"status: {data.get('status')}")

    orders = data.get("data", [])
    print(f"\nOrder count: {len(orders)}")

    if orders:
        print(f"\n--- First order keys ---")
        first = orders[0]
        for k, v in first.items():
            print(f"  {k}: {v}")

        if len(orders) > 1:
            print(f"\n--- Last order keys ---")
            last = orders[-1]
            for k, v in last.items():
                print(f"  {k}: {v}")
    else:
        print("\nNo orders found — empty array")
else:
    print(f"\nResponse text: {resp.text[:500]}")

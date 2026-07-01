#!/usr/bin/env python3
"""
Fetch NSE instruments from Upstox and save to the canonical location.

Usage:
    python scripts/fetch_instruments.py
"""

import io
import gzip
import json
from pathlib import Path
from urllib.request import urlopen

INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
DEST = Path(__file__).parent.parent.parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json"


def main():
    DEST.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading instruments from Upstox...")
    resp = urlopen(INSTRUMENTS_URL, timeout=30)
    raw = resp.read()
    decompressed = gzip.decompress(raw)
    data = json.loads(decompressed)
    print(f"Loaded {len(data)} instruments")

    with open(DEST, "w") as f:
        json.dump(data, f)

    mb = DEST.stat().st_size / (1024 * 1024)
    print(f"Saved to {DEST} ({mb:.1f} MB)")


if __name__ == "__main__":
    main()

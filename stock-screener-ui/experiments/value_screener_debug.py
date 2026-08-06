#!/usr/bin/env python3
"""Debug TV fundamental data availability."""
import sys, os
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJ_DIR)
sys.path.insert(0, os.path.join(PROJ_DIR, 'scanners'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader'))
sys.path.insert(0, os.path.join(PROJ_DIR, 'upstox_trader', 'screeners'))

from tradingview_screener import Query, col

# Test 1: simple query with just price/volume filters to see what we get
print("=== Test 1: Basic query (price>100, vol>100K) ===", file=sys.stderr)
try:
    _, df = (
        Query()
        .select('name', 'close', 'volume', 'market_cap_basic', 'P/E', 'P/B', 'EPS.this.Y', 'ROE', 'Debt/Equity', 'sector')
        .set_markets('india')
        .where(col('close') > 100, col('volume') > 100000, col('exchange') == 'NSE')
        .limit(10)
        .get_scanner_data()
    )
    print(f"Got {len(df) if df is not None else 0} rows", file=sys.stderr)
    if df is not None and not df.empty:
        print(df[['name','close','P/E','P/B','EPS.this.Y','ROE','Debt/Equity']].to_string())
    else:
        print("Empty result!", file=sys.stderr)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)

# Test 2: try with just P/E filter
print("\n=== Test 2: P/E between 5-30 ===", file=sys.stderr)
try:
    _, df = (
        Query()
        .select('name', 'close', 'volume', 'market_cap_basic', 'P/E', 'P/B', 'EPS.this.Y', 'ROE', 'Debt/Equity', 'sector')
        .set_markets('india')
        .where(col('close') > 50, col('P/E').between(5, 30), col('exchange') == 'NSE')
        .order_by('P/E', ascending=True)
        .limit(10)
        .get_scanner_data()
    )
    print(f"Got {len(df) if df is not None else 0} rows", file=sys.stderr)
    if df is not None and not df.empty:
        print(df[['name','close','P/E','P/B','EPS.this.Y','ROE','Debt/Equity']].to_string())
    else:
        print("Empty result!", file=sys.stderr)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)

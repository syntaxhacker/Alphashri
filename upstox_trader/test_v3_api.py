#!/usr/bin/env python3
"""
Test script to demonstrate the new V3 Upstox API capabilities
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

def test_v3_api():
    """Test the new V3 API functionality"""
    print("🚀 Testing Upstox V3 API Improvements")
    print("=" * 50)
    
    # Initialize API
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    if not api.access_token and not api.authenticate():
        print("❌ Authentication failed. Exiting.")
        return
    
    print("\n✅ Authentication successful!")
    
    # Test 1: Fetch 5-minute data using V3 API
    print("\n📊 Test 1: Fetching 5-minute intraday data using V3 API")
    print("-" * 50)
    
    df_5min = api.fetch_intraday_data_v3(
        symbol="RELIANCE",
        unit="minutes", 
        interval=5
    )
    
    if df_5min is not None and not df_5min.empty:
        print(f"✅ Successfully fetched {len(df_5min)} records")
        print("\n📈 Sample data (last 5 records):")
        print(df_5min.tail())
    else:
        print("❌ No data received")
    
    # Test 2: Fetch 15-minute data using V3 API
    print("\n📊 Test 2: Fetching 15-minute intraday data using V3 API")
    print("-" * 50)
    
    df_15min = api.fetch_intraday_data_v3(
        symbol="TATAMOTORS",
        unit="minutes",
        interval=15
    )
    
    if df_15min is not None and not df_15min.empty:
        print(f"✅ Successfully fetched {len(df_15min)} records")
        print(f"📅 Data range: {df_15min.index[0]} to {df_15min.index[-1]}")
        print("\n📈 Sample data (last 3 records):")
        print(df_15min.tail(3))
    else:
        print("❌ No data received")
    
    # Test 3: Fetch hourly data using V3 API
    print("\n📊 Test 3: Fetching 1-hour intraday data using V3 API")
    print("-" * 50)
    
    df_1hour = api.fetch_intraday_data_v3(
        symbol="INFY",
        unit="hours",
        interval=1
    )
    
    if df_1hour is not None and not df_1hour.empty:
        print(f"✅ Successfully fetched {len(df_1hour)} records")
        print(f"📅 Data range: {df_1hour.index[0]} to {df_1hour.index[-1]}")
        print("\n📈 Sample data (last 3 records):")
        print(df_1hour.tail(3))
    else:
        print("❌ No data received")
    
    # Compare data volumes
    print("\n📊 Data Volume Comparison")
    print("-" * 50)
    print(f"5-minute data points: {len(df_5min) if df_5min is not None else 0}")
    print(f"15-minute data points: {len(df_15min) if df_15min is not None else 0}")
    print(f"1-hour data points: {len(df_1hour) if df_1hour is not None else 0}")
    
    print("\n🎉 V3 API testing completed!")
    print("\nKey improvements with V3 API:")
    print("• Better intraday data coverage")
    print("• Support for 1-300 minute intervals")
    print("• Support for 1-5 hour intervals") 
    print("• More reliable data fetching")
    print("• Direct endpoint without date range limitations")

if __name__ == "__main__":
    test_v3_api()

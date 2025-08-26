#!/usr/bin/env python3
"""
Test script to mimic exactly how the existing code calls the Upstox API
"""

import sys
import os
from datetime import datetime, timedelta

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
    print("✅ Upstox API available")
except ImportError as e:
    print(f"⚠️ Upstox API not available: {e}")
    sys.exit(1)

def test_existing_api_call(api, symbol):
    """Test the exact API call that the existing code uses"""
    print(f"\nTesting symbol: {symbol}")
    print("="*50)
    
    try:
        # This is how the existing code calls fetch_intraday_data_v3
        # Based on the _fetch_price_from_exchange method in tv_screen_usage.py
        df = api.fetch_intraday_data_v3(
            symbol=symbol, 
            unit='minutes', 
            interval=1
        )
        
        if df is not None and not df.empty:
            print(f"✅ SUCCESS: Got {len(df)} candles")
            print(f"   First close: {df['close'].iloc[0]}")
            print(f"   Last close: {df['close'].iloc[-1]}")
            return True
        else:
            print(f"⚠️  NO DATA returned")
            return False
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def main():
    """Main function to test the existing API calls"""
    # Initialize Upstox API
    try:
        api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        if not api.authenticate():
            print("❌ Failed to authenticate with Upstox API")
            return
            
        print("✅ Successfully authenticated with Upstox API")
        
    except Exception as e:
        print(f"❌ Error initializing Upstox API: {e}")
        return
    
    # Test with symbols that should work based on the FOMO scan
    # These are the exact symbols from the TradingView output
    test_symbols = [
        "JKPAPER",    # From NSE:JKPAPER
        "ECLERX",     # From NSE:ECLERX
        "ACE",        # From NSE:ACE
        "RATEGAIN"    # From NSE:RATEGAIN
    ]
    
    working_symbols = []
    
    for symbol in test_symbols:
        if test_existing_api_call(api, symbol):
            working_symbols.append(symbol)
            print(f"✅ {symbol} works!")
        else:
            print(f"❌ {symbol} doesn't work")
    
    print(f"\n{'='*50}")
    print(f"Working symbols: {working_symbols}")

if __name__ == "__main__":
    main()
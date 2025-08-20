#!/usr/bin/env python3
"""
Temporary debug script to test Upstox API with problematic symbol
"""

import sys
import os
import time
from datetime import datetime

# Add the upstox_trader directory to path
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'upstox_trader'))

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
    print("✅ Successfully imported UpstoxAPI and config")
except ImportError as e:
    print(f"❌ Failed to import required modules: {e}")
    print("🔍 Checking available paths...")
    for path in sys.path:
        print(f"   {path}")
    sys.exit(1)

def test_upstox_connection():
    """Test basic Upstox API connection"""
    print("\n🔍 Testing Upstox API connection...")
    
    try:
        api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        if api.authenticate():
            print("✅ Upstox API authentication successful")
            return api
        else:
            print("❌ Upstox API authentication failed")
            return None
    except Exception as e:
        print(f"❌ Error connecting to Upstox API: {e}")
        return None

def test_symbol_formats(api, symbol_variants):
    """Test different symbol format variations"""
    print(f"\n🔍 Testing {len(symbol_variants)} symbol format variations...")
    
    results = {}
    
    for symbol_format in symbol_variants:
        print(f"\n📋 Testing symbol: '{symbol_format}'")
        
        try:
            # Try to fetch intraday data
            df = api.fetch_intraday_data_v3(
                symbol=symbol_format,
                unit='minutes',
                interval=1
            )
            
            if df is not None and not df.empty:
                print(f"✅ SUCCESS: Got data for {symbol_format}")
                print(f"   Data shape: {df.shape}")
                print(f"   Latest price: ₹{df['close'].iloc[-1]:.2f}")
                print(f"   Columns: {list(df.columns)}")
                results[symbol_format] = 'SUCCESS'
            else:
                print(f"❌ EMPTY: No data returned for {symbol_format}")
                results[symbol_format] = 'EMPTY'
                
        except Exception as e:
            error_msg = str(e).lower()
            print(f"❌ ERROR: {e}")
            
            # Check for specific error types
            if "instrument key" in error_msg:
                print(f"   → Instrument key not found error")
                results[symbol_format] = 'INSTRUMENT_NOT_FOUND'
            elif "not found" in error_msg:
                print(f"   → General not found error")
                results[symbol_format] = 'NOT_FOUND'
            else:
                results[symbol_format] = f'OTHER_ERROR: {e}'
        
        # Small delay to avoid rate limiting
        time.sleep(0.5)
    
    return results

def test_historical_data(api, symbol_format):
    """Test historical data fetching"""
    print(f"\n🔍 Testing historical data for: '{symbol_format}'")
    
    try:
        from datetime import datetime, timedelta
        
        # Calculate date range (last 5 days)
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
        
        df = api.fetch_historical_data_v3(
            symbol=symbol_format,
            unit='days',
            interval=1,
            to_date=to_date,
            from_date=from_date
        )
        
        if df is not None and not df.empty:
            print(f"✅ SUCCESS: Got historical data for {symbol_format}")
            print(f"   Data shape: {df.shape}")
            print(f"   Date range: {from_date} to {to_date}")
            print(f"   Latest close: ₹{df['close'].iloc[-1]:.2f}")
            return True
        else:
            print(f"❌ EMPTY: No historical data for {symbol_format}")
            return False
            
    except Exception as e:
        print(f"❌ ERROR fetching historical data: {e}")
        return False

def main():
    print("🚀 Starting Upstox API Symbol Debug Session")
    print("=" * 60)
    
    # Test API connection first
    api = test_upstox_connection()
    if not api:
        print("\n❌ Cannot proceed without API connection")
        return
    
    # Define different symbol format variations for problematic symbols
    symbol_variants = [
        'SOMATEX',        # Failed symbol 1
        'SOMTX',          # Maybe abbreviated
        'SOMA',           # Maybe shorter
        'CALSOFTPP',      # Failed symbol 2 (without .E1)
        'CALSOFT',        # Maybe different format  
        'TGL',            # Failed symbol 3
        'TGLOBAL',        # Maybe full name
        'INDSWFTLTD',     # Failed symbol 4
        'INDSWFT',        # Maybe abbreviated
        'INDSWIFT',       # Maybe different format
        'RELIANCE',       # Known working symbol for comparison
    ]
    
    # Test all symbol variations
    results = test_symbol_formats(api, symbol_variants)
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 SUMMARY OF RESULTS:")
    print("=" * 60)
    
    successful_symbols = [s for s, r in results.items() if r == 'SUCCESS']
    not_found_symbols = [s for s, r in results.items() if 'INSTRUMENT' in r or 'NOT_FOUND' in r]
    other_errors = [s for s, r in results.items() if r.startswith('OTHER_ERROR')]
    empty_results = [s for s, r in results.items() if r == 'EMPTY']
    
    print(f"✅ SUCCESS ({len(successful_symbols)}): {successful_symbols}")
    print(f"❌ INSTRUMENT NOT FOUND ({len(not_found_symbols)}): {not_found_symbols}")
    print(f"⚠️  OTHER ERRORS ({len(other_errors)}): {other_errors}")
    print(f"📭 EMPTY RESULTS ({len(empty_results)}): {empty_results}")
    
    # Test historical data on successful symbols
    if successful_symbols:
        print(f"\n🔍 Testing historical data on first successful symbol...")
        test_historical_data(api, successful_symbols[0])
    
    # Test fallback mechanism from the main script
    print(f"\n🔍 Testing fallback mechanism (NSE -> BSE)...")
    test_symbols = ['JSLL', 'CAMLINFINE']
    
    for symbol in test_symbols:
        print(f"\n📋 Testing fallback for: {symbol}")
        try:
            # Try NSE first
            if ':' not in symbol:
                symbol_nse = f"{symbol}:NSE"
                symbol_bse = f"{symbol}:BSE"
            else:
                symbol_nse = symbol
                symbol_bse = symbol.replace(':NSE', ':BSE').replace(':BSE', ':NSE')
            
            print(f"   First attempt: {symbol_nse}")
            df1 = api.fetch_intraday_data_v3(symbol=symbol_nse, unit='minutes', interval=1)
            
            if df1 is not None and not df1.empty:
                print(f"   ✅ NSE succeeded: Latest price ₹{df1['close'].iloc[-1]:.2f}")
            else:
                print(f"   ❌ NSE failed, trying BSE: {symbol_bse}")
                df2 = api.fetch_intraday_data_v3(symbol=symbol_bse, unit='minutes', interval=1)
                if df2 is not None and not df2.empty:
                    print(f"   ✅ BSE fallback succeeded: Latest price ₹{df2['close'].iloc[-1]:.2f}")
                else:
                    print(f"   ❌ Both NSE and BSE failed")
                    
        except Exception as e:
            print(f"   ❌ Error in fallback test: {e}")

if __name__ == "__main__":
    main()
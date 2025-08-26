#!/usr/bin/env python3
"""
Test script to find the correct symbol format for Upstox API
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

def test_symbol_formats(api, base_symbol):
    """Test different symbol formats to see which one works"""
    formats_to_try = [
        (base_symbol, None, None),  # Just the symbol
        (base_symbol, 'NSE_EQ', 'EQ'),  # With exchange and instrument type
        (base_symbol, 'BSE_EQ', 'EQ'),  # With BSE exchange
        (f"NSE_EQ:{base_symbol}", None, None),  # With NSE prefix
        (f"BSE_EQ:{base_symbol}", None, None),  # With BSE prefix
        (f"{base_symbol}-EQ", None, None),      # With EQ suffix
        (f"{base_symbol}.NS", None, None),      # With NS suffix
        (f"{base_symbol}.BO", None, None),      # With BO suffix
    ]
    
    print(f"\nTesting symbol formats for: {base_symbol}")
    print("="*50)
    
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    for symbol_format, exchange, instrument_type in formats_to_try:
        try:
            print(f"Trying: {symbol_format}" + (f" with exchange={exchange}, instrument_type={instrument_type}" if exchange else ""))
            
            # Prepare kwargs
            kwargs = {
                'symbol': symbol_format,
                'unit': 'minutes',
                'interval': 1,
                'to_date': to_date,
                'from_date': from_date
            }
            
            if exchange:
                kwargs['exchange'] = exchange
            if instrument_type:
                kwargs['instrument_type'] = instrument_type
                
            df = api.fetch_historical_data_v3(**kwargs)
            
            if df is not None and not df.empty:
                print(f"✅ SUCCESS: {symbol_format} - Got {len(df)} candles")
                print(f"   First close: {df['close'].iloc[0]}")
                print(f"   Last close: {df['close'].iloc[-1]}")
                return symbol_format  # Return the working format
            else:
                print(f"⚠️  NO DATA: {symbol_format}")
                
        except Exception as e:
            if "instrument key" in str(e).lower() or "not found" in str(e).lower():
                print(f"❌ NOT FOUND: {symbol_format}")
            else:
                print(f"⚠️  ERROR: {symbol_format} - {str(e)[:50]}...")
    
    return None

def main():
    """Main function to test symbol formats"""
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
    
    # Test the actual trading symbols we found
    test_symbols = [
        "JKPAPER",     # From our search
        "ECLERX",      # From our search
        "ACE",         # This might be ambiguous, let's try the direct symbol
        "RATEGAIN"     # From our search
    ]
    
    working_formats = {}
    
    for symbol in test_symbols:
        working_format = test_symbol_formats(api, symbol)
        if working_format:
            working_formats[symbol] = working_format
            print(f"\n✅ Found working format for {symbol}: {working_format}")
        else:
            print(f"\n❌ No working format found for {symbol}")
    
    print("\n" + "="*50)
    print("SUMMARY OF WORKING FORMATS:")
    for symbol, format in working_formats.items():
        print(f"  {symbol}: {format}")

if __name__ == "__main__":
    main()
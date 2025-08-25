#!/usr/bin/env python3
"""
Debug script to investigate instrument lookup issues
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'upstox_trader'))

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
import json
import gzip
import requests
from datetime import datetime

def debug_instrument_lookup():
    """Debug instrument key lookup for problematic symbols"""
    
    print("🔍 Debugging Instrument Key Lookup Issues")
    print("=" * 50)
    
    # Initialize API
    api = UpstoxAPI(
        api_key=UPSTOX_CONFIG.get('api_key'),
        api_secret=UPSTOX_CONFIG.get('api_secret')
    )
    
    # Problematic symbols from the error output
    problematic_symbols = ['SILVER360', 'QUALITY30', 'INDSWFTLTD', 'TICL', 'DPWIRES', 'DUGLOBAL', 'DCXINDIA', 'ONDOOR', 'PREMIER', 'TIMESCAN']
    
    print("\n📋 Testing problematic symbols:")
    for symbol in problematic_symbols:
        print(f"\n🔍 Testing symbol: {symbol}")
        
        # Test different exchange segments
        segments_to_test = [
            ('NSE_EQ', 'EQ'),
            ('NSE_INDEX', 'INDEX'),
            ('NSE_ETF', 'ETF'),
            ('NSE_COM', 'COM'),
            ('BSE_EQ', 'EQ'),
            ('BSE_INDEX', 'INDEX')
        ]
        
        for exchange, instrument_type in segments_to_test:
            print(f"   Testing segment: {exchange} (type: {instrument_type})")
            
            instrument_key = api.get_instrument_key(
                symbol=symbol,
                exchange=exchange,
                instrument_type=instrument_type
            )
            
            if instrument_key:
                print(f"   ✅ FOUND: {instrument_key}")
                
                # Try to fetch data with this key
                try:
                    df = api.fetch_intraday_data_v3(
                        symbol=symbol,
                        unit='minutes',
                        interval=1,
                        exchange=exchange,
                        instrument_type=instrument_type
                    )
                    
                    if df is not None and not df.empty:
                        print(f"   ✅ DATA FETCHED: {len(df)} records")
                        print(f"   📅 Date range: {df.index[0]} to {df.index[-1]}")
                    else:
                        print(f"   ❌ No data returned")
                        
                except Exception as e:
                    print(f"   ❌ Data fetch error: {e}")
            else:
                print(f"   ❌ Not found in {exchange}")
        
        print("   " + "-" * 30)

def debug_instrument_database():
    """Debug the instrument database itself"""
    
    print("\n🔍 Debugging Instrument Database")
    print("=" * 50)
    
    # Check if cache file exists
    cache_file = "nse_instruments.json"
    if os.path.exists(cache_file):
        print(f"✅ Cache file exists: {cache_file}")
        with open(cache_file, 'r') as f:
            cached_data = json.load(f)
        print(f"📊 Cache contains {len(cached_data)} instruments")
        
        # Check for problematic symbols in cache
        problematic_symbols = ['SILVER360', 'QUALITY30', 'INDSWFTLTD', 'TICL', 'DPWIRES', 'DUGLOBAL', 'DCXINDIA', 'ONDOOR', 'PREMIER', 'TIMESCAN']
        
        for symbol in problematic_symbols:
            matches = []
            for instrument in cached_data:
                if (symbol in instrument.get('trading_symbol', '').upper() or
                    symbol in instrument.get('name', '').upper()):
                    matches.append(instrument)
            
            if matches:
                print(f"\n🔍 {symbol} found in cache ({len(matches)} matches):")
                for match in matches[:3]:
                    print(f"   📋 {match.get('trading_symbol')} | {match.get('name')} | {match.get('segment')} | {match.get('instrument_key')}")
            else:
                print(f"\n❌ {symbol} NOT found in cache")
    else:
        print(f"❌ Cache file not found: {cache_file}")
    
    # Download fresh instrument list
    print(f"\n📥 Downloading fresh instrument list...")
    try:
        url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        with gzip.open(response.raw, 'rt', encoding='utf-8') as gz_file:
            fresh_data = json.load(gz_file)
        
        print(f"✅ Fresh list downloaded: {len(fresh_data)} instruments")
        
        # Check for problematic symbols in fresh data
        for symbol in problematic_symbols:
            matches = []
            for instrument in fresh_data:
                if (symbol in instrument.get('trading_symbol', '').upper() or
                    symbol in instrument.get('name', '').upper()):
                    matches.append(instrument)
            
            if matches:
                print(f"\n🔍 {symbol} found in fresh data ({len(matches)} matches):")
                for match in matches[:3]:
                    print(f"   📋 {match.get('trading_symbol')} | {match.get('name')} | {match.get('segment')} | {match.get('instrument_key')}")
            else:
                print(f"\n❌ {symbol} NOT found in fresh data")
                
    except Exception as e:
        print(f"❌ Failed to download fresh data: {e}")

def test_manual_search():
    """Test manual search in instrument database"""
    
    print("\n🔍 Manual Search in Instrument Database")
    print("=" * 50)
    
    # Try to load from cache or download
    cache_file = "nse_instruments.json"
    if os.path.exists(cache_file):
        with open(cache_file, 'r') as f:
            instruments = json.load(f)
    else:
        print("❌ No cache file available for manual search")
        return
    
    # Manual search patterns
    search_patterns = {
        'SILVER360': ['SILVER360', 'SILVER'],
        'QUALITY30': ['QUALITY30', 'QUALITY'],
        'INDSWFTLTD': ['INDSWFTLTD', 'INDSWFT', 'SWIFT'],
        'TICL': ['TICL'],
        'DPWIRES': ['DPWIRES', 'DP', 'WIRES'],
        'DUGLOBAL': ['DUGLOBAL', 'DU', 'GLOBAL'],
        'DCXINDIA': ['DCXINDIA', 'DCX'],
        'ONDOOR': ['ONDOOR', 'ON', 'DOOR'],
        'PREMIER': ['PREMIER'],
        'TIMESCAN': ['TIMESCAN', 'TIME', 'SCAN']
    }
    
    for symbol, patterns in search_patterns.items():
        print(f"\n🔍 Manual search for {symbol}:")
        found_instruments = []
        
        for instrument in instruments:
            trading_symbol = instrument.get('trading_symbol', '').upper()
            name = instrument.get('name', '').upper()
            
            # Check if any pattern matches
            for pattern in patterns:
                if pattern in trading_symbol or pattern in name:
                    found_instruments.append(instrument)
                    break
        
        if found_instruments:
            print(f"   ✅ Found {len(found_instruments)} matches:")
            for i, instrument in enumerate(found_instruments[:5]):
                print(f"   {i+1}. {instrument.get('trading_symbol')} | {instrument.get('name')} | {instrument.get('segment')} | {instrument.get('instrument_key')}")
        else:
            print(f"   ❌ No matches found")

if __name__ == "__main__":
    debug_instrument_lookup()
    debug_instrument_database()
    test_manual_search()
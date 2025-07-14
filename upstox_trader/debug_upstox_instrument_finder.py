#!/usr/bin/env python3
"""
Upstox Instrument Key Finder
Find the correct instrument key for any NSE symbol
"""

import sys
from config import UPSTOX_CONFIG
from free_indian_apis import UpstoxAPI

def find_instrument_key(symbol_to_find):
    """Find instrument key for a given symbol"""
    print(f"🔍 Searching for instrument key: {symbol_to_find}")
    
    # Initialize API
    api = UpstoxAPI(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret']
    )
    
    # Authenticate
    if not api.access_token:
        print("🔑 Authenticating...")
        if not api.authenticate():
            print("❌ Authentication failed")
            return None
    
    print("✅ Authentication successful")
    
    # Try to load instruments
    try:
        if hasattr(api, '_download_and_cache_instruments'):
            print("📥 Loading instruments from Upstox...")
            api._download_and_cache_instruments()
        else:
            print("⚠️  No instrument loading method available")
            return None
            
        if not api.instruments:
            print("❌ No instruments loaded")
            return None
            
        print(f"✅ Loaded {len(api.instruments)} instruments")
        
    except Exception as e:
        print(f"❌ Error loading instruments: {e}")
        return None
    
    # Search for the symbol
    matches = []
    sample_logged = False
    
    for instrument in api.instruments:
        # Debug: Print first few instruments to see the structure
        if not sample_logged:
            print(f"\n🔧 Debug - Sample instrument structure:")
            print(f"Keys: {list(instrument.keys())}")
            print(f"Sample: {instrument}")
            sample_logged = True
            
        trading_symbol = instrument.get('trading_symbol', '')  # Fixed field name
        exchange = instrument.get('exchange', '')
        instrument_type = instrument.get('instrument_type', '')
        exchange_token = instrument.get('exchange_token', '')  # Fixed field name
        instrument_key = instrument.get('instrument_key', '')  # Use existing key
        name = instrument.get('name', '')
        
        # Look for exact matches in NSE equity
        if (trading_symbol == symbol_to_find and 
            exchange == 'NSE' and 
            instrument_type == 'EQ'):
            
            matches.append({
                'symbol': trading_symbol,
                'name': name,
                'exchange': exchange,
                'type': instrument_type,
                'token': exchange_token,
                'key': instrument_key  # Use the existing instrument_key
            })
            break  # Found exact match, exit early
    
    if matches:
        print(f"\n🎯 Found {len(matches)} exact match(es) for {symbol_to_find}:")
        for i, match in enumerate(matches, 1):
            print(f"\n  {i}. {match['symbol']} - {match['name']}")
            print(f"     Exchange: {match['exchange']} | Type: {match['type']}")
            print(f"     Token: {match['token']}")
            print(f"     📋 Instrument Key: {match['key']}")
            
        return matches[0]['key']  # Return first match
    
    # If no exact match, look for partial matches
    print(f"\n❌ No exact match found for {symbol_to_find}")
    print("🔍 Looking for partial matches...")
    
    partial_matches = []
    for instrument in api.instruments:
        trading_symbol = instrument.get('trading_symbol', '')  # Fixed field name
        exchange = instrument.get('exchange', '')
        name = instrument.get('name', '').upper()
        
        if (exchange == 'NSE' and 
            (symbol_to_find.upper() in trading_symbol.upper() or 
             symbol_to_find.upper() in name)):
            
            partial_matches.append({
                'symbol': trading_symbol,
                'name': name,
                'exchange': exchange,
                'type': instrument.get('instrument_type', ''),
                'token': instrument.get('exchange_token', ''),  # Fixed field name
                'key': instrument.get('instrument_key', '')  # Use existing key
            })
    
    if partial_matches:
        print(f"\n🔍 Found {len(partial_matches)} partial match(es):")
        for i, match in enumerate(partial_matches[:10], 1):  # Show max 10
            print(f"  {i}. '{match['symbol']}' - {match['name']} ({match['type']}) | Key: {match['key']}")
            
        print(f"\n💡 Try one of these exact symbols:")
        for match in partial_matches[:5]:
            if match['type'] == 'EQ':
                print(f"  python upstox_paper_trading_bot.py --symbol {match['symbol']}")
    else:
        print(f"❌ No matches found for {symbol_to_find}")
        print("💡 Make sure the symbol is correct and listed on NSE")
    
    return None

def main():
    if len(sys.argv) != 2:
        print("""
🔍 Upstox Instrument Key Finder

Usage: python debug_upstox_instrument_finder.py SYMBOL

Examples:
  python debug_upstox_instrument_finder.py COCHINSHIP
  python debug_upstox_instrument_finder.py RELIANCE
  python debug_upstox_instrument_finder.py HDFCBANK

This will find the correct instrument key for real-time WebSocket streaming.
        """)
        sys.exit(1)
    
    symbol = sys.argv[1].upper()
    
    print(f"""
🔍 UPSTOX INSTRUMENT KEY FINDER
{'=' * 40}
Symbol: {symbol}
Exchange: NSE (Equity)
    """)
    
    instrument_key = find_instrument_key(symbol)
    
    if instrument_key:
        print(f"""
✅ SUCCESS! Add this to known_symbols in upstox_paper_trading_bot.py:

'{symbol}': '{instrument_key}',

Then you can trade: python upstox_paper_trading_bot.py --symbol {symbol}
        """)
    else:
        print(f"""
❌ Could not find instrument key for {symbol}

Possible reasons:
1. Symbol name is incorrect
2. Symbol is not listed on NSE
3. Symbol is delisted or suspended
4. API access issue

Try checking the exact symbol on NSE website or trading platform.
        """)

if __name__ == "__main__":
    main() 
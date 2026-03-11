#!/usr/bin/env python3
"""
Script to find the actual instrument names in the NSE instruments file
"""

import json
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def search_instruments_for_symbol(symbol_to_find):
    """Search for a symbol in the NSE instruments file"""
    instrument_file = "nse_instruments.json"
    
    if not os.path.exists(instrument_file):
        print(f"❌ Instrument file {instrument_file} not found")
        return []
    
    print(f"🔍 Searching for symbols containing '{symbol_to_find}'...")
    
    matches = []
    
    try:
        # Since the file is large, we'll read it in chunks or use a streaming approach
        with open(instrument_file, 'r') as f:
            # Try to load as JSON array
            instruments = json.load(f)
            
        for instrument in instruments:
            if instrument.get('segment') == 'NSE_EQ':
                trading_symbol = instrument.get('trading_symbol', '').upper()
                name = instrument.get('name', '').upper()
                
                # Check if our symbol is in either the trading symbol or name
                if (symbol_to_find.upper() in trading_symbol or 
                    symbol_to_find.upper() in name):
                    matches.append({
                        'trading_symbol': trading_symbol,
                        'name': name,
                        'instrument_key': instrument.get('instrument_key', ''),
                        'exchange_token': instrument.get('exchange_token', '')
                    })
                    
                    # Limit to first 10 matches to avoid too much output
                    if len(matches) >= 10:
                        break
                        
    except Exception as e:
        print(f"❌ Error reading instruments file: {e}")
        return []
    
    return matches

def main():
    """Main function to search for instrument symbols"""
    # Symbols we want to find
    symbols_to_find = ["JKPAPER", "ECLERX", "ACE", "RATEGAIN"]
    
    for symbol in symbols_to_find:
        print(f"\n{'='*60}")
        matches = search_instruments_for_symbol(symbol)
        
        if matches:
            print(f"✅ Found {len(matches)} matches for '{symbol}':")
            for i, match in enumerate(matches, 1):
                print(f"  {i}. {match['trading_symbol']} - {match['name']}")
                print(f"     Instrument Key: {match['instrument_key']}")
        else:
            print(f"❌ No matches found for '{symbol}'")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Debug script to find correct symbol formats for missing instruments
Usage: 
    python debug_missing_symbols.py BLACKBUCK INOXGREEN NEWGEN
    python debug_missing_symbols.py --symbols RELIANCE TATA TCS
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import json
import requests
import gzip
import argparse
from rich.console import Console
from rich.table import Table

console = Console()

def generate_search_terms(symbol):
    """Generate intelligent search terms for a symbol"""
    symbol = symbol.upper()
    
    # Common word patterns
    search_terms = [symbol]  # Always search for exact match
    
    # Add partial matches for compound words
    if len(symbol) > 6:
        # Try first 4-6 characters
        search_terms.append(symbol[:4])
        search_terms.append(symbol[:5])
        search_terms.append(symbol[:6])
    
    # Common word splits
    common_splits = {
        'BLACKBUCK': ['BLACK', 'BUCK', 'ZINKA', 'LOGISTICS'],
        'INOXGREEN': ['INOX', 'GREEN', 'ENERGY'],
        'NEWGEN': ['NEW', 'GEN', 'SOFTWARE'],
        'TATAMOTORS': ['TATA', 'MOTORS', 'MOTOR'],
        'RELIANCEPWR': ['RELIANCE', 'POWER', 'PWR'],
        'ASIANPAINT': ['ASIAN', 'PAINT', 'PAINTS'],
    }
    
    if symbol in common_splits:
        search_terms.extend(common_splits[symbol])
    else:
        # Auto-generate splits for common patterns
        if 'POWER' in symbol or 'PWR' in symbol:
            search_terms.extend(['POWER', 'PWR'])
        if 'TECH' in symbol:
            search_terms.extend(['TECH', 'TECHNOLOGY'])
        if 'MOTOR' in symbol:
            search_terms.extend(['MOTOR', 'MOTORS'])
        if 'PHARMA' in symbol:
            search_terms.extend(['PHARMA', 'PHARMACEUTICAL'])
    
    return list(set(search_terms))  # Remove duplicates

def search_instruments(symbols_to_search):
    """Search for missing symbols in Upstox instrument list"""
    
    console.print("🔍 **Debugging Missing Symbols**")
    console.print("=" * 50)
    console.print(f"Searching for: {', '.join(symbols_to_search)}")
    console.print()
    
    # Auto-generate search terms
    search_terms = {}
    for symbol in symbols_to_search:
        search_terms[symbol] = generate_search_terms(symbol)
    
    console.print("📥 Downloading NSE instruments list...")
    
    try:
        # Download NSE instruments
        url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        with gzip.open(response.raw, 'rt', encoding='utf-8') as gz_file:
            instruments = json.load(gz_file)
        
        console.print(f"✅ Downloaded {len(instruments)} instruments")
        
        # Search for missing symbols
        for symbol in symbols_to_search:
            console.print(f"\n🔍 Searching for {symbol}...")
            console.print(f"Search terms: {', '.join(search_terms[symbol])}")
            
            found_matches = []
            search_words = search_terms[symbol]
            
            for instrument in instruments:
                name = instrument.get('name', '').upper()
                trading_symbol = instrument.get('trading_symbol', '').upper()
                
                # Check if any search term matches
                for search_word in search_words:
                    if (search_word in name or search_word in trading_symbol):
                        found_matches.append(instrument)
                        break
            
            if found_matches:
                console.print(f"✅ Found {len(found_matches)} potential matches:")
                
                table = Table(show_header=True, header_style="bold green")
                table.add_column("Trading Symbol", style="cyan")
                table.add_column("Name", style="white")
                table.add_column("Instrument Key", style="yellow")
                table.add_column("Segment", style="blue")
                
                for match in found_matches[:10]:  # Show top 10 matches
                    table.add_row(
                        match.get('trading_symbol', 'N/A'),
                        match.get('name', 'N/A')[:40] + "..." if len(match.get('name', '')) > 40 else match.get('name', 'N/A'),
                        match.get('instrument_key', 'N/A'),
                        match.get('segment', 'N/A')
                    )
                
                console.print(table)
            else:
                console.print(f"❌ No matches found for {symbol}")
        
        # Also search in BSE
        console.print(f"\n📥 Checking BSE instruments...")
        
        bse_url = "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz"
        bse_response = requests.get(bse_url, stream=True, timeout=30)
        bse_response.raise_for_status()
        
        with gzip.open(bse_response.raw, 'rt', encoding='utf-8') as gz_file:
            bse_instruments = json.load(gz_file)
        
        console.print(f"✅ Downloaded {len(bse_instruments)} BSE instruments")
        
        for symbol in symbols_to_search:
            console.print(f"\n🔍 Searching BSE for {symbol}...")
            
            found_matches = []
            search_words = search_terms[symbol]
            
            for instrument in bse_instruments:
                name = instrument.get('name', '').upper()
                trading_symbol = instrument.get('trading_symbol', '').upper()
                
                for search_word in search_words:
                    if (search_word in name or search_word in trading_symbol):
                        found_matches.append(instrument)
                        break
            
            if found_matches:
                console.print(f"✅ Found {len(found_matches)} BSE matches:")
                
                table = Table(show_header=True, header_style="bold blue")
                table.add_column("Trading Symbol", style="cyan")
                table.add_column("Name", style="white")
                table.add_column("Instrument Key", style="yellow")
                table.add_column("Segment", style="blue")
                
                for match in found_matches[:5]:
                    table.add_row(
                        match.get('trading_symbol', 'N/A'),
                        match.get('name', 'N/A')[:40] + "..." if len(match.get('name', '')) > 40 else match.get('name', 'N/A'),
                        match.get('instrument_key', 'N/A'),
                        match.get('segment', 'N/A')
                    )
                
                console.print(table)
            else:
                console.print(f"❌ No BSE matches found for {symbol}")
    
    except Exception as e:
        console.print(f"❌ Error: {str(e)}")

def main():
    parser = argparse.ArgumentParser(
        description='Debug missing symbols in Upstox instrument list',
        epilog='''
Examples:
  python debug_missing_symbols.py BLACKBUCK NEWGEN
  python debug_missing_symbols.py --symbols RELIANCE TATA TCS
  python debug_missing_symbols.py ASIANPAINT TATAMOTORS INOXGREEN
        ''',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument('symbols', nargs='*', help='Symbol names to search for')
    parser.add_argument('--symbols', dest='symbols_alt', nargs='+', help='Alternative way to specify symbols')
    
    args = parser.parse_args()
    
    # Get symbols from either positional args or --symbols flag
    symbols = args.symbols or args.symbols_alt or []
    
    if not symbols:
        console.print("[red]❌ No symbols provided![/red]")
        console.print("Usage: python debug_missing_symbols.py SYMBOL1 SYMBOL2 ...")
        console.print("   or: python debug_missing_symbols.py --symbols SYMBOL1 SYMBOL2 ...")
        return
    
    # Convert to uppercase
    symbols = [s.upper() for s in symbols]
    
    search_instruments(symbols)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Symbol Validation and Mapping for Upstox API
=============================================

This module provides symbol validation and mapping to handle discrepancies
between TradingView symbols and Upstox instrument keys.
"""

import json
import os
from pathlib import Path
from rich.console import Console

console = Console()

class SymbolValidator:
    """Validates and maps symbols for Upstox API compatibility"""
    
    def __init__(self, instrument_file_path="nse_instruments.json"):
        self.instrument_file = Path(instrument_file_path)
        self.valid_symbols = set()
        self.symbol_mapping = {}
        self.blacklist = set()
        self.load_instruments()
        self.setup_known_mappings()
    
    def load_instruments(self):
        """Load NSE instruments and build valid symbols set"""
        try:
            if self.instrument_file.exists():
                with open(self.instrument_file, 'r') as f:
                    instruments = json.load(f)
                    
                for instrument in instruments:
                    if instrument.get('segment') == 'NSE_EQ':
                        trading_symbol = instrument.get('trading_symbol', '').upper()
                        if trading_symbol:
                            self.valid_symbols.add(trading_symbol)
                
                console.print(f"[green]✅ Loaded {len(self.valid_symbols)} valid NSE symbols[/green]")
            else:
                console.print("[yellow]⚠️ NSE instruments file not found - validation disabled[/yellow]")
        except Exception as e:
            console.print(f"[red]❌ Error loading instruments: {e}[/red]")
    
    def setup_known_mappings(self):
        """Setup known symbol mappings for common TradingView -> Upstox conversions"""
        self.symbol_mapping = {
            # Known non-existent or problematic symbols from TradingView
            'SOMATEX': None,      # Doesn't exist in NSE
            'CALSOFTPP.E1': None, # Wrong format - doesn't exist
            'CALSOFTPP': None,    # Doesn't exist in NSE
            'TGL': None,          # Doesn't exist in NSE
            'INDSWFTLTD': None,   # Doesn't exist in NSE
            'CAMLINFINE': None,   # Doesn't exist in NSE
            
            # Add any known mappings here in future
            # 'OLD_SYMBOL': 'NEW_SYMBOL',
        }
        
        # Add all None mappings to blacklist
        for symbol, mapping in self.symbol_mapping.items():
            if mapping is None:
                self.blacklist.add(symbol.upper())
    
    def clean_symbol(self, symbol):
        """Clean symbol by removing exchange prefixes and suffixes"""
        if not symbol:
            return None
            
        # Remove exchange prefixes
        cleaned = symbol.upper()
        if ':' in cleaned:
            cleaned = cleaned.split(':', 1)[1]
        
        # Remove common suffixes that cause issues
        suffixes_to_remove = ['.E1', '.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
        for suffix in suffixes_to_remove:
            if cleaned.endswith(suffix):
                cleaned = cleaned[:-len(suffix)]
                break
        
        return cleaned.strip()
    
    def validate_symbol(self, symbol):
        """
        Validate if a symbol exists in NSE instruments
        
        Returns:
        - (True, cleaned_symbol) if valid
        - (False, reason) if invalid
        """
        if not symbol:
            return False, "Empty symbol"
        
        cleaned = self.clean_symbol(symbol)
        if not cleaned:
            return False, "Symbol became empty after cleaning"
        
        # Check blacklist first
        if cleaned in self.blacklist:
            return False, f"Symbol {cleaned} is blacklisted (doesn't exist in NSE)"
        
        # Check known mappings
        if cleaned in self.symbol_mapping:
            mapped = self.symbol_mapping[cleaned]
            if mapped is None:
                return False, f"Symbol {cleaned} is mapped to None (doesn't exist)"
            return True, mapped
        
        # Check if symbol exists in NSE instruments
        if cleaned in self.valid_symbols:
            return True, cleaned
        
        # Symbol not found - add to blacklist
        self.blacklist.add(cleaned)
        console.print(f"[red]❌ Symbol {cleaned} not found in NSE instruments - adding to blacklist[/red]")
        return False, f"Symbol {cleaned} not found in NSE instruments"
    
    def get_valid_symbol(self, symbol):
        """
        Get valid symbol if exists, None otherwise
        Returns the cleaned/mapped symbol or None
        """
        is_valid, result = self.validate_symbol(symbol)
        return result if is_valid else None
    
    def is_symbol_blacklisted(self, symbol):
        """Check if symbol is blacklisted"""
        cleaned = self.clean_symbol(symbol)
        return cleaned in self.blacklist if cleaned else True
    
    def add_to_blacklist(self, symbol):
        """Add symbol to blacklist"""
        cleaned = self.clean_symbol(symbol)
        if cleaned:
            self.blacklist.add(cleaned)
            console.print(f"[yellow]⚠️ Added {cleaned} to blacklist[/yellow]")
    
    def get_blacklist(self):
        """Get current blacklist"""
        return self.blacklist.copy()
    
    def get_stats(self):
        """Get validation statistics"""
        return {
            'valid_symbols': len(self.valid_symbols),
            'blacklisted_symbols': len(self.blacklist),
            'symbol_mappings': len([m for m in self.symbol_mapping.values() if m is not None])
        }

# Global validator instance
_validator = None

def get_symbol_validator():
    """Get global symbol validator instance"""
    global _validator
    if _validator is None:
        _validator = SymbolValidator()
    return _validator

def validate_symbol(symbol):
    """Convenience function to validate a symbol"""
    validator = get_symbol_validator()
    return validator.validate_symbol(symbol)

def get_valid_symbol(symbol):
    """Convenience function to get valid symbol"""
    validator = get_symbol_validator()
    return validator.get_valid_symbol(symbol)

def is_symbol_blacklisted(symbol):
    """Convenience function to check if symbol is blacklisted"""
    validator = get_symbol_validator()
    return validator.is_symbol_blacklisted(symbol)

if __name__ == "__main__":
    # Test the validator
    validator = SymbolValidator()
    
    test_symbols = [
        'RELIANCE', 'SOMATEX', 'CALSOFTPP.E1', 'TGL', 'INDSWFTLTD', 
        'NSE:JSLL', 'CAMLINFINE', 'TATAMOTORS'
    ]
    
    console.print("\n[blue]Testing Symbol Validator[/blue]")
    console.print("=" * 50)
    
    for symbol in test_symbols:
        is_valid, result = validator.validate_symbol(symbol)
        status = "✅ VALID" if is_valid else "❌ INVALID"
        console.print(f"{status} | {symbol:15} -> {result}")
    
    console.print(f"\n[green]Stats: {validator.get_stats()}[/green]")
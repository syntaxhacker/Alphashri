#!/usr/bin/env python3
"""
Enhanced Stock Discoverer for Volatility Scanner
===============================================

This module expands the stock universe by:
1. Dynamic TradingView screening across multiple market segments
2. Real-time symbol validation with Upstox
3. Intelligent caching and discovery
4. Progressive symbol expansion

Goal: Discover 200-500+ tradeable NSE stocks dynamically
"""

import time
import logging
from typing import List, Dict, Set, Optional
from tradingview_screener import Query, col
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from clean_symbol_list_20250714_121956 import VALIDATED_SYMBOLS, SYMBOL_INSTRUMENT_MAPPING

logger = logging.getLogger('StockDiscoverer')

class EnhancedStockDiscoverer:
    """Dynamically discover and validate more NSE stocks"""
    
    def __init__(self):
        self.upstox_api = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        self.discovered_symbols = set(VALIDATED_SYMBOLS)
        self.invalid_symbols = {'RPOWER', 'GMRINFRA', 'IOCL', 'HPCL', 'ZOMATO', 'MINDTREE', 'L&TFH', 'MOTHERSUMI', 'THDC'}
        self.symbol_instrument_cache = SYMBOL_INSTRUMENT_MAPPING.copy()
        
    def discover_stocks_by_segments(self) -> List[Dict]:
        """Discover stocks across different market segments"""
        all_discovered = []
        
        # Multiple screening strategies
        screening_strategies = [
            self._screen_high_volume_stocks,
            self._screen_mid_cap_stocks,
            self._screen_volatile_stocks,
            self._screen_momentum_stocks,
            self._screen_sector_leaders,
        ]
        
        for strategy in screening_strategies:
            try:
                stocks = strategy()
                all_discovered.extend(stocks)
                logger.info(f"📊 {strategy.__name__}: Found {len(stocks)} stocks")
            except Exception as e:
                logger.warning(f"⚠️ {strategy.__name__} failed: {e}")
        
        # Remove duplicates and validate
        unique_symbols = {}
        for stock in all_discovered:
            symbol = stock['symbol']
            if symbol not in unique_symbols:
                unique_symbols[symbol] = stock
        
        validated_stocks = self._validate_discovered_symbols(list(unique_symbols.values()))
        logger.info(f"🎯 Total discovered: {len(unique_symbols)}, Validated: {len(validated_stocks)}")
        
        return validated_stocks
    
    def _screen_high_volume_stocks(self) -> List[Dict]:
        """Screen for high volume stocks across all market caps"""
        try:
            query = (Query()
                    .select('name', 'close', 'volume', 'relative_volume_10d_calc', 'market_cap_basic')
                    .where(
                        col('market_cap_basic') > 10_000_000,      # Min 10M market cap (very low)
                        col('relative_volume_10d_calc') > 1.1,     # 10% above average volume
                        col('close') > 2,                          # Price > ₹2 (very low threshold)
                        col('volume') > 10000                      # Min volume (very low)
                    )
                    .order_by('volume', ascending=False)
                    .limit(200))
            
            results = query.get_scanner_data()
            return self._process_tradingview_results(results, 'high_volume')
            
        except Exception as e:
            logger.error(f"❌ High volume screening error: {e}")
            return []
    
    def _screen_mid_cap_stocks(self) -> List[Dict]:
        """Screen for mid-cap stocks with good liquidity"""
        try:
            query = (Query()
                    .select('name', 'close', 'volume', 'market_cap_basic', 'change')
                    .where(
                        col('market_cap_basic').between(1_000_000_000, 50_000_000_000),  # 1B to 50B
                        col('volume') > 50000,
                        col('close') > 5
                    )
                    .order_by('market_cap_basic', ascending=False)
                    .limit(150))
            
            results = query.get_scanner_data()
            return self._process_tradingview_results(results, 'mid_cap')
            
        except Exception as e:
            logger.error(f"❌ Mid-cap screening error: {e}")
            return []
    
    def _screen_volatile_stocks(self) -> List[Dict]:
        """Screen for volatile stocks with trading opportunities"""
        try:
            query = (Query()
                    .select('name', 'close', 'volume', 'Volatility.D', 'change')
                    .where(
                        col('Volatility.D') > 0.015,               # >1.5% daily volatility
                        col('volume') > 25000,
                        col('close') > 3,
                        col('market_cap_basic') > 50_000_000       # Min 50M
                    )
                    .order_by('Volatility.D', ascending=False)
                    .limit(150))
            
            results = query.get_scanner_data()
            return self._process_tradingview_results(results, 'volatile')
            
        except Exception as e:
            logger.error(f"❌ Volatile stocks screening error: {e}")
            return []
    
    def _screen_momentum_stocks(self) -> List[Dict]:
        """Screen for stocks with strong momentum"""
        try:
            query = (Query()
                    .select('name', 'close', 'volume', 'change', 'RSI')
                    .where(
                        col('change').between(-15, 15),            # Not extreme moves
                        col('RSI').between(25, 75),                # Not overbought/oversold
                        col('volume') > 20000,
                        col('close') > 4
                    )
                    .order_by('change', ascending=False)
                    .limit(100))
            
            results = query.get_scanner_data()
            return self._process_tradingview_results(results, 'momentum')
            
        except Exception as e:
            logger.error(f"❌ Momentum screening error: {e}")
            return []
    
    def _screen_sector_leaders(self) -> List[Dict]:
        """Screen for sector leaders and active stocks"""
        try:
            query = (Query()
                    .select('name', 'close', 'volume', 'market_cap_basic', 'relative_volume_10d_calc')
                    .where(
                        col('market_cap_basic') > 500_000_000,     # Min 500M market cap
                        col('relative_volume_10d_calc') > 0.8,     # At least 80% of average volume
                        col('close') > 10,
                        col('volume') > 100000
                    )
                    .order_by('market_cap_basic', ascending=False)
                    .limit(100))
            
            results = query.get_scanner_data()
            return self._process_tradingview_results(results, 'sector_leaders')
            
        except Exception as e:
            logger.error(f"❌ Sector leaders screening error: {e}")
            return []
    
    def _process_tradingview_results(self, results, category: str) -> List[Dict]:
        """Process TradingView results into standardized format"""
        processed_stocks = []
        
        try:
            if isinstance(results, tuple) and len(results) == 2:
                columns, data = results
                
                # Handle DataFrame in first position
                if hasattr(columns, 'iterrows'):
                    df = columns
                    for _, row in df.iterrows():
                        symbol = self._extract_nse_symbol(row.get('name', ''))
                        if symbol and symbol not in self.invalid_symbols:
                            processed_stocks.append({
                                'symbol': symbol,
                                'category': category,
                                'price': float(row.get('close', 0)),
                                'volume': int(row.get('volume', 0)),
                                'market_cap': float(row.get('market_cap_basic', 0))
                            })
                
                # Handle iterable data
                elif hasattr(data, '__iter__') and not isinstance(data, (str, bytes, int)):
                    try:
                        data_list = list(data)
                        for i, row in enumerate(data_list):
                            if hasattr(row, '__iter__') and not isinstance(row, (str, bytes)):
                                row_list = list(row)
                                if len(row_list) >= len(columns):
                                    stock_data = dict(zip(columns, row_list))
                                    symbol = self._extract_nse_symbol(stock_data.get('name', ''))
                                    if symbol and symbol not in self.invalid_symbols:
                                        processed_stocks.append({
                                            'symbol': symbol,
                                            'category': category,
                                            'price': float(stock_data.get('close', 0)),
                                            'volume': int(stock_data.get('volume', 0)),
                                            'market_cap': float(stock_data.get('market_cap_basic', 0))
                                        })
                    except Exception as e:
                        logger.debug(f"⚠️ Error processing data list: {e}")
            
        except Exception as e:
            logger.error(f"❌ Error processing TradingView results: {e}")
        
        return processed_stocks
    
    def _extract_nse_symbol(self, tv_symbol: str) -> Optional[str]:
        """Extract and clean NSE symbol from TradingView format"""
        if not tv_symbol or not isinstance(tv_symbol, str):
            return None
            
        # Clean symbol
        symbol = tv_symbol.replace('NSE:', '').replace('BSE:', '').strip().upper()
        
        # Basic validation
        if len(symbol) < 2 or len(symbol) > 20:
            return None
            
        # Check if alphanumeric (allowing - and &)
        if not symbol.replace('-', '').replace('&', '').isalnum():
            return None
            
        return symbol
    
    def _validate_discovered_symbols(self, stocks: List[Dict]) -> List[Dict]:
        """Validate discovered symbols with Upstox API"""
        validated_stocks = []
        
        # First, add all pre-validated symbols
        for symbol in VALIDATED_SYMBOLS:
            validated_stocks.append({
                'symbol': symbol,
                'category': 'pre_validated',
                'price': 0,
                'volume': 0,
                'market_cap': 0,
                'instrument_key': SYMBOL_INSTRUMENT_MAPPING[symbol]
            })
        
        # Then validate new discoveries
        new_symbols = set()
        for stock in stocks:
            symbol = stock['symbol']
            if symbol not in self.discovered_symbols and symbol not in self.invalid_symbols:
                new_symbols.add(symbol)
        
        logger.info(f"🔍 Validating {len(new_symbols)} new symbols...")
        
        # Load instruments if needed
        if new_symbols and not self.upstox_api.instruments:
            try:
                if not self.upstox_api.access_token:
                    self.upstox_api.authenticate()
                
                if hasattr(self.upstox_api, '_download_and_cache_instruments'):
                    self.upstox_api._download_and_cache_instruments()
            except Exception as e:
                logger.warning(f"⚠️ Could not load instruments for validation: {e}")
                return validated_stocks
        
        # Validate each new symbol
        for stock in stocks:
            symbol = stock['symbol']
            if symbol in new_symbols:
                instrument_key = self._find_instrument_key(symbol)
                if instrument_key:
                    stock['instrument_key'] = instrument_key
                    validated_stocks.append(stock)
                    self.discovered_symbols.add(symbol)
                    self.symbol_instrument_cache[symbol] = instrument_key
                    logger.debug(f"✅ Validated new symbol: {symbol}")
                else:
                    self.invalid_symbols.add(symbol)
                    logger.debug(f"❌ Invalid symbol: {symbol}")
        
        # Remove duplicates by symbol
        unique_validated = {}
        for stock in validated_stocks:
            symbol = stock['symbol']
            if symbol not in unique_validated:
                unique_validated[symbol] = stock
        
        return list(unique_validated.values())
    
    def _find_instrument_key(self, symbol: str) -> Optional[str]:
        """Find instrument key for a symbol"""
        # Check cache first
        if symbol in self.symbol_instrument_cache:
            return self.symbol_instrument_cache[symbol]
        
        # Search in Upstox instruments
        if self.upstox_api.instruments:
            for instrument in self.upstox_api.instruments:
                if (instrument.get('trading_symbol') == symbol and 
                    instrument.get('exchange') == 'NSE' and 
                    instrument.get('instrument_type') == 'EQ'):
                    return instrument.get('instrument_key', '')
        
        return None
    
    def get_expanded_stock_universe(self) -> List[Dict]:
        """Get the expanded stock universe with all discovered stocks"""
        logger.info("🚀 Starting enhanced stock discovery...")
        
        # Discover stocks from multiple sources
        discovered_stocks = self.discover_stocks_by_segments()
        
        logger.info(f"🎯 Final stock universe: {len(discovered_stocks)} symbols")
        logger.info(f"📊 Categories: {set(stock.get('category', 'unknown') for stock in discovered_stocks)}")
        
        return discovered_stocks

if __name__ == "__main__":
    # Test the discoverer
    discoverer = EnhancedStockDiscoverer()
    stocks = discoverer.get_expanded_stock_universe()
    
    print(f"\n🎯 DISCOVERED STOCK UNIVERSE")
    print(f"=" * 50)
    print(f"📊 Total symbols: {len(stocks)}")
    
    categories = {}
    for stock in stocks:
        cat = stock.get('category', 'unknown')
        categories[cat] = categories.get(cat, 0) + 1
    
    for category, count in categories.items():
        print(f"   {category}: {count} stocks")
    
    print(f"\n🔝 Sample symbols:")
    for stock in stocks[:10]:
        print(f"   {stock['symbol']} ({stock.get('category', 'unknown')})")
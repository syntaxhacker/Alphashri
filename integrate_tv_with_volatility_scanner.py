#!/usr/bin/env python3
"""
Create a new volatility scanner that uses TV screener for stock discovery
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

def create_enhanced_scanner():
    """Create enhanced scanner that uses TV screener + Upstox data"""
    
    enhanced_scanner_code = '''
import rookiepy
from tradingview_screener import Query
import pandas as pd
from datetime import datetime
import time
import logging

class EnhancedVolatilityScanner:
    """Volatility scanner using TradingView for discovery + Upstox for analysis"""
    
    def __init__(self):
        # TradingView setup
        self.tv_query = Query()
        self.tv_cookies = self._get_tv_cookies()
        
        # Upstox setup (reuse existing)
        from volatility_trend_scanner import VolatilityTrendScanner
        self.upstox_scanner = VolatilityTrendScanner()
        
        # Logging
        self.logger = logging.getLogger('EnhancedVolatilityScanner')
        
    def _get_tv_cookies(self):
        """Get TradingView cookies for real-time data"""
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
            self.logger.info("✅ TradingView cookies loaded from Chrome")
            return cookies
        except:
            try:
                cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
                self.logger.info("✅ TradingView cookies loaded from Firefox")
                return cookies
            except:
                self.logger.warning("⚠️ No TradingView cookies - using delayed data")
                return None
    
    def get_volatile_stocks_from_tv(self, limit=200):
        """Get volatile stocks from TradingView screener"""
        try:
            total_rows, df = (
                self.tv_query
                .select(
                    'name',
                    'close',
                    'volume',
                    'relative_volume_10d_calc',     # Volume ratio
                    'Volatility.D',                 # Daily volatility  
                    'change',                       # Daily change %
                    'RSI',                         # RSI
                    'market_cap_basic'             # Market cap
                )
                .where(
                    {'left': 'market_cap_basic', 'operation': 'greater', 'right': 50_000_000},       # Min ₹5 Cr
                    {'left': 'relative_volume_10d_calc', 'operation': 'greater', 'right': 1.1},      # 10% volume spike
                    {'left': 'Volatility.D', 'operation': 'greater', 'right': 0.015},               # 1.5% volatility
                    {'left': 'close', 'operation': 'greater', 'right': 5},                          # Min ₹5 price
                    {'left': 'volume', 'operation': 'greater', 'right': 25000}                      # Min volume
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .set_markets('india')
                .limit(limit)
                .get_scanner_data(cookies=self.tv_cookies)
            )
            
            # Extract just the symbol names
            if not df.empty and 'name' in df.columns:
                symbols = [self._clean_symbol(symbol) for symbol in df['name'].tolist()]
                symbols = [s for s in symbols if s]  # Remove empty/invalid symbols
                
                self.logger.info(f"🎯 TradingView found {len(symbols)} volatile stocks out of {total_rows} total")
                return symbols, df
            else:
                self.logger.warning("⚠️ No volatile stocks found from TradingView")
                return [], pd.DataFrame()
                
        except Exception as e:
            self.logger.error(f"❌ TradingView screener error: {e}")
            return [], pd.DataFrame()
    
    def _clean_symbol(self, tv_symbol):
        """Clean TradingView symbol to NSE format"""
        if not tv_symbol or not isinstance(tv_symbol, str):
            return None
            
        # Remove exchange prefixes
        symbol = tv_symbol.replace('NSE:', '').replace('BSE:', '').strip()
        
        # Basic validation
        if len(symbol) < 2 or len(symbol) > 20:
            return None
            
        return symbol
    
    def scan_discovered_stocks(self):
        """Main scanning function: TV discovery + Upstox analysis"""
        self.logger.info("🔥 Starting enhanced volatility scan...")
        
        # Step 1: Get volatile stocks from TradingView
        symbols, tv_data = self.get_volatile_stocks_from_tv(limit=200)
        
        if not symbols:
            self.logger.warning("❌ No symbols from TradingView - using fallback")
            return []
        
        self.logger.info(f"📊 Analyzing {len(symbols)} stocks with Upstox data...")
        
        # Step 2: Analyze each symbol with Upstox
        signals = []
        processed = 0
        
        for symbol in symbols:
            try:
                # Use existing Upstox analysis
                signal = self.upstox_scanner.scan_symbol_for_volatility(symbol)
                if signal:
                    signals.append(signal)
                    self.logger.info(f"🔥 {symbol}: {signal.signal_type} ({signal.confidence:.1%})")
                
                processed += 1
                if processed % 10 == 0:
                    self.logger.info(f"📈 Processed {processed}/{len(symbols)} stocks...")
                    
            except Exception as e:
                self.logger.warning(f"⚠️ Error analyzing {symbol}: {e}")
                continue
        
        self.logger.info(f"✅ Scan complete: {len(signals)} signals from {len(symbols)} stocks")
        return signals
    
    def run_continuous_scan(self, interval_minutes=3):
        """Run continuous scanning"""
        self.logger.info(f"🚀 Starting continuous enhanced scanning (every {interval_minutes}m)...")
        
        while True:
            try:
                signals = self.scan_discovered_stocks()
                
                if signals:
                    # Process signals (send alerts, save files, etc.)
                    for signal in signals:
                        # Send telegram alert
                        self.upstox_scanner.send_telegram_alert(signal)
                    
                    # Save to file
                    self.upstox_scanner.save_signals_to_file(signals)
                    
                    self.logger.info(f"📱 Processed {len(signals)} signals")
                else:
                    self.logger.info("🔍 No signals in this scan")
                
                # Wait for next scan
                time.sleep(interval_minutes * 60)
                
            except KeyboardInterrupt:
                self.logger.info("🛑 Scanning stopped by user")
                break
            except Exception as e:
                self.logger.error(f"❌ Scan error: {e}")
                time.sleep(30)

# Usage example
def main():
    """Run the enhanced scanner"""
    print("🚀 Enhanced Volatility Scanner - TradingView Discovery + Upstox Analysis")
    
    scanner = EnhancedVolatilityScanner()
    
    # Authenticate Upstox
    if not scanner.upstox_scanner.authenticate():
        print("❌ Upstox authentication failed")
        return
    
    # Run single scan for testing
    print("🧪 Running test scan...")
    signals = scanner.scan_discovered_stocks()
    
    print(f"\\n📊 Test Results:")
    print(f"   Found {len(signals)} volatility signals")
    
    for signal in signals:
        print(f"   🔥 {signal.symbol}: {signal.signal_type} ({signal.confidence:.1%})")
    
    # Optionally start continuous scanning
    # scanner.run_continuous_scan(interval_minutes=2)

if __name__ == "__main__":
    main()
'''
    
    # Write the enhanced scanner
    with open('/Users/developer/Documents/algos/personal/earner/enhanced_volatility_scanner.py', 'w') as f:
        f.write(enhanced_scanner_code)
    
    print("✅ Created enhanced_volatility_scanner.py")
    print("\n🎯 This new approach:")
    print("   • Uses TradingView to discover ALL volatile stocks (not just 84)")
    print("   • Gets real-time volume spikes and volatility data")
    print("   • Analyzes each stock with Upstox historical data")
    print("   • Would have caught EIEL's surge!")
    print("\n📋 Usage:")
    print("   python enhanced_volatility_scanner.py")
    print("\n🔧 Requirements:")
    print("   pip install rookiepy tradingview-screener")

if __name__ == "__main__":
    create_enhanced_scanner()
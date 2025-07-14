
import rookiepy
from tradingview_screener import Query
import pandas as pd
from datetime import datetime
import time
import logging

class EnhancedVolatilityScanner:
    """Volatility scanner using TradingView for discovery + Upstox for analysis"""
    
    def __init__(self):
        # Logging setup first
        logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        self.logger = logging.getLogger('EnhancedVolatilityScanner')
        
        # TradingView setup
        self.tv_query = Query()
        self.tv_cookies = self._get_tv_cookies()
        
        # Upstox setup (reuse existing)
        import sys
        import os
        sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))
        from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner
        self.upstox_scanner = VolatilityTrendScanner()
        
        # Symbol mapping cache to reduce API calls
        self.symbol_cache = {}
        self.instruments_loaded = False
        self.all_instruments = []
        
    def _get_tv_cookies(self):
        """Get TradingView cookies for real-time data"""
        try:
            cookies = rookiepy.to_cookiejar(rookiepy.chrome(['.tradingview.com']))
            print("✅ TradingView cookies loaded from Chrome")
            return cookies
        except:
            try:
                cookies = rookiepy.to_cookiejar(rookiepy.firefox(['.tradingview.com']))
                print("✅ TradingView cookies loaded from Firefox")
                return cookies
            except:
                print("⚠️ No TradingView cookies - using delayed data (this is fine)")
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
    
    def _load_instruments_once(self):
        """Load instruments once and cache them"""
        if self.instruments_loaded:
            return
            
        try:
            if hasattr(self.upstox_scanner, 'api') and hasattr(self.upstox_scanner.api, '_download_and_cache_instruments'):
                self.logger.info("📥 Loading instruments from Upstox...")
                self.upstox_scanner.api._download_and_cache_instruments()
                if hasattr(self.upstox_scanner.api, 'instruments'):
                    self.all_instruments = self.upstox_scanner.api.instruments
                    self.instruments_loaded = True
                    self.logger.info(f"✅ Loaded {len(self.all_instruments)} instruments")
                else:
                    self.logger.warning("⚠️ No instruments attribute found")
            else:
                self.logger.warning("⚠️ No instrument loading method available")
        except Exception as e:
            self.logger.error(f"❌ Error loading instruments: {e}")
    
    def find_instrument_key_with_fallback(self, symbol):
        """Find instrument key using simplified fallback to hardcoded mapping"""
        # Check cache first
        if symbol in self.symbol_cache:
            return self.symbol_cache[symbol]
        
        # Use a simplified hardcoded mapping for known stocks
        # This is much faster than loading full instrument list
        known_mappings = {
            'EIEL': 'NSE_EQ|INE0LLY01014',
            'RELIGARE': 'NSE_EQ|INE021K01021',
            'SOLARA': 'NSE_EQ|INE624Z01016',
            'SIGNPOST': 'NSE_EQ|INE0JW401017',
            'KSB': 'NSE_EQ|INE999A01015',
            'VASWANI': 'NSE_EQ|INE590A01039',
            'TCS': 'NSE_EQ|INE467B01029',
            'RELIANCE': 'NSE_EQ|INE002A01018',
            'INFY': 'NSE_EQ|INE009A01021',
            'HINDUNILVR': 'NSE_EQ|INE030A01027',
            'TATAMOTORS': 'NSE_EQ|INE155A01022',
            'DRREDDY': 'NSE_EQ|INE089A01023',
            'TATAELXSI': 'NSE_EQ|INE670A01012',
            'GLENMARK': 'NSE_EQ|INE935A01035',
            'WOCKPHARMA': 'NSE_EQ|INE049B01025',
            'AKUMS': 'NSE_EQ|INE0K1701015',
            'PEL': 'NSE_EQ|INE140A01024',
            'IREDA': 'NSE_EQ|INE202E01016',
            'PTC': 'NSE_EQ|INE877F01012',
            'RAMCOCEM': 'NSE_EQ|INE331A01037',
        }
        
        # Check known mappings first
        if symbol in known_mappings:
            instrument_key = known_mappings[symbol]
            self.symbol_cache[symbol] = instrument_key
            return instrument_key
        
        # For unknown symbols, skip to avoid delays
        self.logger.debug(f"⏭️ Skipping {symbol} - not in known mappings")
        self.symbol_cache[symbol] = None
        return None
    
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
                # First check if we can find the instrument key
                instrument_key = self.find_instrument_key_with_fallback(symbol)
                
                if instrument_key:
                    # Use existing Upstox analysis with verified instrument key
                    signal = self.upstox_scanner.scan_symbol_for_volatility(symbol)
                    if signal:
                        signals.append(signal)
                        self.logger.info(f"🔥 {symbol}: {signal.signal_type} ({signal.confidence:.1%})")
                else:
                    self.logger.debug(f"⏭️ Skipping {symbol} - no instrument key available")
                
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
    
    print(f"\n📊 Test Results:")
    print(f"   Found {len(signals)} volatility signals")
    print(f"   Symbol cache entries: {len(scanner.symbol_cache)}")
    print(f"   Successfully mapped: {sum(1 for v in scanner.symbol_cache.values() if v is not None)}")
    print(f"   Failed mappings: {sum(1 for v in scanner.symbol_cache.values() if v is None)}")
    
    for signal in signals:
        print(f"   🔥 {signal.symbol}: {signal.signal_type} ({signal.confidence:.1%})")
    
    # Optionally start continuous scanning
    # scanner.run_continuous_scan(interval_minutes=2)

if __name__ == "__main__":
    main()

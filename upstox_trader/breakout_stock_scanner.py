#!/usr/bin/env python3
"""
INTELLIGENT BREAKOUT STOCK SCANNER FOR UPSTOX
==============================================

STRATEGIC DECISION FRAMEWORK:
============================

1. DATA SOURCE ARCHITECTURE:
   - PRIMARY: Upstox API for Indian markets (NSE/BSE) - Real-time & Historical data
   - SECONDARY: TradingView unofficial API for global screening patterns
   - ADVANTAGE: Direct broker integration ensures trade execution compatibility
   - COST: No additional subscription needed beyond Upstox account

2. STOCK UNIVERSE SELECTION:
   - START: Nifty 50 (50 stocks) - High liquidity, stable for algorithm testing
   - EXPAND: Nifty 500 (500 stocks) - Broader opportunities, 96% market coverage
   - RATIONALE: Nifty 50 provides 11-12% annual returns with 15-18% volatility
   - ADVANTAGE: Nifty 500 outperforms in bull markets (+31% vs +24% in 2021)

3. BREAKOUT DETECTION METHODOLOGY:
   - VOLUME CONFIRMATION: 50-200% above average volume during breakout
   - PRICE PATTERNS: Support/Resistance level breaks with momentum
   - TECHNICAL FILTERS: RSI > 50, MACD bullish crossover, EMA alignment
   - TIMEFRAMES: Multiple timeframe confirmation (15min, 1H, 4H, Daily)

4. OPTIMIZATION STRATEGY:
   - SCAN FREQUENCY: Every 5 minutes during market hours (9:15 AM - 3:30 PM)
   - API EFFICIENCY: Batch requests, local caching, rate limit compliance
   - PERFORMANCE: Target <30 seconds full universe scan
   - ALERTING: Telegram integration for instant breakout notifications

5. RISK MANAGEMENT:
   - MINIMUM PRICE: ₹10+ (avoid penny stocks manipulation)
   - MAXIMUM PRICE: ₹5000 (ensure sufficient retail participation)
   - VOLUME FILTER: Minimum 50,000 shares traded in last session
   - SECTOR DIVERSIFICATION: Maximum 3 stocks per sector

IMPLEMENTATION APPROACH:
=======================
Phase 1: Nifty 50 scanner with basic breakout patterns
Phase 2: Advanced technical indicators and multi-timeframe analysis  
Phase 3: Machine learning sentiment and momentum scoring
Phase 4: Expand to Nifty 500 with sector rotation analysis

This scanner prioritizes RELIABILITY over complexity, focusing on
high-probability setups that align with paper trading bot strategy.
"""

import time
import json
import numpy as np
import pandas as pd
import threading
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import logging
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

# Local imports
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG, TELEGRAM_CONFIG

# Optional imports for enhanced functionality
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("⚠️ requests library not available - Telegram alerts disabled")

try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
    print("⚠️ upstox-python-sdk not available - Real-time streaming disabled")

# Enhanced logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('breakout_scanner.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('BreakoutScanner')

@dataclass
class BreakoutSignal:
    """Data class for breakout signals"""
    symbol: str
    price: float
    volume: int
    volume_ratio: float  # Current volume / Average volume
    pattern: str  # Type of breakout pattern detected
    confidence: float  # Signal confidence (0-1)
    timeframe: str
    resistance_level: float
    support_level: float
    rsi: float
    timestamp: datetime
    sector: str = ""
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        return {
            'symbol': self.symbol,
            'price': self.price,
            'volume': self.volume,
            'volume_ratio': self.volume_ratio,
            'pattern': self.pattern,
            'confidence': self.confidence,
            'timeframe': self.timeframe,
            'resistance_level': self.resistance_level,
            'support_level': self.support_level,
            'rsi': self.rsi,
            'timestamp': self.timestamp.isoformat(),
            'sector': self.sector
        }

class TechnicalAnalyzer:
    """Technical analysis helper for breakout detection"""
    
    @staticmethod
    def calculate_rsi(prices: List[float], period: int = 14) -> float:
        """Calculate RSI (Relative Strength Index)"""
        if len(prices) < period + 1:
            return 50.0  # Neutral RSI if insufficient data
            
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = np.mean(gains[:period])
        avg_loss = np.mean(losses[:period])
        
        if avg_loss == 0:
            return 100.0
            
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    @staticmethod
    def find_support_resistance(highs: List[float], lows: List[float], 
                               lookback: int = 20) -> Tuple[float, float]:
        """Find nearest support and resistance levels"""
        if len(highs) < lookback or len(lows) < lookback:
            return 0.0, 0.0
            
        recent_highs = highs[-lookback:]
        recent_lows = lows[-lookback:]
        
        # Find pivot highs and lows
        resistance_levels = []
        support_levels = []
        
        for i in range(2, len(recent_highs) - 2):
            if (recent_highs[i] > recent_highs[i-1] and 
                recent_highs[i] > recent_highs[i-2] and
                recent_highs[i] > recent_highs[i+1] and 
                recent_highs[i] > recent_highs[i+2]):
                resistance_levels.append(recent_highs[i])
                
        for i in range(2, len(recent_lows) - 2):
            if (recent_lows[i] < recent_lows[i-1] and 
                recent_lows[i] < recent_lows[i-2] and
                recent_lows[i] < recent_lows[i+1] and 
                recent_lows[i] < recent_lows[i+2]):
                support_levels.append(recent_lows[i])
        
        # Get nearest levels
        current_price = highs[-1]  # Use latest high as proxy for current price
        
        resistance = min([r for r in resistance_levels if r > current_price], 
                        default=max(recent_highs))
        support = max([s for s in support_levels if s < current_price], 
                     default=min(recent_lows))
        
        return support, resistance
    
    @staticmethod
    def detect_breakout_pattern(candles: List[Dict], volume_threshold: float = 1.5) -> Tuple[str, float]:
        """Detect breakout patterns and return pattern type with confidence"""
        if len(candles) < 20:
            return "insufficient_data", 0.0
            
        # Extract OHLCV data
        closes = [c['close'] for c in candles]
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]
        volumes = [c['volume'] for c in candles]
        
        current_price = closes[-1]
        current_volume = volumes[-1]
        avg_volume = np.mean(volumes[-20:])  # 20-period average volume
        
        # Volume confirmation
        volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1.0
        
        # Find support/resistance levels
        support, resistance = TechnicalAnalyzer.find_support_resistance(highs, lows)
        
        # Calculate distance from levels
        resistance_distance = ((current_price - resistance) / resistance) * 100 if resistance > 0 else 0
        support_distance = ((support - current_price) / current_price) * 100 if support > 0 else 0
        
        # RSI calculation
        rsi = TechnicalAnalyzer.calculate_rsi(closes)
        
        # Pattern detection logic
        confidence = 0.0
        pattern = "no_pattern"
        
        # Resistance breakout detection
        if (resistance_distance > -0.5 and resistance_distance < 2.0 and  # Near resistance
            volume_ratio >= volume_threshold and  # High volume
            rsi > 50 and rsi < 80):  # RSI in bullish zone but not overbought
            
            pattern = "resistance_breakout"
            confidence = min(0.9, 0.3 + (volume_ratio - 1.0) * 0.2 + 
                           (rsi - 50) / 100 + 
                           (2.0 - abs(resistance_distance)) / 10)
        
        # Support bounce detection  
        elif (support_distance > -2.0 and support_distance < 0.5 and  # Near support
              volume_ratio >= volume_threshold and  # High volume
              rsi > 30 and rsi < 70):  # RSI not oversold
            
            pattern = "support_bounce"
            confidence = min(0.9, 0.3 + (volume_ratio - 1.0) * 0.2 + 
                           (70 - rsi) / 100 + 
                           (2.0 - abs(support_distance)) / 10)
        
        # Momentum breakout (price moving with volume but no clear S/R)
        elif volume_ratio >= 2.0 and rsi > 60:
            pattern = "momentum_breakout"
            confidence = min(0.8, 0.2 + (volume_ratio - 1.0) * 0.15 + (rsi - 50) / 100)
        
        return pattern, confidence

class BreakoutScanner:
    """Main breakout scanning engine for Upstox"""
    
    def __init__(self):
        # API Setup
        self.upstox_client = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'],
            api_secret=UPSTOX_CONFIG['api_secret']
        )
        
        # Stock universes
        self.nifty_50_symbols = [
            'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 
            'ITC', 'SBIN', 'BHARTIARTL', 'ASIANPAINT', 'MARUTI', 'KOTAKBANK',
            'LT', 'AXISBANK', 'TITAN', 'NESTLEIND', 'ULTRACEMCO', 'WIPRO',
            'HCLTECH', 'BAJFINANCE', 'POWERGRID', 'NTPC', 'ONGC', 'TATAMOTORS',
            'TATASTEEL', 'SUNPHARMA', 'JSWSTEEL', 'INDUSINDBK', 'TECHM',
            'HINDALCO', 'COALINDIA', 'GRASIM', 'BAJAJFINSV', 'EICHERMOT',
            'HEROMOTOCO', 'DRREDDY', 'CIPLA', 'BRITANNIA', 'DIVISLAB',
            'SHREECEM', 'APOLLOHOSP', 'BAJAJ-AUTO', 'ADANIPORTS', 'TATACONSUM',
            'UPL', 'SBILIFE', 'HDFCLIFE', 'LTIM', 'ADANIENT', 'BPCL'
        ]
        
        # Configuration
        self.scan_frequency = 300  # 5 minutes
        self.min_volume = 50000
        self.min_price = 10.0
        self.max_price = 5000.0
        self.min_confidence = 0.6
        
        # Data storage
        self.breakout_signals: List[BreakoutSignal] = []
        self.cache = {}
        self.cache_timeout = 300  # 5 minutes
        
        # Signal deduplication - prevent duplicate alerts
        self.sent_signals = set()  # Track sent signals by symbol+pattern+timeframe
        self.signal_cooldown = 3600  # 1 hour cooldown per symbol+pattern
        self.last_signal_times = {}  # Track when each signal was last sent
        
        # Threading
        self.running = False
        self.scanner_thread = None
        
        # Telegram integration
        self.telegram_enabled = REQUESTS_AVAILABLE and TELEGRAM_CONFIG.get('bot_token')
        
    def authenticate(self) -> bool:
        """Authenticate with Upstox API"""
        try:
            if not self.upstox_client.access_token:
                logger.info("🔑 Authenticating with Upstox API...")
                if self.upstox_client.authenticate():
                    logger.info("✅ Upstox API authentication successful")
                    return True
                else:
                    logger.error("❌ Upstox API authentication failed")
                    return False
            return True
        except Exception as e:
            logger.error(f"❌ Authentication error: {str(e)}")
            return False
    
    def get_market_data(self, symbol: str, timeframe: str = "15min") -> Optional[List[Dict]]:
        """Fetch market data for a symbol with caching"""
        cache_key = f"{symbol}_{timeframe}"
        current_time = time.time()
        
        # Check cache
        if (cache_key in self.cache and 
            current_time - self.cache[cache_key]['timestamp'] < self.cache_timeout):
            return self.cache[cache_key]['data']
        
        try:
            # Fetch data from Upstox
            to_date = datetime.now().strftime("%Y-%m-%d")
            from_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
            
            df = self.upstox_client.fetch_historical_data(
                symbol=symbol,
                interval='1minute',  # Always fetch minute data for resampling
                from_date=from_date,
                to_date=to_date
            )
            
            if df is None or df.empty:
                logger.warning(f"⚠️ No data received for {symbol}")
                return None
            
            # Resample to target timeframe
            ohlc_dict = {
                'open': 'first',
                'high': 'max', 
                'low': 'min',
                'close': 'last',
                'volume': 'sum'
            }
            df_resampled = df.resample(timeframe).apply(ohlc_dict)
            df_resampled.dropna(subset=['open'], inplace=True)
            
            # Convert to list of dicts
            candles = [
                {
                    'timestamp': int(row.name.timestamp() * 1000),
                    'open': row['open'],
                    'high': row['high'],
                    'low': row['low'],
                    'close': row['close'],
                    'volume': row['volume']
                } for _, row in df_resampled.iterrows()
            ]
            
            # Cache the result
            self.cache[cache_key] = {
                'data': candles,
                'timestamp': current_time
            }
            
            return candles
            
        except Exception as e:
            logger.error(f"❌ Error fetching data for {symbol}: {str(e)}")
            return None
    
    def scan_symbol(self, symbol: str) -> Optional[BreakoutSignal]:
        """Scan a single symbol for breakout patterns"""
        try:
            # Get market data
            candles = self.get_market_data(symbol, "15min")
            if not candles or len(candles) < 20:
                return None
            
            # Current price and volume checks
            current_candle = candles[-1]
            current_price = current_candle['close']
            current_volume = current_candle['volume']
            
            # Basic filters
            if (current_price < self.min_price or 
                current_price > self.max_price or
                current_volume < self.min_volume):
                return None
            
            # Technical analysis
            pattern, confidence = TechnicalAnalyzer.detect_breakout_pattern(candles)
            
            if confidence < self.min_confidence:
                return None
            
            # Calculate additional metrics
            closes = [c['close'] for c in candles]
            highs = [c['high'] for c in candles]
            lows = [c['low'] for c in candles]
            volumes = [c['volume'] for c in candles]
            
            support, resistance = TechnicalAnalyzer.find_support_resistance(highs, lows)
            rsi = TechnicalAnalyzer.calculate_rsi(closes)
            avg_volume = np.mean(volumes[-20:])
            volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1.0
            
            # Create breakout signal
            signal = BreakoutSignal(
                symbol=symbol,
                price=current_price,
                volume=current_volume,
                volume_ratio=volume_ratio,
                pattern=pattern,
                confidence=confidence,
                timeframe="15min",
                resistance_level=resistance,
                support_level=support,
                rsi=rsi,
                timestamp=datetime.now()
            )
            
            logger.info(f"🎯 BREAKOUT DETECTED: {symbol} | {pattern} | Confidence: {confidence:.1%}")
            return signal
            
        except Exception as e:
            logger.error(f"❌ Error scanning {symbol}: {str(e)}")
            return None
    
    def scan_universe(self, symbols: List[str]) -> List[BreakoutSignal]:
        """Scan multiple symbols concurrently"""
        signals = []
        
        logger.info(f"🔍 Scanning {len(symbols)} symbols for breakouts...")
        start_time = time.time()
        
        # Use ThreadPoolExecutor for concurrent scanning
        with ThreadPoolExecutor(max_workers=5) as executor:
            # Submit all scanning tasks
            future_to_symbol = {
                executor.submit(self.scan_symbol, symbol): symbol 
                for symbol in symbols
            }
            
            # Collect results
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                try:
                    signal = future.result(timeout=30)  # 30 second timeout per symbol
                    if signal:
                        signals.append(signal)
                        logger.info(f"✅ {symbol}: {signal.pattern} (confidence: {signal.confidence:.1%})")
                except Exception as e:
                    logger.warning(f"⚠️ {symbol}: Scan failed - {str(e)}")
        
        scan_time = time.time() - start_time
        logger.info(f"🏁 Scan completed in {scan_time:.1f}s | Found {len(signals)} breakout signals")
        
        return signals
    
    def should_send_alert(self, signal: BreakoutSignal) -> bool:
        """Check if we should send an alert for this signal (deduplication)"""
        # Create unique key for this signal
        signal_key = f"{signal.symbol}_{signal.pattern}_{signal.timeframe}"
        current_time = time.time()
        
        # Clean up old signal times periodically (prevent memory buildup)
        if len(self.last_signal_times) > 100:  # Clean up every 100 signals
            cutoff_time = current_time - (self.signal_cooldown * 2)  # Keep 2x cooldown period
            self.last_signal_times = {
                k: v for k, v in self.last_signal_times.items() 
                if v > cutoff_time
            }
        
        # Check if we've sent this signal recently
        if signal_key in self.last_signal_times:
            time_since_last = current_time - self.last_signal_times[signal_key]
            if time_since_last < self.signal_cooldown:
                remaining_cooldown = self.signal_cooldown - time_since_last
                logger.info(f"🔇 Skipping duplicate alert for {signal.symbol} ({signal.pattern}) - cooldown: {remaining_cooldown/60:.1f}m remaining")
                return False
        
        # Update last signal time
        self.last_signal_times[signal_key] = current_time
        return True
    
    def send_telegram_alert(self, signal: BreakoutSignal) -> bool:
        """Send breakout alert via Telegram with deduplication"""
        if not self.telegram_enabled:
            return False
            
        # Check if we should send this alert
        if not self.should_send_alert(signal):
            return False
            
        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']
            
            message = f"""
🚨 *BREAKOUT ALERT* 🚨

📈 *Symbol:* {signal.symbol}
💰 *Price:* ₹{signal.price:,.2f}
📊 *Pattern:* {signal.pattern.replace('_', ' ').title()}
🎯 *Confidence:* {signal.confidence:.1%}
📈 *RSI:* {signal.rsi:.1f}
📊 *Volume Ratio:* {signal.volume_ratio:.1f}x
🛡️ *Support:* ₹{signal.support_level:,.2f}
🔴 *Resistance:* ₹{signal.resistance_level:,.2f}
⏰ *Time:* {signal.timestamp.strftime('%H:%M:%S')}

#Breakout #Trading #NSE
            """
            
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'Markdown'
            }
            
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                logger.info(f"📱 Telegram alert sent for {signal.symbol} ({signal.pattern})")
                return True
            else:
                logger.warning(f"⚠️ Telegram alert failed: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Telegram alert error: {str(e)}")
            return False
    
    def save_signals_to_file(self, signals: List[BreakoutSignal]):
        """Save breakout signals to JSON file"""
        try:
            filename = f"breakout_signals_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(os.path.dirname(__file__), filename)
            
            signals_data = [signal.to_dict() for signal in signals]
            
            with open(filepath, 'w') as f:
                json.dump(signals_data, f, indent=2)
                
            logger.info(f"💾 Saved {len(signals)} signals to {filename}")
            
        except Exception as e:
            logger.error(f"❌ Error saving signals: {str(e)}")
    
    def run_continuous_scan(self):
        """Run continuous scanning loop"""
        logger.info("🚀 Starting continuous breakout scanning...")
        
        while self.running:
            try:
                # Scan the Nifty 50 universe
                signals = self.scan_universe(self.nifty_50_symbols)
                
                # Process signals
                if signals:
                    self.breakout_signals.extend(signals)
                    
                    # Send alerts for new signals (with deduplication)
                    new_alerts_sent = 0
                    for signal in signals:
                        if self.send_telegram_alert(signal):  # Returns True if sent
                            new_alerts_sent += 1
                    
                    # Save to file
                    self.save_signals_to_file(signals)
                    
                    # Log alert summary
                    if new_alerts_sent > 0:
                        logger.info(f"📱 Sent {new_alerts_sent} new Telegram alerts (filtered {len(signals) - new_alerts_sent} duplicates)")
                    else:
                        logger.info("🔇 No new alerts sent - all signals were duplicates")
                    
                    # Print summary
                    print(f"\n{'='*60}")
                    print(f"🎯 BREAKOUT SCAN SUMMARY - {datetime.now().strftime('%H:%M:%S')}")
                    print(f"{'='*60}")
                    for signal in signals:
                        print(f"📈 {signal.symbol:12s} | {signal.pattern:20s} | {signal.confidence:5.1%} | ₹{signal.price:8.2f}")
                    print(f"{'='*60}\n")
                else:
                    logger.info("🔍 No breakout signals found in this scan")
                
                # Wait for next scan
                if self.running:
                    logger.info(f"⏰ Next scan in {self.scan_frequency} seconds...")
                    time.sleep(self.scan_frequency)
                    
            except KeyboardInterrupt:
                logger.info("🛑 Scanning interrupted by user")
                break
            except Exception as e:
                logger.error(f"❌ Scanning error: {str(e)}")
                time.sleep(30)  # Wait 30 seconds before retrying
        
        logger.info("🏁 Continuous scanning stopped")
    
    def start_scanning(self):
        """Start the breakout scanner"""
        if self.running:
            logger.warning("⚠️ Scanner is already running")
            return
        
        # Authenticate first
        if not self.authenticate():
            logger.error("❌ Cannot start scanner - authentication failed")
            return
        
        # Start scanning in a separate thread
        self.running = True
        self.scanner_thread = threading.Thread(target=self.run_continuous_scan, daemon=True)
        self.scanner_thread.start()
        
        logger.info("✅ Breakout scanner started successfully")
    
    def stop_scanning(self):
        """Stop the breakout scanner"""
        if not self.running:
            logger.warning("⚠️ Scanner is not running")
            return
        
        self.running = False
        if self.scanner_thread:
            self.scanner_thread.join(timeout=10)
        
        logger.info("🛑 Breakout scanner stopped")
    
    def get_recent_signals(self, hours: int = 24) -> List[BreakoutSignal]:
        """Get breakout signals from the last N hours"""
        cutoff_time = datetime.now() - timedelta(hours=hours)
        recent_signals = [
            signal for signal in self.breakout_signals 
            if signal.timestamp >= cutoff_time
        ]
        return recent_signals

def main():
    """Main function to run the breakout scanner"""
    print(f"""
🚀 INTELLIGENT BREAKOUT STOCK SCANNER
====================================
🎯 Universe: Nifty 50 (50 stocks)
⏰ Frequency: Every 5 minutes
📊 Patterns: Resistance breakouts, Support bounces, Momentum breakouts
🔔 Alerts: Telegram notifications
📈 Confidence: Minimum 60%

Starting scanner...
    """)
    
    scanner = BreakoutScanner()
    
    try:
        scanner.start_scanning()
        
        # Keep the main thread alive
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Stopping scanner...")
        scanner.stop_scanning()
        print("👋 Scanner stopped. Goodbye!")

if __name__ == "__main__":
    main()
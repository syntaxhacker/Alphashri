#!/usr/bin/env python3
"""
Paper Trading Support & Resistance Bot for Upstox - 15min Timeframe
- Cloned from upstox_support_resistance_bot.py
- Simulates trades locally without placing real orders.
- Logs all simulated trades to upstox_paper_trades.log for analysis.
- Enhanced with REAL-TIME WebSocket data streaming
"""

import time
import numpy as np
import pandas as pd
import threading
from datetime import datetime, timedelta
import os
import logging
import re
import argparse
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

# Add Upstox Official SDK for WebSocket
try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
    print("✅ Official Upstox SDK available for real-time data")
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
    print("⚠️  Official Upstox SDK not found. Install with: pip install upstox-python-sdk")
    print("📉 Will use historical data only (expect 0% P&L updates)")

# ANSI Color codes for terminal
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    RESET = '\033[0m'
    BG_RED = '\033[101m'
    BG_GREEN = '\033[102m'
    BG_YELLOW = '\033[103m'

# --- Main Bot Logger (Console) ---
console_log_formatter = logging.Formatter('%(message)s')
console_logger = logging.getLogger('upstox_console_logger')
console_logger.setLevel(logging.INFO)

# --- Paper Trade Logger (File) ---
paper_trade_logger = logging.getLogger('upstox_paper_trade_logger')
paper_trade_logger.setLevel(logging.INFO)


def strip_ansi_codes(text):
    """Removes ANSI color codes from a string."""
    return re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)

class UpstoxPaperTradingBot:
    """Paper Trading Support & Resistance Bot for Upstox with REAL-TIME WebSocket data"""
    
    def __init__(self, api_key, api_secret, symbol="TATAMOTORS", timeframe="15min"):
        # API Setup
        self.client = UpstoxAPI(api_key=api_key, api_secret=api_secret)
        self.trading_symbol = symbol
        self.timeframe = timeframe
        
        # REAL-TIME WebSocket Setup
        self.websocket_enabled = UPSTOX_SDK_AVAILABLE
        self.market_streamer = None
        self.instrument_key = None
        self.real_time_price = 0.0
        self.price_update_count = 0
        self.last_websocket_update = 0
        
        # Smart Logging - Track Previous Values
        self.last_logged_price = 0.0
        self.last_logged_pnl_percent = None
        self.last_logged_update_count = 0
        
        # SUPPORT/RESISTANCE SETTINGS
        self.lookback_periods = 50
        self.min_touches = 2
        self.level_threshold = 0.5  # % threshold for level identification
        self.bounce_threshold = 0.25  # % threshold for bounce confirmation
        
        # POSITION TRACKING
        self.position = None  # Dict: {'side': 'BUY'/'SELL', 'qty': int, 'entry_price': float, 'timestamp': datetime}
        self.current_price = 0
        self.candle_data = []
        
        # STRATEGY CACHE 
        self.support_levels = []
        self.resistance_levels = []
        self.ema_period = 20
        self.last_candle_time = 0
        self.last_level_update = 0
        self.trend_direction = "NEUTRAL"
        self.trend_ema = 0.0
        
        # TRADING METRICS
        self.trade_count = 0
        self.total_pnl = 0.0
        self.last_profit_check = time.time()
        
        # RISK MANAGEMENT
        self.risk_reward_ratio = 2.5
        self.max_risk_pct = 1.5
        
        # TRADING THRESHOLDS
        self.min_confidence_threshold = 0.7  # Only trade signals with 70%+ confidence
        self.signal_check_interval = 30  # Check for signals every 30 seconds max
        self.observation_period = 60  # 1 minute observation before trading
        
        # SIGNAL DEDUPLICATION
        self.last_signal_time = {}
        self.signal_cooldown = 1200
        
        # RUNTIME
        self.running = False

    def log_colored(self, message, level="info"):
        """Enhanced colored logging for console output."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_message = f"[{timestamp}] {message}"
        
        if level == "error":
            print(f"{Colors.RED}{log_message}{Colors.RESET}")
        elif level == "success":
            print(f"{Colors.GREEN}{log_message}{Colors.RESET}")
        elif level == "warning":
            print(f"{Colors.YELLOW}{log_message}{Colors.RESET}")
        elif level == "trade":
            print(f"{Colors.CYAN}{log_message}{Colors.RESET}")
        elif level == "profit":
            print(f"{Colors.BG_GREEN}{Colors.BOLD}{log_message}{Colors.RESET}")
        elif level == "loss":
            print(f"{Colors.BG_RED}{Colors.BOLD}{log_message}{Colors.RESET}")
        elif level == "level":
            print(f"{Colors.MAGENTA}{log_message}{Colors.RESET}")
        else:
            print(f"{Colors.WHITE}{log_message}{Colors.RESET}")

    def get_candles(self):
        """Fetch and resample data to the target timeframe."""
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
        
        # Determine the best base interval to fetch from Upstox
        timeframe_td = pd.to_timedelta(self.timeframe)
        if timeframe_td < pd.to_timedelta('30min'):
            base_interval = '1minute'
        else:
            base_interval = '30minute'

        df = self.client.fetch_historical_data(
            symbol=self.trading_symbol,
            interval=base_interval,
            from_date=from_date,
            to_date=to_date
        )
        
        if df is None or df.empty:
            self.log_colored(f"⚠️  Could not fetch {base_interval} candle data for {self.trading_symbol}", "warning")
            return False

        # Resample to the target timeframe
        ohlc_dict = {
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }
        df_resampled = df.resample(self.timeframe).apply(ohlc_dict)
        df_resampled.dropna(subset=['open'], inplace=True)

        self.candle_data = [
            {
                'timestamp': int(row.name.timestamp() * 1000),
                'open': row['open'],
                'high': row['high'],
                'low': row['low'],
                'close': row['close'],
                'volume': row['volume']
            } for _, row in df_resampled.iterrows()
        ]
        self.current_price = self.candle_data[-1]['close'] if self.candle_data else 0
        self.log_colored(f"✅ Successfully prepared {len(self.candle_data)} {self.timeframe} candles for {self.trading_symbol}", "success")
        return True

    def setup_websocket_streaming(self):
        """Initialize real-time WebSocket streaming for market data"""
        if not self.websocket_enabled:
            self.log_colored("❌ WebSocket not available - install upstox-python-sdk", "error")
            return False
            
        try:
            # Get access token from our existing client
            if not self.client.access_token:
                self.log_colored("🔑 Authenticating for WebSocket access...", "info")
                if not self.client.authenticate():
                    self.log_colored("❌ Authentication failed for WebSocket", "error")
                    return False
            
            # Setup Upstox SDK configuration
            configuration = upstox_client.Configuration()
            configuration.access_token = self.client.access_token
            
            # Get instrument key for the symbol
            self.instrument_key = self.get_instrument_key_for_symbol()
            if not self.instrument_key:
                self.log_colored(f"❌ Could not find instrument key for {self.trading_symbol}", "error")
                return False
            
            # Initialize Market Data Streamer
            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client, 
                [self.instrument_key], 
                "ltpc"  # Last Traded Price mode for fastest updates
            )
            
            # Set up event handlers
            self.market_streamer.on("message", self.on_market_message)
            self.market_streamer.on("open", self.on_websocket_open)
            self.market_streamer.on("error", self.on_websocket_error)
            self.market_streamer.on("close", self.on_websocket_close)
            
            self.log_colored("✅ WebSocket streaming setup complete", "success")
            return True
            
        except Exception as e:
            self.log_colored(f"❌ WebSocket setup failed: {str(e)}", "error")
            return False

    def get_instrument_key_for_symbol(self):
        """Get the proper instrument key for WebSocket subscription"""
        try:
            # Try to load instruments if not already loaded
            if not self.client.instruments:
                try:
                    self.client._download_and_cache_instruments()
                except AttributeError:
                    # Method doesn't exist in current API class
                    pass
            
            # Find the instrument key for our symbol
            if self.client.instruments:
                for instrument in self.client.instruments:
                    if (instrument.get('tradingsymbol') == self.trading_symbol and 
                        instrument.get('exchange') == 'NSE' and 
                        instrument.get('instrument_type') == 'EQ'):
                        
                        instrument_key = f"NSE_EQ|{instrument.get('instrument_token')}"
                        self.log_colored(f"🔑 Found instrument key: {instrument_key}", "info")
                        return instrument_key
            
            # Fallback: use known instrument keys for common symbols
            known_symbols = {
                # Nifty 50 stocks
                'TATAMOTORS': 'NSE_EQ|INE155A01022',
                'RELIANCE': 'NSE_EQ|INE002A01018', 
                'INFY': 'NSE_EQ|INE009A01021',
                'TCS': 'NSE_EQ|INE467B01029',
                'HDFCBANK': 'NSE_EQ|INE040A01034',
                'ICICIBANK': 'NSE_EQ|INE090A01013',
                'SBIN': 'NSE_EQ|INE062A01020',
                'BHARTIARTL': 'NSE_EQ|INE397D01024',
                'ITC': 'NSE_EQ|INE154A01025',
                'HINDUNILVR': 'NSE_EQ|INE030A01027',
                'KOTAKBANK': 'NSE_EQ|INE237A01028',
                'LT': 'NSE_EQ|INE018A01030',
                'AXISBANK': 'NSE_EQ|INE238A01034',
                'ASIANPAINT': 'NSE_EQ|INE021A01026',
                'MARUTI': 'NSE_EQ|INE585B01010',
                'TITAN': 'NSE_EQ|INE280A01028',
                'ULTRACEMCO': 'NSE_EQ|INE481G01011',
                'WIPRO': 'NSE_EQ|INE075A01022',
                'HCLTECH': 'NSE_EQ|INE860A01027',
                'NESTLEIND': 'NSE_EQ|INE239A01016',
                
                # PSU & Other popular stocks
                'NTPC': 'NSE_EQ|INE733E01010',
                'ONGC': 'NSE_EQ|INE213A01029',
                'POWERGRID': 'NSE_EQ|INE752E01010',
                'COALINDIA': 'NSE_EQ|INE522F01014',
                'IOC': 'NSE_EQ|INE242A01010',
                'BPCL': 'NSE_EQ|INE029A01011',
                'HINDALCO': 'NSE_EQ|INE038A01020',
                'TATASTEEL': 'NSE_EQ|INE081A01020',
                'JSWSTEEL': 'NSE_EQ|INE019A01038',
                'SAIL': 'NSE_EQ|INE114A01011',
                
                # Shipping & Maritime (Popular for trading)
                'COCHINSHIP': 'NSE_EQ|INE704P01025',
                'SCI': 'NSE_EQ|INE109A01011',
                'GREAVESCOT': 'NSE_EQ|INE224A01026',
                
                # Auto sector
                'MAHINDRA': 'NSE_EQ|INE101A01026',
                'BAJAJ-AUTO': 'NSE_EQ|INE917I01010',
                'EICHERMOT': 'NSE_EQ|INE066A01021',
                'HEROMOTOCO': 'NSE_EQ|INE158A01026',
                'TVSMOTOR': 'NSE_EQ|INE494B01023',
                
                # IT sector
                'TECHM': 'NSE_EQ|INE669C01036',
                'MINDTREE': 'NSE_EQ|INE018I01017',
                'MPHASIS': 'NSE_EQ|INE356A01018',
                
                # Banking & Finance
                'PNB': 'NSE_EQ|INE160A01022',
                'CANBK': 'NSE_EQ|INE476A01014',
                'BANKBARODA': 'NSE_EQ|INE028A01039',
                'UNIONBANK': 'NSE_EQ|INE692A01016',
                'IDFCFIRSTB': 'NSE_EQ|INE092T01019',
                
                # Pharma
                'SUNPHARMA': 'NSE_EQ|INE044A01036',
                'DRREDDY': 'NSE_EQ|INE089A01023',
                'CIPLA': 'NSE_EQ|INE059A01026',
                'BIOCON': 'NSE_EQ|INE376G01013',
                
                # Telecom
                'IDEA': 'NSE_EQ|INE669E01016',
                'RCOM': 'NSE_EQ|INE330H01018',
                
                # Infrastructure  
                'IRCTC': 'NSE_EQ|INE335Y01020',
                'GMRINFRA': 'NSE_EQ|INE776C01039',
                'ADANIPORTS': 'NSE_EQ|INE742F01042',
                
                # Popular trading stocks
                'YESBANK': 'NSE_EQ|INE528G01035',
                'RPOWER': 'NSE_EQ|INE614G01033',
                'SUZLON': 'NSE_EQ|INE040H01021',
                'JETAIRWAYS': 'NSE_EQ|INE802G01018',
                'BHEL': 'NSE_EQ|INE257A01026'
            }
            
            if self.trading_symbol in known_symbols:
                fallback_key = known_symbols[self.trading_symbol]
                self.log_colored(f"🔄 Using known instrument key: {fallback_key}", "info")
                return fallback_key
            
            # Final fallback: construct key manually (may not work for all symbols)
            fallback_key = f"NSE_EQ|{self.trading_symbol}"
            self.log_colored(f"⚠️  Using manual instrument key: {fallback_key}", "warning") 
            self.log_colored("💡 This may not work. Check instrument token manually.", "warning")
            return fallback_key
            
        except Exception as e:
            self.log_colored(f"⚠️  Error getting instrument key: {str(e)}", "warning")
            return f"NSE_EQ|{self.trading_symbol}"

    def on_market_message(self, message):
        """Handle real-time market data messages - SMART logging (only on change)"""
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']
                
                for instrument_key, data in feeds.items():
                    # Fix: The price is nested under 'ltpc' -> 'ltp'
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])
                        
                        # Only update and log if price actually changed
                        if abs(new_price - self.last_logged_price) >= 0.01:  # Changed by at least 1 paisa
                            self.real_time_price = new_price
                            self.current_price = new_price  # Override historical price
                            self.price_update_count += 1
                            self.last_websocket_update = time.time()
                            
                            # Log price update only when it changes
                            if self.price_update_count > 1:  # Skip first update (initialization)
                                if self.price_update_count % 10 == 0 or abs(new_price - self.last_logged_price) >= 0.50:
                                    # Log every 10th update OR significant price moves (50+ paisa)
                                    self.log_colored(f"📡 Real-time: ₹{new_price:,.2f} (Update #{self.price_update_count})", "info")
                            
                            self.last_logged_price = new_price
                            
                            # Check position P&L only if price changed meaningfully
                            if self.position and abs(new_price - self.position['entry_price']) > 0.10:
                                self.check_position_pnl_realtime_smart()
                                
        except Exception as e:
            self.log_colored(f"❌ Error processing WebSocket message: {str(e)}", "error")

    def on_websocket_open(self):
        """Called when WebSocket connection opens"""
        self.log_colored("🔗 WebSocket connection established!", "success")
        self.log_colored(f"📡 Streaming real-time data for {self.trading_symbol}", "info")

    def on_websocket_error(self, error):
        """Called when WebSocket encounters an error"""
        self.log_colored(f"❌ WebSocket error: {str(error)}", "error")

    def on_websocket_close(self, close_status_code, close_msg):
        """Called when WebSocket connection closes"""
        self.log_colored(f"🔌 WebSocket connection closed (Code: {close_status_code})", "info")

    def check_position_pnl_realtime(self):
        """Check position P&L with real-time price updates"""
        if not self.position: return
            
        current_time = time.time()
        if current_time - self.last_profit_check < 5:  # Throttle to every 5 seconds
            return
            
        pnl = (self.current_price - self.position['entry_price']) / self.position['entry_price'] * 100
        if self.position['side'] == 'SELL':
            pnl *= -1
            
        # Enhanced P&L logging with price source indicator
        price_source = "🔴 Historical" if self.real_time_price == 0 else "🟢 Real-time"
        self.log_colored(
            f"💰 Position P&L: {pnl:+.2f}% | Entry: ₹{self.position['entry_price']:,.2f} | "
            f"Current: ₹{self.current_price:,.2f} | {price_source}", 
            "profit" if pnl > 0 else "loss"
        )
        
        self.last_profit_check = current_time

    def check_position_pnl_realtime_smart(self):
        """Check position P&L with smart logging - only log when P&L actually changes"""
        if not self.position: 
            return
            
        current_time = time.time()
        if current_time - self.last_profit_check < 3:  # Throttle to every 3 seconds max
            return
            
        # Calculate current P&L
        pnl = (self.current_price - self.position['entry_price']) / self.position['entry_price'] * 100
        if self.position['side'] == 'SELL':
            pnl *= -1
            
        # Only log if P&L changed by at least 0.05% or it's been a while
        pnl_rounded = round(pnl, 2)
        should_log = False
        
        if self.last_logged_pnl_percent is None:
            should_log = True  # First P&L check
        elif abs(pnl_rounded - self.last_logged_pnl_percent) >= 0.05:
            should_log = True  # P&L changed by 5+ basis points
        elif current_time - self.last_profit_check > 30:
            should_log = True  # Force update every 30 seconds
            
        if should_log:
            price_source = "🔴 Historical" if self.real_time_price == 0 else "🟢 Real-time"
            self.log_colored(
                f"💰 Position P&L: {pnl:+.2f}% | Entry: ₹{self.position['entry_price']:,.2f} | "
                f"Current: ₹{self.current_price:,.2f} | {price_source}", 
                "profit" if pnl > 0 else "loss"
            )
            
            self.last_logged_pnl_percent = pnl_rounded
            self.last_profit_check = current_time

    def identify_support_resistance_levels(self):
        if len(self.candle_data) < self.lookback_periods: return
        highs = [c['high'] for c in self.candle_data[-self.lookback_periods:]]
        lows = [c['low'] for c in self.candle_data[-self.lookback_periods:]]
        self.resistance_levels = self._group_levels([h for i, h in enumerate(highs) if i > 1 and i < len(highs) - 2 and h > highs[i-1] and h > highs[i-2] and h > highs[i+1] and h > highs[i+2]])
        self.support_levels = self._group_levels([l for i, l in enumerate(lows) if i > 1 and i < len(lows) - 2 and l < lows[i-1] and l < lows[i-2] and l < lows[i+1] and l < lows[i+2]])
        self.resistance_levels = self._filter_by_touches(self.resistance_levels, highs)
        self.support_levels = self._filter_by_touches(self.support_levels, lows)
        self.resistance_levels.sort(reverse=True)
        self.support_levels.sort(reverse=True)
        
        # DETAILED LOGGING OF FOUND LEVELS
        if self.resistance_levels or self.support_levels:
            self.log_colored(
                f"S&R Update: {len(self.support_levels)} Support, {len(self.resistance_levels)} Resistance levels found",
                "level"
            )
            
            # Print Support Levels
            if self.support_levels:
                print(f"\n{Colors.GREEN}🛡️  SUPPORT LEVELS FOUND:{Colors.RESET}")
                for i, level in enumerate(self.support_levels, 1):
                    if self.current_price > 0:
                        distance = ((self.current_price - level) / level) * 100
                        status = "🎯 ACTIVE" if abs(distance) <= self.bounce_threshold else "⏳ MONITORING"
                        print(f"  {Colors.GREEN}S{i}: {level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                    else:
                        print(f"  {Colors.GREEN}S{i}: {level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
            
            # Print Resistance Levels  
            if self.resistance_levels:
                print(f"\n{Colors.RED}🛡️  RESISTANCE LEVELS FOUND:{Colors.RESET}")
                for i, level in enumerate(self.resistance_levels, 1):
                    if self.current_price > 0:
                        distance = ((level - self.current_price) / self.current_price) * 100
                        status = "🎯 ACTIVE" if abs(distance) <= self.bounce_threshold else "⏳ MONITORING"
                        print(f"  {Colors.RED}R{i}: {level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                    else:
                        print(f"  {Colors.RED}R{i}: {level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
            
            print(f"\n{Colors.CYAN}💰 Current Price: {self.current_price:,.2f}{Colors.RESET}")
            print(f"{Colors.YELLOW}📏 Bounce Threshold: ±{self.bounce_threshold}%{Colors.RESET}")
            print(f"{Colors.MAGENTA}════════════════════════════════════════{Colors.RESET}")
        else:
            self.log_colored("No valid S&R levels found - need more data or lower thresholds", "warning")

    def _group_levels(self, levels):
        if not levels: return []
        levels.sort()
        grouped, current_group = [], [levels[0]]
        for level in levels[1:]:
            if abs(level - current_group[0]) / current_group[0] * 100 < self.level_threshold:
                current_group.append(level)
            else:
                grouped.append(sum(current_group) / len(current_group))
                current_group = [level]
        grouped.append(sum(current_group) / len(current_group))
        return grouped

    def _filter_by_touches(self, levels, price_data):
        return [l for l in levels if sum(1 for p in price_data if abs(p - l) / l * 100 < self.level_threshold) >= self.min_touches]

    def calculate_trend_direction(self):
        if len(self.candle_data) < self.ema_period:
            self.trend_direction = None
            return
        closes = [c['close'] for c in self.candle_data[-self.ema_period:]]
        self.trend_ema = pd.Series(closes).ewm(span=self.ema_period, adjust=False).mean().iloc[-1]
        if self.current_price > self.trend_ema * 1.002: self.trend_direction = "BULLISH"
        elif self.current_price < self.trend_ema * 0.998: self.trend_direction = "BEARISH"
        else: self.trend_direction = "NEUTRAL"
        self.log_colored(f"📈 Trend: {self.trend_direction} | EMA: {self.trend_ema:,.2f} | Price: {self.current_price:,.2f}", "level")

    def find_nearest_levels(self):
        return max([l for l in self.support_levels if l < self.current_price] or [None]), min([l for l in self.resistance_levels if l > self.current_price] or [None])

    def check_support_resistance_signals(self):
        if self.position: return []
        signals, (nearest_support, nearest_resistance) = [], self.find_nearest_levels()
        if nearest_support and self.trend_direction in ["BULLISH", "NEUTRAL"] and 0 < (self.current_price - nearest_support) / nearest_support * 100 <= self.bounce_threshold:
            signals.append(('BUY', 'support_bounce', 0.8, nearest_support))
        if nearest_resistance and self.trend_direction in ["BEARISH", "NEUTRAL"] and 0 < (nearest_resistance - self.current_price) / self.current_price * 100 <= self.bounce_threshold:
            signals.append(('SELL', 'resistance_rejection', 0.8, nearest_resistance))
        return signals

    def execute_trade(self, side, reason, level, confidence):
        """Simulates a trade and logs it to the paper trading log."""
        quantity = 1 # Simulate trading 1 share
        trade_log_msg = f"PAPER_TRADE_OPEN: Side={side}, Qty={quantity}, Symbol={self.trading_symbol}, Price={self.current_price:.2f}, Reason={reason}, Level={level:.2f}, Confidence={confidence:.2f}"
        paper_trade_logger.info(trade_log_msg)
        self.log_colored(trade_log_msg, "trade")
        
        self.position = {'side': side, 'qty': quantity, 'entry_price': self.current_price, 'timestamp': datetime.now()}
        self.trade_count += 1
        return True

    def close_position(self, reason):
        """Simulates closing a position and logs it."""
        if not self.position: return
        pnl = (self.current_price - self.position['entry_price']) / self.position['entry_price'] * 100
        if self.position['side'] == 'SELL': pnl *= -1
        
        trade_log_msg = f"PAPER_TRADE_CLOSE: Side={self.position['side']}, PnL={pnl:.2f}%, Reason={reason}, Entry={self.position['entry_price']:,.2f}, Exit={self.current_price:,.2f}"
        paper_trade_logger.info(trade_log_msg)
        self.log_colored(trade_log_msg, "profit" if pnl > 0 else "loss")
        
        self.total_pnl += pnl
        self.position = None

    def should_close_position(self):
        if not self.position: return False, ""
        pnl = (self.current_price - self.position['entry_price']) / self.position['entry_price'] * 100
        if self.position['side'] == 'SELL': pnl *= -1
        if pnl >= self.max_risk_pct * self.risk_reward_ratio: return True, "Profit target reached"
        if pnl <= -self.max_risk_pct: return True, "Stop loss triggered"
        return False, ""

    def run_strategy(self):
        """Main strategy loop with REAL-TIME WebSocket integration and OBSERVATION PERIOD"""
        self.running = True
        self.log_colored(f"🚀 Starting Enhanced Upstox Paper Trading Bot for {self.trading_symbol} on {self.timeframe} timeframe!", "success")
        
        # Authentication
        if not self.client.access_token and not self.client.authenticate():
            self.log_colored("Authentication failed. Exiting.", "error")
            return
        
        # Get initial historical data
        if not self.get_candles():
            self.log_colored("Failed to get initial candle data. Exiting.", "error")
            return
        
        # Initialize WebSocket for real-time data
        websocket_connected = False
        if self.websocket_enabled:
            self.log_colored("🔗 Setting up real-time WebSocket streaming...", "info")
            if self.setup_websocket_streaming():
                try:
                    self.market_streamer.connect()
                    websocket_connected = True
                    self.log_colored("✅ Real-time data streaming active!", "success")
                    
                    # Wait for initial real-time price
                    wait_count = 0
                    while self.real_time_price == 0 and wait_count < 30:
                        time.sleep(0.5)
                        wait_count += 1
                    
                    if self.real_time_price > 0:
                        self.log_colored(f"📡 Initial real-time price: ₹{self.real_time_price:.2f}", "success")
                        self.current_price = self.real_time_price
                except Exception as e:
                    self.log_colored(f"WebSocket connection failed: {str(e)}", "error")
                    websocket_connected = False
        
        # Identify initial levels (for display only, not immediate trading)
        self.identify_support_resistance_levels()
        self.calculate_trend_direction()
        
        self.log_colored(f"📊 Data Source: {'🟢 Real-time WebSocket + Historical' if websocket_connected else '🔴 Historical only'}", "info")
        
        # OBSERVATION PERIOD - Wait before trading
        self.log_colored(f"👀 OBSERVATION PERIOD: Monitoring market for {self.observation_period} seconds before trading...", "warning")
        
        observation_start = time.time()
        price_updates_received = 0
        
        while time.time() - observation_start < self.observation_period:
            # Update real-time price tracking during observation
            if websocket_connected and self.real_time_price > 0:
                if self.real_time_price != self.current_price:
                    price_updates_received += 1
                    self.current_price = self.real_time_price
                    
                    # Show we're receiving live data
                    if price_updates_received % 10 == 0:
                        remaining = self.observation_period - (time.time() - observation_start)
                        self.log_colored(f"📡 Live updates: {price_updates_received} | Observation ends in {remaining:.0f}s", "info")
            
            time.sleep(1)
        
        # End observation period
        observation_status = f"📊 Observation complete! Received {price_updates_received} real-time price updates"
        self.log_colored(observation_status, "success")
        self.log_colored("🎯 Now actively monitoring for trading signals...", "success")
        
        # MAIN TRADING LOOP
        try:
            last_signal_check = 0
            last_data_update = 0
            
            while self.running:
                current_time = time.time()
                
                # Update historical data every 5 minutes
                if current_time - last_data_update > 300:
                    if self.get_candles():
                        self.identify_support_resistance_levels()
                        self.calculate_trend_direction()
                        last_data_update = current_time
                
                # Position management
                if self.position:
                    should_close, reason = self.should_close_position()
                    if should_close:
                        self.close_position(reason)
                    elif not websocket_connected:  # Only log periodically if no real-time updates
                        if time.time() - self.last_profit_check > 10:
                            pnl = (self.current_price - self.position['entry_price']) / self.position['entry_price'] * 100
                            if self.position['side'] == 'SELL': pnl *= -1
                            self.log_colored(f"💰 Position P&L: {pnl:.2f}% (Historical)", "profit" if pnl > 0 else "loss")
                            self.last_profit_check = time.time()
                
                # Check for new signals (only if no position and not too frequent)
                elif current_time - last_signal_check > self.signal_check_interval:
                    signals = self.check_support_resistance_signals()
                    if signals:
                        side, reason, confidence, level = signals[0]
                        if confidence >= self.min_confidence_threshold:
                            self.log_colored(f"🚨 HIGH CONFIDENCE SIGNAL: {reason} (confidence: {confidence:.1%})", "success")
                            if self.execute_trade(side, reason, level, confidence):
                                self.log_colored(f"✅ Trade executed: {side} @ ₹{self.current_price:.2f}", "trade")
                            
                    last_signal_check = current_time
                
                # Status update every 2 minutes when no position
                elif not self.position and int(current_time) % 120 == 0:
                    nearest_support, nearest_resistance = self.find_nearest_levels()
                    
                    status_parts = []
                    if self.trend_direction:
                        status_parts.append(f"Trend: {self.trend_direction}")
                    if nearest_support:
                        support_dist = ((self.current_price - nearest_support) / nearest_support) * 100
                        status_parts.append(f"Support: ₹{nearest_support:,.2f} ({support_dist:+.2f}%)")
                    if nearest_resistance:
                        resistance_dist = ((nearest_resistance - self.current_price) / self.current_price) * 100
                        status_parts.append(f"Resistance: ₹{nearest_resistance:,.2f} (+{resistance_dist:.2f}%)")
                    
                    status = " | ".join(status_parts) if status_parts else "No levels detected"
                    data_source = "🟢 Real-time" if websocket_connected else "🔴 Historical"
                    self.log_colored(f"🔍 Monitoring | Price: ₹{self.current_price:,.2f} ({data_source}) | {status}", "info")
                
                time.sleep(2)  # Main loop delay
                
        except KeyboardInterrupt:
            self.log_colored("🛑 Bot stopped by user.", "warning")
            if self.position: self.close_position("Manual stop")
        finally:
            self.running = False
            if hasattr(self, 'market_streamer') and self.market_streamer:
                try:
                    self.market_streamer.disconnect()
                    self.log_colored("🔌 WebSocket connection closed", "info")
                except:
                    pass

def run_upstox_paper_trading_bot(symbol: str, timeframe: str):
    """Run the Enhanced Upstox paper trading bot with real-time WebSocket support"""
    # --- Setup Dynamic Logger ---
    log_filename = f"upstox_paper_trades_{symbol}_{timeframe}.log"
    paper_trade_formatter = logging.Formatter('%(asctime)s - %(message)s')
    paper_trade_handler = logging.FileHandler(log_filename, mode='w')
    paper_trade_handler.setFormatter(paper_trade_formatter)
    
    # Clear existing handlers and add the new one
    if paper_trade_logger.hasHandlers():
        paper_trade_logger.handlers.clear()
    paper_trade_logger.addHandler(paper_trade_handler)

    os.system('clear' if os.name == 'posix' else 'cls')
    
    # Enhanced startup banner with WebSocket status
    websocket_status = "🟢 ENABLED" if UPSTOX_SDK_AVAILABLE else "🔴 DISABLED"
    websocket_note = "Real-time streaming active" if UPSTOX_SDK_AVAILABLE else "Install: pip install upstox-python-sdk"
    
    print(f"""
{Colors.BOLD}{Colors.BLUE}📊 ENHANCED UPSTOX PAPER TRADING BOT{Colors.RESET}
{Colors.BLUE}{'=' * 65}{Colors.RESET}
{Colors.CYAN}Symbol: {symbol} | Timeframe: {timeframe}{Colors.RESET}
{Colors.YELLOW}📝 Mode: Paper Trading (No real orders){Colors.RESET}
{Colors.WHITE}📄 Logging to: {log_filename}{Colors.RESET}

{Colors.BOLD}📡 REAL-TIME DATA STATUS{Colors.RESET}
{Colors.GREEN if UPSTOX_SDK_AVAILABLE else Colors.RED}WebSocket: {websocket_status}{Colors.RESET}
{Colors.WHITE}{websocket_note}{Colors.RESET}

{Colors.MAGENTA}🎯 Expected P&L Updates:{Colors.RESET}
{Colors.GREEN if UPSTOX_SDK_AVAILABLE else Colors.YELLOW}{'✅ Real-time (live price changes)' if UPSTOX_SDK_AVAILABLE else '⚠️  Historical only (delayed updates)'}{Colors.RESET}

{Colors.CYAN}⏱️ SMART ENTRY LOGIC:{Colors.RESET}
{Colors.GREEN}✅ 60-second observation period{Colors.RESET}
{Colors.GREEN}✅ 70%+ confidence threshold{Colors.RESET}
{Colors.GREEN}✅ No immediate historical trades{Colors.RESET}
    """)
    
    if not UPSTOX_SDK_AVAILABLE:
        print(f"""
{Colors.YELLOW}📋 TO ENABLE REAL-TIME STREAMING:{Colors.RESET}
{Colors.WHITE}1. Install official SDK: pip install upstox-python-sdk{Colors.RESET}
{Colors.WHITE}2. Restart the bot{Colors.RESET}
{Colors.WHITE}3. You'll see live P&L changes instead of 0.00%{Colors.RESET}
        """)
    
    bot = UpstoxPaperTradingBot(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret'],
        symbol=symbol,
        timeframe=timeframe
    )
    try:
        bot.run_strategy()
    except Exception as e:
        print(f"\n{Colors.RED}❌ Error: {e}{Colors.RESET}")
        if "upstox_client" in str(e):
            print(f"{Colors.YELLOW}💡 Hint: Install upstox-python-sdk for real-time data{Colors.RESET}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upstox Paper Trading Bot")
    parser.add_argument("--symbol", type=str, default="TATAMOTORS", help="Stock symbol to trade (e.g., TATAMOTORS, RELIANCE).")
    parser.add_argument("--timeframe", type=str, default="15min", help="Candlestick timeframe (e.g., '5min', '15min', '1H').")
    
    args = parser.parse_args()
    
    run_upstox_paper_trading_bot(symbol=args.symbol, timeframe=args.timeframe)


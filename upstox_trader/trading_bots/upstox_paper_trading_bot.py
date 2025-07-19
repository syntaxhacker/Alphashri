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
from config_and_utils.free_indian_apis import UpstoxAPI
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

def fetch_nifty50_stocks():
    """Fetch current Nifty 50 stocks list dynamically"""
    try:
        import requests
        print("🔍 Fetching current Nifty 50 stocks list...")
        
        # NSE official Nifty 50 composition API
        url = "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if 'data' in data:
                # Filter out the index itself and get only individual stocks
                nifty50_symbols = [stock['symbol'] for stock in data['data'] 
                                 if stock['symbol'] != 'NIFTY 50' and stock['symbol'] != 'NIFTY']
                print(f"✅ Successfully fetched {len(nifty50_symbols)} Nifty 50 stocks")
                return nifty50_symbols
        
        # Fallback to static list if API fails
        print("⚠️  API fetch failed, using static Nifty 50 list...")
        return get_static_nifty50()
        
    except Exception as e:
        print(f"⚠️  Error fetching Nifty 50: {e}")
        print("📋 Using static Nifty 50 list as fallback...")
        return get_static_nifty50()

def get_static_nifty50():
    """Static Nifty 50 list as fallback"""
    return [
        "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", 
        "SBIN", "BHARTIARTL", "ASIANPAINT", "MARUTI", "BAJFINANCE", "M&M", "LT",
        "HCLTECH", "SUNPHARMA", "TITAN", "ULTRACEMCO", "ONGC", "NESTLEIND",
        "KOTAKBANK", "WIPRO", "NTPC", "TECHM", "POWERGRID", "BAJAJFINSV",
        "DRREDDY", "TATAMOTORS", "COALINDIA", "HDFCLIFE", "SBILIFE", "EICHERMOT",
        "BRITANNIA", "BPCL", "GRASIM", "CIPLA", "DIVISLAB", "JSWSTEEL",
        "HEROMOTOCO", "ADANIENT", "TATASTEEL", "HINDALCO", "INDUSINDBK",
        "BAJAJ-AUTO", "APOLLOHOSP", "UPL", "AXISBANK", "TATACONSUM",
        "ADANIPORTS", "LTIM"
    ]

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
    
    def __init__(self, api_key, api_secret, symbols=["TATAMOTORS"], timeframe="15min"):
        # API Setup
        self.client = UpstoxAPI(api_key=api_key, api_secret=api_secret)
        self.trading_symbols = symbols if isinstance(symbols, list) else [symbols]
        self.timeframe = timeframe
        
        # REAL-TIME WebSocket Setup
        self.websocket_enabled = UPSTOX_SDK_AVAILABLE
        self.market_streamer = None
        self.instrument_keys = {}  # symbol -> instrument_key mapping
        self.real_time_prices = {}  # symbol -> price mapping
        self.price_update_counts = {}  # symbol -> count mapping
        self.last_websocket_update = 0
        
        # Smart Logging - Track Previous Values (per symbol)
        self.last_logged_prices = {}  # symbol -> price mapping
        self.last_logged_pnl_percents = {}  # symbol -> pnl mapping
        self.last_logged_update_counts = {}  # symbol -> count mapping
        
        # Initialize per-symbol data structures
        for symbol in self.trading_symbols:
            self.real_time_prices[symbol] = 0.0
            self.price_update_counts[symbol] = 0
            self.last_logged_prices[symbol] = 0.0
            self.last_logged_pnl_percents[symbol] = None
            self.last_logged_update_counts[symbol] = 0
        
        # SUPPORT/RESISTANCE SETTINGS
        self.lookback_periods = 50
        self.min_touches = 2
        self.level_threshold = 0.5  # % threshold for level identification
        self.bounce_threshold = 0.25  # % threshold for bounce confirmation
        
        # POSITION TRACKING (Multi-symbol)
        self.positions = {}  # symbol -> position dict mapping
        self.current_prices = {}  # symbol -> price mapping
        self.candle_data = {}  # symbol -> candle list mapping
        
        # Initialize per-symbol tracking
        for symbol in self.trading_symbols:
            # Position will be created when trade is executed
            self.current_prices[symbol] = 0
            self.candle_data[symbol] = []
        
        # STRATEGY CACHE (Multi-symbol)
        self.support_levels = {}  # symbol -> levels mapping
        self.resistance_levels = {}  # symbol -> levels mapping
        self.ema_period = 20
        self.last_candle_times = {}  # symbol -> time mapping
        self.last_level_updates = {}  # symbol -> time mapping
        self.trend_directions = {}  # symbol -> direction mapping
        self.trend_emas = {}  # symbol -> ema mapping
        
        # Initialize per-symbol strategy data
        for symbol in self.trading_symbols:
            self.support_levels[symbol] = []
            self.resistance_levels[symbol] = []
            self.last_candle_times[symbol] = 0
            self.last_level_updates[symbol] = 0
            self.trend_directions[symbol] = "NEUTRAL"
            self.trend_emas[symbol] = 0.0
        
        # TRADING METRICS
        self.trade_count = 0
        self.total_pnl = 0.0
        self.last_profit_check = time.time()
        self.daily_trades = []  # Store all trades for daily summary
        
        # RISK MANAGEMENT - Optimized for 15min intraday
        self.max_risk_pct = 0.5  # 0.5% stop loss
        self.quick_profit_target = 0.3  # 0.3% quick profit target
        self.trailing_stop_trigger = 0.2  # Start trailing after 0.2% profit
        
        # TRADING THRESHOLDS
        self.min_confidence_threshold = 0.7  # Only trade signals with 70%+ confidence
        self.signal_check_interval = 30  # Check for signals every 30 seconds max
        self.observation_period = 60  # 1 minute observation before trading
        
        # SIGNAL DEDUPLICATION (Multi-symbol)
        self.last_signal_times = {}  # symbol -> signal_type -> time mapping
        self.signal_cooldown = 1200
        
        # Initialize per-symbol signal tracking
        for symbol in self.trading_symbols:
            self.last_signal_times[symbol] = {}
        
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

    def get_candles(self, symbol=None):
        """Fetch and resample data to the target timeframe for symbol(s)."""
        symbols_to_fetch = [symbol] if symbol else self.trading_symbols
        success_count = 0
        
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
        
        # Determine the best base interval to fetch from Upstox
        timeframe_td = pd.to_timedelta(self.timeframe)
        if timeframe_td < pd.to_timedelta('30min'):
            base_interval = '1minute'
        else:
            base_interval = '30minute'
        
        for sym in symbols_to_fetch:
            try:
                df = self.client.fetch_historical_data(
                    symbol=sym,
                    interval=base_interval,
                    from_date=from_date,
                    to_date=to_date
                )
                
                if df is None or df.empty:
                    self.log_colored(f"⚠️  Could not fetch {base_interval} candle data for {sym}", "warning")
                    continue

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

                self.candle_data[sym] = [
                    {
                        'timestamp': int(row.name.timestamp() * 1000),
                        'open': row['open'],
                        'high': row['high'],
                        'low': row['low'],
                        'close': row['close'],
                        'volume': row['volume']
                    } for _, row in df_resampled.iterrows()
                ]
                
                if self.candle_data[sym]:
                    self.current_prices[sym] = self.candle_data[sym][-1]['close']
                    success_count += 1
                    
            except Exception as e:
                self.log_colored(f"❌ Error fetching candles for {sym}: {str(e)}", "error")
                continue
        
        if success_count > 0:
            self.log_colored(f"✅ Successfully prepared candles for {success_count}/{len(symbols_to_fetch)} symbols", "success")
            return True
        else:
            self.log_colored("❌ Failed to fetch candles for any symbol", "error")
            return False

    def setup_websocket_streaming(self):
        """Initialize real-time WebSocket streaming for multiple symbols"""
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
            
            # Get instrument keys for all symbols
            instrument_keys_list = []
            for symbol in self.trading_symbols:
                instrument_key = self.get_instrument_key_for_symbol(symbol)
                if instrument_key:
                    self.instrument_keys[symbol] = instrument_key
                    instrument_keys_list.append(instrument_key)
                    self.log_colored(f"🔑 {symbol}: {instrument_key}", "info")
                else:
                    self.log_colored(f"❌ Could not find instrument key for {symbol}", "error")
            
            if not instrument_keys_list:
                self.log_colored("❌ No valid instrument keys found", "error")
                return False
            
            # Initialize Market Data Streamer with all instrument keys
            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client, 
                instrument_keys_list,  # Subscribe to all symbols
                "ltpc"  # Last Traded Price mode for fastest updates
            )
            
            # Set up event handlers
            self.market_streamer.on("message", self.on_market_message)
            self.market_streamer.on("open", self.on_websocket_open)
            self.market_streamer.on("error", self.on_websocket_error)
            self.market_streamer.on("close", self.on_websocket_close)
            
            self.log_colored(f"✅ WebSocket streaming setup complete for {len(instrument_keys_list)} symbols", "success")
            return True
            
        except Exception as e:
            self.log_colored(f"❌ WebSocket setup failed: {str(e)}", "error")
            return False

    def get_instrument_key_for_symbol(self, symbol):
        """Get the proper instrument key for WebSocket subscription"""
        try:
            # Try to load instruments if not already loaded
            if not self.client.instruments:
                try:
                    self.client._download_and_cache_instruments()
                except AttributeError:
                    # Method doesn't exist in current API class
                    pass
            
            # Find the instrument key for the symbol
            if self.client.instruments:
                for instrument in self.client.instruments:
                    if (instrument.get('tradingsymbol') == symbol and 
                        instrument.get('exchange') == 'NSE' and 
                        instrument.get('instrument_type') == 'EQ'):
                        
                        instrument_key = f"NSE_EQ|{instrument.get('instrument_token')}"
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
            
            if symbol in known_symbols:
                fallback_key = known_symbols[symbol]
                return fallback_key
            
            # Final fallback: construct key manually (may not work for all symbols)
            fallback_key = f"NSE_EQ|{symbol}"
            return fallback_key
            
        except Exception as e:
            self.log_colored(f"⚠️  Error getting instrument key for {symbol}: {str(e)}", "warning")
            return f"NSE_EQ|{symbol}"
    
    def get_symbol_from_instrument_key(self, instrument_key):
        """Get symbol from instrument key for message routing"""
        for symbol, key in self.instrument_keys.items():
            if key == instrument_key:
                return symbol
        return None

    def on_market_message(self, message):
        """Handle real-time market data messages for multiple symbols - SMART logging (only on change)"""
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']
                
                for instrument_key, data in feeds.items():
                    # Find which symbol this instrument key belongs to
                    symbol = self.get_symbol_from_instrument_key(instrument_key)
                    if not symbol:
                        continue
                    
                    # Fix: The price is nested under 'ltpc' -> 'ltp'
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        new_price = float(data['ltpc']['ltp'])
                        
                        # Only update and log if price actually changed
                        if abs(new_price - self.last_logged_prices.get(symbol, 0)) >= 0.01:  # Changed by at least 1 paisa
                            self.real_time_prices[symbol] = new_price
                            self.current_prices[symbol] = new_price  # Override historical price
                            self.price_update_counts[symbol] += 1
                            self.last_websocket_update = time.time()
                            
                            # Log price update only when it changes
                            if self.price_update_counts[symbol] > 1:  # Skip first update (initialization)
                                if (self.price_update_counts[symbol] % 100 == 0 or 
                                    abs(new_price - self.last_logged_prices[symbol]) >= 5):
                                    # Log every 100th update OR significant price moves (5rs)
                                    self.log_colored(
                                        f"📡 {symbol}: ₹{new_price:,.2f} (Update #{self.price_update_counts[symbol]})", 
                                        "info"
                                    )
                            
                            self.last_logged_prices[symbol] = new_price
                            
                            # Check position P&L only if price changed meaningfully
                            if (symbol in self.positions and self.positions[symbol] and 
                                abs(new_price - self.positions[symbol]['entry_price']) > 0.10):
                                self.check_position_pnl_realtime_smart(symbol)
                                
        except Exception as e:
            self.log_colored(f"❌ Error processing WebSocket message: {str(e)}", "error")

    def on_websocket_open(self):
        """Called when WebSocket connection opens"""
        self.log_colored("🔗 WebSocket connection established!", "success")
        symbols_str = ", ".join(self.trading_symbols)
        self.log_colored(f"📡 Streaming real-time data for: {symbols_str}", "info")

    def on_websocket_error(self, error):
        """Called when WebSocket encounters an error"""
        self.log_colored(f"❌ WebSocket error: {str(error)}", "error")

    def on_websocket_close(self, close_status_code, close_msg):
        """Called when WebSocket connection closes"""
        self.log_colored(f"🔌 WebSocket connection closed (Code: {close_status_code})", "info")

    def check_position_pnl_realtime(self, symbol):
        """Check position P&L with real-time price updates for specific symbol"""
        if not self.positions.get(symbol): 
            return
            
        current_time = time.time()
        if current_time - self.last_profit_check < 5:  # Throttle to every 5 seconds
            return
            
        position = self.positions[symbol]
        current_price = self.current_prices[symbol]
        
        pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        if position['side'] == 'SELL':
            pnl *= -1
            
        # Enhanced P&L logging with price source indicator
        price_source = "🔴 Historical" if self.real_time_prices.get(symbol, 0) == 0 else "🟢 Real-time"
        self.log_colored(
            f"💰 {symbol} P&L: {pnl:+.2f}% | Entry: ₹{position['entry_price']:,.2f} | "
            f"Current: ₹{current_price:,.2f} | {price_source}", 
            "profit" if pnl > 0 else "loss"
        )
        
        self.last_profit_check = current_time

    def check_position_pnl_realtime_smart(self, symbol):
        """Check position P&L with smart logging for specific symbol - only log when P&L actually changes"""
        if not self.positions.get(symbol): 
            return
            
        current_time = time.time()
        if current_time - self.last_profit_check < 3:  # Throttle to every 3 seconds max
            return
            
        position = self.positions[symbol]
        current_price = self.current_prices[symbol]
        
        # Calculate current P&L
        pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        if position['side'] == 'SELL':
            pnl *= -1
            
        # Only log if P&L changed by at least 0.05% or it's been a while
        pnl_rounded = round(pnl, 2)
        should_log = False
        
        last_pnl = self.last_logged_pnl_percents.get(symbol)
        if last_pnl is None:
            should_log = True  # First P&L check
        elif abs(pnl_rounded - last_pnl) >= 0.05:
            should_log = True  # P&L changed by 5+ basis points
        elif current_time - self.last_profit_check > 30:
            should_log = True  # Force update every 30 seconds
            
        if should_log:
            price_source = "🔴 Historical" if self.real_time_prices.get(symbol, 0) == 0 else "🟢 Real-time"
            self.log_colored(
                f"💰 {symbol} P&L: {pnl:+.2f}% | Entry: ₹{position['entry_price']:,.2f} | "
                f"Current: ₹{current_price:,.2f} | {price_source}", 
                "profit" if pnl > 0 else "loss"
            )
            
            self.last_logged_pnl_percents[symbol] = pnl_rounded
            self.last_profit_check = current_time

    def identify_support_resistance_levels(self, symbol):
        """Identify support and resistance levels for a specific symbol"""
        if len(self.candle_data.get(symbol, [])) < self.lookback_periods: 
            return
            
        candles = self.candle_data[symbol]
        highs = [c['high'] for c in candles[-self.lookback_periods:]]
        lows = [c['low'] for c in candles[-self.lookback_periods:]]
        
        self.resistance_levels[symbol] = self._group_levels([h for i, h in enumerate(highs) if i > 1 and i < len(highs) - 2 and h > highs[i-1] and h > highs[i-2] and h > highs[i+1] and h > highs[i+2]])
        self.support_levels[symbol] = self._group_levels([l for i, l in enumerate(lows) if i > 1 and i < len(lows) - 2 and l < lows[i-1] and l < lows[i-2] and l < lows[i+1] and l < lows[i+2]])
        
        self.resistance_levels[symbol] = self._filter_by_touches(self.resistance_levels[symbol], highs)
        self.support_levels[symbol] = self._filter_by_touches(self.support_levels[symbol], lows)
        
        self.resistance_levels[symbol].sort(reverse=True)
        self.support_levels[symbol].sort(reverse=True)
        
        # DETAILED LOGGING OF FOUND LEVELS
        support_count = len(self.support_levels[symbol])
        resistance_count = len(self.resistance_levels[symbol])
        
        if support_count > 0 or resistance_count > 0:
            self.log_colored(
                f"{symbol} S&R Update: {support_count} Support, {resistance_count} Resistance levels found",
                "level"
            )
            
            current_price = self.current_prices.get(symbol, 0)
            
            # Print Support Levels
            if self.support_levels[symbol]:
                print(f"\n{Colors.GREEN}🛡️  {symbol} SUPPORT LEVELS:{Colors.RESET}")
                for i, level in enumerate(self.support_levels[symbol], 1):
                    if current_price > 0:
                        distance = ((current_price - level) / level) * 100
                        status = "🎯 ACTIVE" if abs(distance) <= self.bounce_threshold else "⏳ MONITORING"
                        print(f"  {Colors.GREEN}S{i}: {level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                    else:
                        print(f"  {Colors.GREEN}S{i}: {level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
            
            # Print Resistance Levels  
            if self.resistance_levels[symbol]:
                print(f"\n{Colors.RED}🛡️  {symbol} RESISTANCE LEVELS:{Colors.RESET}")
                for i, level in enumerate(self.resistance_levels[symbol], 1):
                    if current_price > 0:
                        distance = ((level - current_price) / current_price) * 100
                        status = "🎯 ACTIVE" if abs(distance) <= self.bounce_threshold else "⏳ MONITORING"
                        print(f"  {Colors.RED}R{i}: {level:,.2f}{Colors.RESET} | Distance: {distance:+.2f}% | {status}")
                    else:
                        print(f"  {Colors.RED}R{i}: {level:,.2f}{Colors.RESET} | Distance: Waiting for price data | ⏳ MONITORING")
            
            print(f"\n{Colors.CYAN}💰 {symbol} Current Price: {current_price:,.2f}{Colors.RESET}")
            print(f"{Colors.YELLOW}📏 Bounce Threshold: ±{self.bounce_threshold}%{Colors.RESET}")
            print(f"{Colors.MAGENTA}════════════════════════════════════════{Colors.RESET}")
        else:
            self.log_colored(f"{symbol}: No valid S&R levels found - need more data or lower thresholds", "warning")

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

    def calculate_trend_direction(self, symbol):
        """Calculate trend direction for a specific symbol"""
        if len(self.candle_data.get(symbol, [])) < self.ema_period:
            self.trend_directions[symbol] = None
            return
            
        candles = self.candle_data[symbol]
        closes = [c['close'] for c in candles[-self.ema_period:]]
        self.trend_emas[symbol] = pd.Series(closes).ewm(span=self.ema_period, adjust=False).mean().iloc[-1]
        
        current_price = self.current_prices.get(symbol, 0)
        if current_price > self.trend_emas[symbol] * 1.002: 
            self.trend_directions[symbol] = "BULLISH"
        elif current_price < self.trend_emas[symbol] * 0.998: 
            self.trend_directions[symbol] = "BEARISH"
        else: 
            self.trend_directions[symbol] = "NEUTRAL"
            
        self.log_colored(
            f"📈 {symbol} Trend: {self.trend_directions[symbol]} | EMA: {self.trend_emas[symbol]:,.2f} | Price: {current_price:,.2f}", 
            "level"
        )

    def find_nearest_levels(self, symbol):
        """Find nearest support and resistance levels for a specific symbol"""
        current_price = self.current_prices.get(symbol, 0)
        support_levels = self.support_levels.get(symbol, [])
        resistance_levels = self.resistance_levels.get(symbol, [])
        
        nearest_support = max([l for l in support_levels if l < current_price] or [None])
        nearest_resistance = min([l for l in resistance_levels if l > current_price] or [None])
        
        return nearest_support, nearest_resistance

    def check_support_resistance_signals(self, symbol):
        """Check for trading signals for a specific symbol"""
        if self.positions.get(symbol): 
            return []
            
        signals = []
        nearest_support, nearest_resistance = self.find_nearest_levels(symbol)
        current_price = self.current_prices.get(symbol, 0)
        trend_direction = self.trend_directions.get(symbol, "NEUTRAL")
        
        if (nearest_support and trend_direction in ["BULLISH", "NEUTRAL"] and 
            0 < (current_price - nearest_support) / nearest_support * 100 <= self.bounce_threshold):
            signals.append(('BUY', 'support_bounce', 0.8, nearest_support))
            
        if (nearest_resistance and trend_direction in ["BEARISH", "NEUTRAL"] and 
            0 < (nearest_resistance - current_price) / current_price * 100 <= self.bounce_threshold):
            signals.append(('SELL', 'resistance_rejection', 0.8, nearest_resistance))
            
        return signals

    def execute_trade(self, symbol, side, reason, level, confidence):
        """Simulates a trade for a specific symbol and logs it to the paper trading log."""
        # Use real-time price if available, otherwise fall back to current_prices
        current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)
        
        # Calculate quantity based on ₹5000 position size
        target_amount = 50000
        quantity = max(1, int(target_amount / current_price))  # At least 1 share
        
        trade_log_msg = f"PAPER_TRADE_OPEN: Side={side}, Qty={quantity}, Symbol={symbol}, Price={current_price:.2f}, Reason={reason}, Level={level:.2f}, Confidence={confidence:.2f}"
        paper_trade_logger.info(trade_log_msg)
        self.log_colored(trade_log_msg, "trade")
        
        self.positions[symbol] = {
            'side': side, 
            'qty': quantity, 
            'entry_price': current_price, 
            'timestamp': datetime.now(),
            'highest_profit': 0.0,  # Track highest profit for trailing stop
            'trailing_stop_active': False,  # Track if trailing stop is active
            'trade_id': self.trade_count + 1  # Unique trade ID
        }
        self.trade_count += 1
        return True

    def close_position(self, symbol, reason):
        """Simulates closing a position for a specific symbol and logs it."""
        if not self.positions.get(symbol): 
            return
            
        position = self.positions[symbol]
        # Use real-time price if available, otherwise fall back to current_prices
        current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)
        
        pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        if position['side'] == 'SELL': 
            pnl *= -1
        
        trade_log_msg = f"PAPER_TRADE_CLOSE: Symbol={symbol}, Side={position['side']}, PnL={pnl:.2f}%, Reason={reason}, Entry={position['entry_price']:,.2f}, Exit={current_price:,.2f}"
        paper_trade_logger.info(trade_log_msg)
        self.log_colored(trade_log_msg, "profit" if pnl > 0 else "loss")
        
        self.total_pnl += pnl
        
        # Track trade in daily summary
        trade_duration = datetime.now() - position['timestamp']
        self.daily_trades.append({
            'id': position['trade_id'],
            'symbol': symbol,
            'side': position['side'],
            'entry_price': position['entry_price'],
            'exit_price': current_price,
            'qty': position['qty'],
            'pnl_pct': pnl,
            'pnl_amount': pnl * position['entry_price'] * position['qty'] / 100,
            'duration': trade_duration,
            'reason': reason,
            'entry_time': position['timestamp'],
            'exit_time': datetime.now()
        })
        
        del self.positions[symbol]  # Remove position completely instead of setting to None

    def should_close_position(self, symbol):
        """Advanced position closing logic with trailing stops and quick exits"""
        if not self.positions.get(symbol): 
            return False, ""
            
        position = self.positions[symbol]
        # Use real-time price if available
        current_price = self.real_time_prices.get(symbol, 0) or self.current_prices.get(symbol, 0)
        
        # Calculate current P&L
        if position['side'] == 'BUY':
            pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
        else:  # SELL
            pnl = (position['entry_price'] - current_price) / position['entry_price'] * 100
        
        # Update highest profit for trailing stop
        if pnl > position['highest_profit']:
            position['highest_profit'] = pnl
            
        # STOP LOSS: Hard stop at -0.5%
        if pnl <= -self.max_risk_pct:
            return True, "Stop loss triggered"
            
        # QUICK PROFIT: Take 0.3% profit quickly
        if pnl >= self.quick_profit_target:
            return True, "Quick profit target reached"
            
        # TRAILING STOP: Activate after 0.2% profit
        if pnl >= self.trailing_stop_trigger:
            position['trailing_stop_active'] = True
            
        # TRAILING STOP LOGIC: Exit if profit drops by 0.15% from highest
        if position['trailing_stop_active'] and position['highest_profit'] > 0:
            trailing_stop_level = position['highest_profit'] - 0.15
            if pnl <= trailing_stop_level:
                return True, f"Trailing stop triggered (was {position['highest_profit']:.2f}%, now {pnl:.2f}%)"
                
        return False, ""

    def create_daily_trades_summary(self):
        """Create a beautiful daily trades summary table"""
        if not self.daily_trades:
            return "No trades executed today."
        
        # Calculate summary statistics
        total_trades = len(self.daily_trades)
        winning_trades = [t for t in self.daily_trades if t['pnl_pct'] > 0]
        losing_trades = [t for t in self.daily_trades if t['pnl_pct'] < 0]
        
        win_rate = len(winning_trades) / total_trades * 100 if total_trades > 0 else 0
        total_pnl_amount = sum(t['pnl_amount'] for t in self.daily_trades)
        avg_trade_duration = sum(t['duration'].total_seconds() for t in self.daily_trades) / total_trades / 60  # in minutes
        
        # Create beautiful table
        today = datetime.now().strftime("%d%B%Y")
        summary = f"""
{'='*100}
📊 DAILY TRADES SUMMARY - {today}
{'='*100}

📈 PERFORMANCE METRICS:
   Total Trades: {total_trades}
   Winning Trades: {len(winning_trades)} ({win_rate:.1f}%)
   Losing Trades: {len(losing_trades)} ({100-win_rate:.1f}%)
   Total P&L: ₹{total_pnl_amount:,.2f}
   Average Duration: {avg_trade_duration:.1f} minutes

{'='*100}
🎯 INDIVIDUAL TRADES:
{'='*100}
{'ID':<3} {'Symbol':<12} {'Side':<4} {'Entry':<10} {'Exit':<10} {'Qty':<5} {'P&L%':<8} {'P&L₹':<10} {'Duration':<10} {'Reason':<25}
{'-'*100}
"""
        
        for trade in self.daily_trades:
            duration_str = f"{int(trade['duration'].total_seconds()/60)}m{int(trade['duration'].total_seconds()%60)}s"
            pnl_color = "🟢" if trade['pnl_pct'] > 0 else "🔴"
            
            summary += f"{trade['id']:<3} {trade['symbol']:<12} {trade['side']:<4} "
            summary += f"₹{trade['entry_price']:<9.2f} ₹{trade['exit_price']:<9.2f} "
            summary += f"{trade['qty']:<5} {pnl_color}{trade['pnl_pct']:>+6.2f}% "
            summary += f"₹{trade['pnl_amount']:>+8.2f} {duration_str:<10} "
            summary += f"{trade['reason']:<25}\n"
        
        summary += f"\n{'-'*100}\n"
        summary += f"💰 NET P&L: ₹{total_pnl_amount:+,.2f} | Win Rate: {win_rate:.1f}%\n"
        summary += f"{'='*100}\n"
        
        return summary

    def save_daily_summary(self):
        """Save daily summary to a dated file"""
        try:
            today = datetime.now().strftime("%d%B%Y")
            filename = f"{today}_trades.log"
            summary = self.create_daily_trades_summary()
            
            with open(filename, 'w') as f:
                f.write(summary)
            
            print(f"\n📄 Daily summary saved to: {filename}")
            print(summary)
            
        except Exception as e:
            print(f"Error saving daily summary: {e}")

    def run_strategy(self):
        """Main strategy loop with REAL-TIME WebSocket integration and OBSERVATION PERIOD"""
        self.running = True
        symbols_str = ", ".join(self.trading_symbols)
        self.log_colored(f"🚀 Starting Enhanced Multi-Symbol Upstox Paper Trading Bot for {symbols_str} on {self.timeframe} timeframe!", "success")
        
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
                    
                    # Wait for initial real-time prices
                    wait_count = 0
                    received_prices = set()
                    while len(received_prices) < len(self.trading_symbols) and wait_count < 30:
                        for symbol in self.trading_symbols:
                            if self.real_time_prices.get(symbol, 0) > 0:
                                received_prices.add(symbol)
                        time.sleep(0.5)
                        wait_count += 1
                    
                    if received_prices:
                        for symbol in received_prices:
                            price = self.real_time_prices[symbol]
                            self.log_colored(f"📡 {symbol} initial real-time price: ₹{price:.2f}", "success")
                            self.current_prices[symbol] = price
                except Exception as e:
                    self.log_colored(f"WebSocket connection failed: {str(e)}", "error")
                    websocket_connected = False
        
        # Identify initial levels for all symbols (for display only, not immediate trading)
        for symbol in self.trading_symbols:
            if self.candle_data.get(symbol):
                self.identify_support_resistance_levels(symbol)
                self.calculate_trend_direction(symbol)
        
        self.log_colored(f"📊 Data Source: {'🟢 Real-time WebSocket + Historical' if websocket_connected else '🔴 Historical only'}", "info")
        
        # OBSERVATION PERIOD - Wait before trading
        self.log_colored(f"👀 OBSERVATION PERIOD: Monitoring market for {self.observation_period} seconds before trading...", "warning")
        
        observation_start = time.time()
        price_updates_received = 0
        
        while time.time() - observation_start < self.observation_period:
            # Update real-time price tracking during observation for all symbols
            if websocket_connected:
                for symbol in self.trading_symbols:
                    if (self.real_time_prices.get(symbol, 0) > 0 and 
                        self.real_time_prices[symbol] != self.current_prices.get(symbol, 0)):
                        price_updates_received += 1
                        self.current_prices[symbol] = self.real_time_prices[symbol]
                        
                        # Show we're receiving live data
                        if price_updates_received % 20 == 0:
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
                
                # Update historical data every 5 minutes for all symbols
                if current_time - last_data_update > 300:
                    if self.get_candles():
                        for symbol in self.trading_symbols:
                            if self.candle_data.get(symbol):
                                self.identify_support_resistance_levels(symbol)
                                self.calculate_trend_direction(symbol)
                        last_data_update = current_time
                
                # Position management for all symbols
                for symbol in self.trading_symbols:
                    if self.positions.get(symbol):
                        should_close, reason = self.should_close_position(symbol)
                        if should_close:
                            self.close_position(symbol, reason)
                        elif not websocket_connected:  # Only log periodically if no real-time updates
                            if time.time() - self.last_profit_check > 10:
                                position = self.positions[symbol]
                                current_price = self.current_prices.get(symbol, 0)
                                pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
                                if position['side'] == 'SELL': pnl *= -1
                                self.log_colored(f"💰 {symbol} P&L: {pnl:.2f}% (Historical)", "profit" if pnl > 0 else "loss")
                                self.last_profit_check = time.time()
                
                # Check for new signals for all symbols (only if no position and not too frequent)
                if current_time - last_signal_check > self.signal_check_interval:
                    for symbol in self.trading_symbols:
                        if not self.positions.get(symbol):  # Only check signals if no position for this symbol
                            signals = self.check_support_resistance_signals(symbol)
                            if signals:
                                side, reason, confidence, level = signals[0]
                                if confidence >= self.min_confidence_threshold:
                                    self.log_colored(f"🚨 {symbol} HIGH CONFIDENCE SIGNAL: {reason} (confidence: {confidence:.1%})", "success")
                                    if self.execute_trade(symbol, side, reason, level, confidence):
                                        current_price = self.current_prices.get(symbol, 0)
                                        self.log_colored(f"✅ {symbol} Trade executed: {side} @ ₹{current_price:.2f}", "trade")
                    
                    last_signal_check = current_time
                
                # Status update every 2 minutes when no positions
                elif int(current_time) % 120 == 0:
                    data_source = "🟢 Real-time" if websocket_connected else "🔴 Historical"
                    
                    for symbol in self.trading_symbols:
                        if not self.positions.get(symbol):  # Only show status if no position
                            nearest_support, nearest_resistance = self.find_nearest_levels(symbol)
                            current_price = self.current_prices.get(symbol, 0)
                            trend_direction = self.trend_directions.get(symbol, "NEUTRAL")
                            
                            status_parts = []
                            if trend_direction:
                                status_parts.append(f"Trend: {trend_direction}")
                            if nearest_support:
                                support_dist = ((current_price - nearest_support) / nearest_support) * 100
                                status_parts.append(f"Support: ₹{nearest_support:,.2f} ({support_dist:+.2f}%)")
                            if nearest_resistance:
                                resistance_dist = ((nearest_resistance - current_price) / current_price) * 100
                                status_parts.append(f"Resistance: ₹{nearest_resistance:,.2f} (+{resistance_dist:.2f}%)")
                            
                            status = " | ".join(status_parts) if status_parts else "No levels detected"
                            self.log_colored(f"🔍 {symbol} | Price: ₹{current_price:,.2f} ({data_source}) | {status}", "info")
                
                time.sleep(2)  # Main loop delay
                
        except KeyboardInterrupt:
            self.log_colored("🛑 Bot stopped by user.", "warning")
            # Close all open positions on manual stop
            for symbol in self.trading_symbols:
                if self.positions.get(symbol):
                    self.close_position(symbol, "Manual stop")
            
            # Generate and save daily summary
            self.save_daily_summary()
        finally:
            self.running = False
            if hasattr(self, 'market_streamer') and self.market_streamer:
                try:
                    self.market_streamer.disconnect()
                    self.log_colored("🔌 WebSocket connection closed", "info")
                except:
                    pass

def run_upstox_paper_trading_bot(symbols, timeframe: str):
    """Run the Enhanced Upstox paper trading bot with real-time WebSocket support for multiple symbols"""
    # Handle single symbol or list of symbols
    if isinstance(symbols, str):
        symbols = [symbols]
    
    # --- Setup Dynamic Logger ---
    # Use shortened filename for large symbol lists (like Nifty 50)
    if len(symbols) > 10:
        symbols_str = f"NIFTY50_{len(symbols)}stocks"
    else:
        symbols_str = "_".join(symbols)
    log_filename = f"upstox_paper_trades_{symbols_str}_{timeframe}.log"
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
    # Create user-friendly display for symbols
    if len(symbols) > 10:
        symbols_display = f"Nifty 50 ({len(symbols)} stocks)"
    elif len(symbols) > 5:
        symbols_display = f"{', '.join(symbols[:3])}, ... +{len(symbols)-3} more"
    else:
        symbols_display = ", ".join(symbols)
    
    print(f"""
{Colors.BOLD}{Colors.BLUE}📊 ENHANCED MULTI-SYMBOL UPSTOX PAPER TRADING BOT{Colors.RESET}
{Colors.BLUE}{'=' * 70}{Colors.RESET}
{Colors.CYAN}Symbols: {symbols_display} | Timeframe: {timeframe}{Colors.RESET}
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
{Colors.GREEN}✅ Independent positions per symbol{Colors.RESET}
{Colors.GREEN}✅ Single WebSocket for all symbols{Colors.RESET}
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
        symbols=symbols,
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
    parser.add_argument("--symbols", type=str, nargs="+", default=["TATAMOTORS"], help="Stock symbols to trade (e.g., TATAMOTORS RELIANCE INFY).")
    parser.add_argument("--nifty50", action="store_true", help="Use all Nifty 50 stocks (overrides --symbols).")
    parser.add_argument("--timeframe", type=str, default="15min", help="Candlestick timeframe (e.g., '5min', '15min', '1H').")
    
    args = parser.parse_args()
    
    # Determine which symbols to use
    if args.nifty50:
        symbols = fetch_nifty50_stocks()
        print(f"🎯 Using Nifty 50 stocks: {len(symbols)} symbols")
    else:
        symbols = args.symbols
        print(f"🎯 Using custom stocks: {', '.join(symbols)}")
    
    run_upstox_paper_trading_bot(symbols=symbols, timeframe=args.timeframe)


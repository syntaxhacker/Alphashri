#!/usr/bin/env python3
"""
Standalone Support & Resistance Trading Bot for Upstox - 15min Timeframe
- Uses the Upstox API via the free_indian_apis.py wrapper
- Identifies key support and resistance levels
- Trades bounces off these levels
- Uses 15-minute candlesticks for better signals
- Includes risk management with proper S&L levels
"""

import time
import numpy as np
import pandas as pd
import threading
from datetime import datetime, timedelta
import os
import logging
import re
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

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

# Logging setup
log_formatter = logging.Formatter('%(message)s')
log_handler = logging.FileHandler('upstox_trades.log', mode='w')
log_handler.setFormatter(log_formatter)
logger = logging.getLogger('upstox_trade_logger')
logger.addHandler(log_handler)
logger.setLevel(logging.INFO)

def strip_ansi_codes(text):
    """Removes ANSI color codes from a string."""
    return re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)

class UpstoxSupportResistanceBot:
    """Simple Support & Resistance Trading Bot for Upstox"""
    
    def __init__(self, api_key, api_secret, symbol="TATAMOTORS"):
        # API Setup
        self.client = UpstoxAPI(api_key=api_key, api_secret=api_secret)
        self.trading_symbol = symbol
        
        # SUPPORT/RESISTANCE SETTINGS
        self.lookback_periods = 50
        self.min_touches = 2
        self.level_threshold = 0.5
        self.bounce_threshold = 0.25
        self.max_entry_distance = 0.15
        
        # RISK MANAGEMENT
        self.risk_reward_ratio = 2.5
        self.max_risk_pct = 1.5
        
        # Position tracking
        self.in_position = False
        self.position_side = None
        self.position_entry_price = 0.0
        self.position_start_time = None
        self.highest_profit = 0.0
        self.actual_position_size = 0
        self.entry_reason = ""
        
        # Strategy state
        self.support_levels = []
        self.resistance_levels = []
        self.last_level_update = 0
        self.trade_count = 0
        self.session_trades = []
        self.total_pnl = 0.0
        
        # 15min candle data
        self.candle_data = []
        self.last_candle_time = 0
        
        # SIGNAL DEDUPLICATION
        self.last_signal_time = {}
        self.signal_cooldown = 1200
        
        # TREND FILTER
        self.trend_ema_period = 20
        self.trend_direction = None
        self.trend_ema = 0.0
        
        # Price tracking
        self.current_price = 0.0
        
        self.running = False

    def log_colored(self, message, level="info"):
        """Enhanced colored logging that also writes to a file."""
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
            
        logger.info(strip_ansi_codes(message))

    def get_15min_candles(self):
        """Fetch 15-minute candlestick data from Upstox"""
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d") # Fetch 2 days of 15-min data
        
        df = self.client.fetch_historical_data(
            symbol=self.trading_symbol,
            interval='15minute',
            from_date=from_date,
            to_date=to_date
        )
        
        if df is not None and not df.empty:
            self.candle_data = [
                {
                    'timestamp': int(row.name.timestamp() * 1000),
                    'open': row['open'],
                    'high': row['high'],
                    'low': row['low'],
                    'close': row['close'],
                    'volume': row['volume']
                } for _, row in df.iterrows()
            ]
            self.current_price = self.candle_data[-1]['close'] if self.candle_data else 0
            self.log_colored(f"✅ Successfully fetched {len(self.candle_data)} 15min candles for {self.trading_symbol}", "success")
            return True
        else:
            self.log_colored(f"⚠️  Could not fetch 15min candle data for {self.trading_symbol}", "warning")
            return False

    def identify_support_resistance_levels(self):
        """Identify support and resistance levels from candlestick data"""
        if len(self.candle_data) < self.lookback_periods:
            return
        
        highs = [candle['high'] for candle in self.candle_data[-self.lookback_periods:]]
        lows = [candle['low'] for candle in self.candle_data[-self.lookback_periods:]]
        
        resistance_candidates = [high for i, high in enumerate(highs) if i > 1 and i < len(highs) - 2 and high > highs[i-1] and high > highs[i-2] and high > highs[i+1] and high > highs[i+2]]
        support_candidates = [low for i, low in enumerate(lows) if i > 1 and i < len(lows) - 2 and low < lows[i-1] and low < lows[i-2] and low < lows[i+1] and low < lows[i+2]]
        
        self.resistance_levels = self._group_levels(resistance_candidates)
        self.support_levels = self._group_levels(support_candidates)
        
        self.resistance_levels = self._filter_by_touches(self.resistance_levels, highs)
        self.support_levels = self._filter_by_touches(self.support_levels, lows)
        
        self.resistance_levels.sort(reverse=True)
        self.support_levels.sort(reverse=True)
        
        self.log_colored(f"S&R Update: {len(self.support_levels)} Support, {len(self.resistance_levels)} Resistance levels found", "level")

    def _group_levels(self, levels):
        if not levels:
            return []
        
        grouped = []
        levels.sort()
        
        current_group = [levels[0]]
        
        for level in levels[1:]:
            if abs(level - current_group[0]) / current_group[0] * 100 < self.level_threshold:
                current_group.append(level)
            else:
                grouped.append(sum(current_group) / len(current_group))
                current_group = [level]
        
        grouped.append(sum(current_group) / len(current_group))
        return grouped

    def _filter_by_touches(self, levels, price_data):
        filtered_levels = []
        for level in levels:
            touches = sum(1 for price in price_data if abs(price - level) / level * 100 < self.level_threshold)
            if touches >= self.min_touches:
                filtered_levels.append(level)
        return filtered_levels

    def calculate_trend_direction(self):
        if len(self.candle_data) < self.trend_ema_period:
            self.trend_direction = None
            return
        
        closes = [candle['close'] for candle in self.candle_data[-self.trend_ema_period:]]
        self.trend_ema = pd.Series(closes).ewm(span=self.trend_ema_period, adjust=False).mean().iloc[-1]
        
        if self.current_price > self.trend_ema * 1.002:
            self.trend_direction = "BULLISH"
        elif self.current_price < self.trend_ema * 0.998:
            self.trend_direction = "BEARISH"
        else:
            self.trend_direction = "NEUTRAL"
        
        self.log_colored(f"📈 Trend: {self.trend_direction} | EMA: {self.trend_ema:,.2f} | Price: {self.current_price:,.2f}", "level")

    def find_nearest_levels(self):
        nearest_support = max([level for level in self.support_levels if level < self.current_price] or [None])
        nearest_resistance = min([level for level in self.resistance_levels if level > self.current_price] or [None])
        return nearest_support, nearest_resistance

    def check_support_resistance_signals(self):
        if self.in_position:
            return []

        signals = []
        nearest_support, nearest_resistance = self.find_nearest_levels()

        if nearest_support and self.trend_direction in ["BULLISH", "NEUTRAL"]:
            distance_to_support = (self.current_price - nearest_support) / nearest_support * 100
            if 0 < distance_to_support <= self.bounce_threshold:
                signals.append(('BUY', 'support_bounce', 0.8, nearest_support, f"support_{nearest_support:.2f}"))

        if nearest_resistance and self.trend_direction in ["BEARISH", "NEUTRAL"]:
            distance_to_resistance = (nearest_resistance - self.current_price) / self.current_price * 100
            if 0 < distance_to_resistance <= self.bounce_threshold:
                signals.append(('SELL', 'resistance_rejection', 0.8, nearest_resistance, f"resistance_{nearest_resistance:.2f}"))

        return signals

    def execute_trade(self, side, reason, level, confidence):
        self.log_colored(f"Executing {side} trade based on {reason} at level {level} with confidence {confidence}", "trade")
        
        # For Upstox, we can't do leverage in the same way. We'll trade with a fixed quantity for now.
        quantity = 1 # Example: trade 1 share
        
        order_result = self.client.place_order(
            symbol=self.trading_symbol,
            transaction_type=side,
            quantity=quantity
        )

        if order_result and order_result.get('status') == 'success':
            self.in_position = True
            self.position_side = side
            self.position_entry_price = self.current_price
            self.position_start_time = time.time()
            self.actual_position_size = quantity if side == 'BUY' else -quantity
            self.entry_reason = reason
            self.log_colored(f"✅ Trade executed successfully: {side} {quantity} {self.trading_symbol}", "success")
            return True
        else:
            self.log_colored(f"❌ Trade execution failed.", "error")
            return False

    def close_position(self, reason):
        if not self.in_position:
            return

        side_to_close = 'SELL' if self.position_side == 'BUY' else 'BUY'
        quantity_to_close = abs(self.actual_position_size)

        order_result = self.client.place_order(
            symbol=self.trading_symbol,
            transaction_type=side_to_close,
            quantity=quantity_to_close
        )
        
        if order_result and order_result.get('status') == 'success':
            pnl = (self.current_price - self.position_entry_price) / self.position_entry_price * 100
            if self.position_side == 'SELL':
                pnl *= -1
            
            self.log_colored(f"✅ Position closed due to {reason}. P&L: {pnl:.2f}%", "profit" if pnl > 0 else "loss")
            self.in_position = False
            self.position_side = None
            self.position_entry_price = 0.0
            self.position_start_time = None
            self.actual_position_size = 0
        else:
            self.log_colored("❌ Failed to close position.", "error")

    def should_close_position(self):
        if not self.in_position:
            return False, ""
            
        pnl = (self.current_price - self.position_entry_price) / self.position_entry_price * 100
        if self.position_side == 'SELL':
            pnl *= -1

        if pnl >= self.max_risk_pct * self.risk_reward_ratio:
            return True, "Profit target reached"
        if pnl <= -self.max_risk_pct:
            return True, "Stop loss triggered"
            
        return False, ""

    def run_strategy(self):
        """Main strategy loop"""
        self.running = True
        
        self.log_colored(f"🚀 Starting Upstox Support & Resistance Bot for {self.trading_symbol}!", "success")
        
        if not self.client.access_token and not self.client.authenticate():
            self.log_colored("Authentication failed. Exiting.", "error")
            return

        if not self.get_15min_candles():
            self.log_colored("Failed to get initial candle data. Exiting.", "error")
            return
        
        try:
            while self.running:
                current_time = time.time()
                
                if current_time - self.last_candle_time > 900: # 15 minutes
                    self.get_15min_candles()
                    self.last_candle_time = current_time

                if current_time - self.last_level_update > 300: # 5 minutes
                    self.identify_support_resistance_levels()
                    self.calculate_trend_direction()
                    self.last_level_update = current_time

                if self.in_position:
                    should_close, reason = self.should_close_position()
                    if should_close:
                        self.close_position(reason)
                else:
                    signals = self.check_support_resistance_signals()
                    if signals:
                        side, reason, confidence, level, _ = signals[0]
                        self.execute_trade(side, reason, level, confidence)
                
                time.sleep(5)
        except KeyboardInterrupt:
            self.log_colored("🛑 Bot stopped by user.", "warning")
            if self.in_position:
                self.close_position("Manual stop")
        finally:
            self.running = False

def run_upstox_support_resistance_bot():
    """Run the Upstox support & resistance trading bot"""
    os.system('clear' if os.name == 'posix' else 'cls')
    
    print(f"""
{Colors.BOLD}{Colors.BLUE}📊 UPSTOX SUPPORT & RESISTANCE BOT{Colors.RESET}
{Colors.BLUE}{'=' * 55}{Colors.RESET}
{Colors.GREEN}📈 Timeframe: 15 minutes{Colors.RESET}
    """)
    
    bot = UpstoxSupportResistanceBot(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret'],
        symbol="TATAMOTORS"
    )
    
    try:
        bot.run_strategy()
    except Exception as e:
        print(f"\n{Colors.RED}❌ Error: {e}{Colors.RESET}")

if __name__ == "__main__":
    run_upstox_support_resistance_bot()

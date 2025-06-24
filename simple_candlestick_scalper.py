#!/usr/bin/env python3
"""
SIMPLE Candlestick Engulfing Scalper

Strategy:
1. Detect momentum: 2-3 candles in same direction (green or red)
2. Wait for opposite engulfing candle (reversal signal)
3. Take trade in direction of engulfing candle
4. Use tight stops and profit targets

This is much simpler than complex indicators!
"""

import time
from datetime import datetime
from trading.enhanced_live_trader import EnhancedBinanceTrader
from config import BINANCE_API_CONFIG
import os

class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    BG_GREEN = '\033[102m'
    BG_RED = '\033[101m'

class SimpleCandlestickScalper(EnhancedBinanceTrader):
    """Simple scalper using candlestick patterns only"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        
        # Simple settings
        self.leverage = 100
        self.profit_target = 0.30  # 0.30% profit target
        self.stop_loss = 1.00      # 1.00% stop loss
        self.position_size = 1.0   # 1 BTC position size
        
        # Candlestick tracking
        self.candles = []
        self.current_candle = None
        self.last_candle_time = 0
        
        # Position tracking
        self.current_position = 0.0
        self.position_entry_price = 0.0
        self.position_entry_time = 0
        self.highest_profit = 0.0
        
        # Stats
        self.trade_count = 0
        self.total_pnl = 0.0
    
    def log_message(self, message, color=Colors.WHITE):
        """Simple colored logging"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"{color}[{timestamp}] {message}{Colors.RESET}")
    
    def update_candle_data(self, price):
        """Update 1-minute candlestick data"""
        current_time = time.time()
        candle_minute = int(current_time // 60) * 60  # Round to minute
        
        # Start new candle if minute changed
        if candle_minute != self.last_candle_time:
            # Save previous candle if it exists
            if self.current_candle:
                self.candles.append(self.current_candle)
                self.log_message(f"🕯️  Candle: O:{self.current_candle['open']:.2f} H:{self.current_candle['high']:.2f} L:{self.current_candle['low']:.2f} C:{self.current_candle['close']:.2f} {'🟢' if self.current_candle['is_green'] else '🔴'}")
                
                # Keep only last 10 candles
                if len(self.candles) > 10:
                    self.candles = self.candles[-10:]
                
                # Check for trading pattern
                self.check_for_pattern()
            
            # Start new candle
            self.last_candle_time = candle_minute
            self.current_candle = {
                'open': price,
                'high': price,
                'low': price,
                'close': price,
                'time': candle_minute,
                'is_green': True  # Will be updated
            }
        else:
            # Update current candle
            if self.current_candle:
                self.current_candle['high'] = max(self.current_candle['high'], price)
                self.current_candle['low'] = min(self.current_candle['low'], price)
                self.current_candle['close'] = price
                self.current_candle['is_green'] = price > self.current_candle['open']
    
    def check_for_pattern(self):
        """Check for momentum + engulfing pattern"""
        if len(self.candles) < 4:  # Need at least 4 candles
            return
        
        # Don't trade if we have a position
        if self.current_position != 0:
            return
        
        # Get last 3 candles for momentum check
        last_3 = self.candles[-3:]
        current_candle = self.candles[-1]
        previous_candle = self.candles[-2]
        
        # Check for 3-candle momentum
        all_green = all(candle['is_green'] for candle in last_3)
        all_red = all(not candle['is_green'] for candle in last_3)
        
        if not (all_green or all_red):
            return  # No clear momentum
        
        # Calculate momentum strength
        momentum_start = last_3[0]['open']
        momentum_end = last_3[-1]['close']
        momentum_pct = abs((momentum_end - momentum_start) / momentum_start) * 100
        
        # Need minimum momentum
        if momentum_pct < 0.05:  # 0.05% minimum
            return
        
        # Check for engulfing pattern (current candle vs previous)
        current_body = abs(current_candle['close'] - current_candle['open'])
        previous_body = abs(previous_candle['close'] - previous_candle['open'])
        
        # Engulfing conditions
        is_bullish_engulfing = (
            current_candle['is_green'] and  # Current is green
            not previous_candle['is_green'] and  # Previous is red
            current_candle['open'] <= previous_candle['close'] and  # Opens below/at previous close
            current_candle['close'] >= previous_candle['open'] and  # Closes above/at previous open
            current_body > previous_body * 1.2  # Body is 20% bigger
        )
        
        is_bearish_engulfing = (
            not current_candle['is_green'] and  # Current is red
            previous_candle['is_green'] and  # Previous is green
            current_candle['open'] >= previous_candle['close'] and  # Opens above/at previous close
            current_candle['close'] <= previous_candle['open'] and  # Closes below/at previous open
            current_body > previous_body * 1.2  # Body is 20% bigger
        )
        
        # Trade logic: Momentum + Opposite Engulfing = Reversal Signal
        if all_green and is_bearish_engulfing:
            # Green momentum + bearish engulfing = SELL
            self.log_message(f"🔻 SELL SIGNAL: Green momentum ({momentum_pct:.2f}%) + Bearish Engulfing", Colors.RED)
            self.execute_trade("SELL")
            
        elif all_red and is_bullish_engulfing:
            # Red momentum + bullish engulfing = BUY  
            self.log_message(f"🔺 BUY SIGNAL: Red momentum ({momentum_pct:.2f}%) + Bullish Engulfing", Colors.GREEN)
            self.execute_trade("BUY")

if __name__ == "__main__":
    print("🕯️ Simple Candlestick Scalper")
    print("Strategy: 3-Candle Momentum + Engulfing Reversal")
    print("Much simpler than complex indicators!")

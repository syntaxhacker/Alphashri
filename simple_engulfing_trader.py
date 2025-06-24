#!/usr/bin/env python3
"""
🕯️ SIMPLE ENGULFING PATTERN TRADER

Your exact strategy:
1. Check last 2-3 candles for momentum (all green or all red)  
2. Wait for opposite engulfing candle (reversal signal)
3. Take trade in direction of engulfing candle

Much simpler than complex indicators!
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
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    BG_GREEN = '\033[102m'

class SimpleEngulfingTrader(EnhancedBinanceTrader):
    """Simple trader using only candlestick patterns"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        
        # Simple settings
        self.leverage = 100
        self.profit_target = 0.40  # 0.40% profit
        self.stop_loss = 1.00      # 1.00% stop
        self.position_size = 1.0   # 1 BTC
        
        # Your pattern settings
        self.momentum_candles = 3  # Check last 3 candles
        self.min_momentum = 0.08   # 0.08% minimum momentum
        self.engulf_ratio = 1.3    # 30% bigger engulfing body
        
        # Tracking
        self.candles = []
        self.current_candle = None
        self.last_candle_time = 0
        self.current_position = 0.0
        self.position_entry_price = 0.0
        self.trade_count = 0
    
    def log(self, message, color=Colors.WHITE):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"{color}[{timestamp}] {message}{Colors.RESET}")
    
    def update_candles(self, price):
        """Build 1-minute candlesticks"""
        current_time = time.time()
        candle_minute = int(current_time // 60) * 60
        
        # New candle
        if candle_minute != self.last_candle_time:
            if self.current_candle:
                self.candles.append(self.current_candle)
                c = self.current_candle
                emoji = "🟢" if c['is_green'] else "🔴"
                self.log(f"{emoji} O:{c['open']:.1f} H:{c['high']:.1f} L:{c['low']:.1f} C:{c['close']:.1f}")
                
                if len(self.candles) > 10:
                    self.candles = self.candles[-10:]
                
                # YOUR PATTERN CHECK
                self.check_engulfing_pattern()
            
            self.last_candle_time = candle_minute
            self.current_candle = {
                'open': price, 'high': price, 'low': price, 'close': price,
                'is_green': True
            }
        else:
            if self.current_candle:
                self.current_candle['high'] = max(self.current_candle['high'], price)
                self.current_candle['low'] = min(self.current_candle['low'], price)
                self.current_candle['close'] = price
                self.current_candle['is_green'] = price > self.current_candle['open']
    
    def check_engulfing_pattern(self):
        """YOUR EXACT LOGIC: momentum + engulfing reversal"""
        
        if len(self.candles) < 4 or self.current_position != 0:
            return
        
        # Get momentum candles
        momentum_candles = self.candles[-self.momentum_candles:]
        current_candle = self.candles[-1]
        previous_candle = self.candles[-2]
        
        # Check momentum
        all_green = all(c['is_green'] for c in momentum_candles)
        all_red = all(not c['is_green'] for c in momentum_candles)
        
        if not (all_green or all_red):
            return
        
        # Momentum strength
        start = momentum_candles[0]['open']
        end = momentum_candles[-1]['close']
        momentum_pct = abs((end - start) / start) * 100
        
        if momentum_pct < self.min_momentum:
            return
        
        # Engulfing pattern
        current_body = abs(current_candle['close'] - current_candle['open'])
        previous_body = abs(previous_candle['close'] - previous_candle['open'])
        
        # Bullish engulfing after red momentum
        if (all_red and current_candle['is_green'] and not previous_candle['is_green'] and
            current_candle['open'] <= previous_candle['close'] and
            current_candle['close'] >= previous_candle['open'] and
            current_body >= previous_body * self.engulf_ratio):
            
            self.log(f"🔺 BUY: Red momentum + Bullish Engulfing ({momentum_pct:.2f}%)", Colors.GREEN)
            self.execute_trade("BUY")
            
        # Bearish engulfing after green momentum
        elif (all_green and not current_candle['is_green'] and previous_candle['is_green'] and
              current_candle['open'] >= previous_candle['close'] and
              current_candle['close'] <= previous_candle['open'] and
              current_body >= previous_body * self.engulf_ratio):
            
            self.log(f"🔻 SELL: Green momentum + Bearish Engulfing ({momentum_pct:.2f}%)", Colors.RED)
            self.execute_trade("SELL")
    
    def execute_trade(self, side):
        """Execute trade"""
        current_price = (self.current_bid + self.current_ask) / 2
        
        try:
            if side == "BUY":
                if self.use_testnet:
                    self.client.new_order(symbol=self.trading_symbol, side='BUY', 
                                        type='MARKET', quantity=self.position_size)
                self.log(f"✅ BUY {self.position_size} BTC @ ${current_price:,.1f}", Colors.BG_GREEN)
                self.current_position = self.position_size
                
            elif side == "SELL":
                if self.use_testnet:
                    self.client.new_order(symbol=self.trading_symbol, side='SELL', 
                                        type='MARKET', quantity=self.position_size)
                self.log(f"✅ SELL {self.position_size} BTC @ ${current_price:,.1f}", Colors.RED)
                self.current_position = -self.position_size
            
            self.position_entry_price = current_price
            self.trade_count += 1
            
        except Exception as e:
            self.log(f"❌ Error: {e}", Colors.RED)

if __name__ == "__main__":
    print("🕯️ Simple Engulfing Pattern Trader")
    print("Your Logic: 3-Candle Momentum + Engulfing Reversal")
    print("Much simpler than complex indicators!")

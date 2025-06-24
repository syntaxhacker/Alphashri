#!/usr/bin/env python3
"""
SIMPLE Engulfing Pattern Scalper - Trade on candlestick reversals
- Detects when current candle closes above/below last 2-3 candles
- Waits for opposite engulfing candle
- Takes reversal trades on engulfing patterns
- 100x leverage for maximum gains
"""

import time
from datetime import datetime, timedelta
from trading.enhanced_live_trader import EnhancedBinanceTrader
from config import BINANCE_API_CONFIG
import os

# SIMPLE TRADING PARAMETERS
class SimpleScalperConfig:
    """Simple candlestick pattern trading parameters"""
    
    def __init__(self):
        # === CORE TRADING SETTINGS ===
        self.leverage = 100                    # 100x leverage for maximum gains
        self.min_profit_pct = 0.30            # 0.30% minimum profit target
        self.max_loss_pct = 1.00              # 1.00% max loss
        self.trailing_stop_pct = 0.20         # 0.20% trailing stop
        
        # === ENGULFING PATTERN SETTINGS ===
        self.momentum_candles = 3             # Check last 3 candles for momentum
        self.min_engulf_ratio = 1.2           # Current candle must be 1.2x bigger
        self.min_momentum_pct = 0.05          # 0.05% minimum momentum needed
        
        # === POSITION SIZING ===
        self.base_position_size = 1.000       # Base BTC position size
        self.min_position_size = 0.5          # Minimum BTC position size
        self.max_position_size = 3.000        # Maximum BTC position size
        
        # === TIMING CONTROLS ===
        self.candle_interval = 60             # 1-minute candles (seconds)
        self.trade_delay_seconds = 3.0        # Delay between trades
        self.position_log_interval = 5.0      # Position status logging interval
    
    def display_config(self):
        """Display current configuration"""
        print(f"""
{Colors.BOLD}{Colors.CYAN}⚙️  SIMPLE ENGULFING SCALPER{Colors.RESET}
{Colors.CYAN}{'=' * 50}{Colors.RESET}
{Colors.GREEN}📈 Strategy: Engulfing Pattern Reversal{Colors.RESET}
{Colors.YELLOW}🕯️  Pattern: {self.momentum_candles} candle momentum → Opposite engulfing{Colors.RESET}
{Colors.BLUE}📊 Engulf Ratio: {self.min_engulf_ratio}x minimum size{Colors.RESET}
{Colors.MAGENTA}🎯 Profit Target: {self.min_profit_pct}%{Colors.RESET}
{Colors.RED}🛑 Stop Loss: {self.max_loss_pct}%{Colors.RESET}
{Colors.WHITE}💰 Position Size: {self.min_position_size}-{self.max_position_size} BTC{Colors.RESET}
{Colors.GREEN}⏱️  Candle Interval: {self.candle_interval}s (1-minute){Colors.RESET}
{Colors.BG_GREEN}{Colors.BOLD}🌐 REAL BINANCE TESTNET{Colors.RESET}
        """)

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

class SimpleCandlestick:
    """Simple candlestick data structure"""
    def __init__(self, open_price, high, low, close, timestamp, volume=0):
        self.open = open_price
        self.high = high
        self.low = low
        self.close = close
        self.timestamp = timestamp
        self.volume = volume
        
        # Calculate candle properties
        self.body_size = abs(self.close - self.open)
        self.is_bullish = self.close > self.open
        self.is_bearish = self.close < self.open
        self.upper_wick = self.high - max(self.open, self.close)
        self.lower_wick = min(self.open, self.close) - self.low
        self.total_range = self.high - self.low
    
    def __str__(self):
        direction = "🟢" if self.is_bullish else "🔴"
        return f"{direction} O:{self.open:.2f} H:{self.high:.2f} L:{self.low:.2f} C:{self.close:.2f}"

class SimpleEngulfingScalper(EnhancedBinanceTrader):
    """Simple scalper that trades on engulfing candlestick patterns"""
    
    def __init__(self, config=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        
        # Use provided config or create default
        self.config = config if config else SimpleScalperConfig()
        
        # Apply configuration settings
        self.leverage = self.config.leverage
        self.min_profit_pct = self.config.min_profit_pct
        self.max_loss_pct = self.config.max_loss_pct
        self.trailing_stop_pct = self.config.trailing_stop_pct
        
        # Candlestick tracking
        self.candles = []  # Store last candles
        self.current_candle_start = 0
        self.current_candle_data = {
            'open': 0,
            'high': 0,
            'low': float('inf'),
            'volume': 0,
            'trades': 0
        }
        
        # Position tracking
        self.highest_profit = 0.0
        self.position_start_time = None
        self.last_profit_check = time.time()
        self.actual_position_size = 0.0
        self.position_side = None
        
        # Strategy state
        self.trade_count = 0
        self.session_trades = []
        self.total_pnl = 0.0
        self.profit_target_hit = False
    
    def log_colored(self, message, level="info"):
        """Enhanced colored logging"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        if level == "error":
            print(f"{Colors.RED}[{timestamp}] ❌ {message}{Colors.RESET}")
        elif level == "success":
            print(f"{Colors.GREEN}[{timestamp}] ✅ {message}{Colors.RESET}")
        elif level == "warning":
            print(f"{Colors.YELLOW}[{timestamp}] ⚠️  {message}{Colors.RESET}")
        elif level == "trade":
            print(f"{Colors.CYAN}[{timestamp}] 🚀 {message}{Colors.RESET}")
        elif level == "profit":
            print(f"{Colors.BG_GREEN}{Colors.BOLD}[{timestamp}] 💰 {message}{Colors.RESET}")
        elif level == "loss":
            print(f"{Colors.BG_RED}{Colors.BOLD}[{timestamp}] 🛑 {message}{Colors.RESET}")
        elif level == "pattern":
            print(f"{Colors.MAGENTA}[{timestamp}] 🕯️  {message}{Colors.RESET}")
        else:
            print(f"{Colors.WHITE}[{timestamp}] ℹ️  {message}{Colors.RESET}")
    
    def update_current_candle(self, price, volume=0):
        """Update current candle with new price data"""
        current_time = time.time()
        candle_start = int(current_time // self.config.candle_interval) * self.config.candle_interval
        
        # Check if we need to start a new candle
        if candle_start != self.current_candle_start:
            # Close previous candle if it exists
            if self.current_candle_start > 0 and self.current_candle_data['open'] > 0:
                closed_candle = SimpleCandlestick(
                    open_price=self.current_candle_data['open'],
                    high=self.current_candle_data['high'],
                    low=self.current_candle_data['low'],
                    close=price,  # Use current price as close
                    timestamp=self.current_candle_start,
                    volume=self.current_candle_data['volume']
                )
                
                self.candles.append(closed_candle)
                self.log_colored(f"Candle Closed: {closed_candle}", "pattern")
                
                # Keep only last 10 candles
                if len(self.candles) > 10:
                    self.candles = self.candles[-10:]
                
                # Check for trading patterns
                self.check_engulfing_patterns()
            
            # Start new candle
            self.current_candle_start = candle_start
            self.current_candle_data = {
                'open': price,
                'high': price,
                'low': price,
                'volume': volume,
                'trades': 1
            }
        else:
            # Update current candle
            self.current_candle_data['high'] = max(self.current_candle_data['high'], price)
            self.current_candle_data['low'] = min(self.current_candle_data['low'], price)
            self.current_candle_data['volume'] += volume
            self.current_candle_data['trades'] += 1
    
    def detect_momentum(self):
        """Detect if last N candles show momentum in one direction"""
        if len(self.candles) < self.config.momentum_candles + 1:
            return None, 0
        
        # Get last N candles for momentum check
        momentum_candles = self.candles[-self.config.momentum_candles:]
        
        # Check for consistent direction
        bullish_count = sum(1 for candle in momentum_candles if candle.is_bullish)
        bearish_count = sum(1 for candle in momentum_candles if candle.is_bearish)
        
        # Calculate momentum percentage
        start_price = momentum_candles[0].open
        end_price = momentum_candles[-1].close
        momentum_pct = abs((end_price - start_price) / start_price * 100)
        
        # Determine momentum direction
        if bullish_count >= self.config.momentum_candles - 1 and momentum_pct >= self.config.min_momentum_pct:
            return "BULLISH", momentum_pct
        elif bearish_count >= self.config.momentum_candles - 1 and momentum_pct >= self.config.min_momentum_pct:
            return "BEARISH", momentum_pct
        
        return None, momentum_pct
    
    def is_engulfing_pattern(self, current_candle, previous_candle):
        """Check if current candle engulfs the previous candle"""
        if not current_candle or not previous_candle:
            return False, None
        
        # Bullish engulfing: Current green candle engulfs previous red candle
        bullish_engulfing = (
            current_candle.is_bullish and 
            previous_candle.is_bearish and
            current_candle.open <= previous_candle.close and
            current_candle.close >= previous_candle.open and
            current_candle.body_size >= previous_candle.body_size * self.config.min_engulf_ratio
        )
        
        # Bearish engulfing: Current red candle engulfs previous green candle  
        bearish_engulfing = (
            current_candle.is_bearish and
            previous_candle.is_bullish and
            current_candle.open >= previous_candle.close and
            current_candle.close <= previous_candle.open and
            current_candle.body_size >= previous_candle.body_size * self.config.min_engulf_ratio
        )
        
        if bullish_engulfing:
            return True, "BULLISH_ENGULFING"
        elif bearish_engulfing:
            return True, "BEARISH_ENGULFING"
        
        return False, None
    
    def check_engulfing_patterns(self):
        """Check for engulfing patterns after momentum"""
        if len(self.candles) < self.config.momentum_candles + 2:
            return
        
        # Don't trade if we already have a position
        if self.actual_position_size != 0:
            return
        
        # Get momentum direction
        momentum_direction, momentum_pct = self.detect_momentum()
        if not momentum_direction:
            return
        
        # Get current and previous candle
        current_candle = self.candles[-1]
        previous_candle = self.candles[-2]
        
        # Check for engulfing pattern
        is_engulfing, engulfing_type = self.is_engulfing_pattern(current_candle, previous_candle)
        
        if is_engulfing:
            # Trade opposite to momentum (reversal strategy)
            if momentum_direction == "BULLISH" and engulfing_type == "BEARISH_ENGULFING":
                self.log_colored(
                    f"🔻 SELL SIGNAL: {momentum_direction} momentum ({momentum_pct:.2f}%) → {engulfing_type}", 
                    "pattern"
                )
                self.execute_pattern_trade("SELL", engulfing_type, momentum_pct)
                
            elif momentum_direction == "BEARISH" and engulfing_type == "BULLISH_ENGULFING":
                self.log_colored(
                    f"🔺 BUY SIGNAL: {momentum_direction} momentum ({momentum_pct:.2f}%) → {engulfing_type}", 
                    "pattern"
                )
                self.execute_pattern_trade("BUY", engulfing_type, momentum_pct)
    
    def execute_pattern_trade(self, side, pattern_type, momentum_pct):
        """Execute trade based on engulfing pattern"""
        # Position size based on momentum strength
        confidence = min(momentum_pct / 0.5, 1.0)  # 0.5% momentum = 100% confidence
        trade_size = self.config.base_position_size * (0.5 + confidence * 0.5)  # 0.5x to 1.0x base size
        trade_size = max(trade_size, self.config.min_position_size)
        trade_size = min(trade_size, self.config.max_position_size)
        trade_size = round(trade_size, 3)
        
        if self.execute_trade(side, trade_size):
            self.position_start_time = time.time()
            self.highest_profit = 0.0
            self.trade_count += 1
            
            self.log_colored(
                f"🚀 {side} {trade_size} BTC | Pattern: {pattern_type} | Momentum: {momentum_pct:.2f}% | Confidence: {confidence*100:.1f}%",
                "trade"
            )

def run_simple_engulfing_scalper():
    """Run the simple engulfing scalper with configurable parameters"""
    
    # Clear terminal and show colorful header
    os.system('clear' if os.name == 'posix' else 'cls')
    
    # Create configuration (customize as needed)
    config = SimpleScalperConfig()
    
    # === OPTIONAL: CUSTOMIZE CONFIGURATION HERE ===
    # config.min_profit_pct = 0.50          # Higher profit target
    # config.max_loss_pct = 0.80            # Tighter stop loss  
    # config.base_position_size = 0.800     # Smaller position size
    # config.trade_delay_seconds = 1.0      # Faster trading
    # config.min_confidence = 0.20          # Lower confidence threshold
    
    # Display current configuration
    config.display_config()
    
    # Get real testnet credentials
    testnet_config = BINANCE_API_CONFIG['testnet']
    
    # Create scalper instance with configuration
    scalper = SimpleEngulfingScalper(
        api_key=testnet_config['api_key'],
        api_secret=testnet_config['api_secret'], 
        use_testnet=True,
        leverage=config.leverage
    )
    
    try:
        scalper.run(
            symbol="BTCUSDT",
            strategy=None,
            balance=100000,
            interval='1m'
        )
    except KeyboardInterrupt:
        print(f"\n{Colors.RED}🛑 Simple engulfing scalper stopped{Colors.RESET}")
        if scalper.actual_position_size != 0:
            scalper.close_position("Manual Stop")
        
        # Show session summary
        print(f"""
{Colors.BOLD}{Colors.CYAN}📊 SESSION SUMMARY{Colors.RESET}
{Colors.CYAN}{'=' * 30}{Colors.RESET}
{Colors.WHITE}Total Trades: {len(scalper.session_trades)}{Colors.RESET}
{Colors.GREEN if scalper.total_pnl > 0 else Colors.RED}Total P&L: {scalper.total_pnl:+.3f}%{Colors.RESET}
        """)
    except Exception as e:
        print(f"\n{Colors.RED}❌ Error: {e}{Colors.RESET}")

def create_custom_config_example():
    """Example function showing how to create custom configurations"""
    
    # CONSERVATIVE CONFIGURATION
    conservative = SimpleScalperConfig()
    conservative.min_profit_pct = 0.50        # Higher profit target
    conservative.max_loss_pct = 0.80          # Tighter stop loss
    conservative.base_position_size = 0.300   # Smaller positions
    conservative.trade_delay_seconds = 10.0   # Slower trading
    conservative.min_confidence = 0.40        # Higher confidence needed
    
    # ULTRA AGGRESSIVE CONFIGURATION  
    ultra_aggressive = SimpleScalperConfig()
    ultra_aggressive.min_profit_pct = 0.15    # Lower profit target
    ultra_aggressive.max_loss_pct = 1.50      # Wider stop loss
    ultra_aggressive.base_position_size = 2.0 # Bigger positions
    ultra_aggressive.trade_delay_seconds = 1.0 # Very fast trading
    ultra_aggressive.min_confidence = 0.15    # Lower confidence needed
    
    # BALANCED CONFIGURATION (default is already balanced)
    balanced = SimpleScalperConfig()  # Uses defaults
    
    return conservative, ultra_aggressive, balanced

if __name__ == "__main__":
    run_simple_engulfing_scalper() 
#!/usr/bin/env python3
"""
AGGRESSIVE Profit Scalper - Trades in any market condition
- Much lower thresholds
- Trades on tiny movements
- Focus on 0.30% profits with trailing stops
- 100x leverage for maximum gains
- Let profits run system
"""

import time
from datetime import datetime, timedelta
from trading.enhanced_live_trader import EnhancedBinanceTrader
from config import BINANCE_API_CONFIG
import os

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

class AggressiveProfitScalper(EnhancedBinanceTrader):
    """Ultra aggressive scalper that trades on any signal"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        
        # LEVERAGE SETTING - CENTRALIZED
        self.leverage = 100  # 100x leverage for maximum gains
        
        # HIGH PROFIT AGGRESSIVE settings
        self.min_profit_pct = 0.30      # 0.30% minimum profit target!
        self.max_loss_pct = 1.00        # 1.00% max loss (Binance minimum for 100x)
        self.trailing_stop_pct = 0.20   # 0.20% trailing stop (adjusted for 100x)
        self.position_timeout = 300     # Max 5 minutes per position
        
        # Position tracking - FIXED
        self.highest_profit = 0.0
        self.position_start_time = None
        self.trailing_stop_price = 0.0
        self.last_profit_check = time.time()
        self.actual_position_size = 0.0  # Track actual position
        self.position_side = None        # 'LONG' or 'SHORT'
        
        # Strategy state
        self.trend_direction = 'NEUTRAL'
        self.last_prices = []
        self.trade_count = 0
        self.session_trades = []
        self.total_pnl = 0.0
        self.profit_target_hit = False  # Track if profit target was reached
    
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
        else:
            print(f"{Colors.WHITE}[{timestamp}] ℹ️  {message}{Colors.RESET}")
    
    def execute_trade(self, side: str, size: float) -> bool:
        """FIXED: Execute trade with proper position tracking"""
        try:
            # Round size to 3 decimal places for BTC
            size = round(size, 3)
            
            # PREVENT MULTIPLE POSITIONS IN SAME DIRECTION
            if side == "BUY" and self.actual_position_size > 0:
                self.log_colored(f"⚠️  Already LONG {self.actual_position_size} BTC - Skipping BUY", "warning")
                return False
            elif side == "SELL" and self.actual_position_size < 0:
                self.log_colored(f"⚠️  Already SHORT {abs(self.actual_position_size)} BTC - Skipping SELL", "warning")
                return False
            
            if self.use_testnet:
                # REAL BINANCE TESTNET API CALLS
                try:
                    if side == "BUY":
                        order = self.client.new_order(
                            symbol=self.trading_symbol,
                            side='BUY',
                            type='MARKET',
                            quantity=size
                        )
                        # UPDATE POSITION TRACKING
                        self.actual_position_size = size
                        self.position_side = 'LONG'
                        
                    elif side == "SELL":
                        order = self.client.new_order(
                            symbol=self.trading_symbol,
                            side='SELL', 
                            type='MARKET',
                            quantity=size
                        )
                        # UPDATE POSITION TRACKING
                        self.actual_position_size = -size
                        self.position_side = 'SHORT'
                        
                    elif side == "CLOSE":
                        # Close existing position
                        if self.actual_position_size > 0:  # Close long
                            order = self.client.new_order(
                                symbol=self.trading_symbol,
                                side='SELL',
                                type='MARKET',
                                quantity=self.actual_position_size
                            )
                        elif self.actual_position_size < 0:  # Close short
                            order = self.client.new_order(
                                symbol=self.trading_symbol,
                                side='BUY',
                                type='MARKET',
                                quantity=abs(self.actual_position_size)
                            )
                        
                        # RESET POSITION
                        self.actual_position_size = 0.0
                        self.position_side = None
                    
                    # Log successful order with ACTUAL VALUES
                    order_id = order.get('orderId', 'Unknown')
                    fill_price = order.get('fills', [{}])[0].get('price', '0.00') if order.get('fills') else '0.00'
                    
                    self.log_colored(
                        f"REAL TESTNET ORDER: {side} {size} BTC @ ${float(fill_price):,.2f} (Order ID: {order_id})", 
                        "success"
                    )
                    
                    # Update internal tracking
                    current_price = (self.current_bid + self.current_ask) / 2
                    if side in ['BUY', 'SELL']:
                        self.current_position = self.actual_position_size
                        self.position_entry_price = current_price
                        self.position_entry_time = time.time()
                        self.last_trade_time = time.time()
                        
                        # Track session trades
                        self.session_trades.append({
                            'side': side,
                            'size': size,
                            'price': current_price,
                            'time': time.time(),
                            'order_id': order_id
                        })
                    
                    return True
                    
                except Exception as e:
                    self.log_colored(f"Testnet API Error: {e}", "error")
                    return False
            else:
                # Local simulation fallback
                current_price = (self.current_bid + self.current_ask) / 2
                self.current_position = size if side == "BUY" else -size if side == "SELL" else 0
                self.position_entry_price = current_price
                self.position_entry_time = time.time()
                self.last_trade_time = time.time()
                
                self.log_colored(f"SIMULATED: {side} {size} BTC @ ${current_price:,.2f}", "trade")
                return True
                
        except Exception as e:
            self.log_colored(f"Trade execution error: {e}", "error")
            return False
    
    def calculate_position_pnl(self):
        """Calculate current position P&L percentage with LEVERAGE"""
        if self.actual_position_size == 0 or self.position_entry_price == 0:
            return 0.0
        
        current_price = self.current_ask if self.actual_position_size > 0 else self.current_bid
        
        if self.actual_position_size > 0:  # Long position
            pnl_pct = ((current_price - self.position_entry_price) / self.position_entry_price) * 100
        else:  # Short position
            pnl_pct = ((self.position_entry_price - current_price) / self.position_entry_price) * 100
        
        return pnl_pct * self.leverage  # Multiply by leverage
    
    def should_close_position(self):
        """AGGRESSIVE position closing rules with FIXED position checking"""
        if self.actual_position_size == 0:
            return False, "No position"
        
        current_pnl_pct = self.calculate_position_pnl()
        current_time = time.time()
        
        # Update highest profit
        if current_pnl_pct > self.highest_profit:
            self.highest_profit = current_pnl_pct
        
        # 1. PROFIT TARGET REACHED - Activate trailing stop instead of closing
        if current_pnl_pct >= self.min_profit_pct:
            # Don't close immediately - let trailing stop handle it
            # Just log that we hit the target
            if not hasattr(self, 'profit_target_hit'):
                self.profit_target_hit = True
                self.log_colored(f"🎯 PROFIT TARGET HIT: {current_pnl_pct:.3f}% - TRAILING STOP ACTIVATED", "profit")
        
        # 2. TIGHT STOP LOSS
        if current_pnl_pct <= -self.max_loss_pct:
            return True, f"🛑 TIGHT STOP: {current_pnl_pct:.3f}%"
        
        # 3. TIME LIMIT - Close quickly (2 minutes max)
        if self.position_start_time and (current_time - self.position_start_time) > self.position_timeout:
            return True, f"⏰ TIME OUT: {current_pnl_pct:.3f}%"
        
        # 4. SMART TRAILING STOP - Let profits run!
        if hasattr(self, 'profit_target_hit') and self.profit_target_hit:
            # AGGRESSIVE trailing after profit target hit - tighter stop
            trailing_level = self.highest_profit - (self.trailing_stop_pct * 0.5)  # 50% tighter
            if current_pnl_pct <= trailing_level:
                return True, f"📉 PROFIT TRAILING STOP: {current_pnl_pct:.3f}% (peak: {self.highest_profit:.3f}%)"
        elif self.highest_profit > 0.05:  # Standard trailing before target
            trailing_level = self.highest_profit - self.trailing_stop_pct
            if current_pnl_pct <= trailing_level:
                return True, f"📉 STANDARD TRAILING: {current_pnl_pct:.3f}% (peak: {self.highest_profit:.3f}%)"
        
        # 5. DIRECTION CHANGE (close if trend reverses)
        if self.actual_position_size > 0 and self.trend_direction == 'BEARISH':
            return True, f"🔄 TREND CHANGE (BEAR): {current_pnl_pct:.3f}%"
        elif self.actual_position_size < 0 and self.trend_direction == 'BULLISH':
            return True, f"🔄 TREND CHANGE (BULL): {current_pnl_pct:.3f}%"
        
        return False, f"Hold: {current_pnl_pct:.3f}%"
    
    def get_enhanced_market_signal(self):
        """Generate ULTRA AGGRESSIVE scalping signals - FIXED to prevent duplicate positions"""
        signals = []
        
        # DON'T OPEN NEW POSITIONS IF WE ALREADY HAVE ONE
        if self.actual_position_size != 0:
            return signals
        
        # Analyze micro trend
        self.analyze_micro_trend()
        
        # 1. VOLUME SCALPING (ANY volume imbalance = signal)
        vol_imbalance = self.trade_data['volume_imbalance']
        if abs(vol_imbalance) > 0.1:  # Just 10% imbalance needed
            direction = 'BUY' if vol_imbalance > 0 else 'SELL'
            confidence = min(abs(vol_imbalance) * 2, 0.9)  # High confidence
            signals.append((direction, 'volume', confidence))
        
        # 2. ORDER FLOW MICRO SIGNALS
        ofi = self.market_indicators['order_flow_imbalance']
        if abs(ofi) > 0.05:  # Just 5% order flow imbalance
            direction = 'BUY' if ofi > 0 else 'SELL'
            confidence = min(abs(ofi) * 4, 0.8)
            signals.append((direction, 'order_flow', confidence))
        
        # 3. PRICE MOMENTUM (Very sensitive)
        if self.trend_direction == 'BULLISH':
            signals.append(('BUY', 'momentum', 0.6))
        elif self.trend_direction == 'BEARISH':
            signals.append(('SELL', 'momentum', 0.6))
        
        # 4. CONTRARIAN SCALPING (When market is too one-sided)
        if vol_imbalance < -0.9:  # Extreme sell pressure = contrarian buy
            signals.append(('BUY', 'contrarian', 0.5))
        elif vol_imbalance > 0.9:  # Extreme buy pressure = contrarian sell
            signals.append(('SELL', 'contrarian', 0.5))
        
        return signals
    
    def process_enhanced_signals(self):
        """Process signals with FIXED position management"""
        
        # Check if we should close existing position
        if self.actual_position_size != 0:
            should_close, reason = self.should_close_position()
            
            if should_close:
                self.close_position(reason)
                return
            
            # Log position status every 5 seconds with COLORS
            if time.time() - self.last_profit_check > 5:
                current_pnl = self.calculate_position_pnl()
                hold_time = time.time() - self.position_start_time if self.position_start_time else 0
                
                if current_pnl > 0:
                    self.log_colored(
                        f"Position: {Colors.GREEN}{current_pnl:.3f}%{Colors.RESET} | Best: {self.highest_profit:.3f}% | {self.position_side} {abs(self.actual_position_size):.3f} BTC | {hold_time:.0f}s", 
                        "profit"
                    )
                else:
                    self.log_colored(
                        f"Position: {Colors.RED}{current_pnl:.3f}%{Colors.RESET} | Best: {self.highest_profit:.3f}% | {self.position_side} {abs(self.actual_position_size):.3f} BTC | {hold_time:.0f}s", 
                        "loss"
                    )
                self.last_profit_check = time.time()
            
            return  # Don't open new positions while holding
        
        # Check for new position entry (very permissive)
        if not self.should_trade():
            return
            
        market_signals = self.get_enhanced_market_signal()
        signal_score = self.calculate_combined_signal(None, market_signals)
        
        # VERY LOW THRESHOLD - Trade on 25% confidence!
        if signal_score['action'] and signal_score['confidence'] > 0.25:
            self.execute_enhanced_trade(signal_score)
    
    def close_position(self, reason):
        """Close current position and track performance with COLORS"""
        if self.actual_position_size == 0:
            return
        
        try:
            position_size = abs(self.actual_position_size)
            final_pnl = self.calculate_position_pnl()
            
            if self.execute_trade("CLOSE", position_size):
                if final_pnl > 0:
                    self.log_colored(f"CLOSED: {reason} | Final P&L: {Colors.GREEN}+{final_pnl:.3f}%{Colors.RESET}", "profit")
                    self.total_pnl += final_pnl
                else:
                    self.log_colored(f"CLOSED: {reason} | Final P&L: {Colors.RED}{final_pnl:.3f}%{Colors.RESET}", "loss")
                    self.total_pnl += final_pnl
                
                # Reset tracking
                self.current_position = 0
                self.position_entry_price = 0
                self.position_entry_time = None
                self.highest_profit = 0.0
                self.trailing_stop_price = 0.0
                self.position_start_time = None
                self.profit_target_hit = False  # Reset profit target flag
                
        except Exception as e:
            self.log_colored(f"Error closing position: {e}", "error")
    
    def log_enhanced_trade(self, side, size, signal_score):
        """Enhanced trade logging with COLORS and ACTUAL VALUES"""
        current_price = self.current_ask if side == "BUY" else self.current_bid
        
        print(f"""
{Colors.CYAN}╭─ Enhanced Trade Execution ─╮{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} {Colors.BOLD}🚀 ENHANCED {side} SIGNAL{Colors.RESET}    {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Price: {Colors.YELLOW}${current_price:,.2f}{Colors.RESET}         {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Size: {Colors.GREEN}{size:.3f} BTC{Colors.RESET}            {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Confidence: {Colors.MAGENTA}{signal_score['confidence']*100:.1f}%{Colors.RESET}          {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Spread: {self.market_indicators.get('spread_percentage', 0):.3f}%             {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Order Flow: {Colors.GREEN if self.market_indicators['order_flow_imbalance'] > 0 else Colors.RED}{self.market_indicators['order_flow_imbalance']:+.2f}{Colors.RESET}          {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Volume Imbalance: {Colors.GREEN if self.trade_data['volume_imbalance'] > 0 else Colors.RED}{self.trade_data['volume_imbalance']:+.2f}{Colors.RESET}    {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}│{Colors.RESET} Liquidity Score: {self.market_indicators.get('liquidity_score', 0):.1f}       {Colors.CYAN}│{Colors.RESET}
{Colors.CYAN}╰────────────────────────────╯{Colors.RESET}
        """)
    
    def should_trade(self) -> bool:
        """Very permissive trading rules - FIXED"""
        current_time = time.time()
        
        # Don't trade if we have a position
        if self.actual_position_size != 0:
            return False
            
        # Very short delay between trades (3 seconds for safety)
        if current_time - self.last_trade_time < 3.0:
            return False
            
        return True

    def analyze_micro_trend(self):
        """Analyze micro trends from last 30 seconds"""
        current_price = (self.current_bid + self.current_ask) / 2
        self.last_prices.append({
            'price': current_price,
            'timestamp': time.time()
        })
        
        # Keep only last 30 seconds of data
        cutoff_time = time.time() - 30
        self.last_prices = [p for p in self.last_prices if p['timestamp'] > cutoff_time]
        
        if len(self.last_prices) < 10:
            return
        
        # Calculate short-term direction
        recent_10 = [p['price'] for p in self.last_prices[-10:]]
        older_10 = [p['price'] for p in self.last_prices[-20:-10]] if len(self.last_prices) >= 20 else recent_10
        
        if len(older_10) < 5:
            return
            
        recent_avg = sum(recent_10) / len(recent_10)
        older_avg = sum(older_10) / len(older_10)
        
        # Determine micro trend
        price_change = (recent_avg - older_avg) / older_avg * 100
        
        if price_change > 0.005:  # Just 0.005% movement = bullish
            self.trend_direction = 'BULLISH'
        elif price_change < -0.005:  # Just 0.005% movement = bearish
            self.trend_direction = 'BEARISH'
        else:
            self.trend_direction = 'NEUTRAL'
    
    def calculate_combined_signal(self, strategy_signal, market_signals):
        """AGGRESSIVE signal combination - lower thresholds"""
        signal_weights = {
            'volume': 0.35,       # Volume is king in scalping
            'momentum': 0.25,     # Price momentum
            'order_flow': 0.20,   # Order book pressure
            'spread': 0.10,       # Market conditions
            'contrarian': 0.08,   # Contrarian opportunities
            'random': 0.02        # Exploration
        }
        
        combined_score = {'BUY': 0.0, 'SELL': 0.0}
        
        for action, signal_type, confidence in market_signals:
            weight = signal_weights.get(signal_type, 0.05)
            # MUCH LOWER THRESHOLD - accept any signal over 20%
            if confidence > 0.2:
                combined_score[action] += confidence * weight
        
        # Determine final action
        if combined_score['BUY'] > combined_score['SELL']:
            return {
                'action': 'BUY',
                'confidence': combined_score['BUY'],
                'BUY': combined_score['BUY'],
                'SELL': combined_score['SELL']
            }
        elif combined_score['SELL'] > combined_score['BUY']:
            return {
                'action': 'SELL', 
                'confidence': combined_score['SELL'],
                'BUY': combined_score['BUY'],
                'SELL': combined_score['SELL']
            }
        else:
            return {'action': None, 'confidence': 0}
    
    def execute_enhanced_trade(self, signal_score):
        """Execute trade with MUCH BIGGER AGGRESSIVE sizing"""
        # MUCH BIGGER Base size for 100x leverage - TARGET $1000+ MARGIN
        base_size = 1.000  # 1.000 BTC = ~$104,600 position = ~$10,460,000 with 100x leverage (MARGIN: ~$1,046)
        
        # Confidence multiplier (higher confidence = bigger size)
        confidence_multiplier = min(signal_score['confidence'] * 3.0, 3.0)  # Up to 3x multiplier
        
        # Final trade size
        trade_size = base_size * confidence_multiplier
        trade_size = round(max(trade_size, 0.500), 3)  # Minimum 0.500 BTC (~$523 margin with 100x)
        
        action = signal_score['action']
        
        if action == 'BUY' and self.actual_position_size == 0:
            if self.execute_trade("BUY", trade_size):
                self.position_start_time = time.time()
                self.highest_profit = 0.0
                self.trade_count += 1
                self.log_enhanced_trade("BUY", trade_size, signal_score)
                
        elif action == 'SELL' and self.actual_position_size == 0:
            if self.execute_trade("SELL", trade_size):
                self.position_start_time = time.time()
                self.highest_profit = 0.0
                self.trade_count += 1
                self.log_enhanced_trade("SELL", trade_size, signal_score)

def run_aggressive_profit_scalper():
    """Run the aggressive profit scalper"""
    
    # Clear terminal and show colorful header
    os.system('clear' if os.name == 'posix' else 'cls')
    
    print(f"""
{Colors.BOLD}{Colors.CYAN}⚡ HIGH PROFIT AGGRESSIVE SCALPER{Colors.RESET}
{Colors.CYAN}{'=' * 50}{Colors.RESET}
{Colors.GREEN}🎯 Profit Target: 0.30% (ACTIVATES TRAILING){Colors.RESET}
{Colors.RED}🛑 Stop Loss: 1.00% (Binance minimum for 100x){Colors.RESET}
{Colors.YELLOW}📈 Trailing Stop: 0.20% → 0.10% (TIGHTER AFTER TARGET){Colors.RESET}
{Colors.BLUE}⏰ Max Hold Time: 5 minutes{Colors.RESET}
{Colors.MAGENTA}⚡ Leverage: 100x{Colors.RESET}
{Colors.WHITE}💰 Position Size: 0.500-3.000 BTC (MARGIN: $523-$3,138){Colors.RESET}
{Colors.CYAN}🔥 Confidence Threshold: 25%{Colors.RESET}
{Colors.BG_GREEN}{Colors.BOLD}🌐 REAL BINANCE TESTNET{Colors.RESET}
    """)
    
    # Get real testnet credentials
    testnet_config = BINANCE_API_CONFIG['testnet']
    
    # Create scalper instance
    scalper = AggressiveProfitScalper(
        api_key=testnet_config['api_key'],
        api_secret=testnet_config['api_secret'], 
        use_testnet=True,
        leverage=100
    )
    
    try:
        scalper.run(
            symbol="BTCUSDT",
            strategy=None,
            balance=100000,
            interval='1m'
        )
    except KeyboardInterrupt:
        print(f"\n{Colors.RED}🛑 Aggressive scalper stopped{Colors.RESET}")
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

if __name__ == "__main__":
    run_aggressive_profit_scalper() 
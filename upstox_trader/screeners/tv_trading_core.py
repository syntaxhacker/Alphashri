#!/usr/bin/env python3
"""
Core Trading & Risk Management Functions
Extracted from TVScreenerUsage class
"""

import os
import sys
import time
import signal
import atexit
from datetime import datetime, timedelta
from rich.console import Console

console = Console()

class TradingCore:
    """Core trading functionality and risk management methods"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def _is_trading_hours(self):
        """Check if current time is within trading hours"""
        current_time = datetime.now().time()
        # Market open: 9:15 AM, Market close: 3:30 PM
        market_open = datetime.strptime("09:15", "%H:%M").time()
        market_close = datetime.strptime("15:30", "%H:%M").time()
        return market_open <= current_time <= market_close
    
    def _is_market_closed(self):
        """Check if market is currently closed"""
        current_time = datetime.now().time()
        # Market close: 3:30 PM
        market_close = datetime.strptime("15:30", "%H:%M").time()
        return current_time > market_close
    
    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown"""
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        atexit.register(self._cleanup_on_exit)
    
    def _signal_handler(self, signum=None, frame=None):
        """Handle shutdown signals"""
        console.print("🛑 Shutting down gracefully...", style="bold red")
        self._cleanup_on_exit()
        sys.exit(0)
    
    def _cleanup_on_exit(self):
        """Cleanup operations on exit"""
        pass
    
    def _exit_all_positions(self, reason="MANUAL_EXIT"):
        """Exit all active positions"""
        if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
            console.print("⚠️ No paper trading bot available", style="bold yellow")
            return
        
        positions = self.parent.paper_trading_bot.get_positions()
        if not positions:
            console.print("✅ No active positions to exit", style="bold green")
            return
        
        console.print(f"🚪 Exiting {len(positions)} positions - Reason: {reason}", style="bold yellow")
        
        for symbol, position in positions.items():
            try:
                current_price = self.parent._get_live_price_from_upstox(symbol)
                if current_price:
                    self._execute_exit_trade(symbol, position, current_price, reason)
                    time.sleep(0.5)  # Rate limiting
            except Exception as e:
                console.print(f"❌ Error exiting {symbol}: {e}", style="bold red")
    
    def _get_progressive_trailing_buffer(self, profit_pct, volatility_adjustment=0.0):
        """Calculate progressive trailing buffer based on profit percentage"""
        base_buffer = 0.5
        if profit_pct > 5:
            return max(0.3, base_buffer - 0.2 + volatility_adjustment)
        return base_buffer + volatility_adjustment
    
    def _get_tighter_trailing_buffer(self, profit_pct, is_ultra_quick=False):
        """Get tighter trailing buffer for quick exits"""
        return 0.2 if is_ultra_quick else 0.3
    
    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        """Calculate trading charges for a trade"""
        # Simplified calculation - customize based on your broker
        brokerage = min(20, trade_value * 0.0005)  # 0.05% or ₹20, whichever is lower
        stt = trade_value * 0.00025  # 0.025% on sell side
        exchange_charges = trade_value * 0.0000345  # ~0.00345%
        gst = (brokerage + exchange_charges) * 0.18  # 18% GST
        stamp_duty = trade_value * 0.00003  # 0.003% on buy side
        
        total_charges = brokerage + stt + exchange_charges + gst + stamp_duty
        return round(total_charges, 2)
    
    def _get_acceleration_based_buffer(self, current_profit, highest_profit, time_since_entry_minutes):
        """Calculate buffer based on profit acceleration"""
        if time_since_entry_minutes < 30:
            return 0.2  # Tight for quick moves
        elif current_profit >= highest_profit * 0.8:
            return 0.3  # Still strong
        else:
            return 0.5  # Give more room
    
    def setup_trade_journal(self):
        """Setup trade journal for logging"""
        try:
            os.makedirs("trade_logs", exist_ok=True)
            self.parent.trade_log_file = f"trade_logs/trades_{datetime.now().strftime('%Y%m%d')}.csv"
            
            # Create header if file doesn't exist
            if not os.path.exists(self.parent.trade_log_file):
                with open(self.parent.trade_log_file, 'w') as f:
                    f.write("timestamp,action,symbol,price,qty,amount,alert_type,pnl_pct,pnl_amount,side,notes\n")
        except Exception as e:
            console.print(f"⚠️ Could not setup trade journal: {e}", style="yellow")
    
    def log_trade(self, action, symbol, price, qty, amount, alert_type, pnl_pct=None, pnl_amount=None, side=None):
        """Log trade to journal"""
        try:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            log_entry = f"{timestamp},{action},{symbol},{price},{qty},{amount},{alert_type},{pnl_pct or ''},{pnl_amount or ''},{side or ''}\n"
            
            with open(self.parent.trade_log_file, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            console.print(f"⚠️ Could not log trade: {e}", style="yellow")
    
    def _check_daily_entry_limit(self, symbol):
        """Check if daily entry limit reached for symbol"""
        if not hasattr(self.parent, 'daily_entries'):
            self.parent.daily_entries = {}
        
        today = datetime.now().strftime('%Y-%m-%d')
        key = f"{symbol}_{today}"
        
        return self.parent.daily_entries.get(key, 0) < 2  # Max 2 entries per symbol per day
    
    def _increment_daily_entry_count(self, symbol):
        """Increment daily entry count for symbol"""
        if not hasattr(self.parent, 'daily_entries'):
            self.parent.daily_entries = {}
        
        today = datetime.now().strftime('%Y-%m-%d')
        key = f"{symbol}_{today}"
        
        self.parent.daily_entries[key] = self.parent.daily_entries.get(key, 0) + 1
    
    def _check_loss_cooldown(self, symbol):
        """Check if symbol is in loss cooldown period"""
        if not hasattr(self.parent, 'loss_cooldowns'):
            self.parent.loss_cooldowns = {}
        
        if symbol in self.parent.loss_cooldowns:
            cooldown_until = self.parent.loss_cooldowns[symbol]
            if datetime.now() < cooldown_until:
                return False  # Still in cooldown
            else:
                del self.parent.loss_cooldowns[symbol]  # Cooldown expired
        
        return True  # Not in cooldown
    
    def _has_existing_position(self, ticker):
        """Check if we already have a position in this symbol"""
        if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
            return False
        
        positions = self.parent.paper_trading_bot.get_positions()
        base_symbol = self._get_base_symbol(ticker)
        
        # Check for any position in the same base symbol
        for symbol in positions.keys():
            if self._get_base_symbol(symbol) == base_symbol:
                return True
        
        return False
    
    def _get_base_symbol(self, ticker):
        """Extract base symbol from ticker (remove NSE: prefix)"""
        return ticker.replace('NSE:', '').replace('BSE:', '')

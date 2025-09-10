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
        if hasattr(self.parent, 'tv_time_utils') and self.parent.tv_time_utils:
            return self.parent.tv_time_utils.is_trading_hours(
                self.parent.trading_start_time, 
                self.parent.trading_end_time, 
                self.parent.paper_trading_enabled
            )
        # Fallback if utility not available
        if not self.parent.paper_trading_enabled:
            return True
        try:
            from datetime import datetime, time
            now = datetime.now().time()
            start_time = datetime.strptime(self.parent.trading_start_time, "%H:%M").time()
            end_time = datetime.strptime(self.parent.trading_end_time, "%H:%M").time()
            return start_time <= now <= end_time
        except Exception as e:
            console.print(f"[yellow]⚠️ Error checking trading hours: {e}. Allowing trade.[/yellow]")
            return True
    
    def _is_market_closed(self):
        """Check if market is currently closed"""
        if hasattr(self.parent, 'tv_time_utils') and self.parent.tv_time_utils:
            return self.parent.tv_time_utils.is_market_closed("15:30")  # Use actual market close time
        # Fallback if utility not available
        try:
            from datetime import datetime, time
            now = datetime.now().time()
            market_close = datetime.strptime("15:30", "%H:%M").time()  # Market closes at 3:30 PM
            return now > market_close
        except Exception as e:
            return False  # If error, assume market is open
    
    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown"""
        signal.signal(signal.SIGINT, self._signal_handler)  # Ctrl+C
        signal.signal(signal.SIGTERM, self._signal_handler)  # Termination
        atexit.register(self._cleanup_on_exit)
    
    def _signal_handler(self, signum=None, frame=None):
        """Handle shutdown signals"""
        console.print(f"\n[bold yellow]🛑 Signal received: {signal.Signals(signum).name if signum else 'EXIT'}[/bold yellow]")
        self._exit_all_positions("SCRIPT_STOPPED")
        sys.exit(0)
    
    def _cleanup_on_exit(self):
        """Cleanup operations on exit"""
        if hasattr(self.parent, 'positions') and self.parent.positions:
            self._exit_all_positions("SCRIPT_EXIT")
    
    def _exit_all_positions(self, reason="MANUAL_EXIT"):
        """Exit all active positions"""
        if not hasattr(self.parent, 'positions') or not self.parent.positions:
            console.print("[dim]No active positions to exit.[/dim]")
            return
        
        console.print(f"\n[bold red]🚨 EXITING ALL POSITIONS - Reason: {reason}[/bold red]")
        
        exit_count = 0
        total_pnl = 0
        
        # Create a copy of positions to avoid modification during iteration
        positions_to_exit = dict(self.parent.positions)
        
        for symbol, position in positions_to_exit.items():
            try:
                # Get current price for exit
                current_price = self.parent._get_live_price_from_upstox(symbol)
                if not current_price:
                    current_price = self.parent.current_prices.get(symbol, position['entry_price'])
                
                # Calculate P&L
                pnl_pct = (current_price - position['entry_price']) / position['entry_price'] * 100
                if position['side'] == 'SELL':
                    pnl_pct *= -1
                
                pnl_amount = pnl_pct * position['entry_price'] * position['qty'] / 100
                total_pnl += pnl_amount
                
                # Execute exit
                self.parent._execute_exit_trade(symbol, position, current_price, f"{reason}: Bulk Exit")
                exit_count += 1
                
            except Exception as e:
                console.print(f"[red]❌ Failed to exit {symbol}: {e}[/red]")
        
        console.print(f"\n[bold green]✅ Exited {exit_count} positions | Total P&L: ₹{total_pnl:+,.0f}[/bold green]")
    
    def _get_progressive_trailing_buffer(self, profit_pct, volatility_adjustment=0.0):
        """Calculate progressive trailing buffer based on profit percentage"""
        if hasattr(self.parent, 'tv_utils') and self.parent.tv_utils is None:
            return 1.0
        return self.parent.tv_utils.get_progressive_trailing_buffer(profit_pct, volatility_adjustment)
    
    def _get_tighter_trailing_buffer(self, profit_pct, is_ultra_quick=False):
        """Get tighter trailing buffer for quick exits"""
        return self.parent.config.get_trailing_buffer(profit_pct, is_ultra_quick)
    
    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        """Calculate trading charges for a trade"""
        if hasattr(self.parent, 'tv_utils') and self.parent.tv_utils is None:
            return 0.0
        return self.parent.tv_utils.calculate_trading_charges(trade_value, trade_type)
    
    def _get_acceleration_based_buffer(self, current_profit, highest_profit, time_since_entry_minutes):
        """Calculate buffer based on profit acceleration"""
        if hasattr(self.parent, 'tv_utils') and self.parent.tv_utils is None:
            return 1.0
        return self.parent.tv_utils.get_acceleration_based_buffer(current_profit, highest_profit, time_since_entry_minutes)
    
    def setup_trade_journal(self):
        """Setup trade journal for logging"""
        # if self.parent.trading_core:
        #     return self.parent.trading_core.setup_trade_journal()
        # Original implementation follows below
        """Setup trade journal file with date and mode"""
        from datetime import datetime
        import os
        
        # Create logs directory if it doesn't exist
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)
            
        # Create journal filename with date
        date_str = datetime.now().strftime("%d%b").lower()  # 17jul format
        mode = getattr(self.parent, 'watch_mode', 'prebreakout').lower()
        self.parent.journal_file = f"{logs_dir}/tv_screener_{mode}_{date_str}.log"
        
        # Write header if new file
        if not os.path.exists(self.parent.journal_file):
            with open(self.parent.journal_file, 'w') as f:
                f.write(f"# TV Screener Trade Journal - {mode.upper()} Mode\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: TIMESTAMP | ACTION_SIDE | SYMBOL | PRICE | QTY | AMOUNT | ALERT_TYPE | P&L\n")
                f.write("-" * 80 + "\n")
    
    def log_trade(self, action, symbol, price, qty, amount, alert_type, pnl_pct=None, pnl_amount=None, side=None):
        """Log trade to journal file"""
        if not self.parent.journal_file:
            return
            
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # Format P&L info
        pnl_info = ""
        if pnl_pct is not None:
            pnl_info = f" | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})"
        
        # Include side information in the action
        action_with_side = action
        if side:
            action_with_side = f"{action}_{side}"
        
        log_entry = f"{timestamp} | {action_with_side} | {symbol} | ₹{price:.2f} | {qty} | ₹{amount:,.0f} | {alert_type}{pnl_info}\n"
        
        try:
            with open(self.parent.journal_file, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            console.print(f"[dim red]⚠️ Journal write failed: {e}[/dim red]")
    
    def _check_daily_entry_limit(self, symbol):
        """Check if daily entry limit reached for symbol"""
        from datetime import date
        today = date.today().isoformat()
        
        if symbol not in self.parent.daily_entry_count:
            return False, 0
            
        if today not in self.parent.daily_entry_count[symbol]:
            return False, 0
            
        entries_today = self.parent.daily_entry_count[symbol][today]
        if entries_today >= self.parent.max_daily_entries_per_stock:
            return True, entries_today
            
        return False, entries_today
    
    def _increment_daily_entry_count(self, symbol):
        """Increment daily entry count for symbol"""
        from datetime import date
        today = date.today().isoformat()
        
        if symbol not in self.parent.daily_entry_count:
            self.parent.daily_entry_count[symbol] = {}
            
        if today not in self.parent.daily_entry_count[symbol]:
            self.parent.daily_entry_count[symbol][today] = 0
            
        self.parent.daily_entry_count[symbol][today] += 1
    
    def _check_loss_cooldown(self, symbol):
        """Check if symbol is in loss cooldown period"""
        if symbol not in self.parent.loss_cooldown:
            return False, 0
            
        current_time = datetime.now()
        loss_time_diff = (current_time - self.parent.loss_cooldown[symbol]).total_seconds()
        
        if loss_time_diff < self.parent.loss_cooldown_duration:
            cooldown_left = self.parent.loss_cooldown_duration - loss_time_diff
            return True, cooldown_left
            
        return False, 0
    
    def _has_existing_position(self, ticker):
        """Check if we already have a position in this symbol"""
        base_symbol = self._get_base_symbol(ticker)
        
        for existing_ticker in self.parent.positions:
            if self.parent.positions[existing_ticker]:  # Active position
                existing_base = self._get_base_symbol(existing_ticker)
                if base_symbol == existing_base:
                    return True, existing_ticker
        return False, None
    
    def _get_base_symbol(self, ticker):
        """Extract base symbol from ticker (remove NSE: prefix)"""
        if hasattr(self.parent, 'tv_data_utils') and self.parent.tv_data_utils:
            return self.parent.tv_data_utils.get_base_symbol(ticker)
        # Fallback
        if ':' in ticker:
            return ticker.split(':')[1]
        return ticker
#!/usr/bin/env python3
"""
COMPREHENSIVE TRADINGVIEW SCREENER USAGE GUIDE
==============================================

This script provides practical examples for using TradingView screener for:
1. Intraday Trading
2. Swing Trading  
3. Long-term Investing
4. Research & Analysis

Each function demonstrates different screening strategies with real-world applications.
"""

import rookiepy
from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.columns import Columns
from datetime import datetime, timedelta
import time
import threading
import os
import signal
import sys
import atexit

import pandas as pd

# --- Robust Import Setup ---
# This block ensures that modules can be imported correctly whether
# tv_screen_usage.py is run as a script or as part of a package.

_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

# Add relevant paths to sys.path if not already present
# For package-relative imports (e.g., from . import tv_modes)
if _screeners_dir not in sys.path:
    sys.path.insert(0, _screeners_dir)
# For absolute imports from upstox_trader (e.g., from upstox_trader.screeners.tv_modes)
if _upstox_trader_dir not in sys.path:
    sys.path.insert(0, _upstox_trader_dir)
# For project-level imports (e.g., from config import ...)
if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

# --- End Robust Import Setup ---

# Import mode functions
from upstox_trader.screeners import tv_modes
from upstox_trader.screeners import tv_helpers
from upstox_trader.screeners import tv_configs
from upstox_trader.screeners.tv_configs import TVTradingConfig # Explicitly import TVTradingConfig
from upstox_trader.screeners import tv_display
from upstox_trader.screeners import tv_alerts
from upstox_trader.screeners import tv_utils

# Import utility modules
from upstox_trader.screeners.utils import tv_time_utils, tv_system_utils, tv_risk_utils, tv_technical_utils
from upstox_trader.screeners.utils import tv_price_utils, tv_data_utils, tv_logging_utils

# Import separated functionality modules
from upstox_trader.screeners.tv_trading_core import TradingCore
from upstox_trader.screeners.tv_gap_analysis import GapAnalysis
from upstox_trader.screeners.tv_technical_analysis import TechnicalAnalysis
from upstox_trader.screeners.tv_live_data import LiveDataMonitor
from upstox_trader.screeners.tv_display_utils import DisplayUtils
from upstox_trader.screeners.symbol_validator import get_symbol_validator, validate_symbol, get_valid_symbol, is_symbol_blacklisted

# Alias imported functions for backward compatibility where direct function calls were made
helpers_display_table = tv_helpers.display_table
helpers_save_results = tv_helpers.save_results
get_tradingview_cookies = tv_helpers.get_tradingview_cookies
get_config = tv_configs.get_config

console = Console()

# Telegram integration and Paper Trading Bot
try:
    import requests
    # Add parent directory to path to import config (already added by robust import setup)
    from config import TELEGRAM_CONFIG, UPSTOX_CONFIG
    
    # Import paper trading bot (already added by robust import setup)
    from upstox_trader.trading_bots.upstox_paper_trading_bot import UpstoxPaperTradingBot
    
    TELEGRAM_AVAILABLE = True
    PAPER_TRADING_AVAILABLE = True
except ImportError as e:
    TELEGRAM_AVAILABLE = False
    PAPER_TRADING_AVAILABLE = False
    print(f"⚠️ Integration not available: {e}")
    print("⚠️ Paper trading and/or Telegram disabled")

class TVScreenerUsage:
    def __init__(self, market='in', enable_paper_trading=False, config: TVTradingConfig = None):
        self.cookies = get_tradingview_cookies()
        self.query = Query()
        
        # Initialize configuration
        self.config = config or get_config()

        # Bind optional display module to instance once, so delegated modules can rely on it
        # and avoid re-import attempts in tight loops.
        try:
            self.tv_display = tv_display if 'tv_display' in globals() else None
        except Exception:
            self.tv_display = None

        # Emit a one-time note if display is unavailable (avoid spamming every refresh)
        if self.tv_display is None:
            console.print("[yellow]tv_display module unavailable (table rendering degraded).[/yellow]")

        # Set market based on parameter - use TradingView API format
        if market.lower() == 'us':
            self.market = 'america'  # TradingView expects 'america' for US stocks
        elif market.lower() == 'in':
            self.market = 'india'
        else:
            self.market = 'india'  # Default to India
            
        console.print(f"[blue]📊 Market: {self.market.upper()}[/blue]")
        
        # Set currency symbol based on market
        self.currency_symbol = '$' if self.market == 'america' else '₹'
        
        # Initialize real-time momentum tracking
        self.momentum_history = {}  # {ticker: [(timestamp, price, change%), ...]}
        self.momentum_signals = {}  # {ticker: {'direction': 'UP/DOWN', 'consecutive_count': int, 'last_signal_time': datetime}}
        
        # Initialize trade journaling
        self.journal_file = None
        # Note: setup_trade_journal() called after module initialization
        
        # Telegram integration
        self.telegram_enabled = TELEGRAM_AVAILABLE and TELEGRAM_CONFIG.get('bot_token') if TELEGRAM_AVAILABLE else False
        if self.telegram_enabled:
            console.print("[green]✅ Telegram alerts enabled[/green]")
        else:
            console.print("[yellow]⚠️ Telegram alerts disabled - configure TELEGRAM_CONFIG[/yellow]")
        
        # Alert deduplication and cooldown system
        self.sent_alerts = set()  # Track sent alerts to avoid duplicates
        self.last_alert_time = {}  # Track last alert time per symbol
        self.alert_cooldown = self.config.risk_management.alert_cooldown_seconds
        
        # Stop loss cooling system
        self.stop_loss_cooldown = {}  # Track symbols that hit stop loss: {symbol: timestamp}
        self.stop_loss_cooldown_duration = self.config.risk_management.stop_loss_cooldown_seconds
        
        # Loss-based cooling system
        self.loss_cooldown = {}  # Track symbols that had losses: {symbol: timestamp}
        self.loss_cooldown_duration = self.config.risk_management.loss_cooldown_seconds
        
        # Daily entry limits
        self.daily_entry_count = {}  # Track entries per symbol per day: {symbol: {date: count}}
        self.max_daily_entries_per_stock = self.config.risk_management.max_daily_entries_per_stock
        self.max_total_trades = self.config.risk_management.max_total_trades
        self.total_trades_today = 0  # Track total trades for the day
        
        # Trading Time Configuration
        self.trading_start_time = self.config.trading_hours.trading_start_time
        self.trading_end_time = self.config.trading_hours.trading_end_time
        
        # Simple Paper Trading integration (without full bot monitoring)
        self.paper_trading_enabled = enable_paper_trading
        self.live_trades = []  # Track live trades for display
        self.closed_trades = []  # Track closed trades with P&L
        self.positions = {}   # Simple position tracking
        self.current_prices = {}  # Track current prices
        self.price_cache_timestamps = {}  # Track when prices were last fetched
        self.exchange_fallbacks = {}  # Track which symbols use fallback exchange
        self.trade_count = 0  # Track number of trades
        
        # Initialize Upstox API for live prices if available
        self.upstox_api = None
        self.background_monitor_active = False
        self.monitor_thread = None
        self.stop_monitoring = threading.Event()
        
        # Initialize Upstox API for historical data (used for S/R analysis and paper trading)
        self.upstox_api = None
        try:
            from config_and_utils.free_indian_apis import UpstoxAPI
            self.upstox_api = UpstoxAPI(
                api_key=UPSTOX_CONFIG.get('api_key'),
                api_secret=UPSTOX_CONFIG.get('api_secret')
            )
            # Try to authenticate
            if self.upstox_api.authenticate():
                console.print("[green]✅ Upstox API initialized for historical S/R analysis[/green]")
            else:
                console.print("[yellow]⚠️ Upstox authentication failed - using simulated S/R[/yellow]")
                self.upstox_api = None
        except Exception as e:
            console.print(f"[yellow]⚠️ Upstox API unavailable - using simulated S/R: {e}[/yellow]")
            self.upstox_api = None
        
        # Set upstox_client alias for compatibility with separated modules
        self.upstox_client = self.upstox_api
        
        # Initialize separated functionality modules
        if TradingCore and GapAnalysis and TechnicalAnalysis and LiveDataMonitor and DisplayUtils:
            self.trading_core = TradingCore(self)
            self.gap_analysis = GapAnalysis(self)
            self.technical_analysis = TechnicalAnalysis(self)
            self.live_data = LiveDataMonitor(self)
            self.display_utils = DisplayUtils(self)
            console.print("[green]✅ Separated modules initialized successfully[/green]")
        else:
            console.print("[yellow]⚠️ Some separated modules unavailable - using original methods[/yellow]")
            self.trading_core = None
            self.gap_analysis = None
            self.technical_analysis = None
            self.live_data = None
            self.display_utils = None
        
        # Now setup trade journal after modules are initialized
        self.setup_trade_journal()
        
        if self.paper_trading_enabled:
            if self.upstox_api:
                console.print("[green]✅ Paper Trading enabled (₹20,000 per trade) with live Upstox prices[/green]")
            else:
                console.print("[yellow]⚠️ Paper Trading enabled (₹20,000 per trade) - Upstox API unavailable[/yellow]")
        else:
            console.print("[yellow]⚠️ Paper Trading disabled[/yellow]")
        
        # Display trading hours if paper trading is enabled
        if self.paper_trading_enabled:
            console.print(f"[cyan]⏰ Trading Hours: {self.trading_start_time} - {self.trading_end_time} IST[/cyan]")
        
        # Setup signal handlers for graceful shutdown
        self._setup_signal_handlers()
    
    def _is_trading_hours(self):
        """Check if current time is within trading hours"""
        if tv_time_utils:
            return tv_time_utils.is_trading_hours(
                self.trading_start_time, 
                self.trading_end_time, 
                self.paper_trading_enabled
            )
        # Fallback if utility not available
        if not self.paper_trading_enabled:
            return True
        try:
            from datetime import datetime, time
            now = datetime.now().time()
            start_time = datetime.strptime(self.trading_start_time, "%H:%M").time()
            end_time = datetime.strptime(self.trading_end_time, "%H:%M").time()
            return start_time <= now <= end_time
        except Exception as e:
            console.print(f"[yellow]⚠️ Error checking trading hours: {e}. Allowing trade.[/yellow]")
            return True
    
    def _is_market_closed(self):
        """Check if market has closed (after 3:30 PM)"""
        if tv_time_utils:
            return tv_time_utils.is_market_closed("15:30")  # Use actual market close time
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
        """Cleanup function called on script exit"""
        if hasattr(self, 'positions') and self.positions:
            self._exit_all_positions("SCRIPT_EXIT")
    
    def _exit_all_positions(self, reason="MANUAL_EXIT"):
        """Exit all live positions"""
        if not hasattr(self, 'positions') or not self.positions:
            console.print("[dim]No active positions to exit.[/dim]")
            return
        
        console.print(f"\n[bold red]🚨 EXITING ALL POSITIONS - Reason: {reason}[/bold red]")
        
        exit_count = 0
        total_pnl = 0
        
        # Create a copy of positions to avoid modification during iteration
        positions_to_exit = dict(self.positions)
        
        for symbol, position in positions_to_exit.items():
            try:
                # Get current price for exit
                current_price = self._get_live_price_from_upstox(symbol)
                if not current_price:
                    current_price = self.current_prices.get(symbol, position['entry_price'])
                
                # Calculate P&L
                pnl_pct = (current_price - position['entry_price']) / position['entry_price'] * 100
                if position['side'] == 'SELL':
                    pnl_pct *= -1
                
                pnl_amount = pnl_pct * position['entry_price'] * position['qty'] / 100
                total_pnl += pnl_amount
                
                # Execute exit
                self._execute_exit_trade(symbol, position, current_price, f"{reason}: Bulk Exit")
                exit_count += 1
                
            except Exception as e:
                console.print(f"[red]❌ Failed to exit {symbol}: {e}[/red]")
        
        console.print(f"\n[bold green]✅ Exited {exit_count} positions | Total P&L: ₹{total_pnl:+,.0f}[/bold green]")
    
    def _get_progressive_trailing_buffer(self, profit_pct, volatility_adjustment=0.0):
        """Delegate to shared utils to calculate trailing buffer."""
        if tv_utils is None:
            return 1.0
        return tv_utils.get_progressive_trailing_buffer(profit_pct, volatility_adjustment)
    
    def _get_tighter_trailing_buffer(self, profit_pct, is_ultra_quick=False):
        """MUCH TIGHTER trailing buffer for aggressive profit locking"""
        return self.config.get_trailing_buffer(profit_pct, is_ultra_quick)
    
    def _detect_volatility_level(self, symbol, current_price):
        """Detect volatility level for a stock to determine if ATR-based stops should be used"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return 'normal'  # Default to normal volatility
            
            from datetime import datetime, timedelta
            import numpy as np
            
            # Get recent price data for volatility calculation
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=self.config.data.volatility_lookback_days)).strftime('%Y-%m-%d')
            
            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date
            )
            
            if df is None or df.empty or len(df) < 5:
                return 'normal'  # Default if insufficient data
            
            # Calculate daily returns
            df['returns'] = df['close'].pct_change()
            
            # Calculate volatility (standard deviation of returns)
            volatility = df['returns'].std()
            
            # Calculate average daily range as % of price
            df['daily_range_pct'] = ((df['high'] - df['low']) / df['close']) * 100
            avg_daily_range = df['daily_range_pct'].mean()
            
            # Thresholds for volatility classification (from config)
            high_vol_threshold = self.config.risk_management.high_vol_threshold
            high_range_threshold = self.config.risk_management.high_range_threshold
            
            # Classify volatility
            if volatility > high_vol_threshold or avg_daily_range > high_range_threshold:
                console.print(f"[dim yellow]⚠️ {symbol} classified as HIGH volatility (Vol: {volatility:.3f}, Range: {avg_daily_range:.1f}%)[/dim yellow]")
                return 'high'
            else:
                console.print(f"[dim green]✅ {symbol} classified as NORMAL volatility (Vol: {volatility:.3f}, Range: {avg_daily_range:.1f}%)[/dim green]")
                return 'normal'
                
        except Exception as e:
            console.print(f"[dim red]⚠️ Volatility detection failed for {symbol}: {e}[/dim red]")
            return 'normal'  # Conservative default
    
    def _calculate_atr_based_stop(self, symbol, current_price, atr_multiplier=None):
        """Calculate ATR-based stop loss for volatile stocks"""
        if atr_multiplier is None:
            atr_multiplier = self.config.risk_management.atr_multiplier
            
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                # Fallback to fixed percentage for volatile stocks (from config)
                return current_price * (1 + self.config.risk_management.atr_fallback_stop_pct / 100)
            
            from datetime import datetime, timedelta
            import numpy as np
            
            # Get historical data for ATR calculation
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=self.config.data.atr_lookback_days)).strftime('%Y-%m-%d')
            
            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date
            )
            
            if df is None or df.empty or len(df) < 14:
                # Fallback to fixed percentage
                return current_price * 0.98
            
            # Calculate True Range
            df['high_low'] = df['high'] - df['low']
            df['high_close_prev'] = np.abs(df['high'] - df['close'].shift(1))
            df['low_close_prev'] = np.abs(df['low'] - df['close'].shift(1))
            
            df['true_range'] = df[['high_low', 'high_close_prev', 'low_close_prev']].max(axis=1)
            
            # Calculate ATR (configurable period average)
            atr = df['true_range'].rolling(window=self.config.data.atr_period).mean().iloc[-1]
            
            if pd.isna(atr) or atr <= 0:
                # Fallback to fixed percentage (from config)
                return current_price * (1 + self.config.risk_management.atr_fallback_stop_pct / 100)
            
            # ATR-based stop: current_price - (ATR * multiplier)
            atr_stop = current_price - (atr * atr_multiplier)
            
            # Ensure stop is reasonable (not more than configured max below current price)
            min_stop = current_price * (1 + self.config.risk_management.atr_max_stop_pct / 100)
            atr_stop = max(atr_stop, min_stop)
            
            console.print(f"[dim]ATR Stop for {symbol}: ₹{atr_stop:.2f} (ATR: {atr:.2f}, Current: ₹{current_price:.2f})[/dim]")
            return atr_stop
            
        except Exception as e:
            console.print(f"[dim red]⚠️ ATR calculation failed for {symbol}: {e}[/dim red]")
            # Conservative fallback (from config)
            return current_price * (1 + self.config.risk_management.atr_fallback_stop_pct / 100)
    
    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        """Delegate to shared utils to calculate trading charges."""
        if tv_utils is None:
            return 0.0
        return tv_utils.calculate_trading_charges(trade_value, trade_type)
    
    def _get_acceleration_based_buffer(self, current_profit, highest_profit, time_since_entry_minutes):
        """Delegate to shared utils for acceleration-based buffer."""
        if tv_utils is None:
            return 1.0
        return tv_utils.get_acceleration_based_buffer(current_profit, highest_profit, time_since_entry_minutes)
    
    # Removed unused _send_telegram_alert stub; sending is delegated to tv_alerts.send_telegram_alert
        
    def setup_trade_journal(self):
        """Setup trade journal - delegate to trading_core if available"""
        # if self.trading_core:
        #     return self.trading_core.setup_trade_journal()
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
        mode = getattr(self, 'watch_mode', 'prebreakout').lower()
        self.journal_file = f"{logs_dir}/tv_screener_{mode}_{date_str}.log"
        
        # Write header if new file
        if not os.path.exists(self.journal_file):
            with open(self.journal_file, 'w') as f:
                f.write(f"# TV Screener Trade Journal - {mode.upper()} Mode\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: TIMESTAMP | ACTION_SIDE | SYMBOL | PRICE | QTY | AMOUNT | ALERT_TYPE | P&L\n")
                f.write("-" * 80 + "\n")
    
    def log_trade(self, action, symbol, price, qty, amount, alert_type, pnl_pct=None, pnl_amount=None, side=None):
        """Log trade to journal file"""
        if not self.journal_file:
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
            with open(self.journal_file, 'a') as f:
                f.write(log_entry)
        except Exception as e:
            console.print(f"[dim red]⚠️ Journal write failed: {e}[/dim red]")

    def _check_not_buying_at_top(self, symbol, row):
        """
        Enhanced logic to avoid buying at tops using TradingView data
        Returns True if it's safe to buy (not at top), False if too risky
        """
        try:
            # Get current data from the row
            current_price = row['close']
            rsi = row.get('RSI', 50)
            week_perf = row.get('Perf.W', 0)
            month3_perf = row.get('Perf.3M', 0)
            price_52w_high = row.get('price_52_week_high', current_price * 1.1)
            ema20 = row.get('EMA20', current_price)
            ema50 = row.get('EMA50', current_price)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            
            # Calculate distance from 52-week high
            distance_from_high = ((price_52w_high - current_price) / current_price) * 100
            
            # Check 1: Too close to 52-week high (less than 8% below - more conservative)
            if distance_from_high < 8.0:
                console.print(f"[dim yellow]⚠️ {symbol}: Too close to 52W high (only {distance_from_high:.1f}% below)[/dim yellow]")
                return False
            
            # Check 2: RSI too overbought (relaxed for FOMO mode)
            if rsi > 85:  # Much more aggressive threshold
                console.print(f"[dim yellow]⚠️ {symbol}: RSI too overbought ({rsi:.1f} > 85)[/dim yellow]")
                return False
            
            # Check 3: TODAY'S move too extreme (relaxed for FOMO mode)
            today_change = row.get('change', 0)
            if today_change > 12.0:  # Much more aggressive threshold
                console.print(f"[dim yellow]⚠️ {symbol}: Today's move too extreme (+{today_change:.1f}% > 12%)[/dim yellow]")
                return False
            
            # Check 4: Intraday momentum divergence (relaxed for FOMO mode)
            if volume_ratio > 15.0 and today_change < 0.5:  # Much more aggressive thresholds
                console.print(f"[dim yellow]⚠️ {symbol}: High volume ({volume_ratio:.1f}x) with weak price action - potential distribution[/dim yellow]")
                return False
            
            # Check 5: Weekly performance too extended (above 12% - more conservative)
            if week_perf > 12:
                console.print(f"[dim yellow]⚠️ {symbol}: Weekly move too extended (+{week_perf:.1f}% > 12%)[/dim yellow]")
                return False
            
            # Check 6: 3-month performance too extended (above 40% - more conservative)
            if month3_perf > 40:
                console.print(f"[dim yellow]⚠️ {symbol}: 3-month move too extended (+{month3_perf:.1f}% > 40%)[/dim yellow]")
                return False
            
            # Check 7: Not above key moving averages (trend weakness)
            if current_price < ema20:
                console.print(f"[dim yellow]⚠️ {symbol}: Below 20 EMA - weak trend[/dim yellow]")
                return False
            
            # Check 8: EMA alignment (20 EMA should be above 50 EMA)
            if ema20 < ema50:
                console.print(f"[dim yellow]⚠️ {symbol}: 20 EMA below 50 EMA - downtrend[/dim yellow]")
                return False
            
            # Check 9: Price extension from EMA20 (don't chase stocks too far above support)
            price_above_ema20 = ((current_price - ema20) / ema20) * 100
            if price_above_ema20 > 8.0:  # More aggressive threshold
                console.print(f"[dim yellow]⚠️ {symbol}: Too far above EMA20 ({price_above_ema20:.1f}% > 8%) - wait for pullback[/dim yellow]")
                return False
            
            # Check 10: Momentum quality check - RSI vs Price action alignment (relaxed)
            if rsi > 75 and today_change < 0.5:  # More aggressive thresholds
                console.print(f"[dim yellow]⚠️ {symbol}: RSI high ({rsi:.1f}) but weak price action - momentum fading[/dim yellow]")
                return False
            
            # If all checks pass, it's safer to enter
            console.print(f"[dim green]✅ {symbol}: Top-avoidance checks passed - safe entry zone[/dim green]")
            return True
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Error checking top avoidance for {symbol}: {e}[/dim red]")
            # If error, be conservative and avoid entry
            return False
    
    def _check_momentum_divergence(self, symbol, row, previous_data=None):
        """
        Check for momentum divergence - price making higher highs but indicators showing weakness
        Returns True if momentum is healthy, False if divergence detected
        """
        try:
            current_price = row['close']
            rsi = row.get('RSI', 50)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            macd = row.get('MACD.macd', 0)
            macd_signal = row.get('MACD.signal', 0)
            
            # Check 1: Price vs RSI divergence (relaxed for FOMO mode)
            # If price is strong but RSI is weakening, that's bearish divergence
            today_change = row.get('change', 0)
            if today_change > 8.0 and rsi < 35:  # Much more aggressive thresholds
                console.print(f"[dim yellow]⚠️ {symbol}: Potential RSI divergence - strong price (+{today_change:.1f}%) but weak RSI ({rsi:.1f})[/dim yellow]")
                return False
            
            # Check 2: Volume-Price divergence (relaxed for FOMO mode)
            # Very high volume with small price move suggests institutions selling into strength
            if volume_ratio > 6.0 and today_change < 1.0:  # More relaxed thresholds
                console.print(f"[dim yellow]⚠️ {symbol}: Volume-price divergence - high volume ({volume_ratio:.1f}x) with weak move (+{today_change:.1f}%)[/dim yellow]")
                return False
            
            # Check 3: MACD momentum check
            if macd < macd_signal and today_change > 2.0:
                console.print(f"[dim yellow]⚠️ {symbol}: MACD bearish divergence - price up but MACD below signal[/dim yellow]")
                return False
            
            # Check 4: Compare with previous data if available
            if previous_data is not None and not previous_data.empty:
                prev_row = previous_data[previous_data['ticker'] == symbol]
                if not prev_row.empty:
                    prev_rsi = prev_row.iloc[0].get('RSI', 50)
                    prev_change = prev_row.iloc[0].get('change', 0)
                    
                    # Check if price momentum improving but RSI momentum declining
                    if today_change > prev_change and rsi < prev_rsi - 5:
                        console.print(f"[dim yellow]⚠️ {symbol}: Momentum divergence - price accelerating but RSI declining[/dim yellow]")
                        return False
            
            return True
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Error checking momentum divergence for {symbol}: {e}[/dim red]")
            return True  # If error, don't block trade but log
    
    def _is_overextended_for_short(self, symbol):
        """
        Check if a stock is overextended and suitable for SHORT selling
        More aggressive criteria than the top-avoidance check
        """
        try:
            # Get additional data for the symbol from current watch data
            current_data = self._get_watch_data()
            if current_data.empty:
                return False
            
            # Find the symbol in current data
            symbol_row = current_data[current_data['ticker'] == symbol]
            if symbol_row.empty:
                return False
            
            row = symbol_row.iloc[0]
            current_price = row['close']
            rsi = row.get('RSI', 50)
            week_perf = row.get('Perf.W', 0)
            month3_perf = row.get('Perf.3M', 0)
            price_52w_high = row.get('price_52_week_high', current_price * 1.1)
            change_today = row.get('change', 0)
            
            # Calculate distance from 52-week high
            distance_from_high = ((price_52w_high - current_price) / current_price) * 100
            
            # SHORT criteria (more aggressive than long avoidance)
            short_signals = 0
            
            # Signal 1: Very close to 52-week high (within 3%)
            if distance_from_high < 3.0:
                short_signals += 2
                console.print(f"[dim red]🔴 {symbol}: Very close to 52W high ({distance_from_high:.1f}% below)[/dim red]")
            
            # Signal 2: RSI extremely overbought (above 80)
            if rsi > 80:
                short_signals += 2
                console.print(f"[dim red]🔴 {symbol}: Extremely overbought RSI ({rsi:.1f})[/dim red]")
            elif rsi > 75:
                short_signals += 1
                console.print(f"[dim red]📉 {symbol}: Overbought RSI ({rsi:.1f})[/dim red]")
            
            # Signal 3: Excessive weekly gain (above 20%)
            if week_perf > 20:
                short_signals += 2
                console.print(f"[dim red]🔴 {symbol}: Excessive weekly gain (+{week_perf:.1f}%)[/dim red]")
            elif week_perf > 15:
                short_signals += 1
                console.print(f"[dim red]📉 {symbol}: High weekly gain (+{week_perf:.1f}%)[/dim red]")
            
            # Signal 4: Massive daily gain (above 10% in one day)
            if change_today > 10:
                short_signals += 2
                console.print(f"[dim red]🔴 {symbol}: Massive daily gain (+{change_today:.1f}%)[/dim red]")
            elif change_today > 7:
                short_signals += 1
                console.print(f"[dim red]📉 {symbol}: Large daily gain (+{change_today:.1f}%)[/dim red]")
            
            # Signal 5: Extended 3-month performance (above 75%)
            if month3_perf > 75:
                short_signals += 1
                console.print(f"[dim red]📉 {symbol}: Extended 3M performance (+{month3_perf:.1f}%)[/dim red]")
            
            # Require at least 3 short signals for aggressive shorting
            if short_signals >= 3:
                console.print(f"[bold red]🔴 {symbol}: OVEREXTENDED - {short_signals} short signals detected[/bold red]")
                return True
            
            return False
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Error checking overextension for {symbol}: {e}[/dim red]")
            return False
    
    def _check_historical_upside(self, symbol, current_price):
        """Check how much upside is left based on recent historical highs"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return True  # No historical data available, allow trade
                
            # Get previous day's data (daily timeframe)
            df = self.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                unit='days',
                duration=5  # Last 5 days
            )
            
            if df is None or df.empty:
                return True  # No data, allow trade
            
            # Calculate recent high and average high
            recent_high = df['high'].max()
            avg_high = df['high'].rolling(window=3).mean().iloc[-1]
            
            # Calculate potential upside
            upside_to_recent_high = ((recent_high - current_price) / current_price) * 100
            upside_to_avg_high = ((avg_high - current_price) / current_price) * 100
            
            # Only enter if there's at least 2% upside to recent highs
            min_upside = 2.0
            has_upside = upside_to_recent_high >= min_upside
            
            if not has_upside:
                console.print(f"[dim yellow]⚠️ {symbol}: Only {upside_to_recent_high:.1f}% upside left (need >{min_upside}%)[/dim yellow]")
            
            return has_upside
            
        except Exception as e:
            # If historical check fails, allow trade (failsafe)
            return True

    def _detect_pre_breakout_volume(self, symbol, row):
        """
        Detect early volume building before main FOMO spike (PREDICTIVE)
        Returns True if volume is building but not yet spiked (better entry timing)
        """
        try:
            current_volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            today_change = row.get('change', 0)
            rsi = row.get('RSI', 50)
            
            # PRE-BREAKOUT criteria (early detection)
            volume_building = 1.3 <= current_volume_ratio <= 2.5  # Building but not spiked yet
            controlled_move = 0.1 <= today_change <= 2.0         # Small controlled move
            rsi_healthy = 45 <= rsi <= 68                         # Healthy RSI range
            
            # Additional quality filters
            ema20 = row.get('EMA20', row['close'])
            price_near_support = row['close'] >= ema20 * 0.98     # Within 2% of EMA20
            
            is_pre_breakout = (volume_building and controlled_move and 
                             rsi_healthy and price_near_support)
            
            if is_pre_breakout:
                console.print(f"[green]🟢 {symbol}: PRE-BREAKOUT detected - Vol:{current_volume_ratio:.1f}x, "
                            f"Change:+{today_change:.1f}%, RSI:{rsi:.1f}[/green]")
            
            return is_pre_breakout
            
        except Exception as e:
            console.print(f"[red]❌ Pre-breakout detection error for {symbol}: {e}[/red]")
            return False

    def _detect_pullback_entry(self, symbol, row):
        """
        Detect pullback entry opportunities after initial momentum
        Returns True if stock is pulling back to good entry level
        """
        try:
            today_change = row.get('change', 0)
            rsi = row.get('RSI', 50)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            
            # PULLBACK criteria
            small_pullback = -0.8 <= today_change <= 0.5         # Minor pullback or flat
            rsi_cooling = 50 <= rsi <= 70                         # RSI cooling from overbought
            volume_normalizing = 1.2 <= volume_ratio <= 2.0      # Volume normalizing
            
            # Check if we're near support (EMA20)
            ema20 = row.get('EMA20', row['close'])
            near_ema20 = row['close'] >= ema20 * 0.99             # Very close to EMA20
            
            # Check recent strength (weekly performance should be positive)
            week_perf = row.get('Perf.W', 0)
            has_recent_strength = week_perf > 2                   # At least 2% weekly gain
            
            is_pullback_entry = (small_pullback and rsi_cooling and 
                               volume_normalizing and near_ema20 and has_recent_strength)
            
            if is_pullback_entry:
                console.print(f"[cyan]🔵 {symbol}: PULLBACK ENTRY detected - Change:{today_change:+.1f}%, "
                            f"RSI:{rsi:.1f}, near EMA20[/cyan]")
            
            return is_pullback_entry
            
        except Exception as e:
            console.print(f"[red]❌ Pullback detection error for {symbol}: {e}[/red]")
            return False

    def _check_momentum_cooling(self, symbol, row):
        """
        Check if momentum is cooling down from excessive levels (safer entry)
        Returns True if momentum has cooled to safer levels
        """
        try:
            rsi = row.get('RSI', 50)
            today_change = row.get('change', 0)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            
            # Get distance from 52w high
            price_52w_high = row.get('price_52_week_high', row['close'] * 1.1)
            current_price = row['close']
            distance_from_high = ((price_52w_high - current_price) / current_price) * 100
            
            # COOLING criteria (momentum has settled)
            rsi_cooled = 55 <= rsi <= 75                          # RSI in middle range
            moderate_move = -1.0 <= today_change <= 3.0           # Not extreme moves
            reasonable_distance = distance_from_high >= 5.0       # Not too close to highs
            volume_reasonable = volume_ratio <= 3.0               # Volume not extreme
            
            momentum_cooled = (rsi_cooled and moderate_move and 
                             reasonable_distance and volume_reasonable)
            
            if momentum_cooled:
                console.print(f"[blue]🔷 {symbol}: MOMENTUM COOLED - Safe entry window "
                            f"(RSI:{rsi:.1f}, {distance_from_high:.1f}% from high)[/blue]")
            
            return momentum_cooled
            
        except Exception as e:
            console.print(f"[red]❌ Momentum cooling check error for {symbol}: {e}[/red]")
            return False

    def _analyze_gap_fill_probability(self, symbol, current_gap_size, gap_direction, lookback_days=90):
        """Analyze historical gap-fill patterns to predict current gap-fill probability"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return {'probability': 50.0, 'historical_data': 'unavailable'}
            
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            # Fetch historical data for gap analysis
            try:
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
            except:
                # Fallback to shorter period if API fails
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days', 
                    interval=1,
                    to_date=to_date,
                    from_date=(datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                )
            
            if df is None or df.empty or len(df) < 10:
                return {'probability': 50.0, 'historical_data': 'insufficient'}
            
            # Handle different possible column structures from V3 API
            if isinstance(df, list):
                # V3 API returns array format: [timestamp, open, high, low, close, volume, oi]
                columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi']
                df = pd.DataFrame(df, columns=columns)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df = df.sort_values('timestamp').reset_index(drop=True)
            else:
                # Already DataFrame format
                timestamp_col = None
                for col in ['timestamp', 'datetime', 'date', 'time']:
                    if col in df.columns:
                        timestamp_col = col
                        break
                if timestamp_col:
                    df = df.sort_values(timestamp_col).reset_index(drop=True)
                else:
                    df = df.reset_index(drop=True)
            
            # Calculate gaps between consecutive days
            df['prev_close'] = df['close'].shift(1)
            df['gap_size'] = ((df['open'] - df['prev_close']) / df['prev_close'] * 100).round(2)
            df['gap_direction'] = df['gap_size'].apply(lambda x: 'UP' if x > 0.5 else 'DOWN' if x < -0.5 else 'NO_GAP')
            
            # Calculate if gaps get filled during the day
            df['gap_filled'] = False
            df['fill_percentage'] = 0.0
            
            for i in range(1, len(df)):
                if pd.notna(df.loc[i, 'gap_size']) and df.loc[i, 'gap_direction'] != 'NO_GAP':
                    prev_close = df.loc[i-1, 'close']
                    current_open = df.loc[i, 'open']
                    current_high = df.loc[i, 'high']
                    current_low = df.loc[i, 'low']
                    
                    if df.loc[i, 'gap_direction'] == 'UP':
                        # Gap up - filled if price goes back down to previous close
                        if current_low <= prev_close:
                            df.loc[i, 'gap_filled'] = True
                            df.loc[i, 'fill_percentage'] = 100.0
                        else:
                            # Partial fill calculation
                            gap_size_points = current_open - prev_close
                            filled_points = current_open - current_low
                            df.loc[i, 'fill_percentage'] = (filled_points / gap_size_points * 100) if gap_size_points > 0 else 0
                    
                    elif df.loc[i, 'gap_direction'] == 'DOWN':
                        # Gap down - filled if price goes back up to previous close
                        if current_high >= prev_close:
                            df.loc[i, 'gap_filled'] = True
                            df.loc[i, 'fill_percentage'] = 100.0
                        else:
                            # Partial fill calculation
                            gap_size_points = prev_close - current_open
                            filled_points = current_high - current_open
                            df.loc[i, 'fill_percentage'] = (filled_points / gap_size_points * 100) if gap_size_points > 0 else 0
            
            # Filter for similar gaps (within 1% of current gap size)
            similar_gaps = df[
                (df['gap_direction'] == gap_direction) & 
                (df['gap_direction'] != 'NO_GAP') &
                (abs(df['gap_size']) >= abs(current_gap_size) * 0.5) &  # At least 50% of current gap size
                (abs(df['gap_size']) <= abs(current_gap_size) * 2.0)    # No more than 200% of current gap size
            ].copy()
            
            if similar_gaps.empty:
                # No similar gaps found, use all gaps of same direction
                similar_gaps = df[df['gap_direction'] == gap_direction].copy()
            
            if similar_gaps.empty:
                return {'probability': 50.0, 'historical_data': 'no_similar_gaps'}
            
            # Calculate statistics
            total_gaps = len(similar_gaps)
            filled_gaps = similar_gaps['gap_filled'].sum()
            fill_rate = (filled_gaps / total_gaps * 100) if total_gaps > 0 else 50.0
            avg_fill_percentage = similar_gaps['fill_percentage'].mean()
            
            # Adjust probability based on current gap size
            size_multiplier = 1.0
            if abs(current_gap_size) > 5:  # Large gaps less likely to fill completely
                size_multiplier = 0.8
            elif abs(current_gap_size) > 3:
                size_multiplier = 0.9
            elif abs(current_gap_size) < 1:  # Small gaps more likely to fill
                size_multiplier = 1.1
            
            adjusted_probability = min(95.0, fill_rate * size_multiplier)
            
            return {
                'probability': round(adjusted_probability, 1),
                'total_similar_gaps': total_gaps,
                'filled_gaps': filled_gaps,
                'avg_fill_percentage': round(avg_fill_percentage, 1),
                'historical_data': 'available',
                'lookback_days': lookback_days
            }
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Gap analysis failed for {symbol}: {e}[/dim red]")
            return {'probability': 50.0, 'historical_data': 'error'}

    def _detect_support_resistance_levels(self, symbol, lookback_days=60):
        """Detect key support and resistance levels from historical OHLC data"""
        try:
            # Only use real historical data via Upstox API
            if hasattr(self, 'upstox_api') and self.upstox_api:
                return self._get_real_sr_levels_from_upstox(symbol, lookback_days)
            else:
                # No simulation fallback; mark unavailable
                console.print(f"[dim yellow]⚠️ S/R unavailable for {symbol} (Upstox API not initialized)[/dim yellow]")
                return {'levels': [], 'data_quality': 'unavailable'}
        except Exception as e:
            console.print(f"[dim red]⚠️ S/R analysis failed for {symbol}: {e}[/dim red]")
            # No simulation fallback on errors
            return {'levels': [], 'data_quality': 'error'}
    
    def _get_real_sr_levels_from_upstox(self, symbol, lookback_days=60):
        """Get real S/R levels using historical OHLC data from Upstox"""
        try:
            from datetime import datetime, timedelta
            import numpy as np
            
            # Calculate date range
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            # Fetch historical daily data (more reliable than intraday for S/R)
            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit="days", 
                interval=1,
                to_date=to_date,
                from_date=from_date
            )
            
            if df is None or df.empty:
                console.print(f"[dim yellow]No historical data for {symbol}[/dim yellow]")
                return {'levels': [], 'data_quality': 'insufficient_data'}
            
            # Get current price for context
            current_price = df['close'].iloc[-1]
            
            # Detect pivot highs and lows for S/R levels
            sr_levels = []
            
            # Method 1: Local maxima/minima (pivot points)
            window = 5  # Look for peaks/troughs over 5-day windows
            
            # Find resistance levels (pivot highs)
            for i in range(window, len(df) - window):
                if df['high'].iloc[i] == df['high'].iloc[i-window:i+window+1].max():
                    resistance_level = df['high'].iloc[i]
                    # Only include levels that are significant and near current price
                    if abs(resistance_level - current_price) / current_price < 0.15:  # Within 15%
                        sr_levels.append({
                            'price': resistance_level,
                            'level': resistance_level,  # Keep both for compatibility
                            'type': 'resistance',
                            'strength': 1,
                            'date': df.index[i].strftime('%Y-%m-%d')
                        })
            
            # Find support levels (pivot lows)  
            for i in range(window, len(df) - window):
                if df['low'].iloc[i] == df['low'].iloc[i-window:i+window+1].min():
                    support_level = df['low'].iloc[i]
                    # Only include levels that are significant and near current price
                    if abs(support_level - current_price) / current_price < 0.15:  # Within 15%
                        sr_levels.append({
                            'price': support_level,
                            'level': support_level,  # Keep both for compatibility  
                            'type': 'support', 
                            'strength': 1,
                            'date': df.index[i].strftime('%Y-%m-%d')
                        })
            
            # Method 2: Add psychological levels (round numbers)
            price_digits = len(str(int(current_price)))
            if price_digits >= 3:  # For stocks > ₹100
                step = 10 ** (price_digits - 2)  # ₹10 intervals for 100-999, ₹100 for 1000+
                for level in range(int(current_price // step - 2) * step, 
                                 int(current_price // step + 3) * step, step):
                    if level > 0 and abs(level - current_price) / current_price < 0.10:
                        level_type = 'resistance' if level > current_price else 'support'
                        sr_levels.append({
                            'price': float(level),
                            'level': float(level),  # Keep both for compatibility
                            'type': level_type,
                            'strength': 0.7,  # Psychological levels are slightly weaker
                            'date': 'psychological'
                        })
            
            # Remove duplicates and sort by proximity to current price
            unique_levels = {}
            for level_info in sr_levels:
                key = f"{level_info['type']}_{level_info['price']:.1f}"
                if key not in unique_levels or level_info['strength'] > unique_levels[key]['strength']:
                    unique_levels[key] = level_info
            
            final_levels = sorted(unique_levels.values(), 
                                key=lambda x: abs(x['price'] - current_price))
            
            # Limit to top 8 most relevant levels and add distance calculations
            final_levels = final_levels[:8]
            
            # Add distance_pct and strength categorization for compatibility
            for level_info in final_levels:
                level_info['distance_pct'] = abs(level_info['price'] - current_price) / current_price * 100
                # Convert numeric strength to categorical
                if level_info['strength'] >= 1.0:
                    level_info['strength'] = 'strong'
                elif level_info['strength'] >= 0.7:
                    level_info['strength'] = 'moderate'
                else:
                    level_info['strength'] = 'weak'
            
            return {
                'levels': final_levels,
                'current_price': current_price,
                'data_quality': 'historical',
                'data_points': len(df),
                'date_range': f"{from_date} to {to_date}"
            }
            
        except Exception as e:
            console.print(f"[dim red]Historical S/R failed for {symbol}: {e}[/dim red]")
            return {'levels': [], 'data_quality': 'error'}
    
    def _detect_gap_reversal_signals(self, symbol, gap_direction, current_price, gap_size):
        """Detect if a gap is showing reversal/exhaustion signals for safe counter-trend trading"""
        try:
            # Get intraday data to check for reversal patterns
            from datetime import datetime, timedelta
            
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return {'reversal_strength': 0, 'signals': [], 'recommendation': 'SKIP'}
            
            # Fetch 5-minute intraday data for current day
            today = datetime.now().strftime('%Y-%m-%d')
            
            try:
                df_5min = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=5,
                    to_date=today,
                    from_date=today
                )
            except:
                # Fallback to 15-minute if 5-minute fails
                df_5min = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=today,
                    from_date=today
                )
            
            if df_5min is None or df_5min.empty or len(df_5min) < 5:
                return {'reversal_strength': 0, 'signals': ['no_intraday_data'], 'recommendation': 'SKIP'}
            
            # Analyze reversal patterns
            signals = []
            reversal_strength = 0
            
            # Get recent candles (last 5 periods)
            recent_data = df_5min.tail(5).reset_index(drop=True)
            latest_candle = recent_data.iloc[-1]
            prev_candle = recent_data.iloc[-2] if len(recent_data) > 1 else latest_candle
            
            # 1. Volume Exhaustion Check
            if len(recent_data) >= 3:
                recent_volume = recent_data['volume'].tail(3).mean()
                earlier_volume = recent_data['volume'].head(2).mean() if len(recent_data) >= 5 else recent_volume
                
                if recent_volume < earlier_volume * 0.7:  # Volume declining
                    signals.append('volume_exhaustion')
                    reversal_strength += 2
            
            # 2. Price Action Reversal Patterns
            open_price = latest_candle['open']
            high_price = latest_candle['high'] 
            low_price = latest_candle['low']
            close_price = latest_candle['close']
            
            # Calculate candle characteristics
            body_size = abs(close_price - open_price)
            upper_wick = high_price - max(open_price, close_price)
            lower_wick = min(open_price, close_price) - low_price
            candle_range = high_price - low_price
            
            if gap_direction == 'UP':
                # For gap up, look for bearish reversal signals
                
                # Shooting Star / Doji at top
                if upper_wick > body_size * 2 and body_size < candle_range * 0.3:
                    signals.append('shooting_star_doji')
                    reversal_strength += 3
                
                # Failed to hold highs (close < open after gap up)
                if close_price < open_price:
                    signals.append('failed_to_hold_highs')
                    reversal_strength += 2
                
                # Lower high formation
                if len(recent_data) >= 2 and high_price < prev_candle['high']:
                    signals.append('lower_high')
                    reversal_strength += 1
                
                # High volume rejection at resistance
                if latest_candle['volume'] > recent_data['volume'].mean() * 1.5 and close_price < high_price * 0.98:
                    signals.append('volume_rejection')
                    reversal_strength += 2
                    
            elif gap_direction == 'DOWN':
                # For gap down, look for bullish reversal signals
                
                # Hammer / Doji at bottom
                if lower_wick > body_size * 2 and body_size < candle_range * 0.3:
                    signals.append('hammer_doji')
                    reversal_strength += 3
                
                # Failed to hold lows (close > open after gap down)
                if close_price > open_price:
                    signals.append('failed_to_hold_lows')
                    reversal_strength += 2
                
                # Higher low formation
                if len(recent_data) >= 2 and low_price > prev_candle['low']:
                    signals.append('higher_low')
                    reversal_strength += 1
                
                # High volume bounce from support
                if latest_candle['volume'] > recent_data['volume'].mean() * 1.5 and close_price > low_price * 1.02:
                    signals.append('volume_bounce')
                    reversal_strength += 2
            
            # 3. Overbought/Oversold Conditions (simple momentum check)
            if len(recent_data) >= 4:
                # Check if price has extended too far from opening range
                day_open = recent_data.iloc[0]['open']
                current_move = abs(close_price - day_open) / day_open * 100
                
                if current_move > abs(gap_size) * 1.5:  # Extended beyond 1.5x gap size
                    signals.append('overextended_move')
                    reversal_strength += 1
            
            # 4. Time-based exhaustion (gaps typically fill within first few hours)
            if len(df_5min) > 12:  # More than 1 hour of trading (12 x 5min candles)
                current_hour = datetime.now().hour
                if current_hour >= 11:  # After 11 AM, gap-fill probability decreases
                    if gap_size > 5:  # Only for significant gaps
                        signals.append('time_exhaustion')
                        reversal_strength += 1
            
            # Generate recommendation based on reversal strength
            if reversal_strength >= 5:
                recommendation = 'STRONG_COUNTER_TRADE'
            elif reversal_strength >= 3:
                recommendation = 'MODERATE_COUNTER_TRADE'
            elif reversal_strength >= 1:
                recommendation = 'WEAK_COUNTER_TRADE'
            else:
                recommendation = 'SKIP'  # No clear reversal signals
            
            return {
                'reversal_strength': reversal_strength,
                'signals': signals,
                'recommendation': recommendation,
                'latest_candle': {
                    'open': open_price,
                    'high': high_price, 
                    'low': low_price,
                    'close': close_price,
                    'volume': latest_candle['volume']
                },
                'analysis_time': datetime.now().strftime('%H:%M:%S')
            }
            
        except Exception as e:
            console.print(f"[dim red]Reversal analysis failed for {symbol}: {e}[/dim red]")
            return {'reversal_strength': 0, 'signals': ['error'], 'recommendation': 'SKIP'}
    
    # Removed: _simulate_sr_levels_from_current_data (simulation-based S/R) per "remove simulations"

    def _original_detect_support_resistance_levels(self, symbol, lookback_days=60):
        """Original historical S/R detection (requires Upstox API)"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return {'levels': [], 'data_quality': 'unavailable'}
            
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            # Fetch historical data
            try:
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
            except:
                # Fallback to shorter period
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=(datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                )
            
            if df is None or df.empty or len(df) < 10:
                console.print(f"[dim red]S/R: Insufficient data for {symbol} - got {len(df) if df is not None and not df.empty else 0} records[/dim red]")
                return {'levels': [], 'data_quality': 'insufficient'}
            
            # Handle V3 API data format
            if isinstance(df, list):
                columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi']
                df = pd.DataFrame(df, columns=columns)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df = df.sort_values('timestamp').reset_index(drop=True)
            else:
                timestamp_col = None
                for col in ['timestamp', 'datetime', 'date', 'time']:
                    if col in df.columns:
                        timestamp_col = col
                        break
                if timestamp_col:
                    df = df.sort_values(timestamp_col).reset_index(drop=True)
                else:
                    df = df.reset_index(drop=True)
            
            # Find pivot highs and lows
            window = 5  # Look for pivots in 5-day window
            pivot_highs = []
            pivot_lows = []
            
            for i in range(window, len(df) - window):
                # Check for pivot high
                is_pivot_high = True
                for j in range(i - window, i + window + 1):
                    if j != i and df.loc[j, 'high'] >= df.loc[i, 'high']:
                        is_pivot_high = False
                        break
                if is_pivot_high:
                    pivot_highs.append(df.loc[i, 'high'])
                
                # Check for pivot low
                is_pivot_low = True
                for j in range(i - window, i + window + 1):
                    if j != i and df.loc[j, 'low'] <= df.loc[i, 'low']:
                        is_pivot_low = False
                        break
                if is_pivot_low:
                    pivot_lows.append(df.loc[i, 'low'])
            
            # Cluster similar levels together (within 1% of each other)
            def cluster_levels(levels, tolerance=0.01):
                if not levels:
                    return []
                
                levels = sorted(levels)
                clusters = []
                current_cluster = [levels[0]]
                
                for level in levels[1:]:
                    if abs(level - current_cluster[-1]) / current_cluster[-1] <= tolerance:
                        current_cluster.append(level)
                    else:
                        clusters.append(sum(current_cluster) / len(current_cluster))
                        current_cluster = [level]
                
                clusters.append(sum(current_cluster) / len(current_cluster))
                return clusters
            
            # Get clustered resistance and support levels
            resistance_levels = cluster_levels(pivot_highs)
            support_levels = cluster_levels(pivot_lows)
            
            # Get current price for relative positioning
            current_price = df['close'].iloc[-1]
            
            # Classify levels relative to current price
            levels = []
            
            # Add resistance levels (above current price)
            for level in resistance_levels:
                if level > current_price:
                    distance_pct = ((level - current_price) / current_price * 100)
                    levels.append({
                        'type': 'resistance',
                        'price': round(level, 2),
                        'distance_pct': round(distance_pct, 2),
                        'strength': self._calculate_level_strength(level, pivot_highs)
                    })
            
            # Add support levels (below current price)
            for level in support_levels:
                if level < current_price:
                    distance_pct = ((current_price - level) / current_price * 100)
                    levels.append({
                        'type': 'support',
                        'price': round(level, 2),
                        'distance_pct': round(distance_pct, 2),
                        'strength': self._calculate_level_strength(level, pivot_lows)
                    })
            
            # Sort by distance from current price
            levels = sorted(levels, key=lambda x: x['distance_pct'])
            
            return {
                'levels': levels[:8],  # Return top 8 closest levels
                'current_price': round(current_price, 2),
                'data_quality': 'available',
                'lookback_days': lookback_days
            }
            
        except Exception as e:
            console.print(f"[dim red]⚠️ S/R analysis failed for {symbol}: {e}[/dim red]")
            return {'levels': [], 'data_quality': 'error'}
    
    def _calculate_level_strength(self, level, all_levels):
        """Delegate to shared utils to calculate level strength."""
        if tv_utils is None:
            return 'weak'
        return tv_utils.calculate_level_strength(level, all_levels)
    
    def _calculate_trend_target_probability(self, current_price, target_price, trend_strength, gap_direction):
        """Delegate to shared utils to calculate target probability."""
        if tv_utils is None:
            return 50.0
        return tv_utils.calculate_trend_target_probability(current_price, target_price, trend_strength, gap_direction)

    def _check_historical_trend(self, symbol, timeframe='daily', lookback_days=20):
        """Analyze historical trend using multiple indicators"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return 'neutral'  # No historical data available
                
            # Get historical data with proper date range
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            if timeframe == 'daily':
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
            else:  # hourly for shorter-term trend (limited to 90 days per documentation)
                # Limit hourly lookback to 90 days max due to API constraints
                hourly_lookback = min(lookback_days, 90)
                hourly_from_date = (datetime.now() - timedelta(days=hourly_lookback)).strftime('%Y-%m-%d')
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='hours',
                    interval=1,
                    to_date=to_date,
                    from_date=hourly_from_date
                )
            
            if df is None or df.empty or len(df) < 10:
                return 'neutral'  # Insufficient data
                
            # Debug: Print available columns to understand data structure
            # console.print(f"[dim]Debug: Available columns for {symbol}: {list(df.columns)}[/dim]")
            
            # Calculate trend indicators
            # Handle different possible timestamp column names
            timestamp_col = None
            for col in ['timestamp', 'datetime', 'date', 'time']:
                if col in df.columns:
                    timestamp_col = col
                    break
            
            if timestamp_col:
                df = df.sort_values(timestamp_col).reset_index(drop=True)
            else:
                # If no timestamp column, assume data is already sorted
                df = df.reset_index(drop=True)
            
            # 1. Price trend - Compare current vs moving averages
            df['sma_5'] = df['close'].rolling(5).mean()
            df['sma_10'] = df['close'].rolling(10).mean()
            df['sma_20'] = df['close'].rolling(20).mean() if len(df) >= 20 else df['close'].rolling(len(df)//2).mean()
            
            current_price = df['close'].iloc[-1]
            sma_5 = df['sma_5'].iloc[-1]
            sma_10 = df['sma_10'].iloc[-1]
            sma_20 = df['sma_20'].iloc[-1]
            
            # 2. Trend slope - Check if moving averages are ascending/descending
            sma_5_slope = (df['sma_5'].iloc[-1] - df['sma_5'].iloc[-3]) / 3 if len(df) >= 3 else 0
            sma_10_slope = (df['sma_10'].iloc[-1] - df['sma_10'].iloc[-5]) / 5 if len(df) >= 5 else 0
            
            # 3. Volume trend
            avg_volume = df['volume'].rolling(10).mean().iloc[-1] if len(df) >= 10 else df['volume'].mean()
            recent_volume = df['volume'].iloc[-3:].mean()  # Last 3 periods
            volume_strength = recent_volume / avg_volume if avg_volume > 0 else 1
            
            # 4. Price momentum (rate of change)
            price_change_5d = (current_price - df['close'].iloc[-6]) / df['close'].iloc[-6] * 100 if len(df) >= 6 else 0
            price_change_10d = (current_price - df['close'].iloc[-11]) / df['close'].iloc[-11] * 100 if len(df) >= 11 else 0
            
            # Trend scoring system
            trend_score = 0
            
            # Price vs MA alignment (40% weight)
            if current_price > sma_5 > sma_10 > sma_20:
                trend_score += 40  # Strong uptrend
            elif current_price > sma_5 > sma_10:
                trend_score += 25  # Moderate uptrend
            elif current_price > sma_5:
                trend_score += 10  # Weak uptrend
            elif current_price < sma_5 < sma_10 < sma_20:
                trend_score -= 40  # Strong downtrend
            elif current_price < sma_5 < sma_10:
                trend_score -= 25  # Moderate downtrend
            elif current_price < sma_5:
                trend_score -= 10  # Weak downtrend
            
            # MA slope trend (20% weight)
            if sma_5_slope > 0 and sma_10_slope > 0:
                trend_score += 20
            elif sma_5_slope > 0:
                trend_score += 10
            elif sma_5_slope < 0 and sma_10_slope < 0:
                trend_score -= 20
            elif sma_5_slope < 0:
                trend_score -= 10
            
            # Momentum (20% weight)
            if price_change_5d > 2 and price_change_10d > 1:
                trend_score += 20
            elif price_change_5d > 1:
                trend_score += 10
            elif price_change_5d < -2 and price_change_10d < -1:
                trend_score -= 20
            elif price_change_5d < -1:
                trend_score -= 10
            
            # Volume confirmation (20% weight)
            if volume_strength > 1.2:
                trend_score += 20
            elif volume_strength > 1.0:
                trend_score += 10
            elif volume_strength < 0.8:
                trend_score -= 10
            
            # Determine trend category
            if trend_score >= 40:
                return 'strong_bullish'
            elif trend_score >= 20:
                return 'bullish'
            elif trend_score >= -20:
                return 'neutral'
            elif trend_score >= -40:
                return 'bearish'
            else:
                return 'strong_bearish'
                
        except Exception as e:
            # Simplified trend analysis as fallback (avoids historical data API issues)
            return 'neutral'  # Return neutral when historical analysis fails

    # Use shared helper to display tables to avoid duplication
    def display_table(self, df, title, max_rows=15):
        """Display table - delegate to display_utils if available"""
        if self.display_utils:
            return self.display_utils.display_table(df, title, max_rows)
        # Original implementation follows below
        return helpers_display_table(df, title, max_rows, self.currency_symbol)

    # ==================== PRE-BREAKOUT STRATEGIES (NEW) ====================
    
    def _display_gap_fill_results(self, gap_df):
        """Deprecated: moved to tv_display.display_gap_fill_results"""
        if tv_display:
            return tv_display.display_gap_fill_results(gap_df)
        console.print("[red]tv_display module unavailable[/red]")

    def live_gap_fill_monitor_with_sr(self, refresh_interval=30):
        """
        🎯 LIVE GAP-FILL MONITOR WITH SUPPORT/RESISTANCE ANALYSIS
        ========================================================
        
        Real-time monitoring that combines:
        - TV screener volume movers with gap analysis
        - Support/resistance level detection
        - Trend-based probability for reaching S/R levels
        - Live price tracking with entry/exit signals
        """
        console.print(Panel.fit("🎯 LIVE GAP-FILL MONITOR WITH S/R ANALYSIS", style="bold cyan"))
        
        try:
            iteration = 0
            while True:
                iteration += 1
                start_time = time.time()
                
                # Clear screen for fresh update
                os.system('clear' if os.name == 'posix' else 'cls')
                
                # Header with current time
                current_time = datetime.now().strftime("%H:%M:%S")
                console.print(f"[bold cyan]🎯 LIVE GAP-FILL MONITOR WITH S/R LEVELS - {current_time}[/bold cyan]")
                console.print(f"[dim]Iteration: {iteration} | Refresh: {refresh_interval}s | Press Ctrl+C to stop[/dim]")
                console.print()
                
                # Get enhanced gap opportunities (multiple criteria)
                volume_movers = self._get_enhanced_gap_opportunities()
                
                if not volume_movers.empty:
                    # Analyze each stock for gap-fill and S/R levels
                    console.print("[dim]Analyzing gap-fill probabilities and S/R levels...[/dim]")
                    self._display_live_gap_sr_analysis(volume_movers)
                    
                    # Process paper trading opportunities if enabled
                    if self.paper_trading_enabled:
                        self._process_gap_fill_paper_trading(volume_movers)
                else:
                    console.print("[yellow]No significant volume movers with gaps found[/yellow]")
                
                # Wait for next refresh
                elapsed = time.time() - start_time
                sleep_time = max(0, refresh_interval - elapsed)
                
                if sleep_time > 0:
                    console.print(f"[dim]Next refresh in {sleep_time:.1f}s...[/dim]")
                    time.sleep(sleep_time)
                    
        except KeyboardInterrupt:
            console.print("\n[yellow]👋 Live gap-fill monitor stopped by user[/yellow]")
        except Exception as e:
            console.print(f"[red]Error in live monitor: {e}[/red]")
    
    def _process_gap_fill_paper_trading(self, df):
        """Process gap-fill trading opportunities for paper trading"""
        if not self.paper_trading_enabled or df.empty:
            return
        
        console.print("\n[dim]🤖 Evaluating paper trading opportunities...[/dim]")
        trades_executed = 0
        
        for _, row in df.iterrows():
            try:
                symbol = row['name']
                current_price = row['close']
                gap_size = row['change']
                vol_ratio = row['relative_volume_10d_calc']
                
                # Skip if we already have a position in this symbol
                has_position, existing_ticker = self._has_existing_position(symbol)
                if has_position:
                    console.print(f"[dim yellow]⚠️ Already have position in {symbol} - skipping[/dim yellow]")
                    continue
                
                # Determine gap direction
                gap_direction = 'UP' if gap_size > 0 else 'DOWN'
                
                # Get reversal analysis for significant gaps
                reversal_analysis = None
                if abs(gap_size) >= 0.8:
                    reversal_analysis = self._detect_gap_reversal_signals(
                        symbol=symbol,
                        gap_direction=gap_direction,
                        current_price=current_price,
                        gap_size=abs(gap_size)
                    )
                
                # Get S/R analysis
                sr_analysis = self._detect_support_resistance_levels(symbol, lookback_days=45)
                
                # Generate trading signal based on analysis
                trade_signal = self._evaluate_gap_fill_trade_signal(
                    symbol=symbol,
                    gap_size=gap_size,
                    gap_direction=gap_direction,
                    reversal_analysis=reversal_analysis,
                    sr_analysis=sr_analysis,
                    current_price=current_price
                )
                
                # Execute trade if signal is strong enough
                if trade_signal['action'] in ['STRONG_SHORT', 'STRONG_LONG', 'MODERATE_SHORT', 'MODERATE_LONG']:
                    success = self._execute_gap_fill_trade(
                        symbol=symbol,
                        signal=trade_signal,
                        current_price=current_price,
                        gap_size=gap_size,
                        vol_ratio=vol_ratio,
                        reversal_analysis=reversal_analysis
                    )
                    
                    if success:
                        trades_executed += 1
                        if trades_executed >= 3:  # Limit to 3 concurrent gap-fill trades
                            console.print("[dim]🚫 Max gap-fill trades limit reached (3)[/dim]")
                            break
                            
            except Exception as e:
                console.print(f"[dim red]❌ Error processing {symbol}: {e}[/dim red]")
                continue
        
        if trades_executed > 0:
            console.print(f"[green]✅ {trades_executed} gap-fill paper trades executed[/green]")
    
    def _evaluate_gap_fill_trade_signal(self, symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price):
        """Evaluate if gap-fill trade signal is strong enough for execution"""
        
        # Get gap fill probability
        gap_fill_prob = 50.0  # Default
        try:
            gap_analysis = self._analyze_gap_fill_probability(
                symbol=symbol,
                current_gap_size=abs(gap_size),
                gap_direction=gap_direction,
                lookback_days=60
            )
            gap_fill_prob = gap_analysis['probability']
        except:
            pass
        
        # Find next S/R level
        next_sr_level = None
        sr_probability = 0
        if sr_analysis['levels']:
            for level_info in sr_analysis['levels'][:3]:
                if level_info['strength'] in ['strong', 'moderate']:
                    next_sr_level = level_info
                    break
            if not next_sr_level and sr_analysis['levels']:
                next_sr_level = sr_analysis['levels'][0]
        
        # Calculate S/R probability if level exists
        if next_sr_level:
            sr_probability = self._calculate_trend_target_probability(
                current_price=current_price,
                target_price=next_sr_level['price'],
                trend_strength='neutral',
                gap_direction=gap_direction
            )
        
        # Decision logic with multiple criteria
        action = 'SKIP'
        confidence = 0
        reason = ""
        
        # Strong reversal signals for gap-fill trades
        if reversal_analysis and gap_fill_prob >= 60:
            reversal_strength = reversal_analysis['reversal_strength']
            reversal_recommendation = reversal_analysis['recommendation']
            
            if reversal_recommendation == 'STRONG_COUNTER_TRADE' and reversal_strength >= 5:
                action = 'STRONG_SHORT' if gap_direction == 'UP' else 'STRONG_LONG'
                confidence = min(0.85, (gap_fill_prob + reversal_strength * 10) / 100)
                reason = f"Strong reversal + {gap_fill_prob:.0f}% gap-fill prob"
                
            elif reversal_recommendation == 'MODERATE_COUNTER_TRADE' and reversal_strength >= 3:
                action = 'MODERATE_SHORT' if gap_direction == 'UP' else 'MODERATE_LONG'
                confidence = min(0.75, (gap_fill_prob + reversal_strength * 8) / 100)
                reason = f"Moderate reversal + {gap_fill_prob:.0f}% gap-fill prob"
                
            elif gap_fill_prob >= 75 and reversal_strength >= 2:
                action = 'WEAK_SHORT' if gap_direction == 'UP' else 'WEAK_LONG'
                confidence = min(0.65, gap_fill_prob / 100)
                reason = f"High gap-fill prob ({gap_fill_prob:.0f}%) + weak reversal"
        
        # S/R continuation trades (following gap direction) - only if no strong reversal
        elif sr_probability >= 75 and next_sr_level and (not reversal_analysis or reversal_analysis['reversal_strength'] < 3):
            sr_type = next_sr_level['type']
            if (gap_direction == 'UP' and sr_type == 'resistance') or (gap_direction == 'DOWN' and sr_type == 'support'):
                action = 'MODERATE_LONG' if gap_direction == 'UP' else 'MODERATE_SHORT'
                confidence = min(0.70, sr_probability / 100)
                reason = f"Trend continuation to {sr_type} ({sr_probability:.0f}% prob)"
        
        return {
            'action': action,
            'confidence': confidence,
            'reason': reason,
            'gap_fill_prob': gap_fill_prob,
            'sr_probability': sr_probability,
            'reversal_strength': reversal_analysis['reversal_strength'] if reversal_analysis else 0
        }
    
    def _execute_gap_fill_trade(self, symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis):
        """Execute gap-fill paper trade"""
        try:
            # Check trading hours
            if not self._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours[/yellow]")
                return False
            
            # Determine trade side
            if signal['action'] in ['STRONG_SHORT', 'MODERATE_SHORT', 'WEAK_SHORT']:
                trade_side = 'SELL'
                target_side = 'SHORT'
            elif signal['action'] in ['STRONG_LONG', 'MODERATE_LONG', 'WEAK_LONG']:
                trade_side = 'BUY'
                target_side = 'LONG'
            else:
                return False
            
            # Get live price validation
            live_price = self._get_live_price_from_upstox(symbol)
            if live_price and abs(live_price - current_price) / current_price > 0.02:
                console.print(f"[yellow]⚠️ Price moved too much for {symbol}: ₹{current_price:.2f} → ₹{live_price:.2f}[/yellow]")
                return False
            
            # Use live price if available, otherwise use current price
            execution_price = live_price if live_price else current_price
            
            # Calculate position size for ₹20,000
            quantity = max(1, int(20000 / execution_price))
            
            # Create alert-like structure for existing trading system
            gap_alert = {
                'ticker': symbol,
                'name': symbol,
                'price': execution_price,
                'change': gap_size,
                'type': 'GAP_FILL_TRADE',
                'confidence': signal['confidence'],
                'gap_direction': 'UP' if gap_size > 0 else 'DOWN',
                'reversal_strength': signal['reversal_strength'],
                'reason': signal['reason']
            }
            
            # Execute through existing paper trading system
            success = self._execute_screener_trade(
                symbol=symbol,
                side=trade_side,
                alert=gap_alert,
                price=execution_price,
                quantity=quantity,
                confidence=signal['confidence'],
                trend='gap_fill_' + target_side.lower()
            )
            
            if success:
                # Add to display with gap-specific info
                trade_info = {
                    'timestamp': datetime.now(),
                    'symbol': symbol,
                    'side': trade_side,
                    'price': execution_price,
                    'quantity': quantity,
                    'amount': quantity * execution_price,
                    'alert_type': 'GAP_FILL',
                    'confidence': signal['confidence'],
                    'gap_size': gap_size,
                    'reason': signal['reason']
                }
                
                self.live_trades.append(trade_info)
                if len(self.live_trades) > 10:
                    self.live_trades.pop(0)
                
                # Display execution
                gap_emoji = "📈" if gap_size > 0 else "📉"
                console.print(f"[green]🎯 GAP-FILL TRADE: {trade_side} {quantity} {symbol} @ ₹{execution_price:.2f} {gap_emoji} ({signal['reason']})[/green]")
                
                return True
                
        except Exception as e:
            console.print(f"[red]❌ Gap-fill trade execution failed for {symbol}: {e}[/red]")
            return False
        
        return False
    
    def _display_gap_fill_trading_status(self):
        """Display gap-fill specific paper trading status"""
        try:
            # Filter for gap-fill trades only
            gap_fill_trades = [trade for trade in self.live_trades if trade.get('alert_type') == 'GAP_FILL']
            
            if gap_fill_trades or self.closed_trades:
                console.print(f"\n[bold blue]📊 GAP-FILL PAPER TRADING STATUS:[/bold blue]")
                
                # Active gap-fill positions
                if gap_fill_trades:
                    console.print(f"[green]🟢 Active Gap-Fill Positions: {len(gap_fill_trades)}[/green]")
                    for trade in gap_fill_trades[-3:]:  # Show last 3
                        side_emoji = "📉" if trade['side'] == 'SELL' else "📈"
                        gap_size = trade.get('gap_size', 0)
                        reason = trade.get('reason', 'Gap trade')
                        console.print(f"  • {side_emoji} {trade['symbol']}: {trade['quantity']} @ ₹{trade['price']:.2f} ({gap_size:+.1f}% gap)")
                        console.print(f"    [dim]{reason}[/dim]")
                
                # Gap-fill specific stats
                total_gap_trades = len([t for t in self.closed_trades if t.get('alert_type') == 'GAP_FILL'])
                if total_gap_trades > 0:
                    gap_pnl = sum([t.get('pnl_amount', 0) for t in self.closed_trades if t.get('alert_type') == 'GAP_FILL'])
                    win_rate = len([t for t in self.closed_trades if t.get('alert_type') == 'GAP_FILL' and t.get('pnl_amount', 0) > 0]) / total_gap_trades * 100
                    console.print(f"[cyan]📈 Gap-Fill Stats: {total_gap_trades} trades | {win_rate:.1f}% win rate | ₹{gap_pnl:,.0f} P&L[/cyan]")
                
                # Trading limits
                console.print(f"[dim]💼 Position Limit: {len(gap_fill_trades)}/3 gap-fill trades | ₹20,000 per position[/dim]")
                
        except Exception as e:
            console.print(f"[dim red]Error displaying trading status: {e}[/dim red]")
    
    def _get_volume_movers_with_gaps(self):
        """Get current volume movers that have significant gaps"""
        try:
            # Use existing volume mover logic
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 30,
                    col('volume') > 500000,    # High volume
                    col('relative_volume_10d_calc') > 1.5,  # Above normal volume
                    col('market_cap_basic') > 5e7,  # Min 50 crores
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(10)  # Top 10 volume movers with gaps
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Filter for stocks with meaningful gaps (0.8% or more) after getting data
            if not df.empty:
                df = df[df['change'].abs() >= 0.8].copy()
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error fetching volume movers: {e}[/red]")
            return pd.DataFrame()
    
    def _get_enhanced_gap_opportunities(self):
        """Enhanced gap screening with multiple criteria beyond just volume movers"""
        all_opportunities = []
        
        try:
            # 1. HIGH VOLUME GAP STOCKS (Current approach)
            console.print("[dim]🔍 Scanning high volume gap stocks...[/dim]")
            volume_gaps = self._get_volume_movers_with_gaps()
            if not volume_gaps.empty:
                volume_gaps['source'] = 'volume_mover'
                all_opportunities.append(volume_gaps)
            
            # 2. LIQUID LARGE-CAP GAPS (Better quality, may have lower volume %)
            console.print("[dim]🔍 Scanning large-cap liquid gaps...[/dim]")
            total_rows, largecap_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Higher price filter
                    col('market_cap_basic') > 1e9,  # Min 1000 crores (large cap)
                    col('volume') > 1000000,  # High absolute volume
                    (col('change') > 1.2) | (col('change') < -1.2),  # Significant gaps
                    col('exchange') == 'NSE'
                )
                .order_by('market_cap_basic', ascending=False)  # Prefer larger caps
                .limit(8)
                .get_scanner_data(cookies=self.cookies)
            )
            
            if not largecap_gaps.empty:
                largecap_gaps['source'] = 'large_cap_gap'
                # Remove duplicates already found in volume movers
                existing_names = volume_gaps['name'].tolist() if not volume_gaps.empty else []
                largecap_gaps = largecap_gaps[~largecap_gaps['name'].isin(existing_names)]
                if not largecap_gaps.empty:
                    all_opportunities.append(largecap_gaps)
            
            # 3. MOMENTUM CONTINUATION GAPS (Strong trending stocks)
            console.print("[dim]🔍 Scanning momentum continuation gaps...[/dim]")
            total_rows, momentum_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 40,
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('volume') > 300000,
                    (col('change') > 2.0) | (col('change') < -2.0),  # Strong moves
                    col('RSI') > 70,  # Overbought (for gap downs) or strong momentum (gap ups)
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=False)  # Strongest moves first
                .limit(5)
                .get_scanner_data(cookies=self.cookies)
            )
            
            if not momentum_gaps.empty:
                momentum_gaps['source'] = 'momentum_gap'
                # Remove duplicates
                existing_names = []
                for opp in all_opportunities:
                    existing_names.extend(opp['name'].tolist())
                momentum_gaps = momentum_gaps[~momentum_gaps['name'].isin(existing_names)]
                if not momentum_gaps.empty:
                    all_opportunities.append(momentum_gaps)
            
            # 4. OVERSOLD BOUNCE GAPS (Gap downs in strong stocks)
            console.print("[dim]🔍 Scanning oversold bounce opportunities...[/dim]")
            total_rows, oversold_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 40,
                    col('market_cap_basic') > 5e8,  # Min 500 crores (quality stocks)
                    col('volume') > 500000,
                    col('change') < -1.5,  # Gap downs
                    col('RSI') < 40,  # Oversold condition
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=True)  # Biggest gap downs first
                .limit(5)
                .get_scanner_data(cookies=self.cookies)
            )
            
            if not oversold_gaps.empty:
                oversold_gaps['source'] = 'oversold_bounce'
                # Remove duplicates
                existing_names = []
                for opp in all_opportunities:
                    existing_names.extend(opp['name'].tolist())
                oversold_gaps = oversold_gaps[~oversold_gaps['name'].isin(existing_names)]
                if not oversold_gaps.empty:
                    all_opportunities.append(oversold_gaps)
            
            # Combine all opportunities
            if all_opportunities:
                combined_df = pd.concat(all_opportunities, ignore_index=True)
                
                # Add gap quality scoring
                combined_df['gap_quality_score'] = self._calculate_gap_quality_score(combined_df)
                
                # Sort by gap quality score (best opportunities first)
                combined_df = combined_df.sort_values('gap_quality_score', ascending=False)
                
                # Limit to top 15 best opportunities
                return combined_df.head(15)
            else:
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]Error in enhanced gap screening: {e}[/red]")
            # Fallback to simple volume mover approach
            return self._get_volume_movers_with_gaps()
    
    def _calculate_gap_quality_score(self, df):
        """Calculate a quality score for gap opportunities"""
        scores = []
        
        for _, row in df.iterrows():
            score = 0
            
            # Gap size factor (bigger gaps = higher score, but diminishing returns)
            gap_size = abs(row['change'])
            if gap_size >= 5:
                score += 5
            elif gap_size >= 3:
                score += 4
            elif gap_size >= 2:
                score += 3
            elif gap_size >= 1:
                score += 2
            else:
                score += 1
            
            # Volume factor (but not overweighted)
            vol_ratio = row.get('relative_volume_10d_calc', 1)
            if vol_ratio >= 3:
                score += 3
            elif vol_ratio >= 2:
                score += 2
            elif vol_ratio >= 1.5:
                score += 1
            
            # Market cap factor (prefer liquid stocks)
            market_cap = row.get('market_cap_basic', 0)
            if market_cap >= 5e9:  # 5000+ crores
                score += 3
            elif market_cap >= 1e9:  # 1000+ crores
                score += 2
            elif market_cap >= 5e8:  # 500+ crores
                score += 1
            
            # Price factor (avoid penny stocks)
            price = row.get('close', 0)
            if price >= 100:
                score += 2
            elif price >= 50:
                score += 1
            
            # Source bonus
            source = row.get('source', '')
            if source == 'large_cap_gap':
                score += 1  # Bonus for quality
            elif source == 'momentum_gap':
                score += 1  # Bonus for strong momentum
            
            scores.append(score)
        
        return scores
    
    def _display_live_gap_sr_analysis(self, df):
        """Display live gap-fill analysis with S/R levels"""
        if df.empty:
            return
        
        # Create main table
        table = Table(title="🎯 Live Gap-Fill Opportunities with S/R Analysis", show_header=True, header_style="bold cyan")
        table.add_column("Symbol", style="cyan", no_wrap=True)
        table.add_column("Price", justify="right", style="yellow")
        table.add_column("Gap", justify="right", style="bold")
        table.add_column("Volume", justify="right", style="red")
        table.add_column("Trend", justify="center", style="green")
        table.add_column("Gap Fill", justify="right", style="magenta")
        table.add_column("Next S/R", justify="right", style="blue")
        table.add_column("S/R Prob", justify="right", style="green")
        table.add_column("Signal", justify="center", style="bold")
        
        detailed_analysis = []
        
        for _, row in df.iterrows():
            symbol = row['name']
            current_price = row['close']
            gap_size = row['change']
            vol_ratio = row['relative_volume_10d_calc']
            
            # Determine gap direction
            gap_direction = 'UP' if gap_size > 0 else 'DOWN'
            
            # Get trend analysis (simplified for live monitoring)
            change = row.get('change', 0)
            rsi = row.get('RSI', 50)
            trend_score = 0
            
            if change > 2 and rsi > 60:
                trend_strength = 'bullish'
            elif change < -2 and rsi < 40:
                trend_strength = 'bearish'
            else:
                trend_strength = 'neutral'
            
            # Get S/R levels
            console.print(f"[dim]Analyzing S/R for {symbol}...[/dim]")
            sr_analysis = self._detect_support_resistance_levels(symbol, lookback_days=45)
            console.print(f"[dim]S/R result for {symbol}: {sr_analysis['data_quality']} - {len(sr_analysis['levels'])} levels found[/dim]")
            
            # Get gap fill probability (quick version for live monitoring)
            gap_fill_prob = 50.0  # Default
            try:
                gap_analysis = self._analyze_gap_fill_probability(
                    symbol=symbol,
                    current_gap_size=abs(gap_size),
                    gap_direction=gap_direction,
                    lookback_days=60  # Shorter for speed
                )
                gap_fill_prob = gap_analysis['probability']
            except:
                pass
            
            # Find next significant S/R level
            next_sr_level = None
            sr_probability = 0
            sr_type = ""
            
            if sr_analysis['levels']:
                # Find the closest significant level
                for level_info in sr_analysis['levels'][:3]:  # Check top 3 closest levels
                    if level_info['strength'] in ['strong', 'moderate']:
                        next_sr_level = level_info
                        break
                
                if not next_sr_level and sr_analysis['levels']:
                    next_sr_level = sr_analysis['levels'][0]  # Take closest even if weak
                
                if next_sr_level:
                    sr_probability = self._calculate_trend_target_probability(
                        current_price=current_price,
                        target_price=next_sr_level['price'],
                        trend_strength=trend_strength,
                        gap_direction=gap_direction
                    )
                    sr_type = next_sr_level['type']
            
            # Format display values
            price_display = f"₹{current_price:,.2f}"
            gap_color = "green" if gap_size > 0 else "red"
            gap_display = f"[{gap_color}]{gap_size:+.2f}%[/{gap_color}]"
            vol_display = f"{vol_ratio:.1f}x"
            
            # Trend display
            if trend_strength == 'bullish':
                trend_display = "[green]📈 Bull[/green]"
            elif trend_strength == 'bearish':
                trend_display = "[red]📉 Bear[/red]"
            else:
                trend_display = "[yellow]➡️ Neutral[/yellow]"
            
            # Gap fill probability
            fill_color = "green" if gap_fill_prob >= 60 else "yellow" if gap_fill_prob >= 40 else "red"
            fill_display = f"[{fill_color}]{gap_fill_prob:.0f}%[/{fill_color}]"
            
            # S/R level display
            if next_sr_level:
                sr_emoji = "🔴" if sr_type == "resistance" else "🟢"
                sr_display = f"{sr_emoji} ₹{next_sr_level['price']:.1f} ({next_sr_level['distance_pct']:.1f}%)"
                prob_color = "green" if sr_probability >= 60 else "yellow" if sr_probability >= 40 else "red"
                prob_display = f"[{prob_color}]{sr_probability:.0f}%[/{prob_color}]"
            else:
                sr_display = "[dim]No clear level[/dim]"
                prob_display = "[dim]N/A[/dim]"
            
            # Get reversal analysis for gap-fill trades
            reversal_analysis = None
            if abs(gap_size) >= 0.8:  # Only analyze significant gaps
                console.print(f"[dim]Checking reversal signals for {symbol}...[/dim]")
                reversal_analysis = self._detect_gap_reversal_signals(
                    symbol=symbol,
                    gap_direction=gap_direction,
                    current_price=current_price,
                    gap_size=abs(gap_size)
                )
            
            # Enhanced Trading signal with reversal confirmation
            signal = "[dim]❌ SKIP[/dim]"
            signal_reason = ""
            
            # For gap-fill trades, require reversal confirmation
            if gap_fill_prob >= 60 and reversal_analysis:
                reversal_strength = reversal_analysis['reversal_strength']
                reversal_recommendation = reversal_analysis['recommendation']
                
                if reversal_recommendation in ['STRONG_COUNTER_TRADE', 'MODERATE_COUNTER_TRADE']:
                    # Strong reversal signals detected - safe to counter-trade
                    if gap_direction == 'UP' and sr_type == 'support':
                        signal = f"[bold red]📉 SHORT[/bold red]"
                        signal_reason = f"Reversal confirmed ({reversal_strength} signals)"
                    elif gap_direction == 'DOWN' and sr_type == 'resistance':
                        signal = f"[bold green]📈 LONG[/bold green]"
                        signal_reason = f"Reversal confirmed ({reversal_strength} signals)"
                    elif gap_fill_prob >= 70 and reversal_strength >= 3:
                        if gap_direction == 'UP':
                            signal = "[red]📉 SHORT (Gap Fill + Reversal)[/red]"
                        else:
                            signal = "[green]📈 LONG (Gap Fill + Reversal)[/green]"
                        signal_reason = f"Gap fill + reversal ({reversal_strength} signals)"
                elif reversal_recommendation == 'WEAK_COUNTER_TRADE' and gap_fill_prob >= 75:
                    # Weak reversal but high gap-fill probability
                    if gap_direction == 'UP':
                        signal = "[dim red]📉 WEAK SHORT[/dim red]"
                    else:
                        signal = "[dim green]📈 WEAK LONG[/dim green]"
                    signal_reason = f"Weak reversal, high gap-fill prob"
                else:
                    # No clear reversal - avoid counter-trend trade
                    signal = "[yellow]⚠️ NO REVERSAL[/yellow]"
                    signal_reason = f"Gap continues ({', '.join(reversal_analysis['signals'][:2])})"
            
            # For trend continuation trades (following the gap direction)
            elif sr_probability >= 70 and next_sr_level:
                if sr_type == 'resistance' and gap_direction == 'UP':
                    # Gap up heading to resistance - momentum trade
                    if not reversal_analysis or reversal_analysis['reversal_strength'] < 3:
                        signal = "[green]📈 LONG to R[/green]"
                        signal_reason = "Trend continuation"
                elif sr_type == 'support' and gap_direction == 'DOWN':
                    # Gap down heading to support - momentum trade  
                    if not reversal_analysis or reversal_analysis['reversal_strength'] < 3:
                        signal = "[red]📉 SHORT to S[/red]"
                        signal_reason = "Trend continuation"
            
            # Add reversal signals info to the signal display
            if reversal_analysis and reversal_analysis['signals']:
                top_signals = reversal_analysis['signals'][:2]  # Show top 2 signals
                signal_details = ', '.join(top_signals).replace('_', ' ').title()
                if signal_reason:
                    signal_reason += f" | {signal_details}"
                else:
                    signal_reason = signal_details
            
            # Combine signal and reason for display
            if signal_reason and len(signal_reason) < 50:
                signal_with_reason = f"{signal}\n[dim]{signal_reason}[/dim]"
            else:
                signal_with_reason = signal
            
            table.add_row(
                symbol[:12],
                price_display,
                gap_display,
                vol_display,
                trend_display,
                fill_display,
                sr_display,
                prob_display,
                signal_with_reason
            )
            
            # Store for detailed analysis
            detailed_analysis.append({
                'symbol': symbol,
                'current_price': current_price,
                'gap_size': gap_size,
                'gap_direction': gap_direction,
                'trend': trend_strength,
                'gap_fill_prob': gap_fill_prob,
                'sr_level': next_sr_level,
                'sr_probability': sr_probability,
                'reversal_analysis': reversal_analysis,
                'signal': signal,
                'signal_reason': signal_reason
            })
        
        console.print(table)
        
        # Display paper trading summary if enabled
        if self.paper_trading_enabled:
            self._display_gap_fill_trading_status()
        
        # Display top recommendations
        high_prob_trades = [item for item in detailed_analysis if item['gap_fill_prob'] >= 60 or item['sr_probability'] >= 70]
        
        if high_prob_trades:
            console.print(f"\n[bold yellow]🏆 TOP LIVE RECOMMENDATIONS:[/bold yellow]")
            for i, trade in enumerate(high_prob_trades[:3], 1):
                symbol = trade['symbol']
                gap_size = trade['gap_size']
                gap_prob = trade['gap_fill_prob']
                sr_prob = trade['sr_probability']
                
                if gap_prob >= 60:
                    direction = "SHORT" if trade['gap_direction'] == 'UP' else "LONG"
                    console.print(f"{i}. [cyan]{symbol}[/cyan]: {direction} gap-fill ({gap_size:+.2f}% gap, {gap_prob:.0f}% probability)")
                elif sr_prob >= 70 and trade['sr_level']:
                    sr_type = trade['sr_level']['type']
                    sr_price = trade['sr_level']['price']
                    direction = "LONG" if sr_type == 'resistance' else "SHORT"
                    console.print(f"{i}. [cyan]{symbol}[/cyan]: {direction} to {sr_type} ₹{sr_price:.1f} ({sr_prob:.0f}% probability)")
        
        console.print(f"\n[bold yellow]📊 LEGEND:[/bold yellow]")
        console.print("• [green]Gap Fill:[/green] Probability of gap closing today")
        console.print("• [blue]Next S/R:[/blue] 🔴 Resistance (above) | 🟢 Support (below)")
        console.print("• [green]S/R Prob:[/green] Probability of reaching next S/R level")
        console.print("• [bold]Signal:[/bold] Trading recommendation based on analysis")

    def _display_sector_table(self, sector_df, title):
        """Deprecated: moved to tv_display.display_sector_table"""
        if tv_display:
            return tv_display.display_sector_table(sector_df, title)
        console.print("[red]tv_display module unavailable[/red]")
    
    # ==================== INTRADAY WATCH MODE ====================
    
    def wait_until_market_open(self):
        """Wait until market open time before starting active monitoring"""
        if tv_time_utils:
            return tv_time_utils.wait_until_market_open(self.paper_trading_enabled, self.market)
        # Fallback implementation
        if not self.paper_trading_enabled:
            console.print("[green]✅ Paper trading disabled - starting monitoring immediately (watch mode)[/green]")
            return
            
        # Skip waiting for US market - always start immediately since US market hours are different
        if self.market == 'us':
            console.print("[green]✅ US Market - starting monitoring immediately (no wait)[/green]")
            return
            
        # For Indian market with paper trading enabled, wait until 9:20 AM IST
        target_time = datetime.now().replace(hour=9, minute=16, second=0, microsecond=0)
        current_time = datetime.now()
        
        # If we're past 9:20 AM today, start immediately
        if current_time >= target_time:
            console.print("[green]✅ Indian market open time reached - starting active monitoring[/green]")
            return
        
        # Calculate wait time
        wait_seconds = (target_time - current_time).total_seconds()
        wait_minutes = int(wait_seconds // 60)
        wait_secs = int(wait_seconds % 60)
        
        console.print(f"[yellow]⏰ Paper trading enabled - waiting until 9:20 AM IST to start trading...[/yellow]")
        console.print(f"[blue]Current time: {current_time.strftime('%H:%M:%S')} IST[/blue]")
        console.print(f"[blue]Target time: 9:20:00 IST[/blue]")
        console.print(f"[yellow]Time remaining: {wait_minutes}m {wait_secs}s[/yellow]")
        console.print()
        
        # Wait with periodic updates
        while datetime.now() < target_time:
            remaining = (target_time - datetime.now()).total_seconds()
            if remaining <= 0:
                break
                
            mins = int(remaining // 60)
            secs = int(remaining % 60)
            
            # Update every 30 seconds
            if int(remaining) % 30 == 0:
                # Clear screen and show countdown
                os.system('clear' if os.name == 'posix' else 'cls')
                console.print("[bold yellow]⏰ WAITING FOR TRADING HOURS (Paper Trading)[/bold yellow]")
                console.print(f"[dim]Current time: {datetime.now().strftime('%H:%M:%S')}[/dim]")
                console.print(f"[blue]🕘 {mins}m {secs}s until active monitoring starts (9:20 AM IST)[/blue]")
                console.print("[dim]Press Ctrl+C to stop[/dim]")
            
            time.sleep(1)
        
        # Clear screen and show start message
        os.system('clear' if os.name == 'posix' else 'cls')
        console.print("[green]🚀 9:20 AM IST reached - starting paper trading mode![/green]")
        time.sleep(2)

    def _detect_alerts(self, current_data, previous_data, volume_threshold, price_threshold):
        """Detect volume spikes and price movements with cooldown protection"""
        alerts = []
        
        if previous_data.empty:
            return alerts
            
        for _, row in current_data.iterrows():
            ticker = row['ticker']
            
            # Volume spike alert
            if row['relative_volume_10d_calc'] > volume_threshold:
                prev_vol = previous_data[previous_data['ticker'] == ticker]['relative_volume_10d_calc'].values
                if len(prev_vol) > 0 and row['relative_volume_10d_calc'] > prev_vol[0] * 1.2:
                    
                    # Check cooldown
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'VOLUME_SPIKE')
                    if should_skip:
                        if "STOP_LOSS_COOLDOWN" in skip_reason:
                            console.print(f"[dim red]⏳ Skipping {ticker} VOLUME_SPIKE - {skip_reason}[/dim red]")
                        else:
                            console.print(f"[dim]⏳ Skipping {ticker} VOLUME_SPIKE (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                        continue
                    
                    # Calculate confidence
                    confidence = self._calculate_alert_confidence('VOLUME_SPIKE', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                    
                    # Only send if confidence is high enough (relaxed for FOMO mode)
                    if confidence >= 0.3:  # 30% minimum confidence
                        alert = {
                            'type': 'VOLUME_SPIKE',
                            'ticker': ticker,
                            'name': row['name'],
                            'current_volume_ratio': row['relative_volume_10d_calc'],
                            'previous_volume_ratio': prev_vol[0] if len(prev_vol) > 0 else 0,
                            'price': row['close'],
                            'change': row['change'],
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        
                        # Record alert time to prevent spam
                        self.last_alert_time[f"{ticker}_VOLUME_SPIKE"] = datetime.now()
                    else:
                        console.print(f"[yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping {ticker}[/yellow]")
            
            # Price movement alert
            if abs(row['change']) > price_threshold:
                prev_change = previous_data[previous_data['ticker'] == ticker]['change'].values
                if len(prev_change) > 0 and abs(row['change']) > abs(prev_change[0]) * 1.1:
                    
                    # Check cooldown
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'PRICE_MOVE')
                    if should_skip:
                        if "STOP_LOSS_COOLDOWN" in skip_reason:
                            console.print(f"[dim red]⏳ Skipping {ticker} PRICE_MOVE - {skip_reason}[/dim red]")
                        else:
                            console.print(f"[dim]⏳ Skipping {ticker} PRICE_MOVE (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                        continue
                    
                    # Calculate confidence
                    confidence = self._calculate_alert_confidence('PRICE_MOVE', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                    
                    # Only send if confidence is high enough (relaxed for FOMO mode)
                    if confidence >= 0.3:  # 30% minimum confidence
                        alert = {
                            'type': 'PRICE_MOVE',
                            'ticker': ticker,
                            'name': row['name'],
                            'current_change': row['change'],
                            'previous_change': prev_change[0] if len(prev_change) > 0 else 0,
                            'price': row['close'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        
                        # Record alert time to prevent spam
                        self.last_alert_time[f"{ticker}_PRICE_MOVE"] = datetime.now()
                    else:
                        console.print(f"[yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping {ticker}[/yellow]")
            
            # Enhanced Smart FOMO alert - IMPROVED TIMING for better entries
            watch_mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
            
            # IMPROVED TIMING: Check for different entry opportunities based on timing
            pre_breakout_detected = self._detect_pre_breakout_volume(ticker, row)
            pullback_entry_detected = self._detect_pullback_entry(ticker, row)
            momentum_cooled = self._check_momentum_cooling(ticker, row)
            
            # Original FOMO conditions (now as fallback for existing strong signals)
            original_fomo = (row['relative_volume_10d_calc'] > max(volume_threshold, 2.0) and  
                           (row['change'] > 1 or row['change'] < -1) and
                           self._check_not_buying_at_top(ticker, row))
            
            # SMART_FOMO triggers on ANY of these improved timing conditions
            smart_fomo_trigger = (
                pre_breakout_detected or           # BEST: Early volume building
                pullback_entry_detected or         # GOOD: Pullback to support  
                momentum_cooled or                 # SAFE: Momentum has cooled
                (original_fomo and self._check_historical_upside(ticker, row['close']))  # FALLBACK: Original logic
            )
            
            if (smart_fomo_trigger and  
                self._check_momentum_divergence(ticker, row, previous_data)):  # Quality check
                
                # Check cooldown - REMOVED: No restrictions for SMART_FOMO
                # should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'SMART_FOMO')
                # if should_skip:
                #     if "STOP_LOSS_COOLDOWN" in skip_reason:
                #         console.print(f"[dim red]⏳ Skipping {ticker} SMART_FOMO - {skip_reason}[/dim red]")
                #     else:
                #         console.print(f"[dim]⏳ Skipping {ticker} SMART_FOMO (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                #     continue
                
                # Determine which timing condition triggered for better tracking
                timing_type = "ORIGINAL"
                if pre_breakout_detected:
                    timing_type = "PRE_BREAKOUT"
                    confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None)) + 0.15  # Bonus for early entry
                elif pullback_entry_detected:
                    timing_type = "PULLBACK"
                    confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None)) + 0.10  # Bonus for pullback
                elif momentum_cooled:
                    timing_type = "COOLED"
                    confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None)) + 0.05  # Small bonus for cooled
                else:
                    confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                
                # Cap confidence at 95%
                confidence = min(confidence, 0.95)
                
                # Adjust minimum confidence based on timing quality (from config)
                min_confidence = (self.config.signal_filtering.min_confidence_prebreak_pullback 
                                if timing_type in ["PRE_BREAKOUT", "PULLBACK"] 
                                else self.config.signal_filtering.min_confidence_regular)
                
                if confidence >= min_confidence:
                    alert = {
                        'type': 'SMART_FOMO',
                        'ticker': ticker,
                        'name': row['name'],
                        'volume_ratio': row['relative_volume_10d_calc'],
                        'price': row['close'],
                        'change': row['change'],
                        'upside_potential': f'Validated-{timing_type}',
                        'confidence': confidence,
                        'timing_type': timing_type
                    }
                    alerts.append(alert)
                    
                    # Record alert time to prevent spam - REMOVED: No restrictions for SMART_FOMO
                    # self.last_alert_time[f"{ticker}_SMART_FOMO"] = datetime.now()
                else:
                    console.print(f"[yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping {ticker}[/yellow]")
            
            # Mode-specific alerts - each mode has its own logic matching its purpose
            if watch_mode == 'MOMENTUM':
                # Early momentum: RSI improving + small moves before big ones
                rsi_current = row.get('RSI', 50)
                rsi_prev = row.get('RSI[1]', 50)
                macd = row.get('MACD.macd', 0)
                macd_signal = row.get('MACD.signal', 0)
                
                if (0.5 <= row['change'] <= 4 and  # Small positive moves (before FOMO)
                    1.1 <= row['relative_volume_10d_calc'] <= 2.5 and  # Slightly elevated volume
                    35 <= rsi_current <= 70 and  # RSI sweet spot
                    rsi_current > rsi_prev and  # RSI improving
                    macd > macd_signal):  # MACD bullish
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'EARLY_MOMENTUM')
                    if not should_skip:
                        confidence = self._calculate_alert_confidence('EARLY_MOMENTUM', row['relative_volume_10d_calc'], row['change'], rsi_current)
                        if confidence >= 0.25:
                            alert = {
                                'type': 'EARLY_MOMENTUM',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': row['relative_volume_10d_calc'],
                                'price': row['close'],
                                'change': row['change'],
                                'rsi': rsi_current,
                                'rsi_trend': 'Improving' if rsi_current > rsi_prev else 'Stable',
                                'confidence': confidence
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_EARLY_MOMENTUM"] = datetime.now()
            
            elif watch_mode == 'ACCUMULATION':
                # Accumulation: Normal volume, controlled price, building strength
                if (0.8 <= row['relative_volume_10d_calc'] <= 1.8 and  # Normal volume (accumulation)
                    -2 <= row['change'] <= 3 and  # Controlled price movement
                    40 <= row.get('RSI', 50) <= 65 and  # Building strength
                    row['close'] > row.get('EMA20', row['close'])):  # Above trend
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'ACCUMULATION')
                    if not should_skip:
                        confidence = self._calculate_alert_confidence('ACCUMULATION', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                        if confidence >= 0.25:
                            alert = {
                                'type': 'ACCUMULATION',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': row['relative_volume_10d_calc'],
                                'price': row['close'],
                                'change': row['change'],
                                'rsi': row.get('RSI', 0),
                                'trend': 'Above EMA20',
                                'confidence': confidence
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_ACCUMULATION"] = datetime.now()
            
            elif watch_mode == 'PREBREAKOUT':
                # Pre-breakout: High RSI, building volume, testing resistance
                if (1.2 <= row['relative_volume_10d_calc'] <= 3.0 and  # Building volume
                    1 <= row['change'] <= 5 and  # Moderate positive moves
                    65 <= row.get('RSI', 50) <= 85):  # High RSI (pre-breakout)
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'PREBREAKOUT')
                    if not should_skip:
                        confidence = self._calculate_alert_confidence('PREBREAKOUT', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                        if confidence >= 0.25:
                            alert = {
                                'type': 'PREBREAKOUT',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': row['relative_volume_10d_calc'],
                                'price': row['close'],
                                'change': row['change'],
                                'rsi': row.get('RSI', 0),
                                'status': 'Testing Resistance',
                                'confidence': confidence
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_PREBREAKOUT"] = datetime.now()
            
            elif watch_mode == 'OPTIMIZED_GAP':
                # Gap strategy: Quality gaps with momentum continuation
                week_high = row.get('price_52_week_high', row['close'] * 2)
                distance_from_high = (week_high - row['close']) / week_high * 100
                
                if (1 <= row['change'] <= 15 and  # Quality gap range
                    row['relative_volume_10d_calc'] > 1.5 and  # Volume confirmation
                    distance_from_high > 20 and  # Not at 52-week high
                    row.get('Volatility.D', 0) < 0.08):  # Not too volatile
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'GAP_BREAKOUT')
                    if not should_skip:
                        confidence = self._calculate_alert_confidence('GAP_BREAKOUT', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                        if confidence >= 0.25:
                            alert = {
                                'type': 'GAP_BREAKOUT',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': row['relative_volume_10d_calc'],
                                'price': row['close'],
                                'change': row['change'],
                                'gap_quality': 'Quality Gap',
                                'confidence': confidence
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_GAP_BREAKOUT"] = datetime.now()
            
            elif watch_mode == 'HEAVY_BREAKOUT':
                # Heavy Breakout: Real-time channel analysis with support/resistance levels
                breakout_score = row.get('breakout_score', 0)
                active_channels = row.get('active_channels', 0)
                recent_breakouts = row.get('recent_breakouts', 0)
                support_level = row.get('support_level')
                resistance_level = row.get('resistance_level')
                breakout_type = row.get('breakout_type')
                breakout_strength = row.get('breakout_strength', 0)
                
                # Enhanced criteria using real-time channel analysis
                if (breakout_score > 40 and  # High breakout potential from channel analysis
                    (recent_breakouts > 0 or active_channels > 0) and  # Has patterns
                    row['relative_volume_10d_calc'] > 1.2 and  # Volume confirmation
                    abs(row['change']) >= 1):  # Meaningful price movement
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'HEAVY_BREAKOUT')
                    if not should_skip:
                        # Calculate enhanced confidence based on channel analysis
                        confidence = min(0.95, (breakout_score / 100) + 0.3)
                        
                        # Determine trade direction and levels
                        if recent_breakouts > 0 and breakout_type:
                            if breakout_type == 'bullish':
                                trade_direction = 'LONG'
                                entry_level = resistance_level
                                stop_loss = support_level
                                target = resistance_level + ((resistance_level - support_level) * 1.5) if support_level and resistance_level else None
                            else:  # bearish
                                trade_direction = 'SHORT'
                                entry_level = support_level
                                stop_loss = resistance_level
                                target = support_level - ((resistance_level - support_level) * 1.5) if support_level and resistance_level else None
                        else:
                            # Active channel - wait for breakout
                            trade_direction = 'WATCH'
                            entry_level = row['close']
                            stop_loss = None
                            target = None
                        
                        alert = {
                            'type': 'HEAVY_BREAKOUT',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'price': row['close'],
                            'change': row['change'],
                            'breakout_score': breakout_score,
                            'pattern': f"{breakout_type.title()} Breakout" if breakout_type else "Channel Setup",
                            'confidence': confidence,
                            # Trading levels
                            'trade_direction': trade_direction,
                            'support_level': support_level,
                            'resistance_level': resistance_level,
                            'entry_level': entry_level,
                            'stop_loss': stop_loss,
                            'target': target,
                            'breakout_strength': breakout_strength,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_HEAVY_BREAKOUT"] = datetime.now()
            
            elif watch_mode == 'FOMO_MOMENTUM':
                # FOMO Momentum: Directional momentum trading on 0.8-6% moves
                change_pct = row['change']
                volume_ratio = row['relative_volume_10d_calc']
                rsi_current = row.get('RSI', 50)
                
                # Check if this matches our momentum criteria (same as mode definition)
                if ((0.8 <= change_pct <= 6.0) or (-6.0 <= change_pct <= -0.8)) and \
                   volume_ratio > 1.3 and \
                   35 <= rsi_current <= 75 and \
                   row.get('Volatility.D', 0) > 0.02:
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'FOMO_MOMENTUM')
                    if not should_skip:
                        # Determine direction and calculate confidence
                        direction = 'LONG' if change_pct > 0 else 'SHORT'
                        
                        # Enhanced confidence based on momentum strength and volume
                        base_confidence = min(abs(change_pct) / 6.0, 1.0)  # Stronger moves = higher confidence
                        volume_boost = min((volume_ratio - 1.3) / 2.0, 0.3)  # Volume adds up to 30% confidence
                        rsi_factor = 1.0 if 45 <= rsi_current <= 65 else 0.8  # Optimal RSI range
                        
                        confidence = min(0.95, (base_confidence + volume_boost) * rsi_factor)
                        
                        if confidence >= 0.3:  # Relaxed confidence threshold for momentum trades
                            alert = {
                                'type': 'FOMO_MOMENTUM',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': volume_ratio,
                                'price': row['close'],
                                'change': change_pct,
                                'direction': direction,
                                'rsi': rsi_current,
                                'volatility': row.get('Volatility.D', 0) * 100,
                                'confidence': confidence
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_FOMO_MOMENTUM"] = datetime.now()
            
            elif watch_mode == 'REALTIME_MOMENTUM':
                # REALTIME Momentum: Continuous price action detection on short intervals
                if hasattr(self, 'momentum_signals') and ticker in self.momentum_signals:
                    signal_info = self.momentum_signals[ticker]
                    
                    # Check if we have a valid momentum signal
                    if (signal_info['consecutive_count'] >= 3 and  # Minimum consecutive moves
                        signal_info['direction'] != 'NEUTRAL' and  # Clear direction
                        signal_info['last_signal_time'] and
                        (datetime.now() - signal_info['last_signal_time']).total_seconds() < 300):  # Signal is recent (5 min)
                        
                        should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'REALTIME_MOMENTUM')
                        if not should_skip:
                            # Calculate momentum strength from recent data
                            history = self.momentum_history.get(ticker, [])
                            momentum_strength = 0.0
                            if len(history) >= 2:
                                # Calculate average price change over recent intervals
                                recent_moves = []
                                for i in range(1, min(len(history), 5)):
                                    prev_price = history[i-1][1]
                                    curr_price = history[i][1]
                                    move_pct = abs((curr_price - prev_price) / prev_price) * 100
                                    recent_moves.append(move_pct)
                                momentum_strength = sum(recent_moves) / len(recent_moves) if recent_moves else 0.0
                            
                            # Enhanced confidence based on consecutive count and momentum strength
                            base_confidence = min(signal_info['consecutive_count'] / 5.0, 0.8)  # Up to 80% from consecutive moves
                            strength_boost = min(momentum_strength / 2.0, 0.15)  # Up to 15% from momentum strength
                            volume_factor = min(row['relative_volume_10d_calc'] / 2.0, 0.05)  # Small volume boost
                            
                            confidence = min(0.95, base_confidence + strength_boost + volume_factor)
                            
                            if confidence >= 0.35:  # Relaxed confidence threshold for real-time momentum
                                alert = {
                                    'type': 'REALTIME_MOMENTUM',
                                    'ticker': ticker,
                                    'name': row['name'],
                                    'volume_ratio': row['relative_volume_10d_calc'],
                                    'price': row['close'],
                                    'change': row['change'],
                                    'direction': signal_info['direction'],
                                    'consecutive_moves': signal_info['consecutive_count'],
                                    'momentum_strength': momentum_strength,
                                    'confidence': confidence
                                }
                                alerts.append(alert)
                                self.last_alert_time[f"{ticker}_REALTIME_MOMENTUM"] = datetime.now()
            
            elif watch_mode == 'SR_LEVELS_BREAK':
                # SR Levels Break: Detect aggressive breakouts of support/resistance levels
                current_price = row['close']
                volume_ratio = row.get('relative_volume_10d_calc', 1.0)
                change_pct = row.get('change', 0)
                
                # Get S/R levels for the symbol
                sr_analysis = self._detect_support_resistance_levels(ticker, lookback_days=30)
                
                if sr_analysis['levels']:
                    for level_info in sr_analysis['levels']:
                        level_price = level_info['price']
                        level_type = level_info['type']
                        distance_from_level_pct = ((current_price - level_price) / level_price) * 100
                        
                        # Aggressive breakout criteria
                        # Price has moved significantly past the level AND high volume
                        aggressive_break_threshold_pct = 0.5  # 0.5% break beyond the level
                        min_volume_for_break = 2.0 # Minimum 2x relative volume for a break
                        
                        should_trigger = False
                        action_type = None
                        
                        if level_type == 'resistance' and distance_from_level_pct >= aggressive_break_threshold_pct:
                            # Aggressive long: Price breaks resistance and stays above
                            if volume_ratio >= min_volume_for_break:
                                should_trigger = True
                                action_type = 'LONG'
                                console.print(f"[green]📈 {ticker}: AGGRESSIVE LONG - Broke Resistance at ₹{level_price:.2f}[/green]")
                        elif level_type == 'support' and distance_from_level_pct <= -aggressive_break_threshold_pct:
                            # Aggressive short: Price breaks support and stays below
                            if volume_ratio >= min_volume_for_break:
                                should_trigger = True
                                action_type = 'SHORT'
                                console.print(f"[red]📉 {ticker}: AGGRESSIVE SHORT - Broke Support at ₹{level_price:.2f}[/red]")
                        
                        if should_trigger:
                            should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'SR_LEVELS_BREAK')
                            if not should_skip:
                                confidence = self._calculate_alert_confidence(
                                    'SR_LEVELS_BREAK', volume_ratio, change_pct, row.get('RSI', None)
                                )
                                # Boost confidence for aggressive breaks
                                confidence = min(0.95, confidence + 0.15)
                                
                                if confidence >= 0.6: # High confidence required for aggressive trades
                                    alert = {
                                        'type': 'SR_LEVELS_BREAK',
                                        'ticker': ticker,
                                        'name': row['name'],
                                        'price': current_price,
                                        'change': change_pct,
                                        'volume_ratio': volume_ratio,
                                        'level_broken': level_price,
                                        'level_type': level_type,
                                        'action_type': action_type,
                                        'confidence': confidence
                                    }
                                    alerts.append(alert)
                                    self.last_alert_time[f"{ticker}_SR_LEVELS_BREAK"] = datetime.now()
                                else:
                                    console.print(f"[yellow]⚠️ {ticker}: SR Levels Break signal confidence too low ({confidence:.0%})[/yellow]")
        
        # Universal overbought short detection - available in all modes
        for _, row in current_data.iterrows():
            ticker = row['ticker']
            rsi = row.get('RSI', 50)
            change_pct = row.get('change', 0)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            
            # Check for overbought short opportunities with confirmed downtrend (from config)
            if (rsi >= self.config.signal_filtering.overbought_rsi_threshold and  # Overbought RSI
                volume_ratio >= self.config.signal_filtering.min_volume_ratio and  # Decent volume  
                change_pct > self.config.signal_filtering.min_change_overbought):  # Stock has moved up (potential reversal)
                
                # RELAXED downtrend requirement for FOMO mode
                confirmed_downtrend = self._check_confirmed_downtrend_for_short(ticker, row)
                if not confirmed_downtrend and rsi < 85:  # Only require confirmation for less extreme RSI
                    console.print(f"[yellow]⚠️ {ticker}: Overbought but no confirmed downtrend - skipping short[/yellow]")
                    continue
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'OVERBOUGHT_SHORT')
                if not should_skip:
                    # Get 15min RSI for intraday confirmation
                    rsi_15min = self._get_15min_rsi(ticker)
                    
                    # Use overextended check for additional confirmation
                    is_overextended = self._is_overextended_for_short(ticker)
                    
                    # Enhanced logic: Require 15min RSI confirmation if available
                    rsi_confirmed = True  # Default to allow signal
                    if rsi_15min is not None:
                        # 15min RSI should also be overbought for strong confirmation (from config)
                        rsi_confirmed = rsi_15min >= self.config.signal_filtering.min_15_rsi_confirmation
                        console.print(f"[dim yellow]📊 {ticker}: Daily RSI {rsi:.1f}, 15min RSI {rsi_15min:.1f}[/dim yellow]")
                    
                    if rsi_confirmed:
                        # Calculate confidence for short signal (boost if 15min confirms)
                        confidence = self._calculate_short_confidence(rsi, change_pct, volume_ratio, is_overextended)
                        if rsi_15min is not None and rsi_15min >= self.config.signal_filtering.strong_15_rsi_threshold:
                            confidence += self.config.signal_filtering.confidence_bonus  # Bonus for strong 15min confirmation
                        
                        if confidence >= self.config.signal_filtering.min_confidence_short:
                            alert = {
                                'type': 'OVERBOUGHT_SHORT',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': volume_ratio,
                                'price': row['close'],
                                'change': change_pct,
                                'rsi': rsi,
                                'rsi_15min': rsi_15min,
                                'reason': '15min RSI Confirmed' if rsi_15min else 'Daily RSI Only',
                                'confidence': confidence,
                                'is_overextended': is_overextended
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_OVERBOUGHT_SHORT"] = datetime.now()
                            
                            # Enhanced logging with both RSI values
                            rsi_str = f"Daily {rsi:.1f}"
                            if rsi_15min:
                                rsi_str += f", 15min {rsi_15min:.1f}"
                            console.print(f"[red]🔴 {ticker}: OVERBOUGHT SHORT - {rsi_str}, +{change_pct:.1f}%, {volume_ratio:.1f}x vol[/red]")
                        else:
                            console.print(f"[yellow]⚠️ {ticker}: Overbought but confidence too low ({confidence:.0%})[/yellow]")
                    else:
                        console.print(f"[yellow]⚠️ {ticker}: Daily RSI {rsi:.1f} overbought but 15min RSI {rsi_15min:.1f} not confirmed[/yellow]")
        
        return alerts
    
    def _should_skip_alert(self, ticker, alert_type):
        """Check if we should skip this alert due to cooldown"""
        current_time = datetime.now()
        alert_key = f"{ticker}_{alert_type}"
        
        # First check if symbol hit stop loss recently (30-minute cooldown)
        if ticker in self.stop_loss_cooldown:
            stop_loss_time_diff = (current_time - self.stop_loss_cooldown[ticker]).total_seconds()
            if stop_loss_time_diff < self.stop_loss_cooldown_duration:
                cooldown_left = self.stop_loss_cooldown_duration - stop_loss_time_diff
                return True, stop_loss_time_diff, f"STOP_LOSS_COOLDOWN ({cooldown_left/60:.0f}m left)"
        
        # Check if this exact alert was sent recently
        if alert_key in self.last_alert_time:
            time_diff = (current_time - self.last_alert_time[alert_key]).total_seconds()
            if time_diff < self.alert_cooldown:
                return True, time_diff, "ALERT_COOLDOWN"
        
        return False, 0, ""
    
    def _check_daily_entry_limit(self, symbol):
        """Check if symbol has reached daily entry limit (max 2 per day)"""
        from datetime import date
        today = date.today().isoformat()
        
        if symbol not in self.daily_entry_count:
            return False, 0
            
        if today not in self.daily_entry_count[symbol]:
            return False, 0
            
        entries_today = self.daily_entry_count[symbol][today]
        if entries_today >= self.max_daily_entries_per_stock:
            return True, entries_today
            
        return False, entries_today
    
    def _increment_daily_entry_count(self, symbol):
        """Increment daily entry count for a symbol"""
        from datetime import date
        today = date.today().isoformat()
        
        if symbol not in self.daily_entry_count:
            self.daily_entry_count[symbol] = {}
            
        if today not in self.daily_entry_count[symbol]:
            self.daily_entry_count[symbol][today] = 0
            
        self.daily_entry_count[symbol][today] += 1
    
    def _check_loss_cooldown(self, symbol):
        """Check if symbol is in loss-based cooldown (30+ minutes after loss)"""
        if symbol not in self.loss_cooldown:
            return False, 0
            
        current_time = datetime.now()
        loss_time_diff = (current_time - self.loss_cooldown[symbol]).total_seconds()
        
        if loss_time_diff < self.loss_cooldown_duration:
            cooldown_left = self.loss_cooldown_duration - loss_time_diff
            return True, cooldown_left
            
        return False, 0
    
    def _check_confirmed_downtrend_for_short(self, symbol, row):
        """Check if confirmed downtrend exists before allowing short (price < VWAP + bearish volume)"""
        try:
            current_price = row['close']
            
            # Get VWAP if available, otherwise estimate using volume-weighted price
            vwap = row.get('VWAP', current_price)  # Fallback to current price if no VWAP
            
            # Check if price is below VWAP (bearish condition)
            price_below_vwap = current_price < vwap
            
            # Check for bearish volume (volume above average with negative price action)
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            change = row.get('change', 0)
            
            # Bearish volume: elevated volume with negative or weak positive move (from config)
            bearish_volume = (volume_ratio > self.config.downtrend.min_volume_ratio_bearish and 
                             change < self.config.downtrend.max_change_bearish)
            
            # Additional trend confirmation
            ema20 = row.get('EMA20', current_price)
            ema50 = row.get('EMA50', current_price)
            
            # Stronger confirmation: price below moving averages
            below_ema20 = current_price < ema20
            ema_bearish = ema20 < ema50  # 20 EMA below 50 EMA
            
            # Relaxed downtrend confirmation for FOMO mode
            confirmed_downtrend = price_below_vwap or bearish_volume or (below_ema20 and ema_bearish)  # OR instead of AND
            
            if confirmed_downtrend:
                console.print(f"[dim green]✅ {symbol}: Confirmed downtrend for short - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim green]")
            else:
                console.print(f"[dim yellow]⚠️ {symbol}: No confirmed downtrend - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim yellow]")
            
            return confirmed_downtrend
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Error checking downtrend for {symbol}: {e}[/dim red]")
            return False  # Conservative approach - don't short if can't confirm
    
    def _calculate_alert_confidence(self, alert_type, volume_ratio, change_pct, rsi=None):
        """Calculate confidence score using shared tv_utils to avoid duplication"""
        if tv_utils is None:
            # Fallback confidence calculation for FOMO mode (much more aggressive)
            confidence = 0.5  # Base confidence boosted from 0.2 to 0.5
            
            # Volume factor
            if volume_ratio >= 10.0:
                confidence += 0.3
            elif volume_ratio >= 5.0:
                confidence += 0.2
            elif volume_ratio >= 2.0:
                confidence += 0.1
            
            # Price change factor
            if abs(change_pct) >= 5.0:
                confidence += 0.2
            elif abs(change_pct) >= 2.0:
                confidence += 0.1
            
            # RSI factor (if available)
            if rsi is not None:
                if 40 <= rsi <= 70:  # Good RSI range
                    confidence += 0.1
            
            return min(confidence, 0.95)
        return tv_utils.calculate_alert_confidence(alert_type, volume_ratio, change_pct, rsi)
    
    def _calculate_short_confidence(self, rsi, change_pct, volume_ratio, is_overextended):
        """Calculate confidence for short signals based on overbought conditions"""
        confidence = 0.4  # Base confidence for short signals
        
        # RSI factor (higher RSI = higher short confidence)
        if rsi >= 80:
            confidence += 0.3  # Very overbought
        elif rsi >= 75:
            confidence += 0.2  # Overbought
        elif rsi >= 70:
            confidence += 0.1  # Slightly overbought
        
        # Price move factor (larger moves = higher reversal probability)
        if change_pct >= 8:
            confidence += 0.25  # Large move
        elif change_pct >= 5:
            confidence += 0.15  # Medium move  
        elif change_pct >= 3:
            confidence += 0.1   # Small move
        
        # Volume confirmation
        if volume_ratio >= 4.0:
            confidence += 0.2  # High volume
        elif volume_ratio >= 2.5:
            confidence += 0.15  # Medium volume
        elif volume_ratio >= 1.5:
            confidence += 0.1   # Elevated volume
        
        # Overextended bonus
        if is_overextended:
            confidence += 0.15
        
        return min(confidence, 0.95)  # Cap at 95%
    
    def _get_15min_rsi(self, symbol):
        """Get 15min RSI from Upstox for intraday confirmation"""
        try:
            import talib
            
            # Fetch 15min data for last 3 days (enough for RSI calculation)
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
            
            # Use the existing Upstox API
            if hasattr(self, 'upstox_api') and self.upstox_api:
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=to_date,
                    from_date=from_date
                )
                
                if df is not None and len(df) >= 14:  # Need at least 14 periods for RSI
                    # Calculate 15min RSI
                    rsi = talib.RSI(df['close'], timeperiod=14)
                    current_15min_rsi = rsi.iloc[-1]  # Latest RSI value
                    
                    return current_15min_rsi
            
            return None  # Return None if data unavailable
            
        except Exception as e:
            # Fallback silently - don't break the main flow
            return None
    
    def send_telegram_alert(self, alert):
        """Send a Telegram alert for a new event via shared tv_alerts utility"""
        if not self.telegram_enabled:
            return
        if tv_alerts is None:
            return

        # Delegate to shared alerts module (keeps original formatting/logic)
        tv_alerts.send_telegram_alert(
            alert=alert,
            telegram_config=TELEGRAM_CONFIG,
            paper_trading_enabled=self.paper_trading_enabled,
            trading_action_resolver=(lambda a: self._get_trading_action(a)) if hasattr(self, "_get_trading_action") else None
        )

    def _display_alerts(self, alerts):
        """Display alerts in a formatted way and send to both Telegram and Paper Trading Bot"""
        for alert in alerts:
            # Process alert for paper trading (telegram alerts sent only on actual trades)
            self._process_paper_trading_alert(alert)
            
            # Display alert
            if alert['type'] == 'VOLUME_SPIKE':
                console.print(f"[bold red]🔥 VOLUME SPIKE:[/bold red] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Volume: {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)")
                console.print(f"   Price: {self.format_price(alert['price'])} ({alert['change']:+.2f}%)")
                
            elif alert['type'] == 'PRICE_MOVE':
                direction = "🚀" if alert['current_change'] > 0 else "📉"
                console.print(f"[bold yellow]{direction} PRICE_MOVE:[/bold yellow] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Change: {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)")
                console.print(f"   Price: {self.format_price(alert['price'])} | Volume: {alert['volume_ratio']:.1f}x")
            
            elif alert['type'] == 'HEAVY_BREAKOUT':
                # Enhanced heavy breakout alert with trading levels
                direction_emoji = "🚀" if alert.get('trade_direction') == 'LONG' else "📉" if alert.get('trade_direction') == 'SHORT' else "⚡"
                console.print(f"[bold red]{direction_emoji} HEAVY BREAKOUT:[/bold red] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Pattern: {alert.get('pattern', 'Channel Breakout')} (Score: {alert.get('breakout_score', 0):.0f})")
                console.print(f"   Price: {self.format_price(alert['price'])} ({alert['change']:+.2f}%) | Volume: {alert['volume_ratio']:.1f}x")
                
                # Show support/resistance levels
                support = alert.get('support_level')
                resistance = alert.get('resistance_level')
                if support and resistance:
                    console.print(f"   📊 Support: {self.format_price(support)} | Resistance: {self.format_price(resistance)}")
                
                # Show trading setup
                trade_direction = alert.get('trade_direction', 'WATCH')
                if trade_direction == 'LONG':
                    entry = alert.get('entry_level')
                    stop = alert.get('stop_loss')
                    target = alert.get('target')
                    console.print(f"   🎯 LONG SETUP: Entry {self.format_price(entry)} | Stop {self.format_price(stop)} | Target {self.format_price(target)}")
                elif trade_direction == 'SHORT':
                    entry = alert.get('entry_level')
                    stop = alert.get('stop_loss')
                    target = alert.get('target')
                    console.print(f"   🎯 SHORT SETUP: Entry {self.format_price(entry)} | Stop {self.format_price(stop)} | Target {self.format_price(target)}")
                else:
                    console.print(f"   👀 WATCH: Channel setup - wait for breakout above/below levels")
                
                # Show breakout strength if available
                strength = alert.get('breakout_strength', 0)
                if strength > 0:
                    console.print(f"   💪 Breakout Strength: {strength:.1f}%")
            
            elif alert['type'] == 'FOMO_MOMENTUM':
                # FOMO Momentum alert display
                direction = alert.get('direction', 'UNKNOWN')
                direction_emoji = "🚀" if direction == 'LONG' else "📉"
                direction_color = "green" if direction == 'LONG' else "red"
                
                console.print(f"[bold {direction_color}]{direction_emoji} FOMO MOMENTUM:[/bold {direction_color}] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Direction: {direction} | Change: {alert['change']:+.2f}% | Price: {self.format_price(alert['price'])}")
                console.print(f"   Volume: {alert['volume_ratio']:.1f}x | RSI: {alert['rsi']:.1f} | Volatility: {alert['volatility']:.1f}%")
                console.print(f"   🎯 Momentum Confidence: {alert['confidence']:.0%}")
            
            elif alert['type'] == 'REALTIME_MOMENTUM':
                # Real-time momentum alert display
                direction = alert.get('direction', 'UNKNOWN')
                consecutive_moves = alert.get('consecutive_moves', 0)
                momentum_strength = alert.get('momentum_strength', 0)
                direction_emoji = "⚡🚀" if direction == 'UP' else "⚡📉"
                direction_color = "green" if direction == 'UP' else "red"
                
                console.print(f"[bold {direction_color}]{direction_emoji} REALTIME MOMENTUM:[/bold {direction_color}] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Direction: {direction} | Consecutive: {consecutive_moves} moves | Change: {alert['change']:+.2f}%")
                console.print(f"   Price: {self.format_price(alert['price'])} | Volume: {alert['volume_ratio']:.1f}x")
                console.print(f"   🔥 Momentum Strength: {momentum_strength:.2f}% | Confidence: {alert['confidence']:.0%}")
            
            # Show trading action taken
            if self.paper_trading_enabled:
                trade_action = self._get_trading_action(alert)
                console.print(f"   [cyan]💰 Trading Action: {trade_action}[/cyan]")
    
    def format_price(self, price: float) -> str:
        """Format price with correct currency symbol based on market"""
        if tv_price_utils:
            return tv_price_utils.format_price(price, self.currency_symbol)
        # Fallback
        return f"{self.currency_symbol}{price:.2f}"
    
    def _add_realtime_momentum_analysis(self, df):
        """Add real-time momentum analysis to detect continuous price action"""
        from tv_modes import get_market_config
        
        current_time = datetime.now()
        config = get_market_config(self.market)
        momentum_config = config['realtime_momentum']
        
        interval_seconds = momentum_config['interval_seconds']
        min_consecutive = momentum_config['min_consecutive_moves']
        min_threshold = momentum_config['min_move_threshold']
        
        # Add momentum tracking columns
        df['momentum_direction'] = 'NEUTRAL'
        df['consecutive_moves'] = 0
        df['momentum_strength'] = 0.0
        df['momentum_signal'] = False
        
        for _, row in df.iterrows():
            ticker = row['ticker']
            current_price = row['close']
            current_change = row['change']
            
            # Initialize tracking for new ticker
            if ticker not in self.momentum_history:
                self.momentum_history[ticker] = []
                self.momentum_signals[ticker] = {
                    'direction': 'NEUTRAL',
                    'consecutive_count': 0,
                    'last_signal_time': None
                }
            
            # Add current data point
            self.momentum_history[ticker].append((current_time, current_price, current_change))
            
            # Keep only recent data (last 10 intervals)
            cutoff_time = current_time - timedelta(seconds=interval_seconds * 10)
            self.momentum_history[ticker] = [
                (t, p, c) for t, p, c in self.momentum_history[ticker] 
                if t > cutoff_time
            ]
            
            # Analyze momentum if we have enough data points
            history = self.momentum_history[ticker]
            if len(history) >= 3:  # Need at least 3 points to detect momentum
                momentum_direction, consecutive_count, strength = self._calculate_momentum_signal(history, min_threshold)
                
                # Update tracking
                signal_info = self.momentum_signals[ticker]
                
                if momentum_direction != 'NEUTRAL':
                    if signal_info['direction'] == momentum_direction:
                        signal_info['consecutive_count'] = consecutive_count
                    else:
                        # Direction changed, reset count
                        signal_info['direction'] = momentum_direction
                        signal_info['consecutive_count'] = consecutive_count
                    
                    # Check if we have enough consecutive moves for a signal
                    if consecutive_count >= min_consecutive:
                        df.loc[df['ticker'] == ticker, 'momentum_signal'] = True
                        df.loc[df['ticker'] == ticker, 'momentum_direction'] = momentum_direction
                        df.loc[df['ticker'] == ticker, 'consecutive_moves'] = consecutive_count
                        df.loc[df['ticker'] == ticker, 'momentum_strength'] = strength
                        
                        signal_info['last_signal_time'] = current_time
                
        return df
    
    def _calculate_momentum_signal(self, history, min_threshold):
        """Calculate momentum signal from price history"""
        if len(history) < 3:
            return 'NEUTRAL', 0, 0.0
        
        # Sort by timestamp
        history = sorted(history, key=lambda x: x[0])
        
        # Calculate price movements between intervals
        movements = []
        for i in range(1, len(history)):
            prev_price = history[i-1][1]
            curr_price = history[i][1]
            price_move = ((curr_price - prev_price) / prev_price) * 100
            movements.append(price_move)
        
        if not movements:
            return 'NEUTRAL', 0, 0.0
        
        # Detect consecutive moves in same direction
        consecutive_up = 0
        consecutive_down = 0
        current_consecutive = 0
        last_direction = None
        
        for move in movements:
            if abs(move) >= min_threshold:  # Significant move
                if move > 0:  # Up move
                    if last_direction == 'UP':
                        current_consecutive += 1
                    else:
                        current_consecutive = 1
                        last_direction = 'UP'
                    consecutive_up = max(consecutive_up, current_consecutive)
                elif move < 0:  # Down move
                    if last_direction == 'DOWN':
                        current_consecutive += 1
                    else:
                        current_consecutive = 1
                        last_direction = 'DOWN'
                    consecutive_down = max(consecutive_down, current_consecutive)
            else:
                current_consecutive = 0
                last_direction = None
        
        # Determine overall momentum
        strength = sum(abs(m) for m in movements) / len(movements)
        
        if consecutive_up >= consecutive_down and consecutive_up > 0:
            return 'UP', consecutive_up, strength
        elif consecutive_down > consecutive_up and consecutive_down > 0:
            return 'DOWN', consecutive_down, strength
        else:
            return 'NEUTRAL', 0, strength
    
    def _get_base_symbol(self, ticker):
        """Extract base symbol from exchange:symbol format"""
        if tv_data_utils:
            return tv_data_utils.get_base_symbol(ticker)
        # Fallback
        if ':' in ticker:
            return ticker.split(':')[1]
        return ticker
    
    def _has_existing_position(self, ticker):
        """Check if we already have a position in this base symbol (any exchange)"""
        base_symbol = self._get_base_symbol(ticker)
        
        for existing_ticker in self.positions:
            if self.positions[existing_ticker]:  # Active position
                existing_base = self._get_base_symbol(existing_ticker)
                if base_symbol == existing_base:
                    return True, existing_ticker
        return False, None
    
    def _process_gap_paper_trading_alert(self, alert):
        """Process optimized gap strategy alert for paper trading with 15-min timeframe logic"""
        if not self.paper_trading_enabled:
            return
        
        try:
            ticker = alert.get('ticker', '')
            symbol = alert.get('symbol', ticker)
            price = alert.get('price', 0)
            quality_score = alert.get('quality_score', 0)
            
            # Only trade high-quality gaps (score >= 80)
            if quality_score < 80:
                console.print(f"   [yellow]⚠️ {symbol} quality score {quality_score:.0f} < 80 - skipping[/yellow]")
                return
            
            # Check for existing position
            has_position, existing_ticker = self._has_existing_position(ticker)
            if has_position:
                console.print(f"   [yellow]⚠️ Already have position in {symbol} - skipping[/yellow]")
                return
            
            # Gap strategy specific parameters
            target_pct = alert.get('target_pct', 2.5)
            stop_loss_pct = alert.get('stop_loss_pct', 1.0)
            timeframe = alert.get('timeframe', '15min')
            
            # Create gap-specific trade entry
            trade_data = {
                'symbol': symbol,
                'action': 'BUY',  # Gap strategy is long-only
                'quantity': int(20000 / price),  # ₹20,000 position size
                'price': price,
                'target_price': price * (1 + target_pct/100),
                'stop_loss_price': price * (1 - stop_loss_pct/100),
                'strategy': 'OPTIMIZED_GAP_15MIN',
                'timeframe': timeframe,
                'confidence': alert.get('confidence', 0.8),
                'entry_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'reason': alert.get('reason', f"Gap trade with {quality_score:.0f}/100 score"),
                'expected_win_rate': 68.4,  # From backtesting
                'risk_reward_ratio': target_pct / stop_loss_pct
            }
            
            # Add to live trades tracking
            self.live_trades.append(trade_data)
            
            # Log the trade
            console.print(f"   [green]✅ GAP TRADE INITIATED:[/green]")
            console.print(f"      Symbol: {symbol}")
            console.print(f"      Entry: ₹{price:.2f}")
            console.print(f"      Target: ₹{trade_data['target_price']:.2f} (+{target_pct}%)")
            console.print(f"      Stop: ₹{trade_data['stop_loss_price']:.2f} (-{stop_loss_pct}%)")
            console.print(f"      Quality: {quality_score:.0f}/100")
            console.print(f"      Expected Win Rate: {trade_data['expected_win_rate']}%")
            
            # Send to journal if available
            if hasattr(self, 'log_trade'):
                self.log_trade(
                    action='ENTRY',
                    symbol=symbol,
                    price=price,
                    qty=trade_data['quantity'],
                    amount=price * trade_data['quantity'],
                    alert_type='OPTIMIZED_GAP_15MIN',
                    side='BUY'
                )
            
            # Telegram notification removed - gap trades will send alerts through normal execution flow
            
        except Exception as e:
            console.print(f"[red]Error in gap paper trading: {e}[/red]")
    
    def _process_paper_trading_alert(self, alert):
        """Process alert for paper trading bot with duplicate prevention"""
        if not self.paper_trading_enabled:
            return
        
        try:
            # Check for existing position in same base symbol
            ticker = alert.get('ticker', '')
            has_position, existing_ticker = self._has_existing_position(ticker)
            
            if has_position:
                console.print(f"[yellow]⚠️ Already have position in {self._get_base_symbol(ticker)} ({existing_ticker}) - skipping {ticker}[/yellow]")
                return
            
            # Determine trading action based on alert type
            symbol = alert['ticker']
            price = alert['price']
            
            # Get confidence from alert (already calculated in detection phase)
            confidence = alert.get('confidence', 0.5)
            
            # Only trade if confidence is sufficient (relaxed for FOMO mode)
            if confidence < 0.7:
                console.print(f"   [yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping trade[/yellow]")
                return
            
            # Check historical trend to align trading with market direction
            trend = self._check_historical_trend(symbol, timeframe='daily', lookback_days=15)
            
            # Determine trade direction with trend consideration
            trade_side = None
            
            # In bearish trends, prioritize SELL signals
            if trend in ['strong_bearish', 'bearish']:
                console.print(f"   [red]📉 {symbol} in {trend} trend - prioritizing SELL signals[/red]")
                # Convert any signal to SELL in bearish trends
                if alert['type'] in ['VOLUME_SPIKE', 'PRICE_MOVE', 'SMART_FOMO', 'FOMO_MOMENTUM']:
                    trade_side = 'SELL'
            else:
                # Normal trend-based logic for neutral/bullish trends
                if alert['type'] == 'VOLUME_SPIKE':
                    # Volume spike with positive change = BUY (only in neutral+ trends)
                    if alert.get('change', 0) > 0 and trend in ['strong_bullish', 'bullish', 'neutral']:
                        trade_side = 'BUY'
                    elif alert.get('change', 0) < -2:  # Strong negative move
                        trade_side = 'SELL'
                
                elif alert['type'] == 'PRICE_MOVE':
                    # Strong positive price move = BUY (prefer bullish trends)
                    if alert.get('current_change', 0) > 2:
                        if trend in ['strong_bullish', 'bullish']:
                            trade_side = 'BUY'  # Higher confidence in bullish trends
                        elif trend == 'neutral':
                            trade_side = 'BUY'  # Allow in neutral markets
                    # Strong negative price move = SELL
                    elif alert.get('current_change', 0) < -2:
                        trade_side = 'SELL'
                
                elif alert['type'] == 'SMART_FOMO':
                    # Enhanced Smart FOMO - IMPROVED TIMING-BASED ENTRY LOGIC
                    change_pct = alert.get('change', 0)
                    timing_type = alert.get('timing_type', 'ORIGINAL')
                    
                    # Better entry logic based on timing type
                    if timing_type == 'PRE_BREAKOUT':
                        # Pre-breakout: Always BUY in neutral+ trends (best timing)
                        if trend in ['strong_bullish', 'bullish', 'neutral']:
                            trade_side = 'BUY'
                            console.print(f"   [bright_green]🟢 {symbol} PRE-BREAKOUT entry - optimal timing![/bright_green]")
                        
                    elif timing_type == 'PULLBACK':
                        # Pullback: Safe BUY opportunity (good timing)
                        if trend in ['strong_bullish', 'bullish', 'neutral']:
                            trade_side = 'BUY'
                            console.print(f"   [cyan]🔵 {symbol} PULLBACK entry - buying dip near support[/cyan]")
                            
                    elif timing_type == 'COOLED':
                        # Cooled momentum: Conservative BUY (safe timing)
                        if trend in ['strong_bullish', 'bullish', 'neutral']:
                            trade_side = 'BUY'
                            console.print(f"   [blue]🔷 {symbol} COOLED momentum - safe entry window[/blue]")
                    
                    else:  # ORIGINAL timing (fallback)
                        # Original logic for late entries
                        if change_pct > 1 and trend in ['strong_bullish', 'bullish', 'neutral']:
                            # Positive move - check if overextended for shorting
                            if self._is_overextended_for_short(symbol):
                                trade_side = 'SELL'  # Short overextended stocks
                                console.print(f"   [red]📉 {symbol} overextended - considering SHORT[/red]")
                            else:
                                trade_side = 'BUY'  # Normal long entry
                                console.print(f"   [yellow]⚠️ {symbol} LATE entry - buying after move[/yellow]")
                        elif change_pct < -1:
                            # Negative move - consider shorting the decline
                            trade_side = 'SELL'  # Short declining stocks with volume
                            console.print(f"   [red]📉 {symbol} declining with volume ({change_pct:.1f}%) - considering SHORT[/red]")
                
                elif alert['type'] == 'FOMO_MOMENTUM':
                    # FOMO Momentum - Direction-based trading with trend confirmation
                    direction = alert.get('direction', 'UNKNOWN')
                    change_pct = alert.get('change', 0)
                    confidence = alert.get('confidence', 0)
                    
                    if direction == 'LONG' and change_pct > 0:
                        # Bullish momentum - BUY in neutral+ trends
                        if trend in ['strong_bullish', 'bullish', 'neutral']:
                            trade_side = 'BUY'
                            console.print(f"   [bright_green]🚀 {symbol} BULLISH MOMENTUM ({change_pct:+.1f}%) - BUY trend confirmed[/bright_green]")
                        else:  # bearish trend - be cautious
                            trade_side = 'WATCH'
                            console.print(f"   [yellow]⚠️ {symbol} bullish momentum in bearish trend - WATCH only[/yellow]")
                    
                    elif direction == 'SHORT' and change_pct < 0:
                        # Bearish momentum - SELL/SHORT opportunity
                        trade_side = 'SELL'
                        console.print(f"   [red]📉 {symbol} BEARISH MOMENTUM ({change_pct:+.1f}%) - SELL/SHORT opportunity[/red]")
                    
                    else:
                        # Fallback - watch for unclear signals
                        trade_side = 'WATCH'
                        console.print(f"   [dim]👀 {symbol} momentum signal unclear - WATCH mode[/dim]")
                
                elif alert['type'] == 'REALTIME_MOMENTUM':
                    # REALTIME Momentum - Immediate action on continuous price movements
                    direction = alert.get('direction', 'UNKNOWN')
                    consecutive_moves = alert.get('consecutive_moves', 0)
                    momentum_strength = alert.get('momentum_strength', 0)
                    confidence = alert.get('confidence', 0)
                    
                    # More aggressive entry due to real-time nature
                    if direction == 'UP' and consecutive_moves >= 3:
                        # Continuous upward momentum - BUY immediately
                        if trend in ['strong_bullish', 'bullish', 'neutral']:
                            trade_side = 'BUY'
                            console.print(f"   [bright_green]⚡🚀 {symbol} CONTINUOUS UP MOMENTUM ({consecutive_moves} moves, {momentum_strength:.2f}%) - IMMEDIATE BUY[/bright_green]")
                        else:
                            trade_side = 'WATCH'
                            console.print(f"   [yellow]⚠️ {symbol} up momentum in bearish trend - WATCH for reversal[/yellow]")
                    
                    elif direction == 'DOWN' and consecutive_moves >= 3:
                        # Continuous downward momentum - SELL/SHORT immediately
                        trade_side = 'SELL'
                        console.print(f"   [red]⚡📉 {symbol} CONTINUOUS DOWN MOMENTUM ({consecutive_moves} moves, {momentum_strength:.2f}%) - IMMEDIATE SELL/SHORT[/red]")
                    
                    else:
                        # Insufficient momentum - watch
                        trade_side = 'WATCH'
                        console.print(f"   [dim]👀 {symbol} momentum building ({consecutive_moves} moves) - WATCH for continuation[/dim]")
                
                elif alert['type'] == 'OVERBOUGHT_SHORT':
                    # Direct short signal for overbought stocks
                    trade_side = 'SELL'
                    
                    # Enhanced display with both RSI values
                    daily_rsi = alert.get('rsi', 0)
                    min_rsi_15 = alert.get('rsi_15min')
                    confidence = alert.get('confidence', 0)
                    reason = alert.get('reason', 'Daily RSI Only')
                    
                    rsi_info = f"Daily RSI {daily_rsi:.1f}"
                    if min_rsi_15:
                        rsi_info += f", 15min RSI {min_rsi_15:.1f}"
                    
                    console.print(f"   [red]🔴 {symbol} OVERBOUGHT SHORT - {rsi_info}, confidence {confidence:.0%} ({reason})[/red]")
            
            # Handle special gap strategy (outside trend-based logic)  
            if alert['type'] == 'OPTIMIZED_GAP_15MIN':
                # Optimized gap strategy - handled by specialized function
                self._process_gap_paper_trading_alert(alert)
                return  # Exit early, gap handler manages everything
            
            if trade_side:
                # Check if we already have a position in this symbol
                if symbol in self.positions and self.positions[symbol]:
                    console.print(f"   [yellow]⚠️ Already have position in {symbol} - skipping[/yellow]")
                    return
                
                # Calculate quantity for ₹20,000 position
                quantity = max(1, int(20000 / price))
                
                # Execute trade
                success = self._execute_screener_trade(symbol, trade_side, alert, price, quantity, confidence, trend)
                
                if success:
                    # Add to live trades display
                    trade_info = {
                        'timestamp': datetime.now(),
                        'symbol': symbol,
                        'side': trade_side,
                        'price': price,
                        'quantity': quantity,
                        'amount': quantity * price,
                        'alert_type': alert['type'],
                        'confidence': confidence
                    }
                    
                    self.live_trades.append(trade_info)
                    
                    # Keep only last 10 trades
                    if len(self.live_trades) > 10:
                        self.live_trades.pop(0)
                    
                    trend_emoji = "📈" if trend in ['strong_bullish', 'bullish'] else "📉" if trend in ['strong_bearish', 'bearish'] else "➡️"
                    strategy_reason = f"bearish trend short" if trend in ['strong_bearish', 'bearish'] and trade_side == 'SELL' else f"signal-based {trade_side.lower()}"
                    console.print(f"   [green]✅ Paper trade executed: {trade_side} {quantity} {symbol} @ ₹{price:.2f} {trend_emoji} ({strategy_reason})[/green]")
                else:
                    console.print(f"   [red]❌ Paper trade failed for {symbol}[/red]")
            else:
                console.print(f"   [dim]No clear trading signal for {symbol}[/dim]")
                
        except Exception as e:
            console.print(f"   [red]❌ Paper trading error: {e}[/red]")
    
    
    def _execute_screener_trade(self, symbol, side, alert, price, quantity, confidence, trend='neutral'):
        """Execute paper trade via bot"""
        try:
            # Validate symbol before trading
            try:
                # Debug: Check validate_symbol status
                console.print(f"[dim]Debug: validate_symbol type: {type(validate_symbol)}, callable: {callable(validate_symbol) if validate_symbol else 'N/A'}[/dim]")
                
                # Check if validate_symbol function is available and callable
                if validate_symbol is None or not callable(validate_symbol):
                    # Fallback validation - just clean the symbol
                    clean_symbol = symbol.replace('NSE:', '').replace('BSE:', '').strip()
                    console.print(f"[yellow]⚠️ Symbol validator unavailable - using basic validation for {symbol}[/yellow]")
                    symbol = f"NSE:{clean_symbol}"  # Keep NSE prefix for consistency
                else:
                    is_valid, validation_result = validate_symbol(symbol)
                    if not is_valid:
                        console.print(f"[red]❌ TRADE BLOCKED: {symbol} - {validation_result}[/red]")
                        return False
                    
                    # Use validated symbol for trading
                    validated_symbol = validation_result
                    if validated_symbol != symbol.replace('NSE:', '').replace('BSE:', ''):
                        console.print(f"[cyan]📝 Symbol mapped: {symbol} -> {validated_symbol}[/cyan]")
                        symbol = f"NSE:{validated_symbol}"  # Keep NSE prefix for consistency
                    
            except Exception as e:
                console.print(f"[red]❌ TRADE BLOCKED: {symbol} - Symbol validation error: {e}[/red]")
                return False
            
            # Check trading hours - prevent new trades outside market hours
            if not self._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours ({self.trading_start_time}-{self.trading_end_time})[/yellow]")
                return False
            
            # Check total daily trade limit
            if self.total_trades_today >= self.max_total_trades:
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Total daily trade limit reached ({self.total_trades_today}/{self.max_total_trades})[/yellow]")
                return False
            
            # Check daily entry limit (max 2 entries per day per stock)
            at_limit, entries_today = self._check_daily_entry_limit(symbol)
            if at_limit:
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Daily entry limit reached ({entries_today}/{self.max_daily_entries_per_stock})[/yellow]")
                return False
            
            # Check loss-based cooldown (30+ minutes after any loss)
            in_cooldown, cooldown_left = self._check_loss_cooldown(symbol)
            if in_cooldown:
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Loss cooldown active ({cooldown_left/60:.1f}m left)[/yellow]")
                return False
            
            # Validate price against live Upstox price
            live_price = self._get_live_price_from_upstox(symbol)
            if live_price is None:
                # Instrument key not found - block trade creation
                console.print(f"[red]❌ TRADE BLOCKED: {symbol} - Instrument key not found in Upstox[/red]")
                return False
            elif live_price:
                price_diff_pct = abs(live_price - price) / price * 100
                if price_diff_pct > 0.5:  # More than 0.5% difference
                    console.print(f"[yellow]⚠️ TRADE SKIPPED: {symbol} - Price difference too high: {price_diff_pct:.2f}% (Signal: ₹{price:.2f} vs Live: ₹{live_price:.2f})[/yellow]")
                    return False
                
                # Use live price for execution
                price = live_price
            
            # Create position directly in bot
            trade_log_msg = f"SCREENER_ALERT_TRADE: Side={side}, Qty={quantity}, Symbol={symbol}, Price={price:.2f}, Alert={alert['type']}, Confidence={confidence:.2f}"
            
            # Log the trade (reduce console spam)
            console.print(f"[dim]📝 Trade: {side} {quantity} {symbol} @ ₹{price:.2f}[/dim]")
            
            # Calculate trading charges
            amount = price * quantity
            entry_charges = self._calculate_trading_charges(amount, 'intraday')
            
            # Log to journal
            self.log_trade("ENTRY", symbol, price, quantity, amount, f"{alert['type']}|trend:{trend}", side=side)
            
            # Detect volatility level for ATR-based stops
            volatility_level = self._detect_volatility_level(symbol, price)
            
            # Create position with entry charges
            self.positions[symbol] = {
                'side': side,
                'qty': quantity,
                'entry_price': round(price, 2),
                'entry_charges': entry_charges,
                'timestamp': datetime.now(),
                'highest_profit_pct': 0.0,
                'highest_price': round(price, 2),
                'trailing_stop_active': False,
                'trailing_stop_pct': 0.0,
                'trade_id': self.trade_count + 1,
                'source': 'TV_SCREENER',
                'alert_type': alert['type'],
                'confidence': confidence,
                'volatility': volatility_level
            }
            
            self.trade_count += 1
            self.current_prices[symbol] = round(price, 2)
            
            # Increment daily entry count for this symbol
            self._increment_daily_entry_count(symbol)
            
            # Increment total trades counter
            self.total_trades_today += 1
            
            # Send telegram alert for successful trade entry
            if self.telegram_enabled:
                entry_alert = {
                    'type': 'TRADE_ENTRY',
                    'ticker': symbol,
                    'name': symbol,
                    'side': side,
                    'price': price,
                    'quantity': quantity,
                    'amount': price * quantity,
                    'alert_type': alert['type'],
                    'confidence': confidence,
                    'trend': trend
                }
                self.send_telegram_alert(entry_alert)
            
            return True
            
        except Exception as e:
            console.print(f"Trade execution error: {e}")
            return False
    
    def _get_trading_action(self, alert):
        """Get human readable trading action"""
        if alert['type'] == 'VOLUME_SPIKE':
            if alert.get('change', 0) > 0:
                return f"🟢 BUY {alert['ticker']} (Volume Spike + Positive Move)"
            elif alert.get('change', 0) < -2:
                return f"🔴 SELL {alert['ticker']} (Volume Spike + Strong Drop)"
            else:
                return f"⏳ MONITOR {alert['ticker']} (Volume Spike - Unclear Direction)"
        
        elif alert['type'] == 'PRICE_MOVE':
            if alert.get('current_change', 0) > 2:
                return f"🟢 BUY {alert['ticker']} (Strong Upward Move)"
            elif alert.get('current_change', 0) < -2:
                return f"🔴 SELL {alert['ticker']} (Strong Downward Move)"
            else:
                return f"⏳ MONITOR {alert['ticker']} (Price Move - Moderate)"
        
        return f"⏳ MONITOR {alert['ticker']}"
    
    def _display_watch_data(self, df, alerts=[]):
        """Display current watch data"""
        mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
        # Prefer instance-bound tv_display for reliability
        _tv_display = getattr(self, 'tv_display', None) or tv_display
        if _tv_display:
            table = _tv_display.render_watch_table(df, alerts or [], mode, self.currency_symbol)
            console.print(table)
        else:
            # Keep a single concise message; upstream header already shows context
            console.print("[red]tv_display module unavailable[/red]")
            return

        # Preserve class-only extra sections
        if self.paper_trading_enabled and self.live_trades:
            if tv_display:
                tv_display.display_live_trades(self.live_trades)
            else:
                self._display_live_trades()

        if self.paper_trading_enabled:
            self._display_active_positions()

        if self.paper_trading_enabled and self.closed_trades:
            if tv_display:
                tv_display.display_closed_trades(self.closed_trades)
            else:
                self._display_closed_trades()
    
    def _display_live_trades(self):
        """Deprecated: moved to tv_display.display_live_trades"""
        if tv_display:
            return tv_display.display_live_trades(self.live_trades)
        console.print("[red]tv_display module unavailable[/red]")
    
    def _display_closed_trades(self):
        """Deprecated: moved to tv_display.display_closed_trades"""
        if tv_display:
            return tv_display.display_closed_trades(self.closed_trades)
        # If empty, original would silently return; keep behavior
        if not self.closed_trades:
            return
        console.print("[red]tv_display module unavailable[/red]")
    
    def _get_live_price_from_upstox(self, symbol, force_refresh=False):
        """Get live price - delegate to live_data module if available"""
        if self.live_data:
            return self.live_data._get_live_price_from_upstox(symbol, force_refresh)
        # Original implementation follows below
        """Get live price from Upstox API for a symbol with BSE fallback"""
        try:
            if not (hasattr(self, 'upstox_api') and self.upstox_api):
                return None
                
            # Check cache freshness (avoid excessive API calls)
            current_time = time.time()
            cache_duration = 10  # Cache for 10 seconds
            
            if not force_refresh and symbol in self.price_cache_timestamps:
                if current_time - self.price_cache_timestamps[symbol] < cache_duration:
                    return self.current_prices.get(symbol)
            
            # Check if symbol is in blacklist of non-existent symbols to avoid repeated API calls
            if not hasattr(self, '_symbol_blacklist'):
                self._symbol_blacklist = set()
            if symbol in self._symbol_blacklist:
                return None
            
            # Use symbol validator for comprehensive checking
            try:
                if is_symbol_blacklisted(symbol):
                    return None
                    
                validated_symbol = get_valid_symbol(symbol)
                if not validated_symbol:
                    return None
                    
            except Exception as e:
                console.print(f"[yellow]⚠️ Symbol validation error for {symbol}: {e}[/yellow]")
            
            # Validate and clean the symbol
            clean_symbol = symbol.strip().upper()
            
            # Extract exchange and symbol first
            if ':' in clean_symbol:
                exchange, clean_symbol = clean_symbol.split(':', 1)
            else:
                exchange = 'NSE'
            
            # Remove common suffixes that might cause instrument key not found errors
            suffixes_to_remove = ['.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
            for suffix in suffixes_to_remove:
                if clean_symbol.endswith(suffix):
                    clean_symbol = clean_symbol[:-len(suffix)]
                    break
            
            # Validate symbol format AFTER cleaning (should be 3-15 characters for Indian stocks)
            if not (3 <= len(clean_symbol) <= 15):
                console.print(f"[yellow]⚠️ Invalid symbol format for {symbol}: {clean_symbol} (length: {len(clean_symbol)})[/yellow]")
                return None
            
            # First attempt: Try original exchange
            price = self._fetch_price_from_exchange(clean_symbol, exchange)
            
            # Fallback: If NSE fails, try BSE (and vice versa)
            if price is None:
                fallback_exchange = 'BSE' if exchange == 'NSE' else 'NSE'
                price = self._fetch_price_from_exchange(clean_symbol, fallback_exchange)
                
                if price is not None:
                    console.print(f"[green]✅ Found {clean_symbol} on {fallback_exchange} (fallback from {exchange})[/green]")
                    # Track fallback usage
                else:
                    # Add to blacklist if not found on any exchange
                    self._symbol_blacklist.add(symbol)
                    console.print(f"[red]❌ Symbol {clean_symbol} not found on NSE or BSE - blacklisting[/red]")
                    self.exchange_fallbacks[symbol] = fallback_exchange
            
            if price is not None:
                # Update cache
                self.current_prices[symbol] = round(price, 2)
                self.price_cache_timestamps[symbol] = current_time
                return round(price, 2)
                
        except Exception as e:
            # Only show error once per minute to avoid spam
            if not hasattr(self, '_last_error_time'):
                self._last_error_time = {}
            
            current_time = time.time()
            if symbol not in self._last_error_time or current_time - self._last_error_time[symbol] > 60:
                console.print(f"[yellow]⚠️ Failed to get live price for {symbol}: {e}[/yellow]")
                self._last_error_time[symbol] = current_time
                
        return None
    
    def _fetch_live_prices_parallel(self, symbols):
        """Fetch live prices for multiple symbols in parallel using threading"""
        import concurrent.futures
        
        live_prices = {}
        
        def fetch_single_price(symbol):
            price = self._get_live_price_from_upstox(symbol)
            return symbol, price
        
        # Use ThreadPoolExecutor for parallel execution
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(symbols), 10)) as executor:
            # Submit all price fetch tasks
            future_to_symbol = {executor.submit(fetch_single_price, symbol): symbol for symbol in symbols}
            
            # Collect results as they complete
            for future in concurrent.futures.as_completed(future_to_symbol):
                try:
                    symbol, price = future.result(timeout=5)  # 5 second timeout per request
                    if price is not None:
                        live_prices[symbol] = price
                except Exception as e:
                    symbol = future_to_symbol[future]
                    console.print(f"[dim red]⚠️ Parallel fetch failed for {symbol}: {str(e)[:30]}...[/dim red]")
        
        return live_prices
    
    def _fetch_price_from_exchange(self, symbol, exchange):
        """Fetch price from specific exchange with proper error handling"""
        try:
            # Check if market is open (9:15 AM - 3:30 PM) - different from trading hours
            from datetime import datetime, time
            now = datetime.now().time()
            market_open = time(9, 15)  # 9:15 AM
            market_close = time(15, 30)  # 3:30 PM
            
            if not (market_open <= now <= market_close):
                # Outside market hours - use last known price from cache
                return self.current_prices.get(symbol)
            
            # Map exchange to Upstox format
            exchange_map = {
                'NSE': 'NSE_EQ',
                'BSE': 'BSE_EQ'
            }
            
            upstox_exchange = exchange_map.get(exchange, 'NSE_EQ')
            
            # Get latest intraday data (1-minute) to get current price
            # Remove exchange parameter as it causes "instrument key not found" errors
            df = self.upstox_api.fetch_intraday_data_v3(
                symbol=symbol, 
                unit='minutes', 
                interval=1
            )
            
            if df is not None and not df.empty:
                # Get the latest close price (most recent data point)
                return float(df['close'].iloc[-1])
                
        except Exception as e:
            # Check for specific "instrument key not found" error
            if "instrument key" in str(e).lower() or "not found" in str(e).lower():
                return None  # Silent fallback for missing instruments
            else:
                # Log other errors
                console.print(f"[dim red]⚠️ {exchange} error for {symbol}: {str(e)[:50]}...[/dim red]")
                
        return None

    def _display_active_positions(self):
        """Display active positions with live P&L from Upstox"""
        active_positions = {k: v for k, v in self.positions.items() if v}
        
        if not active_positions:
            return
        
        console.print()
        positions_table = Table(title="📊 ACTIVE POSITIONS", show_header=True)
        positions_table.add_column("Symbol", style="bold", no_wrap=True)
        positions_table.add_column("Side", style="white")
        positions_table.add_column("Entry", justify="right", style="cyan")
        positions_table.add_column("Current", justify="right", style="white")
        positions_table.add_column("Qty", justify="right", style="blue")
        positions_table.add_column("P&L %", justify="right", style="bold")
        positions_table.add_column("P&L ₹ (Net)", justify="right", style="bold")
        positions_table.add_column("TSL", justify="right", style="magenta")
        positions_table.add_column("Source", style="dim")
        
        # Fetch all live prices in parallel
        live_prices = self._fetch_live_prices_parallel(list(active_positions.keys()))
        
        for symbol, position in active_positions.items():
            # Use parallel fetched price or fallback to cached price
            live_price = live_prices.get(symbol)
            current_price = live_price if live_price else self.current_prices.get(symbol, position['entry_price'])
            
            # Calculate P&L including charges
            entry_price = position['entry_price']
            entry_charges = position.get('entry_charges', 0)
            
            # Estimate exit charges for current P&L calculation
            current_value = current_price * position['qty']
            estimated_exit_charges = self._calculate_trading_charges(current_value, 'intraday')
            
            # Calculate gross and net P&L
            gross_pnl = (current_price - entry_price) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1
                
            pnl_amount = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = entry_price * position['qty']
            pnl_pct = (pnl_amount / entry_value) * 100
            
            # Color coding
            pnl_style = "green" if pnl_pct > 0 else "red"
            side_style = "green" if position['side'] == 'BUY' else "red"
            side_emoji = "🟢" if position['side'] == 'BUY' else "🔴"
            
            # Add price source indicator with exchange info
            if live_price:
                # Check if we used fallback exchange
                if symbol in self.exchange_fallbacks:
                    price_indicator = "🔄"  # Fallback exchange indicator
                else:
                    price_indicator = "🟢"  # Original exchange
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            else:
                price_indicator = "🔴"
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            
            # Trailing stop display with progressive buffer info
            if position.get('trailing_stop_active', False):
                current_buffer = self._get_progressive_trailing_buffer(abs(pnl_pct))
                tsl_display = f"🎯{position.get('trailing_stop_pct', 0):+.1f}% ({current_buffer:.1f}%)"
                tsl_style = "bold green"
            else:
                tsl_display = "OFF"
                tsl_style = "dim"
            
            positions_table.add_row(
                symbol,
                f"[{side_style}]{side_emoji} {position['side']}[/{side_style}]",
                f"₹{position['entry_price']:,.2f}",
                current_price_display,
                str(position['qty']),
                f"[{pnl_style}]{pnl_pct:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{pnl_amount:+,.0f}[/{pnl_style}]",
                f"[{tsl_style}]{tsl_display}[/{tsl_style}]",
                position.get('source', 'MANUAL')[:10]
            )
        
        console.print(positions_table)
        console.print("[dim]🟢 = Live price | 🔄 = Fallback exchange | 🔴 = Cached | 🎯 = Trailing Stop[/dim]")
    
    def start_background_monitoring(self):
        """Start background thread for continuous live price monitoring and risk management"""
        if not self.paper_trading_enabled or not self.upstox_api:
            return
        
        if self.background_monitor_active:
            console.print("[yellow]⚠️ Background monitoring already active[/yellow]")
            return
        
        self.background_monitor_active = True
        self.stop_monitoring.clear()
        self.monitor_thread = threading.Thread(target=self._background_monitor_loop, daemon=True)
        self.monitor_thread.start()
        console.print("[green]🔄 Started background live price monitoring[/green]")
    
    def stop_background_monitoring(self):
        """Stop background monitoring thread"""
        if self.background_monitor_active:
            self.stop_monitoring.set()
            self.background_monitor_active = False
            if self.monitor_thread:
                self.monitor_thread.join(timeout=2.0)
            console.print("[yellow]⏹️ Stopped background monitoring[/yellow]")
    
    def _background_monitor_loop(self):
        """Background loop for continuous position monitoring and risk management"""
        console.print("[dim]🔍 Background monitor started - checking positions every 2 seconds[/dim]")
        
        while not self.stop_monitoring.wait(2.0):  # Check every 2 seconds
            try:
                if not self.positions:
                    continue
                
                active_positions = {k: v for k, v in self.positions.items() if v}
                if not active_positions:
                    continue
                
                for symbol, position in active_positions.items():
                    self._monitor_position_risk(symbol, position)
                    
            except Exception as e:
                console.print(f"[red]❌ Error in background monitor: {e}[/red]")
                continue
    
    def _monitor_position_risk(self, symbol, position):
        """Monitor individual position for risk management with trailing stop"""
        try:
            # Get live price (force refresh for accuracy in risk management)
            live_price = self._get_live_price_from_upstox(symbol, force_refresh=True)
            if not live_price:
                return
            
            # Update current price
            self.current_prices[symbol] = live_price
            
            # Calculate current P&L including charges
            entry_price = position['entry_price']
            entry_charges = position.get('entry_charges', 0)
            
            # Estimate exit charges for current P&L calculation
            current_value = live_price * position['qty']
            estimated_exit_charges = self._calculate_trading_charges(current_value, 'intraday')
            
            # Calculate gross and net P&L
            gross_pnl = (live_price - entry_price) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1
                
            net_pnl = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = entry_price * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100
            
            # Risk Management Rules with ATR-based stops for volatile stocks
            volatility = position.get('volatility', 'normal')  # Track volatility level
            
            if volatility == 'high':
                # Use ATR-based stops for volatile stocks
                atr_stop_price = self._calculate_atr_based_stop(symbol, live_price)
                atr_stop_pct = ((atr_stop_price - entry_price) / entry_price) * 100
                if position['side'] == 'SELL':
                    atr_stop_pct *= -1
                stop_loss_pct = atr_stop_pct
                console.print(f"[dim]Using ATR-based stop for volatile {symbol}: {stop_loss_pct:.2f}%[/dim]")
            else:
                stop_loss_pct = self.config.risk_management.regular_stop_loss_pct
            
            take_profit_pct = self.config.risk_management.take_profit_pct
            quick_exit_pct = self.config.risk_management.quick_exit_pct
            
            # Calculate trade duration for ultra-quick trailing determination
            trade_duration_minutes = (datetime.now() - position['timestamp']).total_seconds() / 60
            ultra_quick_trailing = self.config.is_ultra_quick_trigger(trade_duration_minutes, pnl_pct)
            
            # MUCH TIGHTER trailing stop buffer (aggressive profit locking)
            trailing_stop_buffer = self._get_tighter_trailing_buffer(abs(pnl_pct), is_ultra_quick=ultra_quick_trailing)
            
            # Update highest profit and price tracking
            if pnl_pct > position['highest_profit_pct']:
                position['highest_profit_pct'] = pnl_pct
                position['highest_price'] = live_price
            
            # Check for exit conditions
            should_exit = False
            exit_reason = ""
            
            # 0. Ultra-quick tight trailing for very fast profits (NO HARD EXITS)
            if ultra_quick_trailing and not position.get('trailing_stop_active', False):
                position['trailing_stop_active'] = True
                position['best_profit_pct'] = pnl_pct
                
                # Determine trigger type for logging
                if trade_duration_minutes <= 3:
                    trigger_type = "ULTRA-QUICK"
                elif trade_duration_minutes <= 5:
                    trigger_type = "QUICK"
                else:
                    trigger_type = "FAST"
                    
                console.print(f"[green]🚀 {symbol}: {trigger_type} trailing activated at {pnl_pct:.2f}% in {trade_duration_minutes:.1f}m[/green]")
            
            # 1. Regular stop loss (if not in trailing mode)
            elif not position['trailing_stop_active'] and pnl_pct <= stop_loss_pct:
                should_exit = True
                exit_reason = f"STOP LOSS: {pnl_pct:.2f}%"
            
            # 2. Activate trailing stop when take profit is reached
            elif pnl_pct >= take_profit_pct and not position['trailing_stop_active']:
                position['trailing_stop_active'] = True
                position['trailing_stop_pct'] = pnl_pct - trailing_stop_buffer
                console.print(f"[bold green]🎯 PROGRESSIVE TRAILING STOP ACTIVATED for {symbol} at {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)[/bold green]")
                # Telegram notification removed - only send alerts for actual trades
            
            # 3. Update trailing stop as profit increases (progressive tightening)
            elif position['trailing_stop_active']:
                new_trailing_stop = pnl_pct - trailing_stop_buffer
                old_trailing_stop = position['trailing_stop_pct']
                
                # Only move trailing stop up (lock in more profit)
                if new_trailing_stop > position['trailing_stop_pct']:
                    position['trailing_stop_pct'] = new_trailing_stop
                    
                    # Show buffer tightening for significant moves
                    if abs(new_trailing_stop - old_trailing_stop) >= 0.2:  # 0.2% or more change
                        console.print(f"[dim green]📈 {symbol} trailing stop tightened: {old_trailing_stop:.2f}% → {new_trailing_stop:.2f}% (Buffer: {trailing_stop_buffer:.1f}%)[/dim green]")
                
                # Check if trailing stop is hit
                if pnl_pct <= position['trailing_stop_pct']:
                    should_exit = True
                    exit_reason = f"TRAILING STOP: {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)"
            
            # Execute exit if needed
            if should_exit:
                self._execute_exit_trade(symbol, position, live_price, exit_reason)
                
        except Exception as e:
            console.print(f"[red]❌ Error monitoring {symbol}: {e}[/red]")
    
    def _execute_exit_trade(self, symbol, position, exit_price, reason):
        """Execute exit trade for risk management"""
        try:
            # Calculate exit charges
            exit_amount = exit_price * position['qty']
            exit_charges = self._calculate_trading_charges(exit_amount, 'intraday')
            
            # Calculate P&L with trading charges
            gross_pnl = (exit_price - position['entry_price']) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1
            
            # Net P&L after all charges
            total_charges = position.get('entry_charges', 0) + exit_charges
            net_pnl = gross_pnl - total_charges
            pnl_amount = net_pnl
            
            # Calculate P&L percentage based on net amount
            entry_value = position['entry_price'] * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100
            
            exit_log = (f"🔥 AUTO EXIT: {symbol} | "
                       f"{reason} | "
                       f"Entry: ₹{position['entry_price']:.0f} | "
                       f"Exit: ₹{exit_price:.0f} | "
                       f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | "
                       f"Charges: ₹{total_charges:.0f}")
            
            console.print(f"[bold red]{exit_log}[/bold red]")
            
            # Log to journal
            amount = exit_price * position['qty']
            exit_side = 'SELL' if position['side'] == 'BUY' else 'BUY'
            self.log_trade("EXIT", symbol, exit_price, position['qty'], amount, reason, pnl_pct, pnl_amount, side=exit_side)
            
            # Add to stop loss cooldown if this was a stop loss exit
            if "STOP LOSS" in reason:
                self.stop_loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute stop loss cooldown[/dim red]")
            
            # Add to loss cooldown for ANY loss (30+ minutes after loss)
            if pnl_amount < 0:  # Any loss
                self.loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute loss cooldown (₹{pnl_amount:+,.0f})[/dim red]")
            
            # Add to live trades log
            self.live_trades.append({
                'timestamp': datetime.now(),
                'symbol': symbol,
                'side': 'SELL' if position['side'] == 'BUY' else 'BUY',
                'price': exit_price,
                'quantity': position['qty'],
                'amount': exit_price * position['qty'],
                'alert_type': 'AUTO_EXIT',
                'confidence': 1.0,
                'reason': reason,
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount
            })
            
            # Send Telegram alert if enabled
            if self.telegram_enabled:
                exit_alert = {
                    'type': 'TRADE_EXIT',
                    'ticker': symbol,
                    'name': symbol,
                    'price': exit_price,  # Required by telegram function
                    'side': 'SELL' if position['side'] == 'BUY' else 'BUY',
                    'entry_price': position['entry_price'],
                    'exit_price': exit_price,
                    'quantity': position['qty'],
                    'amount': exit_price * position['qty'],
                    'reason': reason,
                    'pnl_pct': pnl_pct,
                    'pnl_amount': pnl_amount,
                    'hold_time_minutes': int((datetime.now() - position['timestamp']).total_seconds() / 60)
                }
                self.send_telegram_alert(exit_alert)
            
            # Add to closed trades list
            self.closed_trades.append({
                'symbol': symbol,
                'side': position['side'],
                'entry_time': position.get('timestamp', datetime.now()),
                'exit_time': datetime.now(),
                'entry_price': position['entry_price'],
                'exit_price': exit_price,
                'quantity': position['qty'],
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount,
                'exit_reason': reason
            })
            
            # Close the position
            del self.positions[symbol]
            
        except Exception as e:
            console.print(f"[red]❌ Error executing exit for {symbol}: {e}[/red]")
    
    # ==================== UTILITY FUNCTIONS ====================
    
    def save_results(self, df, filename):
        return helpers_save_results(df, filename)
    
    def run_example(self, example_name, **kwargs):
        """Run a specific example"""
        examples = {
            # Pre-Breakout (NEW - Anti-FOMO)
            'pre_breakout': self.pre_breakout_accumulation,
            'early_momentum': self.early_momentum_detection,
            'relative_strength': self.relative_strength_leaders,
            
            # Gap Trading Strategies
            'gap_fill_analysis': self.gap_fill_trading_strategy,
            'live_gap_sr_monitor': self.live_gap_fill_monitor_with_sr,
            
            # Intraday Trading
            'intraday_breakouts': self.intraday_high_volume_breakouts,
            'intraday_gap_up': self.intraday_gap_up_stocks,
            'optimized_gap_15min': self.optimized_gap_strategy_15min,
            'intraday_oversold': self.intraday_oversold_bounce,
            'intraday_news': self.intraday_news_momentum,
            'intraday_watch': lambda: self.intraday_watch_mode(**kwargs),
            # Early Detection
            'intraday_early_setup': self.intraday_early_breakout_setup,
            'intraday_accumulation': self.intraday_volume_accumulation,
            'intraday_compression': self.intraday_compression_coiling,
            'heavy_breakout': self.heavy_breakout,
            
            # Swing Trading
            'swing_reversal': self.swing_bullish_reversal,
            'swing_breakout': self.swing_breakout_consolidation,
            'swing_sector': self.swing_sector_rotation,
            
            # Long-term Investing
            'invest_growth': self.invest_quality_growth,
            'invest_dividend': self.invest_dividend_aristocrats,
            'invest_value': self.invest_undervalued_gems,
            
            # Research & Analysis
            'research_leaders': self.research_sector_leaders,
            'research_sentiment': self.research_market_sentiment,
            'research_earnings': self.research_earnings_calendar,
            'research_sectors': self.research_sector_performance,
            'research_sector_stocks': lambda: self.research_sector_stocks(**kwargs),
        }
        
        if example_name in examples:
            console.print(f"\n[bold blue]Running: {example_name}[/bold blue]")
            examples[example_name]()
        else:
            console.print(f"[red]Example '{example_name}' not found[/red]")
            self.show_available_examples()
    
    def show_available_examples(self):
        """Show all available examples"""
        console.print("\n[bold yellow]Available Examples:[/bold yellow]")
        
        categories = [
            ("⚡ PRE-BREAKOUT (NEW - Anti-FOMO)", [
                "pre_breakout - Accumulation patterns (catch before crowd)",
                "early_momentum - Early momentum detection (pre-FOMO)",
                "relative_strength - Market outperformers (strength leaders)"
            ]),
            ("🚀 Intraday Trading", [
                "intraday_breakouts - High volume breakouts",
                "intraday_gap_up - Gap-up momentum (basic)",
                "optimized_gap_15min - 🏆 OPTIMIZED GAP STRATEGY (15-min, 68.4% win rate)",
                "intraday_oversold - Oversold bounce plays",
                "intraday_news - News-driven momentum",
                "intraday_watch - Live watch mode (continuous monitoring)"
            ]),
            ("🎯 Gap Trading Strategies", [
                "gap_fill_analysis - Historical gap-fill probability analysis",
                "live_gap_sr_monitor - 🔥 LIVE GAP-FILL + S/R MONITOR (volume movers with gap analysis)"
            ]),
            ("🎯 Early Detection (Pre-Breakout)", [
                "intraday_early_setup - Early breakout setups (BEFORE breakout)",
                "intraday_accumulation - Volume accumulation (smart money)",
                "intraday_compression - Compression/coiling stocks (pre-explosion)",
                "heavy_breakout - 💥 Smart money consolidation channel breakouts"
            ]),
            ("📊 Swing Trading", [
                "swing_reversal - Bullish reversal patterns",
                "swing_breakout - Consolidation breakouts",
                "swing_sector - Sector rotation plays"
            ]),
            ("💰 Long-term Investing", [
                "invest_growth - Quality growth stocks",
                "invest_dividend - Dividend aristocrats",
                "invest_value - Undervalued gems"
            ]),
            ("🔍 Research & Analysis", [
                "research_leaders - Sector leaders",
                "research_sentiment - Market sentiment",
                "research_earnings - Earnings focus",
                "research_sectors - Sector performance analysis",
                "research_sector_stocks - Stocks in specific sector"
            ])
        ]
        
        for category, examples in categories:
            console.print(f"\n[bold]{category}:[/bold]")
            for example in examples:
                console.print(f"  • {example}")
    
    def run_all_examples(self):
        """Run all examples with delays"""
        examples = [
            'intraday_breakouts', 'intraday_gap_up', 'intraday_oversold', 'intraday_news',
            'gap_fill_analysis', 'live_gap_sr_monitor',
            'swing_reversal', 'swing_breakout', 'swing_sector',
            'invest_growth', 'invest_dividend', 'invest_value',
            'research_leaders', 'research_sentiment', 'research_earnings', 'research_sectors'
        ]
        
        for example in examples:
            self.run_example(example)
            time.sleep(1)  # Small delay between examples
            console.print("\n" + "="*80 + "\n")

    # =============== DELEGATION METHODS TO TV_MODES ===============
    # These methods delegate to functions in tv_modes.py
    
    def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, price_threshold=3.0, mode='PREBREAKOUT', market_cap_filter=None, max_price=None, min_price=None):
        """Delegate to intraday_watch_mode in tv_modes"""
        return tv_modes.intraday_watch_mode(self, refresh_interval, volume_threshold, price_threshold, mode, market_cap_filter, max_price, min_price)
    
    def run_mode_once(self, mode='PREBREAKOUT', market_cap_filter=None, max_price=None, min_price=None):
        """Run a specific mode once to display current data"""
        mode_titles = {
            'PREBREAKOUT': ("📊 PRE-BREAKOUT MODE - Early Entry Signals", "bold blue"),
            'FOMO': ("🔥 FOMO MODE - High Volume Breakouts", "bold red"), 
            'SMART_FOMO': ("🧠 SMART FOMO MODE - Historical Analysis + FOMO", "bold yellow"),
            'ACCUMULATION': ("📈 ACCUMULATION MODE - Smart Money Tracking", "bold green"),
            'MOMENTUM': ("⚡ MOMENTUM MODE - Early Momentum Detection", "bold cyan"),
            'OPTIMIZED_GAP': ("🚀 OPTIMIZED GAP MODE - 15-Min Gap Strategy (68.4% Win Rate)", "bold green"),
            'GAP_FILL_SR': ("🎯 GAP-FILL S/R MODE - Live Gap Analysis with Support/Resistance", "bold magenta"),
            'HEAVY_BREAKOUT': ("📊 HEAVY BREAKOUT MODE - Channel Analysis", "bold bright_magenta"),
            'SCALPING': ("⚡ SCALPING MODE - Ultra-Fast 1-3% Moves", "bold white"),
            'MOMENTUM_SCALPER': ("🚀 MOMENTUM SCALPER - Second-Level Delta Trading", "bold bright_white"),
            'SECTOR_SCALPER': ("🏭 SECTOR SCALPER - Correlation Catch-Up Trades", "bold bright_cyan"),
            'SHORT_SQUEEZE': ("🍋 SHORT SQUEEZE - Over-Shorted Explosion Hunter", "bold bright_magenta"),
            'BREAKOUT_FAILURE': ("📉 BREAKOUT FAILURE - Failed Breakout Shorting", "bold red"),
            'EXHAUSTION_REVERSAL': ("😵 EXHAUSTION REVERSAL - Momentum Exhaustion Shorts", "bold bright_red"),
            'MORNING_FADE': ("🌅 MORNING FADE - Gap-Up Failure Shorting", "bold yellow"),
            'REVERSAL': ("🔄 REVERSAL MODE - Counter-Trend Opportunities", "bold purple"),
            'VOLUME_SURGE': ("📊 VOLUME SURGE MODE - Unusual Activity Detector", "bold bright_blue"),
            'CHANNEL_PLAY': ("📈 CHANNEL PLAY MODE - Range-Bound Trading", "bold bright_green"),
            'SECTOR_MOMENTUM': ("🏭 SECTOR MOMENTUM MODE - Industry Group Moves", "bold bright_yellow"),
            'QUICK_PROFIT': ("💰 QUICK PROFIT MODE - 1-2% Fast Scalps", "bold bright_red")
        }
        
        title, style = mode_titles.get(mode, ("📊 MODE", "bold blue"))
        console.print(Panel.fit(f"{title} - Current Data", style=style))
        
        try:
            # Get current data using the same logic as watch mode
            self.watch_mode = mode  # Set the mode for data fetching
            df = self._get_watch_data(market_cap_filter, max_price, min_price)
            
            if not df.empty:
                console.print(f"\n[green]✅ Found {len(df)} stocks matching {mode} criteria:[/green]")
                self._display_watch_data(df, [])  # Empty alerts list for single run
            else:
                console.print(f"[yellow]⚠️ No stocks currently match {mode} criteria[/yellow]")
                
        except Exception as e:
            console.print(f"[red]❌ Error running {mode}: {e}[/red]")
            import traceback
            console.print(f"[dim]{traceback.format_exc()}[/dim]")
    
    def _get_watch_data(self, market_cap_filter=None, max_price=None, min_price=None):
        """Delegate to _get_watch_data in tv_modes"""
        return tv_modes._get_watch_data(self, market_cap_filter, max_price, min_price)
    
    # Trading mode delegation methods
    def pre_breakout_accumulation(self):
        """Delegate to pre_breakout_accumulation in tv_modes"""
        return tv_modes.pre_breakout_accumulation(self)
    
    def early_momentum_detection(self):
        """Delegate to early_momentum_detection in tv_modes"""
        return tv_modes.early_momentum_detection(self)
    
    def relative_strength_leaders(self):
        """Delegate to relative_strength_leaders in tv_modes"""
        return tv_modes.relative_strength_leaders(self)
    
    def intraday_high_volume_breakouts(self):
        """Delegate to intraday_high_volume_breakouts in tv_modes"""
        return tv_modes.intraday_high_volume_breakouts(self)
    
    def intraday_gap_up_stocks(self):
        """Delegate to intraday_gap_up_stocks in tv_modes"""
        return tv_modes.intraday_gap_up_stocks(self)
    
    def gap_fill_trading_strategy(self):
        """Delegate to gap_fill_trading_strategy in tv_modes"""
        return tv_modes.gap_fill_trading_strategy(self)
    
    def optimized_gap_strategy_15min(self):
        """Delegate to optimized_gap_strategy_15min in tv_modes"""
        return tv_modes.optimized_gap_strategy_15min(self)
    
    def intraday_oversold_bounce(self):
        """Delegate to intraday_oversold_bounce in tv_modes"""
        return tv_modes.intraday_oversold_bounce(self)
    
    def intraday_news_momentum(self):
        """Delegate to intraday_news_momentum in tv_modes"""
        return tv_modes.intraday_news_momentum(self)
    
    def intraday_early_breakout_setup(self):
        """Delegate to intraday_early_breakout_setup in tv_modes"""
        return tv_modes.intraday_early_breakout_setup(self)
    
    def intraday_volume_accumulation(self):
        """Delegate to intraday_volume_accumulation in tv_modes"""
        return tv_modes.intraday_volume_accumulation(self)
    
    def intraday_compression_coiling(self):
        """Delegate to intraday_compression_coiling in tv_modes"""
        return tv_modes.intraday_compression_coiling(self)
    
    def swing_bullish_reversal(self):
        """Delegate to swing_bullish_reversal in tv_modes"""
        return tv_modes.swing_bullish_reversal(self)
    
    def swing_breakout_consolidation(self):
        """Delegate to swing_breakout_consolidation in tv_modes"""
        return tv_modes.swing_breakout_consolidation(self)
    
    def swing_sector_rotation(self):
        """Delegate to swing_sector_rotation in tv_modes"""
        return tv_modes.swing_sector_rotation(self)
    
    def invest_quality_growth(self):
        """Delegate to invest_quality_growth in tv_modes"""
        return tv_modes.invest_quality_growth(self)
    
    def invest_dividend_aristocrats(self):
        """Delegate to invest_dividend_aristocrats in tv_modes"""
        return tv_modes.invest_dividend_aristocrats(self)
    
    def invest_undervalued_gems(self):
        """Delegate to invest_undervalued_gems in tv_modes"""
        return tv_modes.invest_undervalued_gems(self)
    
    def research_sector_leaders(self):
        """Delegate to research_sector_leaders in tv_modes"""
        return tv_modes.research_sector_leaders(self)
    
    def research_market_sentiment(self):
        """Delegate to research_market_sentiment in tv_modes"""
        return tv_modes.research_market_sentiment(self)
    
    def research_earnings_calendar(self):
        """Delegate to research_earnings_calendar in tv_modes"""
        return tv_modes.research_earnings_calendar(self)
    
    def research_sector_performance(self):
        """Delegate to research_sector_performance in tv_modes"""
        return tv_modes.research_sector_performance(self)
    
    def research_sector_stocks(self, sector_name=None, limit=20):
        """Delegate to research_sector_stocks in tv_modes"""
        return tv_modes.research_sector_stocks(self, sector_name, limit)
    
    def heavy_breakout(self):
        """Delegate to heavy_breakout in tv_modes"""
        return tv_modes.heavy_breakout(self)
    
    def _add_heavy_breakout_analysis(self, df):
        """Delegate to _add_heavy_breakout_analysis in tv_modes"""
        return tv_modes._add_heavy_breakout_analysis(self, df)

def main():
    # To avoid circular imports and allow direct execution,
    # import tv_screener_cli dynamically or ensure it's resolvable.
    # For direct execution of tv_screen_usage.py, ensure the parent directory
    # is in sys.path or directly import:
    try:
        from tv_screener_cli import run_cli
    except ImportError:
        # Fallback for when tv_screen_usage.py is run as a script directly
        # and tv_screener_cli is not in the same python path
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from tv_screener_cli import run_cli
    
    run_cli()

if __name__ == "__main__":
    main()

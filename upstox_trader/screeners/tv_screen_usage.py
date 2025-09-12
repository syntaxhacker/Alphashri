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
import upstox_trader.screeners.modes.fomo as tv_fomo
from upstox_trader.screeners.tv_trading_core import TradingCore
from upstox_trader.screeners.tv_gap_analysis import GapAnalysis
from upstox_trader.screeners.core.technical_analysis import TechnicalAnalysis
from upstox_trader.screeners.core.live_data import LiveDataMonitor
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
        self.trade_log_file = None
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
        """Check if current time is within trading hours - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core._is_trading_hours()
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
        """Setup signal handlers for graceful shutdown - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core._setup_signal_handlers()
        return None
    
    def _signal_handler(self, signum=None, frame=None):
        """Handle shutdown signals - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core._signal_handler(signum, frame)
        return None
    
    def _cleanup_on_exit(self):
        """Cleanup function called on script exit"""
        if hasattr(self, 'positions') and self.positions:
            self._exit_all_positions("SCRIPT_EXIT")
    
    def _exit_all_positions(self, reason="MANUAL_EXIT"):
        """Exit all live positions - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core._exit_all_positions(reason)
        return None
    
    def _check_historical_trend(self, symbol, timeframe='daily', lookback_days=20):
        """Check historical trend for a symbol - delegate to technical_analysis module"""
        if self.technical_analysis:
            return self.technical_analysis._check_historical_trend(symbol, timeframe, lookback_days)
        return 'neutral'
    
    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        """Calculate trading charges - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core._calculate_trading_charges(trade_value, trade_type)
        return 0.0
    
    def _detect_volatility_level(self, symbol, current_price):
        """Detect volatility level - delegate to technical_analysis module"""
        if self.technical_analysis:
            return self.technical_analysis._detect_volatility_level(symbol, current_price)
        return 'normal'
    
    def _get_progressive_trailing_buffer(self, profit_pct, volatility_adjustment=0.0):
        """Calculate progressive trailing buffer - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core._get_progressive_trailing_buffer(profit_pct, volatility_adjustment)
        return 1.0
    
    def _get_tighter_trailing_buffer(self, profit_pct, is_ultra_quick=False):
        """MUCH TIGHTER trailing buffer for aggressive profit locking"""
        return self.config.get_trailing_buffer(profit_pct, is_ultra_quick)
    
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
        """Log trade to journal file - delegate to trading_core module"""
        if self.trading_core:
            return self.trading_core.log_trade(action, symbol, price, qty, amount, alert_type, pnl_pct, pnl_amount, side)
        return None

    
    
    def _check_momentum_divergence(self, symbol, row, previous_data=None):
        """Check for momentum divergence by delegating to fomo module."""
        return tv_fomo._check_momentum_divergence(self, symbol, row, previous_data)
    
    def _is_overextended_for_short(self, symbol):
        """Check if a stock is overextended and suitable for SHORT selling by delegating to fomo module."""
        return tv_fomo._is_overextended_for_short(self, symbol)

    def _detect_pre_breakout_volume(self, symbol, row):
        """Detect early volume building before main FOMO spike by delegating to fomo module."""
        return tv_fomo._detect_pre_breakout_volume(self, symbol, row)

    def _check_momentum_cooling(self, symbol, row):
        """Check if momentum is cooling down from excessive levels by delegating to fomo module."""
        return tv_fomo._check_momentum_cooling(self, symbol, row)

    def _analyze_gap_fill_probability(self, symbol, current_gap_size, gap_direction, lookback_days=90):
        return self.gap_analysis._analyze_gap_fill_probability(symbol, current_gap_size, gap_direction, lookback_days)

    def _detect_support_resistance_levels(self, symbol, lookback_days=60):
        return self.technical_analysis._detect_support_resistance_levels(symbol, lookback_days)
    
    def _detect_gap_reversal_signals(self, symbol, gap_direction, current_price, gap_size):
        return self.gap_analysis._detect_gap_reversal_signals(symbol, gap_direction, current_price, gap_size)

    def live_gap_fill_monitor_with_sr(self, refresh_interval=30):
        return self.gap_analysis.live_gap_fill_monitor_with_sr(refresh_interval)
    
    def _process_gap_fill_paper_trading(self, df):
        return self.gap_analysis._process_gap_fill_paper_trading(df)
    
    def _evaluate_gap_fill_trade_signal(self, symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price):
        return self.gap_analysis._evaluate_gap_fill_trade_signal(symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price)
    
    def _execute_gap_fill_trade(self, symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis):
        return self.gap_analysis._execute_gap_fill_trade(symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis)
    
    def _display_gap_fill_trading_status(self):
        return self.gap_analysis._display_gap_fill_trading_status()
    
    def _get_volume_movers_with_gaps(self):
        return self.gap_analysis._get_volume_movers_with_gaps()
    
    def _get_enhanced_gap_opportunities(self):
        return self.gap_analysis._get_enhanced_gap_opportunities()
    
    def _calculate_gap_quality_score(self, df):
        return self.gap_analysis._calculate_gap_quality_score(df)
    
    def _display_live_gap_sr_analysis(self, df):
        return self.gap_analysis._display_live_gap_sr_analysis(df)

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
        """Detect volume spikes and price movements with cooldown protection by delegating to fomo module."""
        return tv_fomo._detect_alerts(self, current_data, previous_data, volume_threshold, price_threshold)
    
    def _should_skip_alert(self, ticker, alert_type):
        """Check if we should skip this alert due to cooldown by delegating to fomo module."""
        return tv_fomo._should_skip_alert(self, ticker, alert_type)
    
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
        """Check if confirmed downtrend exists before allowing short by delegating to fomo module."""
        return tv_fomo._check_confirmed_downtrend_for_short(self, symbol, row)
    
    def _calculate_alert_confidence(self, alert_type, volume_ratio, change_pct, rsi=None):
        """Calculate confidence score by delegating to fomo module."""
        return tv_fomo._calculate_alert_confidence(self, alert_type, volume_ratio, change_pct, rsi)
    
    def _calculate_short_confidence(self, rsi, change_pct, volume_ratio, is_overextended):
        """Calculate confidence for short signals by delegating to fomo module."""
        return tv_fomo._calculate_short_confidence(self, rsi, change_pct, volume_ratio, is_overextended)
    
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
        """Send a Telegram alert - delegate to tv_alerts module"""
        if not self.telegram_enabled or tv_alerts is None:
            return
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
                            if self.technical_analysis._is_overextended_for_short(symbol):
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
        """Get live price - delegate to live_data module"""
        if self.live_data:
            return self.live_data._get_live_price_from_upstox(symbol, force_refresh)
        return None
    
    def _fetch_live_prices_parallel(self, symbols):
        """Fetch live prices for multiple symbols in parallel using threading - delegate to live_data module"""
        if self.live_data:
            return self.live_data._fetch_live_prices_parallel(symbols)
        return {}
    
    def _fetch_price_from_exchange(self, symbol, exchange):
        """Fetch price from specific exchange - delegate to live_data module"""
        if self.live_data:
            return self.live_data._fetch_price_from_exchange(symbol, exchange)
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
        """Start background thread - delegate to live_data module"""
        if self.live_data:
            return self.live_data.start_background_monitoring()
        return None
    
    def stop_background_monitoring(self):
        """Stop background monitoring thread - delegate to live_data module"""
        if self.live_data:
            return self.live_data.stop_background_monitoring()
        return None
    
    def _background_monitor_loop(self):
        """Background loop - delegate to live_data module"""
        if self.live_data:
            return self.live_data._background_monitor_loop()
        return None
    
    def _monitor_position_risk(self, symbol, position):
        """Monitor individual position for risk management - delegate to live_data module"""
        if self.live_data:
            return self.live_data._monitor_position_risk(symbol, position)
        return None
    
    
    
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

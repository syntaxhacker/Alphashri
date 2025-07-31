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
from datetime import datetime
import pandas as pd
import argparse
import time
import threading
import os
import signal
import sys
import atexit
from datetime import datetime, timedelta

# Telegram integration and Paper Trading Bot
try:
    import requests
    import sys
    import os
    # Add parent directory to path to import config
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import TELEGRAM_CONFIG, UPSTOX_CONFIG
    
    # Import paper trading bot
    sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'trading_bots'))
    from upstox_paper_trading_bot import UpstoxPaperTradingBot
    
    TELEGRAM_AVAILABLE = True
    PAPER_TRADING_AVAILABLE = True
except ImportError as e:
    TELEGRAM_AVAILABLE = False
    PAPER_TRADING_AVAILABLE = False
    print(f"⚠️ Integration not available: {e}")
    print("⚠️ Paper trading and/or Telegram disabled")

console = Console()

def get_tradingview_cookies():
    """Get TradingView cookies from browser"""
    try:
        # Try Chrome first
        cookies_raw = rookiepy.chrome(['.tradingview.com'])
        cookies = rookiepy.to_cookiejar(cookies_raw)
        console.print("[green]Successfully loaded cookies from Chrome[/green]")
        
        # Check if we have valid cookies
        if cookies_raw:
            console.print("[green]✅ Found TradingView cookies - expecting live data[/green]")
        else:
            console.print("[yellow]⚠️  No cookies found[/yellow]")
        
        return cookies
    except Exception:
        console.print("[yellow]Chrome cookies failed, trying Firefox...[/yellow]")
        try:
            cookies_raw = rookiepy.firefox(['.tradingview.com'])
            cookies = rookiepy.to_cookiejar(cookies_raw)
            console.print("[green]Successfully loaded cookies from Firefox[/green]")
            
            if cookies_raw:
                console.print("[green]✅ Found TradingView cookies - expecting live data[/green]")
            else:
                console.print("[yellow]⚠️  No cookies found[/yellow]")
            
            return cookies
        except Exception:
            console.print("[red]Could not load cookies from any browser.[/red]")
            console.print("[yellow]💡 Make sure you're logged into TradingView in your browser[/yellow]")
            console.print("[yellow]💡 Try refreshing the TradingView page and run script again[/yellow]")
            return None

class TVScreenerUsage:
    def __init__(self, market='in', enable_paper_trading=False):
        self.cookies = get_tradingview_cookies()
        self.query = Query()
        
        # Set market based on parameter
        if market.lower() == 'us':
            self.market = 'america'
        elif market.lower() == 'in':
            self.market = 'india'
        else:
            self.market = 'india'  # Default to India
            
        console.print(f"[blue]📊 Market: {self.market.upper()}[/blue]")
        
        # Initialize trade journaling
        self.journal_file = None
        self.setup_trade_journal()
        
        # Telegram integration
        self.telegram_enabled = TELEGRAM_AVAILABLE and TELEGRAM_CONFIG.get('bot_token') if TELEGRAM_AVAILABLE else False
        if self.telegram_enabled:
            console.print("[green]✅ Telegram alerts enabled[/green]")
        else:
            console.print("[yellow]⚠️ Telegram alerts disabled - configure TELEGRAM_CONFIG[/yellow]")
        
        # Alert deduplication and cooldown system
        self.sent_alerts = set()  # Track sent alerts to avoid duplicates
        self.last_alert_time = {}  # Track last alert time per symbol
        self.alert_cooldown = 300  # 5 minutes between alerts per symbol (in seconds)
        
        # Stop loss cooling system - 30 minute timeout for symbols that hit stop loss
        self.stop_loss_cooldown = {}  # Track symbols that hit stop loss: {symbol: timestamp}
        self.stop_loss_cooldown_duration = 1800  # 30 minutes in seconds
        
        # Trading Time Configuration
        self.trading_start_time = "09:20"  # Start trading at 9:30 AM
        self.trading_end_time = "15:30"    # Stop trading at 3:30 PM (market close)
        
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
        if not self.paper_trading_enabled:
            return True  # Always allow if paper trading is disabled
            
        try:
            from datetime import datetime, time
            now = datetime.now().time()
            
            # Parse trading hours
            start_time = datetime.strptime(self.trading_start_time, "%H:%M").time()
            end_time = datetime.strptime(self.trading_end_time, "%H:%M").time()
            
            # Check if current time is within trading hours
            return start_time <= now <= end_time
        except Exception as e:
            console.print(f"[yellow]⚠️ Error checking trading hours: {e}. Allowing trade.[/yellow]")
            return True  # Default to allowing trade if there's an error
    
    def _is_market_closed(self):
        """Check if market has closed (after 3:00 PM)"""
        try:
            from datetime import datetime, time
            now = datetime.now().time()
            market_close = datetime.strptime(self.trading_end_time, "%H:%M").time()
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
        """
        Calculate trailing stop buffer based on profit tiers with optional volatility adjustment
        Higher profits = Tighter trailing stops to lock in gains
        
        Profit Tiers:
        0-1%:   1.0% buffer (let it breathe)
        1-2%:   0.8% buffer (start tightening)  
        2-3%:   0.6% buffer (moderate tightening)
        3-5%:   0.4% buffer (aggressive tightening)
        5%+:    0.3% buffer (very tight - lock profits)
        
        Volatility Adjustment: +0.1-0.2% for highly volatile stocks
        """
        base_buffer = 1.0  # Default
        
        if profit_pct >= 5.0:
            base_buffer = 0.3  # Very tight for big winners
        elif profit_pct >= 3.0:
            base_buffer = 0.4  # Aggressive for good profits
        elif profit_pct >= 2.0:
            base_buffer = 0.6  # Moderate tightening
        elif profit_pct >= 1.0:
            base_buffer = 0.8  # Start tightening
        
        # Add volatility adjustment (looser for volatile stocks)
        adjusted_buffer = base_buffer + volatility_adjustment
        
        # Cap the buffer between 0.2% and 1.5%
        return max(0.2, min(1.5, adjusted_buffer))
    
    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        """
        Calculate realistic trading charges for Indian markets
        
        Charges include:
        - Brokerage: 0.03% or ₹20 per trade (whichever is lower)
        - STT: 0.025% on sell side for intraday
        - Exchange charges: 0.00325% 
        - GST: 18% on (brokerage + exchange charges)
        - SEBI charges: ₹10 per crore
        """
        # Brokerage: 0.03% or ₹20 per trade (whichever is lower)
        brokerage = min(trade_value * 0.0003, 20)
        
        # STT: 0.025% on sell side for intraday (we'll apply half on both sides)
        stt = trade_value * 0.000125 if trade_type == 'intraday' else trade_value * 0.001
        
        # Exchange charges: ~0.00325%
        exchange_charges = trade_value * 0.0000325
        
        # GST: 18% on (brokerage + exchange charges)
        gst = (brokerage + exchange_charges) * 0.18
        
        # SEBI charges: ₹10 per crore (₹1 per lakh)
        sebi_charges = max(1, trade_value / 100000)
        
        total_charges = brokerage + stt + exchange_charges + gst + sebi_charges
        return round(total_charges, 2)
    
    def _get_acceleration_based_buffer(self, current_profit, highest_profit, time_since_entry_minutes):
        """
        Alternative: Acceleration-based trailing stop
        Tightens based on momentum acceleration and time
        
        Fast acceleration (quick gains) = Tighter stops
        Slow steady gains = Normal stops
        """
        profit_velocity = current_profit / max(1, time_since_entry_minutes)  # % per minute
        
        # Base buffer from progressive system
        base_buffer = self._get_progressive_trailing_buffer(current_profit)
        
        # Acceleration adjustment
        if profit_velocity > 0.1:  # Very fast gains (>0.1% per minute)
            acceleration_adjustment = -0.2  # Tighten significantly
        elif profit_velocity > 0.05:  # Fast gains
            acceleration_adjustment = -0.1  # Tighten moderately
        elif profit_velocity < 0.01:  # Slow gains
            acceleration_adjustment = 0.1   # Loosen slightly
        else:
            acceleration_adjustment = 0.0   # No change
        
        # Apply adjustment
        adjusted_buffer = base_buffer + acceleration_adjustment
        return max(0.2, min(1.0, adjusted_buffer))
    
    def _send_telegram_alert(self, message):
        """Send telegram alert message"""
        try:
            if hasattr(self, 'send_telegram_alert'):
                # Create a mock alert object for the existing method
                alert = {'type': 'AUTO_EXIT', 'ticker': 'BULK_EXIT'}
                self.send_telegram_alert(alert)
        except Exception as e:
            pass  # Ignore telegram errors
        
    def setup_trade_journal(self):
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
                f.write("# Format: TIMESTAMP | ACTION | SYMBOL | PRICE | QTY | AMOUNT | ALERT_TYPE | P&L\n")
                f.write("-" * 80 + "\n")
    
    def log_trade(self, action, symbol, price, qty, amount, alert_type, pnl_pct=None, pnl_amount=None):
        """Log trade to journal file"""
        if not self.journal_file:
            return
            
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # Format P&L info
        pnl_info = ""
        if pnl_pct is not None:
            pnl_info = f" | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})"
        
        log_entry = f"{timestamp} | {action} | {symbol} | ₹{price:.2f} | {qty} | ₹{amount:,.0f} | {alert_type}{pnl_info}\n"
        
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
            
            # Calculate distance from 52-week high
            distance_from_high = ((price_52w_high - current_price) / current_price) * 100
            
            # Check 1: Too close to 52-week high (less than 5% below)
            if distance_from_high < 5.0:
                console.print(f"[dim yellow]⚠️ {symbol}: Too close to 52W high (only {distance_from_high:.1f}% below)[/dim yellow]")
                return False
            
            # Check 2: RSI too overbought (above 75)
            if rsi > 75:
                console.print(f"[dim yellow]⚠️ {symbol}: RSI too overbought ({rsi:.1f} > 75)[/dim yellow]")
                return False
            
            # Check 3: TODAY'S move too extreme (above 8% - CRITICAL FILTER)
            today_change = row.get('change', 0)
            if today_change > 8.0:
                console.print(f"[dim yellow]⚠️ {symbol}: Today's move too extreme (+{today_change:.1f}% > 8%)[/dim yellow]")
                return False
            
            # Check 4: Weekly performance too extended (above 15%)
            if week_perf > 15:
                console.print(f"[dim yellow]⚠️ {symbol}: Weekly move too extended (+{week_perf:.1f}% > 15%)[/dim yellow]")
                return False
            
            # Check 5: 3-month performance too extended (above 50%)
            if month3_perf > 50:
                console.print(f"[dim yellow]⚠️ {symbol}: 3-month move too extended (+{month3_perf:.1f}% > 50%)[/dim yellow]")
                return False
            
            # Check 6: Not above key moving averages (trend weakness)
            if current_price < ema20:
                console.print(f"[dim yellow]⚠️ {symbol}: Below 20 EMA - weak trend[/dim yellow]")
                return False
            
            # Check 7: EMA alignment (20 EMA should be above 50 EMA)
            if ema20 < ema50:
                console.print(f"[dim yellow]⚠️ {symbol}: 20 EMA below 50 EMA - downtrend[/dim yellow]")
                return False
            
            # If all checks pass, it's safer to enter
            console.print(f"[dim green]✅ {symbol}: Top-avoidance checks passed - safe entry zone[/dim green]")
            return True
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Error checking top avoidance for {symbol}: {e}[/dim red]")
            # If error, be conservative and avoid entry
            return False
    
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
            # Try to fetch real historical data first
            if hasattr(self, 'upstox_api') and self.upstox_api:
                return self._get_real_sr_levels_from_upstox(symbol, lookback_days)
            else:
                # Fallback to simulated levels if no Upstox API
                console.print(f"[dim yellow]⚠️ Using simulated S/R for {symbol} (no Upstox API)[/dim yellow]")
                return self._simulate_sr_levels_from_current_data(symbol)
        except Exception as e:
            console.print(f"[dim red]⚠️ S/R analysis failed for {symbol}: {e}[/dim red]")
            # Fallback to simulated on error
            try:
                return self._simulate_sr_levels_from_current_data(symbol)
            except:
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
                console.print(f"[dim yellow]No historical data for {symbol}, using simulated S/R[/dim yellow]")
                return self._simulate_sr_levels_from_current_data(symbol)
            
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
            return self._simulate_sr_levels_from_current_data(symbol)
    
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
    
    def _simulate_sr_levels_from_current_data(self, symbol):
        """Create realistic S/R levels based on current market data and technical levels"""
        try:
            # Get current stock data from screener
            total_rows, df = (
                Query()
                .select('name', 'close', 'change', 'RSI', 'price_52_week_high', 'price_52_week_low')
                .set_markets(self.market)
                .where(
                    col('name') == symbol,
                    col('exchange') == 'NSE'
                )
                .limit(1)
                .get_scanner_data(cookies=self.cookies)
            )
            
            if df.empty:
                return {'levels': [], 'data_quality': 'no_data'}
            
            row = df.iloc[0]
            current_price = row['close']
            week_52_high = row.get('price_52_week_high', current_price * 1.3)
            week_52_low = row.get('price_52_week_low', current_price * 0.7)
            
            levels = []
            
            # Generate realistic S/R levels based on technical analysis principles
            
            # 1. Psychological levels (round numbers)
            if current_price > 100:
                step = 50 if current_price > 1000 else 25
            else:
                step = 10
            
            # Find nearest round numbers above and below
            round_resistance = ((current_price // step) + 1) * step
            round_support = ((current_price // step)) * step
            
            if round_resistance > current_price:
                levels.append({
                    'type': 'resistance',
                    'price': round_resistance,
                    'distance_pct': ((round_resistance - current_price) / current_price * 100),
                    'strength': 'moderate'
                })
            
            if round_support < current_price:
                levels.append({
                    'type': 'support',
                    'price': round_support,
                    'distance_pct': ((current_price - round_support) / current_price * 100),
                    'strength': 'moderate'
                })
            
            # 2. Fibonacci retracement levels (if we have 52-week range)
            if week_52_high > current_price:
                fib_resistance = current_price + (week_52_high - current_price) * 0.382  # 38.2% resistance
                if fib_resistance != round_resistance:  # Avoid duplicates
                    levels.append({
                        'type': 'resistance',
                        'price': fib_resistance,
                        'distance_pct': ((fib_resistance - current_price) / current_price * 100),
                        'strength': 'weak'
                    })
            
            if week_52_low < current_price:
                fib_support = current_price - (current_price - week_52_low) * 0.382  # 38.2% support
                if fib_support != round_support:  # Avoid duplicates
                    levels.append({
                        'type': 'support',
                        'price': fib_support,
                        'distance_pct': ((current_price - fib_support) / current_price * 100),
                        'strength': 'weak'
                    })
            
            # 3. Recent high/low levels (simulated)
            recent_resistance = current_price * 1.05  # 5% above current price
            recent_support = current_price * 0.95     # 5% below current price
            
            levels.append({
                'type': 'resistance',
                'price': recent_resistance,
                'distance_pct': 5.0,
                'strength': 'strong'
            })
            
            levels.append({
                'type': 'support',
                'price': recent_support,
                'distance_pct': 5.0,
                'strength': 'strong'
            })
            
            # Sort by distance from current price
            levels = sorted(levels, key=lambda x: x['distance_pct'])
            
            # Round prices properly
            for level in levels:
                level['price'] = round(level['price'], 2)
                level['distance_pct'] = round(level['distance_pct'], 2)
            
            return {
                'levels': levels[:6],  # Return top 6 closest levels
                'current_price': round(current_price, 2),
                'data_quality': 'simulated',
                'lookback_days': 'current_data'
            }
            
        except Exception as e:
            console.print(f"[dim red]⚠️ S/R simulation failed for {symbol}: {e}[/dim red]")
            return {'levels': [], 'data_quality': 'error'}

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
        """Calculate strength of a support/resistance level based on touch frequency"""
        tolerance = 0.01  # 1% tolerance
        touches = sum(1 for l in all_levels if abs(l - level) / level <= tolerance)
        
        if touches >= 4:
            return 'strong'
        elif touches >= 2:
            return 'moderate'
        else:
            return 'weak'
    
    def _calculate_trend_target_probability(self, current_price, target_price, trend_strength, gap_direction):
        """Calculate probability of reaching target based on trend and gap analysis"""
        distance_pct = abs((target_price - current_price) / current_price * 100)
        
        # Base probability based on distance
        if distance_pct < 1:
            base_prob = 85
        elif distance_pct < 2:
            base_prob = 70
        elif distance_pct < 3:
            base_prob = 55
        elif distance_pct < 5:
            base_prob = 40
        else:
            base_prob = 25
        
        # Adjust based on trend alignment
        target_direction = 'UP' if target_price > current_price else 'DOWN'
        
        # Trend multipliers
        trend_multiplier = 1.0
        if trend_strength == 'strong_bullish' and target_direction == 'UP':
            trend_multiplier = 1.3
        elif trend_strength == 'bullish' and target_direction == 'UP':
            trend_multiplier = 1.15
        elif trend_strength == 'strong_bearish' and target_direction == 'DOWN':
            trend_multiplier = 1.3
        elif trend_strength == 'bearish' and target_direction == 'DOWN':
            trend_multiplier = 1.15
        elif (trend_strength in ['strong_bullish', 'bullish'] and target_direction == 'DOWN') or \
             (trend_strength in ['strong_bearish', 'bearish'] and target_direction == 'UP'):
            trend_multiplier = 0.7
        
        # Gap direction alignment
        gap_multiplier = 1.0
        if gap_direction and target_direction:
            if (gap_direction == 'UP' and target_direction == 'DOWN') or \
               (gap_direction == 'DOWN' and target_direction == 'UP'):
                gap_multiplier = 1.2  # Gap fill scenario
        
        final_probability = min(95, base_prob * trend_multiplier * gap_multiplier)
        return round(final_probability, 1)

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

    def display_table(self, df, title, max_rows=15):
        """Display results in a formatted table"""
        if df.empty:
            console.print(f"[red]No results found for {title}[/red]")
            return
            
        table = Table(title=title, show_header=True, header_style="bold magenta")
        
        # Add columns dynamically based on dataframe
        for col_name in df.columns:
            if col_name == 'ticker':
                table.add_column("Ticker", style="cyan", no_wrap=True)
            elif col_name == 'name':
                table.add_column("Name", style="green", max_width=12)
            elif col_name == 'close':
                table.add_column("Price", justify="right", style="yellow")
            elif col_name == 'volume':
                table.add_column("Volume", justify="right", style="blue")
            elif col_name == 'change':
                table.add_column("Change %", justify="right", style="magenta")
            elif col_name == 'RSI':
                table.add_column("RSI", justify="right", style="cyan")
            elif col_name == 'relative_volume_10d_calc':
                table.add_column("Vol Ratio", justify="right", style="blue")
            elif col_name == 'Volatility.D':
                table.add_column("Volatility %", justify="right", style="red")
            elif col_name == 'market_cap_basic':
                table.add_column("MCap (₹Cr)", justify="right", style="green")
            elif col_name == 'price_earnings_ttm':
                table.add_column("PE", justify="right", style="yellow")
            elif col_name == 'return_on_equity':
                table.add_column("ROE %", justify="right", style="green")
            elif col_name == 'dividends_yield_current':
                table.add_column("Div Yield", justify="right", style="blue")
            elif col_name == 'debt_to_equity':
                table.add_column("D/E", justify="right", style="red")
            elif col_name == 'update_mode':
                table.add_column("Data", style="dim")
            elif col_name == 'trend':
                table.add_column("Trend", style="bold", justify="center")
        
        # Add rows
        for i, (_, row) in enumerate(df.head(max_rows).iterrows()):
            row_data = []
            for col_name in df.columns:
                if col_name == 'ticker':
                    row_data.append(row[col_name])
                elif col_name == 'name':
                    row_data.append(row[col_name][:12])  # Truncate name
                elif col_name == 'close':
                    row_data.append(f"₹{row[col_name]:,.2f}")
                elif col_name == 'volume':
                    row_data.append(f"{row[col_name]:,.0f}")
                elif col_name == 'change':
                    change_val = row[col_name]
                    color = "green" if change_val > 0 else "red"
                    row_data.append(f"[{color}]{change_val:+.2f}%[/{color}]")
                elif col_name == 'RSI':
                    rsi_val = row[col_name]
                    if rsi_val > 70:
                        row_data.append(f"[red]{rsi_val:.1f}[/red]")
                    elif rsi_val < 30:
                        row_data.append(f"[green]{rsi_val:.1f}[/green]")
                    else:
                        row_data.append(f"{rsi_val:.1f}")
                elif col_name == 'relative_volume_10d_calc':
                    row_data.append(f"{row[col_name]:.2f}x")
                elif col_name == 'Volatility.D':
                    row_data.append(f"{row[col_name]*100:.1f}%")
                elif col_name == 'market_cap_basic':
                    row_data.append(f"₹{row[col_name]/1e7:,.0f}")
                elif col_name == 'price_earnings_ttm':
                    pe_val = row[col_name]
                    if pd.isna(pe_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{pe_val:.1f}")
                elif col_name == 'return_on_equity':
                    roe_val = row[col_name]
                    if pd.isna(roe_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{roe_val:.1f}%")
                elif col_name == 'dividends_yield_current':
                    div_val = row[col_name]
                    if pd.isna(div_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{div_val:.2f}%")
                elif col_name == 'debt_to_equity':
                    de_val = row[col_name]
                    if pd.isna(de_val):
                        row_data.append("N/A")
                    else:
                        row_data.append(f"{de_val:.2f}")
                elif col_name == 'update_mode':
                    row_data.append(row[col_name])
                elif col_name == 'trend':
                    trend_val = row[col_name]
                    if trend_val == 'strong_bullish':
                        row_data.append("[bold green]🚀 Strong Bull[/bold green]")
                    elif trend_val == 'bullish':
                        row_data.append("[green]📈 Bullish[/green]")
                    elif trend_val == 'neutral':
                        row_data.append("[yellow]➡️ Neutral[/yellow]")
                    elif trend_val == 'bearish':
                        row_data.append("[red]📉 Bearish[/red]")
                    elif trend_val == 'strong_bearish':
                        row_data.append("[bold red]💥 Strong Bear[/bold red]")
                    else:
                        row_data.append(f"[dim]{trend_val}[/dim]")
                else:
                    row_data.append(str(row[col_name]))
            
            table.add_row(*row_data)
        
        console.print(table)
        console.print(f"[dim]Showing {min(len(df), max_rows)} of {len(df)} results[/dim]")

    # ==================== PRE-BREAKOUT STRATEGIES (NEW) ====================
    
    def pre_breakout_accumulation(self):
        """Find stocks in accumulation phase before breakout"""
        console.print(Panel.fit("📊 PRE-BREAKOUT: Accumulation Patterns", style="bold blue"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'price_52_week_high', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50 for liquidity
                    col('volume') > 200000,  # Decent volume but not explosive
                    col('relative_volume_10d_calc').between(0.8, 1.8),  # Normal to slightly above volume
                    col('change').between(-2, 3),  # Consolidating, not explosive moves
                    col('RSI').between(40, 65),  # Building strength but not overbought
                    col('close') > col('EMA20'),  # Above 20 EMA (trend support)
                    col('close') > 200,  # Strong price level (proxy for quality stocks)
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
                .order_by('RSI', ascending=False)  # Stocks gaining momentum
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Add trend analysis for each stock
            if not df.empty:
                console.print("[dim]Adding trend analysis...[/dim]")
                trend_data = []
                for _, row in df.iterrows():
                    ticker = row['name']  # Use 'name' field as it contains the ticker
                    trend = self._check_historical_trend(ticker, timeframe='daily', lookback_days=15)
                    trend_data.append(trend)
                df['trend'] = trend_data
            
            self.display_table(df, "Pre-Breakout Accumulation - Early Entry")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On volume expansion above EMA20 with RSI >50")
            console.print("• Stop Loss: Below EMA20 or recent swing low (0.5%)")
            console.print("• Target: Resistance levels or 52W high")
            console.print("• Logic: Catch accumulation before the breakout crowd")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def early_momentum_detection(self):
        """Detect early momentum before FOMO kicks in"""
        console.print(Panel.fit("⚡ EARLY MOMENTUM: Pre-FOMO Signals", style="bold green"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 30,  # Lower threshold for early detection
                    col('volume') > 100000,  # Minimum liquidity
                    col('relative_volume_10d_calc').between(1.1, 2.5),  # Slightly elevated volume
                    col('change').between(0.5, 4),  # Small positive moves
                    col('RSI') > col('RSI[1]'),  # RSI improving
                    col('RSI').between(35, 70),  # Not oversold, not overbought
                    col('MACD.macd') > col('MACD.signal'),  # MACD bullish crossover
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
                .order_by('change', ascending=False)  # Current momentum
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Early Momentum - Before FOMO")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: When RSI crosses 50 with volume confirmation")
            console.print("• Stop Loss: Below recent swing low (0.5%)")
            console.print("• Target: Next resistance or 3-5% move")
            console.print("• Logic: Catch momentum before crowd notices")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def relative_strength_leaders(self):
        """Find stocks showing relative strength vs market"""
        console.print(Panel.fit("💪 RELATIVE STRENGTH: Market Outperformers", style="bold cyan"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'Perf.W', 'Perf.M', 
                       'RSI', 'Beta', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('volume') > 150000,  # Decent volume
                    col('Perf.W') > 2,  # Outperforming weekly
                    col('Perf.M') > 5,  # Strong monthly performance
                    col('change') > -2,  # Not falling hard today
                    col('RSI').between(45, 75),  # Good momentum zone
                    col('Beta') > 0.8,  # Responsive to market moves
                    col('market_cap_basic') > 3e8,  # Min 300 crores
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
                .order_by('Perf.W', ascending=False)  # Best weekly performers
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Relative Strength Leaders")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On any pullback or consolidation break")
            console.print("• Stop Loss: Below weekly support (0.5%)")
            console.print("• Target: Continuation of relative strength trend")
            console.print("• Logic: Leaders continue to lead in trends")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    # ==================== INTRADAY TRADING STRATEGIES ====================
    
    def intraday_high_volume_breakouts(self):
        """Find stocks with high volume breakouts for intraday trading"""
        console.print(Panel.fit("🚀 INTRADAY: High Volume Breakouts", style="bold blue"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50 for liquidity
                    col('volume') > 1000000,  # High volume
                    col('relative_volume_10d_calc') > 2,  # 2x normal volume
                    col('change') > 2,  # Positive momentum
                    col('RSI').between(50, 80),  # Not overbought
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "High Volume Breakouts - Intraday")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On breakout above resistance with high volume")
            console.print("• Stop Loss: Below recent support (0.5%)")
            console.print("• Target: 1:2 risk-reward ratio")
            console.print("• Time Frame: 5-15 minute charts")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def intraday_gap_up_stocks(self):
        """Find gap-up stocks for intraday momentum trading"""
        console.print(Panel.fit("📈 INTRADAY: Gap-Up Momentum", style="bold green"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'price_52_week_high', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Above ₹100
                    col('change') > 3,  # Gap up 3%+
                    col('volume') > 500000,  # Good volume
                    col('relative_volume_10d_calc') > 1.5,  # Above average volume
                    col('exchange') == 'NSE',  # NSE only, ignore BSE
                    col('RSI') < 80,  # Not extremely overbought
                    col('price_52_week_high') > col('close')  # Not at 52W high
                )
                .order_by('change', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Gap-Up Momentum Stocks")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On pullback to gap support or breakout continuation")
            console.print("• Stop Loss: Below gap fill level (0.5%)")
            console.print("• Target: Previous resistance or 5-8% gain")
            console.print("• Time Frame: 15-30 minute charts")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def gap_fill_trading_strategy(self):
        """
        🎯 GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)
        =================================================
        
        True gap-fill strategy that:
        - Analyzes historical gap-fill patterns for each stock
        - Calculates probability of gap filling based on 90-day history
        - Provides precise entry/exit signals for gap trades
        - Focuses on stocks with predictable gap-fill behavior
        
        STRATEGY LOGIC:
        - Gap UP: Look for SHORT opportunities (expect fill down)
        - Gap DOWN: Look for LONG opportunities (expect fill up)
        - Entry: After 9:30 AM when gap direction is confirmed
        - Target: Previous day's closing price (gap fill level)
        - Stop: Beyond gap extreme with 1-2% buffer
        """
        console.print(Panel.fit("🎯 GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)", style="bold magenta"))
        
        try:
            # Screen for stocks with significant gaps today
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'Volatility.D', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 30,  # Minimum price for liquidity
                    col('volume') > 300000,  # Minimum liquidity
                    col('relative_volume_10d_calc') > 1.2,  # Above normal volume
                    col('market_cap_basic') > 1e8,  # Min 100 crores (avoid penny stocks)
                    col('exchange') == 'NSE'  # NSE only for better data
                )
                .order_by('relative_volume_10d_calc', ascending=False)  # Highest volume first
                .limit(25)  # Focus on top gap opportunities
                .get_scanner_data(cookies=self.cookies)
            )
            
            if df.empty:
                console.print("[yellow]No volume movers found in current market scan[/yellow]")
                return
            
            # Filter for stocks with meaningful gaps (0.8% or more)
            df = df[abs(df['change']) >= 0.8].copy()
            
            if df.empty:
                console.print("[yellow]No significant gaps found in current volume movers[/yellow]")
                return
            
            # Analyze gap-fill probability for each stock
            console.print("[dim]Analyzing historical gap-fill patterns...[/dim]")
            gap_analysis_results = []
            
            for _, row in df.iterrows():
                symbol = row['name']
                current_change = row['change']
                gap_direction = 'UP' if current_change > 0 else 'DOWN'
                
                # Get historical gap-fill analysis
                gap_analysis = self._analyze_gap_fill_probability(
                    symbol=symbol,
                    current_gap_size=abs(current_change),
                    gap_direction=gap_direction,
                    lookback_days=90
                )
                
                # Add analysis results to the row data
                row_data = row.to_dict()
                row_data.update({
                    'gap_direction': gap_direction,
                    'gap_fill_probability': gap_analysis['probability'],
                    'historical_similar_gaps': gap_analysis.get('total_similar_gaps', 0),
                    'historical_fills': gap_analysis.get('filled_gaps', 0),
                    'avg_fill_rate': gap_analysis.get('avg_fill_percentage', 0),
                    'data_quality': gap_analysis['historical_data']
                })
                gap_analysis_results.append(row_data)
            
            # Convert to DataFrame and sort by fill probability
            gap_df = pd.DataFrame(gap_analysis_results)
            gap_df = gap_df.sort_values('gap_fill_probability', ascending=False)
            
            # Display results
            self._display_gap_fill_results(gap_df)
            
        except Exception as e:
            console.print(f"[red]Error in gap-fill strategy: {e}[/red]")
    
    def _display_gap_fill_results(self, gap_df):
        """Display gap-fill analysis results in a formatted table"""
        if gap_df.empty:
            console.print("[yellow]No gap-fill opportunities found[/yellow]")
            return
        
        # Create table for gap-fill opportunities
        table = Table(title="🎯 Gap-Fill Trading Opportunities (Historical Analysis)", show_header=True, header_style="bold magenta")
        table.add_column("Symbol", style="cyan", no_wrap=True)
        table.add_column("Gap", justify="right", style="yellow")
        table.add_column("Direction", justify="center", style="bold")
        table.add_column("Fill Prob", justify="right", style="green")
        table.add_column("Historical", justify="center", style="blue")
        table.add_column("Volume", justify="right", style="red")
        table.add_column("Trade Signal", justify="center", style="bold")
        
        high_prob_trades = 0
        
        for _, row in gap_df.head(15).iterrows():
            symbol = row['name'][:12]
            gap_size = row['change']
            gap_direction = row['gap_direction']
            fill_prob = row['gap_fill_probability']
            similar_gaps = row['historical_similar_gaps']
            filled_gaps = row['historical_fills']
            vol_ratio = row['relative_volume_10d_calc']
            
            # Format gap display
            gap_color = "green" if gap_size > 0 else "red"
            gap_display = f"[{gap_color}]{gap_size:+.2f}%[/{gap_color}]"
            
            # Format direction with emoji
            direction_display = "🔺 UP" if gap_direction == "UP" else "🔻 DOWN"
            
            # Format probability with color coding
            if fill_prob >= 70:
                prob_color = "bold green"
                prob_display = f"[{prob_color}]{fill_prob:.1f}%[/{prob_color}]"
            elif fill_prob >= 50:
                prob_color = "yellow"
                prob_display = f"[{prob_color}]{fill_prob:.1f}%[/{prob_color}]"
            else:
                prob_color = "red"
                prob_display = f"[{prob_color}]{fill_prob:.1f}%[/{prob_color}]"
            
            # Historical data display
            historical_display = f"{filled_gaps}/{similar_gaps}" if similar_gaps > 0 else "N/A"
            
            # Volume display
            vol_color = "bold red" if vol_ratio > 3 else "red" if vol_ratio > 2 else "white"
            vol_display = f"[{vol_color}]{vol_ratio:.1f}x[/{vol_color}]"
            
            # Trade signal
            if fill_prob >= 60 and similar_gaps >= 3:
                if gap_direction == "UP":
                    signal = "[bold red]📉 SHORT[/bold red]"
                else:
                    signal = "[bold green]📈 LONG[/bold green]"
                high_prob_trades += 1
            elif fill_prob >= 45:
                signal = "[yellow]⚠️ WATCH[/yellow]"
            else:
                signal = "[dim]❌ SKIP[/dim]"
            
            table.add_row(
                symbol,
                gap_display,
                direction_display,
                prob_display,
                historical_display,
                vol_display,
                signal
            )
        
        console.print(table)
        
        # Display strategy guidance
        console.print(f"\n[bold yellow]📊 ANALYSIS SUMMARY:[/bold yellow]")
        console.print(f"• [green]High-probability trades:[/green] {high_prob_trades}")
        console.print(f"• [cyan]Total opportunities:[/cyan] {len(gap_df)}")
        console.print(f"• [blue]Analysis period:[/blue] 90-day historical lookback")
        
        console.print(f"\n[bold yellow]🎯 TRADING STRATEGY:[/bold yellow]")
        console.print("• [green]Entry:[/green] After 9:30 AM gap confirmation")
        console.print("• [green]TARGET:[/green] Previous day's closing price (gap fill)")
        console.print("• [green]STOP LOSS:[/green] Beyond gap extreme + 1-2% buffer")
        console.print("• [green]Position Size:[/green] Risk 0.5-1% of capital per trade")
        
        console.print(f"\n[bold yellow]📈 SIGNAL INTERPRETATION:[/bold yellow]")
        console.print("• [bold green]📈 LONG:[/bold green] Gap DOWN with high fill probability")
        console.print("• [bold red]📉 SHORT:[/bold red] Gap UP with high fill probability")
        console.print("• [yellow]⚠️ WATCH:[/yellow] Moderate probability - wait for confirmation")
        console.print("• [dim]❌ SKIP:[/dim] Low probability or insufficient historical data")
        
        # Display top 3 recommendations
        top_trades = gap_df[gap_df['gap_fill_probability'] >= 60].head(3)
        if not top_trades.empty:
            console.print(f"\n[bold yellow]🏆 TOP RECOMMENDATIONS:[/bold yellow]")
            for i, (_, row) in enumerate(top_trades.iterrows(), 1):
                symbol = row['name']
                gap_size = row['change']
                fill_prob = row['gap_fill_probability']
                direction = "SHORT" if row['gap_direction'] == "UP" else "LONG"
                
                console.print(f"{i}. [cyan]{symbol}[/cyan]: {direction} ({gap_size:+.2f}% gap, {fill_prob:.1f}% fill probability)")

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
                df = df[abs(df['change']) >= 0.8].copy()
            
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

    def optimized_gap_strategy_15min(self):
        """
        🚀 OPTIMIZED GAP STRATEGY (15-MIN TIMEFRAME)
        ============================================
        
        Based on comprehensive backtesting of 50+ stocks, this strategy uses:
        - 15-minute timeframe for optimal entry timing
        - 68.4% win rate proven performance  
        - 2.5% target with 1% stop loss
        - Entry after 9:30 AM trend confirmation
        - Focus on high-quality gaps with volume confirmation
        
        PROVEN RESULTS:
        ✅ Total P&L: ₹2,965 across 19 stocks
        ✅ Win Rate: 68.4% (vs 31.6% for 1-min, 63.2% for 5-min)
        ✅ Works across all market caps (100% win rate on large caps)
        """
        console.print(Panel.fit("🚀 OPTIMIZED GAP STRATEGY (15-MIN PROVEN)", style="bold green"))
        
        try:
            # Screen for high-quality gap opportunities
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'Volatility.D', 'price_52_week_high', 'update_mode')
                .set_markets(self.market)
                .where(
                    # Quality gap criteria (proven in backtesting)
                    col('close') > 50,  # Minimum price for liquidity
                    col('change') > 1,  # At least 1% gap for momentum
                    col('change') < 15,  # Avoid extreme gaps (retracement risk)
                    
                    # Volume confirmation (critical for 15-min success)
                    col('volume') > 500000,  # Minimum liquidity
                    col('relative_volume_10d_calc') > 2.0,  # 2x+ volume (institutional interest)
                    
                    # Risk management filters
                    col('RSI') < 85,  # Not extremely overbought
                    col('RSI') > 25,  # Not in freefall
                    col('exchange') == 'NSE',  # NSE only for better liquidity
                    
                    # Quality and size filters
                    col('market_cap_basic') > 2e8,  # Min 200 crores (avoid penny stocks)
                    col('Volatility.D') < 0.08,  # Reasonable volatility (<8%)
                    col('price_52_week_high') > col('close')  # Room for upside
                )
                .order_by('relative_volume_10d_calc', ascending=False)  # Highest volume first
                .limit(20)  # Focus on top 20 opportunities
                .get_scanner_data(cookies=self.cookies)
            )
            
            if df.empty:
                console.print("[yellow]No gap opportunities meeting quality criteria found[/yellow]")
                return
            
            # Add quality scoring for each stock
            df['quality_score'] = self._calculate_quality_score(df)
            
            # Sort by quality score
            df = df.sort_values('quality_score', ascending=False)
            
            self.display_table(df, "🚀 Optimized 15-Min Gap Strategy Stocks")
            
            # Display strategy details
            console.print("\n[bold yellow]📊 PROVEN STRATEGY PARAMETERS:[/bold yellow]")
            console.print("• [green]Timeframe:[/green] 15-minute intervals (68.4% win rate)")
            console.print("• [green]Entry:[/green] 9:30 AM after trend confirmation")
            console.print("• [green]Target:[/green] 2.5% (proven achievable)")
            console.print("• [green]Stop Loss:[/green] 0.5% (tight risk control)")
            console.print("• [green]Expected P&L:[/green] ₹156 per trade average")
            
            console.print("\n[bold yellow]🎯 ENTRY STRATEGY:[/bold yellow]")
            console.print("1. [cyan]Wait for 9:30 AM[/cyan] - Let market settle after opening volatility")
            console.print("2. [cyan]Check 15-min chart[/cyan] - Look for gap holding above previous close")
            console.print("3. [cyan]Volume confirmation[/cyan] - Ensure 2x+ volume continues")
            console.print("4. [cyan]Enter on pullback[/cyan] - Buy gap support or breakout continuation")
            console.print("5. [cyan]Set strict levels[/cyan] - 2.5% target, 0.5% stop loss")
            
            console.print("\n[bold yellow]⚠️ QUALITY SCORING (Higher = Better):[/bold yellow]")
            for _, row in df.head(5).iterrows():
                score = row['quality_score']
                color = "green" if score >= 80 else "yellow" if score >= 60 else "red"
                recommendation = "BUY" if score >= 80 else "CAUTIOUS" if score >= 60 else "AVOID"
                
                console.print(f"• [cyan]{row['name'][:15]:15}[/cyan] | "
                            f"Gap: {row['change']:+5.1f}% | "
                            f"Vol: {row['relative_volume_10d_calc']:4.1f}x | "
                            f"Score: [{color}]{score:3.0f}/100[/{color}] | "
                            f"[{color}]{recommendation}[/{color}]")
            
            console.print("\n[bold yellow]📈 BACKTESTING RESULTS SUMMARY:[/bold yellow]")
            console.print("• [green]Tested:[/green] 50+ stocks, 57 total trades")
            console.print("• [green]15-Min Performance:[/green] 68.4% win rate, ₹2,965 total profit")
            console.print("• [green]Large Caps:[/green] 100% win rate (4/4 trades)")
            console.print("• [green]Gap Up Focus:[/green] 75% win rate (vs 33% for gap downs)")
            console.print("• [green]Risk-Adjusted:[/green] Positive expected value with tight stops")
            
            # Paper trading integration if available
            if hasattr(self, 'paper_trading_enabled') and self.paper_trading_enabled:
                console.print("\n[bold blue]📊 PAPER TRADING READY:[/bold blue]")
                console.print("• Strategy parameters loaded for automated execution")
                console.print("• 15-min timeframe monitoring active")
                console.print("• Quality scoring filters applied")
                
                # Process top quality stocks for paper trading
                top_stocks = df[df['quality_score'] >= 80].head(5)
                if not top_stocks.empty:
                    console.print(f"\n[bold blue]🤖 AUTO-TRADING {len(top_stocks)} HIGH-QUALITY GAPS:[/bold blue]")
                    
                    for _, row in top_stocks.iterrows():
                        # Create alert for paper trading system
                        alert = {
                            'type': 'OPTIMIZED_GAP_15MIN',
                            'ticker': row.get('ticker', row['name']),
                            'symbol': row.get('ticker', row['name']),
                            'price': row['close'],
                            'change': row['change'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'quality_score': row['quality_score'],
                            'confidence': min(0.95, row['quality_score'] / 100),  # Convert score to confidence
                            'target_pct': 2.5,  # Proven target
                            'stop_loss_pct': 1.0,  # Proven stop loss
                            'timeframe': '15min',
                            'strategy': 'gap_15min_optimized',
                            'reason': f"Gap {row['change']:+.1f}% with {row['relative_volume_10d_calc']:.1f}x volume (Score: {row['quality_score']:.0f}/100)"
                        }
                        
                        # Send to paper trading system
                        self._process_gap_paper_trading_alert(alert)
                        
                        console.print(f"   🤖 {row['name'][:15]:15} | Gap: {row['change']:+.1f}% | Score: {row['quality_score']:3.0f} | Target: +2.5% | Stop: -1.0%")
                
            # Alert setup guidance
            console.print("\n[bold yellow]🔔 ALERT SETUP:[/bold yellow]")
            console.print("• [cyan]9:15 AM:[/cyan] Check screener for gap stocks")
            console.print("• [cyan]9:30 AM:[/cyan] Analyze top quality scores on 15-min charts")
            console.print("• [cyan]Entry:[/cyan] Wait for trend confirmation before entering")
            console.print("• [cyan]Exit:[/cyan] Stick to 2.5% target / 0.5% stop discipline")
            
            console.print("\n[bold blue]💡 HOW TO USE THIS STRATEGY:[/bold blue]")
            console.print("1. [yellow]Run this screener at 9:15 AM[/yellow] after market opens")
            console.print("2. [yellow]Focus on stocks with Quality Score ≥80[/yellow] (BUY recommendation)")
            console.print("3. [yellow]Switch to 15-minute charts[/yellow] in your trading platform")
            console.print("4. [yellow]Wait until 9:30 AM[/yellow] for trend confirmation")
            console.print("5. [yellow]Enter trades with strict discipline[/yellow]: 2.5% target, 0.5% stop")
            console.print("6. [yellow]Expected performance[/yellow]: 68.4% win rate, ₹156 avg profit")
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error in optimized gap strategy: {e}[/red]")
            return None
    
    def _calculate_quality_score(self, df):
        """Calculate quality score for gap stocks based on backtesting insights"""
        scores = []
        
        for _, row in df.iterrows():
            score = 100  # Start with perfect score
            
            # Gap size analysis (based on backtesting results)
            gap_pct = row['change']
            if gap_pct > 8:
                score -= 25  # Large gaps often retrace
            elif gap_pct < 1:
                score -= 15  # Too small for momentum
            elif 2 <= gap_pct <= 5:
                score += 10  # Sweet spot range
            
            # Volume confirmation (critical factor)
            vol_ratio = row['relative_volume_10d_calc']
            if vol_ratio > 15:
                score += 15  # Exceptional volume
            elif vol_ratio > 5:
                score += 10  # Good volume
            elif vol_ratio < 2:
                score -= 20  # Insufficient volume
            
            # RSI positioning
            rsi = row.get('RSI', 50)
            if rsi > 80:
                score -= 15  # Overbought risk
            elif rsi < 30:
                score -= 10  # Oversold (may continue down)
            elif 45 <= rsi <= 70:
                score += 5   # Good momentum zone
            
            # Market cap factor
            mcap = row.get('market_cap_basic', 0)
            if mcap > 1e10:  # > 1000 crores
                score += 5   # Large cap stability
            elif mcap < 5e8:  # < 500 crores
                score -= 10  # Small cap volatility risk
            
            # Volatility check
            volatility = row.get('Volatility.D', 0.05)
            if volatility > 0.06:
                score -= 10  # High volatility risk
            elif volatility < 0.03:
                score += 5   # Stable stock
            
            scores.append(max(0, min(100, score)))  # Clamp between 0-100
        
        return scores
    
    def intraday_oversold_bounce(self):
        """Find oversold stocks for bounce trading"""
        console.print(Panel.fit("🔄 INTRADAY: Oversold Bounce", style="bold cyan"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'RSI', 'MACD.macd', 
                       'MACD.signal', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 75,  # Above ₹75
                    col('change') < -2,  # Down 2%+
                    col('RSI') < 35,  # Oversold
                    col('volume') > 750000,  # Good volume
                    col('market_cap_basic') > 1e9,  # Min 1000 crores
                    col('MACD.macd') > col('MACD.signal')  # MACD turning positive
                )
                .order_by('RSI', ascending=True)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Oversold Bounce Candidates")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On RSI reversal above 30 with volume")
            console.print("• Stop Loss: Below recent low (0.5%)")
            console.print("• Target: Previous support turned resistance")
            console.print("• Time Frame: 15-30 minute charts")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def intraday_news_momentum(self):
        """Find stocks with unusual activity (potential news-driven)"""
        console.print(Panel.fit("📰 INTRADAY: News-Driven Momentum", style="bold magenta"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 25,  # Above ₹25
                    col('relative_volume_10d_calc') > 3,  # 3x normal volume
                    col('Volatility.D') > 0.05,  # High volatility
                    col('volume') > 2000000,  # Very high volume
                    col('market_cap_basic') > 2e8  # Min 200 crores
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "News-Driven Momentum Stocks")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Research: Check news/announcements immediately")
            console.print("• Entry: On pullback or momentum continuation")
            console.print("• Stop Loss: Tight stops (0.5%) due to volatility")
            console.print("• Target: Quick profits (1.0%), trail stops")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def intraday_early_breakout_setup(self):
        """Find stocks building momentum BEFORE breakout - Early Detection"""
        console.print(Panel.fit("🎯 INTRADAY: Early Breakout Setup (Pre-Breakout)", style="bold red"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'MACD.macd', 'MACD.signal', 'BB.upper', 'BB.lower', 
                       'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('change').between(-1, 2),  # Small moves (building pressure)
                    col('relative_volume_10d_calc') > 1.3,  # Above average volume (accumulation)
                    col('RSI').between(45, 65),  # Building momentum, not overbought
                    col('MACD.macd') > col('MACD.signal'),  # MACD turning bullish
                    col('Volatility.D') < 0.04,  # Low volatility (compression)
                    col('volume') > 500000,  # Decent volume
                    col('market_cap_basic') > 5e8  # Min 500 crores
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Early Breakout Setup - Pre-Breakout Detection")
            
            console.print("\n[bold yellow]💡 Early Detection Strategy:[/bold yellow]")
            console.print("• Entry: These stocks are BUILDING momentum (not broken out yet)")
            console.print("• Watch: For volume surge + breakout above recent resistance")
            console.print("• Advantage: Get in BEFORE the big move starts")
            console.print("• Stop Loss: Below recent consolidation low (0.5%)")
            console.print("• Target: Measured move from consolidation breakout")
            console.print("• Time Frame: 5-15 minute charts for entry timing")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def intraday_volume_accumulation(self):
        """Find stocks with smart money accumulation - High volume, minimal price movement"""
        console.print(Panel.fit("📊 INTRADAY: Volume Accumulation (Smart Money)", style="bold cyan"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'price_52_week_high', 'price_52_week_low', 'BB.upper', 
                       'BB.lower', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 75,  # Above ₹75
                    col('change').between(-1.5, 1.5),  # Minimal price movement
                    col('relative_volume_10d_calc') > 2.0,  # High volume (2x+ normal)
                    col('RSI').between(40, 60),  # Neutral RSI (no extreme)
                    col('volume') > 1000000,  # High absolute volume
                    col('market_cap_basic') > 1e9,  # Min 1000 crores
                    # Near middle of 52-week range (not at extremes)
                    col('close') > col('price_52_week_low'),
                    col('close') < col('price_52_week_high')
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Volume Accumulation - Smart Money Building")
            
            console.print("\n[bold yellow]💡 Volume Accumulation Strategy:[/bold yellow]")
            console.print("• Pattern: High volume + small price moves = Smart money buying")
            console.print("• Entry: On breakout above accumulation range with volume")
            console.print("• Logic: Big players accumulating before major move")
            console.print("• Stop Loss: Below accumulation support")
            console.print("• Target: Previous resistance levels")
            console.print("• Time Frame: Can hold 1-3 days for bigger moves")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def intraday_compression_coiling(self):
        """Find stocks in compression/coiling phase - Low volatility before explosion"""
        console.print(Panel.fit("🌪️ INTRADAY: Compression/Coiling Stocks", style="bold yellow"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'BB.upper', 'BB.lower', 'Volatility.D', 'ATR',
                       'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Above ₹100
                    col('Volatility.D') < 0.025,  # Very low volatility (coiling)
                    col('change').between(-0.8, 0.8),  # Minimal price movement
                    col('RSI').between(35, 65),  # Not at extremes
                    col('relative_volume_10d_calc') > 0.8,  # Some volume activity
                    col('volume') > 300000,  # Minimum volume
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    # Low volatility filtering
                    col('BB.upper') > col('BB.lower')  # Valid BB data
                )
                .order_by('Volatility.D', ascending=True)  # Lowest volatility first
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Compression/Coiling Stocks - Pre-Explosion")
            
            console.print("\n[bold yellow]💡 Compression Strategy:[/bold yellow]")
            console.print("• Pattern: Very low volatility = Energy building for big move")
            console.print("• Entry: Wait for volume spike + breakout from range")
            console.print("• Logic: Coiled spring effect - explosive moves follow compression")
            console.print("• Direction: Can break either way - follow the breakout")
            console.print("• Stop Loss: Opposite side of compression range")
            console.print("• Target: Measured move = Range height projected (1.0% quick exit)")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    # ==================== SWING TRADING STRATEGIES ====================
    
    def swing_bullish_reversal(self):
        """Find stocks showing bullish reversal patterns for swing trading"""
        console.print(Panel.fit("🔄 SWING: Bullish Reversal Patterns", style="bold blue"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'RSI', 'MACD.macd', 
                       'MACD.signal', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Above ₹100
                    col('RSI').between(30, 50),  # Recovering from oversold
                    col('MACD.macd') > col('MACD.signal'),  # MACD bullish
                    col('close') > col('EMA20'),  # Above 20 EMA
                    col('volume') > 300000,  # Decent volume
                    col('market_cap_basic') > 5e8  # Min 500 crores
                )
                .order_by('RSI', ascending=True)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Bullish Reversal Patterns")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On breakout above EMA50 with volume")
            console.print("• Stop Loss: Below EMA20 (0.5%)")
            console.print("• Target: Previous resistance levels")
            console.print("• Time Frame: Daily charts, hold 1-4 weeks")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def swing_breakout_consolidation(self):
        """Find stocks breaking out of consolidation for swing trading"""
        console.print(Panel.fit("📊 SWING: Breakout from Consolidation", style="bold green"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'price_52_week_high', 'price_52_week_low', 'RSI', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 200,  # Above ₹200
                    col('change') > 1,  # Positive momentum
                    col('relative_volume_10d_calc') > 1.3,  # Above average volume
                    col('RSI').between(45, 70),  # Healthy RSI
                    col('price_52_week_low') < col('close'),  # Above 52W low
                    col('price_52_week_high') > col('close'),  # Below 52W high
                    col('volume') > 200000
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Consolidation Breakouts")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On volume breakout above consolidation")
            console.print("• Stop Loss: Below consolidation support (0.5%)")
            console.print("• Target: Measured move (consolidation height)")
            console.print("• Time Frame: Daily/Weekly charts")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def swing_sector_rotation(self):
        """Find stocks in strong sectors for swing trading"""
        console.print(Panel.fit("🔄 SWING: Sector Rotation Play", style="bold cyan"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'price_earnings_ttm',
                       'return_on_equity', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 150,  # Above ₹150
                    col('price_earnings_ttm') < 25,  # Reasonable PE
                    col('return_on_equity') > 15,  # Good ROE
                    col('close') > col('EMA20'),  # Above 20 EMA
                    col('EMA20') > col('EMA50'),  # Uptrend
                    col('volume') > 150000,
                    col('market_cap_basic') > 1e9  # Min 1000 crores
                )
                .order_by('return_on_equity', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Sector Leaders")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On pullback to EMA20 support")
            console.print("• Stop Loss: Below EMA50 (0.5%)")
            console.print("• Target: Sector relative strength")
            console.print("• Time Frame: Weekly charts, hold 2-8 weeks")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    # ==================== LONG-TERM INVESTING STRATEGIES ====================
    
    def invest_quality_growth(self):
        """Find quality growth stocks for long-term investing"""
        console.print(Panel.fit("🌱 INVEST: Quality Growth Stocks", style="bold green"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'price_earnings_ttm', 'return_on_equity', 
                       'total_revenue_yoy_growth_ttm', 'earnings_per_share_diluted_yoy_growth_ttm',
                       'debt_to_equity', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Above ₹100
                    col('price_earnings_ttm').between(10, 30),  # Reasonable PE
                    col('return_on_equity') > 18,  # High ROE
                    col('total_revenue_yoy_growth_ttm') > 10,  # Revenue growth
                    col('earnings_per_share_diluted_yoy_growth_ttm') > 15,  # EPS growth
                    col('debt_to_equity') < 1,  # Low debt
                    col('market_cap_basic') > 5e9  # Min 5000 crores
                )
                .order_by('return_on_equity', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Quality Growth Stocks")
            
            console.print("\n[bold yellow]💡 Investment Strategy:[/bold yellow]")
            console.print("• Entry: On market corrections or pullbacks")
            console.print("• Stop Loss: Not applicable (buy more on dips, or 0.5% if needed)")
            console.print("• Target: Long-term wealth creation")
            console.print("• Time Frame: Hold 3-5 years minimum")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def invest_dividend_aristocrats(self):
        """Find dividend-paying stocks for income investing"""
        console.print(Panel.fit("💰 INVEST: Dividend Aristocrats", style="bold blue"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'dividends_yield_current', 'price_earnings_ttm',
                       'return_on_equity', 'debt_to_equity', 'current_ratio', 
                       'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 200,  # Above ₹200
                    col('dividends_yield_current') > 2,  # Min 2% dividend yield
                    col('price_earnings_ttm') < 20,  # Reasonable PE
                    col('return_on_equity') > 12,  # Decent ROE
                    col('debt_to_equity') < 0.8,  # Low debt
                    col('current_ratio') > 1.2,  # Good liquidity
                    col('market_cap_basic') > 10e9  # Min 10000 crores
                )
                .order_by('dividends_yield_current', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Dividend Aristocrats")
            
            console.print("\n[bold yellow]💡 Investment Strategy:[/bold yellow]")
            console.print("• Entry: On dividend yield above 3%")
            console.print("• Stop Loss: Only on fundamental deterioration (or 0.5% technical stop)")
            console.print("• Target: Consistent dividend income + growth")
            console.print("• Time Frame: Hold for decades")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def invest_undervalued_gems(self):
        """Find undervalued stocks with potential for long-term investing"""
        console.print(Panel.fit("💎 INVEST: Undervalued Gems", style="bold magenta"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'price_earnings_ttm', 'price_book_ratio',
                       'return_on_equity', 'price_sales_ratio', 'market_cap_basic',
                       'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('price_earnings_ttm') < 15,  # Low PE
                    col('price_book_ratio') < 2,  # Low P/B
                    col('return_on_equity') > 10,  # Decent ROE
                    col('price_sales_ratio') < 3,  # Low P/S
                    col('market_cap_basic') > 1e9  # Min 1000 crores
                )
                .order_by('price_earnings_ttm', ascending=True)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Undervalued Gems")
            
            console.print("\n[bold yellow]💡 Investment Strategy:[/bold yellow]")
            console.print("• Entry: After thorough fundamental analysis")
            console.print("• Stop Loss: On business deterioration (or 0.5% technical stop)")
            console.print("• Target: Fair value realization")
            console.print("• Time Frame: Patient holding 2-5 years")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    # ==================== RESEARCH & ANALYSIS TOOLS ====================
    
    def research_sector_leaders(self):
        """Research sector leaders and their performance"""
        console.print(Panel.fit("🔍 RESEARCH: Sector Leaders Analysis", style="bold yellow"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'market_cap_basic', 'return_on_equity',
                       'price_earnings_ttm', 'total_revenue_yoy_growth_ttm', 
                       'update_mode')
                .set_markets(self.market)
                .where(
                    col('market_cap_basic') > 20e9,  # Large cap (20000+ crores)
                    col('return_on_equity') > 15,  # High ROE
                    col('price_earnings_ttm') > 0,  # Profitable
                    col('total_revenue_yoy_growth_ttm') > 5  # Revenue growth
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(20)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Sector Leaders Analysis")
            
            console.print("\n[bold yellow]💡 Research Insights:[/bold yellow]")
            console.print("• Compare ROE across sectors")
            console.print("• Identify sector rotation opportunities")
            console.print("• Track revenue growth trends")
            console.print("• Monitor profit margin sustainability")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def research_market_sentiment(self):
        """Analyze current market sentiment and momentum"""
        console.print(Panel.fit("📊 RESEARCH: Market Sentiment Analysis", style="bold red"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'change', 'volume', 'relative_volume_10d_calc',
                       'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('market_cap_basic') > 5e9,  # Large companies
                    col('volume') > 1000000,  # High volume
                    col('relative_volume_10d_calc') > 0.5  # Some activity
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(50)
                .get_scanner_data(cookies=self.cookies)
            )
            
            if not df.empty:
                # Calculate market sentiment metrics
                total_stocks = len(df)
                gainers = len(df[df['change'] > 0])
                losers = len(df[df['change'] < 0])
                high_volume = len(df[df['relative_volume_10d_calc'] > 1.2])
                
                console.print(f"\n[bold]Market Sentiment Summary:[/bold]")
                console.print(f"• Total stocks analyzed: {total_stocks}")
                console.print(f"• Gainers: {gainers} ({gainers/total_stocks*100:.1f}%)")
                console.print(f"• Losers: {losers} ({losers/total_stocks*100:.1f}%)")
                console.print(f"• High volume activity: {high_volume} ({high_volume/total_stocks*100:.1f}%)")
                
                avg_change = df['change'].mean()
                avg_volume_ratio = df['relative_volume_10d_calc'].mean()
                
                console.print(f"• Average change: {avg_change:+.2f}%")
                console.print(f"• Average volume ratio: {avg_volume_ratio:.2f}x")
                
                if avg_change > 0.5:
                    console.print("[green]✅ Bullish market sentiment[/green]")
                elif avg_change < -0.5:
                    console.print("[red]❌ Bearish market sentiment[/red]")
                else:
                    console.print("[yellow]⚠️ Neutral market sentiment[/yellow]")
            
            self.display_table(df.head(15), "Market Sentiment Analysis")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def research_earnings_calendar(self):
        """Find stocks with upcoming earnings or recent results"""
        console.print(Panel.fit("📅 RESEARCH: Earnings Focus", style="bold cyan"))
        
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'earnings_per_share_diluted_yoy_growth_ttm', 
                       'total_revenue_yoy_growth_ttm', 'price_earnings_ttm',
                       'return_on_equity', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Above ₹100
                    col('earnings_per_share_diluted_yoy_growth_ttm') > 10,  # EPS growth
                    col('total_revenue_yoy_growth_ttm') > 5,  # Revenue growth
                    col('price_earnings_ttm') < 30,  # Reasonable PE
                    col('market_cap_basic') > 2e9  # Min 2000 crores
                )
                .order_by('earnings_per_share_diluted_yoy_growth_ttm', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
            
            self.display_table(df, "Earnings Growth Focus")
            
            console.print("\n[bold yellow]💡 Research Strategy:[/bold yellow]")
            console.print("• Track earnings announcement dates")
            console.print("• Monitor guidance and management commentary")
            console.print("• Compare actual vs expected results")
            console.print("• Identify earnings surprise opportunities")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def research_sector_performance(self):
        """Analyze sector-wise performance and trends"""
        console.print(Panel.fit("🏢 RESEARCH: Sector Performance Analysis", style="bold green"))
        
        try:
            # Get sector data
            total_rows, df = (
                Query()
                .select('name', 'close', 'change', 'volume', 'market_cap_basic', 
                       'sector', 'industry', 'return_on_equity', 'price_earnings_ttm',
                       'relative_volume_10d_calc', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('volume') > 100000,  # Minimum volume
                    col('sector') != '',  # Has sector data
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(100)
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Manual NSE filter (TradingView exchange filter doesn't work reliably)
            if not df.empty and 'ticker' in df.columns:
                df = df[df['ticker'].str.startswith('NSE:')]
                
            if not df.empty and 'sector' in df.columns:
                # Calculate sector-wise metrics
                sector_stats = df.groupby('sector').agg({
                    'change': ['mean', 'count'],
                    'market_cap_basic': 'sum',
                    'volume': 'sum',
                    'return_on_equity': 'mean',
                    'price_earnings_ttm': 'mean',
                    'relative_volume_10d_calc': 'mean'
                }).round(2)
                
                # Flatten column names
                sector_stats.columns = ['avg_change', 'stock_count', 'total_mcap', 'total_volume', 'avg_roe', 'avg_pe', 'avg_vol_ratio']
                sector_stats = sector_stats.reset_index()
                
                # Sort by average performance
                sector_stats = sector_stats.sort_values('avg_change', ascending=False)
                
                # Display sector performance table
                self._display_sector_table(sector_stats, "Sector Performance Analysis")
                
                # Show top and bottom performers
                console.print(f"\n[bold green]🏆 Top Performing Sectors:[/bold green]")
                for i, (_, row) in enumerate(sector_stats.head(3).iterrows()):
                    console.print(f"  {i+1}. {row['sector']}: {row['avg_change']:+.2f}% ({row['stock_count']} stocks)")
                
                console.print(f"\n[bold red]📉 Underperforming Sectors:[/bold red]")
                for i, (_, row) in enumerate(sector_stats.tail(3).iterrows()):
                    console.print(f"  {i+1}. {row['sector']}: {row['avg_change']:+.2f}% ({row['stock_count']} stocks)")
                
                console.print("\n[bold yellow]💡 Sector Analysis Insights:[/bold yellow]")
                console.print("• Identify sector rotation opportunities")
                console.print("• Compare relative strength across sectors")
                console.print("• Monitor sector-specific news and events")
                console.print("• Track institutional money flow patterns")
                
            else:
                console.print("[yellow]⚠️ Sector data not available or limited[/yellow]")
                self.display_table(df.head(15), "Market Analysis (No Sector Data)")
                
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    def _display_sector_table(self, sector_df, title):
        """Display sector performance in a formatted table"""
        if sector_df.empty:
            console.print(f"[red]No sector data available for {title}[/red]")
            return
            
        table = Table(title=title, show_header=True, header_style="bold magenta")
        table.add_column("Sector", style="cyan", no_wrap=True)
        table.add_column("Avg Change %", justify="right", style="magenta")
        table.add_column("Stock Count", justify="right", style="blue")
        table.add_column("Total MCap (₹Cr)", justify="right", style="green")
        table.add_column("Avg ROE %", justify="right", style="yellow")
        table.add_column("Avg PE", justify="right", style="red")
        table.add_column("Vol Ratio", justify="right", style="cyan")
        
        for _, row in sector_df.iterrows():
            change_val = row['avg_change']
            change_color = "green" if change_val > 0 else "red"
            
            # Format market cap
            mcap_formatted = f"₹{row['total_mcap']/1e7:,.0f}"
            
            # Handle NaN values
            avg_roe = row['avg_roe'] if pd.notna(row['avg_roe']) else 0
            avg_pe = row['avg_pe'] if pd.notna(row['avg_pe']) else 0
            avg_vol_ratio = row['avg_vol_ratio'] if pd.notna(row['avg_vol_ratio']) else 0
            
            table.add_row(
                row['sector'][:20],  # Truncate long sector names
                f"[{change_color}]{change_val:+.2f}%[/{change_color}]",
                f"{int(row['stock_count'])}",
                mcap_formatted,
                f"{avg_roe:.1f}%" if avg_roe > 0 else "N/A",
                f"{avg_pe:.1f}" if avg_pe > 0 else "N/A",
                f"{avg_vol_ratio:.2f}x"
            )
        
        console.print(table)
        console.print(f"[dim]Showing {len(sector_df)} sectors[/dim]")
    
    def research_sector_stocks(self, sector_name=None, limit=20):
        """Find top stocks in a specific sector"""
        if sector_name:
            title = f"🏢 SECTOR: {sector_name} Top Stocks"
        else:
            title = "🏢 SECTOR: Select Sector Stocks"
            
        console.print(Panel.fit(title, style="bold blue"))
        
        try:
            query = (
                Query()
                .select('name', 'close', 'change', 'volume', 'market_cap_basic', 
                       'sector', 'industry', 'return_on_equity', 'price_earnings_ttm',
                       'relative_volume_10d_calc', 'RSI', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 25,  # Above ₹25
                    col('market_cap_basic') > 1e8,  # Min 100 crores
                    col('volume') > 50000,  # Minimum volume
                    col('sector') != '',  # Has sector data
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
            )
            
            # Add sector filter if specified
            if sector_name:
                query = query.where(col('sector') == sector_name)
            
            total_rows, df = (
                query
                .order_by('market_cap_basic', ascending=False)
                .limit(limit)
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Manual NSE filter (TradingView exchange filter doesn't work reliably)
            if not df.empty and 'ticker' in df.columns:
                df = df[df['ticker'].str.startswith('NSE:')]
            
            if not df.empty:
                if sector_name:
                    self.display_table(df, f"{sector_name} - Top Stocks")
                else:
                    # Show available sectors
                    if 'sector' in df.columns:
                        sectors = df['sector'].unique()
                        console.print(f"[bold yellow]Available Sectors ({len(sectors)}):[/bold yellow]")
                        for i, sector in enumerate(sorted(sectors), 1):
                            console.print(f"  {i}. {sector}")
                        console.print(f"\n[bold blue]Usage:[/bold blue] Use --sector '<sector_name>' parameter")
                        console.print(f"[bold blue]Example:[/bold blue] python tv_screen_usage.py --example research_sector_stocks --sector 'Technology'")
                    else:
                        self.display_table(df.head(15), "Market Stocks (No Sector Data)")
                        
                console.print("\n[bold yellow]💡 Sector Analysis Tips:[/bold yellow]")
                console.print("• Compare stocks within the same sector")
                console.print("• Look for sector leaders vs laggards")
                console.print("• Monitor sector-specific catalysts")
                console.print("• Track relative performance trends")
            else:
                console.print(f"[red]No stocks found for sector: {sector_name}[/red]")
                
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
    # ==================== INTRADAY WATCH MODE ====================
    
    def wait_until_market_open(self):
        """Wait until 9:20 AM before starting active monitoring"""
        target_time = datetime.now().replace(hour=9, minute=20, second=0, microsecond=0)
        current_time = datetime.now()
        
        # If we're past 9:20 AM today, start immediately
        if current_time >= target_time:
            console.print("[green]✅ Market open time reached - starting active monitoring[/green]")
            return
        
        # Calculate wait time
        wait_seconds = (target_time - current_time).total_seconds()
        wait_minutes = int(wait_seconds // 60)
        wait_secs = int(wait_seconds % 60)
        
        console.print(f"[yellow]⏰ Waiting until 9:20 AM to start active monitoring...[/yellow]")
        console.print(f"[blue]Current time: {current_time.strftime('%H:%M:%S')}[/blue]")
        console.print(f"[blue]Target time: 9:20:00[/blue]")
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
                console.print("[bold yellow]⏰ WAITING FOR MARKET OPEN[/bold yellow]")
                console.print(f"[dim]Current time: {datetime.now().strftime('%H:%M:%S')}[/dim]")
                console.print(f"[blue]🕘 {mins}m {secs}s until active monitoring starts (9:20 AM)[/blue]")
                console.print("[dim]Press Ctrl+C to stop[/dim]")
            
            time.sleep(1)
        
        # Clear screen and show start message
        os.system('clear' if os.name == 'posix' else 'cls')
        console.print("[green]🚀 9:20 AM reached - starting active monitoring mode![/green]")
        time.sleep(2)

    def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, price_threshold=3.0, mode='PREBREAKOUT'):
        """Watch mode for intraday trading - continuously monitors volume and price changes"""
        mode_titles = {
            'PREBREAKOUT': ("📊 PRE-BREAKOUT MODE - Early Entry Signals", "bold blue"),
            'FOMO': ("🔥 FOMO MODE - High Volume Breakouts", "bold red"), 
            'SMART_FOMO': ("🧠 SMART FOMO MODE - Historical Analysis + FOMO", "bold yellow"),
            'ACCUMULATION': ("📈 ACCUMULATION MODE - Smart Money Tracking", "bold green"),
            'MOMENTUM': ("⚡ MOMENTUM MODE - Early Momentum Detection", "bold cyan"),
            'OPTIMIZED_GAP': ("🚀 OPTIMIZED GAP MODE - 15-Min Gap Strategy (68.4% Win Rate)", "bold green"),
            'GAP_FILL_SR': ("🎯 GAP-FILL S/R MODE - Live Gap Analysis with Support/Resistance", "bold magenta")
        }
        title, style = mode_titles.get(mode, ("📊 WATCH MODE", "bold blue"))
        console.print(Panel.fit(title, style=style))
        
        # Store mode for use in data fetching
        self.watch_mode = mode
        
        # Update journal file with correct mode
        if hasattr(self, 'journal_file'):
            self.setup_trade_journal()
        
        console.print(f"[yellow]⚙️  Configuration:[/yellow]")
        console.print(f"• Mode: {mode}")
        console.print(f"• Refresh interval: {refresh_interval} seconds")
        console.print(f"• Volume threshold: {volume_threshold}x normal volume")
        console.print(f"• Price change threshold: {price_threshold}%")
        console.print(f"• Paper trading: {'🟢 ENABLED (₹20,000 per trade)' if self.paper_trading_enabled else '🔴 DISABLED'}")
        if self.paper_trading_enabled:
            console.print(f"• Live risk management: 🟢 ENABLED (0.5% SL | 1% TP | 1.0% TSL | 2sec checks)")
        console.print(f"• Trade journal: 📝 {self.journal_file}")
        console.print(f"• Trend analysis: 🎯 ENABLED (15-day lookback | SELL in bearish trends)")
        console.print(f"• Logging: 🔇 Minimal (reduced console spam)")
        console.print(f"• Press Ctrl+C to stop monitoring")
        console.print()
        
        # Special handling for GAP_FILL_SR mode - redirect to live gap-fill monitor
        if mode == 'GAP_FILL_SR':
            console.print(f"[yellow]🔄 Redirecting to live gap-fill monitor...[/yellow]")
            time.sleep(1)
            return self.live_gap_fill_monitor_with_sr()
        
        # Wait until 9:20 AM before starting active monitoring
        self.wait_until_market_open()
        
        # Store previous data for comparison
        previous_data = pd.DataFrame()
        alert_count = 0
        
        # Start background monitoring for live risk management
        self._start_time = datetime.now()
        self.start_background_monitoring()
        
        try:
            while True:
                start_time = time.time()
                
                # Clear screen for fresh update
                os.system('clear' if os.name == 'posix' else 'cls')
                
                # Header with current time
                current_time = datetime.now().strftime("%H:%M:%S")
                console.print(f"[bold blue]📊 INTRADAY WATCH MODE - {current_time}[/bold blue]")
                console.print(f"[dim]Refresh: {refresh_interval}s | Vol: {volume_threshold}x | Price: {price_threshold}%[/dim]")
                console.print()
                
                # Check if market is closed - exit all positions at 3:00 PM
                if self._is_market_closed():
                    self._exit_all_positions("MARKET_CLOSED")
                    console.print("[bold red]📴 Market closed - All positions exited. Script will continue monitoring.[/bold red]")
                    time.sleep(refresh_interval)
                    continue
                
                # Get current market data
                current_data = self._get_watch_data()
                
                if not current_data.empty:
                    # Detect alerts
                    alerts = self._detect_alerts(current_data, previous_data, volume_threshold, price_threshold)
                    
                    if alerts:
                        alert_count += len(alerts)
                        console.print(f"[bold red]🚨 ALERTS ({len(alerts)} new, {alert_count} total)[/bold red]")
                        self._display_alerts(alerts)
                        console.print()
                    
                    # Display current top movers
                    self._display_watch_data(current_data, alerts)
                    
                    # Store current data for next comparison
                    previous_data = current_data.copy()
                else:
                    console.print("[red]❌ No data received - checking connection...[/red]")
                
                # Wait for next refresh
                elapsed = time.time() - start_time
                sleep_time = max(0, refresh_interval - elapsed)
                
                if sleep_time > 0:
                    console.print(f"[dim]Next refresh in {sleep_time:.1f}s... (Ctrl+C to stop)[/dim]")
                    time.sleep(sleep_time)
                    
        except KeyboardInterrupt:
            console.print("\n[yellow]👋 Watch mode stopped by user[/yellow]")
            console.print(f"[green]Total alerts generated: {alert_count}[/green]")
            
            # Show execution time
            end_time = datetime.now()
            if hasattr(self, '_start_time'):
                duration = end_time - self._start_time
                hours, remainder = divmod(duration.total_seconds(), 3600)
                minutes, seconds = divmod(remainder, 60)
                console.print(f"[blue]Execution time: {int(hours)}h:{int(minutes):02d}m:{int(seconds):02d}s[/blue]")
        finally:
            # Stop background monitoring when exiting
            self.stop_background_monitoring()
    
    def _get_watch_data(self):
        """Get current market data for watch mode based on selected mode"""
        mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
        
        try:
            if mode == 'FOMO':
                # Original FOMO high volume breakouts
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        col('close') > 50,  # Above ₹50
                        col('volume') > 500000,  # High volume
                        col('relative_volume_10d_calc') > 1.5,  # Elevated volume
                        col('market_cap_basic') > 1e9,  # Min 1000 crores
                        col('exchange') == 'NSE'  # NSE only
                    )
                    .order_by('relative_volume_10d_calc', ascending=False)
                    .limit(25)
                    .get_scanner_data(cookies=self.cookies)
                )
            
            elif mode == 'ACCUMULATION':
                # Accumulation patterns
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'EMA20', 'market_cap_basic', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        col('close') > 50,  # Above ₹50
                        col('volume') > 200000,  # Decent volume
                        col('relative_volume_10d_calc').between(0.8, 1.8),  # Normal volume
                        col('RSI').between(40, 65),  # Building strength
                        col('close') > col('EMA20'),  # Above trend
                        col('market_cap_basic') > 5e8,  # Min 500 crores
                        col('exchange') == 'NSE'  # NSE only
                    )
                    .order_by('RSI', ascending=False)
                    .limit(25)
                    .get_scanner_data(cookies=self.cookies)
                )
            
            elif mode == 'SMART_FOMO':
                # Enhanced Smart FOMO: Avoid buying at tops using multiple filters
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'Volatility.D', 'market_cap_basic', 'price_52_week_high',
                           'Perf.W', 'Perf.3M', 'EMA20', 'EMA50', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        col('close') > 50,  # Above ₹50
                        col('volume') > 500000,  # High volume
                        col('relative_volume_10d_calc') > 1.5,  # Elevated volume (FOMO signal)
                        col('change').between(1, 8),  # Positive momentum but NOT extreme (CRITICAL)
                        col('RSI').between(40, 75),  # Avoid extreme overbought (was 85)
                        col('market_cap_basic') > 1e9,  # Min 1000 crores
                        col('exchange') == 'NSE',  # NSE only
                        # NEW: Avoid stocks too close to 52-week highs
                        col('close') < col('price_52_week_high') * 0.95,  # At least 5% below 52W high
                        # NEW: Avoid overextended weekly/monthly moves
                        col('Perf.W') < 15,  # Weekly gain < 15%
                        col('Perf.3M') < 50,  # 3-month gain < 50%
                        # NEW: Ensure stock is above key moving averages (trend confirmation)
                        col('close') > col('EMA20'),  # Above 20 EMA
                        col('EMA20') > col('EMA50')   # 20 EMA above 50 EMA (uptrend)
                    )
                    .order_by('relative_volume_10d_calc', ascending=False)
                    .limit(30)  # Get more to filter
                    .get_scanner_data(cookies=self.cookies)
                )
                
                # Filter by historical upside potential
                if not df.empty:
                    smart_fomo_stocks = []
                    for _, row in df.iterrows():
                        if self._check_historical_upside(row.get('ticker', ''), row.get('close', 0)):
                            smart_fomo_stocks.append(row)
                    
                    if smart_fomo_stocks:
                        df = pd.DataFrame(smart_fomo_stocks).head(25)  # Limit to 25
                    else:
                        df = pd.DataFrame()  # No stocks passed historical filter
            
            elif mode == 'MOMENTUM':
                # Early momentum detection
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        col('close') > 30,  # Lower threshold
                        col('volume') > 100000,  # Minimum liquidity
                        col('relative_volume_10d_calc').between(1.1, 2.5),  # Slightly elevated
                        col('change').between(0.5, 4),  # Small positive moves
                        col('RSI') > col('RSI[1]'),  # RSI improving
                        col('RSI').between(35, 70),  # Sweet spot
                        col('MACD.macd') > col('MACD.signal'),  # MACD bullish
                        col('market_cap_basic') > 2e8,  # Min 200 crores
                        col('exchange') == 'NSE'  # NSE only
                    )
                    .order_by('change', ascending=False)
                    .limit(25)
                    .get_scanner_data(cookies=self.cookies)
                )
            
            elif mode == 'OPTIMIZED_GAP':
                # Optimized gap strategy - 15-minute proven strategy
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'market_cap_basic', 'Volatility.D', 'price_52_week_high', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        # Quality gap criteria (proven in backtesting)
                        col('close') > 50,  # Minimum price for liquidity
                        col('change') > 1,  # At least 1% gap for momentum
                        col('change') < 15,  # Avoid extreme gaps (retracement risk)
                        
                        # Volume confirmation (critical for 15-min success)
                        col('volume') > 500000,  # Minimum liquidity
                        col('relative_volume_10d_calc') > 2.0,  # 2x+ volume (institutional interest)
                        
                        # Risk management filters
                        col('RSI') < 85,  # Not extremely overbought
                        col('RSI') > 25,  # Not in freefall
                        col('exchange') == 'NSE',  # NSE only for better liquidity
                        
                        # Quality and size filters
                        col('market_cap_basic') > 2e8,  # Min 200 crores (avoid penny stocks)
                        col('Volatility.D') < 0.08,  # Reasonable volatility (<8%)
                        col('price_52_week_high') > col('close')  # Room for upside
                    )
                    .order_by('relative_volume_10d_calc', ascending=False)  # Highest volume first
                    .limit(20)  # Focus on top 20 opportunities
                    .get_scanner_data(cookies=self.cookies)
                )
            
            else:  # PREBREAKOUT (default)
                # Pre-breakout focus
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'RSI[1]', 'EMA20', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        col('close') > 30,  # Lower threshold for early detection
                        col('volume') > 100000,  # Minimum liquidity
                        col('market_cap_basic') > 2e8,  # Min 200 crores
                        col('relative_volume_10d_calc').between(0.8, 3.0),  # Normal to moderately elevated
                        col('RSI').between(35, 75),  # Building momentum zone
                        col('change').between(-3, 6),  # Not extreme moves
                        col('exchange') == 'NSE'  # NSE only, ignore BSE
                    )
                    .order_by('RSI', ascending=False)  # Momentum building
                    .limit(25)
                    .get_scanner_data(cookies=self.cookies)
                )
            
            # Add calculated fields if needed
            if 'Volatility.D' in df.columns:
                df['volatility_pct'] = df['Volatility.D'] * 100
            df['market_cap_cr'] = df['market_cap_basic'] / 1e7
            
            # Add quality scoring for optimized gap mode
            if mode == 'OPTIMIZED_GAP' and not df.empty:
                df['quality_score'] = self._calculate_quality_score(df)
            
            # Add trend analysis for each stock (simplified based on current market data)
            if not df.empty:
                trend_data = []
                for _, row in df.iterrows():
                    # Simple trend analysis based on current data points
                    change = row.get('change', 0)
                    rsi = row.get('RSI', 50)
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    
                    # Determine trend based on available indicators
                    trend_score = 0
                    
                    # Price change contribution (40% weight)
                    if change > 5:
                        trend_score += 40
                    elif change > 2:
                        trend_score += 20
                    elif change > 0:
                        trend_score += 10
                    elif change < -5:
                        trend_score -= 40
                    elif change < -2:
                        trend_score -= 20
                    elif change < 0:
                        trend_score -= 10
                    
                    # RSI contribution (35% weight)
                    if rsi > 65:
                        trend_score += 35
                    elif rsi > 55:
                        trend_score += 20
                    elif rsi > 45:
                        trend_score += 5
                    elif rsi < 35:
                        trend_score -= 35
                    elif rsi < 45:
                        trend_score -= 20
                    
                    # Volume confirmation (25% weight)
                    if vol_ratio > 2:
                        trend_score += 25
                    elif vol_ratio > 1.5:
                        trend_score += 15
                    elif vol_ratio > 1:
                        trend_score += 5
                    elif vol_ratio < 0.5:
                        trend_score -= 15
                    
                    # Categorize trend
                    if trend_score >= 60:
                        trend = 'strong_bullish'
                    elif trend_score >= 30:
                        trend = 'bullish'
                    elif trend_score >= -30:
                        trend = 'neutral'
                    elif trend_score >= -60:
                        trend = 'bearish'
                    else:
                        trend = 'strong_bearish'
                    
                    trend_data.append(trend)
                df['trend'] = trend_data
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error fetching watch data: {e}[/red]")
            return pd.DataFrame()
    
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
                    
                    # Only send if confidence is high enough
                    if confidence >= 0.8:  # 80% minimum confidence
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
                    
                    # Only send if confidence is high enough
                    if confidence >= 0.8:  # 80% minimum confidence
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
            
            # Enhanced Smart FOMO alert - available in all modes with top-avoidance filters
            watch_mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
            if (row['relative_volume_10d_calc'] > volume_threshold and
                row['change'] > 1 and  # Positive momentum
                self._check_historical_upside(ticker, row['close']) and  # Historical validation
                self._check_not_buying_at_top(ticker, row)):  # NEW: Avoid buying at tops
                
                # Check cooldown
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'SMART_FOMO')
                if should_skip:
                    if "STOP_LOSS_COOLDOWN" in skip_reason:
                        console.print(f"[dim red]⏳ Skipping {ticker} SMART_FOMO - {skip_reason}[/dim red]")
                    else:
                        console.print(f"[dim]⏳ Skipping {ticker} SMART_FOMO (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                    continue
                
                # Calculate confidence (Smart FOMO gets bonus for historical validation)
                confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                
                # Only send if confidence is high enough
                if confidence >= 0.5:  # 50% minimum confidence
                    alert = {
                        'type': 'SMART_FOMO',
                        'ticker': ticker,
                        'name': row['name'],
                        'volume_ratio': row['relative_volume_10d_calc'],
                        'price': row['close'],
                        'change': row['change'],
                        'upside_potential': 'Validated',
                        'confidence': confidence
                    }
                    alerts.append(alert)
                    
                    # Record alert time to prevent spam
                    self.last_alert_time[f"{ticker}_SMART_FOMO"] = datetime.now()
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
                        if confidence >= 0.5:
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
                        if confidence >= 0.5:
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
                        if confidence >= 0.5:
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
                        if confidence >= 0.5:
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
    
    def _calculate_alert_confidence(self, alert_type, volume_ratio, change_pct, rsi=None):
        """Calculate confidence score for alert with momentum confirmation"""
        confidence = 0.3  # Base confidence
        
        # RSI-based momentum confirmation - avoid buying at peaks
        if rsi is not None:
            if rsi > 80:  # Overbought - very risky entry
                confidence -= 0.25
            elif rsi > 75:  # Getting overbought
                confidence -= 0.15
            elif rsi > 70:  # Slightly overbought
                confidence -= 0.05
            elif 50 <= rsi <= 65:  # Sweet spot for momentum
                confidence += 0.1
            elif rsi < 30:  # Oversold - potential reversal but risky for FOMO
                confidence -= 0.1
        
        # Volume factor (higher volume = higher confidence)
        if volume_ratio > 4.0:
            confidence += 0.3
        elif volume_ratio > 3.0:
            confidence += 0.2
        elif volume_ratio > 2.0:
            confidence += 0.15
        elif volume_ratio > 1.5:
            confidence += 0.1
        
        # Price change factor
        if alert_type == 'VOLUME_SPIKE':
            if abs(change_pct) > 5:
                confidence += 0.25
            elif abs(change_pct) > 3:
                confidence += 0.2
            elif abs(change_pct) > 1.5:
                confidence += 0.1
        elif alert_type == 'PRICE_MOVE':
            if abs(change_pct) > 4:
                confidence += 0.25
            elif abs(change_pct) > 2.5:
                confidence += 0.15
        elif alert_type == 'SMART_FOMO':
            if change_pct > 3:
                confidence += 0.2
            elif change_pct > 1.5:
                confidence += 0.1
            # Historical validation bonus
            confidence += 0.15
        elif alert_type == 'EARLY_MOMENTUM':
            if change_pct > 2.5:
                confidence += 0.2
            elif change_pct > 1.5:
                confidence += 0.15
            # Early entry bonus
            confidence += 0.1
        elif alert_type == 'ACCUMULATION':
            # Controlled movement is preferred for accumulation
            if 0.5 < abs(change_pct) < 2:
                confidence += 0.2
            elif abs(change_pct) < 3:
                confidence += 0.1
            # Volume-based accumulation bonus
            confidence += 0.1
        elif alert_type == 'PREBREAKOUT':
            # Pre-breakout signals
            if change_pct > 2:
                confidence += 0.2
            elif change_pct > 1:
                confidence += 0.15
            # High RSI pre-breakout bonus
            confidence += 0.1
        elif alert_type == 'GAP_BREAKOUT':
            # Gap quality matters
            if 2 <= change_pct <= 8:
                confidence += 0.25  # Sweet spot for gaps
            elif 1 <= change_pct <= 15:
                confidence += 0.15
            # Volume confirmation bonus
            confidence += 0.1
        
        return min(confidence, 0.95)  # Cap at 95%
    
    def send_telegram_alert(self, alert):
        """Send a Telegram alert for a new event"""
        if not self.telegram_enabled:
            return

        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']
            
            message = f"🔥 *TradingView Alert: {alert['type'].replace('_', ' ').title()}* 🔥\n\n"
            message += f"📈 *Symbol:* {alert['ticker']} ({alert.get('name', alert['ticker'])})\n"
            message += f"💰 *Price:* ₹{alert['price']:.2f}\n"

            if alert['type'] == 'VOLUME_SPIKE':
                message += f"📊 *Volume Ratio:* {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)\n"
                message += f"📈 *Change:* {alert['change']:+.2f}%\n"
            elif alert['type'] == 'PRICE_MOVE':
                message += f"📈 *Change:* {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)\n"
                message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x\n"
            elif alert['type'] == 'SMART_FOMO':
                message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x (FOMO signal)\n"
                message += f"📈 *Change:* {alert['change']:+.2f}%\n"
                message += f"🧠 *Historical Check:* ✅ Upside potential validated\n"
                message += f"🎯 *Strategy:* Smart FOMO (avoid late entries)\n"
            elif alert['type'] == 'TRADE_ENTRY':
                side_emoji = "🟢" if alert['side'] == 'BUY' else "🔴"
                message = f"🎯 *TRADE EXECUTED* 🎯\n\n"
                message += f"{side_emoji} *{alert['side']}* {alert['quantity']} shares of *{alert['ticker']}*\n"
                message += f"💰 *Entry Price:* ₹{alert['price']:.2f}\n"
                message += f"💵 *Amount:* ₹{alert['amount']:,.0f}\n"
                message += f"📊 *Signal:* {alert['alert_type'].replace('_', ' ').title()}\n"
                message += f"🎯 *Confidence:* {alert['confidence']:.0%}\n"
                if alert.get('trend') and alert['trend'] != 'neutral':
                    message += f"📈 *Trend:* {alert['trend'].replace('_', ' ').title()}\n"
            elif alert['type'] == 'TRADE_EXIT':
                side_emoji = "🔴" if alert['side'] == 'SELL' else "🟢"
                pnl_emoji = "💚" if alert['pnl_pct'] > 0 else "❌" if alert['pnl_pct'] < 0 else "⚪"
                message = f"🔥 *TRADE CLOSED* 🔥\n\n"
                message += f"{side_emoji} *{alert['side']}* {alert['quantity']} shares of *{alert['ticker']}*\n"
                message += f"📈 *Entry:* ₹{alert['entry_price']:.2f}\n"
                message += f"📉 *Exit:* ₹{alert['exit_price']:.2f}\n"
                message += f"💵 *Amount:* ₹{alert['amount']:,.0f}\n"
                message += f"{pnl_emoji} *P&L:* {alert['pnl_pct']:+.2f}% (₹{alert['pnl_amount']:+,.0f})\n"
                message += f"⏱️ *Hold Time:* {alert['hold_time_minutes']}m\n"
                message += f"📋 *Reason:* {alert['reason']}\n"
            
            # Add confidence score (only for non-trade alerts, as trade alerts already include it)
            if alert['type'] not in ['TRADE_ENTRY', 'TRADE_EXIT']:
                confidence = alert.get('confidence', 0.5)
                message += f"🎯 *Confidence:* {confidence:.0%}\n"
            
            # Add trading action if paper trading is enabled (only for non-executed trades)
            if self.paper_trading_enabled and alert['type'] not in ['TRADE_ENTRY', 'TRADE_EXIT']:
                trading_action = self._get_trading_action(alert)
                message += f"\n💰 *Trading Action:* {trading_action}\n"
                message += f"💵 *Position Size:* ₹20,000"

            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'Markdown'
            }
            
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                console.print(f"[green]✅ Telegram alert sent for {alert['ticker']}[/green]")
            else:
                console.print(f"[red]⚠️ Telegram alert failed for {alert['ticker']}: {response.text}[/red]")

        except Exception as e:
            console.print(f"[red]❌ Error sending Telegram alert: {str(e)}[/red]")

    def _display_alerts(self, alerts):
        """Display alerts in a formatted way and send to both Telegram and Paper Trading Bot"""
        for alert in alerts:
            # Process alert for paper trading (telegram alerts sent only on actual trades)
            self._process_paper_trading_alert(alert)
            
            # Display alert
            if alert['type'] == 'VOLUME_SPIKE':
                console.print(f"[bold red]🔥 VOLUME SPIKE:[/bold red] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Volume: {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)")
                console.print(f"   Price: ₹{alert['price']:.2f} ({alert['change']:+.2f}%)")
                
            elif alert['type'] == 'PRICE_MOVE':
                direction = "🚀" if alert['current_change'] > 0 else "📉"
                console.print(f"[bold yellow]{direction} PRICE MOVE:[/bold yellow] {alert['ticker']} ({alert['name'][:15]})")
                console.print(f"   Change: {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)")
                console.print(f"   Price: ₹{alert['price']:.2f} | Volume: {alert['volume_ratio']:.1f}x")
            
            # Show trading action taken
            if self.paper_trading_enabled:
                trade_action = self._get_trading_action(alert)
                console.print(f"   [cyan]💰 Trading Action: {trade_action}[/cyan]")
    
    def _get_base_symbol(self, ticker):
        """Extract base symbol from exchange:symbol format"""
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
                    action='BUY',
                    symbol=symbol,
                    price=price,
                    qty=trade_data['quantity'],
                    amount=price * trade_data['quantity'],
                    alert_type='OPTIMIZED_GAP_15MIN'
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
            
            # Only trade if confidence is sufficient (80%+)
            if confidence < 0.8:
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
                if alert['type'] in ['VOLUME_SPIKE', 'PRICE_MOVE', 'SMART_FOMO']:
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
                    # Enhanced Smart FOMO - BUY safe breakouts, SELL overextended stocks
                    change_pct = alert.get('change', 0)
                    
                    if change_pct > 1 and trend in ['strong_bullish', 'bullish', 'neutral']:
                        # Check if stock is overextended (potential SHORT candidate)
                        if self._is_overextended_for_short(symbol):
                            trade_side = 'SELL'  # Short overextended stocks
                            console.print(f"   [red]📉 {symbol} overextended - considering SHORT[/red]")
                        else:
                            trade_side = 'BUY'  # Normal long entry
            
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
            # Check trading hours - prevent new trades outside market hours
            if not self._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours ({self.trading_start_time}-{self.trading_end_time})[/yellow]")
                return False
            
            # Validate price against live Upstox price
            live_price = self._get_live_price_from_upstox(symbol)
            if live_price:
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
            self.log_trade("ENTRY", symbol, price, quantity, amount, f"{alert['type']}|trend:{trend}")
            
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
                'confidence': confidence
            }
            
            self.trade_count += 1
            self.current_prices[symbol] = round(price, 2)
            
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
        alert_tickers = [alert['ticker'] for alert in alerts]
        
        # Dynamic title based on mode
        mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
        mode_titles = {
            'PREBREAKOUT': "Live Market Monitor - Pre-Breakout Signals",
            'FOMO': "Live Market Monitor - Top Volume Movers", 
            'SMART_FOMO': "Live Market Monitor - Smart FOMO (Historical Analysis)",
            'ACCUMULATION': "Live Market Monitor - Accumulation Patterns",
            'MOMENTUM': "Live Market Monitor - Early Momentum"
        }
        title = mode_titles.get(mode, "Live Market Monitor")
        table = Table(title=title, show_header=True)
        table.add_column("Ticker", style="cyan", no_wrap=True)
        table.add_column("Name", style="green", max_width=12)
        table.add_column("Price", justify="right", style="yellow")
        table.add_column("Change %", justify="right", style="magenta")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("Vol Ratio", justify="right", style="red")
        table.add_column("RSI", justify="right", style="cyan")
        table.add_column("Trend", style="bold", justify="center")
        table.add_column("Alert", style="bold red")
        
        for _, row in df.head(15).iterrows():
            ticker = row['ticker']
            is_alert = ticker in alert_tickers
            
            # Color coding for alerts
            ticker_style = "[bold red]" if is_alert else ""
            alert_symbol = "🚨" if is_alert else ""
            
            change_val = row['change']
            change_color = "green" if change_val > 0 else "red"
            
            rsi_val = row['RSI']
            rsi_color = "red" if rsi_val > 70 else "green" if rsi_val < 30 else "white"
            
            vol_ratio = row['relative_volume_10d_calc']
            vol_color = "bold red" if vol_ratio > 3 else "red" if vol_ratio > 2 else "white"
            
            # Get trend if available
            trend_display = ""
            if 'trend' in row and row['trend']:
                trend_val = row['trend']
                if trend_val == 'strong_bullish':
                    trend_display = "[bold green]🚀[/bold green]"
                elif trend_val == 'bullish':
                    trend_display = "[green]📈[/green]"
                elif trend_val == 'neutral':
                    trend_display = "[yellow]➡️[/yellow]"
                elif trend_val == 'bearish':
                    trend_display = "[red]📉[/red]"
                elif trend_val == 'strong_bearish':
                    trend_display = "[bold red]💥[/bold red]"
                else:
                    trend_display = f"[dim]{trend_val}[/dim]"
            else:
                trend_display = "[dim]—[/dim]"
            
            table.add_row(
                f"{ticker_style}{ticker}",
                row['name'][:12],
                f"₹{row['close']:,.2f}",
                f"[{change_color}]{change_val:+.2f}%[/{change_color}]",
                f"{row['volume']:,.0f}",
                f"[{vol_color}]{vol_ratio:.1f}x[/{vol_color}]",
                f"[{rsi_color}]{rsi_val:.1f}[/{rsi_color}]",
                trend_display,
                alert_symbol
            )
        
        console.print(table)
        
        # Display live trades if paper trading is enabled
        if self.paper_trading_enabled and self.live_trades:
            self._display_live_trades()
        
        # Display active positions if paper trading is enabled
        if self.paper_trading_enabled:
            self._display_active_positions()
            
        # Display closed trades if paper trading is enabled
        if self.paper_trading_enabled and self.closed_trades:
            self._display_closed_trades()
    
    def _display_live_trades(self):
        """Display recent live trades"""
        console.print()
        trades_table = Table(title="🔴 LIVE TRADES (Last 10)", show_header=True)
        trades_table.add_column("Time", style="cyan", no_wrap=True)
        trades_table.add_column("Symbol", style="bold", no_wrap=True)
        trades_table.add_column("Side", style="white")
        trades_table.add_column("Price", justify="right", style="yellow")
        trades_table.add_column("Qty", justify="right", style="blue")
        trades_table.add_column("Amount", justify="right", style="green")
        trades_table.add_column("Alert Type", style="magenta")
        trades_table.add_column("Confidence", justify="right", style="cyan")
        
        for trade in reversed(self.live_trades[-10:]):  # Show most recent first
            time_str = trade['timestamp'].strftime("%H:%M:%S")
            side_style = "green" if trade['side'] == 'BUY' else "red"
            side_emoji = "🟢" if trade['side'] == 'BUY' else "🔴"
            
            trades_table.add_row(
                time_str,
                trade['symbol'],
                f"[{side_style}]{side_emoji} {trade['side']}[/{side_style}]",
                f"₹{trade['price']:,.0f}",
                str(trade['quantity']),
                f"₹{trade['amount']:,.0f}",
                trade['alert_type'],
                f"{trade['confidence']:.0%}"
            )
        
        console.print(trades_table)
    
    def _display_closed_trades(self):
        """Display closed trades with P&L information in a table format"""
        if not self.closed_trades:
            return
        
        console.print()
        closed_table = Table(title="📈 CLOSED TRADES P&L", show_header=True)
        closed_table.add_column("Symbol", style="bold", no_wrap=True)
        closed_table.add_column("Side", style="white")
        closed_table.add_column("Entry ₹", justify="right", style="cyan")
        closed_table.add_column("Exit ₹", justify="right", style="white")
        closed_table.add_column("Qty", justify="right", style="blue")
        closed_table.add_column("P&L %", justify="right", style="bold")
        closed_table.add_column("P&L ₹", justify="right", style="bold")
        closed_table.add_column("Hold Time", justify="right", style="dim")
        closed_table.add_column("Reason", style="yellow")
        
        total_pnl_amount = 0
        profitable_trades = 0
        
        # Show last 10 closed trades
        recent_trades = self.closed_trades[-10:] if len(self.closed_trades) > 10 else self.closed_trades
        
        for trade in recent_trades:
            # Color coding
            pnl_style = "green" if trade['pnl_pct'] > 0 else "red"
            side_style = "green" if trade['side'] == 'BUY' else "red"
            side_emoji = "🟢" if trade['side'] == 'BUY' else "🔴"
            
            # Format hold time
            hold_time = trade['exit_time'] - trade['entry_time']
            if hold_time.total_seconds() < 3600:  # Less than 1 hour
                hold_display = f"{int(hold_time.total_seconds() / 60)}m"
            elif hold_time.total_seconds() < 86400:  # Less than 1 day
                hold_display = f"{int(hold_time.total_seconds() / 3600)}h"
            else:
                hold_display = f"{hold_time.days}d"
            
            total_pnl_amount += trade['pnl_amount']
            if trade['pnl_pct'] > 0:
                profitable_trades += 1
            
            closed_table.add_row(
                trade['symbol'],
                f"[{side_style}]{side_emoji} {trade['side']}[/{side_style}]",
                f"₹{trade['entry_price']:,.2f}",
                f"₹{trade['exit_price']:,.2f}",
                str(trade['quantity']),
                f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
                hold_display,
                trade['exit_reason'][:15]
            )
        
        console.print(closed_table)
        
        # Display summary stats
        total_trades = len(self.closed_trades)
        win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0
        total_pnl_style = "green" if total_pnl_amount > 0 else "red"
        
        console.print(f"[dim]Total Trades: {total_trades} | Win Rate: {win_rate:.1f}% | "
                     f"Total P&L: [{total_pnl_style}]₹{total_pnl_amount:+,.0f}[/{total_pnl_style}][/dim]")
    
    def _get_live_price_from_upstox(self, symbol, force_refresh=False):
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
            
            # Extract exchange and symbol
            if ':' in symbol:
                exchange, clean_symbol = symbol.split(':', 1)
            else:
                exchange = 'NSE'
                clean_symbol = symbol
            
            # First attempt: Try original exchange
            price = self._fetch_price_from_exchange(clean_symbol, exchange)
            
            # Fallback: If NSE fails, try BSE (and vice versa)
            if price is None:
                fallback_exchange = 'BSE' if exchange == 'NSE' else 'NSE'
                price = self._fetch_price_from_exchange(clean_symbol, fallback_exchange)
                
                if price is not None:
                    console.print(f"[green]✅ Found {clean_symbol} on {fallback_exchange} (fallback from {exchange})[/green]")
                    # Track fallback usage
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
            # Map exchange to Upstox format
            exchange_map = {
                'NSE': 'NSE_EQ',
                'BSE': 'BSE_EQ'
            }
            
            upstox_exchange = exchange_map.get(exchange, 'NSE_EQ')
            
            # Get latest intraday data (1-minute) to get current price
            df = self.upstox_api.fetch_intraday_data_v3(
                symbol=symbol, 
                unit='minutes', 
                interval=1,
                exchange=upstox_exchange
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
            
            # Risk Management Rules
            stop_loss_pct = -0.5  # 0.5% initial stop loss
            take_profit_pct = 1.0  # 1% take profit threshold for intraday
            quick_exit_pct = 1.0  # 1.0% quick exit threshold
            
            # Progressive trailing stop buffer (tightens with higher profits)
            trailing_stop_buffer = self._get_progressive_trailing_buffer(abs(pnl_pct))
            
            # Update highest profit and price tracking
            if pnl_pct > position['highest_profit_pct']:
                position['highest_profit_pct'] = pnl_pct
                position['highest_price'] = live_price
            
            # Check for exit conditions
            should_exit = False
            exit_reason = ""
            
            # 1. Regular stop loss (if not in trailing mode)
            if not position['trailing_stop_active'] and pnl_pct <= stop_loss_pct:
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
            self.log_trade("EXIT", symbol, exit_price, position['qty'], amount, reason, pnl_pct, pnl_amount)
            
            # Add to stop loss cooldown if this was a stop loss exit
            if "STOP LOSS" in reason:
                self.stop_loss_cooldown[symbol] = datetime.now()
                console.print(f"[dim red]🚫 Added {symbol} to 30-minute stop loss cooldown[/dim red]")
            
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
        """Save results to CSV file"""
        if not df.empty:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{filename}_{timestamp}.csv"
            df.to_csv(filename, index=False)
            console.print(f"[green]Results saved to: {filename}[/green]")
    
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
                "intraday_compression - Compression/coiling stocks (pre-explosion)"
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

def main():
    parser = argparse.ArgumentParser(description='TradingView Screener Usage Examples')
    parser.add_argument('--example', type=str, help='Run specific example')
    parser.add_argument('--list-examples', action='store_true', help='List all available examples')
    parser.add_argument('--run-all', action='store_true', help='Run all examples')
    parser.add_argument('--market', type=str, default='in', choices=['us', 'in'], help='Market to screen (us/in, default: in)')
    parser.add_argument('--sector', type=str, help='Sector name for sector-specific analysis')
    
    # Watch mode specific arguments
    parser.add_argument('--watch', action='store_true', help='Start intraday watch mode')
    parser.add_argument('--mode', type=str, default='PREBREAKOUT', 
                       choices=['PREBREAKOUT', 'FOMO', 'SMART_FOMO', 'ACCUMULATION', 'MOMENTUM', 'OPTIMIZED_GAP', 'GAP_FILL_SR'],
                       help='Watch mode strategy (default: PREBREAKOUT)')
    parser.add_argument('--refresh', type=int, default=30, help='Refresh interval in seconds (default: 30)')
    parser.add_argument('--volume-threshold', type=float, default=2.0, help='Volume threshold for alerts (default: 2.0x)')
    parser.add_argument('--price-threshold', type=float, default=3.0, help='Price change threshold for alerts (default: 3.0 percent)')
    
    # Paper Trading Bot integration
    parser.add_argument('--enable-trading', action='store_true', help='Enable paper trading bot integration (₹20,000 per trade)')
    
    args = parser.parse_args()
    
    screener = TVScreenerUsage(market=args.market, enable_paper_trading=args.enable_trading)
    
    if args.list_examples:
        screener.show_available_examples()
    elif args.watch:
        screener.intraday_watch_mode(
            refresh_interval=args.refresh,
            volume_threshold=args.volume_threshold,
            price_threshold=args.price_threshold,
            mode=args.mode
        )
    elif args.example:
        if args.example == 'intraday_watch':
            screener.run_example(args.example, 
                               refresh_interval=args.refresh,
                               volume_threshold=args.volume_threshold,
                               price_threshold=args.price_threshold)
        elif args.example == 'research_sector_stocks':
            screener.run_example(args.example, sector_name=args.sector)
        else:
            screener.run_example(args.example)
    elif args.run_all:
        screener.run_all_examples()
    else:
        console.print("[bold blue]TradingView Screener Usage Guide[/bold blue]")
        console.print("\nUse --list-examples to see all available examples")
        console.print("Use --example <name> to run a specific example")
        console.print("Use --run-all to run all examples")
        console.print("Use --watch to start intraday watch mode")
        console.print("Use --market <us|in> to select market (default: in)")
        console.print("Use --sector <name> for sector-specific analysis")
        console.print("\nExample usage:")
        console.print("  python tv_screen_usage.py --example intraday_breakouts")
        console.print("  python tv_screen_usage.py --market us --example intraday_breakouts")
        console.print("  python tv_screen_usage.py --example research_sectors")
        console.print("  python tv_screen_usage.py --example research_sector_stocks --sector 'Technology'")
        console.print("  python tv_screen_usage.py --example live_gap_sr_monitor  # Live gap-fill monitor")
        console.print("  python tv_screen_usage.py --example gap_fill_analysis    # Historical gap analysis")
        console.print("  python tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15")
        console.print("  python tv_screen_usage.py --watch --mode FOMO --volume-threshold 2.5")
        console.print("  python tv_screen_usage.py --watch --mode ACCUMULATION --enable-trading")
        console.print("  python tv_screen_usage.py --watch --mode OPTIMIZED_GAP --refresh 2 --enable-trading")
        console.print("  python tv_screen_usage.py --watch --mode GAP_FILL_SR --refresh 30 --enable-trading  # Gap-fill + S/R")
        console.print("  python tv_screen_usage.py --market us --example intraday_watch --refresh 10")

if __name__ == "__main__":
    main()
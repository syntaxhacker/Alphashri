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
from datetime import datetime, timedelta
import atexit
import signal

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

# Optional utils import for trailing buffer and charges
try:
    from . import tv_utils  # package-relative
except Exception:
    try:
        import upstox_trader.screeners.tv_utils as tv_utils  # absolute
    except Exception:
        tv_utils = None  # guard at call sites

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

class TVWebhookServer:
    """Direct webhook server for real-time TV alerts"""
    def __init__(self, process_callback, log_file=None, port=5001):
        self.process_callback = process_callback
        self.log_file = log_file
        self.port = port
        self.running = False
        self.thread = None
        self.app = None
        
    def start(self):
        """Start the webhook server in a separate thread"""
        self.running = True
        self.thread = threading.Thread(target=self._run_server, daemon=True)
        self.thread.start()
        console.print(f"[green]📡 Webhook server started on port {self.port}[/green]")
        
    def stop(self):
        """Stop the webhook server"""
        self.running = False
        
    def _run_server(self):
        """Run the Flask webhook server"""
        try:
            from flask import Flask, request, jsonify
            import json
            
            self.app = Flask(__name__)
            
            @self.app.route('/webhook', methods=['POST'])
            def webhook_handler():
                try:
                    data = request.json
                    from datetime import datetime
                    
                    # Log every webhook call
                    if self.log_file:
                        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        symbol = data.get('symbol', 'UNKNOWN')
                        action = data.get('action', 'UNKNOWN')
                        price = data.get('price', '0')
                        status = 'UNKNOWN'
                        
                        with open(self.log_file, 'a') as f:
                            f.write(f"{timestamp},{symbol},{action},{price},")
                    
                    if data and data.get('action', '').upper() in ['BUY', 'LONG']:
                        # Process immediately with callback
                        if self.process_callback:
                            self.process_callback([data])
                        
                        # Log success
                        if self.log_file:
                            with open(self.log_file, 'a') as f:
                                f.write(f"SUCCESS\n")
                        
                        return jsonify({'status': 'success', 'message': 'BUY Alert processed'})
                    elif data and data.get('action', '').upper() in ['SELL', 'SHORT']:
                        # Process SELL as short position
                        if self.process_callback:
                            self.process_callback([data])
                        
                        # Log success
                        if self.log_file:
                            with open(self.log_file, 'a') as f:
                                f.write(f"SUCCESS\n")
                        
                        return jsonify({'status': 'success', 'message': 'SELL Alert processed as short position'})
                    else:
                        # Log ignored
                        if self.log_file:
                            with open(self.log_file, 'a') as f:
                                f.write(f"IGNORED\n")
                        
                        return jsonify({'status': 'ignored', 'message': 'Not a trading signal'})
                except Exception as e:
                    # Log error
                    if self.log_file:
                        from datetime import datetime
                        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        with open(self.log_file, 'a') as f:
                            f.write(f"ERROR: {str(e)}\n")
                    
                    return jsonify({'status': 'error', 'message': str(e)}), 500
            
            self.app.run(host='localhost', port=self.port, debug=False, threaded=True)
        except ImportError:
            console.print("[yellow]⚠️ Flask not available - webhook server disabled[/yellow]")
        except Exception as e:
            console.print(f"[red]Webhook server error: {e}[/red]")

class TVScreenerUsage:
    def __init__(self, market='in', enable_paper_trading=False, consider_tv_alerts=False):
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
        
        # Trading Time Configuration
        self.trading_start_time = "09:15"
        self.trading_end_time = "14:00"    # Stop trading at 10:00 AM (align with newer file)

        # Simple Paper Trading integration (without full bot monitoring)
        self.paper_trading_enabled = enable_paper_trading
        self.live_trades = []  # Track live trades for display
        self.closed_trades = []  # Track closed trades with P&L
        self.positions = {}   # Simple position tracking
        self.current_prices = {}  # Track current prices
        self.price_cache_timestamps = {}  # Track when prices were last fetched
        self.exchange_fallbacks = {}  # Track which symbols use fallback exchange
        self.trade_count = 0  # Track number of trades

        # Alert deduplication & cooldown (minimal set to align with newer risk handling)
        self.sent_alerts = set()
        self.last_alert_time = {}
        self.alert_cooldown = 300  # 5 minutes per symbol per alert

        # Stop loss cooldown tracking (30 minutes)
        self.stop_loss_cooldown = {}
        self.stop_loss_cooldown_duration = 1800  # seconds
        
        # Loss-based cooling system - 30+ minute timeout after any loss
        self.loss_cooldown = {}  # Track symbols that had losses: {symbol: timestamp}
        self.loss_cooldown_duration = 1800  # 30 minutes in seconds (minimum)
        
        # Daily entry limits - max 10 entries per day per stock (increased for TV alerts)
        self.daily_entry_count = {}  # Track entries per symbol per day: {symbol: {date: count}}
        self.max_daily_entries_per_stock = 10

        # Setup signal handlers for graceful shutdown (bulk exit)
        self._setup_signal_handlers()
        
        # Initialize Upstox API for live prices if available
        self.upstox_api = None
        self.background_monitor_active = False
        self.monitor_thread = None
        self.stop_monitoring = threading.Event()
        
        if self.paper_trading_enabled:
            try:
                from config_and_utils.free_indian_apis import UpstoxAPI
                self.upstox_api = UpstoxAPI(
                    api_key=UPSTOX_CONFIG.get('api_key'),
                    api_secret=UPSTOX_CONFIG.get('api_secret')
                )
                console.print("[green]✅ Paper Trading enabled (₹20,000 per trade) with live Upstox prices[/green]")
            except Exception as e:
                console.print(f"[yellow]⚠️ Paper Trading enabled (₹20,000 per trade) - Upstox API unavailable: {e}[/yellow]")
        else:
            console.print("[yellow]⚠️ Paper Trading disabled[/yellow]")
        
        # Display trading hours if paper trading is enabled
        if self.paper_trading_enabled:
            console.print(f"[cyan]⏰ Trading Hours: {self.trading_start_time} - {self.trading_end_time} IST[/cyan]")
        
        # TV Alert integration
        self.consider_tv_alerts = consider_tv_alerts
        self.webhook_server = None
        
        # Setup TV alert logging
        self.tv_alerts_log = None
        if self.consider_tv_alerts:
            self._setup_tv_alerts_log()
        
        if self.consider_tv_alerts:
            # Start direct webhook server for real-time alerts
            self.webhook_server = TVWebhookServer(self._process_tv_alerts, self.tv_alerts_log)
            self.webhook_server.start()
            console.print("[green]✅ TV Alert monitoring enabled (Direct Webhook on port 5001)[/green]")
        else:
            console.print("[yellow]⚠️ TV Alert monitoring disabled[/yellow]")
    
    def _setup_tv_alerts_log(self):
        """Setup TV alerts log file for daily webhook logging"""
        from datetime import datetime
        import os
        
        # Create logs directory if it doesn't exist
        logs_dir = "logs"
        if not os.path.exists(logs_dir):
            os.makedirs(logs_dir)
            
        # Create log filename with date
        date_str = datetime.now().strftime("%Y-%m-%d")
        self.tv_alerts_log = f"{logs_dir}/tv_alerts_{date_str}.log"
        
        # Write header if new file
        if not os.path.exists(self.tv_alerts_log):
            with open(self.tv_alerts_log, 'w') as f:
                f.write(f"# TV Alerts Log - {date_str}\n")
                f.write(f"# Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("# Format: timestamp,symbol,action,price,status\n")
    
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
        mode = getattr(self, 'watch_mode', 'old_screener').lower()
        self.journal_file = f"{logs_dir}/old_tv_screener_{mode}_{date_str}.log"
        
        # Write header if new file
        if not os.path.exists(self.journal_file):
            with open(self.journal_file, 'w') as f:
                f.write(f"# Old TV Screener Trade Journal - {mode.upper()} Mode\n")
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
                    from_date=from_date,
                    exchange='NSE_EQ',
                    instrument_type='EQ'
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
                    from_date=hourly_from_date,
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
            
            if df is None or df.empty or len(df) < 10:
                return 'neutral'  # Insufficient data
            
            # Calculate trend indicators
            df = df.sort_values('timestamp').reset_index(drop=True)
            
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
            # Try fallback with 15-minute data for 7 days if daily fails
            try:
                console.print(f"[dim yellow]⚠️ Daily trend analysis failed for {symbol}, trying 15min fallback...[/dim yellow]")
                from datetime import datetime, timedelta
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                
                df = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=to_date,
                    from_date=from_date,
                    exchange='NSE_EQ',
                    instrument_type='EQ'
                )
                
                if df is not None and not df.empty and len(df) >= 10:
                    # Simple trend analysis with available data
                    df = df.sort_values('timestamp').reset_index(drop=True)
                    recent_price = df['close'].iloc[-1]
                    older_price = df['close'].iloc[0]
                    price_change = (recent_price - older_price) / older_price * 100
                    
                    if price_change > 3:
                        return 'bullish'
                    elif price_change < -3:
                        return 'bearish'
                    else:
                        return 'neutral'
                        
            except Exception as fallback_error:
                console.print(f"[dim red]⚠️ All trend analysis failed for {symbol}: {e} | Fallback: {fallback_error}[/dim red]")
            
            return 'neutral'  # Ultimate failsafe

    def _is_trading_hours(self):
        """Check if current time is within trading hours"""
        try:
            from datetime import datetime
            now = datetime.now().time()

            # Parse trading hours
            start_time = datetime.strptime(self.trading_start_time, "%H:%M").time()
            end_time = datetime.strptime(self.trading_end_time, "%H:%M").time()

            # Check if current time is within trading hours
            return start_time <= now <= end_time
        except Exception as e:
            console.print(f"[yellow]⚠️ Error checking trading hours: {e}. Allowing trade.[/yellow]")
            return True  # Default to allowing trade if there's an error
        
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
            
            # Add trend analysis for each stock
            if not df.empty:
                console.print("[dim]Adding trend analysis...[/dim]")
                trend_data = []
                for _, row in df.iterrows():
                    ticker = row['name']  # Use 'name' field as it contains the ticker
                    trend = self._check_historical_trend(ticker, timeframe='daily', lookback_days=15)
                    trend_data.append(trend)
                df['trend'] = trend_data
            
            self.display_table(df, "High Volume Breakouts - Intraday")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On breakout above resistance with high volume")
            console.print("• Stop Loss: Below recent support (2-3%)")
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
            console.print("• Stop Loss: Below gap fill level")
            console.print("• Target: Previous resistance or 5-8% gain")
            console.print("• Time Frame: 15-30 minute charts")
            
        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")
    
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
            console.print("• Stop Loss: Below recent low (1-2%)")
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
            console.print("• Stop Loss: Tight stops (1-2%) due to volatility")
            console.print("• Target: Quick profits, trail stops")
            
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
            console.print("• Stop Loss: Below recent consolidation low (1-2%)")
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
            console.print("• Target: Measured move = Range height projected")
            
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
            console.print("• Stop Loss: Below EMA20 (3-5%)")
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
            console.print("• Stop Loss: Below consolidation support")
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
            console.print("• Stop Loss: Below EMA50")
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
            console.print("• Stop Loss: Not applicable (buy more on dips)")
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
            console.print("• Stop Loss: Only on fundamental deterioration")
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
            console.print("• Stop Loss: On business deterioration")
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
                    col('sector') != ''  # Has sector data
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(100)
                .get_scanner_data(cookies=self.cookies)
            )
            
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
                    col('sector') != ''  # Has sector data
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
        """Wait until 9:15 AM before starting active monitoring"""
        target_time = datetime.now().replace(hour=9, minute=15, second=0, microsecond=0)
        current_time = datetime.now()
        
        # If we're past 9:15 AM today, start immediately
        if current_time >= target_time:
            console.print("[green]✅ Market open time reached - starting active monitoring[/green]")
            return
        
        # Calculate wait time
        wait_seconds = (target_time - current_time).total_seconds()
        wait_minutes = int(wait_seconds // 60)
        wait_secs = int(wait_seconds % 60)
        
        console.print(f"[yellow]⏰ Waiting until time to start active monitoring...[/yellow]")
        console.print(f"[blue]Current time: {current_time.strftime('%H:%M:%S')}[/blue]")
        console.print(f"[blue]Target time: 9:15:00[/blue]")
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
    
    def intraday_watch_mode(self, refresh_interval=30, volume_threshold=2.0, price_threshold=3.0):
        """Watch mode for intraday trading - continuously monitors volume and price changes"""
        console.print(Panel.fit("📊 INTRADAY WATCH MODE - Live Market Monitoring", style="bold red"))
        
        console.print(f"[yellow]⚙️  Configuration:[/yellow]")
        console.print(f"• Refresh interval: {refresh_interval} seconds")
        console.print(f"• Volume threshold: {volume_threshold}x normal volume")
        console.print(f"• Price change threshold: {price_threshold}%")
        console.print(f"• Paper trading: {'🟢 ENABLED (₹20,000 per trade)' if self.paper_trading_enabled else '🔴 DISABLED'}")
        if self.paper_trading_enabled:
            console.print(f"• Live risk management: 🟢 ENABLED (2% SL | 4% TP | 1.5% TSL | 2sec checks)")
        console.print(f"• Trade journal: 📝 {self.journal_file}")
        console.print(f"• Trend analysis: 🎯 ENABLED (15-day lookback | SELL in bearish trends)")
        console.print(f"• Press Ctrl+C to stop monitoring")
        console.print()
        
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
                
                # TV alerts processed directly via webhook callback
                
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
        """Get current market data for watch mode"""
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('volume') > 500000,  # Minimum volume
                    col('market_cap_basic') > 1e9,  # Min 1000 crores
                    col('relative_volume_10d_calc') > 0.5,  # Some activity
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Add calculated fields
            df['volatility_pct'] = df['Volatility.D'] * 100
            df['market_cap_cr'] = df['market_cap_basic'] / 1e7
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error fetching watch data: {e}[/red]")
            return pd.DataFrame()
    
    def _detect_alerts(self, current_data, previous_data, volume_threshold, price_threshold):
        """Detect volume spikes and price movements"""
        alerts = []
        
        if previous_data.empty:
            return alerts
            
        for _, row in current_data.iterrows():
            ticker = row['name']
            
            # Volume spike alert
            if row['relative_volume_10d_calc'] > volume_threshold:
                prev_vol = previous_data[previous_data['name'] == ticker]['relative_volume_10d_calc'].values
                if len(prev_vol) > 0 and row['relative_volume_10d_calc'] > prev_vol[0] * 1.2:
                    alerts.append({
                        'type': 'VOLUME_SPIKE',
                        'ticker': ticker,
                        'name': row['name'],
                        'current_volume_ratio': row['relative_volume_10d_calc'],
                        'previous_volume_ratio': prev_vol[0] if len(prev_vol) > 0 else 0,
                        'price': row['close'],
                        'change': row['change']
                    })
            
            # Price movement alert
            if abs(row['change']) > price_threshold:
                prev_change = previous_data[previous_data['name'] == ticker]['change'].values
                if len(prev_change) > 0 and abs(row['change']) > abs(prev_change[0]) * 1.1:
                    alerts.append({
                        'type': 'PRICE_MOVE',
                        'ticker': ticker,
                        'name': row['name'],
                        'current_change': row['change'],
                        'previous_change': prev_change[0] if len(prev_change) > 0 else 0,
                        'price': row['close'],
                        'volume_ratio': row['relative_volume_10d_calc']
                    })
        
        return alerts
    
    def send_telegram_alert(self, alert):
        """Send a Telegram alert for a new event"""
        if not self.telegram_enabled:
            return

        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']
            
            message = f"🔥 *TradingView Alert: {alert['type'].replace('_', ' ').title()}* 🔥\n\n"
            message += f"📈 *Symbol:* {alert['ticker']} ({alert['name']})\n"
            message += f"💰 *Price:* ₹{alert['price']:.2f}\n"

            if alert['type'] == 'VOLUME_SPIKE':
                message += f"📊 *Volume Ratio:* {alert['current_volume_ratio']:.1f}x (was {alert['previous_volume_ratio']:.1f}x)\n"
                message += f"📈 *Change:* {alert['change']:+.2f}%\n"
            elif alert['type'] == 'PRICE_MOVE':
                message += f"📈 *Change:* {alert['current_change']:+.2f}% (was {alert['previous_change']:+.2f}%)\n"
                message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x\n"
            
            # Add trading action if paper trading is enabled
            if self.paper_trading_enabled:
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

    def send_telegram_exit_alert(self, message):
        """Send a Telegram alert for exit trades"""
        if not self.telegram_enabled:
            return

        try:
            bot_token = TELEGRAM_CONFIG['bot_token']
            chat_id = TELEGRAM_CONFIG['chat_id']
            
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'Markdown'
            }
            
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                console.print("[green]✅ Telegram exit alert sent[/green]")
            else:
                console.print(f"[red]⚠️ Telegram exit alert failed: {response.text}[/red]")

        except Exception as e:
            console.print(f"[red]❌ Error sending Telegram exit alert: {str(e)}[/red]")

    def _display_alerts(self, alerts):
        """Display alerts in a formatted way and send to both Telegram and Paper Trading Bot"""
        for alert in alerts:
            # Send to Telegram
            self.send_telegram_alert(alert)
            
            # Send to Paper Trading Bot
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
            
            # Calculate confidence based on alert strength
            confidence = self._calculate_alert_confidence(alert)
            
            # Only trade if confidence is sufficient (50%+)
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
                if alert['type'] in ['VOLUME_SPIKE', 'PRICE_MOVE']:
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
            
            if trade_side:
                # RELAXED downtrend requirement for FOMO mode
                if trade_side == 'SELL':
                    # Create a mock row from alert data for downtrend confirmation
                    mock_row = {
                        'close': price,
                        'change': alert.get('change', alert.get('current_change', 0)),
                        'relative_volume_10d_calc': alert.get('volume_ratio', 1.0),
                        'VWAP': alert.get('VWAP', price),
                        'EMA20': alert.get('EMA20', price),
                        'EMA50': alert.get('EMA50', price)
                    }
                    confirmed_downtrend = self._check_confirmed_downtrend_for_short(symbol, mock_row)
                    rsi = alert.get('rsi', 50)
                    # Only require confirmation for less extreme RSI (allow very overbought signals through)
                    if not confirmed_downtrend and rsi < 85:
                        console.print(f"[yellow]⚠️ {symbol}: SHORT signal but no confirmed downtrend - skipping[/yellow]")
                        return
                
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
                    
                    # Log trade to journal
                    self.log_trade("ENTRY", symbol, price, quantity, quantity * price, f"{alert['type']}|trend:{trend}", side=trade_side)
                    
                    trend_emoji = "📈" if trend in ['strong_bullish', 'bullish'] else "📉" if trend in ['strong_bearish', 'bearish'] else "➡️"
                    strategy_reason = f"bearish trend short" if trend in ['strong_bearish', 'bearish'] and trade_side == 'SELL' else f"signal-based {trade_side.lower()}"  
                    console.print(f"   [green]✅ Paper trade executed: {trade_side} {quantity} {symbol} @ ₹{price:.2f} {trend_emoji} ({strategy_reason})[/green]")
                else:
                    console.print(f"   [red]❌ Paper trade failed for {symbol}[/red]")
            else:
                console.print(f"   [dim]No clear trading signal for {symbol}[/dim]")
                
        except Exception as e:
            console.print(f"   [red]❌ Paper trading error: {e}[/red]")
    
    def _calculate_alert_confidence(self, alert):
        """Calculate confidence score for alert"""
        confidence = 0.5  # Base confidence
        
        if alert['type'] == 'VOLUME_SPIKE':
            vol_ratio = alert.get('current_volume_ratio', 1)
            if vol_ratio > 5:
                confidence += 0.3
            elif vol_ratio > 3:
                confidence += 0.2
            elif vol_ratio > 2:
                confidence += 0.1
                
            # Price change factor
            change = abs(alert.get('change', 0))
            if change > 5:
                confidence += 0.2
            elif change > 3:
                confidence += 0.1
        
        elif alert['type'] == 'PRICE_MOVE':
            change = abs(alert.get('current_change', 0))
            if change > 8:
                confidence += 0.3
            elif change > 5:
                confidence += 0.2
            elif change > 3:
                confidence += 0.1
                
            # Volume factor
            vol_ratio = alert.get('volume_ratio', 1)
            if vol_ratio > 2:
                confidence += 0.1
        
        return min(confidence, 0.95)  # Cap at 95%
    
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
    
    def _execute_screener_trade(self, symbol, side, alert, price, quantity, confidence, trend='neutral'):
        """Execute paper trade via bot"""
        try:
            # Check trading hours - prevent new trades outside market hours
            if not self._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours ({self.trading_start_time}-{self.trading_end_time})[/yellow]")
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
            if live_price:
                price_diff_pct = abs(live_price - price) / price * 100
                if price_diff_pct > 0.5:  # More than 0.5% difference
                    console.print(f"[yellow]⚠️ TRADE SKIPPED: {symbol} - Price difference too high: {price_diff_pct:.2f}% (Signal: ₹{price:.2f} vs Live: ₹{live_price:.2f})[/yellow]")
                    return False
                
                # Use live price for execution
                price = live_price
            
            # Create position directly in bot
            trade_log_msg = f"SCREENER_ALERT_TRADE: Side={side}, Qty={quantity}, Symbol={symbol}, Price={price:.2f}, Alert={alert['type']}, Confidence={confidence:.2f}"
            
            # Log the trade
            print(trade_log_msg)
            
            # Volatility detection retained for other purposes, but stops are now fixed 0.5%
            volatility_level = self._detect_volatility_level(symbol, price)
            
            # Create position
            self.positions[symbol] = {
                'side': side,
                'qty': quantity,
                'entry_price': round(price, 2),
                'timestamp': datetime.now(),
                'entry_time': datetime.now(),
                'highest_profit_pct': 0.0,
                'highest_price': round(price, 2),
                'trailing_stop_active': False,
                'volatility': volatility_level,
                'trailing_stop_pct': 0.0,
                'trade_id': self.trade_count + 1,
                'source': 'TV_SCREENER',
                'alert_type': alert['type'],
                'confidence': confidence
            }
            
            self.trade_count += 1
            self.current_prices[symbol] = round(price, 2)
            
            # Increment daily entry count for this symbol
            self._increment_daily_entry_count(symbol)

            # Calculate and store entry trading charges for accurate net P&L later
            try:
                entry_amount = price * quantity
                entry_charges = self._calculate_trading_charges(entry_amount, 'intraday')
            except Exception:
                entry_charges = 0.0

            # Augment stored position with entry charges and trailing metadata (if not already)
            pos = self.positions.get(symbol, {})
            pos['entry_charges'] = entry_charges
            pos.setdefault('trailing_stop_active', False)
            pos.setdefault('trailing_stop_pct', 0.0)
            pos.setdefault('highest_profit_pct', 0.0)
            pos.setdefault('highest_price', round(price, 2))
            self.positions[symbol] = pos

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
        
        table = Table(title="Live Market Monitor - Top Volume Movers", show_header=True)
        table.add_column("Ticker", style="cyan", no_wrap=True)
        table.add_column("Name", style="green", max_width=12)
        table.add_column("Price", justify="right", style="yellow")
        table.add_column("Change %", justify="right", style="magenta")
        table.add_column("Volume", justify="right", style="blue")
        table.add_column("Vol Ratio", justify="right", style="red")
        table.add_column("RSI", justify="right", style="cyan")
        table.add_column("Alert", style="bold red")
        
        for _, row in df.head(15).iterrows():
            ticker = row['name']
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
            
            table.add_row(
                f"{ticker_style}{ticker}",
                row['name'][:12],
                f"₹{row['close']:,.2f}",
                f"[{change_color}]{change_val:+.2f}%[/{change_color}]",
                f"{row['volume']:,.0f}",
                f"[{vol_color}]{vol_ratio:.1f}x[/{vol_color}]",
                f"[{rsi_color}]{rsi_val:.1f}[/{rsi_color}]",
                alert_symbol
            )
        
        console.print(table)
        
        # Display live trades if paper trading is enabled
        if self.paper_trading_enabled and self.live_trades:
            self._display_live_trades()
        
        # Display active positions if paper trading is enabled
        if self.paper_trading_enabled:
            self._display_active_positions()
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
    
    def _get_live_price_from_upstox(self, symbol, force_refresh=False):
        """Get live price from Upstox API for a symbol with BSE fallback"""
        try:
            if not (hasattr(self, 'upstox_api') and self.upstox_api):
                console.print(f"[dim]ℹ️ No Upstox API available for {symbol}, using fallback price[/dim]")
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
            
            # Validate and clean the symbol
            clean_symbol = symbol.strip().upper()
            
            # Extract exchange and symbol first
            if ':' in clean_symbol:
                exchange, clean_symbol = clean_symbol.split(':', 1)
            
            # Remove common suffixes that might cause instrument key not found errors
            suffixes_to_remove = ['.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
            for suffix in suffixes_to_remove:
                if clean_symbol.endswith(suffix):
                    clean_symbol = clean_symbol[:-len(suffix)]
                    break
            
            # Validate symbol format (should be 3-15 characters for Indian stocks)
            if not (3 <= len(clean_symbol) <= 15):
                console.print(f"[yellow]⚠️ Invalid symbol format for {symbol}: {clean_symbol} (length: {len(clean_symbol)})[/yellow]")
                return None
                
            # Set default exchange if not specified
            if ':' not in symbol.strip().upper():
                exchange = 'NSE'
            
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
                else:
                    # Add to blacklist if not found on any exchange
                    self._symbol_blacklist.add(symbol)
                    console.print(f"[red]❌ Symbol {clean_symbol} not found on NSE or BSE - blacklisting[/red]")
            
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
    
    def _fetch_price_from_exchange(self, symbol, exchange):
        """Fetch price from specific exchange with proper error handling"""
        try:
            # Check if market is open (9:15 AM - 3:30 PM) - fetch live prices during market hours
            from datetime import datetime, time
            now = datetime.now().time()
            market_open = time(9, 15)  # 9:15 AM
            market_close = time(15, 30)  # 3:30 PM
            
            if not (market_open <= now <= market_close):
                # Outside market hours - return None to use cached prices
                return None
            
            if not (hasattr(self, 'upstox_api') and self.upstox_api):
                console.print(f"[red]❌ Upstox API unavailable for {symbol} on {exchange} - TSL monitoring affected[/red]")
                return None
            
            # Map exchange to Upstox format
            exchange_map = {
                'NSE': 'NSE_EQ',
                'BSE': 'BSE_EQ'
            }
            
            upstox_exchange = exchange_map.get(exchange, 'NSE_EQ')
            
            # Get latest intraday data (1-minute) to get current price with proper exchange parameters
            df = self.upstox_api.fetch_intraday_data_v3(
                symbol=symbol, 
                unit='minutes', 
                interval=1,
                exchange='NSE_EQ',
                instrument_type='EQ'
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

    def _process_tv_alerts(self, alerts=None):
        """Process TV alerts and add symbols to active positions"""
        if not self.consider_tv_alerts:
            return
            
        if alerts is None:
            # Called from main loop - no queue needed with direct webhook
            return
        else:
            # Process directly (real-time callback)
            alerts_to_process = alerts
        
        for alert in alerts_to_process:
            symbol = alert.get('symbol', '').strip()
            if not symbol:
                continue
                
            # Check if already in positions or sent alerts
            if (symbol in self.positions and self.positions[symbol]):
                console.print(f"[yellow]⚠️ TV Alert blocked: {symbol} - Already in positions[/yellow]")
                continue
            if symbol in self.sent_alerts:
                console.print(f"[yellow]⚠️ TV Alert blocked: {symbol} - Already in sent alerts[/yellow]")
                continue
                
            try:
                # Get current price and action from alert
                price = float(alert.get('price', 0))
                if price <= 0:
                    continue
                    
                action = alert.get('action', '').upper()
                side = 'BUY' if action in ['BUY', 'LONG'] else 'SELL'
                
                # Standard position size (₹20,000)
                position_size = 20000
                quantity = int(position_size / price)
                
                # Create position from TV alert
                self.positions[symbol] = {
                    'side': side,
                    'qty': quantity,
                    'entry_price': round(price, 2),
                    'timestamp': datetime.now(),
                    'entry_time': datetime.now(),
                    'highest_profit_pct': 0.0,
                    'highest_price': round(price, 2),
                    'trailing_stop_active': False,
                    'volatility': 'LOW',
                    'trailing_stop_pct': 0.0,
                    'trade_id': self.trade_count + 1,
                    'source': 'TV_ALERT',
                    'alert_type': 'TV_WEBHOOK',
                    'confidence': 1.0
                }
                
                self.trade_count += 1
                self.current_prices[symbol] = round(price, 2)
                self.sent_alerts.add(symbol)
                self.last_alert_time[symbol] = time.time()
                
                # Log the TV alert position
                side_emoji = "🟢" if side == 'BUY' else "🔴"
                console.print(f"[green]✅ TV Alert Position: {side_emoji} {symbol} {side} @ {price} (Qty: {quantity})[/green]")
                
                if self.journal_file:
                    with open(self.journal_file, 'a') as f:
                        f.write(f"TV_ALERT_ENTRY: {symbol} @ {price} Qty:{quantity} Time:{datetime.now()}\n")
                        
            except Exception as e:
                console.print(f"[red]Error processing TV alert for {symbol}: {e}[/red]")

    def _display_active_positions(self):
        """Display active positions with live P&L from Upstox (net after estimated charges)"""
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

        for symbol, position in active_positions.items():
            # Try to get live price from Upstox first, fallback to cached price
            live_price = self._get_live_price_from_upstox(symbol)
            current_price = live_price if live_price else self.current_prices.get(symbol, position['entry_price'])

            # Charges
            entry_charges = position.get('entry_charges', 0.0)
            current_value = current_price * position['qty']
            estimated_exit_charges = self._calculate_trading_charges(current_value, 'intraday')

            # Gross PnL
            gross_pnl = (current_price - position['entry_price']) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1

            # Net PnL
            pnl_amount = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = position['entry_price'] * position['qty']
            pnl_pct = (pnl_amount / entry_value) * 100 if entry_value else 0.0

            # Color coding
            pnl_style = "green" if pnl_pct > 0 else "red"
            side_style = "green" if position['side'] == 'BUY' else "red"
            side_emoji = "🟢" if position['side'] == 'BUY' else "🔴"

            # Price source indicator with exchange info
            if live_price:
                price_indicator = "🔄" if symbol in self.exchange_fallbacks else "🟢"
                current_price_display = f"{price_indicator}₹{current_price:,.2f}"
            else:
                current_price_display = f"🔴₹{current_price:,.2f}"

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
            side_style = "green" if trade['entry_side'] == 'BUY' else "red"
            side_emoji = "🟢" if trade['entry_side'] == 'BUY' else "🔴"
            
            # Format hold time
            hold_time = trade['hold_time']
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
                f"[{side_style}]{side_emoji} {trade['entry_side']}[/{side_style}]",
                f"₹{trade['entry_price']:,.2f}",
                f"₹{trade['exit_price']:,.2f}",
                str(trade['quantity']),
                f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
                hold_display,
                trade['reason'][:15]
            )
        
        console.print(closed_table)
        
        # Display summary stats
        total_trades = len(self.closed_trades)
        win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0
        total_pnl_style = "green" if total_pnl_amount > 0 else "red"
        
        console.print(f"[dim]Total Trades: {total_trades} | Win Rate: {win_rate:.1f}% | "
                     f"Total P&L: [{total_pnl_style}]₹{total_pnl_amount:+,.0f}[/{total_pnl_style}][/dim]")
    
    def start_background_monitoring(self):
        """Start background thread for continuous live price monitoring and risk management"""
        if not self.paper_trading_enabled:
            return
        
        # Start monitoring even if Upstox API has issues - display errors instead of stopping
        
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
        """Monitor individual position for risk management with progressive trailing stop and net P&L"""
        try:
            # Get live price (force refresh for accuracy in risk management)
            live_price = self._get_live_price_from_upstox(symbol, force_refresh=True)
            if not live_price:
                return

            # Update current price
            self.current_prices[symbol] = live_price

            # Compute net P&L including estimated exit charges
            entry_price = position['entry_price']
            entry_charges = position.get('entry_charges', 0.0)

            current_value = live_price * position['qty']
            estimated_exit_charges = self._calculate_trading_charges(current_value, 'intraday')

            gross_pnl = (live_price - entry_price) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1

            net_pnl = gross_pnl - entry_charges - estimated_exit_charges
            entry_value = entry_price * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100 if entry_value else 0.0

            # Strict 0.5% stop loss for all stocks (removed ATR-based logic)
            stop_loss_pct = -1.0
                
            take_profit_pct = 1.5  # 1.5% take profit threshold (1.5:1 reward ratio)
            quick_exit_pct = 1.0   # 1.0% quick exit threshold (was 0.4%)

            # Calculate trade duration for ultra-quick trailing determination
            trade_duration_minutes = (datetime.now() - position.get('timestamp', datetime.now())).total_seconds() / 60
            
            # Determine if ultra-quick trailing should be active
            ultra_quick_trailing = False
            if trade_duration_minutes <= 3 and pnl_pct >= 0.8:  # 0.8% in 3 minutes
                ultra_quick_trailing = True
            elif trade_duration_minutes <= 5 and pnl_pct >= 1.0:  # 1.0% in 5 minutes
                ultra_quick_trailing = True
            elif trade_duration_minutes <= 10 and pnl_pct >= 1.5:  # 1.5% in 10 minutes
                ultra_quick_trailing = True

            # MUCH TIGHTER trailing stop buffer (aggressive profit locking)
            trailing_stop_buffer = self._get_tighter_trailing_buffer(abs(pnl_pct), is_ultra_quick=ultra_quick_trailing)

            # Update highest profit and price tracking
            if pnl_pct > position.get('highest_profit_pct', 0.0):
                position['highest_profit_pct'] = pnl_pct
                position['highest_price'] = live_price

            # Check for exit conditions
            should_exit = False
            exit_reason = ""
            
            # 0. Ultra-quick tight trailing activation for very fast profits (NO HARD EXITS)
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
            elif not position.get('trailing_stop_active', False) and pnl_pct <= stop_loss_pct:
                should_exit = True
                exit_reason = f"STOP LOSS: {pnl_pct:.2f}%"

            # 2. Activate trailing stop when take profit is reached
            elif pnl_pct >= take_profit_pct and not position.get('trailing_stop_active', False):
                position['trailing_stop_active'] = True
                position['trailing_stop_pct'] = pnl_pct - trailing_stop_buffer
                console.print(f"[bold green]🎯 PROGRESSIVE TRAILING STOP ACTIVATED for {symbol} at {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)[/bold green]")

            # 3. Update trailing stop as profit increases (progressive tightening)
            elif position.get('trailing_stop_active', False):
                new_trailing_stop = pnl_pct - trailing_stop_buffer
                old_trailing_stop = position.get('trailing_stop_pct', 0.0)

                # Only move trailing stop up (lock in more profit)
                if new_trailing_stop > old_trailing_stop:
                    position['trailing_stop_pct'] = new_trailing_stop
                    if abs(new_trailing_stop - old_trailing_stop) >= 0.2:  # show only meaningful moves
                        console.print(f"[dim green]📈 {symbol} trailing stop tightened: {old_trailing_stop:.2f}% → {new_trailing_stop:.2f}% (Buffer: {trailing_stop_buffer:.1f}%)[/dim green]")

                # Check if trailing stop is hit
                if pnl_pct <= position['trailing_stop_pct']:
                    should_exit = True
                    exit_reason = f"TRAILING STOP: {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}% | Buffer: {trailing_stop_buffer:.1f}%)"

            # 4. Quick exit at 1.0% if not trailing
            elif pnl_pct >= quick_exit_pct and not position.get('trailing_stop_active', False):
                should_exit = True
                exit_reason = f"QUICK EXIT: {pnl_pct:.2f}% (1.0% target)"

            # Execute exit if needed
            if should_exit:
                self._execute_exit_trade(symbol, position, live_price, exit_reason)

        except Exception as e:
            console.print(f"[red]❌ Error monitoring {symbol}: {e}[/red]")
    
    def _execute_exit_trade(self, symbol, position, exit_price, reason):
        """Execute exit trade for risk management with net P&L and charges"""
        try:
            # Calculate trading charges
            exit_amount = exit_price * position['qty']
            exit_charges = self._calculate_trading_charges(exit_amount, 'intraday')

            # Calculate P&L with trading charges
            gross_pnl = (exit_price - position['entry_price']) * position['qty']
            if position['side'] == 'SELL':
                gross_pnl *= -1

            total_charges = position.get('entry_charges', 0.0) + exit_charges
            net_pnl = gross_pnl - total_charges
            pnl_amount = net_pnl

            entry_value = position['entry_price'] * position['qty']
            pnl_pct = (net_pnl / entry_value) * 100 if entry_value else 0.0

            exit_log = (f"🔥 AUTO EXIT: {symbol} | "
                        f"{reason} | "
                        f"Entry: ₹{position['entry_price']:.0f} | "
                        f"Exit: ₹{exit_price:.0f} | "
                        f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | "
                        f"Charges: ₹{total_charges:.0f}")

            console.print(f"[bold red]{exit_log}[/bold red]")

            # Log exit trade to journal
            exit_side = 'SELL' if position['side'] == 'BUY' else 'BUY'
            self.log_trade("EXIT", symbol, exit_price, position['qty'], exit_amount, reason, pnl_pct, pnl_amount, side=exit_side)

            # If stop loss exit, add cooldown
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

            # Add to closed trades list
            self.closed_trades.append({
                'symbol': symbol,
                'entry_side': position['side'],
                'entry_price': position['entry_price'],
                'exit_price': exit_price,
                'quantity': position['qty'],
                'entry_amount': position['entry_price'] * position['qty'],
                'exit_amount': exit_price * position['qty'],
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount,
                'reason': reason,
                'hold_time': datetime.now() - position.get('entry_time', datetime.now())
            })

            # Close the position
            self.positions[symbol] = None

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

    # ==================== Trailing/Charges Utilities ====================
    def _get_progressive_trailing_buffer(self, profit_pct, volatility_adjustment=0.0):
        """Calculate trailing buffer; delegate to tv_utils when available"""
        try:
            if tv_utils is None:
                # Reasonable fallback curve: tightens as profit grows
                if profit_pct >= 3:
                    base = 0.6
                elif profit_pct >= 2:
                    base = 0.8
                elif profit_pct >= 1:
                    base = 1.0
                else:
                    base = 1.2
                return max(0.3, base - volatility_adjustment)
            return tv_utils.get_progressive_trailing_buffer(profit_pct, volatility_adjustment)
        except Exception:
            return 1.0
    
    def _get_tighter_trailing_buffer(self, profit_pct, is_ultra_quick=False):
        """MUCH TIGHTER trailing buffer for aggressive profit locking"""
        # Ultra-tight trailing stops that lock in profits very quickly
        
        # EVEN TIGHTER for ultra-quick trailing scenarios  
        if is_ultra_quick:
            if profit_pct >= 2.0:    # 2%+ profit: Lock in 95% (0.1% buffer)
                return 0.1
            elif profit_pct >= 1.5:  # 1.5%+ profit: Lock in 92% (0.15% buffer)  
                return 0.15
            elif profit_pct >= 1.0:  # 1%+ profit: Lock in 88% (0.2% buffer)
                return 0.2
            elif profit_pct >= 0.8:  # 0.8%+ profit: Lock in 85% (0.25% buffer)
                return 0.25
            else:                    # < 0.8% profit: Tight initial buffer
                return 0.3
        
        # Regular tight trailing (original logic)
        if profit_pct >= 2.0:    # 2%+ profit: Lock in 90% (0.2% buffer)
            return 0.2
        elif profit_pct >= 1.5:  # 1.5%+ profit: Lock in 85% (0.25% buffer)  
            return 0.25
        elif profit_pct >= 1.0:  # 1%+ profit: Lock in 80% (0.3% buffer)
            return 0.3
        elif profit_pct >= 0.8:  # 0.8%+ profit: Lock in 75% (0.35% buffer)
            return 0.35
        elif profit_pct >= 0.6:  # 0.6%+ profit: Lock in 65% (0.4% buffer)
            return 0.4
        elif profit_pct >= 0.4:  # 0.4%+ profit: Lock in 50% (0.45% buffer)
            return 0.45
        else:                    # < 0.4% profit: Initial buffer
            return 0.5

    def _detect_volatility_level(self, symbol, current_price):
        """Detect volatility level for a stock to determine if ATR-based stops should be used"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                return 'normal'  # Default to normal volatility
            
            from datetime import datetime, timedelta
            import numpy as np
            
            # Get recent price data (10 days for volatility calculation)
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=15)).strftime('%Y-%m-%d')
            
            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
                exchange='NSE_EQ',
                instrument_type='EQ'
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
            
            # Thresholds for volatility classification
            high_vol_threshold = 0.03  # 3% daily volatility
            high_range_threshold = 4.0  # 4% average daily range
            
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
    
    def _calculate_atr_based_stop(self, symbol, current_price, atr_multiplier=2.0):
        """Calculate ATR-based stop loss for volatile stocks"""
        try:
            if not hasattr(self, 'upstox_api') or not self.upstox_api:
                # Fallback to fixed percentage for volatile stocks
                return current_price * 0.98  # 2% stop loss as fallback
            
            from datetime import datetime, timedelta
            import numpy as np
            
            # Get historical data for ATR calculation (need at least 14 days)
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            
            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
                exchange='NSE_EQ',
                instrument_type='EQ'
            )
            
            if df is None or df.empty or len(df) < 14:
                # Fallback to fixed percentage
                return current_price * 0.98
            
            # Calculate True Range
            df['high_low'] = df['high'] - df['low']
            df['high_close_prev'] = np.abs(df['high'] - df['close'].shift(1))
            df['low_close_prev'] = np.abs(df['low'] - df['close'].shift(1))
            
            df['true_range'] = df[['high_low', 'high_close_prev', 'low_close_prev']].max(axis=1)
            
            # Calculate ATR (14-period average)
            atr = df['true_range'].rolling(window=14).mean().iloc[-1]
            
            if pd.isna(atr) or atr <= 0:
                # Fallback to fixed percentage
                return current_price * 0.98
            
            # ATR-based stop: current_price - (ATR * multiplier)
            atr_stop = current_price - (atr * atr_multiplier)
            
            # Ensure stop is reasonable (not more than 5% below current price)
            min_stop = current_price * 0.95
            atr_stop = max(atr_stop, min_stop)
            
            console.print(f"[dim]ATR Stop for {symbol}: ₹{atr_stop:.2f} (ATR: {atr:.2f}, Current: ₹{current_price:.2f})[/dim]")
            return atr_stop
            
        except Exception as e:
            console.print(f"[dim red]⚠️ ATR calculation failed for {symbol}: {e}[/dim red]")
            # Conservative fallback
            return current_price * 0.98

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
            
            # Bearish volume: elevated volume (>1.2x) with negative or weak positive move
            bearish_volume = volume_ratio > 1.2 and change < 1.0
            
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

    def _calculate_trading_charges(self, trade_value, trade_type='intraday'):
        """Estimate trading charges; delegate to tv_utils when available"""
        try:
            if tv_utils is None:
                # Simple fallback: ~0.035% of trade value as charges approximation
                rate = 0.00035 if trade_type == 'intraday' else 0.0005
                return trade_value * rate
            return tv_utils.calculate_trading_charges(trade_value, trade_type)
        except Exception:
            return 0.0
    
    def run_example(self, example_name, **kwargs):
        """Run a specific example"""
        examples = {
            # Intraday Trading
            'intraday_breakouts': self.intraday_high_volume_breakouts,
            'intraday_gap_up': self.intraday_gap_up_stocks,
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
            ("🚀 Intraday Trading", [
                "intraday_breakouts - High volume breakouts",
                "intraday_gap_up - Gap-up momentum",
                "intraday_oversold - Oversold bounce plays",
                "intraday_news - News-driven momentum",
                "intraday_watch - Live watch mode (continuous monitoring)"
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
            'swing_reversal', 'swing_breakout', 'swing_sector',
            'invest_growth', 'invest_dividend', 'invest_value',
            'research_leaders', 'research_sentiment', 'research_earnings', 'research_sectors'
        ]
        
        for example in examples:
            self.run_example(example)
            time.sleep(1)  # Small delay between examples
            console.print("\n" + "="*80 + "\n")

    # ==================== Signal/Exit Handling & Cleanup ====================
    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown (bulk exit)"""
        try:
            signal.signal(signal.SIGINT, self._signal_handler)  # Ctrl+C
            signal.signal(signal.SIGTERM, self._signal_handler)  # Termination
            atexit.register(self._cleanup_on_exit)
        except Exception:
            pass

    def _signal_handler(self, signum=None, _frame=None):
        """Handle shutdown signals"""
        console.print(f"\n[bold yellow]🛑 Signal received: {signal.Signals(signum).name if signum else 'EXIT'}[/bold yellow]")
        try:
            if hasattr(self, 'webhook_server') and self.webhook_server:
                self.webhook_server.stop()
            self._exit_all_positions("SCRIPT_STOPPED")
        except Exception as e:
            console.print(f"[red]Error during cleanup: {e}[/red]")
        finally:
            console.print("[yellow]👋 Exiting script...[/yellow]")
            os._exit(0)  # Force exit

    def _cleanup_on_exit(self):
        """Cleanup function called on script exit"""
        if hasattr(self, 'webhook_server') and self.webhook_server:
            self.webhook_server.stop()
        if hasattr(self, 'positions') and self.positions:
            self._exit_all_positions("SCRIPT_EXIT")

    def _exit_all_positions(self, reason="MANUAL_EXIT"):
        """Exit all live positions"""
        if not hasattr(self, 'positions') or not self.positions:
            console.print("[dim]No active positions to exit.[/dim]")
            return

        console.print(f"\n[bold red]🚨 EXITING ALL POSITIONS - Reason: {reason}[/bold red]")

        positions_to_exit = dict(self.positions)
        for symbol, position in positions_to_exit.items():
            try:
                # Get current price for exit
                current_price = self._get_live_price_from_upstox(symbol) or self.current_prices.get(symbol, position['entry_price'])
                self._execute_exit_trade(symbol, position, current_price, f"{reason}: Bulk Exit")
                # Remove from positions after successful exit
                if symbol in self.positions:
                    del self.positions[symbol]
            except Exception as e:
                console.print(f"[red]❌ Failed to exit {symbol}: {e}[/red]")
                # Still remove the position to prevent repeated attempts
                if hasattr(self, 'positions') and symbol in self.positions:
                    del self.positions[symbol]
                    console.print(f"[yellow]⚠️ Removed {symbol} from positions due to exit failure[/yellow]")
def main():
    parser = argparse.ArgumentParser(description='TradingView Screener Usage Examples')
    parser.add_argument('--example', type=str, help='Run specific example')
    parser.add_argument('--list-examples', action='store_true', help='List all available examples')
    parser.add_argument('--run-all', action='store_true', help='Run all examples')
    parser.add_argument('--market', type=str, default='in', choices=['us', 'in'], help='Market to screen (us/in, default: in)')
    parser.add_argument('--sector', type=str, help='Sector name for sector-specific analysis')
    
    # Watch mode specific arguments
    parser.add_argument('--watch', action='store_true', help='Start intraday watch mode')
    parser.add_argument('--refresh', type=int, default=30, help='Refresh interval in seconds (default: 30)')
    parser.add_argument('--volume-threshold', type=float, default=2.0, help='Volume threshold for alerts (default: 2.0x)')
    parser.add_argument('--price-threshold', type=float, default=3.0, help='Price change threshold for alerts (default: 3.0 percent)')
    
    # Paper Trading Bot integration
    parser.add_argument('--enable-trading', action='store_true', help='Enable paper trading bot integration (₹20,000 per trade)')
    
    # TV Alert integration
    parser.add_argument('--consider-tv-alerts', action='store_true', help='Consider TradingView alerts from webhook for active positions')
    
    args = parser.parse_args()
    
    screener = TVScreenerUsage(market=args.market, enable_paper_trading=args.enable_trading, consider_tv_alerts=args.consider_tv_alerts)
    
    if args.list_examples:
        screener.show_available_examples()
    elif args.watch:
        screener.intraday_watch_mode(
            refresh_interval=args.refresh,
            volume_threshold=args.volume_threshold,
            price_threshold=args.price_threshold
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
        console.print("  python old_tv_screen.py --example intraday_breakouts")
        console.print("  python old_tv_screen.py --market us --example intraday_breakouts")
        console.print("  python old_tv_screen.py --example research_sectors")
        console.print("  python old_tv_screen.py --example research_sector_stocks --sector 'Technology'")
        console.print("  python old_tv_screen.py --watch --refresh 15 --volume-threshold 2.5")
        console.print("  python old_tv_screen.py --watch --enable-trading --volume-threshold 1.5 --price-threshold 1.5")
        console.print("  python old_tv_screen.py --market us --example intraday_watch --refresh 10")

if __name__ == "__main__":
    main()
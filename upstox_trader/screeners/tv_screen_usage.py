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
        
        # Simple Paper Trading integration (without full bot monitoring)
        self.paper_trading_enabled = enable_paper_trading
        self.live_trades = []  # Track live trades for display
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
            
            self.display_table(df, "Pre-Breakout Accumulation - Early Entry")
            
            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On volume expansion above EMA20 with RSI >50")
            console.print("• Stop Loss: Below EMA20 or recent swing low (1-2%)")
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
            console.print("• Stop Loss: Below recent swing low (1.5%)")
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
            console.print("• Stop Loss: Below weekly support (2-3%)")
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
            console.print("• [green]Stop Loss:[/green] 1% (tight risk control)")
            console.print("• [green]Expected P&L:[/green] ₹156 per trade average")
            
            console.print("\n[bold yellow]🎯 ENTRY STRATEGY:[/bold yellow]")
            console.print("1. [cyan]Wait for 9:30 AM[/cyan] - Let market settle after opening volatility")
            console.print("2. [cyan]Check 15-min chart[/cyan] - Look for gap holding above previous close")
            console.print("3. [cyan]Volume confirmation[/cyan] - Ensure 2x+ volume continues")
            console.print("4. [cyan]Enter on pullback[/cyan] - Buy gap support or breakout continuation")
            console.print("5. [cyan]Set strict levels[/cyan] - 2.5% target, 1% stop loss")
            
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
            console.print("• [cyan]Exit:[/cyan] Stick to 2.5% target / 1% stop discipline")
            
            console.print("\n[bold blue]💡 HOW TO USE THIS STRATEGY:[/bold blue]")
            console.print("1. [yellow]Run this screener at 9:15 AM[/yellow] after market opens")
            console.print("2. [yellow]Focus on stocks with Quality Score ≥80[/yellow] (BUY recommendation)")
            console.print("3. [yellow]Switch to 15-minute charts[/yellow] in your trading platform")
            console.print("4. [yellow]Wait until 9:30 AM[/yellow] for trend confirmation")
            console.print("5. [yellow]Enter trades with strict discipline[/yellow]: 2.5% target, 1% stop")
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
    
    def intraday_watch_mode(self, refresh_interval=30, volume_threshold=2.0, price_threshold=3.0, mode='PREBREAKOUT'):
        """Watch mode for intraday trading - continuously monitors volume and price changes"""
        mode_titles = {
            'PREBREAKOUT': ("📊 PRE-BREAKOUT MODE - Early Entry Signals", "bold blue"),
            'FOMO': ("🔥 FOMO MODE - High Volume Breakouts", "bold red"), 
            'SMART_FOMO': ("🧠 SMART FOMO MODE - Historical Analysis + FOMO", "bold yellow"),
            'ACCUMULATION': ("📈 ACCUMULATION MODE - Smart Money Tracking", "bold green"),
            'MOMENTUM': ("⚡ MOMENTUM MODE - Early Momentum Detection", "bold cyan"),
            'OPTIMIZED_GAP': ("🚀 OPTIMIZED GAP MODE - 15-Min Gap Strategy (68.4% Win Rate)", "bold green")
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
            console.print(f"• Live risk management: 🟢 ENABLED (2% SL | 1% TP | 0.5% TSL | 2sec checks)")
        console.print(f"• Trade journal: 📝 {self.journal_file}")
        console.print(f"• Logging: 🔇 Minimal (reduced console spam)")
        console.print(f"• Press Ctrl+C to stop monitoring")
        console.print()
        
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
                # Smart FOMO: Use FOMO signals but filter by historical upside potential
                total_rows, df = (
                    Query()
                    .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                           'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
                    .set_markets(self.market)
                    .where(
                        col('close') > 50,  # Above ₹50
                        col('volume') > 500000,  # High volume
                        col('relative_volume_10d_calc') > 1.5,  # Elevated volume (FOMO signal)
                        col('change') > 1,  # Positive momentum
                        col('RSI').between(40, 85),  # Allow higher RSI for FOMO
                        col('market_cap_basic') > 1e9,  # Min 1000 crores
                        col('exchange') == 'NSE'  # NSE only
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
                    should_skip, time_diff = self._should_skip_alert(ticker, 'VOLUME_SPIKE')
                    if should_skip:
                        console.print(f"[dim]⏳ Skipping {ticker} VOLUME_SPIKE (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                        continue
                    
                    # Calculate confidence
                    confidence = self._calculate_alert_confidence('VOLUME_SPIKE', row['relative_volume_10d_calc'], row['change'])
                    
                    # Only send if confidence is high enough
                    if confidence >= 0.7:  # 70% minimum confidence
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
                    should_skip, time_diff = self._should_skip_alert(ticker, 'PRICE_MOVE')
                    if should_skip:
                        console.print(f"[dim]⏳ Skipping {ticker} PRICE_MOVE (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                        continue
                    
                    # Calculate confidence
                    confidence = self._calculate_alert_confidence('PRICE_MOVE', row['relative_volume_10d_calc'], row['change'])
                    
                    # Only send if confidence is high enough
                    if confidence >= 0.7:  # 70% minimum confidence
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
            
            # Smart FOMO alert - only in SMART_FOMO mode
            watch_mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
            if (watch_mode == 'SMART_FOMO' and
                row['relative_volume_10d_calc'] > volume_threshold and
                row['change'] > 1 and  # Positive momentum
                self._check_historical_upside(ticker, row['close'])):  # Historical validation
                
                # Check cooldown
                should_skip, time_diff = self._should_skip_alert(ticker, 'SMART_FOMO')
                if should_skip:
                    console.print(f"[dim]⏳ Skipping {ticker} SMART_FOMO (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                    continue
                
                # Calculate confidence (Smart FOMO gets bonus for historical validation)
                confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'])
                
                # Only send if confidence is high enough
                if confidence >= 0.7:  # 70% minimum confidence
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
        
        return alerts
    
    def _should_skip_alert(self, ticker, alert_type):
        """Check if we should skip this alert due to cooldown"""
        current_time = datetime.now()
        alert_key = f"{ticker}_{alert_type}"
        
        # Check if this exact alert was sent recently
        if alert_key in self.last_alert_time:
            time_diff = (current_time - self.last_alert_time[alert_key]).total_seconds()
            if time_diff < self.alert_cooldown:
                return True, time_diff
        
        return False, 0
    
    def _calculate_alert_confidence(self, alert_type, volume_ratio, change_pct):
        """Calculate confidence score for alert (fixing the 50% issue)"""
        confidence = 0.3  # Base confidence
        
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
        
        return min(confidence, 0.95)  # Cap at 95%
    
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
            elif alert['type'] == 'SMART_FOMO':
                message += f"📊 *Volume Ratio:* {alert['volume_ratio']:.1f}x (FOMO signal)\n"
                message += f"📈 *Change:* {alert['change']:+.2f}%\n"
                message += f"🧠 *Historical Check:* ✅ Upside potential validated\n"
                message += f"🎯 *Strategy:* Smart FOMO (avoid late entries)\n"
            
            # Add confidence score
            confidence = alert.get('confidence', 0.5)
            message += f"🎯 *Confidence:* {confidence:.0%}\n"
            
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
            
            # Optional: Send Telegram notification if enabled
            if hasattr(self, 'telegram_enabled') and self.telegram_enabled:
                self._send_telegram_alert(
                    f"🚀 GAP TRADE: {symbol}\n"
                    f"Entry: ₹{price:.2f}\n"
                    f"Target: +{target_pct}% (₹{trade_data['target_price']:.2f})\n"
                    f"Stop: -{stop_loss_pct}% (₹{trade_data['stop_loss_price']:.2f})\n"
                    f"Quality: {quality_score:.0f}/100\n"
                    f"Strategy: 15-min optimized (68.4% win rate)"
                )
            
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
            
            # Only trade if confidence is sufficient (70%+)
            if confidence < 0.7:
                console.print(f"   [yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping trade[/yellow]")
                return
            
            # Determine trade direction
            trade_side = None
            if alert['type'] == 'VOLUME_SPIKE':
                # Volume spike with positive change = BUY
                if alert.get('change', 0) > 0:
                    trade_side = 'BUY'
                elif alert.get('change', 0) < -2:  # Strong negative move
                    trade_side = 'SELL'
            
            elif alert['type'] == 'PRICE_MOVE':
                # Strong positive price move = BUY
                if alert.get('current_change', 0) > 2:
                    trade_side = 'BUY'
                # Strong negative price move = SELL
                elif alert.get('current_change', 0) < -2:
                    trade_side = 'SELL'
            
            elif alert['type'] == 'SMART_FOMO':
                # Smart FOMO - only BUY validated breakouts
                if alert.get('change', 0) > 1:  # Positive momentum
                    trade_side = 'BUY'
            
            elif alert['type'] == 'OPTIMIZED_GAP_15MIN':
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
                success = self._execute_screener_trade(symbol, trade_side, alert, price, quantity, confidence)
                
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
                    
                    console.print(f"   [green]✅ Paper trade executed: {trade_side} {quantity} {symbol} @ ₹{price:.2f}[/green]")
                else:
                    console.print(f"   [red]❌ Paper trade failed for {symbol}[/red]")
            else:
                console.print(f"   [dim]No clear trading signal for {symbol}[/dim]")
                
        except Exception as e:
            console.print(f"   [red]❌ Paper trading error: {e}[/red]")
    
    
    def _execute_screener_trade(self, symbol, side, alert, price, quantity, confidence):
        """Execute paper trade via bot"""
        try:
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
            
            # Log to journal
            amount = price * quantity
            self.log_trade("ENTRY", symbol, price, quantity, amount, alert['type'])
            
            # Create position
            self.positions[symbol] = {
                'side': side,
                'qty': quantity,
                'entry_price': round(price, 2),
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
        positions_table.add_column("P&L ₹", justify="right", style="bold")
        positions_table.add_column("TSL", justify="right", style="magenta")
        positions_table.add_column("Source", style="dim")
        
        # Fetch all live prices in parallel
        live_prices = self._fetch_live_prices_parallel(list(active_positions.keys()))
        
        for symbol, position in active_positions.items():
            # Use parallel fetched price or fallback to cached price
            live_price = live_prices.get(symbol)
            current_price = live_price if live_price else self.current_prices.get(symbol, position['entry_price'])
            
            # Calculate P&L
            pnl_pct = (current_price - position['entry_price']) / position['entry_price'] * 100
            if position['side'] == 'SELL':
                pnl_pct *= -1
            
            pnl_amount = pnl_pct * position['entry_price'] * position['qty'] / 100
            
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
            
            # Trailing stop display
            if position.get('trailing_stop_active', False):
                tsl_display = f"🎯{position.get('trailing_stop_pct', 0):+.1f}%"
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
            
            # Calculate current P&L
            entry_price = position['entry_price']
            pnl_pct = (live_price - entry_price) / entry_price * 100
            if position['side'] == 'SELL':
                pnl_pct *= -1
            
            # Risk Management Rules
            stop_loss_pct = -2.0  # 2% initial stop loss
            take_profit_pct = 1.0  # 1% take profit threshold for intraday
            trailing_stop_buffer = 0.5  # 0.5% trailing buffer for tighter control
            
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
                console.print(f"[bold green]🎯 TRAILING STOP ACTIVATED for {symbol} at {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}%)[/bold green]")
                
                # Send Telegram notification
                if self.telegram_enabled:
                    try:
                        self._send_telegram_alert(
                            f"🎯 TRAILING STOP ACTIVATED\n"
                            f"Symbol: {symbol}\n"
                            f"Current P&L: {pnl_pct:.2f}%\n"
                            f"Trailing Stop: {position['trailing_stop_pct']:.2f}%\n"
                            f"Buffer: {trailing_stop_buffer}%"
                        )
                    except Exception as e:
                        pass
            
            # 3. Update trailing stop as profit increases
            elif position['trailing_stop_active']:
                new_trailing_stop = pnl_pct - trailing_stop_buffer
                
                # Only move trailing stop up (lock in more profit)
                if new_trailing_stop > position['trailing_stop_pct']:
                    position['trailing_stop_pct'] = new_trailing_stop
                
                # Check if trailing stop is hit
                if pnl_pct <= position['trailing_stop_pct']:
                    should_exit = True
                    exit_reason = f"TRAILING STOP: {pnl_pct:.2f}% (TSL: {position['trailing_stop_pct']:.2f}%)"
            
            # Execute exit if needed
            if should_exit:
                self._execute_exit_trade(symbol, position, live_price, exit_reason)
                
        except Exception as e:
            console.print(f"[red]❌ Error monitoring {symbol}: {e}[/red]")
    
    def _execute_exit_trade(self, symbol, position, exit_price, reason):
        """Execute exit trade for risk management"""
        try:
            # Log the exit
            pnl_pct = (exit_price - position['entry_price']) / position['entry_price'] * 100
            if position['side'] == 'SELL':
                pnl_pct *= -1
            
            pnl_amount = pnl_pct * position['entry_price'] * position['qty'] / 100
            
            exit_log = (f"🔥 AUTO EXIT: {symbol} | "
                       f"{reason} | "
                       f"Entry: ₹{position['entry_price']:.0f} | "
                       f"Exit: ₹{exit_price:.0f} | "
                       f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})")
            
            console.print(f"[bold red]{exit_log}[/bold red]")
            
            # Log to journal
            amount = exit_price * position['qty']
            self.log_trade("EXIT", symbol, exit_price, position['qty'], amount, reason, pnl_pct, pnl_amount)
            
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
                try:
                    self._send_telegram_alert(
                        f"🔥 AUTO EXIT\n"
                        f"Symbol: {symbol}\n"
                        f"Reason: {reason}\n"
                        f"Entry: ₹{position['entry_price']:.0f}\n"
                        f"Exit: ₹{exit_price:.0f}\n"
                        f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f})"
                    )
                except Exception as e:
                    console.print(f"[yellow]⚠️ Failed to send Telegram exit alert: {e}[/yellow]")
            
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
    
    def run_example(self, example_name, **kwargs):
        """Run a specific example"""
        examples = {
            # Pre-Breakout (NEW - Anti-FOMO)
            'pre_breakout': self.pre_breakout_accumulation,
            'early_momentum': self.early_momentum_detection,
            'relative_strength': self.relative_strength_leaders,
            
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
                       choices=['PREBREAKOUT', 'FOMO', 'SMART_FOMO', 'ACCUMULATION', 'MOMENTUM', 'OPTIMIZED_GAP'],
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
        console.print("  python tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15")
        console.print("  python tv_screen_usage.py --watch --mode FOMO --volume-threshold 2.5")
        console.print("  python tv_screen_usage.py --watch --mode ACCUMULATION --enable-trading")
        console.print("  python tv_screen_usage.py --watch --mode OPTIMIZED_GAP --refresh 2 --enable-trading")
        console.print("  python tv_screen_usage.py --market us --example intraday_watch --refresh 10")

if __name__ == "__main__":
    main()
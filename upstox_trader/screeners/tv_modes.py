from typing import Optional, List, Dict, Tuple
from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col
import pandas as pd
import numpy as np
import time
import os
from datetime import datetime

console = Console()


# =============== Delegated Mode Functions ===============
# Each function mirrors the original TVScreenerUsage.method behavior.
# They accept `self` (TVScreenerUsage instance) to reuse existing utilities and state.


def pre_breakout_accumulation(self) -> None:
    """Find stocks in accumulation phase before breakout"""
    console.print(Panel.fit("📊 PRE-BREAKOUT: Accumulation Patterns", style="bold blue"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'price_52_week_high', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('volume') > 200000,
                col('relative_volume_10d_calc').between(0.8, 1.8),
                col('change').between(-2, 3),
                col('RSI').between(40, 65),
                col('close') > col('EMA20'),
                col('close') > 200,
                col('market_cap_basic') > 5e8,
                col('exchange') == 'NSE'
            )
            .order_by('RSI', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        if not df.empty:
            console.print("[dim]Adding trend analysis...[/dim]")
            trend_data = []
            for _, row in df.iterrows():
                ticker = row['name']
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


def early_momentum_detection(self) -> None:
    """Detect early momentum before FOMO kicks in"""
    console.print(Panel.fit("⚡ EARLY MOMENTUM: Pre-FOMO Signals", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,
                col('volume') > 100000,
                col('relative_volume_10d_calc').between(1.1, 2.5),
                col('change').between(0.5, 4),
                col('RSI') > col('RSI[1]'),
                col('RSI').between(35, 70),
                col('MACD.macd') > col('MACD.signal'),
                col('market_cap_basic') > 2e8,
                col('exchange') == 'NSE'
            )
            .order_by('change', ascending=False)
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


def relative_strength_leaders(self) -> None:
    """Find stocks showing relative strength vs market"""
    console.print(Panel.fit("💪 RELATIVE STRENGTH: Market Outperformers", style="bold cyan"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'Perf.W', 'Perf.M',
                'RSI', 'Beta', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('volume') > 150000,
                col('Perf.W') > 2,
                col('Perf.M') > 5,
                col('change') > -2,
                col('RSI').between(45, 75),
                col('Beta') > 0.8,
                col('market_cap_basic') > 3e8,
                col('exchange') == 'NSE'
            )
            .order_by('Perf.W', ascending=False)
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


def intraday_high_volume_breakouts(self) -> None:
    """Find stocks with high volume breakouts for intraday trading"""
    console.print(Panel.fit("🚀 INTRADAY: High Volume Breakouts", style="bold blue"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('volume') > 1000000,
                col('relative_volume_10d_calc') > 2,
                col('change') > 2,
                col('RSI').between(50, 80),
                col('market_cap_basic') > 5e8,
                col('exchange') == 'NSE'
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


def intraday_gap_up_stocks(self) -> None:
    """Find gap-up stocks for intraday momentum trading"""
    console.print(Panel.fit("📈 INTRADAY: Gap-Up Momentum", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'RSI', 'price_52_week_high', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('change') > 3,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 1.5,
                col('exchange') == 'NSE',
                col('RSI') < 80,
                col('price_52_week_high') > col('close')
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


def gap_fill_trading_strategy(self) -> None:
    """
    GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)
    Delegates to existing analyzer and tv_display as in original method.
    """
    console.print(Panel.fit("🎯 GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)", style="bold magenta"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'RSI', 'market_cap_basic', 'Volatility.D', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 30,
                col('volume') > 300000,
                col('relative_volume_10d_calc') > 1.2,
                col('market_cap_basic') > 1e8,
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No volume movers found in current market scan[/yellow]")
            return

        df = df[abs(df['change']) >= 0.8].copy()
        if df.empty:
            console.print("[yellow]No significant gaps found in current volume movers[/yellow]")
            return

        console.print("[dim]Analyzing historical gap-fill patterns...[/dim]")
        gap_analysis_results = []

        for _, row in df.iterrows():
            symbol = row['name']
            current_change = row['change']
            gap_direction = 'UP' if current_change > 0 else 'DOWN'

            gap_analysis = self._analyze_gap_fill_probability(
                symbol=symbol,
                current_gap_size=abs(current_change),
                gap_direction=gap_direction,
                lookback_days=90
            )

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

        gap_df = pd.DataFrame(gap_analysis_results).sort_values('gap_fill_probability', ascending=False)

        # Use tv_display if present (imported in tv_screen_usage and accessible via self)
        if getattr(self, 'tv_display', None):
            self.tv_display.display_gap_fill_results(gap_df)
        else:
            # Fallback: import locally to avoid tight coupling
            try:
                from . import tv_display
            except Exception:
                import upstox_trader.screeners.tv_display as tv_display  # type: ignore
            tv_display.display_gap_fill_results(gap_df)
    except Exception as e:
        console.print(f"[red]Error in gap-fill strategy: {e}[/red]")


def research_earnings_calendar(self) -> None:
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
                col('close') > 100,
                col('earnings_per_share_diluted_yoy_growth_ttm') > 10,
                col('total_revenue_yoy_growth_ttm') > 5,
                col('price_earnings_ttm') < 30,
                col('market_cap_basic') > 2e9
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


def research_sector_performance(self) -> None:
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
                col('close') > 50,
                col('market_cap_basic') > 5e8,
                col('volume') > 100000,
                col('sector') != '',
                col('exchange') == 'NSE'
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
            
            # Display sector performance table (moved to tv_display)
            try:
                from . import tv_display
                tv_display.display_sector_table(sector_stats, "Sector Performance Analysis")
            except Exception:
                try:
                    import upstox_trader.screeners.tv_display as tv_display
                    tv_display.display_sector_table(sector_stats, "Sector Performance Analysis")
                except Exception:
                    console.print("[red]tv_display module unavailable[/red]")
            
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


def research_sector_stocks(self, sector_name=None, limit=20) -> None:
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
                col('close') > 25,
                col('market_cap_basic') > 1e8,
                col('volume') > 50000,
                col('sector') != '',
                col('exchange') == 'NSE'
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


def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, price_threshold=3.0, mode='PREBREAKOUT') -> None:
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
    console.print(f"• Paper trading: {'🟢 ENABLED (₹20,000 per trade)' if getattr(self, 'paper_trading_enabled', False) else '🔴 DISABLED'}")
    if getattr(self, 'paper_trading_enabled', False):
        console.print(f"• Live risk management: 🟢 ENABLED (0.5% SL | 1% TP | 1.0% TSL | 2sec checks)")
    console.print(f"• Trade journal: 📝 {getattr(self, 'journal_file', 'Not configured')}")
    console.print(f"• Trend analysis: 🎯 ENABLED (15-day lookback | SELL in bearish trends)")
    console.print(f"• Logging: 🔇 Minimal (reduced console spam)")
    console.print(f"• Press Ctrl+C to stop monitoring")
    console.print()
    
    # Special handling for GAP_FILL_SR mode - redirect to live gap-fill monitor
    if mode == 'GAP_FILL_SR':
        console.print(f"[yellow]🔄 Redirecting to live gap-fill monitor...[/yellow]")
        time.sleep(1)
        if hasattr(self, 'live_gap_fill_monitor_with_sr'):
            return self.live_gap_fill_monitor_with_sr()
        else:
            console.print("[red]Error: live_gap_fill_monitor_with_sr method not available[/red]")
            return
    
    # Wait until 9:20 AM before starting active monitoring
    if hasattr(self, 'wait_until_market_open'):
        self.wait_until_market_open()
    
    # Store previous data for comparison
    previous_data = pd.DataFrame()
    alert_count = 0
    
    # Start background monitoring for live risk management
    self._start_time = datetime.now()
    if hasattr(self, 'start_background_monitoring'):
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
            if hasattr(self, '_is_market_closed') and self._is_market_closed():
                if hasattr(self, '_exit_all_positions'):
                    self._exit_all_positions("MARKET_CLOSED")
                console.print("[bold red]📴 Market closed - All positions exited. Script will continue monitoring.[/bold red]")
                time.sleep(refresh_interval)
                continue
            
            # Get current market data
            current_data = self._get_watch_data() if hasattr(self, '_get_watch_data') else pd.DataFrame()
            
            if not current_data.empty:
                # Detect alerts
                alerts = []
                if hasattr(self, '_detect_alerts'):
                    alerts = self._detect_alerts(current_data, previous_data, volume_threshold, price_threshold)
                
                if alerts:
                    alert_count += len(alerts)
                    console.print(f"[bold red]🚨 ALERTS ({len(alerts)} new, {alert_count} total)[/bold red]")
                    if hasattr(self, '_display_alerts'):
                        self._display_alerts(alerts)
                    console.print()
                
                # Display current top movers
                if hasattr(self, '_display_watch_data'):
                    self._display_watch_data(current_data, alerts)
                else:
                    self.display_table(current_data.head(15), f"Watch Mode - {mode}")
                
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
        if hasattr(self, 'stop_background_monitoring'):
            self.stop_background_monitoring()



def optimized_gap_strategy_15min(self) -> Optional[pd.DataFrame]:
    """Delegate of the original optimized gap strategy"""
    console.print(Panel.fit("🚀 OPTIMIZED GAP STRATEGY (15-MIN PROVEN)", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'RSI', 'market_cap_basic', 'Volatility.D', 'price_52_week_high', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('change') > 1,
                col('change') < 15,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 2.0,
                col('RSI') < 85,
                col('RSI') > 25,
                col('exchange') == 'NSE',
                col('market_cap_basic') > 2e8,
                col('Volatility.D') < 0.08,
                col('price_52_week_high') > col('close')
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(20)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No gap opportunities meeting quality criteria found[/yellow]")
            return None

        df['quality_score'] = self._calculate_quality_score(df)
        df = df.sort_values('quality_score', ascending=False)

        self.display_table(df, "🚀 Optimized 15-Min Gap Strategy Stocks")

        console.print("\n[bold yellow]📊 PROVEN STRATEGY PARAMETERS:[/bold yellow]")
        console.print("• [green]Timeframe:[/green] 15-minute intervals (68.4% win rate)")
        console.print("• [green]Entry:[/green] 9:30 AM after trend confirmation")
        console.print("• [green]Target:[/green] 2.5% (proven achievable)")
        console.print("• [green]Stop Loss:[/green] 0.5% (tight risk control)")
        console.print("• [green]Expected P&L:[/green] ₹156 per trade average")

        if getattr(self, 'paper_trading_enabled', False):
            console.print("\n[bold blue]📊 PAPER TRADING READY:[/bold blue]")
            top_stocks = df[df['quality_score'] >= 80].head(5)
            if not top_stocks.empty:
                console.print(f"\n[bold blue]🤖 AUTO-TRADING {len(top_stocks)} HIGH-QUALITY GAPS:[/bold blue]")
                for _, row in top_stocks.iterrows():
                    alert = {
                        'type': 'OPTIMIZED_GAP_15MIN',
                        'ticker': row.get('ticker', row['name']),
                        'symbol': row.get('ticker', row['name']),
                        'price': row['close'],
                        'change': row['change'],
                        'volume_ratio': row['relative_volume_10d_calc'],
                        'quality_score': row['quality_score'],
                        'confidence': min(0.95, row['quality_score'] / 100),
                        'target_pct': 2.5,
                        'stop_loss_pct': 1.0,
                        'timeframe': '15min',
                        'strategy': 'gap_15min_optimized',
                        'reason': f"Gap {row['change']:+.1f}% with {row['relative_volume_10d_calc']:.1f}x volume (Score: {row['quality_score']:.0f}/100)"
                    }
                    self._process_gap_paper_trading_alert(alert)
                    console.print(f"   🤖 {row['name'][:15]:15} | Gap: {row['change']:+.1f}% | Score: {row['quality_score']:3.0f} | Target: +2.5% | Stop: -1.0%")

        console.print("\n[bold yellow]🔔 ALERT SETUP:[/bold yellow]")
        console.print("• 9:15 AM: Check screener for gap stocks")
        console.print("• 9:30 AM: Analyze top quality scores on 15-min charts")
        console.print("• Entry: Wait for trend confirmation before entering")
        console.print("• Exit: Stick to 2.5% target / 0.5% stop discipline")

        return df
    except Exception as e:
        console.print(f"[red]Error in optimized gap strategy: {e}[/red]")
        return None


def intraday_oversold_bounce(self) -> None:
    """Find oversold stocks for bounce trading"""
    console.print(Panel.fit("🔄 INTRADAY: Oversold Bounce", style="bold cyan"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'RSI', 'MACD.macd',
                    'MACD.signal', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 75,
                col('change') < -2,
                col('RSI') < 35,
                col('volume') > 750000,
                col('market_cap_basic') > 1e9,
                col('MACD.macd') > col('MACD.signal')
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


def intraday_news_momentum(self) -> None:
    """Find stocks with unusual activity (potential news-driven)"""
    console.print(Panel.fit("📰 INTRADAY: News-Driven Momentum", style="bold magenta"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'Volatility.D', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 25,
                col('relative_volume_10d_calc') > 3,
                col('Volatility.D') > 0.05,
                col('volume') > 2000000,
                col('market_cap_basic') > 2e8
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


def intraday_early_breakout_setup(self) -> None:
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
                col('close') > 50,
                col('change').between(-1, 2),
                col('relative_volume_10d_calc') > 1.3,
                col('RSI').between(45, 65),
                col('MACD.macd') > col('MACD.signal'),
                col('Volatility.D') < 0.04,
                col('volume') > 500000,
                col('market_cap_basic') > 5e8
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


def intraday_volume_accumulation(self) -> None:
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
                col('close') > 75,
                col('change').between(-1.5, 1.5),
                col('relative_volume_10d_calc') > 2.0,
                col('RSI').between(40, 60),
                col('volume') > 1000000,
                col('market_cap_basic') > 1e9,
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


def intraday_compression_coiling(self) -> None:
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
                col('close') > 100,
                col('Volatility.D') < 0.025,
                col('change').between(-0.8, 0.8),
                col('RSI').between(35, 65),
                col('relative_volume_10d_calc') > 0.8,
                col('volume') > 300000,
                col('market_cap_basic') > 5e8,
                col('BB.upper') > col('BB.lower')
            )
            .order_by('Volatility.D', ascending=True)
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


def swing_bullish_reversal(self) -> None:
    """Find stocks showing bullish reversal patterns for swing trading"""
    console.print(Panel.fit("🔄 SWING: Bullish Reversal Patterns", style="bold blue"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'RSI', 'MACD.macd',
                    'MACD.signal', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('RSI').between(30, 50),
                col('MACD.macd') > col('MACD.signal'),
                col('close') > col('EMA20'),
                col('volume') > 300000,
                col('market_cap_basic') > 5e8
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


def swing_breakout_consolidation(self) -> None:
    """Find stocks breaking out of consolidation for swing trading"""
    console.print(Panel.fit("📊 SWING: Breakout from Consolidation", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'price_52_week_high', 'price_52_week_low', 'RSI', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 200,
                col('change') > 1,
                col('relative_volume_10d_calc') > 1.3,
                col('RSI').between(45, 70),
                col('price_52_week_low') < col('close'),
                col('price_52_week_high') > col('close'),
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


def swing_sector_rotation(self) -> None:
    """Find stocks in strong sectors for swing trading"""
    console.print(Panel.fit("🔄 SWING: Sector Rotation Play", style="bold cyan"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'price_earnings_ttm',
                    'return_on_equity', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 150,
                col('price_earnings_ttm') < 25,
                col('return_on_equity') > 15,
                col('close') > col('EMA20'),
                col('EMA20') > col('EMA50'),
                col('volume') > 150000,
                col('market_cap_basic') > 1e9
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


def invest_quality_growth(self) -> None:
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
                col('close') > 100,
                col('price_earnings_ttm').between(10, 30),
                col('return_on_equity') > 18,
                col('total_revenue_yoy_growth_ttm') > 10,
                col('earnings_per_share_diluted_yoy_growth_ttm') > 15,
                col('debt_to_equity') < 1,
                col('market_cap_basic') > 5e9
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


def invest_dividend_aristocrats(self) -> None:
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
                col('close') > 200,
                col('dividends_yield_current') > 2,
                col('price_earnings_ttm') < 20,
                col('return_on_equity') > 12,
                col('debt_to_equity') < 0.8,
                col('current_ratio') > 1.2,
                col('market_cap_basic') > 10e9
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


def invest_undervalued_gems(self) -> None:
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
                col('close') > 50,
                col('price_earnings_ttm') < 15,
                col('price_book_ratio') < 2,
                col('return_on_equity') > 10,
                col('price_sales_ratio') < 3,
                col('market_cap_basic') > 1e9
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


def research_sector_leaders(self) -> None:
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
                col('market_cap_basic') > 20e9,
                col('return_on_equity') > 15,
                col('price_earnings_ttm') > 0,
                col('total_revenue_yoy_growth_ttm') > 5
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


def research_market_sentiment(self) -> None:
    """Analyze current market sentiment and momentum"""
    console.print(Panel.fit("📊 RESEARCH: Market Sentiment Analysis", style="bold red"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'change', 'volume', 'relative_volume_10d_calc',
                    'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('market_cap_basic') > 5e9,
                col('volume') > 1000000,
                col('relative_volume_10d_calc') > 0.5
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(50)
            .get_scanner_data(cookies=self.cookies)
        )

        if not df.empty:
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
                       'Perf.W', 'Perf.3M', 'EMA20', 'EMA50', 'MACD.macd', 'MACD.signal', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('volume') > 500000,  # High volume
                    col('relative_volume_10d_calc') > 2.0,  # Higher volume threshold (FOMO signal)
                    (col('change').between(1, 8) | col('change').between(-8, -1)),  # Both positive and negative momentum (for shorting)
                    col('RSI').between(40, 75),  # Avoid extreme overbought (was 85)
                    col('market_cap_basic') > 1e9,  # Min 1000 crores
                    col('exchange') == 'NSE',  # NSE only
                    # Note: 52W high check moved to post-processing for mathematical operations
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
                    if hasattr(self, '_check_historical_upside') and self._check_historical_upside(row.get('ticker', ''), row.get('close', 0)):
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
        
        elif mode == 'HEAVY_BREAKOUT':
            # Heavy Breakout mode - stocks ready for channel analysis
            total_rows, df = (
                Query()
                .select('name', 'close', 'open', 'high', 'low', 'volume', 'change',
                       'relative_volume_10d_calc', 'RSI', 'Volatility.D', 'ATR', 
                       'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,
                    col('volume') > 300000,  # Decent liquidity for breakout trades
                    col('relative_volume_10d_calc') > 0.8,
                    col('market_cap_basic') > 5e8,  # Min 500 crores for stability
                    col('Volatility.D') > 0.015,  # Some volatility for breakout potential
                    col('ATR') > 2,  # Sufficient range for trading
                    col('RSI').between(35, 75),  # Avoid extremes
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(30)  # More stocks for comprehensive analysis
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
            if hasattr(self, '_calculate_quality_score'):
                df['quality_score'] = self._calculate_quality_score(df)
        
        # Add heavy breakout analysis with parallel fetching for HEAVY_BREAKOUT mode
        if mode == 'HEAVY_BREAKOUT' and not df.empty:
            df = self._add_heavy_breakout_analysis(df)
        
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


class SmartMoneyBreakoutChannels:
    """
    Smart Money Breakout Channels Indicator for TradingView integration
    
    Identifies consolidation zones and breakout signals with volume analysis
    """
    
    def __init__(self, 
                 overlap: bool = False,
                 strong_closes: bool = True,
                 normalization_length: int = 100,
                 box_detection_length: int = 14,
                 show_volume: bool = True,
                 volume_mode: str = "Comparison",
                 volume_scale: float = 0.5):
        
        self.overlap = overlap
        self.strong_closes = strong_closes
        self.normalization_length = normalization_length
        self.box_detection_length = box_detection_length
        self.show_volume = show_volume
        self.volume_mode = volume_mode
        self.volume_scale = volume_scale
        
        self.channels = []
        self.breakout_signals = []
    
    def normalize_price(self, df: pd.DataFrame) -> pd.Series:
        """Normalize price between 0 and 1 based on recent range"""
        low_min = df['Low'].rolling(window=self.normalization_length).min()
        high_max = df['High'].rolling(window=self.normalization_length).max()
        normalized = (df['Close'] - low_min) / (high_max - low_min)
        return normalized.fillna(0)
    
    def calculate_volatility_signals(self, df: pd.DataFrame) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """Calculate volatility-based signals for channel detection"""
        normalized_price = self.normalize_price(df)
        vol = normalized_price.rolling(window=14).std()
        
        length = self.box_detection_length
        upper_signal = vol.rolling(window=length + 1).apply(
            lambda x: (np.argmax(x) + length) / length if len(x) == length + 1 else np.nan,
            raw=True
        )
        
        lower_signal = vol.rolling(window=length + 1).apply(
            lambda x: (np.argmin(x) + length) / length if len(x) == length + 1 else np.nan,
            raw=True
        )
        
        return upper_signal, lower_signal, vol
    
    def calculate_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average True Range"""
        if len(df) < 2:
            return 0.1
        
        high = df['High']
        low = df['Low']
        close_prev = df['Close'].shift(1)
        
        tr1 = high - low
        tr2 = abs(high - close_prev)
        tr3 = abs(low - close_prev)
        
        true_range = np.maximum(tr1, np.maximum(tr2, tr3))
        atr = true_range.rolling(window=min(period, len(df))).mean().iloc[-1]
        
        return atr if not np.isnan(atr) else 0.1
    
    def detect_channels(self, df: pd.DataFrame) -> List[Dict]:
        """Detect consolidation channels"""
        upper_signal, lower_signal, vol = self.calculate_volatility_signals(df)
        channels = []
        
        upper_cross = (upper_signal > lower_signal) & (upper_signal.shift(1) <= lower_signal.shift(1))
        lower_cross = (lower_signal > upper_signal) & (lower_signal.shift(1) <= upper_signal.shift(1))
        
        i = 0
        while i < len(df) - 1:
            if lower_cross.iloc[i]:
                duration_bars = 1
                for j in range(i-1, max(0, i-200), -1):
                    if upper_cross.iloc[j]:
                        duration_bars = i - j
                        break
                
                if duration_bars > 10:
                    start_idx = i - duration_bars
                    end_idx = i
                    
                    channel_data = df.iloc[start_idx:end_idx+1]
                    h_level = channel_data['High'].max()
                    l_level = channel_data['Low'].min()
                    
                    atr = self.calculate_atr(df.iloc[max(0, start_idx-self.box_detection_length):end_idx+1])
                    vol_buffer = atr / 2
                    
                    channel = {
                        'start_idx': start_idx,
                        'end_idx': end_idx,
                        'high': h_level,
                        'low': l_level,
                        'atr': atr,
                        'vol_buffer': vol_buffer,
                        'active': True,
                        'center': (h_level + l_level) / 2,
                        'range_percent': ((h_level - l_level) / l_level) * 100
                    }
                    
                    if self.overlap or self.can_create_channel(channel, channels):
                        channels.append(channel)
            i += 1
        
        return channels
    
    def can_create_channel(self, new_channel: Dict, existing_channels: List[Dict]) -> bool:
        """Check if new channel can be created without overlap"""
        for channel in existing_channels:
            if not channel['active']:
                continue
            
            if (new_channel['high'] > channel['low'] and 
                new_channel['low'] < channel['high']):
                return False
        return True
    
    def check_breakouts(self, df: pd.DataFrame, channels: List[Dict]) -> List[Dict]:
        """Check for breakouts from active channels"""
        breakouts = []
        
        for i, channel in enumerate(channels):
            if not channel['active']:
                continue
            
            # Check for breakouts in the last 10 bars (not just current)
            for idx in range(max(channel['end_idx'], len(df) - 10), len(df)):
                if idx >= len(df):
                    continue
                    
                current_row = df.iloc[idx]
                
                if self.strong_closes:
                    price_check = (current_row['Open'] + current_row['Close']) / 2
                else:
                    price_check = current_row['Close']
                
                # Check for bullish breakout
                if price_check > channel['high'] and current_row['Close'] > channel['high']:
                    breakout = {
                        'type': 'bullish',
                        'support_level': channel['low'],
                        'resistance_level': channel['high'],
                        'breakout_price': current_row['Close'],
                        'breakout_bar_idx': idx,
                        'channel_idx': i,
                        'strength': (current_row['Close'] - channel['high']) / channel['high'] * 100,
                        'volume': current_row['Volume'],
                        'channel_duration': channel['end_idx'] - channel['start_idx'],
                        'consolidation_range': channel['range_percent']
                    }
                    breakouts.append(breakout)
                    channel['active'] = False
                    break
                
                # Check for bearish breakout
                elif price_check < channel['low'] and current_row['Close'] < channel['low']:
                    breakout = {
                        'type': 'bearish', 
                        'support_level': channel['low'],
                        'resistance_level': channel['high'],
                        'breakout_price': current_row['Close'],
                        'breakout_bar_idx': idx,
                        'channel_idx': i,
                        'strength': (channel['low'] - current_row['Close']) / channel['low'] * 100,
                        'volume': current_row['Volume'],
                        'channel_duration': channel['end_idx'] - channel['start_idx'],
                        'consolidation_range': channel['range_percent']
                    }
                    breakouts.append(breakout)
                    channel['active'] = False
                    break
        
        return breakouts
    
    def analyze_stock(self, df: pd.DataFrame) -> Dict:
        """Analyze a single stock for breakout patterns"""
        if len(df) < self.normalization_length:
            return {'channels': [], 'breakouts': [], 'active_channels': []}
        
        channels = self.detect_channels(df)
        breakouts = self.check_breakouts(df, channels)
        
        return {
            'channels': channels,
            'breakouts': breakouts,
            'active_channels': [ch for ch in channels if ch['active']],
            'total_channels': len(channels),
            'recent_breakouts': len(breakouts)
        }


def heavy_breakout(self) -> None:
    """Heavy Breakout Mode - Smart Money Consolidation Channel Breakouts"""
    console.print(Panel.fit("💥 HEAVY BREAKOUT: Smart Money Channel Analysis", style="bold red"))
    
    try:
        # Get stocks with good volume and price action
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'open', 'high', 'low', 'volume', 'change',
                'relative_volume_10d_calc', 'RSI', 'Volatility.D', 'ATR',
                'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 0.8,
                col('market_cap_basic') > 1e9,
                col('Volatility.D') > 0.015,  # Some volatility for breakout potential
                col('ATR') > 2,  # Sufficient range for trading
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(50)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No stocks found matching heavy breakout criteria[/yellow]")
            return

        console.print(f"[dim]Analyzing {len(df)} stocks for smart money consolidation patterns...[/dim]")
        
        # Analyze each stock for breakout patterns
        breakout_analyzer = SmartMoneyBreakoutChannels(
            overlap=False,
            strong_closes=True,
            normalization_length=100,  # ~25 hours of 15min candles for normalization
            box_detection_length=8     # ~2 hours of 15min candles for detection
        )
        
        heavy_breakout_stocks = []
        
        for _, row in df.iterrows():
            symbol = row['name']
            
            try:
                # Get intraday historical data for pattern analysis
                from datetime import datetime, timedelta
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')  # 7 days for intraday
                
                # Fetch 15-minute candles for better intraday patterns
                historical_data = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,  # 15-minute candles
                    to_date=to_date,
                    from_date=from_date
                )
                
                if historical_data is not None and len(historical_data) >= 20:
                    # Prepare data for analyzer
                    hist_df = historical_data.copy()
                    
                    # Handle different column structures from Upstox API
                    if len(hist_df.columns) == 6:
                        # Columns: [timestamp, open, high, low, close, volume]
                        hist_df.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                        hist_df = hist_df[['Open', 'High', 'Low', 'Close', 'Volume']]
                    elif len(hist_df.columns) == 5:
                        # Columns: [open, high, low, close, volume]
                        hist_df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                    else:
                        console.print(f"[dim red]Unexpected column structure for {symbol}: {list(hist_df.columns)}[/dim red]")
                        continue
                    
                    # Ensure numeric data types for analysis
                    numeric_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                    for column_name in numeric_columns:
                        hist_df[column_name] = pd.to_numeric(hist_df[column_name], errors='coerce')
                    
                    # Remove any rows with NaN values after conversion
                    hist_df = hist_df.dropna()
                    
                    if len(hist_df) < 20:
                        console.print(f"[dim red]Insufficient clean data for {symbol} after conversion[/dim red]")
                        continue
                    
                    # Debug: Check data types before analysis
                    try:
                        # Analyze for breakout patterns
                        analysis = breakout_analyzer.analyze_stock(hist_df)
                    except Exception as analyze_error:
                        console.print(f"[dim red]Analysis error for {symbol}: {analyze_error}[/dim red]")
                        console.print(f"[dim red]Data types: {hist_df.dtypes.to_dict()}[/dim red]")
                        console.print(f"[dim red]Sample data: {hist_df.head(2).to_dict()}[/dim red]")
                        continue
                    
                    # Score the breakout potential
                    breakout_score = 0
                    
                    # Active consolidation channels (high score)
                    active_channels = len(analysis['active_channels'])
                    if active_channels > 0:
                        breakout_score += active_channels * 30
                        
                        # Check channel quality for intraday patterns
                        for channel in analysis['active_channels']:
                            # Reward tight intraday ranges (0.5-3% range)
                            if 0.5 <= channel['range_percent'] <= 3:
                                breakout_score += 25
                            elif 3 < channel['range_percent'] <= 5:
                                breakout_score += 15  # Wider but still tradeable
                            # Duration bonus for longer consolidation (in 15min bars)
                            duration = channel['end_idx'] - channel['start_idx']
                            if duration > 8:  # >2 hours of consolidation
                                breakout_score += 15
                            elif duration > 4:  # >1 hour of consolidation
                                breakout_score += 10
                    
                    # Recent breakouts (moderate score)
                    recent_breakouts = len(analysis['breakouts'])
                    if recent_breakouts > 0:
                        breakout_score += recent_breakouts * 20
                        
                        # Bonus for strong breakouts
                        for breakout in analysis['breakouts']:
                            if breakout.get('strength', 0) > 2:
                                breakout_score += 15
                    
                    # Volume and volatility factors
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    if vol_ratio > 1.5:
                        breakout_score += 20
                    elif vol_ratio > 1.2:
                        breakout_score += 10
                    
                    # Volatility sweet spot
                    volatility = row.get('Volatility.D', 0)
                    if 0.02 <= volatility <= 0.05:
                        breakout_score += 15
                    
                    # RSI positioning
                    rsi = row.get('RSI', 50)
                    if 45 <= rsi <= 65:  # Neutral zone good for breakouts
                        breakout_score += 10
                    
                    # Only include stocks with significant breakout potential
                    if breakout_score >= 40:
                        stock_data = {
                            'symbol': symbol,
                            'price': row['close'],
                            'change': row.get('change', 0),
                            'volume': row['volume'],
                            'rel_volume': vol_ratio,
                            'rsi': rsi,
                            'volatility': volatility,
                            'breakout_score': breakout_score,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts,
                            'analysis': analysis
                        }
                        heavy_breakout_stocks.append(stock_data)
                        
            except Exception as e:
                console.print(f"[dim red]Error analyzing {symbol}: {e}[/dim red]")
                continue
        
        # Sort by breakout score
        heavy_breakout_stocks.sort(key=lambda x: x['breakout_score'], reverse=True)
        
        if heavy_breakout_stocks:
            # Create display dataframe
            display_data = []
            for stock in heavy_breakout_stocks[:15]:  # Top 15
                display_data.append({
                    'Symbol': stock['symbol'],
                    'Price': f"₹{stock['price']:.2f}",
                    'Change%': f"{stock['change']:.2f}%",
                    'Vol Ratio': f"{stock['rel_volume']:.2f}x",
                    'RSI': float(stock['rsi']) if stock['rsi'] is not None else 50.0,  # Keep as float for formatter
                    'Volatility': f"{stock['volatility']:.3f}",
                    'Score': f"{stock['breakout_score']:.0f}",
                    'Channels': stock['active_channels'],
                    'Breakouts': stock['recent_breakouts']
                })
            
            display_df = pd.DataFrame(display_data)
            self.display_table(display_df, "Heavy Breakout Candidates - Smart Money Analysis")
            
            # Show top 3 detailed analysis
            console.print(f"\n[bold cyan]🎯 TOP 3 DETAILED ANALYSIS WITH LEVELS:[/bold cyan]")
            for i, stock in enumerate(heavy_breakout_stocks[:3]):
                console.print(f"\n[bold yellow]{i+1}. {stock['symbol']} (Score: {stock['breakout_score']:.0f}) - Current: ₹{stock['price']:.2f}[/bold yellow]")
                
                analysis = stock['analysis']
                console.print(f"   📊 Active Consolidation Channels: {len(analysis['active_channels'])}")
                console.print(f"   🚀 Recent Breakout Events: {len(analysis['breakouts'])}")
                console.print(f"   📈 Volume: {stock['rel_volume']:.2f}x average")
                console.print(f"   📉 Current RSI: {stock['rsi']:.1f}")
                
                # Show active channel details with S/R levels
                for j, channel in enumerate(analysis['active_channels'][:2]):
                    range_pct = channel['range_percent']
                    duration = channel['end_idx'] - channel['start_idx']
                    hours = duration * 0.25  # 15min bars to hours
                    console.print(f"   🏗️  Active Channel {j+1}:")
                    console.print(f"      • Support: ₹{channel['low']:.2f}")
                    console.print(f"      • Resistance: ₹{channel['high']:.2f}")
                    console.print(f"      • Range: {range_pct:.2f}% ({hours:.1f} hours)")
                
                # Show recent breakouts with detailed levels and timing
                for j, breakout in enumerate(analysis['breakouts'][-2:]):
                    strength = breakout.get('strength', 0)
                    breakout_type = breakout['type'].upper()
                    
                    # Calculate breakout timing (approximate)
                    bars_ago = len(analysis['breakouts']) - breakout['breakout_bar_idx'] if 'breakout_bar_idx' in breakout else 0
                    time_ago = bars_ago * 15  # 15 min bars
                    
                    console.print(f"   🚨 Recent {breakout_type} Breakout:")
                    console.print(f"      • Support Level: ₹{breakout.get('support_level', 'N/A')}")
                    console.print(f"      • Resistance Level: ₹{breakout.get('resistance_level', 'N/A')}")
                    console.print(f"      • Breakout Price: ₹{breakout.get('breakout_price', 'N/A')}")
                    console.print(f"      • Strength: {strength:.2f}%")
                    console.print(f"      • Consolidation Range: {breakout.get('consolidation_range', 'N/A'):.2f}%")
                    if time_ago < 480:  # Less than 8 hours
                        console.print(f"      • Timing: ~{time_ago:.0f} minutes ago")
                    else:
                        console.print(f"      • Timing: Recent (within session)")
                
                # Add historical data validation call
                console.print(f"   🔍 [dim]Fetching live data for validation...[/dim]")
                
                # Validate with fresh Upstox data
                try:
                    # Get latest 5-minute data for validation
                    validation_data = self.upstox_api.fetch_historical_data_v3(
                        symbol=stock['symbol'],
                        unit='minutes',
                        interval=5,  # 5-minute for more recent validation
                        to_date=datetime.now().strftime('%Y-%m-%d'),
                        from_date=(datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
                    )
                    
                    if validation_data is not None and len(validation_data) > 0:
                        # Get latest price data
                        latest_data = validation_data.tail(3)  # Last 3 bars (15 mins)
                        
                        if len(latest_data.columns) == 6:
                            latest_data.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                            latest_data = latest_data[['Open', 'High', 'Low', 'Close', 'Volume']]
                        elif len(latest_data.columns) == 5:
                            latest_data.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                        
                        # Convert to numeric
                        for col_name in ['Open', 'High', 'Low', 'Close', 'Volume']:
                            latest_data[col_name] = pd.to_numeric(latest_data[col_name], errors='coerce')
                        
                        current_price = latest_data['Close'].iloc[-1]
                        recent_high = latest_data['High'].max()
                        recent_low = latest_data['Low'].min()
                        avg_volume = latest_data['Volume'].mean()
                        
                        console.print(f"   ✅ VALIDATION (Last 15 mins):")
                        console.print(f"      • Current Price: ₹{current_price:.2f}")
                        console.print(f"      • Recent High: ₹{recent_high:.2f}")
                        console.print(f"      • Recent Low: ₹{recent_low:.2f}")
                        console.print(f"      • Avg Volume: {avg_volume:,.0f}")
                        
                        # Validate breakout levels
                        if len(analysis['breakouts']) > 0:
                            last_breakout = analysis['breakouts'][-1]
                            resistance = last_breakout.get('resistance_level', 0)
                            support = last_breakout.get('support_level', 0)
                            
                            if last_breakout['type'] == 'bullish' and current_price > resistance:
                                console.print(f"      • ✅ BULLISH BREAKOUT CONFIRMED: Current (₹{current_price:.2f}) > Resistance (₹{resistance:.2f})")
                            elif last_breakout['type'] == 'bearish' and current_price < support:
                                console.print(f"      • ✅ BEARISH BREAKOUT CONFIRMED: Current (₹{current_price:.2f}) < Support (₹{support:.2f})")
                            else:
                                console.print(f"      • ⚠️  BREAKOUT STATUS: Price testing levels (S: ₹{support:.2f}, R: ₹{resistance:.2f})")
                    
                except Exception as validation_error:
                    console.print(f"      • ❌ Validation failed: {validation_error}")
                
                console.print("")  # Add spacing
        
        else:
            console.print("[yellow]No stocks currently showing heavy breakout patterns[/yellow]")

        console.print("\n[bold yellow]💡 Heavy Breakout Strategy (Intraday 15min):[/bold yellow]")
        console.print("• Pattern: Smart money consolidation channels with breakout potential")
        console.print("• Entry: On volume breakout above/below consolidation range")
        console.print("• Logic: Institutional accumulation followed by directional move")
        console.print("• Stop Loss: Opposite side of consolidation channel")
        console.print("• Target: Measured move = Channel height projected")
        console.print("• Time Frame: Intraday 15min - hold for 1-4 hours typically")
        console.print("• Best Setup: 0.5-3% consolidation range with 1-2+ hour duration")
        console.print("• Data: 15-minute candles from last 7 days for pattern analysis")
        
    except Exception as e:
        console.print(f"[red]Error in heavy breakout analysis: {e}[/red]")
        import traceback
        console.print(f"[dim red]Full traceback: {traceback.format_exc()}[/dim red]")


def _add_heavy_breakout_analysis(self, df: pd.DataFrame) -> pd.DataFrame:
    """Add real-time heavy breakout analysis with parallel intraday data fetching"""
    import concurrent.futures
    from threading import Lock
    
    console.print(f"[dim cyan]🚀 Fetching 15min data for {len(df)} stocks in parallel...[/dim cyan]")
    
    # Initialize breakout analyzer
    breakout_analyzer = SmartMoneyBreakoutChannels(
        overlap=False,
        strong_closes=True,
        normalization_length=100,
        box_detection_length=8
    )
    
    # Results storage with thread safety
    breakout_results = {}
    results_lock = Lock()
    
    def analyze_single_stock(row):
        """Analyze a single stock for breakout patterns"""
        symbol = row['name']
        try:
            # Get intraday data
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')  # 5 days for faster fetch
            
            historical_data = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=15,
                to_date=to_date,
                from_date=from_date
            )
            
            if historical_data is not None and len(historical_data) >= 20:
                # Prepare data
                hist_df = historical_data.copy()
                
                # Handle columns
                if len(hist_df.columns) == 6:
                    hist_df.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                    hist_df = hist_df[['Open', 'High', 'Low', 'Close', 'Volume']]
                elif len(hist_df.columns) == 5:
                    hist_df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                
                # Convert to numeric
                for column_name in ['Open', 'High', 'Low', 'Close', 'Volume']:
                    hist_df[column_name] = pd.to_numeric(hist_df[column_name], errors='coerce')
                
                hist_df = hist_df.dropna()
                
                if len(hist_df) >= 20:
                    # Analyze patterns
                    analysis = breakout_analyzer.analyze_stock(hist_df)
                    
                    # Calculate breakout score
                    breakout_score = 0
                    active_channels = len(analysis['active_channels'])
                    recent_breakouts = len(analysis['breakouts'])
                    
                    # Scoring logic
                    if active_channels > 0:
                        breakout_score += active_channels * 25
                        for channel in analysis['active_channels']:
                            if 0.5 <= channel['range_percent'] <= 3:
                                breakout_score += 20
                    
                    if recent_breakouts > 0:
                        breakout_score += recent_breakouts * 15
                        for breakout in analysis['breakouts']:
                            if breakout.get('strength', 0) > 1:
                                breakout_score += 10
                    
                    # Volume and technical factors
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    if vol_ratio > 1.5:
                        breakout_score += 15
                    elif vol_ratio > 1.2:
                        breakout_score += 8
                    
                    # Store results
                    with results_lock:
                        breakout_results[symbol] = {
                            'breakout_score': breakout_score,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts,
                            'analysis': analysis,
                            'support_level': analysis['breakouts'][-1]['support_level'] if analysis['breakouts'] else None,
                            'resistance_level': analysis['breakouts'][-1]['resistance_level'] if analysis['breakouts'] else None,
                            'breakout_type': analysis['breakouts'][-1]['type'] if analysis['breakouts'] else None,
                            'breakout_strength': analysis['breakouts'][-1]['strength'] if analysis['breakouts'] else 0
                        }
                
        except Exception as e:
            console.print(f"[dim red]Error analyzing {symbol}: {str(e)[:50]}[/dim red]")
            with results_lock:
                breakout_results[symbol] = {
                    'breakout_score': 0,
                    'active_channels': 0,
                    'recent_breakouts': 0,
                    'analysis': None,
                    'support_level': None,
                    'resistance_level': None,
                    'breakout_type': None,
                    'breakout_strength': 0
                }
    
    # Execute parallel analysis
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        # Submit all stocks for analysis
        futures = []
        for _, row in df.iterrows():
            future = executor.submit(analyze_single_stock, row)
            futures.append(future)
        
        # Wait for completion with progress
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            completed += 1
            if completed % 5 == 0:
                console.print(f"[dim]Completed: {completed}/{len(df)} stocks[/dim]")
    
    # Add results to dataframe
    df['breakout_score'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_score', 0))
    df['active_channels'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('active_channels', 0))
    df['recent_breakouts'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('recent_breakouts', 0))
    df['support_level'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('support_level'))
    df['resistance_level'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('resistance_level'))
    df['breakout_type'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_type'))
    df['breakout_strength'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_strength', 0))
    
    # Store full analysis for detailed alerts
    df['full_analysis'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('analysis'))
    
    console.print(f"[dim green]✅ Completed parallel analysis for {len(df)} stocks[/dim green]")
    
    return df


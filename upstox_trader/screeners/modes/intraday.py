"""
Intraday Strategy Module
========================

This module contains various intraday trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def intraday_high_volume_breakouts(self):
    """Find high volume breakouts for intraday trading"""
    console.print(Panel.fit("🟢 OVERSOLD BOUNCE: Reversal Plays", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 300000,  # Decent volume
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('RSI') < 35,  # Oversold condition
                col('change').between(-5, 0),  # Recent decline
                col('relative_volume_10d_calc') > 1.1  # Some volume interest
            )
            .order_by(col('RSI'), ascending=True)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add bounce potential score
            df['bounce_score'] = (
                (35 - df['RSI']) * 2 + 
                abs(df['change']) +
                df['relative_volume_10d_calc'] * 5
            )
            
            # Sort by bounce potential
            df = df.sort_values('bounce_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🟢 OVERSOLD BOUNCE Candidates")
            else:
                console.print("[green]Found oversold bounce candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'RSI', 'bounce_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching oversold bounce criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in oversold bounce analysis: {e}[/red]")

def intraday_gap_up_stocks(self):
    """Find gap-up stocks for intraday momentum plays"""
    console.print(Panel.fit("📰 NEWS MOMENTUM: Event-Driven Plays", style="bold yellow"))
    try:
        # This would typically integrate with a news API
        # For now, we'll show a simplified version based on volume and price action
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 1000000,  # Very high volume (suggests news)
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 2.0,  # Significant volume surge
                col('change').between(-10, 10)  # Significant move
            )
            .order_by(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add news impact score
            df['news_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                abs(df['change']) * 2 +
                (df['volume'] / 1000000)  # Volume in millions
            )
            
            # Sort by news impact score
            df = df.sort_values('news_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📰 NEWS MOMENTUM Candidates")
            else:
                console.print("[green]Found news momentum candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'news_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching news momentum criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in news momentum analysis: {e}[/red]")

def intraday_oversold_bounce(self):
    """Find oversold stocks bouncing back"""
    console.print(Panel.fit("📈 VOLUME ACCUMULATION: Smart Money Tracking", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume accumulation
                col('change').between(-2, 5),  # Sideways to slight uptrend
                col('RSI').between(40, 65)  # Neutral to slightly bullish
            )
            .order_by(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add accumulation score
            df['accumulation_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (65 - df['RSI']) +  # Lower RSI is better for accumulation
                df['change'] * 2
            )
            
            # Sort by accumulation score
            df = df.sort_values('accumulation_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📈 VOLUME ACCUMULATION Candidates")
            else:
                console.print("[green]Found volume accumulation candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'accumulation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching volume accumulation criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in volume accumulation analysis: {e}[/red]")

def intraday_news_momentum(self):
    """Find stocks with news-driven momentum"""
    console.print(Panel.fit("📰 NEWS MOMENTUM: Event-Driven Plays", style="bold yellow"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume accumulation
                col('change').between(-2, 3),  # Sideways to slight up
                col('RSI').between(40, 60)  # Neutral RSI
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add accumulation score
            df['accumulation_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (60 - abs(df['RSI'] - 50)) +  # Closer to 50 RSI is better
                (3 - abs(df['change'])) * 2  # Less movement is better for accumulation
            )
            
            # Sort by accumulation score
            df = df.sort_values('accumulation_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📰 NEWS MOMENTUM Candidates")
            else:
                console.print("[green]Found news momentum candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'accumulation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching news momentum criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in news momentum analysis: {e}[/red]")

def intraday_early_breakout_setup(self):
    """Find early breakout setups before the main move"""
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
                col('close') > 50,  # Minimum price filter
                col('volume') > 500000,  # Volume filter
                col('market_cap_basic') > 2000000000,  # 200 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.2,  # Slight volume surge
                col('RSI').between(40, 65),  # Not overbought
                col('change').between(-2, 3),  # Sideways movement
                col('price_52_week_high') > col('close')  # Below 52-week high
            )
            .order_by(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add accumulation score
            df['accumulation_score'] = (
                (df['relative_volume_10d_calc'] - 1) * 20 + 
                (65 - df['RSI']) / 5 +  # Lower RSI is better for accumulation
                (df['price_52_week_high'] / df['close'] - 1) * 100  # Distance from 52-week high
            )
            
            # Sort by accumulation score
            df = df.sort_values('accumulation_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📊 PRE-BREAKOUT Accumulation Candidates")
            else:
                console.print("[green]Found stocks in accumulation phase:[/green]")
                console.print(df[['name', 'close', 'volume', 'relative_volume_10d_calc', 'RSI', 'accumulation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching pre-breakout accumulation criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in pre-breakout accumulation analysis: {e}[/red]")

def intraday_volume_accumulation(self):
    """Find stocks with smart money volume accumulation"""
    console.print(Panel.fit("📈 VOLUME ACCUMULATION: Smart Money Tracking", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume accumulation
                col('change').between(-2, 3),  # Sideways to slight up
                col('RSI').between(40, 60)  # Neutral RSI
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add accumulation score
            df['accumulation_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (60 - abs(df['RSI'] - 50)) +  # Closer to 50 RSI is better
                (3 - abs(df['change'])) * 2  # Less movement is better for accumulation
            )
            
            # Sort by accumulation score
            df = df.sort_values('accumulation_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📈 VOLUME ACCUMULATION Candidates")
            else:
                console.print("[green]Found volume accumulation candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'accumulation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching volume accumulation criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in volume accumulation analysis: {e}[/red]")

def intraday_compression_coiling(self):
    """Find stocks in compression/coiling phase before explosion"""
    console.print(Panel.fit("🌀 COMPRESSION COILING: Breakout Setups", style="bold magenta"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume accumulation
                col('change').between(-2, 3),  # Sideways to slight up
                col('RSI').between(40, 60)  # Neutral RSI
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add accumulation score
            df['accumulation_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (60 - abs(df['RSI'] - 50)) +  # Closer to 50 RSI is better
                (3 - abs(df['change'])) * 2  # Less movement is better for accumulation
            )
            
            # Sort by accumulation score
            df = df.sort_values('accumulation_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🌀 COMPRESSION COILING Candidates")
            else:
                console.print("[green]Found compression/coiling candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'accumulation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching compression/coiling criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in compression/coiling analysis: {e}[/red]")

def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, price_threshold=3.0, mode='PREBREAKOUT', market_cap_filter=None, max_price=None, min_price=None):
    """Live watch mode for continuous monitoring"""
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
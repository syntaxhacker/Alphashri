"""
Intraday Strategy Module
========================

This module contains various intraday trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def intraday_oversold_bounce(self) -> None:
    """Find oversold stocks bouncing back"""
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

def intraday_news_momentum(self) -> None:
    """Find stocks with news-driven momentum"""
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

def intraday_volume_accumulation(self) -> None:
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

def intraday_volume_accumulation(self) -> None:
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
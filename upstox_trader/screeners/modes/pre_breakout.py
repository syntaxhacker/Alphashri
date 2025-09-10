"""
Pre-Breakout Strategy Module
============================

This module contains functions for detecting and analyzing stocks in the 
accumulation phase before breakout.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def pre_breakout_accumulation(self):
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
                self.display_table(df.head(15), "📈 PRE-BREAKOUT Accumulation Candidates")
            else:
                console.print("[green]Found stocks in accumulation phase:[/green]")
                console.print(df[['name', 'close', 'volume', 'relative_volume_10d_calc', 'RSI', 'accumulation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching pre-breakout accumulation criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in pre-breakout accumulation analysis: {e}[/red]")

def early_momentum_detection(self):
    """Detect early momentum before FOMO kicks in"""
    console.print(Panel.fit("⚡ EARLY MOMENTUM: Pre-FOMO Detection", style="bold cyan"))
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
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc').between(1.1, 2.0),  # Building volume
                col('RSI').between(45, 65),  # Building momentum
                col('change').between(0.5, 3)  # Small positive moves
            )
            .order_by(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add momentum score
            df['momentum_score'] = (
                df['relative_volume_10d_calc'] * 10 +
                df['change'] * 5 +
                (65 - abs(df['RSI'] - 55))  # Closer to 55 RSI is better for building momentum
            )
            
            # Sort by momentum score
            df = df.sort_values('momentum_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "⚡ EARLY MOMENTUM Candidates")
            else:
                console.print("[green]Found early momentum candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'RSI', 'momentum_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching early momentum criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in early momentum detection: {e}[/red]")

def relative_strength_leaders(self):
    """Find relative strength leaders outperforming the market"""
    console.print(Panel.fit("🏆 RELATIVE STRENGTH: Market Outperformers", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Perf.W', 'Perf.3M', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 200000,  # Decent volume
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('Perf.W') > 3,  # Weekly outperformance
                col('Perf.3M') > 10,  # 3-month outperformance
                col('RSI').between(50, 75)  # Healthy momentum
            )
            .order_by(col('Perf.W'), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add strength score
            df['strength_score'] = (
                df['Perf.W'] * 2 +
                df['Perf.3M'] +
                df['change'] * 3 +
                (df['relative_volume_10d_calc'] - 1) * 10  # Volume confirmation
            )
            
            # Sort by strength score
            df = df.sort_values('strength_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🏆 RELATIVE STRENGTH Leaders")
            else:
                console.print("[green]Found relative strength leaders:[/green]")
                console.print(df[['name', 'close', 'Perf.W', 'Perf.3M', 'change', 'strength_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching relative strength criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in relative strength analysis: {e}[/red]")
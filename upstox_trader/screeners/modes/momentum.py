"""
Momentum Strategy Module
========================

This module contains functions for detecting and analyzing momentum plays.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def early_momentum_detection(self) -> None:
    """Detect early momentum plays before they become FOMO trades"""
    console.print(Panel.fit("⚡ EARLY MOMENTUM: Pre-FOMO Detection", style="bold cyan"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'MACD.macd', 'MACD.signal', 'EMA20', 'Volatility.D', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 300000,  # Volume filter
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.3,  # Volume increasing
                col('RSI').between(45, 70),  # Building momentum but not overbought
                col('change').between(1, 8),  # Positive momentum
                col('Volatility.D') > 0.02,  # Sufficient volatility
                col('MACD.macd') > col('MACD.signal')  # MACD crossover
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add momentum score
            df['momentum_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                df['change'] * 2 + 
                (df['MACD.macd'] - df['MACD.signal']) * 100 +
                df['Volatility.D'] * 100
            )
            
            # Sort by momentum score
            df = df.sort_values('momentum_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "⚡ EARLY MOMENTUM Candidates")
            else:
                console.print("[green]Found early momentum candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'momentum_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching early momentum criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in early momentum detection: {e}[/red]")

def relative_strength_leaders(self) -> None:
    """Find market outperformers with relative strength"""
    console.print(Panel.fit("🏆 RELATIVE STRENGTH: Market Outperformers", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'price_52_week_high', 'market_cap_basic', 'update_mode',
                'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y'
            )
            .set_markets(self.market)
            .where(
                col('close') > 75,  # Higher price threshold for quality
                col('volume') > 400000,  # Good volume
                col('market_cap_basic') > 2000000000,  # 200 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.1,  # Some volume interest
                col('RSI').between(50, 80),  # Strong but not overbought
                col('Perf.W') > 2,  # Outperforming this week
                col('Perf.1M') > 5,  # Outperforming this month
                col('Perf.3M') > 10  # Strong 3-month performance
            )
            .orderby(col('Perf.1M'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add relative strength score
            df['rs_score'] = (
                df['Perf.W'] * 0.2 + 
                df['Perf.1M'] * 0.3 + 
                df['Perf.3M'] * 0.3 + 
                df['Perf.6M'] * 0.2
            )
            
            # Sort by relative strength score
            df = df.sort_values('rs_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🏆 RELATIVE STRENGTH Leaders")
            else:
                console.print("[green]Found relative strength leaders:[/green]")
                console.print(df[['name', 'close', 'Perf.W', 'Perf.1M', 'Perf.3M', 'rs_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching relative strength criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in relative strength analysis: {e}[/red]")
"""
Gap Trading Strategy Module
===========================

This module contains functions for detecting and analyzing gap trading opportunities.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def intraday_gap_up_stocks(self) -> None:
    """Find stocks with significant gap-ups"""
    console.print(Panel.fit("🚀 GAP-UP: Momentum Gap-Up Stocks", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'gap_up_ratio', 'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 400000,  # Good volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.3,  # Volume interest
                col('gap_up_ratio') > 1.02,  # At least 2% gap-up
                col('RSI').between(40, 75)  # Not overbought
            )
            .orderby(col('gap_up_ratio'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add gap-up score
            df['gap_score'] = (
                (df['gap_up_ratio'] - 1) * 1000 + 
                df['relative_volume_10d_calc'] * 10 + 
                df['change'] * 2
            )
            
            # Sort by gap-up score
            df = df.sort_values('gap_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🚀 GAP-UP Momentum Stocks")
            else:
                console.print("[green]Found gap-up momentum candidates:[/green]")
                console.print(df[['name', 'close', 'gap_up_ratio', 'change', 'gap_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching gap-up criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in gap-up analysis: {e}[/red]")

def gap_fill_trading_strategy(self) -> None:
    """Analyze gap-fill trading opportunities"""
    console.print(Panel.fit("🎯 GAP-FILL: Gap Analysis & Trading", style="bold magenta"))
    try:
        # This would typically use historical data from Upstox API
        # For now, we'll show a simplified version
        console.print("[blue]Gap-fill strategy requires historical data analysis.[/blue]")
        console.print("[blue]Run with --example live_gap_sr_monitor for live gap monitoring.[/blue]")
        
    except Exception as e:
        console.print(f"[red]Error in gap-fill analysis: {e}[/red]")
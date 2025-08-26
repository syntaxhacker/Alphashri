"""
FOMO Strategy Module
====================

This module contains functions for detecting and analyzing FOMO (Fear of Missing Out) plays.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def intraday_high_volume_breakouts(self) -> None:
    """Find stocks with high volume breakouts"""
    console.print(Panel.fit("🔥 FOMO: High Volume Breakouts", style="bold red"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.8,  # Significant volume surge
                col('change') > 3,  # Strong price move
                col('RSI').between(50, 80),  # Momentum but not overbought
                col('Volatility.D') > 0.02  # Sufficient volatility
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add FOMO score
            df['fomo_score'] = (
                df['relative_volume_10d_calc'] * 15 + 
                df['change'] * 3 + 
                df['Volatility.D'] * 100
            )
            
            # Sort by FOMO score
            df = df.sort_values('fomo_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🔥 FOMO High Volume Breakouts")
            else:
                console.print("[green]Found FOMO breakout candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'relative_volume_10d_calc', 'fomo_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching FOMO breakout criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in FOMO breakout analysis: {e}[/red]")
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
"""
Swing Trading Strategy Module
=============================

This module contains functions for swing trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def swing_bullish_reversal(self) -> None:
    """Find stocks with bullish reversal patterns"""
    console.print(Panel.fit("🔄 SWING REVERSAL: Bullish Pattern Plays", style="bold blue"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'MACD.macd', 'MACD.signal', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 75,  # Higher price for swing trades
                col('volume') > 400000,  # Good volume
                col('market_cap_basic') > 2000000000,  # 200 Cr minimum market cap
                col('RSI').between(30, 60),  # Oversold to neutral
                col('MACD.macd') > col('MACD.signal'),  # Bullish MACD crossover
                col('EMA20') > col('EMA50')  # Bullish EMA crossover
            )
            .orderby(col('change'), ascending=False)  # Recent positive momentum
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add reversal strength score
            df['reversal_score'] = (
                (60 - df['RSI']) + 
                (df['MACD.macd'] - df['MACD.signal']) * 100 +
                (df['EMA20'] / df['EMA50'] - 1) * 100 +
                df['relative_volume_10d_calc'] * 5
            )
            
            # Sort by reversal strength
            df = df.sort_values('reversal_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🔄 SWING BULLISH REVERSAL Patterns")
            else:
                console.print("[green]Found bullish reversal candidates:[/green]")
                console.print(df[['name', 'close', 'RSI', 'reversal_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching bullish reversal criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in bullish reversal analysis: {e}[/red]")

def swing_breakout_consolidation(self) -> None:
    """Find stocks breaking out of consolidation patterns"""
    console.print(Panel.fit("💥 SWING BREAKOUT: Consolidation Breakouts", style="bold orange"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode',
                'high_20d', 'low_20d'
            )
            .set_markets(self.market)
            .where(
                col('close') > 75,  # Higher price for swing trades
                col('volume') > 500000,  # Good volume
                col('market_cap_basic') > 2000000000,  # 200 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume surge
                col('close') > col('high_20d') * 0.98,  # Near 20-day high
                col('Volatility.D') > 0.015  # Sufficient volatility
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add breakout strength score
            df['breakout_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (df['close'] / df['high_20d']) * 50 + 
                df['Volatility.D'] * 100
            )
            
            # Sort by breakout strength
            df = df.sort_values('breakout_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "💥 SWING BREAKOUT Candidates")
            else:
                console.print("[green]Found breakout candidates:[/green]")
                console.print(df[['name', 'close', 'high_20d', 'relative_volume_10d_calc', 'breakout_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching breakout criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in breakout analysis: {e}[/red]")
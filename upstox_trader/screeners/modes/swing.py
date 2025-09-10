"""
Swing Trading Strategy Module
==============================

This module contains various swing trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def swing_bullish_reversal(self):
    """Find bullish reversal patterns for swing trades"""
    console.print(Panel.fit("🔄 BULLISH REVERSAL: Counter-Trend Swing Plays", style="bold purple"))
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
                col('volume') > 300000,  # Decent volume
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('RSI') < 40,  # Oversold condition
                col('Perf.W') < -3,  # Weekly underperformance
                col('Perf.3M') < 0,  # 3-month underperformance
                col('change').between(-5, 0),  # Recent decline
                col('exchange') == 'NSE'
            )
            .order_by('RSI', ascending=True)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add reversal potential score
            df['reversal_score'] = (
                (40 - df['RSI']) * 2 +  # Lower RSI = higher reversal potential
                abs(df['change']) * 3 +  # Larger declines = better reversals
                abs(df['Perf.W']) +  # Greater underperformance = better setup
                df['relative_volume_10d_calc'] * 5  # Volume confirmation
            )
            
            # Sort by reversal potential
            df = df.sort_values('reversal_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🔄 BULLISH REVERSAL Candidates")
            else:
                console.print("[green]Found bullish reversal candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'RSI', 'Perf.W', 'reversal_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching bullish reversal criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in bullish reversal analysis: {e}[/red]")

def swing_breakout_consolidation(self):
    """Find breakout from consolidation patterns"""
    console.print(Panel.fit("📈 CONSOLIDATION BREAKOUT: Range-Bound Breakouts", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'BB.upper', 'BB.lower', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.3,  # Volume interest
                col('RSI').between(45, 65),  # Not overbought
                col('change').between(-2, 2),  # Sideways movement
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Calculate Bollinger Band width (consolidation measure)
            df['bb_width'] = ((df['BB.upper'] - df['BB.lower']) / df['close']) * 100
            
            # Add breakout potential score
            df['breakout_score'] = (
                (15 - df['bb_width']) * 2 +  # Tighter consolidation = higher score
                df['relative_volume_10d_calc'] * 10 +  # Volume accumulation
                (65 - abs(df['RSI'] - 55)) +  # RSI around 55 is ideal for breakout
                abs(df['change']) * 2  # Small moves = better consolidation
            )
            
            # Sort by breakout potential
            df = df.sort_values('breakout_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📈 CONSOLIDATION BREAKOUT Candidates")
            else:
                console.print("[green]Found consolidation breakout candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'bb_width', 'breakout_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching consolidation breakout criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in consolidation breakout analysis: {e}[/red]")

def swing_sector_rotation(self):
    """Find sector rotation opportunities"""
    console.print(Panel.fit("🏭 SECTOR ROTATION: Industry Group Moves", style="bold bright_yellow"))
    try:
        # This would typically integrate with sector data
        # For now, we'll show a simplified version based on relative performance
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Perf.W', 'Perf.3M', 'Perf.6M', 'market_cap_basic', 'update_mode', 'sector'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 300000,  # Decent volume
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('Perf.W') > 5,  # Strong weekly performance
                col('Perf.3M') > 15,  # Strong 3-month performance
                col('exchange') == 'NSE'
            )
            .order_by('Perf.W', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add rotation strength score
            df['rotation_score'] = (
                df['Perf.W'] * 3 +  # Weekly momentum
                df['Perf.3M'] * 2 +  # 3-month momentum
                df['Perf.6M'] +  # 6-month trend
                df['relative_volume_10d_calc'] * 5  # Volume confirmation
            )
            
            # Sort by rotation strength
            df = df.sort_values('rotation_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🏭 SECTOR ROTATION Candidates")
            else:
                console.print("[green]Found sector rotation candidates:[/green]")
                console.print(df[['name', 'close', 'Perf.W', 'Perf.3M', 'Perf.6M', 'rotation_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching sector rotation criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in sector rotation analysis: {e}[/red]")
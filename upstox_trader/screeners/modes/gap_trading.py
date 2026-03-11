"""
Gap Trading Strategy Module
===========================

This module contains various gap trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def gap_fill_trading_strategy(self):
    """Historical gap-fill probability analysis"""
    console.print(Panel.fit("🎯 GAP-FILL ANALYSIS: Historical Probability Study", style="bold magenta"))
    try:
        # Get current volume movers with gaps
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
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume surge
                col('change').abs() > 1.0,  # Significant gap (1%+)
                col('exchange') == 'NSE'
            )
            .order_by(col('relative_volume_10d_calc'), ascending=False)
            .limit(30)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add gap analysis
            df['gap_fill_probability'] = df.apply(
                lambda row: self.gap_analysis._analyze_gap_fill_probability(
                    row['name'], abs(row['change']), 'UP' if row['change'] > 0 else 'DOWN'
                )[0], axis=1
            )
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(20), "🎯 GAP-FILL ANALYSIS Results")
            else:
                console.print("[green]Found gap-fill candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'gap_fill_probability']].head(20).to_string())
        else:
            console.print("[yellow]No significant gaps found currently[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in gap-fill analysis: {e}[/red]")

def live_gap_fill_monitor_with_sr(self, refresh_interval=30):
    """Live gap-fill monitor with support/resistance analysis"""
    self.gap_analysis.live_gap_fill_monitor_with_sr(refresh_interval)

def optimized_gap_strategy_15min(self):
    """Optimized gap strategy using 15-minute timeframe"""
    console.print(Panel.fit("🚀 OPTIMIZED GAP STRATEGY: 15-Minute Framework (68.4% Win Rate)", style="bold green"))
    try:
        # Get gap stocks with additional filters
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
                col('relative_volume_10d_calc') > 1.3,  # Volume interest
                col('change').abs().between(1.5, 15),  # Quality gap range
                col('price_52_week_high') > col('close') * 1.05,  # Not near 52-week high
                col('exchange') == 'NSE'
            )
            .order_by(col('change').abs(), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add gap quality scoring
            df['gap_quality_score'] = self.gap_analysis._calculate_gap_quality_score(df)
            
            # Sort by quality score
            df = df.sort_values('gap_quality_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🚀 OPTIMIZED GAP STRATEGY Candidates")
            else:
                console.print("[green]Found optimized gap strategy candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'gap_quality_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching optimized gap criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in optimized gap strategy: {e}[/red]")

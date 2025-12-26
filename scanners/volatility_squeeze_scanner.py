#!/usr/bin/env python3
"""
Volatility Squeeze Scanner
Identifies stocks with low volatility (Bollinger Bands squeeze) preparing for a move.
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse

console = Console()

def scan_volatility_squeeze(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('📉 VOLATILITY SQUEEZE SCANNER', style='bold orange1'))
    
    try:
        # Fetch data
        # Logic: Low Bandwidth. We fetch BB Upper/Lower and calc bandwidth.
        # Also check ATR.
        query = (Query()
            .select('name', 'close', 'change', 'volume', 'BB.upper', 'BB.lower', 'ATR', 'RSI', 'market_cap_basic')
            .set_markets(market)
            .where(
                col('market_cap_basic') > 500_000_000,
                col('volume') > 200_000,
                col('close') > 5
            )
            .limit(300) # Fetch more to filter locally
        )
        
        total_rows, df = query.get_scanner_data()
        
        if df.empty:
            console.print('[yellow]No data found.[/yellow]')
            return

        # Calculate Bandwidth % = (Upper - Lower) / Close * 100
        df['bandwidth_pct'] = ((df['BB.upper'] - df['BB.lower']) / df['close']) * 100
        
        # Filter for tight squeeze (e.g., Bandwidth < 5% or relative to market)
        # A "tight" squeeze depends on the stock, but < 5% is usually tight for equities.
        squeeze_candidates = df[df['bandwidth_pct'] < 5.0].copy()
        
        if squeeze_candidates.empty:
            console.print('[yellow]No tight squeezes found (< 5% bandwidth).[/yellow]')
            return

        # Sort by tightest squeeze
        squeeze_candidates = squeeze_candidates.sort_values('bandwidth_pct')

        # Display Results
        table = Table(title='🐍 TIGHTEST SQUEEZES (Bandwidth < 5%)', show_header=True, header_style='bold orange1')
        table.add_column('Stock', style='cyan')
        table.add_column(f'Price {currency}', style='white')
        table.add_column('Bandwidth %', style='bold orange1')
        table.add_column('Change %', style='white')
        table.add_column('RSI', style='magenta')
        
        for _, row in squeeze_candidates.head(20).iterrows():
            change_color = 'green' if row['change'] >= 0 else 'red'
            change_str = f"[{change_color}]{row['change']:+.2f}%[/{change_color}]"
            
            table.add_row(
                row['name'],
                f"{currency}{row['close']:.2f}",
                f"{row['bandwidth_pct']:.2f}%",
                change_str,
                f"{row['RSI']:.0f}"
            )
        console.print(table)
        console.print("[dim]Look for a breakout from these tight ranges.[/dim]")

    except Exception as e:
        console.print(f'[red]Error: {e}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Volatility Squeeze Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us', help='Market to scan')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    scan_volatility_squeeze(market)

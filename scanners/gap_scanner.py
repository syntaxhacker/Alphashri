#!/usr/bin/env python3
"""
Gap Scanner
Identifies stocks with significant opening gaps (Up or Down).
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse

console = Console()

def scan_gaps(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('🕳️ GAP SCANNER', style='bold cyan'))
    
    try:
        # Fetch data
        # Logic: Gap > 2% or Gap < -2%
        query = (Query()
            .select('name', 'close', 'open', 'change', 'gap', 'volume', 'RSI', 'market_cap_basic')
            .set_markets(market)
            .where(
                col('market_cap_basic') > 100_000_000,
                col('volume') > 100_000
            )
            .order_by('gap', ascending=False) # Get biggest gaps
            .limit(200)
        )
        
        total_rows, df = query.get_scanner_data()
        
        if df.empty:
            console.print('[yellow]No data found.[/yellow]')
            return

        # Filter for significant gaps
        gap_up = df[df['gap'] > 2.0].copy()
        gap_down = df[df['gap'] < -2.0].copy()
        
        # Display Gap Ups
        if not gap_up.empty:
            table = Table(title='🚀 GAP UPS (> 2%)', show_header=True, header_style='bold green')
            table.add_column('Stock', style='cyan')
            table.add_column(f'Price {currency}', style='white')
            table.add_column('Gap %', style='bold green')
            table.add_column('Change %', style='green')
            table.add_column('Volume', style='white')
            
            for _, row in gap_up.head(15).iterrows():
                vol_str = f"{row['volume']/1_000_000:.1f}M"
                table.add_row(
                    row['name'],
                    f"{currency}{row['close']:.2f}",
                    f"+{row['gap']:.2f}%",
                    f"+{row['change']:.2f}%",
                    vol_str
                )
            console.print(table)
            console.print()

        # Display Gap Downs
        if not gap_down.empty:
            # Sort gap down by most negative
            gap_down = gap_down.sort_values('gap', ascending=True)
            
            table = Table(title='🔻 GAP DOWNS (< -2%)', show_header=True, header_style='bold red')
            table.add_column('Stock', style='cyan')
            table.add_column(f'Price {currency}', style='white')
            table.add_column('Gap %', style='bold red')
            table.add_column('Change %', style='red')
            table.add_column('Volume', style='white')
            
            for _, row in gap_down.head(15).iterrows():
                vol_str = f"{row['volume']/1_000_000:.1f}M"
                table.add_row(
                    row['name'],
                    f"{currency}{row['close']:.2f}",
                    f"{row['gap']:.2f}%",
                    f"{row['change']:.2f}%",
                    vol_str
                )
            console.print(table)

    except Exception as e:
        console.print(f'[red]Error: {e}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Gap Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us', help='Market to scan')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    scan_gaps(market)

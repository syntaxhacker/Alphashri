#!/usr/bin/env python3
"""
Volume Breakout Scanner
Identifies stocks moving with unusual volume (High Relative Volume).
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse

console = Console()

def scan_volume_breakout(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('🔊 VOLUME BREAKOUT SCANNER', style='bold magenta'))
    
    try:
        # Fetch data
        # Logic: RVol > 2.0, Change > 2%, Avg Vol > 500k
        query = (Query()
            .select('name', 'close', 'change', 'volume', 'average_volume_10d_calc', 'RSI', 'market_cap_basic', 'sector')
            .set_markets(market)
            .where(
                col('market_cap_basic') > 100_000_000,
                col('average_volume_10d_calc') > 500_000,
                col('relative_volume_10d_calc') > 2.0,  # High RVol
                col('change') > 2.0                     # Positive momentum
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(100)
        )
        
        total_rows, df = query.get_scanner_data()
        
        if df.empty:
            console.print('[yellow]No high volume breakouts found.[/yellow]')
            return

        # Calculate RVol manually to be sure (TV field is good but manual calc confirms)
        # TV's relative_volume_10d_calc is usually Volume / AvgVol
        # We can just use the field directly if it exists, or calc it.
        # Let's use the field from TV directly as it's cleaner.
        
        # Display Results
        table = Table(title='🚀 HIGH VOLUME BREAKOUTS (RVol > 2.0)', show_header=True, header_style='bold magenta')
        table.add_column('Stock', style='cyan')
        table.add_column(f'Price {currency}', style='white')
        table.add_column('Change %', style='green')
        table.add_column('Volume', style='white')
        table.add_column('RVol', style='bold magenta')
        table.add_column('RSI', style='yellow')
        
        for _, row in df.head(20).iterrows():
            vol_str = f"{row['volume']/1_000_000:.1f}M"
            rvol = row.get('relative_volume_10d_calc', 0)
            
            table.add_row(
                row['name'],
                f"{currency}{row['close']:.2f}",
                f"+{row['change']:.2f}%",
                vol_str,
                f"{rvol:.1f}x",
                f"{row['RSI']:.0f}"
            )
        console.print(table)
            
    except Exception as e:
        console.print(f'[red]Error: {e}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Volume Breakout Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us', help='Market to scan')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    scan_volume_breakout(market)

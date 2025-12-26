#!/usr/bin/env python3
"""
Golden Cross Scanner
Identifies stocks where SMA50 is above SMA200 (Trend Following).
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse

console = Console()

def scan_golden_cross(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('✨ GOLDEN CROSS SCANNER', style='bold gold1'))
    
    try:
        # Fetch data
        # We look for SMA50 > SMA200. 
        # To find *recent* crosses, we could ideally check previous values, but TV screener gives current.
        # So we filter for SMA50 > SMA200 AND Price close to SMA50 (pullback) OR Price breaking out.
        query = (Query()
            .select('name', 'close', 'change', 'volume', 'SMA50', 'SMA200', 'RSI', 'market_cap_basic')
            .set_markets(market)
            .where(
                col('market_cap_basic') > 500_000_000,
                col('volume') > 500_000,
                col('SMA50') > col('SMA200'),           # Golden Cross condition
                col('close') > col('SMA50')             # Price above 50 SMA (Trend confirmed)
            )
            .order_by('volume', ascending=False)
            .limit(100)
        )
        
        total_rows, df = query.get_scanner_data()
        
        if df.empty:
            console.print('[yellow]No data found.[/yellow]')
            return

        # Calculate how close SMA50 is to SMA200 to find "Fresh" crosses
        # Diff % = (SMA50 - SMA200) / SMA200
        df['cross_diff_pct'] = ((df['SMA50'] - df['SMA200']) / df['SMA200']) * 100
        
        # Fresh crosses are where diff is small (< 2%)
        fresh_crosses = df[df['cross_diff_pct'] < 2.0].copy()
        
        # Strong trend is where diff is larger but price is pulling back to SMA50
        # Pullback: Price is within 2% of SMA50
        df['dist_to_sma50'] = ((df['close'] - df['SMA50']) / df['SMA50']) * 100
        pullbacks = df[(df['dist_to_sma50'] > 0) & (df['dist_to_sma50'] < 2.0)].copy()

        # Display Fresh Crosses
        if not fresh_crosses.empty:
            table = Table(title='🆕 FRESH GOLDEN CROSSES (SMA50 just crossed SMA200)', show_header=True, header_style='bold green')
            table.add_column('Stock', style='cyan')
            table.add_column(f'Price {currency}', style='white')
            table.add_column('Change %', style='green')
            table.add_column('Cross Diff %', style='yellow')
            table.add_column('Volume', style='white')
            
            for _, row in fresh_crosses.sort_values('cross_diff_pct').head(10).iterrows():
                vol_str = f"{row['volume']/1_000_000:.1f}M"
                table.add_row(
                    row['name'],
                    f"{currency}{row['close']:.2f}",
                    f"{row['change']:.2f}%",
                    f"{row['cross_diff_pct']:.2f}%",
                    vol_str
                )
            console.print(table)
            console.print()

        # Display Pullbacks
        if not pullbacks.empty:
            table = Table(title='📉 PULLBACK TO 50 SMA (Trend Continuation)', show_header=True, header_style='bold blue')
            table.add_column('Stock', style='cyan')
            table.add_column(f'Price {currency}', style='white')
            table.add_column('Dist to SMA50', style='yellow')
            table.add_column('RSI', style='magenta')
            
            for _, row in pullbacks.sort_values('dist_to_sma50').head(10).iterrows():
                table.add_row(
                    row['name'],
                    f"{currency}{row['close']:.2f}",
                    f"{row['dist_to_sma50']:.2f}%",
                    f"{row['RSI']:.1f}"
                )
            console.print(table)

    except Exception as e:
        console.print(f'[red]Error: {e}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Golden Cross Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us', help='Market to scan')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    scan_golden_cross(market)

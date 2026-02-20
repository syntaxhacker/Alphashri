#!/usr/bin/env python3
"""
RSI Reversal Scanner
Identifies stocks that are overbought/oversold and showing signs of reversal.
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse
from .scanner_utils import display_tradingview_csv

console = Console()

def scan_rsi_reversal(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('🔄 RSI REVERSAL SCANNER', style='bold blue'))
    
    try:
        # Fetch data
        query = (Query()
            .select('name', 'close', 'change', 'volume', 'RSI', 'Stoch.K', 'Stoch.D', 'market_cap_basic', 'sector')
            .set_markets(market)
            .where(
                col('market_cap_basic') > 100_000_000,
                col('volume') > 100_000,
                col('close') > 5
            )
            .order_by('volume', ascending=False)
            .limit(200)
        )
        
        total_rows, df = query.get_scanner_data()
        
        if df.empty:
            console.print('[yellow]No data found.[/yellow]')
            return

        # Logic for Reversals
        # Bullish: RSI < 35 AND Stoch.K < 25 AND Change > 0 (Green candle in oversold)
        bullish = df[
            (df['RSI'] < 35) & 
            (df['Stoch.K'] < 25) & 
            (df['change'] > 0)
        ].copy()
        
        # Bearish: RSI > 65 AND Stoch.K > 75 AND Change < 0 (Red candle in overbought)
        bearish = df[
            (df['RSI'] > 65) & 
            (df['Stoch.K'] > 75) & 
            (df['change'] < 0)
        ].copy()
        
        # Display Bullish
        if not bullish.empty:
            table = Table(title='🐂 BULLISH REVERSAL CANDIDATES (Oversold Bounce)', show_header=True, header_style='bold green')
            table.add_column('Stock', style='cyan')
            table.add_column(f'Price {currency}', style='white')
            table.add_column('Change %', style='green')
            table.add_column('RSI', style='magenta')
            table.add_column('Stoch K', style='yellow')
            
            for _, row in bullish.head(15).iterrows():
                table.add_row(
                    row['name'],
                    f"{currency}{row['close']:.2f}",
                    f"+{row['change']:.2f}%",
                    f"{row['RSI']:.1f}",
                    f"{row['Stoch.K']:.1f}"
                )
            console.print(table)
            console.print()

        # Display Bearish
        if not bearish.empty:
            table = Table(title='🐻 BEARISH REVERSAL CANDIDATES (Overbought Pullback)', show_header=True, header_style='bold red')
            table.add_column('Stock', style='cyan')
            table.add_column(f'Price {currency}', style='white')
            table.add_column('Change %', style='red')
            table.add_column('RSI', style='magenta')
            table.add_column('Stoch K', style='yellow')
            
            for _, row in bearish.head(15).iterrows():
                table.add_row(
                    row['name'],
                    f"{currency}{row['close']:.2f}",
                    f"{row['change']:.2f}%",
                    f"{row['RSI']:.1f}",
                    f"{row['Stoch.K']:.1f}"
                )
            console.print(table)

        if bullish.empty and bearish.empty:
            console.print('[yellow]No reversal setups found matching strict criteria.[/yellow]')

        # TradingView-compatible CSV output
        if not bullish.empty or not bearish.empty:
            all_stocks = []
            if not bullish.empty:
                all_stocks.extend(bullish['name'].tolist())
            if not bearish.empty:
                all_stocks.extend(bearish['name'].tolist())
            display_tradingview_csv(all_stocks)

    except Exception as e:
        console.print(f'[red]Error: {e}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='RSI Reversal Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us', help='Market to scan')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    scan_rsi_reversal(market)

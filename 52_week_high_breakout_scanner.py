#!/usr/bin/env python3
"""
52-Week High Breakout Scanner
Find stocks near 52-week highs for potential long positions
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse

console = Console()

def find_near_52_week_high(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('🚀 52-WEEK HIGH BREAKOUT SCANNER', style='bold blue'))
    
    try:
        # Find stocks near 52-week highs (within 5% of high)
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'high', 'low', 'change', 'volume', 
                'price_52_week_high', 'price_52_week_low', 'market_cap_basic',
                'RSI', 'sector', 'description', 'update_mode'
            )
            .set_markets(market)
            .where(
                col('close') >= 10,                     # No penny stocks
                col('market_cap_basic') >= 500000000,   # Min $500M market cap
                col('volume') > 1000000,                # Min 1M volume
                col('close') > 10,                     # Positive price
                col('RSI').between(45, 75),            # Not overbought/oversold
                col('change') >= 0.5                   # Positive momentum
            )
            .order_by(col('RSI'), ascending=False)  # Sort by momentum
            .limit(100)
            .get_scanner_data()
        )
        
        if not df.empty:
            # Calculate distance to 52-week high
            df['distance_to_high_pct'] = ((df['price_52_week_high'] - df['close']) / df['price_52_week_high']) * 100
            df['volume_in_millions'] = (df['volume'] / 1000000).round(2)
            df['market_cap_billions'] = (df['market_cap_basic'] / 1000000000).round(2)
            
            # Filter for stocks within 10% of 52-week high
            near_high_stocks = df[df['distance_to_high_pct'] <= 10].copy()
            
            if not near_high_stocks.empty:
                # Calculate breakout potential score
                near_high_stocks['breakout_score'] = 0
                
                # High score if very close to high (within 3%)
                near_high_stocks.loc[near_high_stocks['distance_to_high_pct'] <= 3, 'breakout_score'] += 50
                
                # Bonus for high volume
                near_high_stocks['breakout_score'] += (near_high_stocks['volume_in_millions'] * 2).astype(int)
                
                # Bonus for large market cap
                near_high_stocks['breakout_score'] += (near_high_stocks['market_cap_billions'] * 3).astype(int)
                
                # Bonus for strong RSI (above 60)
                near_high_stocks.loc[near_high_stocks['RSI'] >= 60, 'breakout_score'] += 30
                
                # Bonus for good daily change (above 2%)
                near_high_stocks.loc[near_high_stocks['change'] >= 2, 'breakout_score'] += 20
                
                # Sort by breakout score and distance to high
                near_high_stocks = near_high_stocks.sort_values(['breakout_score', 'distance_to_high_pct'], ascending=[False, True])
                
                console.print(f'[bold green]🎯 Found {len(near_high_stocks)} stocks near 52-week highs![/bold green]')
                console.print()
                
                # Create results table
                table = Table(title='📈 TOP BREAKOUT CANDIDATES - Near 52-Week High', show_header=True, header_style='bold cyan')
                table.add_column('Stock', style='cyan', width=18)
                table.add_column(f'Price {currency}', style='bold white', width=8)
                table.add_column(f'52W High {currency}', style='blue', width=10)
                table.add_column('Gap %', style='yellow', width=8)
                table.add_column('RSI', style='magenta', width=5)
                table.add_column('Change %', style='green', width=8)
                table.add_column('Volume (M)', style='white', width=10)
                table.add_column('Breakout Score', style='bold red', width=12)
                table.add_column('Action', style='bold green', width=8)
                
                for _, stock in near_high_stocks.head(15).iterrows():
                    gap_pct = stock['distance_to_high_pct']
                    breakout_score = int(stock['breakout_score'])
                    
                    # Action recommendations based on gap
                    if gap_pct <= 2:
                        action = '[bold green]BUY[/bold green]'
                        emoji = '🔥'
                    elif gap_pct <= 5:
                        action = '[bold yellow]WATCH[/bold yellow]'
                        emoji = '👀'
                    else:
                        action = '[dim]WAIT[/dim]'
                        emoji = '⏳'
                    
                    # Breakout score color
                    if breakout_score >= 100:
                        score_color = 'bright_green'
                    elif breakout_score >= 70:
                        score_color = 'yellow'
                    else:
                        score_color = 'red'
                    
                    table.add_row(
                        stock['name'][:16],
                        f'{currency}{stock["close"]:.2f}',
                        f'{currency}{stock["price_52_week_high"]:.2f}',
                        f'{gap_pct:.2f}%',
                        f'{stock["RSI"]:.0f}',
                        f'+{stock["change"]:.2f}%',
                        f'{stock["volume_in_millions"]:.1f}M',
                        f'{emoji} [{score_color}]{breakout_score}[/{score_color}]',
                        action
                    )
                
                console.print(table)
                
                # Top 5 immediate breakout candidates
                immediate_candidates = near_high_stocks[near_high_stocks['distance_to_high_pct'] <= 3].head(5)
                if not immediate_candidates.empty:
                    console.print()
                    console.print(Panel.fit(
                        '🔥 [bold red]IMMEDIATE BREAKOUT CANDIDATES (≤3% from high):[/bold red]\n' +
                        '\n'.join([f'• {row["name"]}: {currency}{row["close"]:.2f} → {currency}{row["price_52_week_high"]:.2f} (Gap: {row["distance_to_high_pct"]:.1f}%, RSI: {row["RSI"]:.0f}, Score: {int(row["breakout_score"])})'
                                  for _, row in immediate_candidates.iterrows()]),
                        style='red'
                    ))
                
                # High momentum candidates (RSI > 65)
                high_momentum = near_high_stocks[near_high_stocks['RSI'] >= 65].head(5)
                if not high_momentum.empty:
                    console.print()
                    console.print(Panel.fit(
                        '⚡ [bold yellow]HIGH MOMENTUM (RSI ≥ 65):[/bold yellow]\n' +
                        '\n'.join([f'• {row["name"]}: {currency}{row["close"]:.2f} (Gap: {row["distance_to_high_pct"]:.1f}%, RSI: {row["RSI"]:.0f}, Vol: {row["volume_in_millions"]:.1f}M)'
                                  for _, row in high_momentum.iterrows()]),
                        style='yellow'
                    ))
                
                # Sector analysis
                sector_analysis = near_high_stocks.head(10).groupby('sector').size().sort_values(ascending=False)
                if not sector_analysis.empty:
                    console.print()
                    sectors_text = '\n'.join([f'• {sector}: {count} stocks' for sector, count in sector_analysis.items()])
                    console.print(Panel.fit(
                        f'📊 [bold blue]SECTORS BREAKING OUT:[/bold blue]\n{sectors_text}',
                        style='blue'
                    ))
                
                # Summary statistics
                avg_gap = near_high_stocks['distance_to_high_pct'].mean()
                avg_rsi = near_high_stocks['RSI'].mean()
                total_stocks = len(near_high_stocks)
                
                console.print()
                console.print(Panel.fit(
                    f'[bold]📈 BREAKOUT ANALYSIS SUMMARY:[/bold]\n'
                    f'• Total Candidates: [cyan]{total_stocks}[/cyan]\n'
                    f'• Average Gap to High: [yellow]{avg_gap:.2f}%[/yellow]\n'
                    f'• Average RSI: [green]{avg_rsi:.0f}[/green]\n'
                    f'• Immediate Breakouts: [red]{len(immediate_candidates)}[/red] (≤3% gap)\n'
                    f'• High Momentum: [yellow]{len(high_momentum)}[/yellow] (RSI ≥ 65)',
                    style='blue'
                ))
                
                # Trading strategy recommendations
                console.print()
                console.print(Panel.fit(
                    '💡 [bold green]TRADING STRATEGY:[/bold green]\n'
                    '🔥 IMMEDIATE: Buy stocks ≤3% from high with high volume\n'
                    '👀 WATCH LIST: Monitor stocks 3-5% from high\n'
                    '⏳ WAIT: Consider stocks 5-10% from high for pullback entry\n'
                    '\n[bold]RISK MANAGEMENT:[/bold]\n'
                    '• Use stop-loss 3-5% below entry\n'
                    '• Take profits at new high + 5-10%\n'
                    '• Position size: 1-2% per trade',
                    style='green'
                ))
                
                # Export to CSV
                filename = f'52_week_high_breakout_{pd.Timestamp.now().strftime("%Y%m%d_%H%M")}.csv'
                near_high_stocks.to_csv(filename, index=False)
                console.print(f'[dim]💾 Data saved to: {filename}[/dim]')
                
            else:
                console.print('[yellow]⚠️ No stocks found near 52-week highs matching criteria[/yellow]')
                console.print('[dim]Try relaxing filters (lower RSI range or volume requirements)[/dim]')
                
        else:
            console.print('[yellow]⚠️ No data found for 52-week high analysis[/yellow]')
            
    except Exception as e:
        console.print(f'[red]❌ Error: {str(e)}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='52-Week High Breakout Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us',
                        help='Market to scan: us (america) or india')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    find_near_52_week_high(market)
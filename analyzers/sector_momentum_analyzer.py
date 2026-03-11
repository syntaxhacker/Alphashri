#!/usr/bin/env python3
"""
Sector Momentum Analyzer
Analyze momentum across different sectors to identify rotation opportunities
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse
import numpy as np

console = Console()

def analyze_sector_momentum(market='america'):
    """
    Analyze momentum across different sectors

    Args:
        market (str): Market to analyze ('america' or 'india')
    """
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('📊 SECTOR MOMENTUM ANALYZER', style='bold blue'))

    try:
        # Get comprehensive sector data
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'market_cap_basic', 'sector',
                'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'Perf.YTD',
                'RSI', 'MACD.macd', 'MACD.signal', 'ADX',
                'relative_volume_10d_calc', 'average_volume_10d_calc',
                'change', 'description'
            )
            .set_markets(market)
            .where(
                col('market_cap_basic') >= 100000000,    # Min $100M market cap
                col('volume') > 100000,                  # Min volume
                col('close') > 1,                        # Positive price
                col('sector') != '',                     # Must have sector data
            )
            .order_by(col('Perf.3M'), ascending=False)  # Sort by 3M performance
            .limit(500)  # Get more stocks for better sector representation
            .get_scanner_data()
        )

        if df.empty:
            console.print('[yellow]⚠️ No sector data found[/yellow]')
            return

        # Clean and prepare data
        df = df.dropna(subset=['sector', 'Perf.W', 'Perf.3M', 'Perf.6M'])
        df['market_cap_billions'] = (df['market_cap_basic'] / 1000000000).round(2)
        df['volume_in_millions'] = (df['volume'] / 1000000).round(2)

        # Group by sector and calculate metrics
        sector_analysis = []

        for sector_name, sector_data in df.groupby('sector'):
            if len(sector_data) < 3:  # Need at least 3 stocks per sector
                continue

            # Calculate sector metrics
            sector_metrics = {
                'sector': sector_name,
                'stock_count': len(sector_data),
                'avg_market_cap': sector_data['market_cap_billions'].mean(),
                'total_market_cap': sector_data['market_cap_basic'].sum(),
                'avg_price': sector_data['close'].mean(),
                'avg_volume': sector_data['volume_in_millions'].mean(),

                # Performance metrics
                'avg_perf_w': sector_data['Perf.W'].mean(),
                'avg_perf_3m': sector_data['Perf.3M'].mean(),
                'avg_perf_6m': sector_data['Perf.6M'].mean(),
                'avg_perf_y': sector_data['Perf.Y'].mean(),
                'avg_perf_ytd': sector_data['Perf.YTD'].mean(),

                # Technical indicators
                'avg_rsi': sector_data['RSI'].mean(),
                'avg_adx': sector_data['ADX'].mean(),
                'macd_bullish': (sector_data['MACD.macd'] > sector_data['MACD.signal']).sum(),
                'macd_bearish': (sector_data['MACD.macd'] < sector_data['MACD.signal']).sum(),

                # Volume momentum
                'avg_relative_volume': sector_data['relative_volume_10d_calc'].mean(),

                # Top stocks in sector
                'top_stocks': sector_data.nlargest(3, 'Perf.3M')[['name', 'close', 'Perf.3M', 'RSI']].to_dict('records')
            }

            # Calculate momentum score for sector
            sector_metrics['momentum_score'] = calculate_sector_momentum_score(sector_metrics)
            sector_analysis.append(sector_metrics)

        if not sector_analysis:
            console.print('[yellow]⚠️ No sectors with sufficient data found[/yellow]')
            return

        # Convert to DataFrame and sort by momentum score
        sector_df = pd.DataFrame(sector_analysis)
        sector_df = sector_df.sort_values('momentum_score', ascending=False)

        # Display results
        display_sector_analysis(sector_df, currency)

        # Export to CSV
        filename = f'sector_momentum_analysis_{pd.Timestamp.now().strftime("%Y%m%d_%H%M")}.csv'
        sector_df.to_csv(filename, index=False)
        console.print(f'[dim]💾 Sector analysis saved to: {filename}[/dim]')

    except Exception as e:
        console.print(f'[red]❌ Error: {str(e)}[/red]')

def calculate_sector_momentum_score(sector_metrics):
    """
    Calculate overall momentum score for a sector

    Args:
        sector_metrics (dict): Sector performance metrics

    Returns:
        float: Momentum score (0-100)
    """
    score = 0

    # Performance weighting (40 points)
    score += min(sector_metrics['avg_perf_3m'] * 2, 20)  # 3M performance (up to 20 pts)
    score += min(sector_metrics['avg_perf_w'] * 10, 10)   # Weekly performance (up to 10 pts)
    score += min(sector_metrics['avg_perf_6m'] * 0.5, 10) # 6M performance (up to 10 pts)

    # Technical strength (30 points)
    score += min(sector_metrics['avg_rsi'] / 2, 15)       # RSI contribution (up to 15 pts)
    score += min(sector_metrics['avg_adx'] / 3, 10)       # ADX contribution (up to 10 pts)
    score += (sector_metrics['macd_bullish'] / (sector_metrics['macd_bullish'] + sector_metrics['macd_bearish'] + 1)) * 5  # MACD bullish % (up to 5 pts)

    # Volume momentum (20 points)
    score += min(sector_metrics['avg_relative_volume'] * 3, 20)  # Relative volume (up to 20 pts)

    # Market participation (10 points)
    score += min(sector_metrics['stock_count'] * 2, 10)   # Stock count contribution (up to 10 pts)

    return round(min(score, 100), 1)

def display_sector_analysis(sector_df, currency):
    """Display comprehensive sector analysis"""

    console.print(f'[bold green]🎯 Found {len(sector_df)} sectors with momentum data![/bold green]\n')

    # Top sectors table
    table = Table(title='🚀 TOP SECTORS BY MOMENTUM', show_header=True, header_style='bold cyan')
    table.add_column('Sector', style='cyan', width=20)
    table.add_column('Stocks', style='white', width=8)
    table.add_column('Mom Score', style='bold red', width=10)
    table.add_column('3M Perf %', style='green', width=10)
    table.add_column('Avg RSI', style='magenta', width=8)
    table.add_column('Rel Vol', style='yellow', width=8)
    table.add_column('Action', style='bold green', width=10)

    for _, sector in sector_df.head(10).iterrows():
        momentum_score = sector['momentum_score']
        perf_3m = sector['avg_perf_3m']

        # Action based on momentum score and performance
        if momentum_score >= 70 and perf_3m > 5:
            action = '[bold green]BUY[/bold green]'
            emoji = '🔥'
        elif momentum_score >= 60 and perf_3m > 0:
            action = '[bold yellow]WATCH[/bold yellow]'
            emoji = '👀'
        else:
            action = '[dim]AVOID[/dim]'
            emoji = '⚠️'

        table.add_row(
            sector['sector'][:18],
            str(int(sector['stock_count'])),
            f'{emoji} {momentum_score:.1f}',
            f'{perf_3m:.1f}%',
            f'{sector["avg_rsi"]:.0f}',
            f'{sector["avg_relative_volume"]:.1f}',
            action
        )

    console.print(table)
    console.print()

    # Sector rotation insights
    display_sector_rotation_insights(sector_df, currency)

    # Top stocks by sector
    display_top_stocks_by_sector(sector_df, currency)

def display_sector_rotation_insights(sector_df, currency):
    """Display sector rotation analysis"""

    # Strongest sectors (top 3)
    top_sectors = sector_df.head(3)
    top_sector_names = [sector['sector'] for _, sector in top_sectors.iterrows()]

    # Weakest sectors (bottom 3)
    bottom_sectors = sector_df.tail(3)
    bottom_sector_names = [sector['sector'] for _, sector in bottom_sectors.iterrows()]

    # Sector rotation panel
    rotation_text = f"""
[bold green]🔄 SECTOR ROTATION INSIGHTS:[/bold green]

[bold red]🔥 STRONGEST SECTORS (Consider Overweight):[/bold red]
{chr(10).join([f'• {sector["sector"]}: {sector["avg_perf_3m"]:.1f}% (3M), Score: {sector["momentum_score"]:.1f}' for _, sector in top_sectors.iterrows()])}

[bold yellow]⚠️ WEAKEST SECTORS (Consider Underweight):[/bold yellow]
{chr(10).join([f'• {sector["sector"]}: {sector["avg_perf_3m"]:.1f}% (3M), Score: {sector["momentum_score"]:.1f}' for _, sector in bottom_sectors.iterrows()])}

[bold blue]💡 ROTATION STRATEGY:[/bold blue]
• Rotate capital from weak sectors to strong sectors
• Focus on sectors with high momentum scores (>60)
• Monitor relative strength vs market benchmark
• Consider sector ETFs for broad exposure
"""

    console.print(Panel.fit(rotation_text, style='blue'))

def display_top_stocks_by_sector(sector_df, currency):
    """Display top stocks within each sector"""

    console.print(Panel.fit('[bold]📈 TOP STOCKS BY SECTOR[/bold]', style='cyan'))

    for _, sector in sector_df.head(5).iterrows():  # Top 5 sectors
        sector_name = sector['sector']
        top_stocks = sector['top_stocks']

        if top_stocks:
            stocks_text = '\n'.join([
                f'• {stock["name"]}: {currency}{stock["close"]:.2f} ({stock["Perf.3M"]:.1f}% 3M, RSI: {stock["RSI"]:.0f})'
                for stock in top_stocks
            ])

            console.print(Panel.fit(
                f'[bold cyan]{sector_name.upper()} (Score: {sector["momentum_score"]:.1f})[/bold cyan]\n{stocks_text}',
                style='cyan'
            ))

def main():
    parser = argparse.ArgumentParser(description='Sector Momentum Analyzer')
    parser.add_argument('--market', choices=['us', 'india'], default='us',
                        help='Market to analyze: us (america) or india')
    args = parser.parse_args()

    market = 'america' if args.market == 'us' else 'india'
    analyze_sector_momentum(market)

if __name__ == '__main__':
    main()
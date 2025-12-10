#!/usr/bin/env python3
"""
52-Week High Breakout Scanner
Find stocks near 52-week highs for potential long positions
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
import pandas as pd
import argparse
import finnhub
import time
import threading
from queue import Queue

console = Console()

# Initialize Finnhub client
finnhub_client = finnhub.Client(api_key="d3mkpb1r01qmso349jk0d3mkpb1r01qmso349jkg")

# Rate limiting and thread safety
api_lock = threading.Lock()
last_api_call = 0
MIN_API_INTERVAL = 0.1  # 100ms between API calls

def rate_limited_api_call(func, *args, **kwargs):
    """Rate limited API call with thread safety"""
    global last_api_call
    
    with api_lock:
        current_time = time.time()
        time_since_last = current_time - last_api_call
        
        if time_since_last < MIN_API_INTERVAL:
            time.sleep(MIN_API_INTERVAL - time_since_last)
        
        try:
            result = func(*args, **kwargs)
            last_api_call = time.time()
            return result
        except Exception as e:
            last_api_call = time.time()
            raise e

def get_finnhub_data(symbol):
    """Get current price and 52-week high from Finnhub"""
    try:
        quote = rate_limited_api_call(finnhub_client.quote, symbol)
        financials = rate_limited_api_call(finnhub_client.company_basic_financials, symbol, 'all')
        
        current_price = quote.get('c', 0)
        high_52_week = 0
        
        if financials and 'metric' in financials:
            high_52_week = financials['metric'].get('52WeekHigh', 0)
            
        return {
            'current_price': current_price,
            'high_52_week': high_52_week
        }
    except Exception as e:
        # console.print(f"[dim]Error fetching Finnhub data for {symbol}: {e}[/dim]")
        return None

def find_near_52_week_high(market='america'):
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('🚀 52-WEEK HIGH BREAKOUT SCANNER', style='bold blue'))
    
    try:
        with console.status("[bold green]Scanning TradingView for candidates..."):
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
            # Calculate distance to 52-week high (initial TV data)
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
                
                # Take top 20 for Finnhub verification
                top_candidates = near_high_stocks.head(20).copy()
                
                console.print(f'[bold green]🎯 Found {len(near_high_stocks)} initial candidates. Verifying top {len(top_candidates)} with Finnhub...[/bold green]')
                console.print()
                
                # Verify with Finnhub
                verified_data = []
                
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    console=console
                ) as progress:
                    task = progress.add_task("Fetching Finnhub data...", total=len(top_candidates))
                    
                    for index, row in top_candidates.iterrows():
                        symbol = row['name']
                        progress.update(task, description=f"Verifying {symbol}...")
                        
                        fh_data = get_finnhub_data(symbol)
                        
                        if fh_data and fh_data['high_52_week'] > 0:
                            fh_price = fh_data['current_price']
                            fh_high = fh_data['high_52_week']
                            
                            # Recalculate gap
                            fh_gap_pct = ((fh_high - fh_price) / fh_high) * 100
                            
                            # Check if touched (allow small margin of error or if price >= high)
                            touched = fh_price >= fh_high or fh_gap_pct <= 0.1
                            
                            verified_data.append({
                                'index': index,
                                'fh_price': fh_price,
                                'fh_high': fh_high,
                                'fh_gap_pct': fh_gap_pct,
                                'touched': touched
                            })
                        
                        progress.advance(task)
                
                # Merge verified data back
                for item in verified_data:
                    idx = item['index']
                    top_candidates.at[idx, 'close'] = item['fh_price']
                    top_candidates.at[idx, 'price_52_week_high'] = item['fh_high']
                    top_candidates.at[idx, 'distance_to_high_pct'] = item['fh_gap_pct']
                    top_candidates.at[idx, 'touched_52w_high'] = item['touched']

                # Filter out any that failed verification (optional, or just keep TV data if FH failed)
                # For now we keep them but they won't have 'touched_52w_high' set if failed
                
                # Sort: Untouched first (False), Touched last (True). 
                # Secondary sort: Gap % (smaller gap first)
                if 'touched_52w_high' not in top_candidates.columns:
                     top_candidates['touched_52w_high'] = False
                top_candidates['touched_52w_high'] = top_candidates['touched_52w_high'].fillna(False)
                
                top_candidates = top_candidates.sort_values(
                    by=['touched_52w_high', 'distance_to_high_pct'], 
                    ascending=[True, True]
                )

                # Create results table
                table = Table(title='📈 TOP BREAKOUT CANDIDATES - Verified with Finnhub', show_header=True, header_style='bold cyan')
                table.add_column('Stock', style='cyan', width=18)
                table.add_column(f'Price {currency}', style='bold white', width=10)
                table.add_column(f'52W High {currency}', style='blue', width=10)
                table.add_column('Gap %', style='yellow', width=8)
                table.add_column('RSI', style='magenta', width=5)
                table.add_column('Change %', style='green', width=8)
                table.add_column('Volume (M)', style='white', width=10)
                table.add_column('Status', style='bold', width=12)
                table.add_column('Action', style='bold green', width=8)
                
                for _, stock in top_candidates.iterrows():
                    gap_pct = stock['distance_to_high_pct']
                    breakout_score = int(stock['breakout_score'])
                    touched = stock.get('touched_52w_high', False)
                    
                    # Action recommendations based on gap
                    if touched:
                        status = '[bold magenta]TOUCHED![/bold magenta]'
                        action = '[bold green]BUY/HOLD[/bold green]'
                        emoji = '🚀'
                    elif gap_pct <= 2:
                        status = 'Very Close'
                        action = '[bold green]BUY[/bold green]'
                        emoji = '🔥'
                    elif gap_pct <= 5:
                        status = 'Near'
                        action = '[bold yellow]WATCH[/bold yellow]'
                        emoji = '👀'
                    else:
                        status = 'Approaching'
                        action = '[dim]WAIT[/dim]'
                        emoji = '⏳'
                    
                    table.add_row(
                        stock['name'][:16],
                        f'{currency}{stock["close"]:.2f}',
                        f'{currency}{stock["price_52_week_high"]:.2f}',
                        f'{gap_pct:.2f}%',
                        f'{stock["RSI"]:.0f}',
                        f'+{stock["change"]:.2f}%',
                        f'{stock["volume_in_millions"]:.1f}M',
                        status,
                        action
                    )
                
                console.print(table)
                
                # Export to CSV
                filename = f'52_week_high_breakout_{pd.Timestamp.now().strftime("%Y%m%d_%H%M")}.csv'
                top_candidates.to_csv(filename, index=False)
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
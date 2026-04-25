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
import yfinance as yf
import time
import threading
import requests
import warnings
from queue import Queue
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scanner_utils import display_tradingview_csv

console = Console()

# Suppress pandas future warnings
warnings.simplefilter(action='ignore', category=FutureWarning)
pd.set_option('future.no_silent_downcasting', True)

def get_yfinance_data(symbol):
    """Get current price and true 52-week high from 1-year history"""
    try:
        ticker = yf.Ticker(symbol)
        
        # 1. Fetch history for the last 1 year to calculate the True 52-week high
        # This is more reliable than 'info' which can be stale or adjusted differently.
        # We use auto_adjust=True to stay consistent with modern charting.
        hist = ticker.history(period='1y', auto_adjust=True)
        
        if hist.empty:
            return None
            
        high_52_week = hist['High'].max()
        
        # 2. Get current price
        # Try fast_info first, fallback to last history close
        try:
            current_price = ticker.fast_info.last_price
        except:
            current_price = hist['Close'].iloc[-1]
            
        # 3. Get daily high
        daily_high = hist['High'].iloc[-1]
        
        # 4. Find the most recent date when the high_52_week was touched
        # We look for the last index where High is within 0.1% of the 52W Max
        high_mask = hist['High'] >= (high_52_week * 0.999)
        if not any(high_mask):
            days_since_high = 0
        else:
            last_high_date = hist.index[high_mask][-1]
            days_since_high = (pd.Timestamp.now(tz=last_high_date.tz) - last_high_date).days
        
        # 5. Get last 5 days high for "Recently Touched" logic
        # history(period='1y') already covers this, so we just take max of last 5 rows
        recent_max_high = hist['High'].tail(5).max()
            
        return {
            'current_price': current_price,
            'daily_high': daily_high,
            'high_52_week': high_52_week,
            'five_day_max_high': recent_max_high,
            'days_since_high': days_since_high
        }
    except Exception:
        return None

def find_near_52_week_high(market='america', limit=20):
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
                    'RSI', 'sector', 'description', 'update_mode',
                    'average_volume_10d_calc', 'SMA50', 'SMA200'
                )
                .set_markets(market)
                .where(
                    col('close') >= 10,                     # No penny stocks
                    col('market_cap_basic') >= 500000000,   # Min $500M market cap
                    col('volume') > 1000000,                # Min 1M volume
                    col('close') > 10,                     # Positive price
                    col('RSI').between(45, 75),            # Not overbought/oversold
                    col('change') >= 0.5,                  # Positive momentum
                    col('close') > col('SMA50'),           # Price above 50 SMA
                    col('SMA50') > col('SMA200')           # 50 SMA above 200 SMA (Uptrend)
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
            
            # Calculate Relative Volume (RVol)
            df['average_volume_10d_calc'] = df['average_volume_10d_calc'].fillna(df['volume']) # Fallback
            df['rvol'] = (df['volume'] / df['average_volume_10d_calc']).round(2)

            # Filter for stocks within 10% of 52-week high
            near_high_stocks = df[df['distance_to_high_pct'] <= 10].copy()
            
            if not near_high_stocks.empty:
                # Calculate breakout potential score
                near_high_stocks['breakout_score'] = 0
                
                # High score if very close to high (within 3%)
                near_high_stocks.loc[near_high_stocks['distance_to_high_pct'] <= 3, 'breakout_score'] += 50
                
                # Bonus for high volume
                near_high_stocks['breakout_score'] += (near_high_stocks['volume_in_millions'] * 2).astype(int)
                
                # Bonus for high RVol
                near_high_stocks.loc[near_high_stocks['rvol'] > 1.5, 'breakout_score'] += 25
                near_high_stocks.loc[near_high_stocks['rvol'] > 2.0, 'breakout_score'] += 15
                
                # Bonus for large market cap
                near_high_stocks['breakout_score'] += (near_high_stocks['market_cap_billions'] * 3).astype(int)
                
                # Bonus for strong RSI (above 60)
                near_high_stocks.loc[near_high_stocks['RSI'] >= 60, 'breakout_score'] += 30
                
                # Bonus for good daily change (above 2%)
                near_high_stocks.loc[near_high_stocks['change'] >= 2, 'breakout_score'] += 20
                
                # Sort by breakout score and distance to high
                near_high_stocks = near_high_stocks.sort_values(['breakout_score', 'distance_to_high_pct'], ascending=[False, True])
                
                # Deduplicate and take top candidates for yfinance verification
                top_candidates = near_high_stocks.drop_duplicates(subset=['name']).head(limit).copy()
                
                console.print(f'[bold green]🎯 Found {len(near_high_stocks)} initial candidates. Verifying top {len(top_candidates)} with yfinance...[/bold green]')
                console.print()
                
                # Verify with yfinance
                verified_data = []
                
                with Progress(
                    SpinnerColumn(),
                    TextColumn("[progress.description]{task.description}"),
                    console=console
                ) as progress:
                    task = progress.add_task("Fetching yfinance data...", total=len(top_candidates))
                    
                    for index, row in top_candidates.iterrows():
                        symbol = row['name']
                        progress.update(task, description=f"Verifying {symbol}...")
                        
                        # Fix for Indian market mapping in yfinance
                        yf_symbol = symbol
                        if market == 'india':
                            yf_symbol = f"{symbol}.NS"
                            
                        yf_data = get_yfinance_data(yf_symbol)
                        
                        if yf_data:
                            yf_price = yf_data['current_price']
                            yf_high_metric = yf_data['high_52_week']
                            yf_daily_high = yf_data['daily_high']
                            yf_5day_high = yf_data.get('five_day_max_high', 0)
                            
                            # Robust 52W High Truth: 
                            # TV high + 1Y History max
                            tv_high = row['price_52_week_high']
                            final_52w_high = max(tv_high, yf_high_metric)
                            
                            # Recalculate gap using our "Absolute High" truth
                            yf_gap_pct = ((final_52w_high - yf_price) / final_52w_high) * 100 if final_52w_high > 0 else 0
                            
                            # Status flags
                            is_new_high = yf_price >= final_52w_high or abs(yf_price - final_52w_high) < 0.01
                            touched = is_new_high or yf_daily_high >= final_52w_high or yf_5day_high >= final_52w_high or yf_gap_pct <= 0.5
                            
                            verified_data.append({
                                'index': index,
                                'yf_price': yf_price,
                                'yf_high': final_52w_high,
                                'yf_gap_pct': yf_gap_pct,
                                'touched': touched,
                                'is_new_high': is_new_high,
                                'days_since_high': yf_data.get('days_since_high', 0)
                            })
                        
                        progress.advance(task)
                
                # Merge verified data back
                # Initialize columns with defaults to prevent NaN issues
                top_candidates['touched_52w_high'] = False
                top_candidates['is_new_high'] = False
                top_candidates['days_since_high'] = 0
                
                for item in verified_data:
                    idx = item['index']
                    top_candidates.at[idx, 'close'] = item['yf_price']
                    top_candidates.at[idx, 'price_52_week_high'] = item['yf_high']
                    top_candidates.at[idx, 'distance_to_high_pct'] = item['yf_gap_pct']
                    top_candidates.at[idx, 'touched_52w_high'] = item['touched']
                    top_candidates.at[idx, 'is_new_high'] = item.get('is_new_high', False)
                    top_candidates.at[idx, 'days_since_high'] = item.get('days_since_high', 0)

                # Sorting: Breakout stocks first
                # Group 1: New Highs/Touched (True) - prioritized at bottom for now as per previous instruction, 
                # but I will keep those with smaller gaps higher in their groups.
                top_candidates['touched_52w_high'] = top_candidates['touched_52w_high'].fillna(False)
                
                top_candidates = top_candidates.sort_values(
                    by=['touched_52w_high', 'distance_to_high_pct'], 
                    ascending=[True, True]
                )

                # Create results table
                table = Table(title='📈 TOP BREAKOUT CANDIDATES - Verified with yfinance', show_header=True, header_style='bold cyan')
                table.add_column('Stock', style='cyan', width=14)
                table.add_column(f'Price {currency}', style='bold white', width=10)
                table.add_column(f'52W High {currency}', style='blue', width=10)
                table.add_column('Gap %', style='yellow', width=8)
                table.add_column('RVol', style='magenta', width=6)
                table.add_column('Days Ago', style='dim cyan', width=8)
                table.add_column('Stop Loss', style='red', width=10)
                table.add_column('Target', style='green', width=10)
                table.add_column('Status', style='bold', width=12)
                table.add_column('Action', style='bold green', width=8)
                
                for _, stock in top_candidates.iterrows():
                    gap_pct = stock['distance_to_high_pct']
                    breakout_score = int(stock['breakout_score'])
                    touched = stock.get('touched_52w_high', False)
                    rvol = stock.get('rvol', 1.0)
                    price = stock['close']
                    high_52 = stock['price_52_week_high']
                    
                    # Safety check for NaN values before integer conversion
                    try:
                        days_ago_val = stock.get('days_since_high', 0)
                        days_ago = int(days_ago_val) if pd.notnull(days_ago_val) else 0
                    except:
                        days_ago = 0
                    
                    # Smart Stop Loss & Target
                    # Stop: 5% below price (or use SMA50 if available and closer, but keeping it simple for now)
                    stop_loss = price * 0.95
                    
                    # Target: If touched, target is 5-10% above current price. If not, target is 52W high + breakout
                    if touched:
                        target = price * 1.10
                    else:
                        target = high_52 * 1.05 # Breakout target
                    
                    # Action recommendations based on gap
                    is_new_high = stock.get('is_new_high', False)
                    
                    if is_new_high:
                        status = '[bold white on green] NEW HIGH! [/bold white on green]'
                        action = '[bold green]HOT HOLD[/bold green]'
                        emoji = '🌟'
                    elif touched:
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
                    
                    # RVol Color
                    if rvol >= 2.0:
                        rvol_str = f'[bold green]{rvol:.1f}x[/bold green]'
                    elif rvol >= 1.5:
                        rvol_str = f'[green]{rvol:.1f}x[/green]'
                    else:
                        rvol_str = f'{rvol:.1f}x'

                    table.add_row(
                        stock['name'][:16],
                        f'{currency}{stock["close"]:.2f}',
                        f'{currency}{stock["price_52_week_high"]:.2f}',
                        f'{gap_pct:.2f}%',
                        rvol_str,
                        f'{days_ago}d',
                        f'{currency}{stop_loss:.2f}',
                        f'{currency}{target:.2f}',
                        status,
                        action
                    )
                
                console.print(table)

                # TradingView-compatible CSV output for copy-paste
                display_tradingview_csv(top_candidates)

                # Export to CSV
                filename = f'52_week_high_breakout_{pd.Timestamp.now().strftime("%Y%m%d_%H%M")}.csv'
                # Add calculated columns to export
                top_candidates['stop_loss'] = top_candidates['close'] * 0.95
                top_candidates['target_price'] = top_candidates.apply(lambda x: x['close'] * 1.10 if x['touched_52w_high'] else x['price_52_week_high'] * 1.05, axis=1)

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
    parser.add_argument('--limit', type=int, default=20,
                        help='Number of results to show (default: 20, max: 100)')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    limit = min(args.limit, 100)  # Cap at 100 to avoid excessive API calls
    find_near_52_week_high(market, limit)
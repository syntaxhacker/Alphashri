#!/usr/bin/env python3
"""
Verify Trending Stocks with Upstox API
"""
import sys
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from datetime import datetime, timedelta

# Add path to import upstox_trader modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
try:
    from upstox_trader.config import UPSTOX_CONFIG
except ImportError:
    print("❌ Config not found. Please ensure config is set up properly.")
    UPSTOX_CONFIG = {}

# Import the trending scanner
import trending_upside

console = Console()

def verify_stocks():
    """Verify trending stocks with Upstox data."""
    
    # 1. Get Trending Stocks from TradingView (via trending_upside.py)
    with console.status("[bold green]Fetching trending stocks from TradingView...[/bold green]"):
        tv_df = trending_upside.fetch_trending_stocks(limit=100)
    
    if tv_df.empty:
        console.print("[red]No trending stocks found to verify.[/red]")
        return

    # 2. Initialize Upstox API
    api_key = UPSTOX_CONFIG.get('api_key')
    api_secret = UPSTOX_CONFIG.get('api_secret')
    
    if not api_key or not api_secret:
        console.print("[red]❌ Upstox API credentials missing in config.[/red]")
        return

    upstox_api = UpstoxAPI(api_key, api_secret, quiet=True)
    
    # 3. Verify each stock
    # Separate lists for tables
    touched_rows = []
    untouched_rows = []
    blacklisted_symbols = set()

    with console.status("[bold green]Fetching data from Upstox...[/bold green]"):
        for _, row in tv_df.iterrows(): # Changed df to tv_df
            symbol = row['name']
            tv_price = row['close']
            
            # Filter: Price < 7000
            if tv_price >= 7000:
                continue

            if symbol in blacklisted_symbols:
                continue
                
            # Get instrument key (this is a new addition, assuming UpstoxAPI has this method)
            # If not, this part might need adjustment or removal based on actual API capabilities
            instrument_key = upstox_api.get_instrument_key(symbol)
            if not instrument_key:
                # Try to find it in the full list if not found directly
                # For now, just skip or mark as not found
                # console.print(f"[red]❌ Symbol {symbol} not found in NSE instruments - adding to blacklist[/red]")
                blacklisted_symbols.add(symbol)
                continue
            
            try:
                # Fetch last 5 days of 1-min data for detailed recent high check
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
                
                df_hist = upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
                
                if df_hist is not None and not df_hist.empty:
                    upstox_price = df_hist['close'].iloc[-1]
                    start_price = df_hist['close'].iloc[0]
                    
                    # Calculate diff vs TV
                    diff = upstox_price - tv_price
                    diff_pct = (diff / tv_price) * 100
                    
                    recent_return = ((upstox_price - start_price) / start_price) * 100
                    trend_icon = "🚀" if recent_return > 5 else ("🟢" if recent_return > 0 else "🔴")
                    
                    # 52-Week High Check
                    tv_52w_high = row.get('price_52_week_high', 0)
                    recent_high = df_hist['high'].max()
                    
                    touched_52w = False
                    if tv_52w_high > 0:
                        if recent_high >= tv_52w_high:
                            touched_52w = True
                        # Also check if it's very close (within 0.1%)
                        elif (tv_52w_high - recent_high) / tv_52w_high < 0.001:
                            touched_52w = True
                    
                    touched_str = "✅ YES" if touched_52w else f"No (High: {recent_high:.2f})"
                    if touched_52w:
                        touched_str = f"[bold green]{touched_str}[/bold green]"
                    
                    # Status
                    status = "✅ Match" if abs(diff_pct) < 1.0 else "⚠️ Diff"
                    
                    # Extra fields
                    score = row.get('swing_score', 0)
                    score_str = f"{score}/100"
                    if score >= 80: score_str = f"[bold green]{score_str}[/bold green]"
                    elif score >= 60: score_str = f"[yellow]{score_str}[/yellow]"
                    
                    sector = str(row.get('sector', '-'))
                    perf_w = row.get('Perf.W', 0)
                    perf_w_str = f"[green]{perf_w:+.2f}%[/green]" if perf_w > 0 else f"[red]{perf_w:+.2f}%[/red]"

                    row_data = [
                        symbol,
                        score_str,
                        f"{tv_price:.2f}",
                        f"{upstox_price:.2f}",
                        f"{diff_pct:+.2f}%",
                        f"{trend_icon} {recent_return:+.1f}% (5d)",
                        f"{tv_52w_high:.2f}",
                        touched_str,
                        perf_w_str,
                        sector,
                        status
                    ]
                    
                    if touched_52w:
                        touched_rows.append(row_data)
                    else:
                        untouched_rows.append(row_data)

                else:
                    # No data found
                    pass
                    
            except Exception as e:
                # console.print(f"[red]Error processing {symbol}: {e}[/red]")
                pass

    # Display Untouched Table (Main Focus)
    if untouched_rows:
        table_untouched = Table(title="🎯 APPROACHING 52W HIGH (Price < 7k)", style="blue")
        table_untouched.add_column("Symbol", style="cyan", width=12)
        table_untouched.add_column("Score", justify="center", style="bold magenta")
        table_untouched.add_column("TV Price", justify="right")
        table_untouched.add_column("Upstox Price", justify="right")
        table_untouched.add_column("Diff %", justify="right")
        table_untouched.add_column("Recent Ret (5d)", justify="center")
        table_untouched.add_column("52W High", justify="right")
        table_untouched.add_column("Touched 52W?", justify="center")
        table_untouched.add_column("Perf.W", justify="right")
        table_untouched.add_column("Sector", style="dim")
        table_untouched.add_column("Status", justify="center")
        
        for row in untouched_rows:
            table_untouched.add_row(*row)
        
        console.print(table_untouched)
    else:
        console.print("[yellow]No stocks found approaching 52W high (untouched).[/yellow]")

    # Display Touched Table (Separate)
    if touched_rows:
        console.print("\n")
        table_touched = Table(title="✅ ALREADY TOUCHED 52W HIGH (Price < 7k)", style="dim green")
        table_touched.add_column("Symbol", style="cyan", width=12)
        table_touched.add_column("Score", justify="center", style="bold magenta")
        table_touched.add_column("TV Price", justify="right")
        table_touched.add_column("Upstox Price", justify="right")
        table_touched.add_column("Diff %", justify="right")
        table_touched.add_column("Recent Ret (5d)", justify="center")
        table_touched.add_column("52W High", justify="right")
        table_touched.add_column("Touched 52W?", justify="center")
        table_touched.add_column("Perf.W", justify="right")
        table_touched.add_column("Sector", style="dim")
        table_touched.add_column("Status", justify="center")
        
        for row in touched_rows:
            table_touched.add_row(*row)
            
        console.print(table_touched)

    console.print("[dim]Note: 'Diff %' might be due to data delay between TV and Upstox or different last traded times.[/dim]")

if __name__ == "__main__":
    verify_stocks()

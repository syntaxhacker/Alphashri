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

def estimate_days_to_52w(current_price, high_52w, adx, atr, recent_return_5d, perf_w):
    """
    Estimate days to reach 52-week high based on trend strength and momentum.

    Args:
        current_price: Current Upstox price
        high_52w: 52-week high price
        adx: ADX trend strength (0-100+)
        atr: Average True Range (volatility)
        recent_return_5d: 5-day return percentage
        perf_w: Weekly performance percentage

    Returns:
        Tuple of (estimated_days, confidence_level)
    """
    if current_price >= high_52w:
        return 0, "HIGH"

    gap_pct = ((high_52w - current_price) / current_price) * 100

    # Skip if gap is too large (>15%)
    if gap_pct > 15:
        return None, None

    # Calculate momentum score (combination of 5d and weekly performance)
    momentum_score = (recent_return_5d + perf_w) / 2

    # Base daily move estimate from ATR
    daily_move_pct = (atr / current_price) * 100 if atr > 0 else 0

    # Adjust daily move based on ADX (trend strength)
    # ADX > 40 = strong trend, ADX < 20 = weak/raging
    trend_multiplier = 1.0
    if adx >= 40:
        trend_multiplier = 1.5  # Strong trend - faster movement
    elif adx >= 25:
        trend_multiplier = 1.2  # Trending
    elif adx < 20:
        trend_multiplier = 0.7  # Weak/ranging - slower movement

    # Use momentum if positive and larger than ATR-based estimate
    if momentum_score > 0:
        daily_gain_pct = max(daily_move_pct * trend_multiplier, (momentum_score / 5) * trend_multiplier)
    else:
        daily_gain_pct = daily_move_pct * trend_multiplier * 0.5  # Reduce if negative momentum

    # If no meaningful positive movement expected
    if daily_gain_pct <= 0.01:
        return None, None

    # Calculate days
    estimated_days = gap_pct / daily_gain_pct

    # Determine confidence based on ADX and momentum alignment
    confidence = "LOW"
    if adx >= 35 and momentum_score > 2:
        confidence = "HIGH"  # Strong trend + positive momentum
    elif adx >= 25 or (momentum_score > 1 and perf_w > 0):
        confidence = "MED"  # Moderate trend or positive momentum

    return round(estimated_days), confidence

console = Console()

def verify_stocks(use_intraday=False):
    """
    Verify trending stocks with Upstox data.

    Args:
        use_intraday (bool): If True, use fetch_intraday_data for same-day data.
                           If False, use fetch_historical_data_v3 (default).
    """

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

    # For intraday mode, we need authentication enabled and quiet=False to see auth messages
    upstox_api = UpstoxAPI(api_key, api_secret, quiet=not use_intraday)

    # Handle authentication for intraday data (V2 API requires auth)
    if use_intraday:
        if not upstox_api.auth_handler.access_token:
            with console.status("[bold yellow]Authenticating with Upstox for intraday data...[/bold yellow]"):
                if not upstox_api.auth_handler.authenticate():
                    console.print("[red]❌ Authentication failed. Cannot fetch intraday data.[/red]")
                    return
        console.print("[green]✅ Authentication successful[/green]")

    # Display which data method is being used
    data_method = "[green]intraday (same day)[/green]" if use_intraday else "[blue]historical (5 days)[/blue]"
    console.print(f"📊 Using {data_method} data method")
    
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
                # Fetch data based on the use_intraday parameter
                to_date = datetime.now().strftime('%Y-%m-%d')

                if use_intraday:
                    # Use the new fetch_intraday_data_v3 method for true today-only data
                    df_hist = upstox_api.fetch_intraday_data_v3(
                        symbol=symbol,
                        interval='1'
                    )

                    # If no data for today, skip this symbol (correct behavior for intraday mode)
                    if df_hist is None or df_hist.empty:
                        continue

                else:
                    # Use historical data for last 5 days
                    from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
                    df_hist = upstox_api.fetch_historical_data_v3(
                        symbol=symbol,
                        unit='minutes',
                        interval=1,
                        to_date=to_date,
                        from_date=from_date
                    )
                
                if df_hist is not None and not df_hist.empty:
                    # Debug: Show what dates we're getting
                    if use_intraday and len(untouched_rows) < 3:  # Only show for first few stocks
                        first_date = df_hist.index[0].strftime('%Y-%m-%d %H:%M')
                        last_date = df_hist.index[-1].strftime('%Y-%m-%d %H:%M')
                        unique_dates = len(df_hist.index.date)
                        console.print(f"[dim]📊 {symbol}: {len(df_hist)} records, {unique_dates} trading day(s), {first_date} to {last_date}[/dim]")

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

                    # Calculate diff to 52-week high from Upstox data
                    high_diff = recent_high - upstox_price
                    high_diff_pct = (high_diff / recent_high) * 100
                    high_diff_str = f"{high_diff_pct:+.2f}%" if high_diff != 0 else "0.00%"
                    if high_diff_pct < 0:
                        high_diff_str = f"[green]{high_diff_str}[/green]"  # Above 52w high
                    elif high_diff_pct > 0.5:
                        high_diff_str = f"[red]{high_diff_str}[/red]"  # Far below 52w high

                    # Estimate days to reach 52-week high
                    adx = row.get('ADX', 0)
                    atr = row.get('ATR', 0)
                    perf_w = row.get('Perf.W', 0)
                    est_days, confidence = estimate_days_to_52w(
                        upstox_price, recent_high, adx, atr, recent_return, perf_w
                    )
                    if est_days is not None:
                        conf_icon = {"HIGH": "🔥", "MED": "⚡", "LOW": "📍"}.get(confidence, "")
                        time_str = f"{est_days}d {conf_icon}"
                        if confidence == "HIGH":
                            time_str = f"[bold green]{time_str}[/bold green]"
                        elif confidence == "MED":
                            time_str = f"[yellow]{time_str}[/yellow]"
                    else:
                        time_str = "-"

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
                        f"{diff_pct:+.2f}%",  # Broker Diff
                        high_diff_str,  # To 52w High
                        time_str,  # Time to 52w
                        f"{trend_icon} {recent_return:+.1f}% (5d)",
                        f"{tv_52w_high:.2f}",
                        touched_str,
                        perf_w_str,
                        sector,
                        status
                    ]
                    
                    if touched_52w:
                        # For touched stocks, remove: Time to 52w (6), 52W High (8), Touched 52W? (9)
                        # Keep: Symbol, Score, TV Price, Upstox Price, Broker Diff, To 52w High, Recent Ret, Perf.W, Sector, Status
                        touched_row_data = [v for i, v in enumerate(row_data) if i not in {6, 8, 9}]
                        touched_rows.append(touched_row_data)
                    else:
                        untouched_rows.append(row_data)

                else:
                    # No data found
                    pass
                    
            except Exception:
                # console.print(f"[red]Error processing {symbol}[/red]")
                pass

    # Display Untouched Table (Main Focus)
    if untouched_rows:
        table_untouched = Table(title="🎯 APPROACHING 52W HIGH (Price < 7k)", style="blue")
        table_untouched.add_column("Symbol", style="cyan", width=12)
        table_untouched.add_column("Score", justify="center", style="bold magenta")
        table_untouched.add_column("TV Price", justify="right")
        table_untouched.add_column("Upstox Price", justify="right")
        table_untouched.add_column("Broker Diff", justify="right")
        table_untouched.add_column("To 52w High", justify="right")
        table_untouched.add_column("Time to 52w", justify="center")
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
        table_touched.add_column("Broker Diff", justify="right")
        table_touched.add_column("To 52w High", justify="right")
        table_touched.add_column("Recent Ret (5d)", justify="center")
        table_touched.add_column("Perf.W", justify="right")
        table_touched.add_column("Sector", style="dim")
        table_touched.add_column("Status", justify="center")
        
        for row in touched_rows:
            table_touched.add_row(*row)
            
        console.print(table_touched)

    console.print("[dim]Note: 'Broker Diff' shows TV vs Upstox price diff. 'To 52w High' shows pullback from 52-week high (negative = above high). 'Time to 52w' estimates days using ADX/ATR/momentum (🔥=High, ⚡=Med, 📍=Low confidence).[/dim]")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Verify trending stocks with Upstox data")
    parser.add_argument(
        "--intraday",
        action="store_true",
        help="Use intraday data (same day) instead of historical data (5 days)"
    )

    args = parser.parse_args()

    verify_stocks(use_intraday=args.intraday)

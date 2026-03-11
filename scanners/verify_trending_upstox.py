#!/usr/bin/env python3
"""
Verify Trending Stocks with Trading API

Supports multiple providers (Upstox, INDMONEY) via unified interface.
"""
import sys
import os
import pandas as pd
from rich.console import Console
from rich.table import Table
from datetime import datetime, timedelta

# Add project root to path to import upstox_trader modules
_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.abspath(os.path.join(_script_dir, '..'))
sys.path.insert(0, _project_root)

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
try:
    from upstox_trader.config import UPSTOX_CONFIG, INDMONEY_CONFIG
except ImportError:
    print("❌ Config not found. Please ensure config is set up properly.")
    UPSTOX_CONFIG = {}
    INDMONEY_CONFIG = {}

# Import the trending scanner
import trending_upside

def get_52w_action_recommendation(
    score: float,
    distance_to_52w_pct: float,
    adx: float,
    recent_return_5d: float,
    perf_w: float
) -> tuple:
    """
    Get ENTER/AVOID recommendation based on EDA-optimized parameters.

    EDA Optimized Parameters (from 736 approaches analysis):
    - Distance to 52W: 2-3% (closer is better!)
    - Trend Score: > 70 (strong trend required)
    - ADX: > 25 (must be trending)
    - Days since 52W: > 15 (established level)
    - Average time to reach: 6.9 days

    Returns:
        tuple: (action, detailed_reason)
            action: "ENTER" or "AVOID" or "WAIT"
            detailed_reason: explanation with actual parameters
    """

    reasons = []

    # Check 1: Distance to 52W (MOST IMPORTANT - Correlation: -0.18)
    if distance_to_52w_pct <= 2.0:
        reasons.append(("✅", f"Dist: {distance_to_52w_pct:.1f}%"))
    elif distance_to_52w_pct <= 3.0:
        reasons.append(("✅", f"Dist: {distance_to_52w_pct:.1f}%"))
    elif distance_to_52w_pct <= 5.0:
        reasons.append(("⚠️", f"Dist: {distance_to_52w_pct:.1f}%"))
    else:
        reasons.append(("❌", f"Dist: {distance_to_52w_pct:.1f}%"))

    # Check 2: Trend Score (MOST IMPORTANT - Correlation: +0.21)
    if score >= 80:
        reasons.append(("✅", f"Score: {score:.0f}"))
    elif score >= 70:
        reasons.append(("✅", f"Score: {score:.0f}"))
    elif score >= 60:
        reasons.append(("⚠️", f"Score: {score:.0f}"))
    else:
        reasons.append(("❌", f"Score: {score:.0f}"))

    # Check 3: ADX (Correlation: +0.17)
    if adx >= 35:
        reasons.append(("✅", f"ADX: {adx:.0f}"))
    elif adx >= 25:
        reasons.append(("✅", f"ADX: {adx:.0f}"))
    elif adx >= 20:
        reasons.append(("⚠️", f"ADX: {adx:.0f}"))
    elif adx > 0:
        reasons.append(("❌", f"ADX: {adx:.0f}"))

    # Check 4: Momentum
    avg_return = (recent_return_5d + perf_w) / 2
    if avg_return > 3:
        reasons.append(("✅", f"Mom: {avg_return:+.1f}%"))
    elif avg_return > 0:
        reasons.append(("✅", f"Mom: {avg_return:+.1f}%"))
    elif avg_return > -2:
        reasons.append(("⚠️", f"Mom: {avg_return:+.1f}%"))
    else:
        reasons.append(("❌", f"Mom: {avg_return:+.1f}%"))

    # Count checks
    strong_signals = sum(1 for icon, _ in reasons if icon == "✅")
    weak_signals = sum(1 for icon, _ in reasons if icon == "⚠️")
    bad_signals = sum(1 for icon, _ in reasons if icon == "❌")

    # Build detailed reason with all parameters
    reason_parts = [r[1] for r in reasons]
    detailed_reason = ", ".join(reason_parts)

    # Decision logic
    if bad_signals >= 2:
        return "AVOID", detailed_reason
    elif weak_signals >= 3:
        return "WAIT", detailed_reason
    elif strong_signals >= 4:
        return "ENTER", detailed_reason
    elif strong_signals >= 3 and bad_signals == 0:
        return "ENTER", detailed_reason
    elif strong_signals >= 2:
        return "WAIT", detailed_reason
    else:
        return "AVOID", detailed_reason

console = Console()

def verify_stocks(use_intraday=False, provider='upstox', filter_52w_range=None, min_results=7, verbose=False):
    """
    Verify trending stocks with Trading API.

    Args:
        use_intraday (bool): If True, use fetch_intraday_data for same-day data.
                           If False, use fetch_historical_data_v3 (default).
        provider (str): API provider to use ('upstox' or 'indmoney'). Default: 'upstox'.
        filter_52w_range (tuple): Optional tuple (min_pct, max_pct) to filter stocks by
                                  distance to 52-week high percentage. e.g., (2, 5) for
                                  stocks 2-5% away from 52W high.
        min_results (int): Minimum results desired. Will auto-expand filter range if fewer
                          stocks found. Default: 7.
        verbose (bool): If True, show detailed debug output. Default: False.
    """

    # 1. Get Trending Stocks from TradingView (via trending_upside.py)
    with console.status("[bold green]Fetching trending stocks from TradingView...[/bold green]"):
        tv_df = trending_upside.fetch_trending_stocks(limit=100)

    if tv_df.empty:
        console.print("[red]No trending stocks found to verify.[/red]")
        return

    # 2. Initialize Trading API using Factory
    try:
        api = TradingAPIFactory.create_from_config(provider, quiet=not use_intraday)
        console.print(f"[green]✅ Using {provider.upper()} API[/green]")
    except ValueError as e:
        console.print(f"[red]❌ {e}[/red]")
        return

    # Upstox V3 intraday endpoint works without interactive OAuth for market data.
    if use_intraday and provider == 'upstox':
        console.print("[green]✅ Using Upstox V3 intraday data (no interactive auth required)[/green]")

    # Display which data method is being used
    data_method = "[green]intraday (same day)[/green]" if use_intraday else "[blue]historical (5 days)[/blue]"
    console.print(f"📊 Using {data_method} data method")

    # Auto-expand filter if needed to get min_results
    # Pre-check how many stocks match the filter from TradingView data
    if filter_52w_range:
        min_pct, max_pct = filter_52w_range
        tv_df['dist_52w'] = ((tv_df['price_52_week_high'] - tv_df['close']) / tv_df['price_52_week_high'] * 100)
        matching_count = len(tv_df[
            (tv_df['price_52_week_high'] > 0) &
            (tv_df['close'] < 7000) &
            (tv_df['dist_52w'].abs() >= min_pct) &
            (tv_df['dist_52w'].abs() <= max_pct)
        ])

        console.print(f"🔍 Filtering: 52W High Distance = [cyan]{min_pct}% to {max_pct}%[/cyan] ([dim]{matching_count} stocks from TV[/dim])")

        # Auto-expand if fewer than min_results
        expansion_rounds = 0
        max_expansions = 5

        while matching_count < min_results and expansion_rounds < max_expansions:
            # Expand range: lower bound to 0, upper bound +2
            min_pct = 0  # Always include stocks closest to 52W
            max_pct = max_pct + 2

            matching_count = len(tv_df[
                (tv_df['price_52_week_high'] > 0) &
                (tv_df['close'] < 7000) &
                (tv_df['dist_52w'].abs() >= min_pct) &
                (tv_df['dist_52w'].abs() <= max_pct)
            ])

            if matching_count >= min_results:
                console.print(f"[yellow]🔄 Auto-expanded filter to [cyan]{min_pct}% to {max_pct}%[/cyan] ([green]{matching_count} stocks[/green] found)[/yellow]")
                filter_52w_range = (min_pct, max_pct)
                break

            expansion_rounds += 1

        if matching_count < min_results:
            console.print(f"[dim]⚠️  Only {matching_count} stocks found in range (max expansions reached)[/dim]")

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

            # Get instrument key
            instrument_key = api.get_instrument_key(symbol)
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
                    # Use the fetch_intraday_data_v3 method for true today-only data
                    df_hist = api.fetch_intraday_data_v3(
                        symbol=symbol,
                        interval='1'
                    )

                    # If no data for today, skip this symbol (correct behavior for intraday mode)
                    if df_hist is None or df_hist.empty:
                        continue

                else:
                    # Use historical data for last 5 days
                    from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
                    df_hist = api.fetch_historical_data_v3(
                        symbol=symbol,
                        unit='minutes',
                        interval=1,
                        to_date=to_date,
                        from_date=from_date
                    )
                
                if df_hist is not None and not df_hist.empty:
                    # Debug: Show what dates we're getting (only if verbose)
                    if verbose and use_intraday and len(untouched_rows) < 3:  # Only show for first few stocks
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

                    # Calculate diff to 52-week high from TradingView (primary metric)
                    # This is what we use for filtering since it's the actual 52W high
                    tv_52w_distance_pct = 0
                    if tv_52w_high > 0:
                        tv_52w_distance_pct = ((tv_52w_high - upstox_price) / tv_52w_high) * 100

                    # Also calculate diff from recent 5-day high (for display)
                    recent_high_diff_pct = 0
                    if recent_high > 0:
                        recent_high_diff_pct = ((recent_high - upstox_price) / recent_high) * 100

                    high_diff_pct = tv_52w_distance_pct  # Use TV 52W for display
                    high_diff_str = f"{high_diff_pct:+.2f}%" if high_diff_pct != 0 else "0.00%"
                    if high_diff_pct < 0:
                        high_diff_str = f"[green]{high_diff_str}[/green]"  # Above 52w high
                    elif high_diff_pct > 0.5:
                        high_diff_str = f"[red]{high_diff_str}[/red]"  # Far below 52w high

                    # Get indicators for recommendation
                    adx = row.get('ADX', 0)
                    perf_w = row.get('Perf.W', 0)

                    # Apply 52W distance filter if specified (using TradingView 52W high)
                    if filter_52w_range:
                        min_pct, max_pct = filter_52w_range
                        # For positive ranges (0-5%), also include breakouts (-max to 0)
                        # Use abs() to include stocks slightly above 52W high
                        abs_distance = abs(tv_52w_distance_pct)
                        if not (min_pct <= abs_distance <= max_pct):
                            # Debug: show first few filtered stocks (only if verbose)
                            if verbose and len(untouched_rows) + len(touched_rows) < 5:
                                console.print(f"[dim]🔍 Filtered out {symbol}: TV 52W dist={tv_52w_distance_pct:+.2f}% (abs={abs_distance:.2f}%, range: {min_pct}-{max_pct}%)[/dim]")
                            continue  # Skip this stock

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

                    # Extra fields
                    score = row.get('swing_score', 0)
                    score_str = f"{score}/100"
                    if score >= 80: score_str = f"[bold green]{score_str}[/bold green]"
                    elif score >= 60: score_str = f"[yellow]{score_str}[/yellow]"

                    sector = str(row.get('sector', '-'))
                    perf_w = row.get('Perf.W', 0)
                    perf_w_str = f"[green]{perf_w:+.2f}%[/green]" if perf_w > 0 else f"[red]{perf_w:+.2f}%[/red]"

                    # EDA-Optimized Action Recommendation with actual parameters
                    action, detailed_reason = get_52w_action_recommendation(
                        score=score,
                        distance_to_52w_pct=high_diff_pct,
                        adx=adx,
                        recent_return_5d=recent_return,
                        perf_w=perf_w
                    )

                    # Combine action and reason with actual parameters
                    if action == "ENTER":
                        action_reason_str = f"[bold green blink]▶ ENTER[/bold green blink]: {detailed_reason}"
                    elif action == "AVOID":
                        action_reason_str = f"[bold red]✜ AVOID[/bold red]: {detailed_reason}"
                    else:  # WAIT
                        action_reason_str = f"[bold yellow]⏸ WAIT[/bold yellow]: {detailed_reason}"

                    row_data = [
                        symbol,
                        score_str,
                        f"{tv_price:.2f}",
                        f"{upstox_price:.2f}",
                        f"{diff_pct:+.2f}%",  # Broker Diff
                        high_diff_str,  # To 52w High
                        f"{trend_icon} {recent_return:+.1f}% (5d)",
                        f"{tv_52w_high:.2f}",
                        touched_str,
                        perf_w_str,
                        sector,
                        action_reason_str  # Combined Action + Reason with parameters
                    ]

                    if touched_52w:
                        # For touched stocks, remove: 52W High (7), Touched 52W? (8)
                        # Keep: Symbol, Score, TV Price, Upstox Price, Broker Diff, To 52w High, Recent Ret, Perf.W, Sector, Action
                        touched_row_data = [v for i, v in enumerate(row_data) if i not in {7, 8}]
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
        table_untouched = Table(title="🎯 APPROACHING 52W HIGH (Price < 7k) - EDA OPTIMIZED", style="blue")
        table_untouched.add_column("Symbol", style="cyan", width=12)
        table_untouched.add_column("Score", justify="center", style="bold magenta")
        table_untouched.add_column("TV Price", justify="right")
        table_untouched.add_column("Upstox Price", justify="right")
        table_untouched.add_column("Broker Diff", justify="right")
        table_untouched.add_column("To 52w High", justify="right")
        table_untouched.add_column("Recent Ret (5d)", justify="center")
        table_untouched.add_column("52W High", justify="right")
        table_untouched.add_column("Touched 52W?", justify="center")
        table_untouched.add_column("Perf.W", justify="right")
        table_untouched.add_column("Sector", style="dim")
        table_untouched.add_column("Action + Params", style="bold", width=35)  # Combined

        # Sort by Action (ENTER first)
        def action_priority(row):
            action_col = row[-1]  # Action+Params column
            if "ENTER" in action_col:
                return 0
            elif "WAIT" in action_col:
                return 1
            else:
                return 2

        untouched_rows.sort(key=action_priority)

        for row in untouched_rows:
            table_untouched.add_row(*row)

        console.print(table_untouched)

        # Extract symbols by action type for TradingView
        enter_symbols = []
        wait_symbols = []
        avoid_symbols = []

        for row in untouched_rows:
            symbol = row[0]
            action_col = row[-1]  # Action+Params column (last)
            if "ENTER" in action_col:
                enter_symbols.append(symbol)
            elif "WAIT" in action_col:
                wait_symbols.append(symbol)
            elif "AVOID" in action_col:
                avoid_symbols.append(symbol)

        # Display TradingView copy-paste lists
        console.print("\n[bold cyan]📋 TRADINGVIEW SYMBOL LISTS (Copy & Paste):[/bold cyan]\n")

        if enter_symbols:
            console.print("[bold green]▶ ENTER Signals:[/bold green]")
            console.print(f"[dim]{', '.join(enter_symbols)}[/dim]\n")

        if wait_symbols:
            console.print("[bold yellow]⏸ WAIT Signals:[/bold yellow]")
            console.print(f"[dim]{', '.join(wait_symbols)}[/dim]\n")

        if avoid_symbols:
            console.print("[bold red]✜ AVOID Signals:[/bold red]")
            console.print(f"[dim]{', '.join(avoid_symbols)}[/dim]\n")

        # All symbols combined
        all_symbols = enter_symbols + wait_symbols + avoid_symbols
        console.print("[bold white]🔖 All Approaching 52W:[/bold white]")
        console.print(f"[dim]{', '.join(all_symbols)}[/dim]\n")
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
        table_touched.add_column("Action + Params", style="bold", width=35)  # Combined
        
        for row in touched_rows:
            table_touched.add_row(*row)

        console.print(table_touched)

        # Extract symbols for TradingView
        touched_symbols = [row[0] for row in touched_rows]

        # Display TradingView copy-paste list
        console.print("\n[bold cyan]📋 TRADINGVIEW SYMBOL LIST (Copy & Paste):[/bold cyan]\n")
        console.print("[bold green]✅ Already Touched 52W:[/bold green]")
        console.print(f"[dim]{', '.join(touched_symbols)}[/dim]\n")

    console.print("[dim]Note: 'Broker Diff' shows TV vs Upstox price diff. 'To 52w High' shows pullback from 52-week high (negative = above high).[/dim]")
    console.print("[dim]'Action + Params' shows EDA-optimized recommendations with actual parameters (Distance, Score, ADX, Momentum):[/dim]")
    console.print("[dim]  ▶ ENTER = Strong trend (Score≥70) + close to 52W (≤3%) + good ADX (≥25)[/dim]")
    console.print("[dim]  ✜ AVOID = Weak trend (Score<60) OR too far from 52W (>5%) OR poor momentum[/dim]")
    console.print("[dim]  ⏸ WAIT = Mixed signals - monitor for better entry[/dim]")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Verify trending stocks with Trading API")
    parser.add_argument(
        "--intraday",
        action="store_true",
        help="Use intraday data (same day) instead of historical data (5 days)"
    )
    parser.add_argument(
        "--provider",
        type=str,
        default='upstox',
        choices=['upstox', 'indmoney'],
        help="API provider to use (default: upstox)"
    )
    parser.add_argument(
        "--filter-52w",
        type=str,
        metavar='MIN-MAX',
        help="Filter by 52W high distance percentage range (e.g., '2-5' for 2-5%% below 52W high)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show detailed debug output"
    )

    args = parser.parse_args()

    # Parse filter range if provided
    filter_52w_range = None
    if args.filter_52w:
        try:
            parts = args.filter_52w.split('-')
            if len(parts) != 2:
                raise ValueError
            min_pct = float(parts[0].strip())
            max_pct = float(parts[1].strip())
            filter_52w_range = (min_pct, max_pct)
        except ValueError:
            console.print("[red]❌ Invalid --filter-52w format. Use 'MIN-MAX' format (e.g., '2-5')[/red]")
            sys.exit(1)

    verify_stocks(use_intraday=args.intraday, provider=args.provider, filter_52w_range=filter_52w_range, verbose=args.verbose)

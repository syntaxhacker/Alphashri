#!/usr/bin/env python3
"""
Verify Stocks with High Buyer Interest (Day Wick Close Analysis)

This scanner identifies stocks showing strong buyer interest based on where
the price closed relative to the day's range. A close near the high indicates
strong buying pressure (bullish wick).

Supports multiple providers (Upstox, INDMONEY) via unified interface.

For enhanced features including:
- Bearish setup detection
- Candlestick pattern recognition (HAMMER, SHOOTING_STAR, ENGULFING, etc.)
- Gap analysis
- EMA trend filter
- Risk/reward calculations
- Quant-optimized scoring (0-100)

See: verify_buyer_interest_upstox_enhanced.py
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
    print(" Config not found. Please ensure config is set up properly.")
    UPSTOX_CONFIG = {}
    INDMONEY_CONFIG = {}

# Import the trending scanner
import trending_upside


def get_buyer_interest_action_recommendation(
    wick_close_pct: float,
    volume_surge: float,
    recent_return_5d: float,
    rsi: float,
    adx: float
) -> tuple:
    """
    Get ENTER/AVOID recommendation based on buyer interest parameters.

    High buyer interest signals:
    - Wick Close %: > 70% (closed near high = strong buying)
    - Volume Surge: > 1.5x (confirmation of interest)
    - ADX: > 20 (trending stock)
    - RSI: 50-70 (room to run, not overbought)
    - Momentum: Positive 5-day return

    Returns:
        tuple: (action, detailed_reason)
            action: "ENTER" or "AVOID" or "WATCH"
            detailed_reason: explanation with actual parameters
    """

    reasons = []

    # Check 1: Wick Close % (MOST IMPORTANT)
    if wick_close_pct >= 85:
        reasons.append(("✅", f"Wick: {wick_close_pct:.0f}%"))
    elif wick_close_pct >= 70:
        reasons.append(("✅", f"Wick: {wick_close_pct:.0f}%"))
    elif wick_close_pct >= 60:
        reasons.append(("⚠️", f"Wick: {wick_close_pct:.0f}%"))
    else:
        reasons.append(("❌", f"Wick: {wick_close_pct:.0f}%"))

    # Check 2: Volume Surge
    if volume_surge >= 2.0:
        reasons.append(("✅", f"Vol: {volume_surge:.1f}x"))
    elif volume_surge >= 1.5:
        reasons.append(("✅", f"Vol: {volume_surge:.1f}x"))
    elif volume_surge >= 1.0:
        reasons.append(("⚠️", f"Vol: {volume_surge:.1f}x"))
    else:
        reasons.append(("❌", f"Vol: {volume_surge:.1f}x"))

    # Check 3: RSI (Sweet spot: 50-70)
    if 50 <= rsi <= 70:
        reasons.append(("✅", f"RSI: {rsi:.0f}"))
    elif 40 <= rsi <= 80:
        reasons.append(("⚠️", f"RSI: {rsi:.0f}"))
    elif rsi > 0:
        reasons.append(("❌", f"RSI: {rsi:.0f}"))

    # Check 4: ADX (Trend strength)
    if adx >= 30:
        reasons.append(("✅", f"ADX: {adx:.0f}"))
    elif adx >= 20:
        reasons.append(("✅", f"ADX: {adx:.0f}"))
    elif adx > 0:
        reasons.append(("⚠️", f"ADX: {adx:.0f}"))

    # Check 5: Momentum
    if recent_return_5d > 3:
        reasons.append(("✅", f"Mom: {recent_return_5d:+.1f}%"))
    elif recent_return_5d > 0:
        reasons.append(("✅", f"Mom: {recent_return_5d:+.1f}%"))
    elif recent_return_5d > -3:
        reasons.append(("⚠️", f"Mom: {recent_return_5d:+.1f}%"))
    else:
        reasons.append(("❌", f"Mom: {recent_return_5d:+.1f}%"))

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
        return "WATCH", detailed_reason
    elif strong_signals >= 4:
        return "ENTER", detailed_reason
    elif strong_signals >= 3 and bad_signals == 0:
        return "ENTER", detailed_reason
    elif strong_signals >= 2:
        return "WATCH", detailed_reason
    else:
        return "AVOID", detailed_reason


console = Console()


def calculate_wick_close_percent(df: pd.DataFrame) -> dict:
    """
    Calculate wick close percentage for multiple periods.

    Wick Close % = ((Close - Low) / (High - Low)) * 100
    Higher values indicate closing near the high (bullish)

    Returns:
        dict with wick close % for different periods
    """
    if df is None or df.empty:
        return {}

    result = {}

    # Current day (last candle)
    current = df.iloc[-1]
    day_range = current['high'] - current['low']
    if day_range > 0:
        result['current'] = ((current['close'] - current['low']) / day_range) * 100
    else:
        result['current'] = 50.0  # Flat day

    # Last 3 candles average
    if len(df) >= 3:
        recent = df.tail(3)
        wick_pcts = []
        for _, row in recent.iterrows():
            day_range = row['high'] - row['low']
            if day_range > 0:
                wick_pct = ((row['close'] - row['low']) / day_range) * 100
                wick_pcts.append(wick_pct)
        result['avg_3'] = sum(wick_pcts) / len(wick_pcts) if wick_pcts else 50.0

    # Last 5 candles average
    if len(df) >= 5:
        recent = df.tail(5)
        wick_pcts = []
        for _, row in recent.iterrows():
            day_range = row['high'] - row['low']
            if day_range > 0:
                wick_pct = ((row['close'] - row['low']) / day_range) * 100
                wick_pcts.append(wick_pct)
        result['avg_5'] = sum(wick_pcts) / len(wick_pcts) if wick_pcts else 50.0

    return result


def calculate_avg_volume(df: pd.DataFrame, periods: int = 10) -> float:
    """Calculate average volume for given period."""
    if df is None or len(df) < periods:
        return 0
    return df['volume'].tail(periods).mean()


def verify_stocks(use_intraday=False, provider='upstox', min_wick_close=70.0):
    """
    Verify stocks with high buyer interest based on wick close analysis.

    Args:
        use_intraday (bool): If True, use fetch_intraday_data for same-day data.
                           If False, use fetch_historical_data_v3 (default).
        provider (str): API provider to use ('upstox' or 'indmoney'). Default: 'upstox'.
        min_wick_close (float): Minimum wick close % to qualify. Default: 70%.
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
        console.print(f"[green] Using {provider.upper()} API[/green]")
    except ValueError as e:
        console.print(f"[red] {e}[/red]")
        return

    # Upstox V3 intraday endpoint works without interactive OAuth for market data.
    if use_intraday and provider == 'upstox':
        console.print("[green] Using Upstox V3 intraday data (no interactive auth required)[/green]")

    # Display which data method is being used
    data_method = "[green]intraday (same day)[/green]" if use_intraday else "[blue]historical (5 days)[/blue]"
    console.print(f" Using {data_method} data method")

    # 3. Verify each stock
    high_interest_rows = []
    blacklisted_symbols = set()

    with console.status("[bold green]Analyzing buyer interest from Upstox...[/bold green]"):
        for _, row in tv_df.iterrows():
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
                blacklisted_symbols.add(symbol)
                continue

            try:
                # Fetch data based on the use_intraday parameter
                to_date = datetime.now().strftime('%Y-%m-%d')

                if use_intraday:
                    df_hist = api.fetch_intraday_data_v3(
                        symbol=symbol,
                        interval='30'  # 30-minute for better intraday analysis
                    )

                    if df_hist is None or df_hist.empty:
                        continue
                else:
                    # Use historical data for last 5 days (daily timeframe)
                    from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                    df_hist = api.fetch_historical_data_v3(
                        symbol=symbol,
                        unit='days',
                        interval=1,
                        to_date=to_date,
                        from_date=from_date
                    )

                if df_hist is not None and not df_hist.empty:
                    # Calculate wick close percentages
                    wick_data = calculate_wick_close_percent(df_hist)

                    current_wick = wick_data.get('current', 0)
                    avg_3_wick = wick_data.get('avg_3', current_wick)
                    avg_5_wick = wick_data.get('avg_5', current_wick)

                    # Use the best wick value for filtering
                    best_wick = max(current_wick, avg_3_wick, avg_5_wick)

                    # Filter: Must meet minimum wick close threshold
                    if best_wick < min_wick_close:
                        continue

                    # Calculate volume surge
                    current_vol = df_hist['volume'].iloc[-1]
                    avg_vol = calculate_avg_volume(df_hist, periods=10)
                    volume_surge = current_vol / avg_vol if avg_vol > 0 else 1.0

                    # Price calculations
                    start_price = df_hist['close'].iloc[0]
                    upstox_price = df_hist['close'].iloc[-1]
                    recent_return = ((upstox_price - start_price) / start_price) * 100

                    # Get indicators from TV data
                    rsi = row.get('RSI', 50)
                    adx = row.get('ADX', 0)
                    perf_w = row.get('Perf.W', 0)

                    # Score
                    score = row.get('swing_score', 0)

                    # Get recommendation
                    action, detailed_reason = get_buyer_interest_action_recommendation(
                        wick_close_pct=best_wick,
                        volume_surge=volume_surge,
                        recent_return_5d=recent_return,
                        rsi=rsi,
                        adx=adx
                    )

                    # Format wick display
                    wick_str = f"{current_wick:.0f}%"
                    if current_wick >= 85:
                        wick_str = f"[bold green blink]{wick_str}[/bold green blink]"
                    elif current_wick >= 70:
                        wick_str = f"[green]{wick_str}[/green]"

                    avg_3_str = f"{avg_3_wick:.0f}%"
                    avg_5_str = f"{avg_5_wick:.0f}%"

                    # Volume surge display
                    vol_str = f"{volume_surge:.1f}x"
                    if volume_surge >= 2.0:
                        vol_str = f"[bold green]{vol_str}[/bold green]"
                    elif volume_surge >= 1.5:
                        vol_str = f"[green]{vol_str}[/green]"

                    # Score display
                    score_str = f"{score}/100"
                    if score >= 80:
                        score_str = f"[bold green]{score_str}[/bold green]"
                    elif score >= 60:
                        score_str = f"[yellow]{score_str}[/yellow]"

                    # Perf.W display
                    perf_w_str = f"[green]{perf_w:+.2f}%[/green]" if perf_w > 0 else f"[red]{perf_w:+.2f}%[/red]"

                    # Sector
                    sector = str(row.get('sector', '-'))

                    # Action display
                    if action == "ENTER":
                        action_str = f"[bold green blink] ENTER[/bold green blink]: {detailed_reason}"
                    elif action == "AVOID":
                        action_str = f"[bold red] AVOID[/bold red]: {detailed_reason}"
                    else:  # WATCH
                        action_str = f"[bold yellow] WATCH[/bold yellow]: {detailed_reason}"

                    # Day range info
                    current_day = df_hist.iloc[-1]
                    day_range_pct = ((current_day['high'] - current_day['low']) / current_day['low']) * 100
                    day_range_str = f"{day_range_pct:.1f}%"

                    # Store tuple: (sort_key, row_data) for proper sorting
                    row_data = [
                        symbol,
                        score_str,
                        f"{tv_price:.2f}",
                        f"{upstox_price:.2f}",
                        wick_str,  # Current Wick
                        avg_3_str,  # Avg 3-day Wick
                        avg_5_str,  # Avg 5-day Wick
                        vol_str,  # Volume Surge
                        day_range_str,  # Day Range
                        f"{''.join(['' if recent_return <= 0 else ''][0])} {recent_return:+.1f}% (5d)",
                        perf_w_str,
                        sector,
                        action_str
                    ]

                    high_interest_rows.append((best_wick, row_data))

            except Exception:
                pass

    # Display Results
    if high_interest_rows:
        # Sort by Wick Close (highest first) - stored as tuple (wick_pct, row_data)
        high_interest_rows.sort(key=lambda x: x[0], reverse=True)

        table = Table(title=f" HIGH BUYER INTEREST (Wick Close >= {min_wick_close:.0f}%, Price < 7k)", style="cyan")
        table.add_column("Symbol", style="cyan", width=10)
        table.add_column("Score", justify="center", style="bold magenta")
        table.add_column("TV Price", justify="right")
        table.add_column("Upstox Price", justify="right")
        table.add_column("Wick %", justify="center", width=10)
        table.add_column("Avg 3d", justify="center", width=8)
        table.add_column("Avg 5d", justify="center", width=8)
        table.add_column("Vol Surge", justify="center", width=10)
        table.add_column("Day Range", justify="right")
        table.add_column("Return (5d)", justify="center")
        table.add_column("Perf.W", justify="right")
        table.add_column("Sector", style="dim", width=12)
        table.add_column("Action + Params", style="bold", width=40)

        for _, row in high_interest_rows:
            table.add_row(*row)

        console.print(table)

        # Extract symbols by action type for TradingView
        enter_symbols = []
        watch_symbols = []
        avoid_symbols = []

        for _, row in high_interest_rows:
            symbol = row[0]
            action_col = row[-1]  # Action+Params column (last)
            if "ENTER" in action_col:
                enter_symbols.append(symbol)
            elif "WATCH" in action_col:
                watch_symbols.append(symbol)
            elif "AVOID" in action_col:
                avoid_symbols.append(symbol)

        # Display TradingView copy-paste lists
        console.print("\n[bold cyan] TRADINGVIEW SYMBOL LISTS (Copy & Paste):[/bold cyan]\n")

        if enter_symbols:
            console.print("[bold green] ENTER Signals:[/bold green]")
            console.print(f"[dim]{', '.join(enter_symbols)}[/dim]\n")

        if watch_symbols:
            console.print("[bold yellow] WATCH Signals:[/bold yellow]")
            console.print(f"[dim]{', '.join(watch_symbols)}[/dim]\n")

        if avoid_symbols:
            console.print("[bold red] AVOID Signals:[/bold red]")
            console.print(f"[dim]{', '.join(avoid_symbols)}[/dim]\n")

        # All symbols
        all_symbols = enter_symbols + watch_symbols + avoid_symbols
        console.print("[bold white] All High Buyer Interest:[/bold white]")
        console.print(f"[dim]{', '.join(all_symbols)}[/dim]\n")

    else:
        console.print(f"[yellow]No stocks found with wick close >= {min_wick_close:.0f}%[/yellow]")

    console.print("[dim]Note: Wick Close % = ((Close - Low) / (High - Low)) * 100[/dim]")
    console.print("[dim]Higher values indicate closing near the day's high (strong buyer interest)[/dim]")
    console.print("[dim]'Vol Surge' = Current Volume / Average Volume (10 periods)[/dim]")
    console.print("[dim]'Action + Params' shows recommendation with actual parameters:[/dim]")
    console.print("[dim]   ENTER = Strong buyer interest (Wick>=70%) + Volume surge + good momentum[/dim]")
    console.print("[dim]   WATCH = Mixed signals - monitor for better entry[/dim]")
    console.print("[dim]   AVOID = Weak buyer interest OR poor momentum OR overbought[/dim]")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Verify stocks with high buyer interest")
    parser.add_argument(
        "--intraday",
        action="store_true",
        help="Use intraday data (30min) instead of historical data (daily)"
    )
    parser.add_argument(
        "--provider",
        type=str,
        default='upstox',
        choices=['upstox', 'indmoney'],
        help="API provider to use (default: upstox)"
    )
    parser.add_argument(
        "--min-wick",
        type=float,
        default=70.0,
        help="Minimum wick close percentage (default: 70.0)"
    )

    args = parser.parse_args()

    verify_stocks(use_intraday=args.intraday, provider=args.provider, min_wick_close=args.min_wick)

#!/usr/bin/env python3
"""
52 Week High Approaching Chaser Backtest - ENHANCED VERSION
Strategy:
1. Track 52-week high (rolling 252 trading days)
2. When current price is within X% of 52-week high, enter LONG
3. MULTI-CONFIRMATION FILTERS:
   - ADX > 25 (Strong trend required)
   - Volume > 1.5x average (Institutional participation)
   - RSI between 50-70 (Momentum room to run)
   - Price > 200 DMA (Long-term bullish)
   - Price > 50 DMA (Intermediate trend up)
4. Hold until it reaches/breaks the 52-week high, then sell
5. Uses daily data for swing trading
"""

import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time

# Add project root to sys.path for absolute imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.table import Table

console = Console()


def get_date_range(num_days: int):
    """Determines the date range for the backtest."""
    today = datetime.now()
    to_date = today.strftime('%Y-%m-%d')
    from_date = (today - timedelta(days=num_days)).strftime('%Y-%m-%d')
    return from_date, to_date


def calculate_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14):
    """
    Calculate Average Directional Index (ADX) - Trend Strength Indicator

    ADX VALUES:
    - 0-25: Weak or absent trend
    - 25-50: Strong trend
    - 50+: Very strong trend
    """
    # Calculate True Range
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    # Calculate +DM and -DM
    plus_dm = high.diff()
    minus_dm = -low.diff()

    plus_dm[plus_dm < 0] = 0
    minus_dm[minus_dm < 0] = 0

    # Calculate +DI and -DI
    atr = tr.rolling(window=period).mean()
    plus_di = 100 * (plus_dm.rolling(window=period).mean() / atr)
    minus_di = 100 * (minus_dm.rolling(window=period).mean() / atr)

    # Calculate DX and ADX
    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    adx = dx.rolling(window=period).mean()

    return adx, plus_di, minus_di


def calculate_rsi(close: pd.Series, period: int = 14):
    """Calculate Relative Strength Index (RSI)"""
    delta = close.diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)

    avg_gain = gain.ewm(span=period, adjust=False).mean()
    avg_loss = loss.ewm(span=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return rsi


def run_52week_high_chaser_enhanced(ticker: str, num_days: int, use_filters: bool = True):
    """
    52 Week High Approaching Chaser Backtest - ENHANCED with Filters

    Filters available:
    - ADX (trend strength)
    - Volume confirmation
    - RSI (momentum)
    - Moving averages (trend context)
    """
    filter_mode = "WITH FILTERS" if use_filters else "NO FILTERS"
    console.print(
        f"\n[bold cyan]🚀 Running 52-Week High Chaser Backtest for {ticker} | {filter_mode} | Duration: {num_days} days[/bold cyan]"
    )

    from_date, to_date = get_date_range(num_days)
    console.print(f"[dim]Fetching data from {from_date} to {to_date}[/dim]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Force download and cache of instrument file if not present
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    # 1. Fetch Daily Data (need extra days for calculations)
    daily_from_date = (datetime.strptime(from_date, '%Y-%m-%d') - timedelta(days=500)).strftime('%Y-%m-%d')

    console.print(f"[yellow]Fetching {500 + num_days} days of data for indicator calculations...[/yellow]")

    historical_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="days",
        interval=1,
        from_date=daily_from_date,
        to_date=to_date
    )

    if historical_df is None or historical_df.empty:
        console.print(
            f"[red]❌ Could not fetch daily data for {ticker} from {daily_from_date} to {to_date}.[/red]"
        )
        console.print("[yellow]Please ensure the market was open and data is available for this date.[/yellow]")
        return

    console.print(f"[green]✅ Fetched {len(historical_df)} daily candles[/green]")

    # 2. Calculate All Indicators
    console.print("[yellow]Calculating indicators...[/yellow]")

    # 52-Week High - Using PREVIOUS 252 days (EXCLUDING current day)
    # shift(1) ensures we only use data available BEFORE the current day
    # This is the CORRECT way - 52-week high as of close of previous day
    historical_df['52w_high'] = historical_df['high'].rolling(window=252, min_periods=100).max().shift(1)

    # ADX (Trend Strength) - period 14
    historical_df['adx'], historical_df['plus_di'], historical_df['minus_di'] = calculate_adx(
        historical_df['high'], historical_df['low'], historical_df['close'], period=14
    )

    # RSI (Momentum) - period 14
    historical_df['rsi'] = calculate_rsi(historical_df['close'], period=14)

    # Moving Averages
    historical_df['ma_50'] = historical_df['close'].rolling(window=50).mean()
    historical_df['ma_200'] = historical_df['close'].rolling(window=200).mean()

    # Volume Average (20 days)
    historical_df['vol_avg'] = historical_df['volume'].rolling(window=20).mean()

    # ATR (Average True Range) - for volatility-based stops
    high_low = historical_df['high'] - historical_df['low']
    high_close = abs(historical_df['high'] - historical_df['close'].shift())
    low_close = abs(historical_df['low'] - historical_df['close'].shift())
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    historical_df['atr'] = true_range.rolling(window=14).mean()

    # Filter to only the requested date range
    backtest_start_date = pd.to_datetime(from_date).date()
    historical_df = historical_df[historical_df.index.date >= backtest_start_date]

    console.print(f"[green]✅ Backtest period: {len(historical_df)} days[/green]")

    # 3. Strategy Parameters
    ENTRY_THRESHOLD_PCT = 5.0  # Enter when within 3% of 52-week high
    COOLDOWN_DAYS = 30  # Wait 30 days after exit before re-entering
    CAPITAL_PER_TRADE = 100000  # ₹1 lakh per trade
    MAX_HOLDING_DAYS = 15  # Max 30 days to hold
    MIN_DAYS_SINCE_52W_HIGH = 20 # 52-week high must be at least 5 days old

    # FILTER PARAMETERS (only used if use_filters = True)
    MIN_ADX = 25  # Minimum ADX for strong trend
    MIN_VOLUME_MULTIPLE = 1.5  # Volume must be 1.5x average
    MIN_RSI = 50  # Minimum RSI (bullish momentum)
    MAX_RSI = 70  # Maximum RSI (not overbought)
    ATR_STOP_LOSS_MULTIPLE = 2.0  # ATR-based SL (2x ATR)

    # TRAILING STOP PARAMETERS
    TRAILING_STOP_PCT = 1.5  # Trail by 1.5% from highest high
    TRAILING_ACTIVATION_PCT = 0.5  # Activate trailing after 0.5% profit

    # Calculate days since 52-week high was FIRST formed
    # We want to know how long ago the current 52w-high level was first achieved
    historical_df['days_since_52w_high'] = None

    for i in range(len(historical_df)):
        current_52w = historical_df.iloc[i]['52w_high']
        if pd.isna(current_52w):
            continue

        # Find the FIRST occurrence of this 52w-high level (going back up to 252 days)
        first_occurrence_idx = None
        for j in range(i, max(0, i - 252), -1):
            if historical_df.iloc[j]['high'] >= current_52w * 0.999:
                first_occurrence_idx = j
            # Once we find a match, keep looking for earlier ones
            # (we're going backwards, so smaller j = earlier in history)

        if first_occurrence_idx is not None:
            historical_df.iloc[i, historical_df.columns.get_loc('days_since_52w_high')] = i - first_occurrence_idx

    # 4. Simulate Backtest
    trades = []
    filtered_out = []  # Track signals that were filtered out
    current_position = None
    entry_price = 0
    entry_time = None
    entry_52w_high = 0
    entry_atr = 0  # Store ATR at entry for dynamic SL
    highest_price_since_entry = 0  # Track highest price for trailing stop
    highest_profit_pct = 0  # Track highest profit percentage
    last_exit_date = None
    days_in_trade = 0
    trailing_stop_active = False  # Flag to activate trailing after 52w-high reached

    console.print("\n[bold magenta]📈 Starting Enhanced 52-Week High Chaser Simulation...[/bold magenta]")

    if use_filters:
        console.print(f"[dim]Filters Active:[/dim]")
        console.print(f"[dim]  • ADX > {MIN_ADX} (Trend Strength)[/dim]")
        console.print(f"[dim]  • Volume > {MIN_VOLUME_MULTIPLE}x Average[/dim]")
        console.print(f"[dim]  • RSI: {MIN_RSI}-{MAX_RSI} (Momentum)[/dim]")
        console.print(f"[dim]  • Price > 50 DMA & 200 DMA[/dim]")
        console.print(f"[dim]  • 52w-High Age > {MIN_DAYS_SINCE_52W_HIGH} days (Established)[/dim]")

    for timestamp, row in historical_df.iterrows():
        current_date = timestamp.date()
        current_price = row['close']
        high_52w = row['52w_high']

        # Skip if 52-week high is not available yet
        if pd.isna(high_52w):
            continue

        days_from_last_exit = None
        if last_exit_date:
            days_from_last_exit = (current_date - last_exit_date).days

        # Calculate distance to 52-week high
        distance_to_52w_pct = ((high_52w - current_price) / current_price) * 100

        # Check if we're in cooldown
        in_cooldown = last_exit_date and days_from_last_exit < COOLDOWN_DAYS

        # ENTRY CONDITION: Price within threshold of 52-week high AND not in cooldown
        if current_position is None and not in_cooldown:
            if distance_to_52w_pct <= ENTRY_THRESHOLD_PCT and distance_to_52w_pct > 0:

                # ALWAYS Apply: 52-Week High Age Check (even without filters)
                days_since_52w = row['days_since_52w_high']
                if pd.isna(days_since_52w) or days_since_52w < MIN_DAYS_SINCE_52W_HIGH:
                    # Skip this signal - 52-week high too fresh
                    continue

                # Apply OTHER FILTERS if enabled
                entry_allowed = True
                filter_reasons = []

                if use_filters:
                    # Filter 1: ADX Check (Trend Strength)
                    adx_value = row['adx']
                    if pd.isna(adx_value) or adx_value < MIN_ADX:
                        entry_allowed = False
                        filter_reasons.append(f"ADX={adx_value:.1f}<{MIN_ADX}")

                    # Filter 2: Volume Check (Institutional participation)
                    volume = row['volume']
                    vol_avg = row['vol_avg']
                    if not pd.isna(vol_avg) and volume < (MIN_VOLUME_MULTIPLE * vol_avg):
                        entry_allowed = False
                        filter_reasons.append(f"Vol={volume:.0f}<{MIN_VOLUME_MULTIPLE}xAvg")

                    # Filter 3: RSI Check (Momentum not overbought)
                    rsi_value = row['rsi']
                    if pd.isna(rsi_value) or rsi_value < MIN_RSI or rsi_value > MAX_RSI:
                        entry_allowed = False
                        filter_reasons.append(f"RSI={rsi_value:.1f}")

                    # Filter 4: Moving Average Check (Trend context)
                    ma_50 = row['ma_50']
                    ma_200 = row['ma_200']
                    if pd.isna(ma_50) or pd.isna(ma_200):
                        entry_allowed = False
                        filter_reasons.append("MA N/A")
                    elif current_price < ma_50 or current_price < ma_200:
                        entry_allowed = False
                        filter_reasons.append(f"Price<MAs")

                # ENTER if filters passed (or filters disabled)
                if entry_allowed:
                    current_position = 'LONG'
                    entry_price = current_price
                    entry_time = timestamp
                    entry_52w_high = high_52w
                    entry_atr = row['atr']
                    highest_price_since_entry = current_price  # Initialize with entry price
                    highest_profit_pct = 0  # Initialize profit tracking
                    days_in_trade = 0
                    trailing_stop_active = False  # Trailing not active yet

                    filter_status = "[green]✅ ALL FILTERS PASS[/green]" if use_filters else "[yellow]NO FILTERS[/yellow]"
                    days_since_str = f"{int(row['days_since_52w_high'])} days ago" if not pd.isna(row['days_since_52w_high']) else "N/A"
                    console.print(
                        f"[green]📈 LONG Entry for {ticker} @ ₹{current_price:.2f} | "
                        f"52w-High: ₹{high_52w:.2f} ({days_since_str}) | "
                        f"Distance: {distance_to_52w_pct:.2f}% | Date: {current_date}[/green]"
                    )
                    if use_filters:
                        console.print(
                            f"    [dim]ADX: {row['adx']:.1f} | RSI: {row['rsi']:.1f} | "
                            f"Vol: {row['volume']:.0f} ({row['volume']/row['vol_avg']:.1f}x) | "
                            f"MAs: {filter_status}[/dim]"
                        )
                else:
                    # Track filtered signal
                    filtered_out.append({
                        'date': current_date,
                        'price': current_price,
                        '52w_high': high_52w,
                        'distance': distance_to_52w_pct,
                        'reasons': filter_reasons
                    })
                    console.print(
                        f"[dim]⚠️  Signal FILTERED for {ticker} @ ₹{current_price:.2f} | "
                        f"Reasons: {', '.join(filter_reasons)}[/dim]"
                    )

        # EXIT CONDITIONS (if in position)
        if current_position == 'LONG':
            days_in_trade += 1
            pnl_pct = ((current_price - entry_price) / entry_price) * 100

            # Update highest price since entry (for trailing stop)
            # Track the DAILY HIGH to capture intraday peaks, not just close
            if row['high'] > highest_price_since_entry:
                highest_price_since_entry = row['high']
                highest_profit_pct = ((highest_price_since_entry - entry_price) / entry_price) * 100

            exit_reason = None
            exit_price = current_price

            # 1. 52-Week High Reached - ACTIVATE TRAILING STOP (don't exit yet!)
            # Check if HIGH reached the target (not just close), to capture intraday breakouts
            if row['high'] >= entry_52w_high and not trailing_stop_active:
                trailing_stop_active = True
                console.print(
                    f"[cyan]🚀 52-Week High Reached! Activating TRAILING STOP | "
                    f"High: ₹{row['high']:.2f} | Close: ₹{current_price:.2f} | Target: ₹{entry_52w_high:.2f}[/cyan]"
                )

            # 2. TRAILING STOP EXIT (only active after 52w-high reached)
            if trailing_stop_active:
                # Calculate how far price has dropped from highest
                drawdown_from_high_pct = ((highest_price_since_entry - current_price) / highest_price_since_entry) * 100

                if drawdown_from_high_pct >= TRAILING_STOP_PCT:
                    exit_reason = f'TRAILING_STOP (-{drawdown_from_high_pct:.2f}% from high of ₹{highest_price_since_entry:.2f})'
                    console.print(
                        f"[yellow]📉 Trailing Stop Hit! Price dropped {drawdown_from_high_pct:.2f}% from high | "
                        f"Highest P&L was: {highest_profit_pct:+.2f}%[/yellow]"
                    )

            # 3. ATR-based Stop Loss (initial protection before trailing activates)
            if not exit_reason and current_price <= (entry_price - (entry_atr * ATR_STOP_LOSS_MULTIPLE)):
                atr_sl_pct = ((entry_price - current_price) / entry_price) * 100
                exit_reason = f'ATR_SL ({atr_sl_pct:.1f}%)'

            # 4. Max Holding Days Reached
            if not exit_reason and days_in_trade >= MAX_HOLDING_DAYS:
                exit_reason = 'MAX_HOLDING_DAYS'

            # 5. New 52-week high formed far above entry (momentum fading)
            if not exit_reason and high_52w > entry_52w_high * 1.05:
                exit_reason = 'NEW_52W_HIGH_FORMED'

            # 6. ADX drops below 20 (trend weakening) - optional exit
            if not exit_reason and use_filters and not pd.isna(row['adx']) and row['adx'] < 20:
                exit_reason = 'ADX_WEAKENING'

            if exit_reason:
                pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                trades.append({
                    'entry_time': entry_time,
                    'exit_time': timestamp,
                    'entry_52w_high': entry_52w_high,
                    'exit_52w_high': high_52w,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'pnl_pct': pnl_pct,
                    'pnl_amount': pnl_amount,
                    'days_held': days_in_trade,
                    'highest_pnl_pct': highest_profit_pct,  # Track best P&L during trade
                    'reason': exit_reason,
                    'use_filters': use_filters
                })
                console.print(
                    f"[{ 'red' if 'SL' in exit_reason else 'green' if 'TRAILING' in exit_reason else 'yellow' }] "
                    f"{'📈' if 'TRAILING' in exit_reason else '🛑' if 'SL' in exit_reason else '⏰'} "
                    f"Exit for {ticker} @ ₹{exit_price:.2f} | "
                    f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | "
                    f"Days Held: {days_in_trade} | Highest P&L: {highest_profit_pct:+.2f}% | Reason: {exit_reason}[/]"
                )
                current_position = None
                last_exit_date = current_date
                trailing_stop_active = False  # Reset trailing stop flag

    # 5. Report Backtest Results
    console.print("\n[bold cyan]📊 Backtest Results:[/bold cyan]")

    if not trades:
        console.print("[yellow]No trades were generated during the backtest period.[/yellow]")
        return

    results_table = Table(title="Simulated Trades", show_header=True, header_style="bold blue")
    results_table.add_column("Entry Date", style="cyan")
    results_table.add_column("Exit Date", style="cyan")
    results_table.add_column("Entry 52w-High", justify="right", style="blue")
    results_table.add_column("Exit 52w-High", justify="right", style="blue")
    results_table.add_column("Entry Price", justify="right", style="green")
    results_table.add_column("Exit Price", justify="right", style="red")
    results_table.add_column("Days Held", justify="right", style="white")
    results_table.add_column("Highest P&L %", justify="right", style="cyan")  # New column
    results_table.add_column("Final P&L %", justify="right", style="magenta")
    results_table.add_column("P&L ₹", justify="right", style="yellow")
    results_table.add_column("Reason", style="dim")

    total_pnl_pct = 0
    total_pnl_amount = 0
    winning_trades = 0
    losing_trades = 0
    total_days_held = 0

    for trade in trades:
        pnl_style = "green" if trade['pnl_pct'] > 0 else "red"
        total_pnl_pct += trade['pnl_pct']
        total_pnl_amount += trade['pnl_amount']
        total_days_held += trade['days_held']
        if trade['pnl_pct'] > 0:
            winning_trades += 1
        else:
            losing_trades += 1

        results_table.add_row(
            trade['entry_time'].strftime('%Y-%m-%d'),
            trade['exit_time'].strftime('%Y-%m-%d'),
            f"₹{trade['entry_52w_high']:.2f}",
            f"₹{trade['exit_52w_high']:.2f}",
            f"₹{trade['entry_price']:.2f}",
            f"₹{trade['exit_price']:.2f}",
            str(trade['days_held']),
            f"[cyan]{trade['highest_pnl_pct']:+.2f}%[/cyan]",  # Best P&L during trade
            f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",  # Final P&L
            f"[{pnl_style}]{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
            trade['reason']
        )

    console.print(results_table)

    win_rate = (winning_trades / len(trades) * 100) if trades else 0
    avg_days_held = (total_days_held / len(trades)) if trades else 0

    console.print(f"\n[bold yellow]Summary for {ticker} ({filter_mode}):[/bold yellow]")
    console.print(f"Total Trades: {len(trades)}")
    console.print(f"Winning Trades: {winning_trades}")
    console.print(f"Losing Trades: {losing_trades}")
    console.print(f"Win Rate: {win_rate:.2f}%")
    console.print(f"Avg Days Held: {avg_days_held:.1f}")
    console.print(f"Total P&L %: {total_pnl_pct:+.2f}%")
    console.print(f"Total P&L ₹: {total_pnl_amount:+,.0f}")

    if use_filters and filtered_out:
        console.print(f"\n[dim]Signals Filtered Out: {len(filtered_out)}[/dim]")
        console.print("[dim](Use 'no_filters' mode to see what would have happened without filters)[/dim]")

    console.print("\n[bold green]Backtest completed.[/bold green]")

    return {
        'trades': len(trades),
        'win_rate': win_rate,
        'total_pnl_pct': total_pnl_pct,
        'total_pnl_amount': total_pnl_amount,
        'filtered_out': len(filtered_out) if use_filters else 0
    }


# Main execution for all symbols
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="52-Week High Chaser Backtest - Enhanced Version",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python backtest_52week_high_chaser_enhanced.py --with-filters --symbol RELIANCE
  python backtest_52week_high_chaser_enhanced.py --no-filters --symbol INFY,TCS
  python backtest_52week_high_chaser_enhanced.py --compare --symbol RELIANCE,TCS,HDFCBANK
        """
    )
    parser.add_argument(
        '--with-filters', '-w',
        action='store_true',
        help='Run backtest WITH filters only'
    )
    parser.add_argument(
        '--no-filters', '-n',
        action='store_true',
        help='Run backtest WITHOUT filters only'
    )
    parser.add_argument(
        '--compare', '-c',
        action='store_true',
        help='Run both with AND without filters (default behavior)'
    )
    parser.add_argument(
        '--symbol', '-s',
        type=str,
        default='EICHERMOT',
        help='Comma-separated list of symbols to backtest (default: EICHERMOT)'
    )
    parser.add_argument(
        '--days', '-d',
        type=int,
        default=365 * 3,
        help='Number of days for backtest (default: 1095 = 3 years)'
    )

    args = parser.parse_args()

    # Parse symbols
    symbols = [s.strip().upper() for s in args.symbol.split(',')]
    num_days = args.days

    # Determine run mode
    run_with_filters = False
    run_without_filters = False

    if args.compare or (not args.with_filters and not args.no_filters):
        # Default: run both if no option specified or --compare is used
        run_with_filters = True
        run_without_filters = True
    else:
        run_with_filters = args.with_filters
        run_without_filters = args.no_filters

    # Comparison: Run with AND without filters
    comparison_results = []

    for ticker in symbols:
        console.print(f"\n{'='*80}")
        console.print(f"[bold white]Testing: {ticker}[/bold white]")
        console.print(f"{'='*80}")

        if run_with_filters:
            result_filtered = run_52week_high_chaser_enhanced(ticker, num_days, use_filters=True)
            time.sleep(2)
        else:
            result_filtered = None

        if run_without_filters:
            result_no_filter = run_52week_high_chaser_enhanced(ticker, num_days, use_filters=False)
            time.sleep(2)
        else:
            result_no_filter = None

        comparison_results.append({
            'ticker': ticker,
            'with_filters': result_filtered,
            'without_filters': result_no_filter
        })

    # Final Comparison Table (only show if running both modes)
    if run_with_filters and run_without_filters:
        console.print("\n" + "="*80)
        console.print("[bold cyan]📊 FINAL COMPARISON: With Filters vs Without Filters[/bold cyan]")
        console.print("="*80)

        from rich.table import Table as RichTable
        comp_table = RichTable(title="Filter Impact Analysis")
        comp_table.add_column("Ticker", style="cyan")
        comp_table.add_column("Trades (Filter)", justify="right")
        comp_table.add_column("Trades (No Filter)", justify="right")
        comp_table.add_column("Win Rate (Filter)", justify="right")
        comp_table.add_column("Win Rate (No Filter)", justify="right")
        comp_table.add_column("P&L % (Filter)", justify="right")
        comp_table.add_column("P&L % (No Filter)", justify="right")

        for res in comparison_results:
            wf = res['with_filters']
            nf = res['without_filters']

            # Handle None cases when no trades were generated
            wf_trades = str(wf['trades']) if wf else "0"
            wf_win_rate = f"{wf['win_rate']:.1f}%" if wf else "N/A"
            wf_pnl_pct = f"[green]{wf['total_pnl_pct']:+.1f}%[/green]" if wf and wf['total_pnl_pct'] > 0 else (f"[red]{wf['total_pnl_pct']:+.1f}%[/red]" if wf else "[dim]N/A[/dim]")

            comp_table.add_row(
                res['ticker'],
                wf_trades,
                str(nf['trades']),
                wf_win_rate,
                f"{nf['win_rate']:.1f}%",
                wf_pnl_pct,
                f"[green]{nf['total_pnl_pct']:+.1f}%[/green]" if nf['total_pnl_pct'] > 0 else f"[red]{nf['total_pnl_pct']:+.1f}%[/red]"
            )

        console.print(comp_table)

    console.print("\n[bold green]All backtests completed![/bold green]")

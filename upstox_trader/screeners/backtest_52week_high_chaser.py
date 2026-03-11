#!/usr/bin/env python3
"""
52 Week High Approaching Chaser Backtest
Strategy:
1. Track 52-week high (rolling 252 trading days)
2. When current price is within 2% of the 52-week high, enter LONG
3. Hold until it reaches/breaks the 52-week high, then sell
4. Uses daily data for swing trading
5. After exit, wait for cooldown before re-entering
"""

import sys
import os
import pandas as pd
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


def run_52week_high_chaser_backtest(ticker: str, num_days: int):
    """
    52 Week High Approaching Chaser Backtest
    - Buy when price is within 2% of 52-week high
    - Sell when price reaches/breaks the 52-week high
    - Uses daily data
    """
    console.print(
        f"\n[bold cyan]🚀 Running 52-Week High Chaser Backtest for {ticker} | Duration: {num_days} days[/bold cyan]"
    )

    from_date, to_date = get_date_range(num_days)
    console.print(f"[dim]Fetching data from {from_date} to {to_date}[/dim]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Force download and cache of instrument file if not present
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    # 1. Fetch Daily Data (need extra days for 52-week calculation)
    # Fetch 400 extra days to ensure we have 252 trading days for 52-week calculation
    daily_from_date = (datetime.strptime(from_date, '%Y-%m-%d') - timedelta(days=400)).strftime('%Y-%m-%d')

    console.print(f"[yellow]Fetching {400 + num_days} days of data for 52-week high calculation...[/yellow]")

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

    # 2. Calculate 52-Week High (252 trading days) for each day
    console.print("[yellow]Calculating 52-week high for each day...[/yellow]")

    # IMPORTANT: shift(1) ensures 52-week high is from PREVIOUS days only
    # This prevents including current day's high in the calculation
    historical_df['52w_high'] = historical_df['high'].rolling(window=252, min_periods=100).max().shift(1)

    # Filter to only the requested date range
    backtest_start_date = pd.to_datetime(from_date).date()
    historical_df = historical_df[historical_df.index.date >= backtest_start_date]

    console.print(f"[green]✅ Backtest period: {len(historical_df)} days[/green]")

    # 3. Strategy Parameters
    ENTRY_THRESHOLD_PCT = 3.0  # Enter when within 2% of 52-week high
    STOP_LOSS_PCT = -15.0  # 5% stop loss
    COOLDOWN_DAYS = 30  # Wait 30 days after exit before re-entering
    CAPITAL_PER_TRADE = 100000  # ₹1 lakh per trade
    MAX_HOLDING_DAYS = 30  # Max 90 days to hold

    # 4. Simulate Backtest
    trades = []
    current_position = None
    entry_price = 0
    entry_time = None
    entry_52w_high = 0
    last_exit_date = None
    days_in_trade = 0

    console.print("\n[bold magenta]📈 Starting 52-Week High Chaser Simulation...[/bold magenta]")

    for i, (timestamp, row) in enumerate(historical_df.iterrows()):
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

        # ENTRY CONDITION: Price within 2% of 52-week high AND not in cooldown
        if current_position is None and not in_cooldown:
            if distance_to_52w_pct <= ENTRY_THRESHOLD_PCT and distance_to_52w_pct > 0:
                current_position = 'LONG'
                entry_price = current_price
                entry_time = timestamp
                entry_52w_high = high_52w
                days_in_trade = 0
                console.print(
                    f"[green]📈 LONG Entry for {ticker} @ ₹{current_price:.2f} | "
                    f"52w-High: ₹{high_52w:.2f} | Distance: {distance_to_52w_pct:.2f}% | "
                    f"Date: {current_date}[/green]"
                )

        # EXIT CONDITIONS (if in position)
        if current_position == 'LONG':
            days_in_trade += 1
            pnl_pct = ((current_price - entry_price) / entry_price) * 100

            exit_reason = None
            exit_price = current_price

            # 1. Take Profit: Reached/Broke 52-week high
            if current_price >= entry_52w_high:
                exit_reason = '52W_HIGH_REACHED'
                console.print(
                    f"[green]🎯 52-Week High Reached! Price: ₹{current_price:.2f} >= "
                    f"52w-High: ₹{entry_52w_high:.2f}[/green]"
                )

            # 2. Stop Loss
            elif pnl_pct <= STOP_LOSS_PCT:
                exit_reason = 'STOP_LOSS'

            # 3. Max Holding Days Reached
            elif days_in_trade >= MAX_HOLDING_DAYS:
                exit_reason = 'MAX_HOLDING_DAYS'

            # 4. New 52-week high formed far above entry (momentum fading)
            # If a new 52w high forms that's 5% above our entry 52w high, exit
            elif high_52w > entry_52w_high * 1.05:
                exit_reason = 'NEW_52W_HIGH_FORMED'

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
                    'reason': exit_reason
                })
                console.print(
                    f"[{ 'red' if 'STOP_LOSS' in exit_reason else 'green' if '52W_HIGH' in exit_reason else 'yellow' }] "
                    f"{'🎯' if '52W_HIGH' in exit_reason else '🛑' if 'STOP_LOSS' in exit_reason else '⏰'} "
                    f"Exit for {ticker} @ ₹{exit_price:.2f} | "
                    f"P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | "
                    f"Days Held: {days_in_trade} | Reason: {exit_reason}[/]"
                )
                current_position = None
                last_exit_date = current_date

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
    results_table.add_column("P&L %", justify="right", style="magenta")
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
            f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
            f"[{pnl_style}]{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
            trade['reason']
        )

    console.print(results_table)

    win_rate = (winning_trades / len(trades) * 100) if trades else 0
    avg_days_held = (total_days_held / len(trades)) if trades else 0

    console.print(f"\n[bold yellow]Summary for {ticker}:[/bold yellow]")
    console.print(f"Total Trades: {len(trades)}")
    console.print(f"Winning Trades: {winning_trades}")
    console.print(f"Losing Trades: {losing_trades}")
    console.print(f"Win Rate: {win_rate:.2f}%")
    console.print(f"Avg Days Held: {avg_days_held:.1f}")
    console.print(f"Total P&L %: {total_pnl_pct:+.2f}%")
    console.print(f"Total P&L ₹: {total_pnl_amount:+,.0f}")
    console.print("\n[bold green]Backtest completed.[/bold green]")


# Main execution for all symbols
if __name__ == "__main__":
    # List of symbols to backtest
    symbols = [
        "RELIANCE", "TCS", "HDFCBANK", "INFY", "TATAMOTORS",
        "BAJFINANCE", "MARUTI", "EICHERMOT"
    ]
    num_days = 365 * 3  # 3 years backtest

    for ticker in symbols:
        run_52week_high_chaser_backtest(ticker, num_days)
        time.sleep(2)  # Small delay between symbols to avoid rate limits

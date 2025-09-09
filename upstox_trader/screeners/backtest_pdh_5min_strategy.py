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

def run_pdh_5min_backtest(ticker: str, num_days: int):
    console.print(f"\n[bold cyan]🚀 Running PDH 5min Backtest for {ticker} | Duration: {num_days} days | R:R 2:4 with Trailing Stop[/bold cyan]")

    from_date, to_date = get_date_range(num_days)
    console.print(f"[dim]Fetching data from {from_date} to {to_date}[/dim]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Force download and cache of instrument file if not present
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX") 
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    # 1. Fetch Historical 5-min Data
    historical_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="minutes",
        interval=5,
        from_date=from_date,
        to_date=to_date
    )

    if historical_df is None or historical_df.empty:
        console.print(f"[red]❌ Could not fetch 5-minute data for {ticker} from {from_date} to {to_date}.[/red]")
        console.print("[yellow]Please ensure the market was open and data is available for this date.[/yellow]")
        return

    # 2. Fetch Daily Data for PDH calculation (slightly larger range)
    daily_from_date = (datetime.strptime(from_date, '%Y-%m-%d') - timedelta(days=2)).strftime('%Y-%m-%d')
    daily_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="days",
        interval=1,
        from_date=daily_from_date, 
        to_date=to_date
    )

    if daily_df is None or daily_df.empty:
        console.print(f"[red]❌ Could not fetch daily data for {ticker} from {daily_from_date} to {to_date}. Cannot determine PDH.[/red]")
        return

    # Create a mapping of date to previous day's high (PDH)
    prev_day_highs = {}
    for j in range(1, len(daily_df)):
        current_daily_date = daily_df.index[j].date()
        prev_day_high = daily_df['high'].iloc[j-1].max() if isinstance(daily_df['high'].iloc[j-1], pd.Series) else daily_df['high'].iloc[j-1]
        prev_day_highs[current_daily_date] = prev_day_high

    # 3. Simulate Backtest
    trades = []
    current_position = None  # None, 'LONG', 'SHORT'
    entry_price = 0
    entry_time = None
    highest_profit_pct = 0  # Track highest profit for trailing stop
    
    # Strategy risk management parameters (Improved R:R ~4:1)
    STOP_LOSS_PCT = -1.5  # -1.5% (tighter SL)
    TAKE_PROFIT_PCT = 3.5  # +6% (wider TP)
    TRAILING_STOP_PCT = 0.5  # Trail by 0.3% from highest profit (tighter trail)
    TRAILING_ACTIVATION_PCT = 1.0  # Activate trailing only after +1% profit
    CAPITAL_PER_TRADE = 100000  # ₹1 lakh per trade

    console.print("\n[bold magenta]📈 Starting PDH 5min Backtest Simulation...[/bold magenta]")

    # Group historical_df by date to process day by day
    historical_df['date'] = historical_df.index.date
    for date, daily_candles_df in historical_df.groupby('date'):
        # Skip if PDH not available for this date
        if date not in prev_day_highs:
            console.print(f"[dim yellow]Skipping {date}: PDH not available. (Missing historical daily data for prior day).[/dim yellow]")
            continue

        pdh = prev_day_highs[date]
        day_open_price = daily_candles_df['open'].iloc[0]  # First 5-min open
        console.print(f"\n[bold blue]Analyzing {date} | 5min Open: ₹{day_open_price:.2f} | PDH: ₹{pdh:.2f}[/bold blue]")

        # Ensure we have at least 2 candles for confirmation
        if len(daily_candles_df) < 2:
            console.print(f"[dim yellow]Skipping {date}: Not enough 5-min candles for confirmation (need 2).[/dim yellow]")
            continue

        # No new entries after 2 PM
        first_candle_time = daily_candles_df.index[0]
        if first_candle_time.hour >= 14:
            console.print(f"[dim yellow]Skipping {date}: Entry time after 2 PM ({first_candle_time.strftime('%H:%M')}).[/dim yellow]")
            continue

        # Get first two 5-min candles for confirmation
        first_candle = daily_candles_df.iloc[0]
        second_candle = daily_candles_df.iloc[1]
        
        # Initial signal based on first 5-min open vs PDH
        initial_signal = None
        if day_open_price > pdh:
            initial_signal = 'LONG'
            console.print(f"[green]✅ Initial LONG Signal: 5min Open (₹{day_open_price:.2f}) > PDH (₹{pdh:.2f})[/green]")
        else:
            initial_signal = 'SHORT'
            console.print(f"[red]✅ Initial SHORT Signal: 5min Open (₹{day_open_price:.2f}) <= PDH (₹{pdh:.2f})[/red]")
        
        # Confirmation with second candle
        entry_signal = None
        if initial_signal == 'LONG' and second_candle['close'] > first_candle['open']:
            entry_signal = 'LONG'
            console.print(f"[green]✅ LONG Confirmed: Second close (₹{second_candle['close']:.2f}) > First open (₹{first_candle['open']:.2f})[/green]")
        elif initial_signal == 'SHORT' and second_candle['close'] < first_candle['open']:
            entry_signal = 'SHORT'
            console.print(f"[red]✅ SHORT Confirmed: Second close (₹{second_candle['close']:.2f}) < First open (₹{first_candle['open']:.2f})[/red]")
        else:
            console.print(f"[dim yellow]❌ Signal Not Confirmed: Second candle did not confirm direction.[/dim yellow]")
        
        # Execute trade if signal is confirmed and no position is open
        if entry_signal and current_position is None:
            current_position = entry_signal
            entry_price = second_candle['close']  # Enter at second close
            entry_time = second_candle.name  # Timestamp of second candle
            highest_profit_pct = 0  # Reset for new trade
            console.print(f"[{'green' if entry_signal == 'LONG' else 'red'}]⬆️⬇️ {entry_signal} Entry for {ticker} @ ₹{entry_price:.2f} | Time: {entry_time.strftime('%Y-%m-%d %H:%M')}[/{'green' if entry_signal == 'LONG' else 'red'}]")

            # Simulate trade progression for the rest of the day (skip candles before entry)
            for i, (timestamp, candle) in enumerate(daily_candles_df.iterrows()):
                if timestamp <= entry_time:  # Skip candles before or at entry
                    continue

                current_price = candle['close']

                # Check for trade exit conditions
                if current_position:
                    pnl_pct = ((current_price - entry_price) / entry_price) * 100
                    if current_position == 'SHORT':
                        pnl_pct *= -1  # Invert P&L for short position

                    # Time-based exit after 12:00 PM if no other exit triggered
                    if timestamp.hour >= 12:
                        pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                        trades.append({
                            'entry_time': entry_time,
                            'exit_time': timestamp,
                            'side': current_position,
                            'pdh': pdh,
                            'entry_price': entry_price,
                            'exit_price': current_price,
                            'pnl_pct': pnl_pct,
                            'pnl_amount': pnl_amount,
                            'reason': 'TIME_EXIT'
                        })
                        console.print(f"[blue]⏰ Time Exit (12PM) for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/blue]")
                        current_position = None
                        break  # Exit inner loop for current day

                    # Update highest profit for trailing stop
                    if pnl_pct > highest_profit_pct:
                        highest_profit_pct = pnl_pct

                    # Check Stop Loss
                    if pnl_pct <= STOP_LOSS_PCT:
                        pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                        trades.append({
                            'entry_time': entry_time,
                            'exit_time': timestamp,
                            'side': current_position,
                            'pdh': pdh,
                            'entry_price': entry_price,
                            'exit_price': current_price,
                            'pnl_pct': pnl_pct,
                            'pnl_amount': pnl_amount,
                            'reason': 'STOP_LOSS'
                        })
                        console.print(f"[red]🛑 SL Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/red]")
                        current_position = None
                        break  # Exit inner loop for current day
                    
                    # Check Trailing Stop (activate only after +1% profit)
                    if highest_profit_pct >= TRAILING_ACTIVATION_PCT and (highest_profit_pct - pnl_pct) >= TRAILING_STOP_PCT:
                        pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                        trades.append({
                            'entry_time': entry_time,
                            'exit_time': timestamp,
                            'side': current_position,
                            'pdh': pdh,
                            'entry_price': entry_price,
                            'exit_price': current_price,
                            'pnl_pct': pnl_pct,
                            'pnl_amount': pnl_amount,
                            'reason': 'TRAILING_STOP'
                        })
                        console.print(f"[orange3]📉 Trailing Stop Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% (High: {highest_profit_pct:+.2f}%) | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/orange3]")
                        current_position = None
                        break  # Exit inner loop for current day
                    
                    # Check Take Profit
                    if pnl_pct >= TAKE_PROFIT_PCT:
                        pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                        trades.append({
                            'entry_time': entry_time,
                            'exit_time': timestamp,
                            'side': current_position,
                            'pdh': pdh,
                            'entry_price': entry_price,
                            'exit_price': current_price,
                            'pnl_pct': pnl_pct,
                            'pnl_amount': pnl_amount,
                            'reason': 'TAKE_PROFIT'
                        })
                        console.print(f"[green]🎉 TP Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/green]")
                        current_position = None
                        break  # Exit inner loop for current day

        # If position still open at end of day, close it
        if current_position:
            final_price = daily_candles_df['close'].iloc[-1]  # Close at last candle of the day
            pnl_pct = ((final_price - entry_price) / entry_price) * 100
            if current_position == 'SHORT':
                pnl_pct *= -1
            pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
            trades.append({
                'entry_time': entry_time,
                'exit_time': daily_candles_df.index[-1],  # Exit at EOD
                'side': current_position,
                'pdh': pdh,
                'entry_price': entry_price,
                'exit_price': final_price,
                'pnl_pct': pnl_pct,
                'pnl_amount': pnl_amount,
                'reason': 'EOD_CLOSE'
            })
            console.print(f"[yellow]🏁 EOD Close for {ticker} ({current_position}) @ ₹{final_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | Time: {daily_candles_df.index[-1].strftime('%Y-%m-%d %H:%M')}[/yellow]")
            current_position = None  # Reset for next day

    # 5. Report Backtest Results
    console.print("\n[bold cyan]📊 Backtest Results:[/bold cyan]")
    if not trades:
        console.print("[yellow]No trades were generated during the backtest period.[/yellow]")
        return

    results_table = Table(title="Simulated Trades", show_header=True, header_style="bold blue")
    results_table.add_column("Entry Time", style="cyan")
    results_table.add_column("Exit Time", style="cyan")
    results_table.add_column("Side", style="white")
    results_table.add_column("PDH", justify="right", style="blue")
    results_table.add_column("Entry Price", justify="right", style="green")
    results_table.add_column("Exit Price", justify="right", style="red")
    results_table.add_column("P&L %", justify="right", style="magenta")
    results_table.add_column("P&L ₹", justify="right", style="yellow")
    results_table.add_column("Reason", style="dim")

    total_pnl_pct = 0
    total_pnl_amount = 0
    winning_trades = 0
    losing_trades = 0

    for trade in trades:
        pnl_style = "green" if trade['pnl_pct'] > 0 else "red"
        total_pnl_pct += trade['pnl_pct']
        total_pnl_amount += trade['pnl_amount']
        if trade['pnl_pct'] > 0:
            winning_trades += 1
        else:
            losing_trades += 1

        results_table.add_row(
            trade['entry_time'].strftime('%Y-%m-%d %H:%M'), 
            trade['exit_time'].strftime('%Y-%m-%d %H:%M'), 
            trade['side'],
            f"₹{trade['pdh']:.2f}",
            f"₹{trade['entry_price']:.2f}",
            f"₹{trade['exit_price']:.2f}",
            f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
            f"[{pnl_style}]{trade['pnl_amount']:+,.0f}[/{pnl_style}]",
            trade['reason']
        )
    
    console.print(results_table)

    win_rate = (winning_trades / len(trades) * 100) if trades else 0

    console.print(f"\n[bold yellow]Summary for {ticker}:[/bold yellow]")
    console.print(f"Total Trades: {len(trades)}")
    console.print(f"Winning Trades: {winning_trades}")
    console.print(f"Losing Trades: {losing_trades}")
    console.print(f"Win Rate: {win_rate:.2f}%")
    console.print(f"Total P&L %: {total_pnl_pct:+.2f}%")
    console.print(f"Total P&L ₹: {total_pnl_amount:+,.0f}")
    console.print("\n[bold green]Backtest completed.[/bold green]")

# Main execution for all symbols
if __name__ == "__main__":
    # List of symbols from temp_stock_screener.py (remove NSE: prefix)
    symbols = [
        "ABFRL", "ATHERENERG", "CUPID", "EXIDEIND", "COFFEEDAY"
    ]
    num_days = 90  # Backtest period

    for ticker in symbols:
        run_pdh_5min_backtest(ticker, num_days)
        time.sleep(2)  # Small delay between symbols to avoid rate limits
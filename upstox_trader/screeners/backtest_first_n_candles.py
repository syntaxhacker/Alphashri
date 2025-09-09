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

def run_first_n_candles_backtest(ticker: str, interval_minutes: int, num_days: int, num_candles_for_entry: int, hold_until_eod: bool = False):
    hold_mode = "Hold until EOD" if hold_until_eod else "SL/TP/Trailing"
    console.print(f"\n[bold cyan]🚀 Running First {num_candles_for_entry} Candles Backtest for {ticker} | Interval: {interval_minutes}min | Duration: {num_days} days | Mode: {hold_mode}[/bold cyan]")

    from_date, to_date = get_date_range(num_days)
    console.print(f"[dim]Fetching data from {from_date} to {to_date}[/dim]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Force download and cache of instrument file if not present
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX") 
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    # 1. Fetch Historical Data for the main interval
    if interval_minutes < 1440: # Intraday intervals
        unit = "minutes"
        interval = interval_minutes
    else: # Daily interval (though strategy is for intraday)
        unit = "days"
        interval = 1 

    historical_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit=unit,
        interval=interval,
        from_date=from_date,
        to_date=to_date
    )

    if historical_df is None or historical_df.empty:
        console.print(f"[red]❌ Could not fetch {interval_minutes}-minute data for {ticker} from {from_date} to {to_date}.[/red]")
        console.print("[yellow]Please ensure the market was open and data is available for this date.[/yellow]")
        return

    # 2. Fetch Daily Close Prices for previous days
    # Fetch daily data for a slightly larger range to ensure we get the close for the first day of backtest
    daily_from_date = (datetime.strptime(from_date, '%Y-%m-%d') - timedelta(days=2)).strftime('%Y-%m-%d')
    daily_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="days",
        interval=1,
        from_date=daily_from_date, 
        to_date=to_date
    )

    if daily_df is None or daily_df.empty:
        console.print(f"[red]❌ Could not fetch daily data for {ticker} from {daily_from_date} to {to_date}. Cannot determine previous day's close.[/red]")
        return

    # Create a mapping of date to previous day's close
    prev_day_closes = {}
    for j in range(1, len(daily_df)):
        current_daily_date = daily_df.index[j].date()
        prev_day_close = daily_df['close'].iloc[j-1]
        prev_day_closes[current_daily_date] = prev_day_close

    # 3. Simulate Backtest
    trades = []
    current_position = None  # None, 'LONG', 'SHORT'
    entry_price = 0
    entry_time = None
    highest_profit_pct = 0  # Track highest profit for trailing stop
    
    # Strategy risk management parameters
    STOP_LOSS_PCT = -0.25  # -0.25%
    TAKE_PROFIT_PCT = 2.0   # +2.0%
    TRAILING_STOP_PCT = 0.5  # Trail by 0.5% from highest profit
    CAPITAL_PER_TRADE = 100000  # ₹1 lakh per trade

    console.print("\n[bold magenta]📈 Starting First N Candles Backtest Simulation...[/bold magenta]")

    # Group historical_df by date to process day by day
    historical_df['date'] = historical_df.index.date
    for date, daily_candles_df in historical_df.groupby('date'):
        # Skip if previous day's close is not available for this date
        if date not in prev_day_closes:
            console.print(f"[dim yellow]Skipping {date}: Previous day's close not available. (Missing historical daily data for prior day).[/dim yellow]")
            continue

        previous_day_close = prev_day_closes[date]
        day_open_price = daily_candles_df['open'].iloc[0]  # Store opening price of the day
        console.print(f"\n[bold blue]Analyzing {date} | Open: ₹{day_open_price:.2f} | Previous Day Close: ₹{previous_day_close:.2f}[/bold blue]")

        # Ensure we have enough candles for the entry pattern
        if len(daily_candles_df) < num_candles_for_entry:
            console.print(f"[dim yellow]Skipping {date}: Not enough candles ({len(daily_candles_df)}) for {num_candles_for_entry} candle entry pattern.[/dim yellow]")
            continue

        # Get the first N candles for the day
        first_n_candles = daily_candles_df.head(num_candles_for_entry)
        
        # Check entry condition based on first N candles
        entry_signal = None
        nth_candle_close = first_n_candles['close'].iloc[num_candles_for_entry-1]
        
        # Long Entry Condition
        long_condition_met = False
        # The close of the last candle in the N-candle sequence is higher than the previous day's close
        if nth_candle_close > previous_day_close:
            long_condition_met = True
            entry_signal = 'LONG'
            console.print(f"[green]✅ LONG Signal: {num_candles_for_entry}th candle close (₹{nth_candle_close:.2f}) > Previous close (₹{previous_day_close:.2f})[/green]")

        # Short Entry Condition
        elif nth_candle_close < previous_day_close:
            entry_signal = 'SHORT'
            console.print(f"[red]✅ SHORT Signal: {num_candles_for_entry}th candle close (₹{nth_candle_close:.2f}) < Previous close (₹{previous_day_close:.2f})[/red]")
        
        else:
            # No signal - explain why
            console.print(f"[dim]❌ No Signal: {num_candles_for_entry}th candle close (₹{nth_candle_close:.2f}) equals previous close (₹{previous_day_close:.2f})[/dim]")
        
        # Execute trade if signal is found and no position is open
        # Only proceed if a signal is found and there's no open position
        if entry_signal and current_position is None:
            entry_candle = first_n_candles.iloc[num_candles_for_entry-1]
            current_position = entry_signal
            entry_price = entry_candle['close']
            entry_time = entry_candle.name # Timestamp of the entry candle
            highest_profit_pct = 0  # Reset for new trade
            console.print(f"[{'green' if entry_signal == 'LONG' else 'red'}]⬆️⬇️ {entry_signal} Entry for {ticker} @ ₹{entry_price:.2f} | Time: {entry_time.strftime('%Y-%m-%d %H:%M')}[/{'green' if entry_signal == 'LONG' else 'red'}]")

            # Simulate trade progression for the rest of the day ONLY IF a trade was entered
            for i, (timestamp, candle) in enumerate(daily_candles_df.iterrows()):
                if timestamp <= entry_time: # Skip candles before entry
                    continue

                current_price = candle['close']

                # Check for trade exit conditions
                if current_position: # Check if position is still open
                    pnl_pct = ((current_price - entry_price) / entry_price) * 100
                    if current_position == 'SHORT':
                        pnl_pct *= -1 # Invert P&L for short position

                    # Skip exit conditions if holding until EOD
                    if not hold_until_eod:
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
                                'open_price': day_open_price,
                                'entry_price': entry_price,
                                'exit_price': current_price,
                                'pnl_pct': pnl_pct,
                                'pnl_amount': pnl_amount,
                                'reason': 'STOP_LOSS'
                            })
                            console.print(f"[red]🛑 SL Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% (₹{pnl_amount:+,.0f}) | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/red]")
                            current_position = None
                            break # Exit inner loop for current day
                        
                        # Check Trailing Stop (only if we've been profitable)
                        if highest_profit_pct > 0 and (highest_profit_pct - pnl_pct) >= TRAILING_STOP_PCT:
                            pnl_amount = (pnl_pct / 100) * CAPITAL_PER_TRADE
                            trades.append({
                                'entry_time': entry_time,
                                'exit_time': timestamp,
                                'side': current_position,
                                'open_price': day_open_price,
                                'entry_price': entry_price,
                                'exit_price': current_price,
                                'pnl_pct': pnl_pct,
                                'pnl_amount': pnl_amount,
                                'reason': 'TRAILING_STOP'
                            })
                            console.print(f"[orange3]📉 Trailing Stop Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% (High: {highest_profit_pct:+.2f}%) | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/orange3]")
                            current_position = None
                            break # Exit inner loop for current day
                        
                        # Check Take Profit
                        if pnl_pct >= TAKE_PROFIT_PCT:
                            trades.append({
                                'entry_time': entry_time,
                                'exit_time': timestamp,
                                'side': current_position,
                                'open_price': day_open_price,
                                'entry_price': entry_price,
                                'exit_price': current_price,
                                'pnl_pct': pnl_pct,
                                'reason': 'TAKE_PROFIT'
                            })
                            console.print(f"[green]🎉 TP Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}% | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/green]")
                            current_position = None
                            break # Exit inner loop for current day
            
        # If position still open at end of day, close it
        if current_position:
            final_price = daily_candles_df['close'].iloc[-1] # Close at last candle of the day
            pnl_pct = ((final_price - entry_price) / entry_price) * 100
            if current_position == 'SHORT':
                pnl_pct *= -1
            trades.append({
                'entry_time': entry_time,
                'exit_time': daily_candles_df.index[-1], # Exit at EOD
                'side': current_position,
                'open_price': day_open_price,
                'entry_price': entry_price,
                'exit_price': final_price,
                'pnl_pct': pnl_pct,
                'reason': 'EOD_CLOSE'
            })
            console.print(f"[yellow]🏁 EOD Close for {ticker} ({current_position}) @ ₹{final_price:.2f} | P&L: {pnl_pct:+.2f}% | Time: {daily_candles_df.index[-1].strftime('%Y-%m-%d %H:%M')}[/yellow]")
            current_position = None # Reset for next day

    # 5. Report Backtest Results
    console.print("\n[bold cyan]📊 Backtest Results:[/bold cyan]")
    if not trades:
        console.print("[yellow]No trades were generated during the backtest period.[/yellow]")
        return

    results_table = Table(title="Simulated Trades", show_header=True, header_style="bold blue")
    results_table.add_column("Entry Time", style="cyan")
    results_table.add_column("Exit Time", style="cyan")
    results_table.add_column("Side", style="white")
    results_table.add_column("Open Price", justify="right", style="blue")
    results_table.add_column("Entry Price", justify="right", style="green")
    results_table.add_column("Exit Price", justify="right", style="red")
    results_table.add_column("P&L %", justify="right", style="magenta")
    results_table.add_column("Reason", style="dim")

    total_pnl_pct = 0
    winning_trades = 0
    losing_trades = 0

    for trade in trades:
        pnl_style = "green" if trade['pnl_pct'] > 0 else "red"
        total_pnl_pct += trade['pnl_pct']
        if trade['pnl_pct'] > 0:
            winning_trades += 1
        else:
            losing_trades += 1

        results_table.add_row(
            trade['entry_time'].strftime('%Y-%m-%d %H:%M'), 
            trade['exit_time'].strftime('%Y-%m-%d %H:%M'), 
            trade['side'],
            f"₹{trade['open_price']:.2f}",
            f"₹{trade['entry_price']:.2f}",
            f"₹{trade['exit_price']:.2f}",
            f"[{pnl_style}]{trade['pnl_pct']:+.2f}%[/{pnl_style}]",
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
    console.print("\n[bold green]Backtest completed.[/bold green]")

# Main execution loop for multiple timeframes and days
if __name__ == "__main__":
    test_configs = [
        {"ticker": "WAAREEENER", "interval_minutes": 15, "num_days": 90, "num_candles_for_entry": 2, "hold_until_eod": False}, 
        # {"ticker": "JINDALPOLY", "interval_minutes": 1, "num_days": 7, "num_candles_for_entry": 2, "hold_until_eod": True},
        # {"ticker": "JINDALPOLY", "interval_minutes": 1, "num_days": 7, "num_candles_for_entry": 4},
        # {"ticker": "JINDALPOLY", "interval_minutes": 1, "num_days": 7, "num_candles_for_entry": 5},
        # {"ticker": "JINDALPOLY", "interval_minutes": 5, "num_days": 7, "num_candles_for_entry": 2},
        # {"ticker": "JINDALPOLY", "interval_minutes": 15, "num_days": 7, "num_candles_for_entry": 2},
    ]

    for config in test_configs:
        run_first_n_candles_backtest(
            config["ticker"], 
            config["interval_minutes"], 
            config["num_days"], 
            config["num_candles_for_entry"],
            config.get("hold_until_eod", False)
        )
        time.sleep(2) # Small delay between tests

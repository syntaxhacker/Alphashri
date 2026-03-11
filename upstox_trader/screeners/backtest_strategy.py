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

def run_backtest(ticker: str, interval_minutes: int, num_days: int):
    console.print(f"\n[bold cyan]🚀 Running Backtest for {ticker} | Interval: {interval_minutes}min | Duration: {num_days} days[/bold cyan]")

    from_date, to_date = get_date_range(num_days)
    console.print(f"[dim]Fetching data from {from_date} to {to_date}[/dim]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Force download and cache of instrument file if not present
    console.print("[bold green]Attempting to load/download Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX") 
    console.print("[bold green]Instrument data loading/downloading process initiated.[/bold green]")

    # 1. Fetch Historical Data
    # Adjust unit based on interval
    if interval_minutes < 1440: # Intraday intervals
        unit = "minutes"
        interval = interval_minutes
    else: # Daily interval
        unit = "days"
        interval = 1 # Always 1 day interval for daily data

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

    # 2. Save Historical Data to CSV
    csv_filename = f"{ticker.lower()}_{interval_minutes}min_{from_date}_to_{to_date}.csv"
    csv_path = os.path.join(_screeners_dir, csv_filename)
    historical_df.to_csv(csv_path)
    console.print(f"[green]✅ Historical data saved to {csv_path}[/green]")

    # 3. Strategy Specific Calculations: EMAs and Average Volume for Scalping
    # We will use 5-period and 10-period EMAs
    
    if not historical_df.empty:
        historical_df['EMA5'] = historical_df['close'].ewm(span=5, adjust=False).mean()
        historical_df['EMA10'] = historical_df['close'].ewm(span=10, adjust=False).mean()
        console.print("[green]✅ Calculated 5-period and 10-period EMAs.[/green]")
    else:
        console.print("[yellow]⚠️ Historical data is empty. EMAs will be NaN.[/yellow]")
        historical_df['EMA5'] = pd.NA
        historical_df['EMA10'] = pd.NA

    # Calculate average volume for the period from fetched data (e.g., last 20 candles)
    historical_df['AVG_VOL_20'] = historical_df['volume'].rolling(window=20).mean()
    console.print("[green]✅ Calculated 20-period Average Volume.[/green]")

    # Calculate 14-period RSI
    if not historical_df.empty:
        # Need to handle potential NaN values for initial RSI calculation
        # Simplified RSI calculation for demonstration (more accurate RSI involves separate avg gain/loss)
        delta = historical_df['close'].diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        
        avg_gain = gain.ewm(span=14, adjust=False).mean()
        avg_loss = loss.ewm(span=14, adjust=False).mean()
        
        rs = avg_gain / avg_loss
        historical_df['RSI'] = 100 - (100 / (1 + rs))
        
        # Replace inf with NaN if division by zero occurred.
        historical_df['RSI'] = historical_df['RSI'].replace([float('inf'), -float('inf')], pd.NA)
        console.print("[green]✅ Calculated 14-period RSI.[/green]")
    else:
        historical_df['RSI'] = pd.NA
        console.print("[yellow]⚠️ Historical data is empty. RSI column created with NaNs.[/yellow]")

    # 4. Simulate Backtest
    trades = []
    current_position = None  # None, 'LONG', 'SHORT'
    entry_price = 0
    entry_time = None
    
    # Scalping strategy risk management parameters
    STOP_LOSS_PCT = -0.10  # -0.10% (Much tighter)
    TAKE_PROFIT_PCT = 0.3   # +0.3%
    MIN_VOLUME_MULTIPLIER = 2.0 # Volume must be 2.0x average for a signal (Strengthened)
    COOLING_PERIOD_MINUTES = 5 # Cooling period of 5 minutes (5 candles for 1-min interval)

    console.print("\n[bold magenta]📈 Starting Scalping Backtest Simulation...[/bold magenta]")

    last_trade_exit_time = None # Track the time of the last trade exit

    for i, (timestamp, candle) in enumerate(historical_df.iterrows()):
        # Skip initial candles until EMAs and AVG_VOL_20 are calculable (20 for AVG_VOL, 14 for RSI)
        if i < 20: 
            continue

        current_price = candle['close']
        current_volume = candle['volume']
        current_ema5 = candle['EMA5']
        current_ema10 = candle['EMA10']
        avg_vol_20 = candle['AVG_VOL_20']
        current_rsi = candle['RSI'] # Extract RSI value

        # Skip if EMAs, avg_vol, or RSI are not yet calculated (initial periods) or are NaN
        if pd.isna(current_ema5) or pd.isna(current_ema10) or pd.isna(avg_vol_20) or pd.isna(current_rsi):
            continue
        
        # Check for trade exit conditions first
        if current_position:
            pnl_pct = ((current_price - entry_price) / entry_price) * 100
            
            if current_position == 'SHORT':
                pnl_pct *= -1 # Invert P&L for short position

            # Check Stop Loss
            if pnl_pct <= STOP_LOSS_PCT:
                trades.append({
                    'entry_time': entry_time,
                    'exit_time': timestamp,
                    'side': current_position,
                    'entry_price': entry_price,
                    'exit_price': current_price,
                    'pnl_pct': pnl_pct,
                    'reason': 'STOP_LOSS'
                })
                console.print(f"[red]🛑 SL Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}%[/red]")
                last_trade_exit_time = timestamp # Record exit time for cooling period
                current_position = None
                continue
            
            # Check Take Profit
            if pnl_pct >= TAKE_PROFIT_PCT:
                trades.append({
                    'entry_time': entry_time,
                    'exit_time': timestamp,
                    'side': current_position,
                    'entry_price': entry_price,
                    'exit_price': current_price,
                    'pnl_pct': pnl_pct,
                    'reason': 'TAKE_PROFIT'
                })
                console.print(f"[green]🎉 TP Hit for {ticker} ({current_position}) at {current_price:.2f} | P&L: {pnl_pct:+.2f}%[/green]")
                last_trade_exit_time = timestamp # Record exit time for cooling period
                current_position = None
                continue

        # Check for new trade entry signals if no active position
        # Ensure we have previous candle data for crossover detection
        # Apply cooling period: Check if enough time has passed since the last trade exit
        if not current_position and i > 0 and \
           (last_trade_exit_time is None or (timestamp - last_trade_exit_time).total_seconds() / 60 >= COOLING_PERIOD_MINUTES):
            
            prev_ema5 = historical_df['EMA5'].iloc[i-1]
            prev_ema10 = historical_df['EMA10'].iloc[i-1]

            # Long Entry Condition (Strengthened with RSI)
            if (current_ema5 > current_ema10 and prev_ema5 <= prev_ema10 and # Crossover
                current_price > current_ema5 and # Price above both EMAs
                current_price > current_ema10 and
                candle['open'] < current_price and # Current candle is bullish
                current_price > historical_df['close'].iloc[i-1] and # Price closed higher than previous candle
                current_volume >= (MIN_VOLUME_MULTIPLIER * avg_vol_20) and # Volume confirmation
                current_rsi > 50): # RSI filter for momentum
                
                current_position = 'LONG'
                entry_price = current_price
                entry_time = timestamp
                console.print(f"[bold green]⬆️ LONG Entry for {ticker} @ ₹{entry_price:.2f} | EMA5: ₹{current_ema5:.2f} | EMA10: ₹{current_ema10:.2f} | Vol: {current_volume/avg_vol_20:.2f}x | RSI: {current_rsi:.2f} | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/bold green]")
                
            # Short Entry Condition (Strengthened with RSI)
            elif (current_ema5 < current_ema10 and prev_ema5 >= prev_ema10 and # Crossover
                  current_price < current_ema5 and # Price below both EMAs
                  current_price < current_ema10 and
                  candle['open'] > current_price and # Current candle is bearish
                  current_price < historical_df['close'].iloc[i-1] and # Price closed lower than previous candle
                  current_volume >= (MIN_VOLUME_MULTIPLIER * avg_vol_20) and # Volume confirmation
                  current_rsi < 50): # RSI filter for momentum
                
                current_position = 'SHORT'
                entry_price = current_price
                entry_time = timestamp
                console.print(f"[bold red]⬇️ SHORT Entry for {ticker} @ ₹{entry_price:.2f} | EMA5: ₹{current_ema5:.2f} | EMA10: ₹{current_ema10:.2f} | Vol: {current_volume/avg_vol_20:.2f}x | RSI: {current_rsi:.2f} | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/bold red]")
    
    # --- End of Day (EOD) Check and Close ---
    # Define market close time for NSE
    market_close_hour = 15
    market_close_minute = 30
    
    # Get the date of the current candle
    current_date = timestamp.date()
    
    # Get the time of the current candle
    current_candle_time = timestamp.time()
    
    # Check if the current candle's time is near or past market close
    # And if it's not the very last candle of the entire historical_df
    if current_position and \
       (current_candle_time >= datetime(1,1,1,market_close_hour, market_close_minute).time()):
        
        # Check if this is the last candle of the day, or near the end
        next_candle_time = historical_df.index[i+1].time() if i+1 < len(historical_df) else None
        next_candle_date = historical_df.index[i+1].date() if i+1 < len(historical_df) else None
        
        # If the next candle is on a new day, or if it's the last candle of the df,
        # or if the next candle is after market close, then close position EOD.
        if next_candle_date and next_candle_date > current_date or \
           next_candle_time is None or \
           (next_candle_time is not None and next_candle_time < datetime(1,1,1,9,15).time()): # Next candle is start of new day
            
            final_price = current_price # Close at current candle's close
            pnl_pct = ((final_price - entry_price) / entry_price) * 100
            if current_position == 'SHORT':
                pnl_pct *= -1
            trades.append({
                'entry_time': entry_time,
                'exit_time': timestamp, # Exit at the end of this candle
                'side': current_position,
                'entry_price': entry_price,
                'exit_price': final_price,
                'pnl_pct': pnl_pct,
                'reason': 'EOD_CLOSE'
            })
            console.print(f"[yellow]🏁 EOD Close for {ticker} ({current_position}) @ ₹{final_price:.2f} | P&L: {pnl_pct:+.2f}% | Time: {timestamp.strftime('%Y-%m-%d %H:%M')}[/yellow]")
            current_position = None # Reset position after EOD close

    # 5. Report Backtest Results
    console.print("\n[bold cyan]📊 Backtest Results:[/bold cyan]")
    if not trades:
        console.print("[yellow]No trades were generated during the backtest period.[/yellow]")
        return

    results_table = Table(title="Simulated Trades", show_header=True, header_style="bold blue")
    results_table.add_column("Entry Time", style="cyan")
    results_table.add_column("Exit Time", style="cyan")
    results_table.add_column("Side", style="white")
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
            trade['entry_time'].strftime('%Y-%m-%d %H:%M'), # Updated format
            trade['exit_time'].strftime('%Y-%m-%d %H:%M'), # Updated format
            trade['side'],
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
        {"ticker": "COCHINSHIP", "interval_minutes": 1, "num_days": 7}, # 1-minute for scalping
        # {"ticker": "JINDALPOLY", "interval_minutes": 5, "num_days": 7},
        # {"ticker": "JINDALPOLY", "interval_minutes": 15, "num_days": 7},
        # {"ticker": "JINDALPOLY", "interval_minutes": 60, "num_days": 7},  # 1-hour
        # {"ticker": "JINDALPOLY", "interval_minutes": 1440, "num_days": 7} # 1-day (daily)
    ]

    for config in test_configs:
        run_backtest(config["ticker"], config["interval_minutes"], config["num_days"])
        time.sleep(2) # Small delay between tests

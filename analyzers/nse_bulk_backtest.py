#!/usr/bin/env python3

import sys
import os
import json
import pandas as pd
from datetime import datetime, timedelta
import time

# Add project root to sys.path for absolute imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_project_root_dir = _current_file_dir

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeRemainingColumn, SpinnerColumn

console = Console()

def get_date_range(num_days: int):
    """Determines the date range for the backtest."""
    today = datetime.now()
    to_date = today.strftime('%Y-%m-%d')
    from_date = (today - timedelta(days=num_days)).strftime('%Y-%m-%d')
    return from_date, to_date

def load_nse_eq_instruments(json_file_path):
    """Load NSE EQ instruments from JSON file."""
    try:
        with open(json_file_path, 'r') as f:
            instruments = json.load(f)
        
        # Filter only NSE_EQ instruments with instrument_type EQ
        nse_eq_instruments = [
            inst for inst in instruments 
            if inst.get('segment') == 'NSE_EQ' and inst.get('instrument_type') == 'EQ'
        ]
        
        return nse_eq_instruments
    except Exception as e:
        console.print(f"[red]Error loading instruments: {e}[/red]")
        return []

def run_single_backtest(ticker: str, num_days: int, screener):
    """Run backtest for a single ticker."""
    try:
        from_date, to_date = get_date_range(num_days)
        
        # Fetch 1-minute interval data for scalping strategy
        interval_minutes = 1
        unit = "minutes"
        interval = interval_minutes
        
        historical_df = screener.upstox_api.fetch_historical_data_v3(
            symbol=ticker,
            unit=unit,
            interval=interval,
            from_date=from_date,
            to_date=to_date
        )
        
        if historical_df is None or historical_df.empty:
            return {
                'ticker': ticker,
                'error': f'No data available for {ticker}',
                'total_trades': 0,
                'winning_trades': 0,
                'losing_trades': 0,
                'win_rate': 0,
                'total_pnl_pct': 0
            }
        
        # Calculate technical indicators
        historical_df['EMA5'] = historical_df['close'].ewm(span=5, adjust=False).mean()
        historical_df['EMA10'] = historical_df['close'].ewm(span=10, adjust=False).mean()
        historical_df['AVG_VOL_20'] = historical_df['volume'].rolling(window=20).mean()
        
        # Calculate RSI
        delta = historical_df['close'].diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        
        avg_gain = gain.ewm(span=14, adjust=False).mean()
        avg_loss = loss.ewm(span=14, adjust=False).mean()
        
        rs = avg_gain / avg_loss
        historical_df['RSI'] = 100 - (100 / (1 + rs))
        historical_df['RSI'] = historical_df['RSI'].replace([float('inf'), -float('inf')], pd.NA)
        
        # Run backtest simulation
        trades = []
        current_position = None
        entry_price = 0
        entry_time = None
        
        # Strategy parameters
        STOP_LOSS_PCT = -0.10
        TAKE_PROFIT_PCT = 0.3
        MIN_VOLUME_MULTIPLIER = 2.0
        COOLING_PERIOD_MINUTES = 5
        
        last_trade_exit_time = None
        
        for i, (timestamp, candle) in enumerate(historical_df.iterrows()):
            if i < 20:  # Skip initial candles for indicator calculation
                continue
                
            current_price = candle['close']
            current_volume = candle['volume']
            current_ema5 = candle['EMA5']
            current_ema10 = candle['EMA10']
            avg_vol_20 = candle['AVG_VOL_20']
            current_rsi = candle['RSI']
            
            # Skip if indicators are not calculated or are NaN
            if pd.isna(current_ema5) or pd.isna(current_ema10) or pd.isna(avg_vol_20) or pd.isna(current_rsi):
                continue
            
            # Check exit conditions
            if current_position:
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
                
                if current_position == 'SHORT':
                    pnl_pct *= -1
                
                # Stop Loss or Take Profit
                if pnl_pct <= STOP_LOSS_PCT or pnl_pct >= TAKE_PROFIT_PCT:
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': timestamp,
                        'side': current_position,
                        'entry_price': entry_price,
                        'exit_price': current_price,
                        'pnl_pct': pnl_pct,
                        'reason': 'STOP_LOSS' if pnl_pct <= STOP_LOSS_PCT else 'TAKE_PROFIT'
                    })
                    last_trade_exit_time = timestamp
                    current_position = None
                    continue
            
            # Check entry conditions
            if not current_position and i > 0 and \
               (last_trade_exit_time is None or (timestamp - last_trade_exit_time).total_seconds() / 60 >= COOLING_PERIOD_MINUTES):
                
                prev_ema5 = historical_df['EMA5'].iloc[i-1]
                prev_ema10 = historical_df['EMA10'].iloc[i-1]
                
                # Long Entry Condition
                if (current_ema5 > current_ema10 and prev_ema5 <= prev_ema10 and
                    current_price > current_ema5 and current_price > current_ema10 and
                    candle['open'] < current_price and
                    current_price > historical_df['close'].iloc[i-1] and
                    current_volume >= (MIN_VOLUME_MULTIPLIER * avg_vol_20) and
                    current_rsi > 50):
                    
                    current_position = 'LONG'
                    entry_price = current_price
                    entry_time = timestamp
                
                # Short Entry Condition
                elif (current_ema5 < current_ema10 and prev_ema5 >= prev_ema10 and
                      current_price < current_ema5 and current_price < current_ema10 and
                      candle['open'] > current_price and
                      current_price < historical_df['close'].iloc[i-1] and
                      current_volume >= (MIN_VOLUME_MULTIPLIER * avg_vol_20) and
                      current_rsi < 50):
                    
                    current_position = 'SHORT'
                    entry_price = current_price
                    entry_time = timestamp
            
            # EOD Close logic (simplified)
            market_close_hour = 15
            market_close_minute = 30
            current_candle_time = timestamp.time()
            
            if current_position and current_candle_time >= datetime(1,1,1,market_close_hour, market_close_minute).time():
                next_candle_time = historical_df.index[i+1].time() if i+1 < len(historical_df) else None
                if next_candle_time is None or next_candle_time < datetime(1,1,1,9,15).time():
                    final_price = current_price
                    pnl_pct = ((final_price - entry_price) / entry_price) * 100
                    if current_position == 'SHORT':
                        pnl_pct *= -1
                    
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': timestamp,
                        'side': current_position,
                        'entry_price': entry_price,
                        'exit_price': final_price,
                        'pnl_pct': pnl_pct,
                        'reason': 'EOD_CLOSE'
                    })
                    current_position = None
        
        # Calculate results
        total_pnl_pct = sum([trade['pnl_pct'] for trade in trades])
        winning_trades = len([trade for trade in trades if trade['pnl_pct'] > 0])
        losing_trades = len([trade for trade in trades if trade['pnl_pct'] <= 0])
        win_rate = (winning_trades / len(trades) * 100) if trades else 0
        
        return {
            'ticker': ticker,
            'total_trades': len(trades),
            'winning_trades': winning_trades,
            'losing_trades': losing_trades,
            'win_rate': win_rate,
            'total_pnl_pct': total_pnl_pct,
            'error': None
        }
        
    except Exception as e:
        return {
            'ticker': ticker,
            'error': str(e),
            'total_trades': 0,
            'winning_trades': 0,
            'losing_trades': 0,
            'win_rate': 0,
            'total_pnl_pct': 0
        }

def main():
    console.print("[bold cyan]🚀 NSE Bulk Backtest - 300 Days Analysis[/bold cyan]")
    
    # Load NSE EQ instruments
    json_file_path = '/Users/developer/Documents/algos/personal/earner/upstox_trader/config_and_utils/nse_instruments.json'
    instruments = load_nse_eq_instruments(json_file_path)
    
    if not instruments:
        console.print("[red]No instruments found. Exiting.[/red]")
        return
    
    console.print(f"[green]Loaded {len(instruments)} NSE EQ instruments[/green]")
    
    # Extract just the ticker symbols
    tickers = [inst['trading_symbol'] for inst in instruments]
    
    num_days = 300
    results = []
    
    # Initialize screener once to avoid repeated initialization
    console.print("[yellow]Initializing screener... (this may take a moment)[/yellow]")
    screener = TVScreenerUsage(enable_paper_trading=False)
    console.print("[green]Screener initialized successfully[/green]")
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeRemainingColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task("Running backtests...", total=len(tickers))
        
        # Process sequentially to avoid threading issues
        for ticker in tickers:
            try:
                result = run_single_backtest(ticker, num_days, screener)
                results.append(result)
                
                # Update progress with status
                if result['error']:
                    progress.update(task, advance=1, description=f"[red]{ticker}: {result['error'][:50]}...[/red]")
                else:
                    progress.update(task, advance=1, description=f"[green]{ticker}: {result['total_trades']} trades, {result['total_pnl_pct']:+.2f}% P&L[/green]")
                
                # Small delay to prevent API rate limiting
                time.sleep(0.1)
                
            except Exception as e:
                results.append({
                    'ticker': ticker,
                    'error': str(e),
                    'total_trades': 0,
                    'winning_trades': 0,
                    'losing_trades': 0,
                    'win_rate': 0,
                    'total_pnl_pct': 0
                })
                progress.update(task, advance=1, description=f"[red]{ticker}: Exception - {str(e)[:50]}...[/red]")
    
    # Convert results to DataFrame and sort by P&L
    df_results = pd.DataFrame(results)
    df_results = df_results.sort_values('total_pnl_pct', ascending=False)
    
    # Save to CSV
    output_file = f'nse_backtest_results_300days_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    df_results.to_csv(output_file, index=False)
    
    console.print(f"\n[bold green]✅ Backtest completed! Results saved to {output_file}[/bold green]")
    console.print(f"[yellow]Total instruments processed: {len(results)}[/yellow]")
    console.print(f"[yellow]Instruments with errors: {len([r for r in results if r['error']])}[/yellow]")
    console.print(f"[yellow]Successful backtests: {len([r for r in results if not r['error']])}[/yellow]")
    
    # Show top 10 performers
    console.print("\n[bold cyan]🏆 Top 10 Performers by P&L:[/bold cyan]")
    top_10 = df_results.head(10)
    
    for _, row in top_10.iterrows():
        if not row['error']:
            console.print(f"{row['ticker']:12} | Trades: {row['total_trades']:3} | Win Rate: {row['win_rate']:6.2f}% | P&L: {row['total_pnl_pct']:+8.2f}%")

if __name__ == "__main__":
    main()
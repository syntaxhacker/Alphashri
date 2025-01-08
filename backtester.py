import os
import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
import pandas as pd
import numpy as np
import pandas_ta as ta
from abc import ABC, abstractmethod
from rich.console import Console
import logging
from pathlib import Path
import argparse
from binance.client import Client
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn, BarColumn
import math
from concurrent.futures import ProcessPoolExecutor
import multiprocessing

# Initialize Rich console
console = Console()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def fetch_historical_data(symbol: str, start_date: datetime, end_date: datetime, client: Client) -> pd.DataFrame:
    """Fetch historical klines/candlestick data from Binance"""
    console.print(f"[cyan]Fetching historical data for {symbol}...[/cyan]")
    
    # Increase chunk size
    chunk_size = timedelta(days=30)  # Fetch 30 days at a time instead of 7
    
    # Use numpy arrays for better performance
    all_klines = []
    current_start = start_date
    
    # Calculate total chunks needed
    total_days = (end_date - start_date).days
    total_chunks = math.ceil(total_days / 30)
    
    console.print(f"[cyan]Fetching {total_days} days of data from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}[/cyan]")
    
    with Progress() as progress:
        task = progress.add_task("[cyan]Fetching historical data...", total=total_chunks)
        
        while current_start < end_date:
            current_end = min(current_start + chunk_size, end_date)
            try:
                # Convert timestamps to milliseconds for Binance API
                start_ts = int(current_start.timestamp() * 1000)
                end_ts = int(current_end.timestamp() * 1000)
                
                # Add retry mechanism
                max_retries = 3
                retry_count = 0
                while retry_count < max_retries:
                    try:
                        chunk_klines = client.get_historical_klines(
                            symbol=symbol,
                            interval=Client.KLINE_INTERVAL_15MINUTE,
                            start_str=str(start_ts),
                            end_str=str(end_ts)
                        )
                        break
                    except Exception as e:
                        retry_count += 1
                        if retry_count == max_retries:
                            raise e
                        time.sleep(1)  # Wait before retrying
                
                if chunk_klines:
                    all_klines.extend(chunk_klines)
                    console.print(f"[green]✓ {current_start.strftime('%B %d, %Y')} to {current_end.strftime('%B %d, %Y')} ({len(chunk_klines):,} klines)[/green]")
                else:
                    console.print(f"[yellow]No data for {current_start.strftime('%B %d, %Y')} to {current_end.strftime('%B %d, %Y')}[/yellow]")
                    
            except Exception as e:
                console.print(f"[red]Error fetching data: {str(e)}[/red]")
                # Don't break on error, try next chunk
                
            current_start = current_end
            progress.update(task, advance=1)
            time.sleep(0.1)  # Rate limiting
    
    if not all_klines:
        raise ValueError("Failed to fetch historical data")
        
    # Convert to numpy array first, then DataFrame
    data = np.array(all_klines)
    df = pd.DataFrame(data, columns=[
        'timestamp', 'open', 'high', 'low', 'close', 'volume',
        'close_time', 'quote_asset_volume', 'number_of_trades',
        'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
    ])
    
    # Convert timestamp to datetime (fix warning)
    df['timestamp'] = pd.to_datetime(df['timestamp'].astype(float), unit='ms')
    df.set_index('timestamp', inplace=True)
    
    # Convert string values to float
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Sort index to ensure chronological order
    df.sort_index(inplace=True)
    
    # Remove any duplicate timestamps
    df = df[~df.index.duplicated(keep='first')]
    
    return df

class BaseStrategy(ABC):
    """Base class for all trading strategies"""
    
    def __init__(self, stop_loss: float = 0.02, take_profit: float = 0.04, position_size: float = 0.2,
                 ema_fast: int = 12, ema_slow: int = 26, sma_period: int = 50, 
                 rsi_period: int = 14, stoch_period: int = 14, macd_fast: int = 12,
                 macd_slow: int = 26, macd_signal: int = 9):
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        self.ema_fast = ema_fast
        self.ema_slow = ema_slow
        self.sma_period = sma_period
        self.rsi_period = rsi_period
        self.stoch_period = stoch_period
        self.macd_fast = macd_fast
        self.macd_slow = macd_slow
        self.macd_signal = macd_signal
        
    @abstractmethod
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate technical indicators"""
        pass
        
    @abstractmethod
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals from data"""
        pass

class TrendFollowingStrategy(BaseStrategy):
    """Trend following strategy using moving averages and momentum"""
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators"""
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            
        # Trend indicators with configurable periods
        df['ema_fast'] = ta.ema(df['close'], length=self.ema_fast)
        df['ema_slow'] = ta.ema(df['close'], length=self.ema_slow)
        df['sma_50'] = ta.sma(df['close'], length=self.sma_period)
        df['sma_200'] = ta.sma(df['close'], length=self.sma_period * 4)  # 4x the base SMA period
        df['adx'] = ta.adx(df['high'], df['low'], df['close'])['ADX_14']
        
        # Momentum indicators with configurable periods
        df['rsi'] = ta.rsi(df['close'], length=self.rsi_period)
        stoch = ta.stoch(df['high'], df['low'], df['close'], k=self.stoch_period, d=3, smooth_k=3)
        df['stoch_k'] = stoch[f'STOCHk_{self.stoch_period}_3_3']
        df['stoch_d'] = stoch[f'STOCHd_{self.stoch_period}_3_3']
        
        macd = ta.macd(df['close'], fast=self.macd_fast, slow=self.macd_slow, signal=self.macd_signal)
        df['macd'] = macd[f'MACD_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        df['macd_signal'] = macd[f'MACDs_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        df['macd_hist'] = macd[f'MACDh_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        
        # Market regime
        df['regime'] = np.where(
            (df['sma_50'] > df['sma_200']) & (df['adx'] > 20),
            'UPTREND',
            np.where(
                (df['sma_50'] < df['sma_200']) & (df['adx'] > 20),
                'DOWNTREND',
                'SIDEWAYS'
            )
        )
        
        return df
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on trend following rules"""
        # Calculate indicators first
        df = self.calculate_indicators(df)
        
        signals = pd.Series(index=df.index, data='HOLD')
        
        for i in range(len(df)):
            if i < 200:  # Skip until we have enough data
                continue
                
            # Check market regime and trend strength
            if df['regime'].iloc[i] == 'DOWNTREND' or df['adx'].iloc[i] < 20:
                signals.iloc[i] = 'HOLD'
                continue
            
            # Entry conditions
            trend_condition = (
                df['ema_fast'].iloc[i] > df['ema_slow'].iloc[i] and
                (df['close'].iloc[i] > df['sma_50'].iloc[i] or df['sma_50'].iloc[i] > df['sma_200'].iloc[i])
            )
            
            momentum_condition = (
                df['rsi'].iloc[i] > 40 and df['rsi'].iloc[i] < 75 and
                (
                    (df['stoch_k'].iloc[i] > df['stoch_d'].iloc[i] and df['stoch_k'].iloc[i] < 80) or
                    (df['macd'].iloc[i] > df['macd_signal'].iloc[i] and df['macd_hist'].iloc[i] > 0)
                )
            )
            
            volume_condition = df['volume'].iloc[i] > df['volume'].iloc[i-20:i].mean()
            
            # Exit conditions
            exit_condition = (
                df['rsi'].iloc[i] > 80 or
                (df['stoch_k'].iloc[i] > 90 and df['stoch_k'].iloc[i] < df['stoch_k'].iloc[i-1]) or
                (
                    df['macd'].iloc[i] < df['macd_signal'].iloc[i] and 
                    df['macd_hist'].iloc[i] < 0 and 
                    df['macd_hist'].iloc[i] < df['macd_hist'].iloc[i-1]
                ) or
                (df['ema_fast'].iloc[i] < df['ema_slow'].iloc[i] and df['close'].iloc[i] < df['sma_50'].iloc[i])
            )
            
            if trend_condition and momentum_condition and volume_condition:
                signals.iloc[i] = 'BUY'
            elif exit_condition:
                signals.iloc[i] = 'SELL'
                
        return signals

class MeanReversionStrategy(BaseStrategy):
    """Mean reversion strategy using Bollinger Bands and RSI"""
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators"""
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            
        # Volatility indicators
        df['atr'] = ta.atr(df['high'], df['low'], df['close'])
        bbands = ta.bbands(df['close'], length=20, std=2)
        df['bbands_upper'] = bbands['BBU_20_2.0']
        df['bbands_middle'] = bbands['BBM_20_2.0']
        df['bbands_lower'] = bbands['BBL_20_2.0']
        df['bbands_width'] = (df['bbands_upper'] - df['bbands_lower']) / df['bbands_middle']
        
        # Momentum and volume
        df['rsi'] = ta.rsi(df['close'], length=14)
        df['obv'] = ta.obv(df['close'], df['volume'])
        df['mfi'] = ta.mfi(df['high'], df['low'], df['close'], df['volume'])
        
        return df
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on mean reversion rules"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        for i in range(len(df)):
            if i < 20:  # Skip until we have enough data
                continue
            
            # Entry conditions for mean reversion
            oversold_condition = (
                df['rsi'].iloc[i] < 30 and
                df['close'].iloc[i] <= df['bbands_lower'].iloc[i] and
                df['mfi'].iloc[i] < 20
            )
            
            # Exit conditions
            overbought_condition = (
                df['rsi'].iloc[i] > 70 or
                df['close'].iloc[i] >= df['bbands_upper'].iloc[i] or
                df['mfi'].iloc[i] > 80
            )
            
            if oversold_condition:
                signals.iloc[i] = 'BUY'
            elif overbought_condition:
                signals.iloc[i] = 'SELL'
                
        return signals

class StrategyFactory:
    """Factory class for creating trading strategies"""
    
    @staticmethod
    def create_strategy(strategy_name: str, **kwargs) -> BaseStrategy:
        """Create a strategy instance based on the strategy name"""
        strategies = {
            'trend_following': TrendFollowingStrategy,
            'mean_reversion': MeanReversionStrategy
        }
        
        if strategy_name not in strategies:
            raise ValueError(f"Unknown strategy: {strategy_name}")
        
        # Remove strategy name from kwargs if present
        kwargs.pop('strategy', None)
        return strategies[strategy_name](**kwargs)

def run_backtest(df: pd.DataFrame, strategy_name: str, **params) -> Tuple[float, Dict, Optional[pd.DataFrame]]:
    """Run a single backtest with given parameters"""
    try:
        # Get and remove initial_balance from params
        initial_balance = params.pop('initial_balance')
        position_size = params['position_size']
        
        # Create strategy instance
        strategy = StrategyFactory.create_strategy(strategy_name, **params)
        
        # Generate signals (this will calculate indicators internally)
        signals = strategy.generate_signals(df)
        
        # Initialize tracking variables
        trades = []
        balance = initial_balance
        position = False
        entry_price = 0
        position_size_units = 0
        
        # Run backtest with optimized loop
        for i in range(len(df)):
            current_price = float(df['close'].iloc[i])
            signal = signals.iloc[i]
            
            if not position and signal == 'BUY':
                position = True
                entry_price = current_price
                position_value = balance * position_size  # Use stored position_size
                position_size_units = position_value / current_price
                
                trades.append({
                    'timestamp': df.index[i],
                    'action': 'BUY',
                    'price': current_price,
                    'size': position_size_units,
                    'balance': balance
                })
                
            elif position:
                # Check exit conditions
                exit_price = None
                exit_reason = None
                
                # Check stop loss
                if current_price <= entry_price * (1 - params['stop_loss']):
                    exit_price = current_price
                    exit_reason = 'Stop Loss'
                # Check take profit
                elif current_price >= entry_price * (1 + params['take_profit']):
                    exit_price = current_price
                    exit_reason = 'Take Profit'
                # Check signal exit
                elif signal == 'SELL':
                    exit_price = current_price
                    exit_reason = 'Signal'
                
                if exit_price is not None:
                    pnl = (exit_price - entry_price) * position_size_units
                    balance += pnl
                    
                    trades.append({
                        'timestamp': df.index[i],
                        'action': 'SELL',
                        'price': exit_price,
                        'size': position_size_units,
                        'balance': balance,
                        'pnl': pnl,
                        'return': (pnl / initial_balance) * 100,
                        'reason': exit_reason
                    })
                    
                    position = False
                    entry_price = 0
                    position_size_units = 0
        
        if trades:
            # Convert trades to DataFrame efficiently
            trades_df = pd.DataFrame(trades)
            trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
            total_return = trades_df['cumulative_return'].iloc[-1]
            
            # Add initial_balance back to params for reporting
            params['initial_balance'] = initial_balance
            return total_return, params, trades_df
            
        return -float('inf'), None, None
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return -float('inf'), None, None

# Move test_params outside optimize_strategy
def test_params(args):
    df, strategy_name, params = args
    return run_backtest(df, strategy_name, **params)

def optimize_strategy(df: pd.DataFrame, strategy_name: str, initial_balance: float = 10000) -> Tuple[Dict, pd.DataFrame]:
    start_time = time.time()
    console.print("[bold cyan]Starting strategy optimization...[/bold cyan]")
    
    try:
        # Reduce parameter combinations
        stop_losses = [0.02, 0.03]          # Reduced to 2 values
        take_profits = [0.04, 0.06]         # Reduced to 2 values
        position_sizes = [0.2, 0.3]         # Reduced to 2 values
        
        # Initialize tracking variables
        best_return = -float('inf')
        best_params = None
        best_trades = None
        
        # Generate parameter combinations
        param_combinations = []
        for sl in stop_losses:
            for tp in take_profits:
                for ps in position_sizes:
                    params = {
                        'stop_loss': sl,
                        'take_profit': tp,
                        'position_size': ps,
                        'initial_balance': initial_balance,
                        'ema_fast': 12,
                        'ema_slow': 26,
                        'sma_period': 50,
                        'rsi_period': 14,
                        'stoch_period': 14,
                        'macd_fast': 12,
                        'macd_slow': 26,
                        'macd_signal': 9
                    }
                    param_combinations.append((df, strategy_name, params))

        # Use number of CPU cores for parallel processing
        num_cores = multiprocessing.cpu_count()
        
        # Run parallel backtests with progress bar
        with Progress(
            TimeElapsedColumn(),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TextColumn("Testing combinations...")
        ) as progress:
            task = progress.add_task("Optimizing...", total=len(param_combinations))
            
            with ProcessPoolExecutor(max_workers=num_cores) as executor:
                for total_return, params, trades_df in executor.map(test_params, param_combinations):
                    progress.update(task, advance=1)
                    
                    if total_return != -float('inf'):  # Only consider valid results
                        if total_return > best_return + 0.5:  # 0.5% minimum improvement
                            best_return = total_return
                            best_params = params
                            best_trades = trades_df
                            console.print(f"\n[green]New best return: {best_return:.2f}%[/green]")

        if best_params:
            elapsed_time = time.time() - start_time
            console.print(f"\n[bold green]Best strategy found in {elapsed_time:.1f} seconds![/bold green]")
            console.print(f"Return: {best_return:.2f}%")
            console.print(f"Parameters: {best_params}")
            
            if best_trades is not None:
                profitable_trades = len(best_trades[best_trades['pnl'] > 0])
                win_rate = (profitable_trades / len(best_trades)) * 100
                console.print(f"\nTotal Trades: {len(best_trades)}")
                console.print(f"Profitable Trades: {profitable_trades}")
                console.print(f"Win Rate: {win_rate:.1f}%")
        else:
            console.print("\n[yellow]No valid strategy found![/yellow]")
        
        return best_params, best_trades
        
    except Exception as e:
        console.print(f"[red]Error in optimization: {str(e)}[/red]")
        return None, None

def verify_data_continuity(df: pd.DataFrame, interval_minutes: int = 15) -> None:
    """Verify data continuity and print any gaps"""
    expected_interval = timedelta(minutes=interval_minutes)
    
    # Get unique dates for summary
    dates = pd.Series(df.index.date).unique()
    console.print(f"\n[cyan]Data Summary:[/cyan]")
    console.print(f"Date range: {dates[0]} to {dates[-1]}")
    console.print(f"Number of trading days: {len(dates)}")
    
    # Check for missing dates
    date_range = pd.date_range(start=dates[0], end=dates[-1], freq='D')
    missing_dates = [d for d in date_range.date if d not in dates]
    if missing_dates:
        console.print(f"\n[yellow]Missing dates:[/yellow]")
        for date in missing_dates:
            console.print(f"No data for {date}")
    
    # Check for gaps within each day
    gaps = []
    for i in range(1, len(df)):
        time_diff = df.index[i] - df.index[i-1]
        if time_diff > expected_interval:
            gap = {
                'start': df.index[i-1],
                'end': df.index[i],
                'duration': time_diff
            }
            gaps.append(gap)
    
    if gaps:
        console.print(f"\n[yellow]Found {len(gaps)} time gaps in data:[/yellow]")
        for gap in gaps:
            console.print(f"Gap from {gap['start']} to {gap['end']} ({gap['duration']})")
    else:
        console.print("\n[green]No time gaps found in data[/green]")
    
    # Print data points per day
    console.print("\n[cyan]Data points per day:[/cyan]")
    daily_counts = df.groupby(df.index.date).size()
    for date, count in daily_counts.items():
        expected_count = 24 * 60 // interval_minutes  # Expected number of 15-min intervals per day
        if count < expected_count:
            console.print(f"[yellow]{date}: {count} points (Expected: {expected_count})[/yellow]")
        else:
            console.print(f"[green]{date}: {count} points[/green]")

def display_trades_analysis(trades_file: str):
    """Display and analyze trades from the CSV file"""
    df = pd.read_csv(trades_file)
    
    # Convert timestamp to datetime
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Format the trades table
    console.print("\n[bold cyan]Trade History:[/bold cyan]")
    
    trades_table = []
    for idx, row in df.iterrows():
        if row['action'] == 'BUY':
            trades_table.append({
                'Entry Time': row['timestamp'].strftime('%Y-%m-%d %H:%M'),
                'Entry Price': f"${row['price']:.2f}",
                'Position Size': f"${row['size'] * row['price']:.2f}",
                'Action': '[green]BUY[/green]'
            })
        else:  # SELL
            trades_table.append({
                'Exit Time': row['timestamp'].strftime('%Y-%m-%d %H:%M'),
                'Exit Price': f"${row['price']:.2f}",
                'PnL': f"${row['pnl']:.2f}",
                'Return': f"{row['return']:.2f}%",
                'Action': '[red]SELL[/red]',
                'Reason': row['reason']
            })
    
    # Create summary statistics
    total_trades = len(df[df['action'] == 'SELL'])
    profitable_trades = len(df[(df['action'] == 'SELL') & (df['pnl'] > 0)])
    losing_trades = len(df[(df['action'] == 'SELL') & (df['pnl'] <= 0)])
    win_rate = (profitable_trades / total_trades * 100) if total_trades > 0 else 0
    
    total_profit = df[df['pnl'] > 0]['pnl'].sum()
    total_loss = df[df['pnl'] < 0]['pnl'].sum()
    net_profit = total_profit + total_loss
    
    profit_factor = abs(total_profit / total_loss) if total_loss != 0 else float('inf')
    
    # Group trades by reason
    exit_reasons = df[df['action'] == 'SELL']['reason'].value_counts()
    
    from rich.table import Table
    
    # Create and display trades table
    table = Table(title="Trade History")
    table.add_column("Date/Time", justify="left")
    table.add_column("Action", justify="center")
    table.add_column("Price", justify="right")
    table.add_column("P/L", justify="right")
    table.add_column("Return", justify="right")
    table.add_column("Exit Reason", justify="left")
    
    for _, row in df.iterrows():
        color = "green" if row['action'] == 'BUY' else "red"
        pnl = f"${row['pnl']:.2f}" if 'pnl' in row and not pd.isna(row['pnl']) else ""
        ret = f"{row['return']:.2f}%" if 'return' in row and not pd.isna(row['return']) else ""
        reason = row['reason'] if 'reason' in row and not pd.isna(row['reason']) else ""
        
        table.add_row(
            row['timestamp'].strftime('%Y-%m-%d %H:%M'),
            f"[{color}]{row['action']}[/{color}]",
            f"${row['price']:.2f}",
            pnl,
            ret,
            reason
        )
    
    console.print(table)
    
    # Display summary statistics
    console.print("\n[bold cyan]Trading Summary:[/bold cyan]")
    console.print(f"Total Trades: {total_trades}")
    console.print(f"Profitable Trades: {profitable_trades}")
    console.print(f"Losing Trades: {losing_trades}")
    console.print(f"Win Rate: {win_rate:.2f}%")
    console.print(f"Total Profit: ${total_profit:.2f}")
    console.print(f"Total Loss: ${total_loss:.2f}")
    console.print(f"Net Profit: ${net_profit:.2f}")
    console.print(f"Profit Factor: {profit_factor:.2f}")
    
    console.print("\n[bold cyan]Exit Reasons:[/bold cyan]")
    for reason, count in exit_reasons.items():
        console.print(f"{reason}: {count} trades")

def create_interactive_plot(df: pd.DataFrame, trades_df: pd.DataFrame, params: dict):
    """Create an interactive plot with candlesticks, indicators, and trades"""
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    
    # Calculate indicators first
    strategy = TrendFollowingStrategy(**params)
    df = strategy.calculate_indicators(df.copy())  # Use copy to avoid modifying original df
    
    # Create figure with secondary y-axis
    fig = make_subplots(
        rows=4, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.05,
        row_heights=[0.5, 0.2, 0.15, 0.15],
        subplot_titles=('Price & Trades', 'Volume & Balance', 'RSI', 'MACD'),
        specs=[[{"secondary_y": True}],  # Price chart with secondary y-axis
               [{"secondary_y": True}],  # Volume with balance
               [{"secondary_y": False}],  # RSI
               [{"secondary_y": False}]]  # MACD
    )

    # Add candlestick
    fig.add_trace(
        go.Candlestick(
            x=df.index,
            open=df['open'],
            high=df['high'],
            low=df['low'],
            close=df['close'],
            name='OHLC'
        ),
        row=1, col=1, secondary_y=False
    )

    # Add EMAs
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['ema_fast'],
            name=f'EMA {params["ema_fast"]}',
            line=dict(color='blue', width=1)
        ),
        row=1, col=1, secondary_y=False
    )
    
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['ema_slow'],
            name=f'EMA {params["ema_slow"]}',
            line=dict(color='orange', width=1)
        ),
        row=1, col=1, secondary_y=False
    )

    # Add buy signals
    buy_trades = trades_df[trades_df['action'] == 'BUY']
    fig.add_trace(
        go.Scatter(
            x=buy_trades['timestamp'],
            y=buy_trades['price'],
            mode='markers',
            name='Buy',
            marker=dict(
                symbol='triangle-up',
                size=12,
                color='green',
                line=dict(width=1, color='darkgreen')
            ),
            text=[
                f'Buy Price: ${price:,.2f}<br>'
                f'Position Size: ${size * price:,.2f}'
                for price, size in zip(buy_trades['price'], buy_trades['size'])
            ],
            hovertemplate='%{text}<extra></extra>'
        ),
        row=1, col=1, secondary_y=False
    )

    # Add sell signals
    sell_trades = trades_df[trades_df['action'] == 'SELL']
    fig.add_trace(
        go.Scatter(
            x=sell_trades['timestamp'],
            y=sell_trades['price'],
            mode='markers',
            name='Sell',
            marker=dict(
                symbol='triangle-down',
                size=12,
                color='red',
                line=dict(width=1, color='darkred')
            ),
            text=[
                f'Sell Price: ${price:,.2f}<br>'
                f'P/L: ${pnl:,.2f} ({ret:.2f}%)<br>'
                f'Reason: {reason}'
                for price, pnl, ret, reason in zip(
                    sell_trades['price'],
                    sell_trades['pnl'],
                    sell_trades['return'],
                    sell_trades['reason']
                )
            ],
            hovertemplate='%{text}<extra></extra>'
        ),
        row=1, col=1, secondary_y=False
    )

    # Add volume
    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df['volume'],
            name='Volume',
            marker_color='lightgray'
        ),
        row=2, col=1, secondary_y=False
    )

    # Add equity curve
    trades_df['cumulative_balance'] = trades_df['balance']
    fig.add_trace(
        go.Scatter(
            x=trades_df['timestamp'],
            y=trades_df['cumulative_balance'],
            name='Account Balance',
            line=dict(color='blue', width=1)
        ),
        row=2, col=1, secondary_y=True
    )

    # Add RSI
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['rsi'],
            name='RSI',
            line=dict(color='purple', width=1)
        ),
        row=3, col=1
    )
    
    # Add RSI levels
    fig.add_hline(y=70, line_dash="dash", line_color="red", row=3, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="green", row=3, col=1)

    # Add MACD
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['macd'],
            name='MACD',
            line=dict(color='blue', width=1)
        ),
        row=4, col=1
    )
    
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['macd_signal'],
            name='Signal',
            line=dict(color='orange', width=1)
        ),
        row=4, col=1
    )
    
    # Add MACD histogram
    colors = ['red' if val < 0 else 'green' for val in df['macd_hist']]
    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df['macd_hist'],
            name='MACD Hist',
            marker_color=colors
        ),
        row=4, col=1
    )

    # Update layout
    fig.update_layout(
        title=f'Backtest Results - {params["stop_loss"]*100}% SL, {params["take_profit"]*100}% TP',
        xaxis_rangeslider_visible=False,
        height=1200,
        showlegend=True,
        legend=dict(
            yanchor="top",
            y=0.99,
            xanchor="left",
            x=0.01
        )
    )

    # Update y-axes titles
    fig.update_yaxes(title_text="Price", row=1, col=1, secondary_y=False)
    fig.update_yaxes(title_text="Volume", row=2, col=1, secondary_y=False)
    fig.update_yaxes(title_text="Balance", row=2, col=1, secondary_y=True)
    fig.update_yaxes(title_text="RSI", row=3, col=1)
    fig.update_yaxes(title_text="MACD", row=4, col=1)

    # Save the plot
    results_dir = Path('backtest_results')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    plot_file = results_dir / f'backtest_plot_{timestamp}.html'
    fig.write_html(str(plot_file))
    console.print(f"\n[green]Interactive plot saved to: {plot_file}[/green]")

def main():
    try:
        parser = argparse.ArgumentParser(description='Cryptocurrency Trading Strategy Backtester')
        parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
        parser.add_argument('--days', type=int, default=60, help='Number of days to backtest')
        parser.add_argument('--strategy', type=str, default='trend_following',
                           choices=['trend_following', 'mean_reversion'],
                           help='Trading strategy to use')
        parser.add_argument('--initial-balance', type=float, default=10000,
                           help='Initial balance for backtesting')
        parser.add_argument('--plot', action='store_true', help='Generate interactive plot')
        args = parser.parse_args()
        
        start_time = time.time()
        
        # Initialize Binance client
        client = Client("", "")
        
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=args.days)
        
        # Fetch and process data
        df = fetch_historical_data(args.symbol, start_date, end_date, client)
        verify_data_continuity(df)
        
        # Run optimization
        best_params, trades = optimize_strategy(df, args.strategy, args.initial_balance)
        
        if best_params and trades is not None:
            # Save results
            results_dir = Path('backtest_results')
            results_dir.mkdir(exist_ok=True)
            
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            results_file = results_dir / f'trades_{args.symbol}_{timestamp}.csv'
            trades.to_csv(results_file)
            console.print(f"\nResults saved to: {results_file}")
            
            # Display detailed trade analysis
            display_trades_analysis(results_file)
            
            # Create plot with best parameters
            if args.plot:
                # Remove initial_balance from params for strategy creation
                plot_params = best_params.copy()
                plot_params.pop('initial_balance')
                create_interactive_plot(df, trades, plot_params)
        
        elapsed_time = time.time() - start_time
        hours = int(elapsed_time // 3600)
        minutes = int((elapsed_time % 3600) // 60)
        seconds = int(elapsed_time % 60)
        console.print(f"\nExecution time: {hours}h:{minutes:02d}m:{seconds:02d}s")
        
    except Exception as e:
        console.print(f"[red]Error in main: {str(e)}[/red]")
        logging.error(f"Error in main: {str(e)}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main()) 
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
from templates import get_comparison_template, get_single_strategy_template

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
    
    def __init__(self, stop_loss: float = 0.02, take_profit: float = 0.04, position_size: float = 0.5,
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
    """Trend following strategy using moving averages, momentum, and patterns"""
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators"""
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            
        # Trend indicators with configurable periods
        df['ema_fast'] = ta.ema(df['close'], length=self.ema_fast)
        df['ema_slow'] = ta.ema(df['close'], length=self.ema_slow)
        df['sma_50'] = ta.sma(df['close'], length=self.sma_period)
        df['sma_200'] = ta.sma(df['close'], length=self.sma_period * 4)
        
        # Calculate ADX
        adx = ta.adx(df['high'], df['low'], df['close'])
        df['adx'] = adx['ADX_14']
        
        # Momentum indicators
        df['rsi'] = ta.rsi(df['close'], length=self.rsi_period)
        stoch = ta.stoch(df['high'], df['low'], df['close'], k=self.stoch_period, d=3)
        df['stoch_k'] = stoch[f'STOCHk_{self.stoch_period}_3_3']
        df['stoch_d'] = stoch[f'STOCHd_{self.stoch_period}_3_3']
        
        macd = ta.macd(df['close'], fast=self.macd_fast, slow=self.macd_slow, signal=self.macd_signal)
        df['macd'] = macd[f'MACD_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        df['macd_signal'] = macd[f'MACDs_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        df['macd_hist'] = macd[f'MACDh_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        
        # Market regime with proper handling of NaN values
        df['regime'] = 'SIDEWAYS'  # Default value
        mask = df['adx'].notna()  # Only calculate where ADX is not NaN
        
        df.loc[mask & (df['sma_50'] > df['sma_200']) & (df['adx'] > 20), 'regime'] = 'UPTREND'
        df.loc[mask & (df['sma_50'] < df['sma_200']) & (df['adx'] > 20), 'regime'] = 'DOWNTREND'
        
        # Add pattern recognition
        df = detect_patterns(df)
        
        return df
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on trend following rules and patterns"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        for i in range(len(df)):
            if i < 200:  # Skip until we have enough data
                continue
            
            # Pattern-based conditions
            pattern = df['pattern'].iloc[i]
            pattern_strength = df['pattern_strength'].iloc[i]
            
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
            
            # Pattern-enhanced entry conditions
            pattern_buy_signal = (
                pattern in ['Double Bottom', 'Bullish Flag'] or
                (pattern == 'Head & Shoulders' and df['regime'].iloc[i] == 'UPTREND')
            )
            
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
            
            # Pattern-enhanced exit conditions
            pattern_sell_signal = (
                pattern in ['Double Top', 'Bearish Flag', 'Head & Shoulders']
            )
            
            # Check if in downtrend or low trend strength
            if df['regime'].iloc[i] == 'DOWNTREND' or (df['adx'].iloc[i] < 20 and df['adx'].iloc[i] == df['adx'].iloc[i]):
                signals.iloc[i] = 'HOLD'
                continue
            
            # Combined signals with pattern recognition
            if (trend_condition and momentum_condition and volume_condition) or pattern_buy_signal:
                signals.iloc[i] = 'BUY'
            elif exit_condition or pattern_sell_signal:
                signals.iloc[i] = 'SELL'
                
        return signals

class MeanReversionStrategy(BaseStrategy):
    """Mean reversion strategy using RSI, Bollinger Bands, and patterns"""
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators for mean reversion"""
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            
        # RSI
        df['rsi'] = ta.rsi(df['close'], length=self.rsi_period)
        
        # Bollinger Bands
        bb = ta.bbands(df['close'], length=20)
        df['bb_upper'] = bb[f'BBU_20_2.0']
        df['bb_middle'] = bb[f'BBM_20_2.0']
        df['bb_lower'] = bb[f'BBL_20_2.0']
        
        # Stochastic
        stoch = ta.stoch(df['high'], df['low'], df['close'], k=self.stoch_period, d=3)
        df['stoch_k'] = stoch[f'STOCHk_{self.stoch_period}_3_3']
        df['stoch_d'] = stoch[f'STOCHd_{self.stoch_period}_3_3']
        
        # ATR for volatility
        df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
        
        # Price distance from moving average
        df['sma_20'] = ta.sma(df['close'], length=20)
        df['price_to_sma'] = (df['close'] - df['sma_20']) / df['sma_20']
        
        # Add MACD for trend confirmation
        macd = ta.macd(df['close'], fast=self.macd_fast, slow=self.macd_slow, signal=self.macd_signal)
        df['macd'] = macd[f'MACD_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        df['macd_signal'] = macd[f'MACDs_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        df['macd_hist'] = macd[f'MACDh_{self.macd_fast}_{self.macd_slow}_{self.macd_signal}']
        
        # Add EMAs for plotting comparison
        df['ema_fast'] = ta.ema(df['close'], length=self.ema_fast)
        df['ema_slow'] = ta.ema(df['close'], length=self.ema_slow)
        
        # Add pattern recognition
        df = detect_patterns(df)
        
        return df
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on mean reversion rules and patterns"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        for i in range(len(df)):
            if i < 20:  # Skip until we have enough data
                continue
            
            # Pattern-based conditions
            pattern = df['pattern'].iloc[i]
            pattern_strength = df['pattern_strength'].iloc[i]
            
            # Entry conditions for oversold
            oversold_condition = (
                df['rsi'].iloc[i] < 30 and  # RSI oversold
                df['close'].iloc[i] <= df['bb_lower'].iloc[i] and  # Price below lower BB
                df['stoch_k'].iloc[i] < 20 and  # Stochastic oversold
                df['price_to_sma'].iloc[i] < -0.02  # Price significantly below MA
            )
            
            # Entry conditions for overbought
            overbought_condition = (
                df['rsi'].iloc[i] > 70 and  # RSI overbought
                df['close'].iloc[i] >= df['bb_upper'].iloc[i] and  # Price above upper BB
                df['stoch_k'].iloc[i] > 80 and  # Stochastic overbought
                df['price_to_sma'].iloc[i] > 0.02  # Price significantly above MA
            )
            
            # Pattern-enhanced conditions
            pattern_buy_signal = (
                pattern in ['Double Bottom'] and
                df['close'].iloc[i] <= df['bb_lower'].iloc[i]
            )
            
            pattern_sell_signal = (
                pattern in ['Double Top'] and
                df['close'].iloc[i] >= df['bb_upper'].iloc[i]
            )
            
            # Volatility filter
            volatility_ok = df['atr'].iloc[i] > df['atr'].iloc[i-20:i].mean() * 0.8
            
            # Exit conditions
            exit_oversold = (
                df['rsi'].iloc[i] > 50 or
                df['close'].iloc[i] > df['bb_middle'].iloc[i] or
                df['stoch_k'].iloc[i] > df['stoch_k'].iloc[i-1]
            )
            
            exit_overbought = (
                df['rsi'].iloc[i] < 50 or
                df['close'].iloc[i] < df['bb_middle'].iloc[i] or
                df['stoch_k'].iloc[i] < df['stoch_k'].iloc[i-1]
            )
            
            # Combined signals with pattern recognition
            if (oversold_condition or pattern_buy_signal) and volatility_ok:
                signals.iloc[i] = 'BUY'
            elif (overbought_condition or pattern_sell_signal) and volatility_ok:
                signals.iloc[i] = 'SELL'
            elif exit_oversold or exit_overbought:
                signals.iloc[i] = 'EXIT'
                
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

def run_backtest(df: pd.DataFrame, strategy_name: str, sl: float, tp: float, ps: float, 
                initial_balance: float) -> Tuple[float, Dict, Optional[pd.DataFrame]]:
    """Run a single backtest with given parameters"""
    try:
        # Create strategy instance with parameters
        strategy_params = {
            'stop_loss': sl,
            'take_profit': tp,
            'position_size': ps,
            'ema_fast': 12,
            'ema_slow': 26,
            'sma_period': 50,
            'rsi_period': 14,
            'stoch_period': 14,
            'macd_fast': 12,
            'macd_slow': 26,
            'macd_signal': 9
        }
        
        strategy = StrategyFactory.create_strategy(strategy_name, **strategy_params)
        
        # Calculate indicators (this will also set the regime)
        df_indicators = strategy.calculate_indicators(df.copy())
        
        # Generate signals
        signals = strategy.generate_signals(df_indicators)
        
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
                position_value = balance * ps
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
                if current_price <= entry_price * (1 - sl):
                    exit_price = current_price
                    exit_reason = 'Stop Loss'
                # Check take profit
                elif current_price >= entry_price * (1 + tp):
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
            trades_df = pd.DataFrame(trades)
            trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
            total_return = trades_df['cumulative_return'].iloc[-1] if len(trades_df) > 0 else 0
            
            # Add initial_balance to params for reporting
            strategy_params['initial_balance'] = initial_balance
            return total_return, strategy_params, trades_df
            
        return 0, None, None
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return 0, None, None

def test_params(args):
    """Helper function to run backtest with parameters"""
    df, strategy_name, sl, tp, ps, initial_balance = args
    return run_backtest(df, strategy_name, sl, tp, ps, initial_balance)

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
                    param_combinations.append((
                        df,
                        strategy_name,
                        sl,    # stop_loss
                        tp,    # take_profit
                        ps,    # position_size
                        initial_balance
                    ))

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
                    
                    if total_return > best_return:  # Changed condition
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

def detect_patterns(df: pd.DataFrame) -> pd.DataFrame:
    """Detect common chart patterns"""
    # Initialize pattern columns
    df['pattern'] = None
    df['pattern_strength'] = 0

    # Calculate required indicators
    df['sma_20'] = ta.sma(df['close'], length=20)
    df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
    
    # Look for patterns in windows
    window = 20  # Look back period for patterns
    
    for i in range(window, len(df)):
        window_data = df.iloc[i-window:i+1]
        
        # Double Top Pattern
        if is_double_top(window_data):
            df.loc[df.index[i], 'pattern'] = 'Double Top'
            df.loc[df.index[i], 'pattern_strength'] = 2
            
        # Double Bottom Pattern
        elif is_double_bottom(window_data):
            df.loc[df.index[i], 'pattern'] = 'Double Bottom'
            df.loc[df.index[i], 'pattern_strength'] = 2
            
        # Head and Shoulders Pattern
        elif is_head_and_shoulders(window_data):
            df.loc[df.index[i], 'pattern'] = 'Head & Shoulders'
            df.loc[df.index[i], 'pattern_strength'] = 3
            
        # Bullish Flag Pattern
        elif is_bullish_flag(window_data):
            df.loc[df.index[i], 'pattern'] = 'Bullish Flag'
            df.loc[df.index[i], 'pattern_strength'] = 1
            
        # Bearish Flag Pattern
        elif is_bearish_flag(window_data):
            df.loc[df.index[i], 'pattern'] = 'Bearish Flag'
            df.loc[df.index[i], 'pattern_strength'] = 1
    
    return df

def is_double_top(data: pd.DataFrame) -> bool:
    """Detect double top pattern"""
    highs = data['high'].values
    threshold = data['atr'].mean() * 0.5
    
    # Find local maxima
    peaks = []
    for i in range(1, len(highs)-1):
        if highs[i] > highs[i-1] and highs[i] > highs[i+1]:
            peaks.append((i, highs[i]))
    
    if len(peaks) >= 2:
        # Check if the two highest peaks are within threshold
        peaks.sort(key=lambda x: x[1], reverse=True)
        peak1, peak2 = peaks[0], peaks[1]
        
        if abs(peak1[1] - peak2[1]) < threshold and abs(peak1[0] - peak2[0]) > 5:
            return True
    
    return False

def is_double_bottom(data: pd.DataFrame) -> bool:
    """Detect double bottom pattern"""
    lows = data['low'].values
    threshold = data['atr'].mean() * 0.5
    
    # Find local minima
    troughs = []
    for i in range(1, len(lows)-1):
        if lows[i] < lows[i-1] and lows[i] < lows[i+1]:
            troughs.append((i, lows[i]))
    
    if len(troughs) >= 2:
        # Check if the two lowest troughs are within threshold
        troughs.sort(key=lambda x: x[1])
        trough1, trough2 = troughs[0], troughs[1]
        
        if abs(trough1[1] - trough2[1]) < threshold and abs(trough1[0] - trough2[0]) > 5:
            return True
    
    return False

def is_head_and_shoulders(data: pd.DataFrame) -> bool:
    """Detect head and shoulders pattern"""
    highs = data['high'].values
    threshold = data['atr'].mean() * 0.5
    
    # Find local maxima
    peaks = []
    for i in range(1, len(highs)-1):
        if highs[i] > highs[i-1] and highs[i] > highs[i+1]:
            peaks.append((i, highs[i]))
    
    if len(peaks) >= 3:
        # Need three peaks with middle one highest
        peaks.sort(key=lambda x: x[0])  # Sort by position
        for i in range(len(peaks)-2):
            p1, p2, p3 = peaks[i:i+3]
            if (p2[1] > p1[1] and p2[1] > p3[1] and  # Middle peak is highest
                abs(p1[1] - p3[1]) < threshold):      # Shoulders at similar levels
                return True
    
    return False

def is_bullish_flag(data: pd.DataFrame) -> bool:
    """Detect bullish flag pattern"""
    # Check for strong uptrend followed by consolidation
    returns = data['close'].pct_change()
    
    # Split data into two parts
    half = len(data) // 2
    first_half = returns[:half]
    second_half = returns[half:]
    
    # Check if first half shows strong uptrend
    if first_half.mean() > 0 and abs(first_half.mean()) > 2 * first_half.std():
        # Check if second half shows consolidation
        if abs(second_half.mean()) < second_half.std():
            return True
    
    return False

def is_bearish_flag(data: pd.DataFrame) -> bool:
    """Detect bearish flag pattern"""
    # Check for strong downtrend followed by consolidation
    returns = data['close'].pct_change()
    
    # Split data into two parts
    half = len(data) // 2
    first_half = returns[:half]
    second_half = returns[half:]
    
    # Check if first half shows strong downtrend
    if first_half.mean() < 0 and abs(first_half.mean()) > 2 * first_half.std():
        # Check if second half shows consolidation
        if abs(second_half.mean()) < second_half.std():
            return True
    
    return False

def create_strategy_plot(df: pd.DataFrame, trades_df: pd.DataFrame, params: dict, strategy_name: str = None):
    """Create an interactive plot for a single strategy"""
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    
    # Calculate indicators based on strategy type
    if strategy_name == 'trend_following':
        strategy = TrendFollowingStrategy(**params)
    else:  # mean_reversion
        strategy = MeanReversionStrategy(**params)
    
    df = strategy.calculate_indicators(df.copy())
    
    # Detect patterns
    df = detect_patterns(df)
    show_trend_indicators = strategy_name == 'trend_following'
    
    # Create figure with secondary y-axis for all subplots that need it
    fig = make_subplots(
        rows=6, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.05,
        row_heights=[0.4, 0.15, 0.15, 0.15, 0.15, 0.15],
        subplot_titles=('Price & Trades', 'Volume', 'Returns & Balance', 'RSI', 'MACD', 'Patterns'),
        specs=[[{"secondary_y": True}],      # Price chart
               [{"secondary_y": False}],      # Volume
               [{"secondary_y": True}],       # Returns & Balance
               [{"secondary_y": False}],      # RSI
               [{"secondary_y": False}],      # MACD
               [{"secondary_y": False}]]      # Patterns
    )

    # Enhanced dark theme colors
    bg_color = '#000000'  # Pure black background
    grid_color = '#1f1f1f'  # Darker grid
    text_color = '#ffffff'  # Pure white text
    
    # Brighter colors for better contrast
    buy_color = '#00FF7F'   # Spring green
    sell_color = '#FF3131'  # Bright red
    volume_color = 'rgba(160, 160, 160, 0.5)'  # Brighter semi-transparent gray
    balance_color = '#00FFFF'  # Cyan
    ema_fast_color = '#FF69B4'  # Hot pink
    ema_slow_color = '#FFD700'  # Gold
                    
                    # Add candlestick
    fig.add_trace(
        go.Candlestick(
            x=df.index,
                                               open=df['open'],
                                               high=df['high'],
                                               low=df['low'],
                                               close=df['close'],
            name='OHLC',
            increasing_line_color='#26A69A',    # Green
            decreasing_line_color='#EF5350'     # Red
        ),
        row=1, col=1, secondary_y=False
    )

    # Add indicators based on strategy type
    if show_trend_indicators:
        # Add EMAs for trend following
        fig.add_trace(
            go.Scatter(
                x=df.index,
                y=df['ema_fast'],
                name=f'EMA {params["ema_fast"]}',
                line=dict(color='#00B4D8', width=1.5)
            ),
            row=1, col=1, secondary_y=False
        )
        
        fig.add_trace(
            go.Scatter(
                x=df.index,
                y=df['ema_slow'],
                name=f'EMA {params["ema_slow"]}',
                line=dict(color='#FFB74D', width=1.5)
            ),
            row=1, col=1, secondary_y=False
        )
    else:
        # Add Bollinger Bands for mean reversion
        fig.add_trace(
            go.Scatter(
                x=df.index,
                y=df['bb_upper'],
                name='BB Upper',
                line=dict(color='#FFB74D', width=1, dash='dash')
            ),
            row=1, col=1, secondary_y=False
        )
        
        fig.add_trace(
            go.Scatter(
                x=df.index,
                y=df['bb_middle'],
                name='BB Middle',
                line=dict(color='#00B4D8', width=1)
            ),
            row=1, col=1, secondary_y=False
        )
        
        fig.add_trace(
            go.Scatter(
                x=df.index,
                y=df['bb_lower'],
                name='BB Lower',
                line=dict(color='#FFB74D', width=1, dash='dash')
            ),
            row=1, col=1, secondary_y=False
        )

    # Add volume
    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df['volume'],
            name='Volume',
            marker_color=volume_color
        ),
        row=2, col=1, secondary_y=False
    )

    # Calculate account metrics
    initial_balance = trades_df['balance'].iloc[0]
    trades_df['returns'] = ((trades_df['balance'] - initial_balance) / initial_balance) * 100
    trades_df['drawdown'] = trades_df['balance'].expanding().max() - trades_df['balance']
    trades_df['drawdown_pct'] = (trades_df['drawdown'] / trades_df['balance'].expanding().max()) * 100
    max_drawdown = trades_df['drawdown_pct'].max()
    
    # Add returns line (primary y-axis)
    fig.add_trace(
        go.Scatter(
            x=trades_df['timestamp'],
            y=trades_df['returns'],
            name='Return %',
            line=dict(color='#69F0AE', width=2),
            fill='tozeroy',
            fillcolor='rgba(105, 240, 174, 0.1)',
            hovertemplate="<br>".join([
                "Time: %{x}",
                "Return: %{y:.2f}%",
                "<extra></extra>"
            ])
        ),
        row=3, col=1, secondary_y=False
    )

    # Add balance line (secondary y-axis)
    fig.add_trace(
        go.Scatter(
            x=trades_df['timestamp'],
            y=trades_df['balance'],
            name='Balance $',
            line=dict(color='#00BCD4', width=2),
            hovertemplate="<br>".join([
                "Time: %{x}",
                "Balance: $%{y:,.2f}",
                "<extra></extra>"
            ])
        ),
        row=3, col=1, secondary_y=True
    )

    # Update y-axes titles
    fig.update_yaxes(title_text="Return %", row=3, col=1, secondary_y=False)
    fig.update_yaxes(title_text="Balance $", row=3, col=1, secondary_y=True)

    # Add performance stats annotation
    stats_text = (
        f"Initial Balance: ${initial_balance:,.2f}<br>"
        f"Current Balance: ${trades_df['balance'].iloc[-1]:,.2f}<br>"
        f"Total Return: {trades_df['returns'].iloc[-1]:.2f}%<br>"
        f"Max Drawdown: {max_drawdown:.2f}%<br>"
        f"Win Rate: {len(trades_df[trades_df['pnl'] > 0]) / len(trades_df) * 100:.1f}%<br>"
        f"Total Trades: {len(trades_df)}<br>"
        f"Stop Loss: {params['stop_loss']*100:.1f}%<br>"
        f"Take Profit: {params['take_profit']*100:.1f}%"
    )

    fig.add_annotation(
        xref="paper",
        yref="paper",
        x=1.02,
        y=0.98,
        text=stats_text,
        showarrow=False,
        font=dict(size=12, color=text_color),
        align="left",
        bgcolor='rgba(0,0,0,0.8)',
        bordercolor=text_color,
        borderwidth=1,
        borderpad=4
    )

    # Update subplot titles and labels
    fig.update_annotations(
        dict(text="Returns & Drawdown %"),
        row=3, col=1
    )

    fig.update_yaxes(
        title_text="Return %",
        row=3, col=1
    )

    # Add RSI
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['rsi'],
            name='RSI',
            line=dict(color='#B388FF', width=1.5)
        ),
        row=4, col=1
    )

    # Add RSI levels
    fig.add_hline(y=70, line_dash="dash", line_color="#FF5252", row=4, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="#69F0AE", row=4, col=1)

    # Add MACD
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['macd'],
            name='MACD',
            line=dict(color='#448AFF', width=1.5)
        ),
        row=5, col=1
    )
    
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=df['macd_signal'],
            name='Signal',
            line=dict(color='#FFD740', width=1.5)
        ),
        row=5, col=1
    )

    # Add MACD histogram
    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df['macd_hist'],
            name='MACD Hist',
            marker_color=['#FF5252' if val < 0 else '#69F0AE' for val in df['macd_hist']]
        ),
        row=5, col=1
    )

    # Add buy/sell markers
    buy_trades = trades_df[trades_df['action'] == 'BUY']
    sell_trades = trades_df[trades_df['action'] == 'SELL']
                    
                    # Add buy markers
    fig.add_trace(
        go.Scatter(
            x=buy_trades['timestamp'],
            y=buy_trades['price'],
                                               mode='markers',
            name='Buy',
            marker=dict(
                symbol='triangle-up',
                size=12,
                color=buy_color,
                line=dict(width=1, color='white')
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
                    
                    # Add sell markers
    fig.add_trace(
        go.Scatter(
            x=sell_trades['timestamp'],
            y=sell_trades['price'],
                                               mode='markers',
            name='Sell',
            marker=dict(
                symbol='triangle-down',
                size=12,
                color=sell_color,
                line=dict(width=1, color='white')
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
                    
                    # Update layout
    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor=bg_color,
        plot_bgcolor=bg_color,
        xaxis_rangeslider_visible=False,
        height=1500,
        showlegend=True,
        legend=dict(
            yanchor="top",
            y=0.99,
            xanchor="left",
            x=0.01,
            font=dict(color=text_color, size=12),
            bgcolor='rgba(0,0,0,0.8)',
            bordercolor=text_color,
            borderwidth=1
        ),
        title=dict(
            text=f'{strategy_name.replace('_', ' ').title()} Strategy - {params["stop_loss"]*100}% SL, {params["take_profit"]*100}% TP',
            font=dict(color=text_color, size=16)
        ),
        margin=dict(t=30, l=50, r=150, b=30)  # Increased right margin for stats
    )

    # Update axes for each subplot
    for i in range(1, 6):
        fig.update_xaxes(
            row=i, col=1,
            gridcolor=grid_color,
            zerolinecolor=grid_color,
            showgrid=True,
            gridwidth=1,
            tickfont=dict(color=text_color),
            title_font=dict(color=text_color)
        )
        
        fig.update_yaxes(
            row=i, col=1,
            gridcolor=grid_color,
            zerolinecolor=grid_color,
            showgrid=True,
            gridwidth=1,
            tickfont=dict(color=text_color),
            title_font=dict(color=text_color)
        )

    # Add range selector for time scale
    fig.update_xaxes(
        rangeslider_visible=False,
        rangeselector=dict(
            buttons=list([
                dict(count=1, label="1h", step="hour", stepmode="backward"),
                dict(count=6, label="6h", step="hour", stepmode="backward"),
                dict(count=1, label="1d", step="day", stepmode="backward"),
                dict(count=3, label="3d", step="day", stepmode="backward"),
                dict(step="all")
            ]),
            font=dict(color=text_color),
            bgcolor='rgba(0,0,0,0.8)',
            activecolor=grid_color
        ),
        row=5, col=1  # Add to bottom subplot
    )

    # Add pattern annotations
    pattern_y = []
    pattern_text = []
    pattern_x = []
    
    for idx, row in df.iterrows():
        if row['pattern'] is not None:
            pattern_x.append(idx)
            pattern_y.append(row['pattern_strength'])
            pattern_text.append(row['pattern'])
    
    if pattern_x:
        fig.add_trace(
            go.Scatter(
                x=pattern_x,
                y=pattern_y,
                mode='markers+text',
                name='Patterns',
                text=pattern_text,
                textposition='top center',
                marker=dict(
                    size=12,
                    symbol='triangle-up',
                    color='yellow'
                ),
                hovertemplate="<br>".join([
                    "Time: %{x}",
                    "Pattern: %{text}",
                    "Strength: %{y}",
                    "<extra></extra>"
                ])
            ),
            row=6, col=1
        )

    # Update layout for pattern subplot
    fig.update_yaxes(title_text="Pattern Strength", row=6, col=1)
    fig.update_xaxes(title_text="Date", row=6, col=1)

    # When called from comparison plot, return the figure
    if strategy_name:
        return fig
        
    # Otherwise save individual plot
    plot_html = fig.to_html(
        include_plotlyjs=True,
        full_html=True,
        config={'displayModeBar': True, 'scrollZoom': True}
    )
    
    final_html = get_single_strategy_template().format(plot_html=plot_html)
    
    results_dir = Path('backtest_results')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    plot_file = results_dir / f'backtest_plot_{timestamp}.html'
    
    with open(plot_file, 'w') as f:
        f.write(final_html)
    
    console.print(f"\n[green]Interactive plot saved to: {plot_file}[/green]")

def create_comparison_plot(df: pd.DataFrame, results: List[Dict], bg_color='#000000', text_color='#ffffff'):
    """Create a combined plot with strategy tabs"""
    
    # Create the plots for each strategy
    figures = {}
    for result in results:
        strategy_name = result['strategy']
        plot_params = result['params'].copy()
        plot_params.pop('initial_balance')
        figures[strategy_name] = create_strategy_plot(df, result['trades'], plot_params, strategy_name)

    # Generate tab buttons and content
    tab_buttons = []
    tab_content = []
    
    for strategy_name, fig in figures.items():
        display_name = strategy_name.replace('_', ' ').title()
        tab_buttons.append(
            f'<button class="tablinks" onclick="openStrategy(event, \'{strategy_name}\')">{display_name}</button>'
        )
        tab_content.append(
            f'<div id="{strategy_name}" class="tabcontent">{fig.to_html(full_html=False, include_plotlyjs=False)}</div>'
        )

    # Get HTML content from template
    html_content = get_comparison_template(
        bg_color=bg_color,
        text_color=text_color,
        tab_buttons_html='\n'.join(tab_buttons),
        tab_content_html='\n'.join(tab_content)
    )

    # Save to file
    results_dir = Path('backtest_results')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    plot_file = results_dir / f'backtest_plot_comparison_{timestamp}.html'
    
    with open(plot_file, 'w') as f:
        f.write(html_content)
    
    console.print(f"\n[green]Interactive comparison plot saved to: {plot_file}[/green]")

# Modify the compare_strategies function to use the new comparison plot
def compare_strategies(df: pd.DataFrame, initial_balance: float = 10000) -> None:
    """Compare different trading strategies on the same data"""
    console.print("\n[bold cyan]Comparing Trading Strategies[/bold cyan]")
    
    strategies = ['trend_following', 'mean_reversion']
    results = []
    
    for strategy_name in strategies:
        console.print(f"\n[bold]Testing {strategy_name.replace('_', ' ').title()} Strategy[/bold]")
        best_params, trades = optimize_strategy(df, strategy_name, initial_balance)
        
        if best_params and trades is not None:
            results.append({
                'strategy': strategy_name,
                'params': best_params,
                'trades': trades,
                'return': trades['pnl'].sum() / initial_balance * 100,
                'win_rate': len(trades[trades['pnl'] > 0]) / len(trades) * 100
            })
    
    # Compare results
    if results:
        console.print("\n[bold cyan]Strategy Comparison:[/bold cyan]")
        for result in results:
            console.print(f"\n[bold]{result['strategy'].replace('_', ' ').title()}[/bold]")
            console.print(f"Total Return: {result['return']:.2f}%")
            console.print(f"Win Rate: {result['win_rate']:.2f}%")
            console.print(f"Total Trades: {len(result['trades'])}")
            
            # Save individual results
            results_dir = Path('backtest_results')
            results_dir.mkdir(exist_ok=True)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            results_file = results_dir / f'trades_{result["strategy"]}_{timestamp}.csv'
            result['trades'].to_csv(results_file)
            console.print(f"Results saved to: {results_file}")
        
        # Create comparison plot
        create_comparison_plot(df, results)

def main():
    try:
        parser = argparse.ArgumentParser(description='Cryptocurrency Trading Strategy Backtester')
        parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
        parser.add_argument('--days', type=int, default=60, help='Number of days to backtest')
        parser.add_argument('--strategy', type=str, default='compare',
                           choices=['trend_following', 'mean_reversion', 'compare'],
                           help='Trading strategy to use or compare all')
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
        
        if args.strategy == 'compare':
            compare_strategies(df, args.initial_balance)
        else:
            # Run single strategy
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
                    plot_params = best_params.copy()
                    plot_params.pop('initial_balance')
                    create_strategy_plot(df, trades, plot_params, args.strategy)
        
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
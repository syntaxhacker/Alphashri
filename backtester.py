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
from rich.progress import Progress, SpinnerColumn, TextColumn
import math

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
    
    all_klines = []
    chunk_size = timedelta(days=7)  # Fetch 7 days at a time to avoid rate limits
    current_start = start_date
    
    # Calculate total chunks needed
    total_days = (end_date - start_date).days
    total_chunks = math.ceil(total_days / 7)
    
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
        
    # Convert to DataFrame
    df = pd.DataFrame(all_klines, columns=[
        'timestamp', 'open', 'high', 'low', 'close', 'volume',
        'close_time', 'quote_asset_volume', 'number_of_trades',
        'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
    ])
    
    # Convert timestamp to datetime
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    df.set_index('timestamp', inplace=True)
    
    # Convert string values to float
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = df[col].astype(float)
    
    # Sort index to ensure chronological order
    df.sort_index(inplace=True)
    
    # Remove any duplicate timestamps
    df = df[~df.index.duplicated(keep='first')]
    
    return df

class BaseStrategy(ABC):
    """Base class for all trading strategies"""
    
    def __init__(self, stop_loss: float = 0.02, take_profit: float = 0.04, position_size: float = 0.2):
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        
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
            
        # Trend indicators
        df['ema_fast'] = ta.ema(df['close'], length=12)
        df['ema_slow'] = ta.ema(df['close'], length=26)
        df['sma_50'] = ta.sma(df['close'], length=50)
        df['sma_200'] = ta.sma(df['close'], length=200)
        df['adx'] = ta.adx(df['high'], df['low'], df['close'])['ADX_14']
        
        # Momentum indicators
        df['rsi'] = ta.rsi(df['close'], length=14)
        stoch = ta.stoch(df['high'], df['low'], df['close'], k=14, d=3, smooth_k=3)
        df['stoch_k'] = stoch['STOCHk_14_3_3']
        df['stoch_d'] = stoch['STOCHd_14_3_3']
        macd = ta.macd(df['close'], fast=12, slow=26, signal=9)
        df['macd'] = macd['MACD_12_26_9']
        df['macd_signal'] = macd['MACDs_12_26_9']
        df['macd_hist'] = macd['MACDh_12_26_9']
        
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

def run_backtest(df: pd.DataFrame, strategy_name: str, sl: float, tp: float, ps: float, 
                initial_balance: float) -> Tuple[float, Dict, Optional[pd.DataFrame]]:
    """Run a single backtest with given parameters"""
    try:
        # Create strategy instance
        strategy = StrategyFactory.create_strategy(
            strategy_name,
            stop_loss=sl,
            take_profit=tp,
            position_size=ps
        )
        
        # Calculate indicators
        df_indicators = df.copy()
        strategy.calculate_indicators(df_indicators)
        
        # Generate signals
        signals = strategy.generate_signals(df_indicators)
        del df_indicators  # Free memory
        
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
            # Convert trades to DataFrame efficiently
            trades_df = pd.DataFrame(trades)
            trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
            total_return = trades_df['cumulative_return'].iloc[-1]
            
            params = {
                'stop_loss': sl,
                'take_profit': tp,
                'position_size': ps
            }
            
            return total_return, params, trades_df
            
        return -float('inf'), None, None
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return -float('inf'), None, None

def optimize_strategy(df: pd.DataFrame, strategy_name: str, initial_balance: float = 10000) -> Tuple[Dict, pd.DataFrame]:
    """Optimize strategy parameters using grid search"""
    console.print("[bold cyan]Starting strategy optimization...[/bold cyan]")
    
    # Define parameter ranges for optimization
    stop_losses = [0.02, 0.03, 0.04]
    take_profits = [0.04, 0.06, 0.08]
    position_sizes = [0.2, 0.3, 0.4]
    
    total_combinations = len(stop_losses) * len(take_profits) * len(position_sizes)
    console.print(f"\nTesting {total_combinations} parameter combinations...")
    
    best_return = -float('inf')
    best_params = None
    best_trades = None
    
    for sl in stop_losses:
        for tp in take_profits:
            for ps in position_sizes:
                total_return, params, trades_df = run_backtest(
                    df, strategy_name, sl, tp, ps, initial_balance
                )
                
                if total_return > best_return:
                    best_return = total_return
                    best_params = params
                    best_trades = trades_df
                    
                console.print(f"SL: {sl:.3f}, TP: {tp:.3f}, PS: {ps:.3f} -> Return: {total_return:.2f}%")
    
    if best_params:
        console.print(f"\n[bold green]Best strategy found![/bold green]")
        console.print(f"Return: {best_return:.2f}%")
        console.print(f"Parameters: {best_params}")
        
        if best_trades is not None:
            profitable_trades = len(best_trades[best_trades['pnl'] > 0])
            win_rate = (profitable_trades / len(best_trades)) * 100
            console.print(f"\nTotal Trades: {len(best_trades)}")
            console.print(f"Profitable Trades: {profitable_trades}")
            console.print(f"Win Rate: {win_rate:.1f}%")
    
    return best_params, best_trades

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

def main():
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
    
    try:
        # Initialize Binance client (using empty strings since we only need public data)
        client = Client("", "")
        
        # Calculate date range for past data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=args.days)
        
        # Round dates to start of day to avoid partial data
        end_date = end_date.replace(hour=0, minute=0, second=0, microsecond=0)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Ensure we're using past dates
        if end_date > datetime.now():
            end_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            start_date = end_date - timedelta(days=args.days)
        
        # Log actual date range
        console.print(f"[cyan]Backtesting from {start_date.strftime('%Y-%m-%d %H:%M')} to {end_date.strftime('%Y-%m-%d %H:%M')}[/cyan]")
        
        # Fetch historical data
        df = fetch_historical_data(args.symbol, start_date, end_date, client)
        
        # Verify data continuity
        verify_data_continuity(df)
        
        # Run optimization to find best parameters
        best_params, trades = optimize_strategy(df, args.strategy, args.initial_balance)
        
        if trades is not None:
            # Save results
            results_dir = Path('backtest_results')
            results_dir.mkdir(exist_ok=True)
            
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            results_file = results_dir / f'trades_{args.symbol}_{timestamp}.csv'
            trades.to_csv(results_file)
            console.print(f"\nResults saved to: {results_file}")
            
            if args.plot:
                try:
                    import plotly.graph_objects as go
                    from plotly.subplots import make_subplots
                    
                    # Create figure with secondary y-axis
                    fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                                      vertical_spacing=0.03, 
                                      row_heights=[0.7, 0.3])
                    
                    # Add candlestick
                    fig.add_trace(go.Candlestick(x=df.index,
                                               open=df['open'],
                                               high=df['high'],
                                               low=df['low'],
                                               close=df['close'],
                                               name='OHLC'),
                                row=1, col=1)
                    
                    # Add trades
                    buy_trades = trades[trades['action'] == 'BUY']
                    sell_trades = trades[trades['action'] == 'SELL']
                    
                    # Add buy markers
                    if not buy_trades.empty:
                        fig.add_trace(go.Scatter(x=buy_trades['timestamp'], y=buy_trades['price'],
                                               mode='markers',
                                               marker=dict(symbol='triangle-up', size=10, color='green'),
                                               name='Buy'),
                                    row=1, col=1)
                    
                    # Add sell markers
                    if not sell_trades.empty:
                        fig.add_trace(go.Scatter(x=sell_trades['timestamp'], y=sell_trades['price'],
                                               mode='markers',
                                               marker=dict(symbol='triangle-down', size=10, color='red'),
                                               name='Sell'),
                                    row=1, col=1)
                    
                    # Add equity curve
                    fig.add_trace(go.Scatter(x=trades['timestamp'], y=trades['balance'],
                                           mode='lines',
                                           name='Account Balance'),
                                row=2, col=1)
                    
                    # Update layout
                    fig.update_layout(
                        title=f'{args.symbol} Backtest Results',
                        yaxis_title='Price',
                        yaxis2_title='Balance',
                        xaxis_rangeslider_visible=False,
                        height=800  # Make the plot taller
                    )
                    
                    # Save plot
                    plot_file = results_dir / f'backtest_plot_{args.symbol}_{timestamp}.html'
                    fig.write_html(str(plot_file))
                    console.print(f"Plot saved to: {plot_file}")
                    
                except ImportError:
                    console.print("[yellow]Plotly not installed. Install with: pip install plotly[/yellow]")
    
    except Exception as e:
        console.print(f"[red]Error: {str(e)}[/red]")
        return

if __name__ == "__main__":
    main() 
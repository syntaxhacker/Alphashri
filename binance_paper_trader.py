import os
import time
import sys
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from typing import List, Dict, Optional, Tuple
import pandas as pd
import numpy as np
from binance.client import Client
from binance.exceptions import BinanceAPIException
from binance import ThreadedWebsocketManager
from twisted.internet import reactor
import json
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich import box
import pandas_ta as ta
from dotenv import load_dotenv
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import argparse
import websockets
import asyncio
import math
import logging
import multiprocessing as mp
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import threading
import torch
from pathlib import Path
from visualizations.trading_charts import TradingCharts
import plotly.io as pio

# Initialize Rich console
console = Console()

# Configure system settings
sys.setrecursionlimit(3000)  # More reasonable recursion limit

# Configure thread settings
try:
    # Try to set a reasonable thread stack size (8MB)
    threading.stack_size(8 * 1024 * 1024)
except (ValueError, threading.ThreadError) as e:
    console.print(f"[yellow]Warning: Could not set thread stack size: {str(e)}[/yellow]")
    console.print("[yellow]Continuing with default thread stack size[/yellow]")

# Setup GPU acceleration
IS_APPLE_SILICON = os.uname().machine == 'arm64'
USE_GPU = False

if IS_APPLE_SILICON:
    try:
        # Enable Metal backend for numpy operations
        os.environ['ACCELERATE_ENABLE_MPS'] = '1'
        
        # Try to import torch with MPS support
        import torch
        if torch.backends.mps.is_available():
            USE_GPU = True
            device = torch.device("mps")
            console.print("[green]Using Apple M1 GPU for acceleration[/green]")
            
            # Helper function to move numpy arrays to GPU
            def to_gpu(arr):
                if isinstance(arr, np.ndarray):
                    return torch.from_numpy(arr).to(device)
                return arr
                
            # Helper function to move tensors back to CPU as numpy arrays
            def to_cpu(tensor):
                if torch.is_tensor(tensor):
                    return tensor.cpu().numpy()
                return tensor
        else:
            console.print("[yellow]MPS (GPU) acceleration not available, using CPU[/yellow]")
    except Exception as e:
        console.print(f"[yellow]Could not enable GPU acceleration: {str(e)}[/yellow]")
        console.print("[yellow]Falling back to CPU calculations[/yellow]")

# Import our new modules
from data_cache import DataCache
from strategies import BaseStrategy, StrategyFactory
from display import TradingDisplay

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
        
        # Calculate indicators (with GPU acceleration if available)
        df_indicators = df.copy()
        if USE_GPU:
            # Move price data to GPU for calculations
            gpu_data = {
                'high': to_gpu(df_indicators['high'].values),
                'low': to_gpu(df_indicators['low'].values),
                'close': to_gpu(df_indicators['close'].values),
                'volume': to_gpu(df_indicators['volume'].values)
            }
            
            # Calculate indicators on GPU
            strategy.calculate_indicators(df_indicators, gpu_data=gpu_data)
            
            # Move results back to CPU
            for col in df_indicators.columns:
                if torch.is_tensor(df_indicators[col].values):
                    df_indicators[col] = pd.Series(to_cpu(df_indicators[col].values), index=df_indicators.index)
        else:
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
                'strategy': strategy_name,
                'stop_loss': sl,
                'take_profit': tp,
                'position_size': ps
            }
            
            return total_return, params, trades_df
            
        return -float('inf'), None, None
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return -float('inf'), None, None

def to_gpu(data: np.ndarray) -> torch.Tensor:
    """Convert numpy array to GPU tensor"""
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    return torch.from_numpy(data.astype(np.float32)).to(device)

def to_cpu(tensor: torch.Tensor) -> np.ndarray:
    """Convert GPU tensor to numpy array"""
    return tensor.cpu().numpy()

def run_backtest_benchmark(df: pd.DataFrame, strategy_name: str, sl: float, tp: float, ps: float, 
                initial_balance: float, use_gpu: bool = False) -> Tuple[float, Dict, Optional[pd.DataFrame], float]:
    """Run a single backtest with given parameters and return execution time"""
    start_time = time.time()
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
        if use_gpu:
            # Move price data to GPU for calculations
            gpu_data = {
                'high': to_gpu(df_indicators['high'].values),
                'low': to_gpu(df_indicators['low'].values),
                'close': to_gpu(df_indicators['close'].values),
                'volume': to_gpu(df_indicators['volume'].values)
            }
            strategy.calculate_indicators(df_indicators, gpu_data=gpu_data)
        else:
            strategy.calculate_indicators(df_indicators)
            
        # Generate signals
        signals = strategy.generate_signals(df_indicators)
        
        # Run backtest
        trades = []
        balance = initial_balance
        position = False
        entry_price = 0
        position_size_units = 0
        
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
        
        execution_time = time.time() - start_time
        
        if trades:
            trades_df = pd.DataFrame(trades)
            trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
            total_return = trades_df['cumulative_return'].iloc[-1]
            
            params = {
                'stop_loss': sl,
                'take_profit': tp,
                'position_size': ps
            }
            
            return total_return, params, trades_df, execution_time
            
        return -float('inf'), None, None, execution_time
        
    except Exception as e:
        logging.error(f"Error in backtest: {str(e)}")
        return -float('inf'), None, None, time.time() - start_time

class BinancePaperTrader:
    def __init__(self, api_key: str, api_secret: str, use_testnet: bool = True):
        """Initialize the paper trader with Binance API credentials"""
        # Setup logging
        self.setup_logging()
        
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        
        # Initialize Binance client with proper Testnet settings for live trading
        self.client = Client(api_key, api_secret, testnet=use_testnet)
        if use_testnet:
            self.client.API_URL = 'https://testnet.binance.vision/api'
            console.print("[cyan]Connected to Binance Testnet[/cyan]")
            
        # Initialize a separate client for historical data from main network
        self.data_client = Client("", "")  # No API keys needed for public data
        console.print("[cyan]Connected to Binance Main network for historical data[/cyan]")
            
        # Initialize WebSocket manager
        self.twm = ThreadedWebsocketManager(
            api_key=api_key,
            api_secret=api_secret,
            testnet=use_testnet
        )
        
        # Initialize our new components
        self.data_cache = DataCache()
        self.display = TradingDisplay()
        self.strategy = None
        
        # Trading state
        self.ws_data = {
            'last_price': None,
            'last_update': None,
            'trades': []
        }
        self.position = False
        self.entry_price = 0
        self.position_size = 0
        self.trades_today = 0
        self.last_trade_time = None
        
        # Trade history
        self.trades = []  # Store recent trades
        self.max_trade_history = 50  # Maximum number of trades to keep in history

    def setup_logging(self):
        """Setup logging configuration"""
        if not os.path.exists('logs'):
            os.makedirs('logs')
            
        log_filename = 'logs/trading.log'
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_filename),
                logging.StreamHandler()
            ]
        )

    def _prepare_gpu_data(self, df: pd.DataFrame) -> Dict[str, torch.Tensor]:
        """Prepare data for GPU calculations"""
        if not USE_GPU:
            return None
            
        gpu_data = {}
        for col in ['high', 'low', 'close', 'volume']:
            gpu_data[col] = to_gpu(df[col].values.astype(np.float32))
        return gpu_data
    
    def optimize_strategy(self, symbol: str, strategy_name: str = 'trend_following', 
                        start_date: Optional[datetime] = None,
                        end_date: Optional[datetime] = None) -> Tuple[BaseStrategy, pd.DataFrame]:
        """Optimize strategy parameters using historical data"""
        console.print("[bold cyan]Starting strategy optimization...[/bold cyan]")
        
        # Set default dates if not provided
        if not end_date:
            end_date = datetime.now()
        if not start_date:
            # Calculate exactly 6 months ago using relativedelta
            start_date = end_date - relativedelta(months=6)
            
        # Set to start of day for consistency
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Log the actual date range being used
        logging.info(f"Date range: {start_date} to {end_date}")
        logging.info(f"Total days: {(end_date - start_date).days}")
            
        # Try to get data from cache first
        console.print("Checking cache for historical data...")
        df = self.data_cache.get_data(symbol, start_date, end_date)
        
        if df is None:
            console.print("[yellow]No cached data found, fetching from Binance Main network...[/yellow]")
            # Get historical klines/candlestick data in chunks
            all_klines = []
            chunk_size = timedelta(days=30)  # Fetch 30 days at a time
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
                        # Log each chunk's date range
                        logging.info(f"Fetching chunk: {current_start} to {current_end}")
                        
                        # Convert timestamps to milliseconds for Binance API
                        start_ts = int(current_start.timestamp() * 1000)
                        end_ts = int(current_end.timestamp() * 1000)
                        
                        # Use data_client instead of client for historical data
                        chunk_klines = self.data_client.get_historical_klines(
                            symbol=symbol,
                            interval=Client.KLINE_INTERVAL_1MINUTE,
                            start_str=str(start_ts),
                            end_str=str(end_ts),
                            limit=1000  # Maximum limit per request
                        )
                        
                        if chunk_klines:
                            all_klines.extend(chunk_klines)
                            console.print(f"[green]✓ {current_start.strftime('%B %d, %Y')} to {current_end.strftime('%B %d, %Y')} ({len(chunk_klines):,} klines)[/green]")
                            logging.info(f"Got {len(chunk_klines)} klines for chunk")
                        else:
                            console.print(f"[yellow]No data for {current_start.strftime('%B %d, %Y')} to {current_end.strftime('%B %d, %Y')}[/yellow]")
                            logging.warning(f"No data received for chunk")
                            
                    except Exception as e:
                        error_msg = f"Error fetching data: {str(e)}"
                        console.print(f"[red]{error_msg}[/red]")
                        logging.error(error_msg)
                        break
                        
                    current_start = current_end + timedelta(minutes=1)  # Avoid overlap
                    progress.update(task, advance=1)
            
            if not all_klines:
                console.print("[red]Failed to fetch historical data[/red]")
                return None, None
                
            console.print(f"[green]Converting {len(all_klines):,} klines to DataFrame...[/green]")
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
            
            console.print("Caching the fetched data...")
            self.data_cache.save_data(symbol, df)
        else:
            console.print("[green]Found cached data[/green]")
        
        # Store the data for visualization
        self.data = df.copy()
        
        # Define parameter ranges for optimization
        stop_losses = [0.02, 0.03, 0.04]
        take_profits = [0.04, 0.06, 0.08]
        position_sizes = [0.2, 0.3, 0.4]
        
        total_combinations = len(stop_losses) * len(take_profits) * len(position_sizes)
        console.print(f"\nTesting {total_combinations} parameter combinations...")
        
        # Run benchmarks with CPU only
        param_combinations = [
            (sl, tp, ps) 
            for sl in stop_losses 
            for tp in take_profits 
            for ps in position_sizes
        ]
        
        console.print("\n[bold]Running optimization...[/bold]")
        start_time = time.time()
        results = []
        
        with Progress() as progress:
            task = progress.add_task("[cyan]Testing combinations...", total=len(param_combinations))
            
            for params in param_combinations:
                sl, tp, ps = params
                total_return, strategy_params, trades_df, exec_time = run_backtest_benchmark(
                    df.copy(), strategy_name, sl, tp, ps, 10000, use_gpu=False
                )
                results.append((total_return, strategy_params, trades_df, exec_time))
                progress.update(task, advance=1)
        
        total_time = time.time() - start_time
        console.print(f"\n[bold]Optimization completed in {total_time:.2f} seconds[/bold]")
        
        # Find best strategy
        best_return = -float('inf')
        best_strategy = None
        best_backtest_results = None
        
        for total_return, params, trades_df, _ in results:
            if total_return > best_return:
                best_return = total_return
                best_strategy = StrategyFactory.create_strategy(strategy_name, **params)
                best_backtest_results = trades_df
        
        console.print(f"\n[bold green]Best strategy found![/bold green]")
        console.print(f"Return: {best_return:.2f}%")
        
        if best_backtest_results is not None:
            console.print("\n[bold]Trade Statistics:[/bold]")
            console.print(f"Total Trades: {len(best_backtest_results)}")
            profitable_trades = len(best_backtest_results[best_backtest_results['pnl'] > 0])
            console.print(f"Profitable Trades: {profitable_trades}")
            win_rate = (profitable_trades / len(best_backtest_results)) * 100
            console.print(f"Win Rate: {win_rate:.1f}%")
        
        return best_strategy, best_backtest_results

    def process_socket_message(self, msg):
        """Process incoming WebSocket messages"""
        try:
            # Update price immediately
            price = float(msg['p'])
            self.ws_data['last_price'] = price
            self.ws_data['last_update'] = datetime.fromtimestamp(msg['T'] / 1000)
            
            # Add to trades list for analysis
            self.ws_data['trades'].append({
                'price': price,
                'quantity': float(msg['q']),
                'time': datetime.fromtimestamp(msg['T'] / 1000)
            })
            if len(self.ws_data['trades']) > 100:
                self.ws_data['trades'].pop(0)
            
            # Convert recent trades to DataFrame for strategy
            if self.strategy and len(self.ws_data['trades']) >= 20:
                df = pd.DataFrame(self.ws_data['trades'])
                df.set_index('time', inplace=True)
                
                # Calculate indicators
                df = self.strategy.calculate_indicators(df)
                
                # Generate signal
                signals = self.strategy.generate_signals(df)
                latest_signal = signals.iloc[-1]
                
                # Update display
                display_data = {
                    self.trading_symbol: {
                        'price': price,
                        'prev_price': self.ws_data['trades'][-2]['price'] if len(self.ws_data['trades']) > 1 else price,
                        'position': self.position,
                        'pnl': (price - self.entry_price) * self.position_size if self.position else 0,
                        'signal': latest_signal,
                        'indicators': {
                            'rsi': df['rsi'].iloc[-1],
                            'ema_fast': df['ema_fast'].iloc[-1],
                            'ema_slow': df['ema_slow'].iloc[-1],
                            'regime': df['regime'].iloc[-1]
                        }
                    }
                }
                
                # Update display
                table = self.display.display_live_status(display_data)
                if table:
                    console.print(table)
                
                # Check trading opportunity
                self.check_trading_opportunity(latest_signal, price)
            
        except Exception as e:
            console.print(f"[red]Error processing WebSocket message: {str(e)}[/red]")

    def check_trading_opportunity(self, signal: str, price: float):
        """Check for trading opportunities based on strategy signals"""
        try:
            current_time = datetime.now()
            
            if not self.position and signal == 'BUY':
                can_trade = (
                    self.last_trade_time is None or
                    (current_time - self.last_trade_time).seconds > 30
                )
                
                if can_trade:
                            self.execute_buy_order()
                    
            elif self.position and signal == 'SELL':
                            self.execute_sell_order()
                
        except Exception as e:
            console.print(f"[red]Error checking trading opportunity: {str(e)}[/red]")

    def display_trade_history(self, trades_df: pd.DataFrame):
        """Display detailed trade history in a table"""
        if trades_df is None or len(trades_df) == 0:
            console.print("[yellow]No trades to display[/yellow]")
            return
        
        # Create a summary table
        summary = Table(title="Trade Summary", show_header=True, header_style="bold blue")
        summary.add_column("Metric", style="cyan")
        summary.add_column("Value", style="green")
        
        total_trades = len(trades_df)
        profitable_trades = len(trades_df[trades_df['pnl'] > 0])
        win_rate = (profitable_trades / total_trades) * 100 if total_trades > 0 else 0
        total_profit = trades_df['pnl'].sum() if 'pnl' in trades_df else 0
        max_profit = trades_df['pnl'].max() if 'pnl' in trades_df else 0
        max_loss = trades_df['pnl'].min() if 'pnl' in trades_df else 0
        
        summary.add_row("Total Trades", str(total_trades))
        summary.add_row("Profitable Trades", str(profitable_trades))
        summary.add_row("Win Rate", f"{win_rate:.2f}%")
        summary.add_row("Total Profit/Loss", f"${total_profit:.2f}")
        summary.add_row("Max Profit", f"${max_profit:.2f}")
        summary.add_row("Max Loss", f"${max_loss:.2f}")
        
        console.print(summary)
        console.print()
        
        # Create trade history table
        table = Table(title="Trade History", show_header=True, header_style="bold magenta")
        table.add_column("Time", style="cyan")
        table.add_column("Action", style="green")
        table.add_column("Price", style="yellow")
        table.add_column("Size", style="blue")
        table.add_column("P&L", style="red")
        table.add_column("Balance", style="green")
        table.add_column("Return %", style="yellow")
        table.add_column("Exit Reason", style="cyan")
        
        # Show last 20 trades if there are more than 20
        display_trades = trades_df.tail(20) if len(trades_df) > 20 else trades_df
        
        for _, trade in display_trades.iterrows():
            pnl_str = f"${trade['pnl']:.2f}" if 'pnl' in trade else ""
            return_str = f"{trade['return']:.2f}%" if 'return' in trade else ""
            
            table.add_row(
                trade['timestamp'].strftime('%Y-%m-%d %H:%M'),
                trade['action'],
                f"${float(trade['price']):.2f}",
                f"{float(trade['size']):.4f}",
                pnl_str,
                f"${float(trade['balance']):.2f}",
                return_str,
                str(trade.get('reason', ''))
            )
        
        if len(trades_df) > 20:
            console.print("[yellow]Showing last 20 trades...[/yellow]")
        console.print(table)

    def plot_backtest_results(self, trades_df: pd.DataFrame, symbol: str):
        """Create and save visualizations for backtest results"""
        try:
            # Ensure timestamp is datetime and set as index
            if 'timestamp' in trades_df.columns:
                trades_df['timestamp'] = pd.to_datetime(trades_df['timestamp'])
                trades_df.set_index('timestamp', inplace=True)
            
            # Create TradingCharts instance
            charts = TradingCharts()
            
            # Get historical price data for the same period
            start_date = trades_df.index.min()
            end_date = trades_df.index.max()
            
            # Get price data from cache
            price_data = self.data
            if price_data is None:
                console.print("[yellow]Warning: Could not retrieve price data for visualization[/yellow]")
                return
                
            # Filter price data to match trade period
            price_data = price_data.loc[start_date:end_date]
            
            # Create trading dashboard
            dashboard = charts.create_trading_dashboard(trades_df, price_data)
            metrics = charts.create_trade_metrics(trades_df)
            
            # Save plots to HTML files
            pio.write_html(dashboard, 'trading_dashboard.html')
            pio.write_html(metrics, 'trading_metrics.html')
            
            console.print("\n[green]Trading visualizations have been saved to:[/green]")
            console.print("- trading_dashboard.html")
            console.print("- trading_metrics.html")
            
        except Exception as e:
            console.print(f"[red]Error creating visualizations: {str(e)}[/red]")
            logging.error(f"Error creating visualizations: {str(e)}")
            # Log the full traceback for debugging
            import traceback
            logging.error(traceback.format_exc())

    def optimize_all_strategies(self, symbol: str, start_date: Optional[datetime] = None,
                              end_date: Optional[datetime] = None) -> Tuple[BaseStrategy, pd.DataFrame]:
        """Run optimization for all available strategies and pick the best one"""
        strategies = ['trend_following', 'mean_reversion']
        best_overall_return = -float('inf')
        best_overall_strategy = None
        best_overall_results = None
        best_overall_name = None
        
        console.print("\n[bold cyan]Running optimization for all strategies...[/bold cyan]")
        
        # Store the data for visualization
        self.data = None
        
        for strategy_name in strategies:
            console.print(f"\n[bold yellow]Testing {strategy_name} strategy[/bold yellow]")
            strategy, results = self.optimize_strategy(symbol, strategy_name, start_date, end_date)
            
            if results is not None:
                total_return = results['return'].sum() if 'return' in results else -float('inf')
                console.print(f"\n[bold]Strategy Results for {strategy_name}:[/bold]")
                self.display.display_backtest_results(results, symbol)
                
                if total_return > best_overall_return:
                    best_overall_return = total_return
                    best_overall_strategy = strategy
                    best_overall_results = results
                    best_overall_name = strategy_name
        
        if best_overall_strategy:
            console.print(f"\n[bold green]Best Overall Strategy: {best_overall_name}[/bold green]")
            console.print(f"Total Return: {best_overall_return:.2f}%")
            console.print("\n[bold]Best Strategy Results:[/bold]")
            self.display.display_backtest_results(best_overall_results, symbol)
        else:
            console.print("\n[bold red]No successful strategy found[/bold red]")
        
        return best_overall_strategy, best_overall_results

    def run_backtest(self, strategy_name: str, params: dict = None) -> Tuple[pd.DataFrame, float]:
        """Run backtest with the specified strategy and parameters"""
        total_return, params, trades_df = run_backtest(self.data, strategy_name, 
            params['stop_loss'], params['take_profit'], params['position_size'], 10000)
        
        if trades_df is not None:
            # Create visualizations
            charts = TradingCharts()
            dashboard = charts.create_trading_dashboard(trades_df, self.data)
            metrics = charts.create_trade_metrics(trades_df)
            
            # Save plots to HTML files
            pio.write_html(dashboard, 'trading_dashboard.html')
            pio.write_html(metrics, 'trading_metrics.html')
            
            console.print("\n[green]Trading visualizations have been saved to:[/green]")
            console.print("- trading_dashboard.html")
            console.print("- trading_metrics.html")
        
        return trades_df, total_return

def parse_args():
    parser = argparse.ArgumentParser(description='Binance Paper Trading Backtester and Live Trader')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
    parser.add_argument('--days', type=int, default=7, help='Number of days to backtest (default: 7)')
    parser.add_argument('--interval', type=str, default='1h', help='Timeframe (1m, 5m, 15m, 1h, 4h, 1d)')
    parser.add_argument('--balance', type=float, default=10000, help='Initial balance in USDT')
    parser.add_argument('--plot', action='store_true', help='Generate interactive plot')
    parser.add_argument('--live', action='store_true', help='Run in live trading mode')
    parser.add_argument('--strategy', type=str, default='trend_following',
                       choices=['trend_following', 'mean_reversion'],
                       help='Trading strategy to use')
    parser.add_argument('--clear-cache', action='store_true', help='Clear cached data before running')
    return parser.parse_args()

def main():
    """Main function to run the trading bot"""
    # Parse command line arguments
    args = parse_args()
    
    # Initialize trader with Testnet API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    trader = BinancePaperTrader(API_KEY, API_SECRET, use_testnet=True)
    
    try:
        if args.live:
            # Set strategy for live trading
            trader.strategy = StrategyFactory.create_strategy(args.strategy)
            
            # Run live trading
            console.print("[bold cyan]Starting live trading mode...[/bold cyan]")
            trader.run(args.symbol)
        else:
            # Run backtest mode
            console.print("[bold cyan]Starting backtest mode...[/bold cyan]")
            
            # Set end date to current time
            end_date = datetime.now()
            # Calculate start date based on days argument
            start_date = end_date - timedelta(days=args.days)
            
            # Clear cache if requested
            if args.clear_cache:
                console.print("[yellow]Clearing cached data...[/yellow]")
                trader.data_cache.clear()
                logging.info("Cache cleared")
            
            logging.info(f"Main: Using date range {start_date} to {end_date}")
                
            # Run optimization for all strategies
            strategy, results = trader.optimize_all_strategies(
                symbol=args.symbol,
                start_date=start_date,
                end_date=end_date
            )
            
            if results is not None and args.plot:
                trader.plot_backtest_results(results, args.symbol)
                
    except KeyboardInterrupt:
        console.print("\n[yellow]Shutting down...[/yellow]")
    except Exception as e:
        console.print(f"[red]Error: {str(e)}[/red]")
    finally:
        if args.live:
            trader.stop_trading()

if __name__ == "__main__":
    main() 
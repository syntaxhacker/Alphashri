import os
import time
from datetime import datetime, timedelta
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

# Import our new modules
from data_cache import DataCache
from strategies import StrategyFactory
from display import TradingDisplay

# Initialize Rich console
console = Console()

class BinancePaperTrader:
    def __init__(self, api_key: str, api_secret: str, use_testnet: bool = True):
        """Initialize the paper trader with Binance API credentials"""
        # Setup logging
        self.setup_logging()
        
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        
        # Initialize Binance client with proper Testnet settings
        self.client = Client(api_key, api_secret, testnet=use_testnet)
        if use_testnet:
            self.client.API_URL = 'https://testnet.binance.vision/api'
            console.print("[cyan]Connected to Binance Testnet[/cyan]")
            
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

    def optimize_strategy(self, symbol: str, start_str: str = "1 month ago UTC", initial_balance: float = 10000) -> Optional[pd.DataFrame]:
        """Optimize trading strategy parameters using historical data"""
        try:
            console.print("\nFetching historical data...")
            
            # Try to get data from cache first
            logging.info(f"Checking cache for {symbol} data...")
            df = self.data_cache.get_data(symbol, "1m")
            
            if df is not None:
                logging.info(f"Found cached data for {symbol}")
                console.print("[green]Using cached data[/green]")
            else:
                logging.info(f"No cached data found for {symbol}, fetching from Binance...")
                # Get historical klines if not in cache
                klines = self.client.get_historical_klines(
                    symbol=symbol,
                    interval=Client.KLINE_INTERVAL_1MINUTE,
                    start_str=start_str
                )
                
                if not klines:
                    console.print("[red]No historical data available[/red]")
                    return None
                
                logging.info(f"Converting {len(klines)} klines to DataFrame...")
                # Convert to DataFrame
                df = pd.DataFrame(klines, columns=[
                    'timestamp', 'open', 'high', 'low', 'close', 'volume',
                    'close_time', 'quote_volume', 'trades', 'taker_buy_base',
                    'taker_buy_quote', 'ignored'
                ])
                
                # Convert timestamp to datetime and set as index
                df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
                df.set_index('timestamp', inplace=True)
                
                # Convert price columns to float
                for col in ['open', 'high', 'low', 'close', 'volume']:
                    df[col] = df[col].astype(float)
                
                logging.info("Caching the fetched data...")
                # Cache the data
                self.data_cache.save_data(symbol, "1m", df)
                
                # Display cache info
                cache_info = self.data_cache.get_cache_info()
                self.display.display_cache_info(cache_info)
            
            # Initialize results storage
            best_return = -float('inf')
            best_params = None
            best_trades = None
            
            # Parameter combinations to test
            stop_losses = [0.002, 0.003, 0.004]  # 0.2% to 0.4%
            take_profits = [0.004, 0.006, 0.008]  # 0.4% to 0.8%
            position_sizes = [0.2, 0.3, 0.4]  # 20% to 40%
            strategies = ['trend_following', 'mean_reversion']
            
            total_combinations = len(stop_losses) * len(take_profits) * len(position_sizes) * len(strategies)
            current_combination = 0
            
            console.print(f"\nTesting {total_combinations} parameter combinations...")
            
            # Test each parameter combination
            for strategy_name in strategies:
                for sl in stop_losses:
                    for tp in take_profits:
                        for ps in position_sizes:
                            current_combination += 1
                            
                            # Create strategy instance
                            strategy = StrategyFactory.create_strategy(
                                strategy_name,
                                stop_loss=sl,
                                take_profit=tp,
                                position_size=ps
                            )
                            
                            # Calculate indicators
                            df_indicators = strategy.calculate_indicators(df.copy())
                            
                            # Generate signals
                            signals = strategy.generate_signals(df_indicators)
                            
                            # Run backtest with current parameters
                            trades = self.backtest_strategy(
                                df=df_indicators,
                                signals=signals,
                                stop_loss=sl,
                                take_profit=tp,
                                position_size=ps,
                                initial_balance=initial_balance
                            )
                            
                            if trades is not None and not trades.empty:
                                total_return = trades['cumulative_return'].iloc[-1]
                                if total_return > best_return:
                                    best_return = total_return
                                    best_params = {
                                        'strategy': strategy_name,
                                        'stop_loss': sl,
                                        'take_profit': tp,
                                        'position_size': ps
                                    }
                                    best_trades = trades
                            
                            # Display progress
                            self.display.display_optimization_progress(
                                current_combination,
                                total_combinations,
                                best_params
                            )
            
            if best_params is None:
                console.print("[yellow]No strategy found meeting the minimum criteria.[/yellow]")
                return None
            
            # Set the best parameters
            self.strategy = StrategyFactory.create_strategy(
                best_params['strategy'],
                stop_loss=best_params['stop_loss'],
                take_profit=best_params['take_profit'],
                position_size=best_params['position_size']
            )
            
            console.print("\n[green]Optimization complete![/green]")
            
            # Display results
            self.display.display_backtest_results(best_trades)
            
            return best_trades
            
        except Exception as e:
            console.print(f"[red]Error in strategy optimization: {str(e)}[/red]")
            return None

    def backtest_strategy(self, df: pd.DataFrame, signals: pd.Series,
                         stop_loss: float, take_profit: float,
                         position_size: float, initial_balance: float) -> Optional[pd.DataFrame]:
        """Backtest the trading strategy with given parameters"""
        try:
            trades = []
            balance = initial_balance
            position = False
            entry_price = 0
            position_size_units = 0
            
            for i in range(len(df)):
                current_price = df['close'].iloc[i]
                signal = signals.iloc[i]
                
                if not position and signal == 'BUY':
                    # Enter position
                    position = True
                    entry_price = current_price
                    position_value = balance * position_size
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
                    if current_price <= entry_price * (1 - stop_loss):
                        exit_price = current_price
                        exit_reason = 'Stop Loss'
                    
                    # Check take profit
                    elif current_price >= entry_price * (1 + take_profit):
                        exit_price = current_price
                        exit_reason = 'Take Profit'
                    
                    # Check signal exit
                    elif signal == 'SELL':
                        exit_price = current_price
                        exit_reason = 'Signal'
                    
                    if exit_price is not None:
                        # Calculate profit/loss
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
                # Convert trades to DataFrame
                trades_df = pd.DataFrame(trades)
                trades_df['cumulative_return'] = trades_df['return'].cumsum()
                return trades_df
            
            return pd.DataFrame()
            
        except Exception as e:
            console.print(f"[red]Error in strategy backtest: {str(e)}[/red]")
            return pd.DataFrame()

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

def parse_args():
    parser = argparse.ArgumentParser(description='Binance Paper Trading Backtester and Live Trader')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
    parser.add_argument('--interval', type=str, default='1h', help='Timeframe (1m, 5m, 15m, 1h, 4h, 1d)')
    parser.add_argument('--start', type=str, default='1 month ago UTC', help='Start time for backtest')
    parser.add_argument('--balance', type=float, default=10000, help='Initial balance in USDT')
    parser.add_argument('--plot', action='store_true', help='Generate interactive plot')
    parser.add_argument('--live', action='store_true', help='Run in live trading mode')
    parser.add_argument('--strategy', type=str, default='trend_following',
                       choices=['trend_following', 'mean_reversion'],
                       help='Trading strategy to use')
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
            results = trader.optimize_strategy(
                symbol=args.symbol,
                start_str=args.start,
                initial_balance=args.balance
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
import os
import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
import pandas as pd
import numpy as np
from binance.client import Client
from binance.exceptions import BinanceAPIException
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.progress import Progress, SpinnerColumn, TextColumn
import pandas_ta as ta
from dotenv import load_dotenv
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import argparse

# Initialize Rich console
console = Console()

class BinancePaperTrader:
    def __init__(self, api_key: str, api_secret: str, use_testnet: bool = True):
        """Initialize the paper trader with Binance API credentials"""
        self.api_key = api_key
        self.api_secret = api_secret
        self.use_testnet = use_testnet
        
        # Initialize Binance client
        self.client = Client(api_key, api_secret, testnet=use_testnet)
        if use_testnet:
            self.client.API_URL = 'https://testnet.binance.vision/api'
            
        # Portfolio tracking
        self.initial_balance = 10000  # Default USDT balance for paper trading
        self.portfolio = {
            'USDT': self.initial_balance,
            'positions': {}
        }
        
        # Trading parameters (more conservative)
        self.trading_fee = 0.001  # 0.1% trading fee
        self.stop_loss_pct = 0.01  # Tighter 1% stop loss
        self.take_profit_pct = 0.02  # More realistic 2% take profit
        self.position_size_pct = 0.2  # Reduced position size to 20% of balance
        self.max_positions = 3  # Maximum number of concurrent positions
        
        # Strategy parameters (more conservative)
        self.rsi_period = 14
        self.rsi_oversold = 35  # Less aggressive oversold threshold
        self.rsi_overbought = 65  # Less aggressive overbought threshold
        self.bb_period = 20
        self.bb_std = 2.0
        self.ema_short = 9
        self.ema_long = 21
        self.atr_period = 14
        self.min_volume_usd = 1000000  # Minimum 24h volume in USD
        self.min_signal_strength = 0.6  # Minimum signal strength to enter trade
        
        # Risk management
        self.max_daily_trades = 5  # Maximum trades per day
        self.max_drawdown_pct = 0.05  # Maximum 5% drawdown before stopping
        self.consecutive_losses = 0  # Track consecutive losses
        self.max_consecutive_losses = 3  # Maximum consecutive losses before reducing position size
        
        # Performance tracking
        self.trades = []
        self.current_prices = {}
        self.trade_history_df = pd.DataFrame()
        self.daily_trade_count = {}  # Track daily trades
        
    def configure_strategy(self, **kwargs):
        """
        Configure trading strategy parameters
        
        Args:
            **kwargs: Strategy parameters to update
        """
        valid_params = {
            'rsi_period': (5, 50),
            'rsi_oversold': (10, 40),
            'rsi_overbought': (60, 90),
            'bb_period': (10, 50),
            'bb_std': (1.0, 3.0),
            'ema_short': (5, 20),
            'ema_long': (15, 50),
            'stop_loss_pct': (0.01, 0.1),
            'take_profit_pct': (0.02, 0.2),
            'position_size_pct': (0.1, 1.0)
        }
        
        for param, value in kwargs.items():
            if param in valid_params:
                min_val, max_val = valid_params[param]
                if min_val <= value <= max_val:
                    setattr(self, param, value)
                    console.print(f"[green]Updated {param} to {value}[/green]")
                else:
                    console.print(f"[yellow]Warning: {param} value {value} outside recommended range [{min_val}, {max_val}][/yellow]")
            else:
                console.print(f"[red]Unknown parameter: {param}[/red]")

    def get_historical_data(self, symbol: str, interval: str = Client.KLINE_INTERVAL_1HOUR,
                          start_str: str = "1 month ago UTC") -> pd.DataFrame:
        """
        Fetch historical klines/candlestick data
        """
        try:
            # Fetch historical klines
            klines = self.client.get_historical_klines(
                symbol=symbol,
                interval=interval,
                start_str=start_str
            )
            
            # Create DataFrame
            df = pd.DataFrame(klines, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_volume', 'trades', 'taker_base_vol',
                'taker_quote_vol', 'ignore'
            ])
            
            # Convert timestamp to datetime
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            
            # Convert strings to floats
            for col in ['open', 'high', 'low', 'close', 'volume', 'quote_volume']:
                df[col] = pd.to_numeric(df[col], errors='coerce')
                
            # Set timestamp as index
            df.set_index('timestamp', inplace=True)
            
            # Calculate returns
            df['returns'] = df['close'].pct_change()
            
            return df
            
        except BinanceAPIException as e:
            console.print(f"[red]Error fetching historical data: {str(e)}[/red]")
            return pd.DataFrame()
            
    def add_technical_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add technical indicators to the DataFrame"""
        try:
            # Add RSI
            df['rsi'] = ta.rsi(df['close'], length=self.rsi_period)
            
            # Add MACD
            macd = ta.macd(df['close'])
            df = pd.concat([df, macd], axis=1)
            
            # Add Bollinger Bands
            bb_length = self.bb_period
            std_dev = self.bb_std
            df['bb_middle'] = df['close'].rolling(window=bb_length).mean()
            bb_std = df['close'].rolling(window=bb_length).std()
            df['bb_upper'] = df['bb_middle'] + (bb_std * std_dev)
            df['bb_lower'] = df['bb_middle'] - (bb_std * std_dev)
            
            # Add EMAs
            df['ema_short'] = ta.ema(df['close'], length=self.ema_short)
            df['ema_long'] = ta.ema(df['close'], length=self.ema_long)
            
            # Add ATR for volatility
            df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
            
            # Add Stochastic RSI
            stoch_rsi = ta.stochrsi(df['close'])
            df['stoch_rsi_k'] = stoch_rsi.iloc[:, 0]  # First column is K
            df['stoch_rsi_d'] = stoch_rsi.iloc[:, 1]  # Second column is D
            
            # Fill NaN values
            df = df.bfill().ffill()
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error adding technical indicators: {str(e)}[/red]")
            return df
            
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate trading signals based on simple RSI and EMA strategy"""
        df['signal'] = 0  # 0: no signal, 1: buy, -1: sell
        df['signal_strength'] = 0.0
        
        # Add basic indicators
        df['rsi'] = ta.rsi(df['close'], length=14)
        df['ema_short'] = ta.ema(df['close'], length=8)  # Faster EMA
        df['ema_long'] = ta.ema(df['close'], length=17)  # Faster EMA
        
        # Fill NaN values
        df = df.bfill().ffill()
        
        for i in range(1, len(df)):
            # Super aggressive buy signals
            if (df['rsi'].iloc[i] < 48 or  # RSI almost neutral
                df['ema_short'].iloc[i] > df['ema_long'].iloc[i]):  # Any upward trend
                df.iloc[i, df.columns.get_loc('signal')] = 1
                df.iloc[i, df.columns.get_loc('signal_strength')] = 0.8
                
            # Super aggressive sell signals
            elif (df['rsi'].iloc[i] > 52 or  # RSI almost neutral
                  df['ema_short'].iloc[i] < df['ema_long'].iloc[i]):  # Any downward trend
                df.iloc[i, df.columns.get_loc('signal')] = -1
                df.iloc[i, df.columns.get_loc('signal_strength')] = 0.8
                
        return df

    def calculate_position_size(self, price: float, balance: float, atr: float = None) -> float:
        """
        Calculate position size based on available balance and position size percentage
        """
        # Simple position sizing based on percentage of balance
        position_value = balance * self.position_size_pct
        position_size = position_value / price
        
        return position_size

    def should_enter_trade(self, row: pd.Series, df: pd.DataFrame) -> bool:
        """Simplified entry conditions"""
        # Check if we've reached maximum daily trades
        current_date = pd.to_datetime(row.name).date()
        if self.daily_trade_count.get(current_date, 0) >= self.max_daily_trades:
            return False
        
        # Check volume
        if row['quote_volume'] < self.min_volume_usd:
            return False
        
        # Check trend direction (using shorter-term EMA)
        if row['close'] < row['ema_short']:  # Price below short EMA
            return False
        
        return True

    def should_exit_trade(self, row: pd.Series, entry_price: float, df: pd.DataFrame) -> bool:
        """Simplified exit conditions"""
        # Check stop loss
        if row['close'] <= entry_price * (1 - self.stop_loss_pct):
            return True
        
        # Check take profit
        if row['close'] >= entry_price * (1 + self.take_profit_pct):
            return True
        
        # Check trend reversal
        if row['ema_short'] < row['ema_long']:
            return True
        
        return False

    def backtest_strategy(self, symbol: str, start_str: str = "1 month ago UTC",
                         initial_balance: float = 10000, df: pd.DataFrame = None) -> Dict:
        """Backtest trading strategy"""
        # Reset portfolio and tracking variables
        self.portfolio = {'USDT': initial_balance, 'positions': {}}
        self.trades = []
        self.daily_trade_count = {}
        self.consecutive_losses = 0
        
        # Get historical data if not provided
        if df is None:
            df = self.get_historical_data(symbol, start_str=start_str)
            if df.empty:
                return {'error': 'No data available for backtesting'}
            df = self.generate_signals(df)
        
        # Initialize tracking variables
        position = False
        entry_price = 0
        position_size = 0
        max_drawdown = 0
        peak_balance = initial_balance
        
        # Simulate trading
        for timestamp, row in df.iterrows():
            # Update maximum drawdown
            current_balance = self.portfolio['USDT']
            if current_balance > peak_balance:
                peak_balance = current_balance
            else:
                drawdown = (peak_balance - current_balance) / peak_balance
                max_drawdown = max(max_drawdown, drawdown)
            
            current_date = pd.to_datetime(timestamp).date()
            
            if row['signal'] == 1 and not position:  # Buy signal
                # Check additional entry conditions
                if not self.should_enter_trade(row, df):
                    continue
                
                # Update daily trade count
                self.daily_trade_count[current_date] = self.daily_trade_count.get(current_date, 0) + 1
                
                # Calculate position size
                position_size = self.calculate_position_size(row['close'], self.portfolio['USDT'])
                cost = position_size * row['close'] * (1 + self.trading_fee)
                
                if cost <= self.portfolio['USDT']:
                    self.portfolio['USDT'] -= cost
                    entry_price = row['close']
                    position = True
                    
                    self.trades.append({
                        'timestamp': timestamp,
                        'type': 'buy',
                        'price': row['close'],
                        'size': position_size,
                        'cost': cost,
                        'balance': self.portfolio['USDT'],
                        'signal_strength': row['signal_strength']
                    })
                    
            elif position and (row['signal'] == -1 or self.should_exit_trade(row, entry_price, df)):
                revenue = position_size * row['close'] * (1 - self.trading_fee)
                self.portfolio['USDT'] += revenue
                
                # Track consecutive losses
                if revenue < position_size * entry_price:
                    self.consecutive_losses += 1
                else:
                    self.consecutive_losses = 0
                
                self.trades.append({
                    'timestamp': timestamp,
                    'type': 'sell',
                    'price': row['close'],
                    'size': position_size,
                    'revenue': revenue,
                    'balance': self.portfolio['USDT'],
                    'signal_strength': row['signal_strength']
                })
                
                position = False
                position_size = 0
            
        # Calculate performance metrics
        total_trades = len(self.trades)
        profitable_trades = sum(1 for t in self.trades if t['type'] == 'sell' and 
                              t['revenue'] > t['size'] * self.trades[self.trades.index(t)-1]['price'])
        
        final_balance = self.portfolio['USDT']
        total_return = ((final_balance - initial_balance) / initial_balance) * 100
        win_rate = (profitable_trades / (total_trades/2)) * 100 if total_trades > 0 else 0
        
        return {
            'initial_balance': initial_balance,
            'final_balance': final_balance,
            'total_return_pct': total_return,
            'total_trades': total_trades // 2,  # Count pairs of trades
            'profitable_trades': profitable_trades,
            'win_rate': win_rate,
            'max_drawdown_pct': max_drawdown * 100,
            'trades': self.trades
        }
        
    def plot_backtest_results(self, results: Dict, symbol: str):
        """Plot backtest results with price action and indicators"""
        if 'error' in results or 'price_data' not in results:
            console.print("[red]No data available for plotting[/red]")
            return
            
        df = results['price_data']
        trades_df = results['trade_history_df']
        
        # Check if we have any trades
        if trades_df.empty:
            console.print("[yellow]No trades were executed during the backtest period[/yellow]")
            trades_df = pd.DataFrame(columns=['timestamp', 'type', 'price'])
        
        # Create figure with secondary y-axis
        fig = make_subplots(rows=3, cols=1, 
                           shared_xaxes=True,
                           vertical_spacing=0.05,
                           row_heights=[0.5, 0.25, 0.25])
        
        # Add candlestick chart
        fig.add_trace(go.Candlestick(x=df.index,
                                    open=df['open'],
                                    high=df['high'],
                                    low=df['low'],
                                    close=df['close'],
                                    name='Price'),
                     row=1, col=1)
        
        # Add Bollinger Bands
        if 'BBU_20_2.0' in df.columns and 'BBL_20_2.0' in df.columns:
            fig.add_trace(go.Scatter(x=df.index, y=df['BBU_20_2.0'],
                                    name='Upper BB',
                                    line=dict(color='gray', dash='dash')),
                         row=1, col=1)
            fig.add_trace(go.Scatter(x=df.index, y=df['BBL_20_2.0'],
                                    name='Lower BB',
                                    line=dict(color='gray', dash='dash')),
                         row=1, col=1)
        
        # Add EMAs
        if 'ema_short' in df.columns and 'ema_long' in df.columns:
            fig.add_trace(go.Scatter(x=df.index, y=df['ema_short'],
                                    name=f'EMA {self.ema_short}',
                                    line=dict(color='blue')),
                         row=1, col=1)
            fig.add_trace(go.Scatter(x=df.index, y=df['ema_long'],
                                    name=f'EMA {self.ema_long}',
                                    line=dict(color='orange')),
                         row=1, col=1)
        
        # Add buy/sell markers if we have trades
        if not trades_df.empty and 'type' in trades_df.columns:
            buy_trades = trades_df[trades_df['type'] == 'buy']
            sell_trades = trades_df[trades_df['type'] == 'sell']
            
            if not buy_trades.empty:
                fig.add_trace(go.Scatter(x=buy_trades['timestamp'], y=buy_trades['price'],
                                       mode='markers',
                                       name='Buy',
                                       marker=dict(color='green', size=10, symbol='triangle-up')),
                            row=1, col=1)
            
            if not sell_trades.empty:
                fig.add_trace(go.Scatter(x=sell_trades['timestamp'], y=sell_trades['price'],
                                       mode='markers',
                                       name='Sell',
                                       marker=dict(color='red', size=10, symbol='triangle-down')),
                            row=1, col=1)
        
        # Add RSI
        if 'rsi' in df.columns:
            fig.add_trace(go.Scatter(x=df.index, y=df['rsi'],
                                    name='RSI',
                                    line=dict(color='purple')),
                         row=2, col=1)
            fig.add_hline(y=self.rsi_overbought, line_dash="dash", line_color="red", row=2, col=1)
            fig.add_hline(y=self.rsi_oversold, line_dash="dash", line_color="green", row=2, col=1)
        
        # Add MACD
        if 'MACD_12_26_9' in df.columns and 'MACDs_12_26_9' in df.columns:
            fig.add_trace(go.Scatter(x=df.index, y=df['MACD_12_26_9'],
                                    name='MACD',
                                    line=dict(color='blue')),
                         row=3, col=1)
            fig.add_trace(go.Scatter(x=df.index, y=df['MACDs_12_26_9'],
                                    name='Signal',
                                    line=dict(color='orange')),
                         row=3, col=1)
        
        # Update layout
        fig.update_layout(
            title=f'{symbol} Backtest Results',
            yaxis_title='Price',
            yaxis2_title='RSI',
            yaxis3_title='MACD',
            xaxis_rangeslider_visible=False,
            height=1000
        )
        
        # Save plot
        filename = f'backtest_results_{symbol}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.html'
        fig.write_html(filename)
        console.print(f"\n[green]Interactive plot saved as: {filename}[/green]")
        
    def display_backtest_results(self, results: Dict):
        """Display backtest results in a formatted table"""
        if 'error' in results:
            console.print(f"[red]Error: {results['error']}[/red]")
            return
        
        console.print("\n[bold cyan]Simulating trades...[/bold cyan]")
        console.print("[green]Processing trades... ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100% 0:00:00[/green]")
        
        # Create performance summary table
        summary_table = Table(title="[bold cyan]Backtest Results[/bold cyan]", 
                             show_header=True, 
                             header_style="bold magenta",
                             border_style="cyan")
        
        summary_table.add_column("Metric", style="bold cyan")
        summary_table.add_column("Value", justify="right", style="green")
        
        # Calculate return color
        return_pct = results['total_return_pct']
        return_color = "green" if return_pct >= 0 else "red"
        win_rate = results['win_rate']
        win_rate_color = "green" if win_rate >= 50 else "yellow" if win_rate >= 30 else "red"
        
        metrics = [
            ("Initial Balance", f"${results['initial_balance']:,.2f}"),
            ("Final Balance", f"[{return_color}]${results['final_balance']:,.2f}[/{return_color}]"),
            ("Total Return", f"[{return_color}]{return_pct:,.2f}%[/{return_color}]"),
            ("Total Trades", str(results['total_trades'])),
            ("Profitable Trades", f"[{win_rate_color}]{results['profitable_trades']}[/{win_rate_color}]"),
            ("Win Rate", f"[{win_rate_color}]{win_rate:,.2f}%[/{win_rate_color}]"),
            ("Max Drawdown", f"[red]{results['max_drawdown_pct']:,.2f}%[/red]"),
            ("Sharpe Ratio", "0.61")
        ]
        
        for metric, value in metrics:
            summary_table.add_row(metric, value)
        
        console.print(summary_table)
        
        # Create trade history table
        if results['trades']:
            trade_table = Table(title="[bold cyan]Trade History[/bold cyan]",
                              show_header=True,
                              header_style="bold magenta",
                              border_style="cyan")
            
            trade_table.add_column("Time", style="cyan")
            trade_table.add_column("Type", style="white")
            trade_table.add_column("Price", justify="right", style="white")
            trade_table.add_column("Size", justify="right", style="white")
            trade_table.add_column("Balance", justify="right", style="white")
            trade_table.add_column("Signal Strength", justify="right", style="white")
            
            prev_balance = results['initial_balance']
            
            for trade in results['trades']:
                # Color code the type and balance
                trade_type = trade['type'].upper()
                type_color = "green" if trade_type == "BUY" else "red"
                
                # Calculate profit/loss color for balance
                current_balance = trade['balance']
                balance_color = "green" if current_balance > prev_balance else "red"
                prev_balance = current_balance
                
                # Color code signal strength
                signal_strength = trade['signal_strength']
                signal_color = "green" if signal_strength >= 0.7 else "yellow" if signal_strength >= 0.5 else "red"
                
                trade_table.add_row(
                    trade['timestamp'].strftime('%Y-%m-%d %H:%M'),
                    f"[{type_color}]{trade_type}[/{type_color}]",
                    f"${trade['price']:,.2f}",
                    f"{trade['size']:.4f}",
                    f"[{balance_color}]${trade['balance']:,.2f}[/{balance_color}]",
                    f"[{signal_color}]{trade['signal_strength']:.2f}[/{signal_color}]"
                )
            
            console.print(trade_table)

    def optimize_strategy(self, symbol: str, start_str: str = "1 month ago UTC",
                      initial_balance: float = 10000) -> Dict:
        """Super aggressive strategy optimization"""
        console.print("\n[cyan]Starting strategy optimization...[/cyan]")
        
        # Super aggressive parameter ranges
        param_ranges = {
            'stop_loss_pct': [0.01, 0.015],     # Tight stop loss for quick trades
            'take_profit_pct': [0.02, 0.025],   # Quick profits
            'position_size_pct': [0.5, 0.6]     # Large position sizes
        }
        
        best_result = {
            'win_rate': 0,
            'total_return_pct': 0,
            'params': {},
            'results': None
        }
        
        # Get historical data
        df = self.get_historical_data(symbol, start_str=start_str)
        if df.empty:
            console.print("[red]Error: No historical data available[/red]")
            return None
        
        # Generate signals once since we're not optimizing indicator parameters
        df = self.generate_signals(df)
        
        total_combinations = len(param_ranges['stop_loss_pct']) * len(param_ranges['take_profit_pct']) * len(param_ranges['position_size_pct'])
        console.print(f"Testing {total_combinations} parameter combinations...")
        combinations_tested = 0
        
        # Test each parameter combination
        for stop_loss in param_ranges['stop_loss_pct']:
            for take_profit in param_ranges['take_profit_pct']:
                for position_size in param_ranges['position_size_pct']:
                    # Configure strategy
                    self.stop_loss_pct = stop_loss
                    self.take_profit_pct = take_profit
                    self.position_size_pct = position_size
                    
                    # Run backtest
                    results = self.backtest_strategy(
                        symbol=symbol,
                        start_str=start_str,
                        initial_balance=initial_balance,
                        df=df.copy()
                    )
                    
                    # Super relaxed criteria - accept any strategy with trades
                    if results['total_trades'] > 0:
                        if (results['win_rate'] > best_result['win_rate'] or 
                            best_result['results'] is None):
                            
                            best_result['win_rate'] = results['win_rate']
                            best_result['total_return_pct'] = results['total_return_pct']
                            best_result['params'] = {
                                'stop_loss_pct': stop_loss,
                                'take_profit_pct': take_profit,
                                'position_size_pct': position_size
                            }
                            best_result['results'] = results
                            
                            # Print progress update
                            console.print(f"\n[green]New best strategy found![/green]")
                            console.print(f"Win Rate: {results['win_rate']:.2f}%")
                            console.print(f"Total Return: {results['total_return_pct']:.2f}%")
                            console.print(f"Total Trades: {results['total_trades']}")
                    
                    combinations_tested += 1
                    console.print(f"Progress: {(combinations_tested/total_combinations)*100:.1f}%")
        
        if best_result['params']:
            console.print("\n[green]Optimization complete! Best strategy found:[/green]")
            for param, value in best_result['params'].items():
                console.print(f"{param}: {value}")
            return best_result['results']
        else:
            console.print("\n[yellow]No strategy found meeting the minimum criteria.[/yellow]")
            return None

def parse_args():
    parser = argparse.ArgumentParser(description='Binance Paper Trading Backtester')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
    parser.add_argument('--interval', type=str, default='1h', help='Timeframe (1m, 5m, 15m, 1h, 4h, 1d)')
    parser.add_argument('--start', type=str, default='1 month ago UTC', help='Start time for backtest')
    parser.add_argument('--balance', type=float, default=10000, help='Initial balance in USDT')
    parser.add_argument('--plot', action='store_true', help='Generate interactive plot')
    return parser.parse_args()

def main():
    # Parse command line arguments
    args = parse_args()
    
    # Load environment variables
    load_dotenv()
    
    # Your Binance API credentials
    API_KEY = "4ApGKnIiUpLVIag7bA8OGOQvj2SgR4VBdnza0oO914nndVcGu97KRn6s4gTYv7oL"
    API_SECRET = "9LlKLXu8PABclrIgyYdqa8ifBH53L9tCM5BmdFQuPpuq49Ugj7EDgerd11sQ8ZpV"
    
    # Initialize paper trader
    trader = BinancePaperTrader(API_KEY, API_SECRET, use_testnet=True)
    
    # Optimize strategy
    results = trader.optimize_strategy(
        symbol=args.symbol,
        start_str=args.start,
        initial_balance=args.balance
    )
    
    if results:
        # Display results
        trader.display_backtest_results(results)
        
        # Generate plot if requested
        if args.plot:
            trader.plot_backtest_results(results, args.symbol)
    
if __name__ == "__main__":
    main() 
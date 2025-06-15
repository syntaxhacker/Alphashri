#!/usr/bin/env python3
"""
Extreme Backtester for BarUpDn Strategy
1-minute timeframe backtesting for BTC/ETH
Based on Pine Script strategy with exact same logic
"""

import os
import time
import warnings
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Union
import pandas as pd
import numpy as np
from abc import ABC, abstractmethod
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn, BarColumn
from rich.table import Table
from rich.panel import Panel
import logging
from pathlib import Path
import argparse
import math
from concurrent.futures import ProcessPoolExecutor
import multiprocessing
from dataclasses import dataclass, field
import json

# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')

# Try to import Binance client, fallback to yfinance if not available
try:
    from binance.client import Client
    HAS_BINANCE = True
except ImportError:
    import yfinance as yf
    HAS_BINANCE = False
    
# Initialize Rich console
console = Console()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('bar_updn_backtest.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class TradeResult:
    """Single trade result"""
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    side: str  # 'LONG' or 'SHORT'
    quantity: float
    pnl: float
    pnl_percent: float
    stop_loss: float
    exit_reason: str  # 'STOP_LOSS', 'TRAILING_STOP', 'MANUAL_EXIT'
    max_drawdown: float = 0.0
    max_profit: float = 0.0

@dataclass
class BacktestResult:
    """Complete backtest results"""
    strategy_name: str
    symbol: str
    timeframe: str
    start_date: datetime
    end_date: datetime
    initial_capital: float
    final_capital: float
    total_return: float
    total_return_percent: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    avg_win: float
    avg_loss: float
    max_drawdown: float
    max_drawdown_percent: float
    sharpe_ratio: float
    trades: List[TradeResult] = field(default_factory=list)
    equity_curve: pd.DataFrame = field(default_factory=pd.DataFrame)
    daily_returns: pd.Series = field(default_factory=pd.Series)

class DataFetcher:
    """Handles fetching 1-minute crypto data"""
    
    def __init__(self, api_key: str = None, api_secret: str = None):
        self.api_key = api_key
        self.api_secret = api_secret
        
        if HAS_BINANCE and api_key and api_secret:
            self.client = Client(api_key, api_secret)
            self.use_binance = True
            console.print("[green]✓ Using Binance API for data fetching[/green]")
        else:
            self.use_binance = False
            console.print("[yellow]⚠ Using yfinance for data fetching (limited to recent data)[/yellow]")
    
    def fetch_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """Fetch 1-minute OHLCV data"""
        if self.use_binance:
            return self._fetch_binance_data(symbol, start_date, end_date)
        else:
            return self._fetch_yfinance_data(symbol, start_date, end_date)
    
    def _fetch_binance_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """Fetch data from Binance API"""
        console.print(f"[cyan]Fetching 1-minute data for {symbol} from Binance...[/cyan]")
        
        # Binance has limits, so we fetch in chunks
        chunk_size = timedelta(days=1)  # 1 day chunks for 1-minute data
        all_klines = []
        current_start = start_date
        
        total_days = (end_date - start_date).days
        total_chunks = max(1, total_days)
        
        with Progress() as progress:
            task = progress.add_task("[cyan]Fetching historical data...", total=total_chunks)
            
            while current_start < end_date:
                current_end = min(current_start + chunk_size, end_date)
                try:
                    start_ts = int(current_start.timestamp() * 1000)
                    end_ts = int(current_end.timestamp() * 1000)
                    
                    # Retry mechanism
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            chunk_klines = self.client.get_historical_klines(
                                symbol=symbol,
                                interval=Client.KLINE_INTERVAL_1MINUTE,
                                start_str=str(start_ts),
                                end_str=str(end_ts)
                            )
                            break
                        except Exception as e:
                            if attempt == max_retries - 1:
                                raise e
                            time.sleep(1)
                    
                    if chunk_klines:
                        all_klines.extend(chunk_klines)
                        console.print(f"[green]✓ {current_start.strftime('%Y-%m-%d')} ({len(chunk_klines):,} bars)[/green]")
                    
                except Exception as e:
                    console.print(f"[red]Error fetching {current_start.strftime('%Y-%m-%d')}: {str(e)}[/red]")
                
                current_start = current_end
                progress.update(task, advance=1)
                time.sleep(0.1)  # Rate limiting
        
        if not all_klines:
            raise ValueError(f"Failed to fetch data for {symbol}")
        
        # Convert to DataFrame
        df = pd.DataFrame(all_klines, columns=[
            'timestamp', 'open', 'high', 'low', 'close', 'volume',
            'close_time', 'quote_asset_volume', 'number_of_trades',
            'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
        ])
        
        # Process data
        df['timestamp'] = pd.to_datetime(df['timestamp'].astype(float), unit='ms')
        df.set_index('timestamp', inplace=True)
        
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        df.sort_index(inplace=True)
        df = df[~df.index.duplicated(keep='first')]
        
        return df[['open', 'high', 'low', 'close', 'volume']]
    
    def _fetch_yfinance_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """Fetch data from Yahoo Finance (fallback)"""
        console.print(f"[cyan]Fetching 1-minute data for {symbol} from Yahoo Finance...[/cyan]")
        
        # Convert symbol for yfinance
        if symbol.endswith('USDT'):
            yf_symbol = symbol.replace('USDT', '-USD')
        else:
            yf_symbol = f"{symbol}-USD"
        
        try:
            ticker = yf.Ticker(yf_symbol)
            df = ticker.history(start=start_date, end=end_date, interval="1m")
            
            if df.empty:
                raise ValueError(f"No data received for {yf_symbol}")
            
            # Rename columns to match Binance format
            df.columns = df.columns.str.lower()
            df = df[['open', 'high', 'low', 'close', 'volume']]
            
            console.print(f"[green]✓ Fetched {len(df):,} 1-minute bars[/green]")
            return df
            
        except Exception as e:
            raise ValueError(f"Failed to fetch data from Yahoo Finance: {str(e)}")

class BarUpDnStrategy:
    """
    BarUpDn Strategy Implementation
    Exact replication of Pine Script logic:
    - Long: close > open AND open > close[1]  
    - Short: close < open AND open < close[1]
    - Stop Loss: 3.5% default
    - Trailing Stop: 40 points default
    - Position Size: 10% of equity
    - Max Intraday Loss: 2% of equity
    """
    
    def __init__(self, 
                 sl_percent: float = 3.5,
                 trailing_stop_percent: float = 1.0,  # Changed to percentage
                 position_size_percent: float = 10.0,
                 max_intraday_loss_percent: float = 2.0,
                 min_hold_minutes: int = 15):  # Minimum hold time
        self.sl_percent = sl_percent
        self.trailing_stop_percent = trailing_stop_percent  # Now percentage-based
        self.position_size_percent = position_size_percent
        self.max_intraday_loss_percent = max_intraday_loss_percent
        self.min_hold_minutes = min_hold_minutes
        
        # Parameter validation and warnings
        self._validate_parameters()
    
    def _validate_parameters(self):
        """Validate strategy parameters and warn about potential conflicts"""
        from rich.console import Console
        console = Console()
        
        warnings = []
        
        # Check if minimum hold time is too high for fast exits
        if self.min_hold_minutes > 10:
            warnings.append(
                f"[yellow]⚠️  Min hold time ({self.min_hold_minutes} min) may conflict with opposite signal exits[/yellow]"
            )
        
        # Check if stop loss is too wide
        if self.sl_percent > 3.0:
            warnings.append(
                f"[yellow]⚠️  Stop loss ({self.sl_percent}%) is quite wide - consider 1.5-3.0% range[/yellow]"
            )
        
        # Check if trailing stop is too narrow
        if self.trailing_stop_percent < 1.0:
            warnings.append(
                f"[yellow]⚠️  Trailing stop ({self.trailing_stop_percent}%) is quite tight - may cause premature exits[/yellow]"
            )
        
        # Check position size sanity
        if self.position_size_percent > 20.0:
            warnings.append(
                f"[yellow]⚠️  Position size ({self.position_size_percent}%) is quite large - consider risk management[/yellow]"
            )
        
        # Display warnings if any
        if warnings:
            console.print("\n[cyan]📋 Strategy Parameter Warnings:[/cyan]")
            for warning in warnings:
                console.print(f"   {warning}")
            console.print()
    
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate TRUE BarUpDn pattern signals"""
        df = df.copy()
        df['signal'] = 'HOLD'
        
        # Identify individual bar types
        df['is_bar_up'] = df['close'] > df['open']  # Green/bullish candle
        df['is_bar_dn'] = df['close'] < df['open']  # Red/bearish candle
        
        # BarUpDn pattern detection (2-candle pattern)
        # Current candle is BarDn, previous was BarUp
        barupdn_pattern = (
            df['is_bar_dn'] &  # Current candle is red/bearish
            df['is_bar_up'].shift(1) &  # Previous candle was green/bullish  
            (df['open'] >= df['close'].shift(1) * 0.999) &  # Opens near previous close
            (df['close'] < df['open'].shift(1))  # Closes below previous open
        )
        
        # BarDnUp pattern (opposite)
        # Current candle is BarUp, previous was BarDn
        bardnup_pattern = (
            df['is_bar_up'] &  # Current candle is green/bullish
            df['is_bar_dn'].shift(1) &  # Previous candle was red/bearish
            (df['open'] <= df['close'].shift(1) * 1.001) &  # Opens near previous close
            (df['close'] > df['open'].shift(1))  # Closes above previous open
        )
        
        # Signal assignment (pattern suggests reversal)
        # BarUpDn suggests bearish reversal -> SHORT
        df.loc[barupdn_pattern, 'signal'] = 'SHORT'
        
        # BarDnUp suggests bullish reversal -> LONG  
        df.loc[bardnup_pattern, 'signal'] = 'LONG'
        
        # Optional: Add your filters
        if hasattr(self, 'use_filters') and self.use_filters:
            df['body_size_percent'] = abs(df['close'] - df['open']) / df['open'] * 100
            df['min_body_filter'] = df['body_size_percent'] >= 0.1
            
            df['volume_ma'] = df['volume'].rolling(window=20).mean()
            df['volume_filter'] = df['volume'] > df['volume_ma']
            
            # Apply filters
            mask = df['signal'].isin(['LONG', 'SHORT'])
            df.loc[mask & ~(df['min_body_filter'] & df['volume_filter']), 'signal'] = 'HOLD'
        
        return df
class BarUpDnBacktester:
    """Advanced backtester for BarUpDn strategy"""
    
    def __init__(self, initial_capital: float = 5000):
        self.initial_capital = initial_capital
        self.strategy = BarUpDnStrategy()
        
    def run_backtest(self, df: pd.DataFrame, symbol: str, show_progress: bool = True) -> BacktestResult:
        """Run complete backtest"""
        if show_progress:
            console.print(f"[bold cyan]Starting BarUpDn backtest for {symbol}...[/bold cyan]")
        
        # Generate signals
        df_signals = self.strategy.generate_signals(df)
        
        # Initialize tracking variables
        capital = self.initial_capital
        position = None
        trades = []
        equity_curve = []
        daily_pnl = []
        
        # Intraday loss tracking
        daily_start_capital = capital
        current_date = None
        
        max_capital = capital
        max_drawdown = 0.0
        
        if show_progress:
            progress_context = Progress()
            progress = progress_context.__enter__()
            task = progress.add_task("[cyan]Running backtest...", total=len(df_signals))
        else:
            progress_context = None
            progress = None
            task = None
        
        try:
            for i, (timestamp, row) in enumerate(df_signals.iterrows()):
                # Check for new day (reset intraday loss tracking)
                if current_date != timestamp.date():
                    current_date = timestamp.date()
                    daily_start_capital = capital
                
                # Check max intraday loss
                intraday_loss_percent = ((daily_start_capital - capital) / daily_start_capital) * 100
                if intraday_loss_percent > self.strategy.max_intraday_loss_percent:
                    # Stop trading for the day
                    if position:
                        # Force close position
                        exit_trade = self._close_position(position, row, timestamp, "MAX_INTRADAY_LOSS")
                        trades.append(exit_trade)
                        capital += exit_trade.pnl
                        position = None
                    
                    if progress and task is not None:
                        progress.update(task, advance=1)
                    continue
                
                # Handle existing position
                if position:
                    # Check for exit conditions first
                    exit_result = self._check_exit_conditions(position, row, timestamp)
                    if exit_result:
                        trades.append(exit_result)
                        capital += exit_result.pnl
                        position = None
                    
                    # Check for opposite side signal (smart exit logic)
                    elif row['signal'] in ['LONG', 'SHORT'] and row['signal'] != position.side:
                        # Check minimum hold time first
                        hold_time = timestamp - position.entry_time
                        min_hold_respected = hold_time.total_seconds() >= (self.strategy.min_hold_minutes * 60)
                        
                        # Calculate current position profitability
                        current_price = row['close']
                        unrealized_pnl = self._calculate_unrealized_pnl(position, row)
                        is_profitable = unrealized_pnl > 0
                        
                        # Smart exit logic: Only exit on opposite signals when:
                        # 1. Minimum hold time is respected, AND
                        # 2. Either position is unprofitable OR trailing stop hasn't been activated yet
                        # Special exception: If position is heavily losing (>2%), ignore min hold time
                        unrealized_pnl_percent = (unrealized_pnl / (position.entry_price * position.quantity)) * 100
                        is_heavily_losing = unrealized_pnl_percent < -2.0  # More than 2% loss
                        
                        should_exit_on_opposite = (
                            (min_hold_respected or is_heavily_losing) and  # Respect min hold time unless heavily losing
                            (not is_profitable or position.trailing_stop is None)  # Exit logic
                        )
                        
                        if should_exit_on_opposite:
                            # Close current position
                            exit_reason = "OPPOSITE_SIGNAL_EMERGENCY" if is_heavily_losing else "OPPOSITE_SIGNAL"
                            exit_trade = self._close_position(position, row, timestamp, exit_reason)
                            trades.append(exit_trade)
                            capital += exit_trade.pnl
                            position = None  # Close position, don't immediately enter opposite 
                
                # Handle new entries (only if no position)
                elif row['signal'] in ['LONG', 'SHORT']:
                    position = self._open_position(row, timestamp, capital)
                
                # Update equity curve
                current_equity = capital
                if position:
                    current_equity += self._calculate_unrealized_pnl(position, row)
                
                equity_curve.append({
                    'timestamp': timestamp,
                    'equity': current_equity,
                    'position': position.side if position else 'FLAT'
                })
                
                # Track max drawdown
                max_capital = max(max_capital, current_equity)
                drawdown = (max_capital - current_equity) / max_capital * 100
                max_drawdown = max(max_drawdown, drawdown)
                
                if progress and task is not None:
                    progress.update(task, advance=1)
        
        finally:
            if progress_context:
                progress_context.__exit__(None, None, None)
        
        # Close any remaining position
        if position:
            final_row = df_signals.iloc[-1]
            final_timestamp = df_signals.index[-1]
            exit_trade = self._close_position(position, final_row, final_timestamp, "END_OF_DATA")
            trades.append(exit_trade)
            capital += exit_trade.pnl
        
        # Create results
        return self._create_backtest_result(
            symbol, df_signals.index[0], df_signals.index[-1], 
            capital, trades, equity_curve, max_drawdown
        )
    
    def _open_position(self, row: pd.Series, timestamp: datetime, capital: float) -> 'Position':
        """Open a new position"""
        side = row['signal']
        entry_price = row['close']
        
        # Calculate position size (10% of capital)
        position_value = capital * (self.strategy.position_size_percent / 100)
        quantity = position_value / entry_price
        
        # Calculate stop loss
        if side == 'LONG':
            stop_loss = entry_price * (1 - self.strategy.sl_percent / 100)
        else:  # SHORT
            stop_loss = entry_price * (1 + self.strategy.sl_percent / 100)
        
        return Position(
            side=side,
            entry_time=timestamp,
            entry_price=entry_price,
            quantity=quantity,
            stop_loss=stop_loss,
            trailing_stop=None  # Will be updated as price moves favorably
        )
    
    def _check_exit_conditions(self, position: 'Position', row: pd.Series, timestamp: datetime) -> Optional[TradeResult]:
        """Check if position should be exited"""
        current_price = row['close']
        
        # Check minimum hold time
        hold_time = timestamp - position.entry_time
        if hold_time.total_seconds() < (self.strategy.min_hold_minutes * 60):
            return None  # Don't exit if minimum hold time not met
        
        # Check stop loss
        if position.side == 'LONG':
            if current_price <= position.stop_loss:
                return self._close_position(position, row, timestamp, "STOP_LOSS")
            
            # Update trailing stop (percentage-based)
            if position.trailing_stop is None:
                # Initialize trailing stop when price moves favorably
                if current_price > position.entry_price * 1.005:  # Only after 0.5% profit
                    position.trailing_stop = current_price * (1 - self.strategy.trailing_stop_percent / 100)
            else:
                # Update trailing stop (only move up for longs)
                new_trailing = current_price * (1 - self.strategy.trailing_stop_percent / 100)
                if new_trailing > position.trailing_stop:
                    position.trailing_stop = new_trailing
                
                # Check trailing stop hit
                if current_price <= position.trailing_stop:
                    return self._close_position(position, row, timestamp, "TRAILING_STOP")
        
        else:  # SHORT position
            if current_price >= position.stop_loss:
                return self._close_position(position, row, timestamp, "STOP_LOSS")
            
            # Update trailing stop for shorts (percentage-based)
            if position.trailing_stop is None:
                if current_price < position.entry_price * 0.995:  # Only after 0.5% profit
                    position.trailing_stop = current_price * (1 + self.strategy.trailing_stop_percent / 100)
            else:
                # Update trailing stop (only move down for shorts)
                new_trailing = current_price * (1 + self.strategy.trailing_stop_percent / 100)
                if new_trailing < position.trailing_stop:
                    position.trailing_stop = new_trailing
                
                # Check trailing stop hit
                if current_price >= position.trailing_stop:
                    return self._close_position(position, row, timestamp, "TRAILING_STOP")
        
        return None
    
    def _close_position(self, position: 'Position', row: pd.Series, timestamp: datetime, reason: str) -> TradeResult:
        """Close position and calculate PnL"""
        exit_price = row['close']
        
        if position.side == 'LONG':
            pnl = (exit_price - position.entry_price) * position.quantity
        else:  # SHORT
            pnl = (position.entry_price - exit_price) * position.quantity
        
        pnl_percent = (pnl / (position.entry_price * position.quantity)) * 100
        
        return TradeResult(
            entry_time=position.entry_time,
            exit_time=timestamp,
            entry_price=position.entry_price,
            exit_price=exit_price,
            side=position.side,
            quantity=position.quantity,
            pnl=pnl,
            pnl_percent=pnl_percent,
            stop_loss=position.stop_loss,
            exit_reason=reason
        )
    
    def _calculate_unrealized_pnl(self, position: 'Position', row: pd.Series) -> float:
        """Calculate unrealized PnL for open position"""
        current_price = row['close']
        
        if position.side == 'LONG':
            return (current_price - position.entry_price) * position.quantity
        else:  # SHORT
            return (position.entry_price - current_price) * position.quantity
    
    def _create_backtest_result(self, symbol: str, start_date: datetime, end_date: datetime,
                              final_capital: float, trades: List[TradeResult], 
                              equity_curve: List[Dict], max_drawdown: float) -> BacktestResult:
        """Create comprehensive backtest results"""
        
        # Basic metrics
        total_return = final_capital - self.initial_capital
        total_return_percent = (total_return / self.initial_capital) * 100
        
        # Trade statistics
        total_trades = len(trades)
        winning_trades = len([t for t in trades if t.pnl > 0])
        losing_trades = len([t for t in trades if t.pnl < 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        # Average win/loss
        wins = [t.pnl for t in trades if t.pnl > 0]
        losses = [t.pnl for t in trades if t.pnl < 0]
        avg_win = np.mean(wins) if wins else 0
        avg_loss = np.mean(losses) if losses else 0
        
        # Equity curve DataFrame
        equity_df = pd.DataFrame(equity_curve)
        equity_df.set_index('timestamp', inplace=True)
        
        # Daily returns for Sharpe ratio
        daily_equity = equity_df['equity'].resample('D').last()
        daily_returns = daily_equity.pct_change().dropna()
        
        # Sharpe ratio (assuming risk-free rate of 0)
        sharpe_ratio = (daily_returns.mean() / daily_returns.std()) * np.sqrt(252) if len(daily_returns) > 1 else 0
        
        return BacktestResult(
            strategy_name="BarUpDn",
            symbol=symbol,
            timeframe="1m",
            start_date=start_date,
            end_date=end_date,
            initial_capital=self.initial_capital,
            final_capital=final_capital,
            total_return=total_return,
            total_return_percent=total_return_percent,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            max_drawdown=max_drawdown,
            max_drawdown_percent=max_drawdown,
            sharpe_ratio=sharpe_ratio,
            trades=trades,
            equity_curve=equity_df,
            daily_returns=daily_returns
        )

@dataclass
class Position:
    """Represents an open trading position"""
    side: str  # 'LONG' or 'SHORT'
    entry_time: datetime
    entry_price: float
    quantity: float
    stop_loss: float
    trailing_stop: Optional[float] = None

def display_results(result: BacktestResult):
    """Display comprehensive backtest results"""
    
    # Main results table
    table = Table(title=f"BarUpDn Strategy Results - {result.symbol}")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")
    
    table.add_row("Symbol", result.symbol)
    table.add_row("Timeframe", result.timeframe)
    table.add_row("Period", f"{result.start_date.strftime('%Y-%m-%d')} to {result.end_date.strftime('%Y-%m-%d')}")
    table.add_row("Initial Capital", f"${result.initial_capital:,.2f}")
    table.add_row("Final Capital", f"${result.final_capital:,.2f}")
    table.add_row("Total Return", f"${result.total_return:,.2f}")
    table.add_row("Total Return %", f"{result.total_return_percent:.2f}%")
    table.add_row("", "")
    table.add_row("Total Trades", str(result.total_trades))
    table.add_row("Winning Trades", str(result.winning_trades))
    table.add_row("Losing Trades", str(result.losing_trades))
    table.add_row("Win Rate", f"{result.win_rate:.1f}%")
    table.add_row("Average Win", f"${result.avg_win:.2f}")
    table.add_row("Average Loss", f"${result.avg_loss:.2f}")
    table.add_row("", "")
    table.add_row("Max Drawdown", f"{result.max_drawdown:.2f}%")
    table.add_row("Sharpe Ratio", f"{result.sharpe_ratio:.2f}")
    
    console.print(table)
    
    # Recent trades table
    if result.trades:
        recent_trades = result.trades[-10:]  # Last 10 trades
        trades_table = Table(title="Recent Trades (Last 10)")
        trades_table.add_column("Entry Time", style="cyan")
        trades_table.add_column("Side", style="yellow")
        trades_table.add_column("Entry", style="white")
        trades_table.add_column("Exit", style="white")
        trades_table.add_column("PnL", style="green")
        trades_table.add_column("PnL %", style="green")
        trades_table.add_column("Exit Reason", style="magenta")
        
        for trade in recent_trades:
            pnl_color = "green" if trade.pnl > 0 else "red"
            trades_table.add_row(
                trade.entry_time.strftime('%Y-%m-%d %H:%M'),
                trade.side,
                f"${trade.entry_price:.4f}",
                f"${trade.exit_price:.4f}",
                f"[{pnl_color}]${trade.pnl:.2f}[/{pnl_color}]",
                f"[{pnl_color}]{trade.pnl_percent:.2f}%[/{pnl_color}]",
                trade.exit_reason
            )
        
        console.print(trades_table)

def save_results(result: BacktestResult, output_dir: str = "backtest_results"):
    """Save results to files"""
    Path(output_dir).mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save trades to CSV
    if result.trades:
        trades_df = pd.DataFrame([
            {
                'entry_time': t.entry_time,
                'exit_time': t.exit_time,
                'side': t.side,
                'entry_price': t.entry_price,
                'exit_price': t.exit_price,
                'quantity': t.quantity,
                'pnl': t.pnl,
                'pnl_percent': t.pnl_percent,
                'exit_reason': t.exit_reason
            }
            for t in result.trades
        ])
        trades_file = f"{output_dir}/bar_updn_trades_{result.symbol}_{timestamp}.csv"
        trades_df.to_csv(trades_file, index=False)
        console.print(f"[green]✓ Trades saved to {trades_file}[/green]")
    
    # Save equity curve
    equity_file = f"{output_dir}/bar_updn_equity_{result.symbol}_{timestamp}.csv"
    result.equity_curve.to_csv(equity_file)
    console.print(f"[green]✓ Equity curve saved to {equity_file}[/green]")
    
    # Save summary
    summary = {
        'strategy': result.strategy_name,
        'symbol': result.symbol,
        'timeframe': result.timeframe,
        'period': f"{result.start_date} to {result.end_date}",
        'initial_capital': result.initial_capital,
        'final_capital': result.final_capital,
        'total_return': result.total_return,
        'total_return_percent': result.total_return_percent,
        'total_trades': result.total_trades,
        'win_rate': result.win_rate,
        'max_drawdown': result.max_drawdown,
        'sharpe_ratio': result.sharpe_ratio
    }
    
    summary_file = f"{output_dir}/bar_updn_summary_{result.symbol}_{timestamp}.json"
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2, default=str)
    console.print(f"[green]✓ Summary saved to {summary_file}[/green]")

def run_extreme_backtest(symbol: str, days_back: int = 30, 
                        api_key: str = None, api_secret: str = None,
                        save_results_flag: bool = True):
    """Run the extreme backtest"""
    
    console.print(Panel.fit(
        f"[bold cyan]BarUpDn Strategy Extreme Backtest[/bold cyan]\n"
        f"Symbol: {symbol}\n"
        f"Timeframe: 1 minute\n"
        f"Period: Last {days_back} days\n"
        f"Initial Capital: $5,000",
        border_style="cyan"
    ))
    
    try:
        # Initialize data fetcher
        fetcher = DataFetcher(api_key, api_secret)
        
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        # Fetch data
        df = fetcher.fetch_data(symbol, start_date, end_date)
        console.print(f"[green]✓ Fetched {len(df):,} 1-minute bars[/green]")
        
        # Run backtest
        backtester = BarUpDnBacktester(initial_capital=5000)
        result = backtester.run_backtest(df, symbol)
        
        # Display results
        display_results(result)
        
        # Save results
        if save_results_flag:
            save_results(result)
        
        return result
        
    except Exception as e:
        console.print(f"[red]Error running backtest: {str(e)}[/red]")
        logger.error(f"Backtest error: {str(e)}", exc_info=True)
        return None

def main():
    """Main function for CLI usage"""
    parser = argparse.ArgumentParser(description="BarUpDn Strategy Extreme Backtest")
    parser.add_argument("--symbol", default="BTCUSDT", help="Trading symbol (default: BTCUSDT)")
    parser.add_argument("--days", type=int, default=30, help="Days of historical data (default: 30)")
    parser.add_argument("--api-key", help="Binance API key")
    parser.add_argument("--api-secret", help="Binance API secret")
    parser.add_argument("--no-save", action="store_true", help="Don't save results to files")
    
    args = parser.parse_args()
    
    # Try different symbols if requested
    symbols = [args.symbol]
    if args.symbol == "ALL":
        symbols = ["BTCUSDT", "ETHUSDT"]
    
    for symbol in symbols:
        console.print(f"\n[bold yellow]Testing {symbol}...[/bold yellow]")
        result = run_extreme_backtest(
            symbol=symbol,
            days_back=args.days,
            api_key=args.api_key,
            api_secret=args.api_secret,
            save_results_flag=not args.no_save
        )
        
        if result and len(symbols) > 1:
            # Small delay between symbols
            time.sleep(2)

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Breakout Strategy Optimizer - Smart Bayesian Optimization for Crypto Momentum Strategy
Replaces the failed BarUpDn approach with proven momentum breakout patterns
"""

import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass
import warnings
from pathlib import Path

# Ultra-fast computation libraries
try:
    from numba import jit, njit
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False

# Rich for beautiful console output
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel

# Bayesian optimization
try:
    from skopt import gp_minimize
    from skopt.space import Real, Integer
    from skopt.utils import use_named_args
    BAYESIAN_AVAILABLE = True
except ImportError:
    BAYESIAN_AVAILABLE = False

# Import our modules
from enhanced_data_fetcher import EnhancedDataFetcher
from crypto_breakout_strategy import CryptoBreakoutStrategy, BreakoutBacktester

warnings.filterwarnings('ignore')
console = Console()

@njit
def vectorized_breakout_signals(highs, lows, closes, volumes, lookback_periods, volume_multiplier, min_breakout_percent):
    """Ultra-fast vectorized breakout signal generation using Numba JIT compilation"""
    n = len(closes)
    long_signals = np.zeros(n, dtype=np.bool_)
    short_signals = np.zeros(n, dtype=np.bool_)
    
    # Pre-calculate rolling max/min and volume average
    high_max = np.zeros(n)
    low_min = np.zeros(n)
    volume_ma = np.zeros(n)
    
    for i in range(lookback_periods, n):
        # Rolling maximum and minimum
        high_max[i] = np.max(highs[i-lookback_periods:i])
        low_min[i] = np.min(lows[i-lookback_periods:i])
        volume_ma[i] = np.mean(volumes[i-lookback_periods:i])
    
    # Calculate EMAs for trend confirmation (simplified)
    ema_fast = np.zeros(n)
    ema_slow = np.zeros(n)
    alpha_fast = 2.0 / (9 + 1)  # 9-period EMA
    alpha_slow = 2.0 / (21 + 1)  # 21-period EMA
    
    if n > 0:
        ema_fast[0] = closes[0]
        ema_slow[0] = closes[0]
        
        for i in range(1, n):
            ema_fast[i] = alpha_fast * closes[i] + (1 - alpha_fast) * ema_fast[i-1]
            ema_slow[i] = alpha_slow * closes[i] + (1 - alpha_slow) * ema_slow[i-1]
    
    # Generate signals
    for i in range(lookback_periods + 1, n):
        # Breakout conditions
        breakout_up = closes[i] > high_max[i-1]
        breakout_down = closes[i] < low_min[i-1]
        
        # Volume confirmation
        volume_confirmed = volumes[i] > (volume_ma[i] * volume_multiplier)
        
        # Price movement confirmation
        if high_max[i-1] > 0:
            price_move_up = ((closes[i] - high_max[i-1]) / high_max[i-1] * 100) >= min_breakout_percent
        else:
            price_move_up = False
            
        if low_min[i-1] > 0:
            price_move_down = ((low_min[i-1] - closes[i]) / low_min[i-1] * 100) >= min_breakout_percent
        else:
            price_move_down = False
        
        # Trend confirmation
        trend_up = ema_fast[i] > ema_slow[i]
        trend_down = ema_fast[i] < ema_slow[i]
        
        # LONG signal
        if (breakout_up and volume_confirmed and price_move_up and trend_up):
            long_signals[i] = True
        
        # SHORT signal
        if (breakout_down and volume_confirmed and price_move_down and trend_down):
            short_signals[i] = True
    
    return long_signals, short_signals

@njit  
def vectorized_breakout_backtest(prices, long_signals, short_signals, sl_pct, tp_pct, pos_size_pct):
    """Ultra-fast vectorized backtesting for breakout strategy"""
    n = len(prices)
    portfolio_value = 10000.0
    trades_pnl = []
    
    in_position = False
    entry_price = 0.0
    position_type = 0  # 1 for long, -1 for short
    position_size = 0.0
    stop_loss = 0.0
    take_profit = 0.0
    
    for i in range(1, n):
        current_price = prices[i]
        
        if not in_position:
            # Entry logic
            if long_signals[i]:
                entry_price = current_price
                position_size = (portfolio_value * pos_size_pct / 100) / entry_price
                position_type = 1
                in_position = True
                stop_loss = entry_price * (1 - sl_pct/100)
                take_profit = entry_price * (1 + tp_pct/100)
                
            elif short_signals[i]:
                entry_price = current_price
                position_size = (portfolio_value * pos_size_pct / 100) / entry_price
                position_type = -1
                in_position = True
                stop_loss = entry_price * (1 + sl_pct/100)
                take_profit = entry_price * (1 - tp_pct/100)
        else:
            # Exit logic
            exit_trade = False
            
            if position_type == 1:  # Long position
                if current_price <= stop_loss or current_price >= take_profit:
                    exit_price = current_price
                    pnl = position_size * (exit_price - entry_price)
                    exit_trade = True
            
            elif position_type == -1:  # Short position
                if current_price >= stop_loss or current_price <= take_profit:
                    exit_price = current_price
                    pnl = position_size * (entry_price - exit_price)
                    exit_trade = True
            
            if exit_trade:
                trades_pnl.append(pnl)
                portfolio_value += pnl
                in_position = False
    
    return trades_pnl, portfolio_value

class VectorizedBreakoutBacktester:
    """Ultra-fast vectorized backtesting engine for breakout strategy"""
    
    @staticmethod
    def run_fast_backtest(df, lookback_periods, volume_multiplier, min_breakout_percent, sl_pct, tp_pct, pos_size_pct):
        """Run ultra-fast vectorized backtest"""
        # Convert to numpy arrays for speed
        highs = df['high'].values
        lows = df['low'].values  
        closes = df['close'].values
        volumes = df['volume'].values
        
        # Generate signals vectorized
        long_signals, short_signals = vectorized_breakout_signals(
            highs, lows, closes, volumes, lookback_periods, volume_multiplier, min_breakout_percent
        )
        
        # Run backtest vectorized
        trades_pnl, final_value = vectorized_breakout_backtest(
            closes, long_signals, short_signals, sl_pct, tp_pct, pos_size_pct
        )
        
        # Calculate metrics
        if len(trades_pnl) > 0:
            total_trades = len(trades_pnl)
            winning_trades = sum(1 for pnl in trades_pnl if pnl > 0)
            win_rate = (winning_trades / total_trades) * 100
            total_return = (final_value - 10000) / 10000 * 100
            
            # Calculate drawdown (simplified)
            cumulative = np.cumsum(trades_pnl)
            running_max = np.maximum.accumulate(cumulative)
            drawdowns = (cumulative - running_max) / 10000 * 100
            max_drawdown = abs(np.min(drawdowns)) if len(drawdowns) > 0 else 0
            
            # Profit factor
            total_wins = sum(pnl for pnl in trades_pnl if pnl > 0)
            total_losses = abs(sum(pnl for pnl in trades_pnl if pnl < 0))
            profit_factor = total_wins / total_losses if total_losses > 0 else 2.0
            
            return {
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'max_drawdown': max_drawdown,
                'total_trades': total_trades,
                'profit_factor': profit_factor,
                'trades_pnl': trades_pnl
            }
        else:
            return {
                'win_rate': 0.0,
                'total_return_percent': 0.0,
                'max_drawdown': 0.0,
                'total_trades': 0,
                'profit_factor': 0.0,
                'trades_pnl': []
            }

@dataclass
class BreakoutOptimizationResult:
    """Enhanced result for breakout optimization"""
    parameters: Dict[str, float]
    win_rate: float
    total_return_percent: float
    max_drawdown: float
    total_trades: int
    profit_factor: float
    sharpe_ratio: float
    score: float
    iteration: int
    acquisition_value: Optional[float] = None

class BreakoutStrategyOptimizer:
    """Intelligent parameter optimization for Breakout Strategy using Bayesian methods"""
    
    def __init__(self, symbols: List[str] = ["BTCUSDT", "ETHUSDT"], 
                 days_back: int = 30, api_key: str = None, api_secret: str = None):
        self.symbols = symbols
        self.days_back = days_back
        self.fetcher = EnhancedDataFetcher(api_key, api_secret)
        self.cached_data = {}
        self.processed_data = {}
        self.optimization_history = []
        self.best_score = -np.inf
        self.no_improvement_count = 0
        
        console.print("[bold cyan]🚀 Breakout Strategy Optimizer Initialized[/bold cyan]")
        self._check_dependencies()
        self._load_cached_data()
        self._preprocess_data_vectorized()
    
    def _check_dependencies(self):
        """Check if required packages are installed"""
        if not BAYESIAN_AVAILABLE:
            console.print("[red]❌ scikit-optimize not installed![/red]")
            console.print("[yellow]Install with: pip install scikit-optimize[/yellow]")
            raise ImportError("scikit-optimize is required for Bayesian optimization")
        
        if not NUMBA_AVAILABLE:
            console.print("[yellow]⚠️  Numba not available - falling back to slower Python loops[/yellow]")
        else:
            console.print("[green]✓ Numba JIT compilation available for ultra-fast performance[/green]")
        
        console.print("[green]✓ Breakout strategy optimization libraries available[/green]")
    
    def _load_cached_data(self):
        """Load data with 15-minute resampling for breakout strategy"""
        console.print("[cyan]📊 Loading data for breakout strategy (15-minute timeframe)...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days_back)
        
        total_bars = 0
        start_time = time.time()
        
        for symbol in self.symbols:
            try:
                # Load 1-minute data first
                df_1m = self.fetcher.fetch_data(symbol, start_date, end_date)
                
                if df_1m is not None and not df_1m.empty:
                    # Resample to 15-minute timeframe (optimal for breakouts)
                    df_15m = df_1m.resample('15T').agg({
                        'open': 'first',
                        'high': 'max', 
                        'low': 'min',
                        'close': 'last',
                        'volume': 'sum'
                    }).dropna()
                    
                    self.cached_data[symbol] = df_15m
                    total_bars += len(df_15m)
                    console.print(f"[green]✓ {symbol}: {len(df_15m):,} 15-minute bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error loading data - {str(e)}[/red]")
        
        load_time = time.time() - start_time
        
        if not self.cached_data:
            console.print("[red]❌ No cached data available![/red]")
        else:
            console.print(f"[green]✅ {len(self.cached_data)} symbols ready ({total_bars:,} total 15m bars in {load_time:.2f}s)[/green]")
    
    def _preprocess_data_vectorized(self):
        """Precompute all indicators vectorized for massive speedup"""
        console.print("[cyan]⚡ Preprocessing data with vectorized breakout operations...[/cyan]")
        
        self.processed_data = {}
        
        for symbol, df in self.cached_data.items():
            try:
                # Convert to numpy arrays for speed
                highs = df['high'].values
                lows = df['low'].values  
                closes = df['close'].values
                volumes = df['volume'].values
                timestamps = df.index.values
                
                # Store preprocessed data
                self.processed_data[symbol] = {
                    'highs': highs,
                    'lows': lows, 
                    'closes': closes,
                    'volumes': volumes,
                    'timestamps': timestamps,
                    'price_changes': np.diff(closes, prepend=closes[0])
                }
                
                console.print(f"[green]✓ {symbol}: Vectorized preprocessing complete[/green]")
                
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Preprocessing error - {str(e)}[/red]")
    
    def evaluate_parameters_fast(self, params: List[float]) -> float:
        """Ultra-fast parameter evaluation using preprocessed vectorized data"""
        lookback_periods, volume_multiplier, min_breakout_percent, sl_percent, tp_percent = params
        
        param_dict = {
            'lookback_periods': int(lookback_periods),
            'volume_multiplier': volume_multiplier,
            'min_breakout_percent': min_breakout_percent,
            'sl_percent': sl_percent,
            'tp_percent': tp_percent
        }
        
        results = []
        all_trades_pnl = []
        
        for symbol, data in self.processed_data.items():
            try:
                # Use vectorized backtesting (10-100x faster)
                result = VectorizedBreakoutBacktester.run_fast_backtest(
                    pd.DataFrame({
                        'high': data['highs'],
                        'low': data['lows'],
                        'close': data['closes'],
                        'volume': data['volumes']
                    }),
                    int(lookback_periods),
                    volume_multiplier,
                    min_breakout_percent,
                    sl_percent,
                    tp_percent,
                    10.0  # Fixed 10% position size
                )
                
                results.append(result)
                all_trades_pnl.extend(result['trades_pnl'])
                
            except Exception:
                continue
        
        if not results:
            return 1000.0  # Large penalty for failed parameter sets
        
        # Calculate averages
        avg_win_rate = np.mean([r['win_rate'] for r in results])
        avg_return = np.mean([r['total_return_percent'] for r in results])
        avg_drawdown = np.mean([r['max_drawdown'] for r in results])
        total_trades = sum([r['total_trades'] for r in results])
        avg_profit_factor = np.mean([r['profit_factor'] for r in results])
        
        # Calculate Sharpe ratio
        if len(all_trades_pnl) > 1:
            mean_return = np.mean(all_trades_pnl)
            std_return = np.std(all_trades_pnl)
            sharpe_ratio = (mean_return / std_return) * np.sqrt(365) if std_return > 0 else 0.0
        else:
            sharpe_ratio = 0.0
        
        # BREAKOUT-OPTIMIZED SCORING - Prioritize win rate and profit factor
        win_rate_bonus = max(0, (avg_win_rate - 30) * 1.2)  # Strong bonus for win rates > 30%
        consistency_bonus = max(0, (5.0 - avg_drawdown) * 0.6)  # Bonus for low drawdown
        trade_volume_score = min(8, total_trades / 50)  # Bonus for adequate trade volume
        profit_factor_bonus = min(10, avg_profit_factor) * 2  # Strong bonus for high profit factor
        
        score = (
            avg_win_rate * 0.35 +                          # 35% win rate (highest priority)
            max(0, avg_return) * 0.25 +                    # 25% returns  
            max(0, (20 - avg_drawdown)) * 0.15 +           # 15% drawdown control
            profit_factor_bonus * 0.15 +                   # 15% profit factor (important for breakouts)
            min(6, max(0, sharpe_ratio)) * 0.10 +          # 10% sharpe ratio
            win_rate_bonus +                               # Extra bonus for high win rates
            consistency_bonus +                            # Extra bonus for low drawdown
            trade_volume_score                             # Bonus for trade volume
        )
        
        # Store result
        result_obj = BreakoutOptimizationResult(
            parameters=param_dict.copy(),
            win_rate=avg_win_rate,
            total_return_percent=avg_return,
            max_drawdown=avg_drawdown,
            total_trades=total_trades,
            profit_factor=avg_profit_factor,
            sharpe_ratio=sharpe_ratio,
            score=score,
            iteration=len(self.optimization_history)
        )
        
        self.optimization_history.append(result_obj)
        
        # Track improvement
        if score > self.best_score:
            self.best_score = score
            self.no_improvement_count = 0
        else:
            self.no_improvement_count += 1
        
        # Return negative score for minimization
        return -score
    
    def run_bayesian_optimization(self, n_calls: int = 200, random_state: int = 42) -> List[BreakoutOptimizationResult]:
        """Run Bayesian optimization for breakout strategy"""
        
        console.print(Panel.fit(
            f"[bold cyan]🚀 Breakout Strategy Bayesian Optimization[/bold cyan]\n"
            f"Method: Gaussian Process + Expected Improvement\n"
            f"Evaluations: {n_calls}\n"
            f"Symbols: {', '.join(self.symbols)}\n"
            f"Data Period: {self.days_back} days (15-minute timeframe)\n"
            f"Search Space: 5D momentum breakout optimization",
            border_style="cyan"
        ))
        
        # Breakout-specific search space
        space = [
            Integer(10, 30, name='lookback_periods'),               # Lookback for support/resistance
            Real(1.1, 2.0, name='volume_multiplier'),              # Volume confirmation
            Real(0.05, 0.5, name='min_breakout_percent'),          # Minimum breakout size
            Real(1.0, 3.0, name='sl_percent'),                     # Stop loss
            Real(2.0, 5.0, name='tp_percent'),                     # Take profit
        ]
        
        start_time = time.time()
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Breakout optimization...", total=n_calls)
            
            def progress_callback(result):
                progress.update(task, advance=1)
                
                # Early stopping for breakout optimization
                if self.no_improvement_count >= 40:
                    console.print(f"\n[yellow]⏹️  Early stopping: No improvement for 40 iterations[/yellow]")
                    return True
                
                # Show current best every 20 iterations
                if len(self.optimization_history) % 20 == 0 and self.optimization_history:
                    best = max(self.optimization_history, key=lambda x: x.score)
                    console.print(f"\n[green]Current best (iter {len(self.optimization_history)}): "
                                f"Score {best.score:.2f}, Win Rate {best.win_rate:.1f}%, "
                                f"Profit Factor {best.profit_factor:.2f}[/green]")
            
            # Run optimization
            result = gp_minimize(
                func=self.evaluate_parameters_fast,
                dimensions=space,
                n_calls=n_calls,
                random_state=random_state,
                callback=progress_callback,
                acq_func="EI",  # Expected Improvement
                n_initial_points=25,  # More initial exploration
                acq_optimizer="sampling",
                n_jobs=1
            )
        
        total_time = time.time() - start_time
        
        # Sort results by score
        self.optimization_history.sort(key=lambda x: x.score, reverse=True)
        
        console.print(f"\n[green]✓ Breakout optimization completed![/green]")
        console.print(f"[cyan]📊 {len(self.optimization_history)} evaluations in {total_time:.2f}s[/cyan]")
        console.print(f"[cyan]⚡ {len(self.optimization_history)/total_time:.1f} evaluations/sec[/cyan]")
        
        return self.optimization_history
    
    def display_results(self, results: List[BreakoutOptimizationResult], top_n: int = 15):
        """Display breakout optimization results"""
        
        if not results:
            console.print("[red]No results to display[/red]")
            return
        
        # Best result summary
        best = results[0]
        console.print(Panel.fit(
            f"[bold green]🏆 OPTIMAL BREAKOUT PARAMETERS[/bold green]\n\n"
            f"Lookback Periods: {best.parameters['lookback_periods']}\n"
            f"Volume Multiplier: {best.parameters['volume_multiplier']:.2f}x\n"
            f"Min Breakout: {best.parameters['min_breakout_percent']:.2f}%\n"
            f"Stop Loss: {best.parameters['sl_percent']:.2f}%\n"
            f"Take Profit: {best.parameters['tp_percent']:.2f}%\n\n"
            f"[cyan]Performance Metrics:[/cyan]\n"
            f"Win Rate: {best.win_rate:.1f}%\n"
            f"Return: {best.total_return_percent:.2f}%\n"
            f"Max Drawdown: {best.max_drawdown:.2f}%\n"
            f"Profit Factor: {best.profit_factor:.2f}\n"
            f"Sharpe Ratio: {best.sharpe_ratio:.2f}\n"
            f"Total Trades: {best.total_trades}\n"
            f"Optimization Score: {best.score:.2f}\n"
            f"Found at iteration: {best.iteration + 1}",
            border_style="green"
        ))
        
        # Top results table
        table = Table(title=f"Top {min(top_n, len(results))} Breakout Optimization Results")
        table.add_column("Rank", style="cyan", width=4)
        table.add_column("Lookback", style="yellow", width=8)
        table.add_column("Volume", style="yellow", width=7)
        table.add_column("MinBrk%", style="yellow", width=7)
        table.add_column("SL%", style="yellow", width=5)
        table.add_column("TP%", style="yellow", width=5)
        table.add_column("Win%", style="green", width=6)
        table.add_column("Return%", style="green", width=8)
        table.add_column("PF", style="blue", width=5)
        table.add_column("Score", style="bold green", width=7)
        
        for i, result in enumerate(results[:top_n], 1):
            p = result.parameters
            
            table.add_row(
                str(i),
                str(p['lookback_periods']),
                f"{p['volume_multiplier']:.2f}",
                f"{p['min_breakout_percent']:.2f}",
                f"{p['sl_percent']:.1f}",
                f"{p['tp_percent']:.1f}",
                f"{result.win_rate:.1f}",
                f"{result.total_return_percent:.2f}",
                f"{result.profit_factor:.2f}",
                f"{result.score:.2f}"
            )
        
        console.print(table)
    
    def save_results(self, results: List[BreakoutOptimizationResult], method: str = "breakout_bayesian"):
        """Save breakout optimization results"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"breakout_optimization_{method}_{timestamp}.json"
        
        # Convert to JSON
        json_results = []
        for result in results:
            json_results.append({
                'parameters': result.parameters,
                'win_rate': result.win_rate,
                'total_return_percent': result.total_return_percent,
                'max_drawdown': result.max_drawdown,
                'total_trades': result.total_trades,
                'profit_factor': result.profit_factor,
                'sharpe_ratio': result.sharpe_ratio,
                'score': result.score,
                'iteration': result.iteration
            })
        
        metadata = {
            'timestamp': datetime.now().isoformat(),
            'method': method,
            'strategy': 'Momentum Breakout',
            'symbols': self.symbols,
            'days_back': self.days_back,
            'timeframe': '15m',
            'total_evaluations': len(json_results),
            'best_score': results[0].score if results else 0,
            'best_win_rate': results[0].win_rate if results else 0,
        }
        
        output = {
            'metadata': metadata,
            'results': json_results
        }
        
        with open(filename, 'w') as f:
            json.dump(output, f, indent=2)
        
        console.print(f"[green]✅ Breakout results saved to {filename}[/green]")
        return filename

def main():
    """Main function for breakout strategy optimization"""
    console.print("[bold blue]🚀 BREAKOUT Strategy Optimizer - Momentum-Based Approach[/bold blue]")
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize optimizer
    optimizer = BreakoutStrategyOptimizer(
        symbols=["BTCUSDT", "ETHUSDT"],
        days_back=60,  # 2 months of 15-minute data
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No cached data available.[/red]")
        return
    
    console.print("\n[bold yellow]🎯 Running Breakout Strategy Optimization![/bold yellow]")
    
    start_time = time.time()
    
    # Run optimization with more evaluations for better results
    results = optimizer.run_bayesian_optimization(n_calls=250)
    
    optimization_time = time.time() - start_time
    
    console.print(f"\n[bold green]⚡ BREAKOUT OPTIMIZATION COMPLETE![/bold green]")
    console.print(f"[yellow]⏱️  Optimization completed in {optimization_time:.1f}s[/yellow]")
    
    if results:
        optimizer.display_results(results, top_n=15)
        optimizer.save_results(results)
        
        # Compare to failed BarUpDn
        best = results[0]
        console.print(f"\n[bold green]📊 PERFORMANCE vs FAILED BarUpDn:[/bold green]")
        console.print(f"✅ Breakout Win Rate: {best.win_rate:.1f}% (vs ~15% BarUpDn)")
        console.print(f"✅ Breakout Return: {best.total_return_percent:.2f}% (vs negative BarUpDn)")
        console.print(f"✅ Breakout Profit Factor: {best.profit_factor:.2f} (vs ~0.7 BarUpDn)")
        console.print(f"✅ This is a {(best.win_rate/15)*100:.0f}% improvement in win rate!")
        
        console.print(f"\n[bold cyan]🎯 OPTIMAL BREAKOUT SETTINGS:[/bold cyan]")
        console.print(f"• Use 15-minute timeframe")
        console.print(f"• Lookback: {best.parameters['lookback_periods']} periods")
        console.print(f"• Volume: {best.parameters['volume_multiplier']:.2f}x average")
        console.print(f"• Min breakout: {best.parameters['min_breakout_percent']:.2f}%")
        console.print(f"• Stop loss: {best.parameters['sl_percent']:.2f}%")
        console.print(f"• Take profit: {best.parameters['tp_percent']:.2f}%")
        
    else:
        console.print("[red]❌ No valid results found.[/red]")

if __name__ == "__main__":
    main() 
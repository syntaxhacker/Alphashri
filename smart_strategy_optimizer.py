#!/usr/bin/env python3
"""
Smart Strategy Optimizer - Using Bayesian Optimization for intelligent parameter search
Much faster and more effective than grid search
Ultra-Fast Version with Vectorized Operations and Parallel Processing
"""

import json
import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass
import warnings
from pathlib import Path
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor, as_completed

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
from rich.layout import Layout

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
from bar_updn_extreme_backtest import BarUpDnStrategy, BarUpDnBacktester, BacktestResult

warnings.filterwarnings('ignore')
console = Console()

@njit
def vectorized_bar_updn_signals(highs, lows, closes, volumes):
    """Ultra-fast vectorized signal generation using Numba JIT compilation"""
    n = len(closes)
    long_signals = np.zeros(n, dtype=np.bool_)
    short_signals = np.zeros(n, dtype=np.bool_)
    
    for i in range(1, n):
        # BarUpDn logic vectorized
        prev_close = closes[i-1]
        curr_high = highs[i]
        curr_low = lows[i]
        curr_volume = volumes[i]
        
        # Long signal: current bar high > previous close
        if curr_high > prev_close and curr_volume > 1000:
            long_signals[i] = True
        
        # Short signal: current bar low < previous close  
        if curr_low < prev_close and curr_volume > 1000:
            short_signals[i] = True
            
    return long_signals, short_signals

@njit
def vectorized_backtest_core(prices, long_signals, short_signals, 
                            sl_pct, trail_pct, pos_size_pct, max_loss_dollars=8.0):
    """Ultra-fast vectorized backtesting core using Numba JIT compilation"""
    n = len(prices)
    portfolio_value = 10000.0
    trades_pnl = []
    
    in_position = False
    entry_price = 0.0
    position_type = 0  # 1 for long, -1 for short
    position_size = 0.0
    highest_price_since_entry = 0.0
    lowest_price_since_entry = 0.0
    
    for i in range(1, n):
        current_price = prices[i]
        
        if not in_position:
            # Entry logic
            if long_signals[i]:
                entry_price = current_price
                position_size = min((portfolio_value * pos_size_pct / 100) / entry_price, 
                                  max_loss_dollars / (entry_price * sl_pct / 100))
                position_type = 1
                in_position = True
                highest_price_since_entry = current_price
            elif short_signals[i]:
                entry_price = current_price
                position_size = min((portfolio_value * pos_size_pct / 100) / entry_price,
                                  max_loss_dollars / (entry_price * sl_pct / 100))
                position_type = -1
                in_position = True
                lowest_price_since_entry = current_price
        else:
            # Update tracking prices
            if position_type == 1:  # Long position
                if current_price > highest_price_since_entry:
                    highest_price_since_entry = current_price
                
                # Stop loss or trailing stop exit
                stop_loss = entry_price * (1 - sl_pct/100)
                trailing_stop = highest_price_since_entry * (1 - trail_pct/100)
                
                if current_price <= max(stop_loss, trailing_stop):
                    # Exit long
                    exit_price = max(stop_loss, trailing_stop)
                    pnl = position_size * (exit_price - entry_price)
                    trades_pnl.append(pnl)
                    portfolio_value += pnl
                    in_position = False
                    
            elif position_type == -1:  # Short position
                if current_price < lowest_price_since_entry:
                    lowest_price_since_entry = current_price
                
                # Stop loss or trailing stop exit
                stop_loss = entry_price * (1 + sl_pct/100)
                trailing_stop = lowest_price_since_entry * (1 + trail_pct/100)
                
                if current_price >= min(stop_loss, trailing_stop):
                    # Exit short
                    exit_price = min(stop_loss, trailing_stop)
                    pnl = position_size * (entry_price - exit_price)
                    trades_pnl.append(pnl)
                    portfolio_value += pnl
                    in_position = False
                    
    return trades_pnl, portfolio_value

class VectorizedBacktester:
    """Ultra-fast vectorized backtesting engine"""
    
    @staticmethod
    def run_fast_backtest(df, sl_pct, trail_pct, pos_size_pct, max_loss_dollars=8.0):
        """Run ultra-fast vectorized backtest"""
        # Convert to numpy arrays for speed
        highs = df['high'].values
        lows = df['low'].values  
        closes = df['close'].values
        volumes = df['volume'].values
        
        # Generate signals vectorized
        long_signals, short_signals = vectorized_bar_updn_signals(highs, lows, closes, volumes)
        
        # Run backtest vectorized
        trades_pnl, final_value = vectorized_backtest_core(
            closes, long_signals, short_signals, sl_pct, trail_pct, pos_size_pct, max_loss_dollars
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
class OptimizationResult:
    """Enhanced result for smart optimization"""
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

class SmartStrategyOptimizer:
    """Intelligent parameter optimization using Bayesian methods"""
    
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
        
        console.print("[bold cyan]🧠 Smart Strategy Optimizer Initialized[/bold cyan]")
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
            console.print("[yellow]Install with: pip install numba[/yellow]")
        else:
            console.print("[green]✓ Numba JIT compilation available for ultra-fast performance[/green]")
        
        console.print("[green]✓ Bayesian optimization libraries available[/green]")
    
    def _load_cached_data(self):
        """Load data with smart sampling for speed"""
        console.print("[cyan]📊 Loading cached data with smart sampling...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days_back)
        
        total_bars = 0
        start_time = time.time()
        
        for symbol in self.symbols:
            try:
                # Load full data
                df = self.fetcher.fetch_data(symbol, start_date, end_date)
                
                if df is not None and not df.empty:
                    # Smart sampling: Take every 2nd or 3rd bar for 6-month data
                    if len(df) > 10000:  # If more than 10k bars
                        console.print(f"[yellow]⚡ {symbol}: Large dataset ({len(df)} bars), using smart sampling[/yellow]")
                        # Take every 2nd bar for speed (still representative)
                        df_sampled = df.iloc[::2].copy()
                        console.print(f"[cyan]📉 {symbol}: Sampled to {len(df_sampled)} bars (2x speedup)[/cyan]")
                        self.cached_data[symbol] = df_sampled
                    else:
                        self.cached_data[symbol] = df
                        
                    total_bars += len(self.cached_data[symbol])
                    console.print(f"[green]✓ {symbol}: {len(self.cached_data[symbol]):,} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error loading data - {str(e)}[/red]")
        
        load_time = time.time() - start_time
        
        if not self.cached_data:
            console.print("[red]❌ No cached data available![/red]")
        else:
            console.print(f"[green]✅ {len(self.cached_data)} symbols ready ({total_bars:,} total bars in {load_time:.2f}s)[/green]")
    
    def _preprocess_data_vectorized(self):
        """Precompute all indicators vectorized for massive speedup"""
        console.print("[cyan]⚡ Preprocessing data with vectorized operations...[/cyan]")
        
        self.processed_data = {}
        
        for symbol, df in self.cached_data.items():
            try:
                # Convert to numpy arrays for speed
                highs = df['high'].values
                lows = df['low'].values  
                closes = df['close'].values
                volumes = df['volume'].values
                timestamps = df.index.values
                
                # Precompute all possible signals vectorized
                if NUMBA_AVAILABLE:
                    long_signals, short_signals = vectorized_bar_updn_signals(highs, lows, closes, volumes)
                else:
                    # Fallback to regular Python
                    long_signals = np.zeros(len(closes), dtype=bool)
                    short_signals = np.zeros(len(closes), dtype=bool)
                    for i in range(1, len(closes)):
                        if highs[i] > closes[i-1] and volumes[i] > 1000:
                            long_signals[i] = True
                        if lows[i] < closes[i-1] and volumes[i] > 1000:
                            short_signals[i] = True
                
                # Store preprocessed data
                self.processed_data[symbol] = {
                    'highs': highs,
                    'lows': lows, 
                    'closes': closes,
                    'volumes': volumes,
                    'timestamps': timestamps,
                    'long_signals': long_signals,
                    'short_signals': short_signals,
                    'price_changes': np.diff(closes, prepend=closes[0])
                }
                
                console.print(f"[green]✓ {symbol}: Vectorized preprocessing complete[/green]")
                
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Preprocessing error - {str(e)}[/red]")
    
    def _calculate_sharpe_ratio(self, trades: List[Any]) -> float:
        """Calculate Sharpe ratio from trades"""
        if not trades or len(trades) < 2:
            return 0.0
        
        returns = [trade.pnl for trade in trades]
        if len(returns) < 2:
            return 0.0
        
        mean_return = np.mean(returns)
        std_return = np.std(returns)
        
        if std_return == 0:
            return 0.0
        
        # Annualized Sharpe ratio (assuming 365 trading days)
        return (mean_return / std_return) * np.sqrt(365)
    
    def evaluate_parameters_fast(self, params: List[float]) -> float:
        """Ultra-fast parameter evaluation using preprocessed vectorized data"""
        sl_percent, trailing_stop_percent, position_size_percent, max_intraday_loss_percent, min_hold_minutes = params
        
        param_dict = {
            'sl_percent': sl_percent,
            'trailing_stop_percent': trailing_stop_percent,
            'position_size_percent': position_size_percent,
            'max_intraday_loss_percent': max_intraday_loss_percent,
            'min_hold_minutes': int(min_hold_minutes)
        }
        
        results = []
        all_trades_pnl = []
        
        for symbol, data in self.processed_data.items():
            try:
                # Use vectorized backtesting (10-100x faster)
                result = VectorizedBacktester.run_fast_backtest(
                    pd.DataFrame({
                        'high': data['highs'],
                        'low': data['lows'],
                        'close': data['closes'],
                        'volume': data['volumes']
                    }),
                    sl_percent,
                    trailing_stop_percent, 
                    position_size_percent,
                    max_loss_dollars=8.0
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
        
        # ENHANCED SCORING - Win Rate Priority (fast method)
        win_rate_bonus = max(0, (avg_win_rate - 40) * 0.8)  # Strong bonus for win rates > 40%
        consistency_bonus = max(0, (3.0 - avg_drawdown) * 0.4)  # Bonus for low drawdown
        trade_volume_score = min(5, total_trades / 200)  # Bonus for adequate trade volume
        
        score = (
            avg_win_rate * 0.45 +                          # 45% win rate (highest priority)
            max(0, avg_return) * 0.20 +                    # 20% returns  
            max(0, (30 - avg_drawdown)) * 0.15 +           # 15% drawdown control
            min(8, avg_profit_factor) * 0.08 +             # 8% profit factor
            min(6, max(0, sharpe_ratio)) * 0.07 +          # 7% sharpe ratio
            win_rate_bonus +                               # Extra bonus for high win rates
            consistency_bonus +                            # Extra bonus for low drawdown
            trade_volume_score                             # Bonus for trade volume
        )
        
        # Store result
        result_obj = OptimizationResult(
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
    
    def evaluate_parameters(self, params: List[float]) -> float:
        """Standard parameter evaluation using original BarUpDnBacktester (slower but reliable)"""
        sl_percent, trailing_stop_percent, position_size_percent, max_intraday_loss_percent, min_hold_minutes = params
        
        param_dict = {
            'sl_percent': sl_percent,
            'trailing_stop_percent': trailing_stop_percent,
            'position_size_percent': position_size_percent,
            'max_intraday_loss_percent': max_intraday_loss_percent,
            'min_hold_minutes': int(min_hold_minutes)
        }
        
        results = []
        all_trades_pnl = []
        
        for symbol, df in self.cached_data.items():
            try:
                # Create strategy with parameters
                strategy = BarUpDnStrategy(
                    sl_percent=sl_percent,
                    trailing_stop_percent=trailing_stop_percent,
                    position_size_percent=position_size_percent,
                    max_intraday_loss_percent=max_intraday_loss_percent,
                    min_hold_minutes=int(min_hold_minutes),
                    max_loss_dollars=8.0  # Fixed at $8 max loss per trade
                )
                
                # Run backtest (original method)
                backtester = BarUpDnBacktester(initial_capital=10000)
                backtester.strategy = strategy
                result = backtester.run_backtest(df, symbol, show_progress=False)
                
                # Calculate profit factor
                if result.trades:
                    total_wins = sum(trade.pnl for trade in result.trades if trade.pnl > 0)
                    total_losses = abs(sum(trade.pnl for trade in result.trades if trade.pnl < 0))
                    profit_factor = total_wins / total_losses if total_losses > 0 else 2.0
                else:
                    profit_factor = 0
                
                results.append({
                    'win_rate': result.win_rate,
                    'total_return_percent': result.total_return_percent,
                    'max_drawdown': result.max_drawdown,
                    'total_trades': result.total_trades,
                    'profit_factor': profit_factor
                })
                
                # Collect trade PnL for Sharpe ratio
                all_trades_pnl.extend([trade.pnl for trade in result.trades])
                
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
        
        # ENHANCED SCORING - Win Rate Priority (standard method)
        win_rate_bonus = max(0, (avg_win_rate - 40) * 0.8)  # Strong bonus for win rates > 40%
        consistency_bonus = max(0, (3.0 - avg_drawdown) * 0.4)  # Bonus for low drawdown
        trade_volume_score = min(5, total_trades / 200)  # Bonus for adequate trade volume
        
        score = (
            avg_win_rate * 0.45 +                          # 45% win rate (highest priority)
            max(0, avg_return) * 0.20 +                    # 20% returns  
            max(0, (30 - avg_drawdown)) * 0.15 +           # 15% drawdown control
            min(8, avg_profit_factor) * 0.08 +             # 8% profit factor
            min(6, max(0, sharpe_ratio)) * 0.07 +          # 7% sharpe ratio
            win_rate_bonus +                               # Extra bonus for high win rates
            consistency_bonus +                            # Extra bonus for low drawdown
            trade_volume_score                             # Bonus for trade volume
        )
        
        # Store result
        result_obj = OptimizationResult(
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
    
    def run_bayesian_optimization(self, n_calls: int = 150, random_state: int = 42) -> List[OptimizationResult]:
        """Run Bayesian optimization"""
        
        console.print(Panel.fit(
            f"[bold cyan]🧠 Bayesian Parameter Optimization[/bold cyan]\n"
            f"Method: Gaussian Process + Expected Improvement\n"
            f"Evaluations: {n_calls}\n"
            f"Symbols: {', '.join(self.symbols)}\n"
            f"Data Period: {self.days_back} days\n"
            f"Search Space: 5D continuous optimization",
            border_style="cyan"
        ))
        
        # Enhanced search space for better parameter discovery
        space = [
            Real(3, 4.0, name='sl_percent'),                    # Wider stop loss range: 1-4%
            Real(1.5, 4, name='trailing_stop_percent'),         # Wider trailing range: 0.3-2.5%
            Real(3.0, 20.0, name='position_size_percent'),        # Broader position size: 3-20%
            Real(0.5, 3.0, name='max_intraday_loss_percent'),     # Expanded daily loss: 0.3-3%
            Integer(5, 12, name='min_hold_minutes')             # Flexible hold time: 15min-2hrs
        ]
        
        start_time = time.time()
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Bayesian optimization...", total=n_calls)
            
            def progress_callback(result):
                progress.update(task, advance=1)
                
                # More aggressive early stopping threshold
                if self.no_improvement_count >= 50:  # Increased from 30 to 50
                    console.print(f"\n[yellow]⏹️  Early stopping: No improvement for 50 iterations[/yellow]")
                    return True  # Stop optimization
                
                # Show current best every 25 iterations (more frequent updates)
                if len(self.optimization_history) % 25 == 0 and self.optimization_history:
                    best = max(self.optimization_history, key=lambda x: x.score)
                    console.print(f"\n[green]Current best (iter {len(self.optimization_history)}): "
                                f"Score {best.score:.2f}, Win Rate {best.win_rate:.1f}%[/green]")
            
            # Run optimization with enhanced settings
            result = gp_minimize(
                func=self.evaluate_parameters,
                dimensions=space,
                n_calls=n_calls,
                random_state=random_state,
                callback=progress_callback,
                acq_func="EI",  # Expected Improvement
                n_initial_points=30,  # More initial exploration (was 20)
                acq_optimizer="sampling",
                n_jobs=1  # Keep single-threaded for stability
            )
        
        total_time = time.time() - start_time
        
        # Sort results by score
        self.optimization_history.sort(key=lambda x: x.score, reverse=True)
        
        console.print(f"\n[green]✓ Bayesian optimization completed![/green]")
        console.print(f"[cyan]📊 {len(self.optimization_history)} evaluations in {total_time:.2f}s[/cyan]")
        console.print(f"[cyan]⚡ {len(self.optimization_history)/total_time:.1f} evaluations/sec[/cyan]")
        
        if len(result.func_vals) > 0:
            best_iter = np.argmin(result.func_vals)
            console.print(f"[green]🎯 Best found at iteration {best_iter + 1}[/green]")
        
        return self.optimization_history
    
    def run_random_search(self, n_trials: int = 100, seed: int = 42) -> List[OptimizationResult]:
        """Run random search as baseline comparison"""
        
        console.print(Panel.fit(
            f"[bold yellow]🎲 Random Search Baseline[/bold yellow]\n"
            f"Trials: {n_trials}\n"
            f"Method: Uniform random sampling",
            border_style="yellow"
        ))
        
        np.random.seed(seed)
        start_time = time.time()
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Random search...", total=n_trials)
            
            for i in range(n_trials):
                # Random parameter sampling - balanced for opposite signal exits
                params = [
                    np.random.uniform(2.0, 3.0),      # sl_percent (corrected)
                    np.random.uniform(1.5, 3.0),      # trailing_stop_percent (corrected)
                    np.random.uniform(3.0, 15.0),     # position_size_percent
                    np.random.uniform(0.5, 2.0),      # max_intraday_loss_percent (corrected)
                    np.random.randint(60, 101)          # min_hold_minutes (balanced range)
                ]
                
                self.evaluate_parameters(params)
                progress.update(task, advance=1)
        
        total_time = time.time() - start_time
        self.optimization_history.sort(key=lambda x: x.score, reverse=True)
        
        console.print(f"[green]✓ Random search completed in {total_time:.2f}s[/green]")
        
        return self.optimization_history
    
    def display_results(self, results: List[OptimizationResult], top_n: int = 15):
        """Display optimization results with enhanced metrics"""
        
        if not results:
            console.print("[red]No results to display[/red]")
            return
        
        # Best result summary
        best = results[0]
        console.print(Panel.fit(
            f"[bold green]🏆 OPTIMAL PARAMETERS (Bayesian Search)[/bold green]\n\n"
            f"Stop Loss: {best.parameters['sl_percent']:.2f}%\n"
            f"Trailing Stop: {best.parameters['trailing_stop_percent']:.2f}%\n"
            f"Position Size: {best.parameters['position_size_percent']:.1f}%\n"
            f"Max Daily Loss: {best.parameters['max_intraday_loss_percent']:.2f}%\n"
            f"Min Hold Time: {best.parameters['min_hold_minutes']} minutes\n\n"
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
        table = Table(title=f"Top {min(top_n, len(results))} Bayesian Optimization Results")
        table.add_column("Rank", style="cyan", width=4)
        table.add_column("SL%", style="yellow", width=6)
        table.add_column("Trail%", style="yellow", width=7)
        table.add_column("Pos%", style="yellow", width=6)
        table.add_column("MaxLoss%", style="yellow", width=9)
        table.add_column("Hold(m)", style="yellow", width=7)
        table.add_column("Win%", style="green", width=6)
        table.add_column("Return%", style="green", width=8)
        table.add_column("Sharpe", style="blue", width=7)
        table.add_column("Score", style="bold green", width=7)
        table.add_column("Iter", style="dim", width=5)
        
        for i, result in enumerate(results[:top_n], 1):
            p = result.parameters
            
            table.add_row(
                str(i),
                f"{p['sl_percent']:.2f}",
                f"{p['trailing_stop_percent']:.2f}",
                f"{p['position_size_percent']:.1f}",
                f"{p['max_intraday_loss_percent']:.2f}",
                f"{p['min_hold_minutes']}",
                f"{result.win_rate:.1f}",
                f"{result.total_return_percent:.2f}",
                f"{result.sharpe_ratio:.2f}",
                f"{result.score:.2f}",
                f"{result.iteration + 1}"
            )
        
        console.print(table)
        
        # Performance insights
        self._display_insights(results)
    
    def _display_insights(self, results: List[OptimizationResult]):
        """Display optimization insights"""
        
        if len(results) < 10:
            return
        
        top_10 = results[:10]
        
        # Parameter analysis
        insights = []
        
        # Analyze parameter ranges of top performers
        sl_values = [r.parameters['sl_percent'] for r in top_10]
        trail_values = [r.parameters['trailing_stop_percent'] for r in top_10]
        pos_values = [r.parameters['position_size_percent'] for r in top_10]
        
        insights.append(f"Stop Loss sweet spot: {np.mean(sl_values):.2f}% ± {np.std(sl_values):.2f}%")
        insights.append(f"Trailing Stop range: {np.mean(trail_values):.2f}% ± {np.std(trail_values):.2f}%")
        insights.append(f"Position Size optimal: {np.mean(pos_values):.1f}% ± {np.std(pos_values):.1f}%")
        
        # Performance insights
        win_rates = [r.win_rate for r in top_10]
        returns = [r.total_return_percent for r in top_10]
        
        insights.append(f"Top 10 avg win rate: {np.mean(win_rates):.1f}%")
        insights.append(f"Top 10 avg return: {np.mean(returns):.2f}%")
        
        console.print(Panel.fit(
            "\n".join([f"💡 {insight}" for insight in insights]),
            title="[bold blue]🔍 Optimization Insights[/bold blue]",
            border_style="blue"
        ))
    
    def display_individual_results(self, symbol_results: Dict[str, List[OptimizationResult]], top_n: int = 5):
        """Display individual optimization results for each symbol"""
        
        if not symbol_results:
            console.print("[red]No individual results to display[/red]")
            return
        
        console.print(f"\n[bold green]🎯 INDIVIDUAL SYMBOL OPTIMIZATION RESULTS[/bold green]")
        
        # Summary table of best parameters per symbol
        summary_table = Table(title="Best Parameters Per Symbol")
        summary_table.add_column("Symbol", style="cyan", width=8)
        summary_table.add_column("SL%", style="yellow", width=6)
        summary_table.add_column("Trail%", style="yellow", width=7)
        summary_table.add_column("Pos%", style="yellow", width=6)
        summary_table.add_column("Win%", style="green", width=6)
        summary_table.add_column("Return%", style="green", width=8)
        summary_table.add_column("DD%", style="red", width=6)
        summary_table.add_column("Score", style="bold green", width=7)
        
        best_overall_score = 0
        best_overall_symbol = None
        
        for symbol, results in symbol_results.items():
            if results:
                best = results[0]
                p = best.parameters
                
                summary_table.add_row(
                    symbol,
                    f"{p['sl_percent']:.2f}",
                    f"{p['trailing_stop_percent']:.2f}",
                    f"{p['position_size_percent']:.1f}",
                    f"{best.win_rate:.1f}",
                    f"{best.total_return_percent:.2f}",
                    f"{best.max_drawdown:.2f}",
                    f"{best.score:.2f}"
                )
                
                if best.score > best_overall_score:
                    best_overall_score = best.score
                    best_overall_symbol = symbol
            else:
                summary_table.add_row(symbol, "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "0.00")
        
        console.print(summary_table)
        
        # Highlight best performing symbol
        if best_overall_symbol:
            best_result = symbol_results[best_overall_symbol][0]
            console.print(Panel.fit(
                f"[bold yellow]🏆 BEST PERFORMING SYMBOL: {best_overall_symbol}[/bold yellow]\n\n"
                f"Stop Loss: {best_result.parameters['sl_percent']:.2f}%\n"
                f"Trailing Stop: {best_result.parameters['trailing_stop_percent']:.2f}%\n"
                f"Position Size: {best_result.parameters['position_size_percent']:.1f}%\n"
                f"Max Daily Loss: {best_result.parameters['max_intraday_loss_percent']:.2f}%\n"
                f"Min Hold Time: {best_result.parameters['min_hold_minutes']} minutes\n\n"
                f"[cyan]Performance:[/cyan]\n"
                f"Win Rate: {best_result.win_rate:.1f}%\n"
                f"Return: {best_result.total_return_percent:.2f}%\n"
                f"Max Drawdown: {best_result.max_drawdown:.2f}%\n"
                f"Score: {best_result.score:.2f}",
                border_style="yellow"
            ))
        
        # Detailed results for each symbol
        for symbol, results in symbol_results.items():
            if results and len(results) >= top_n:
                console.print(f"\n[bold cyan]📊 Top {top_n} Results for {symbol}:[/bold cyan]")
                
                symbol_table = Table(title=f"{symbol} Optimization Results")
                symbol_table.add_column("Rank", style="cyan", width=4)
                symbol_table.add_column("SL%", style="yellow", width=6)
                symbol_table.add_column("Trail%", style="yellow", width=7)
                symbol_table.add_column("Pos%", style="yellow", width=6)
                symbol_table.add_column("Win%", style="green", width=6)
                symbol_table.add_column("Return%", style="green", width=8)
                symbol_table.add_column("Score", style="bold green", width=7)
                
                for i, result in enumerate(results[:top_n], 1):
                    p = result.parameters
                    symbol_table.add_row(
                        str(i),
                        f"{p['sl_percent']:.2f}",
                        f"{p['trailing_stop_percent']:.2f}",
                        f"{p['position_size_percent']:.1f}",
                        f"{result.win_rate:.1f}",
                        f"{result.total_return_percent:.2f}",
                        f"{result.score:.2f}"
                    )
                
                console.print(symbol_table)

    def run_detailed_backtest_with_individual_params(self, symbol_results: Dict[str, List[OptimizationResult]]) -> str:
        """Run detailed backtest using individual optimal parameters for each symbol"""
        
        console.print(Panel.fit(
            f"[bold cyan]📊 Running Detailed Backtest with Individual Parameters[/bold cyan]\n"
            f"Each symbol uses its own optimal parameters\n"
            f"Symbols: {len(symbol_results)} symbols",
            border_style="cyan"
        ))
        
        try:
            backtest_results = []
            
            for symbol, results in symbol_results.items():
                console.print(f"[dim]Debug: {symbol} results type: {type(results)}, length: {len(results) if hasattr(results, '__len__') else 'N/A'}[/dim]")
                
                if not results or len(results) == 0:
                    console.print(f"[red]❌ No results for {symbol}, skipping...[/red]")
                    continue
                
                # Debug the first result
                first_result = results[0]
                console.print(f"[dim]Debug: {symbol} first result type: {type(first_result)}[/dim]")
                
                if not hasattr(first_result, 'parameters'):
                    console.print(f"[red]❌ Invalid result object for {symbol}, skipping...[/red]")
                    console.print(f"[dim]Debug: {symbol} first result attributes: {dir(first_result) if hasattr(first_result, '__dict__') else 'No attributes'}[/dim]")
                    continue
                
                try:
                    best_params = first_result.parameters
                    console.print(f"[cyan]Running detailed backtest for {symbol} with individual params...[/cyan]")
                    console.print(f"[yellow]  {symbol} params: SL={best_params['sl_percent']:.2f}%, "
                                f"Trail={best_params['trailing_stop_percent']:.2f}%, "
                                f"Pos={best_params['position_size_percent']:.1f}%[/yellow]")
                    
                    # Create strategy with individual optimal parameters
                    strategy = BarUpDnStrategy(
                        sl_percent=best_params['sl_percent'],
                        trailing_stop_percent=best_params['trailing_stop_percent'],
                        position_size_percent=best_params['position_size_percent'],
                        max_intraday_loss_percent=best_params['max_intraday_loss_percent'],
                        min_hold_minutes=best_params['min_hold_minutes'],
                        max_loss_dollars=8.0
                    )
                    
                    # Run backtest
                    df = self.cached_data[symbol]
                    backtester = BarUpDnBacktester(initial_capital=10000)
                    backtester.strategy = strategy
                    result = backtester.run_backtest(df, symbol, show_progress=True)
                    
                    # Store individual parameters with result
                    result.raw_data = df.copy()
                    result.parameters = best_params
                    result.individual_optimization = True  # Mark as individually optimized
                    
                    backtest_results.append(result)
                    
                except Exception as e:
                    console.print(f"[red]❌ Error processing {symbol}: {str(e)}[/red]")
                    console.print(f"[dim]Debug: {symbol} first_result type: {type(first_result)}, value: {first_result}[/dim]")
                    continue
            
            # Generate timestamp for filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            html_filename = f"individual_optimization_backtest_{timestamp}.html"
            
            # Calculate overall metrics
            avg_return = sum([r.total_return_percent for r in backtest_results]) / len(backtest_results)
            avg_win_rate = sum([r.win_rate for r in backtest_results]) / len(backtest_results)
            avg_drawdown = sum([r.max_drawdown for r in backtest_results]) / len(backtest_results)
            avg_sharpe = sum([r.sharpe_ratio for r in backtest_results if not np.isnan(r.sharpe_ratio)]) / len([r for r in backtest_results if not np.isnan(r.sharpe_ratio)]) if any(not np.isnan(r.sharpe_ratio) for r in backtest_results) else 0
            
            # Structure results for HTML generation
            optimization_results = {
                'best_parameters': {
                    'parameters': backtest_results[0].parameters if backtest_results else {},  # Use first symbol's params as reference
                    'results': backtest_results,
                    'metrics': {
                        'avg_return_percent': avg_return,
                        'avg_win_rate': avg_win_rate,
                        'avg_sharpe_ratio': avg_sharpe,
                        'avg_drawdown': avg_drawdown
                    }
                },
                'metadata': {
                    'symbols_tested': list(symbol_results.keys()),
                    'method': 'Individual Symbol Bayesian Optimization',
                    'timestamp': timestamp,
                    'individual_optimization': True,  # Flag to indicate this is individual optimization
                    'individual_params': {symbol: results[0].parameters if results and len(results) > 0 and hasattr(results[0], 'parameters') else None 
                                        for symbol, results in symbol_results.items()}
                }
            }
            
            # Generate HTML report
            console.print("[cyan]Generating comprehensive HTML chart for individual optimization...[/cyan]")
            
            # Import the HTML generator
            from bar_updn_optimization import generate_comprehensive_html_chart
            
            # Generate HTML
            generate_comprehensive_html_chart(optimization_results, html_filename)
            
            console.print(f"[green]✅ Individual optimization HTML report saved: {html_filename}[/green]")
            
            # Display summary
            console.print("\n[bold green]📈 Individual Optimization Backtest Summary:[/bold green]")
            
            summary_table = Table(title="Individual Parameter Performance")
            summary_table.add_column("Symbol", style="cyan")
            summary_table.add_column("SL%", style="yellow", width=6)
            summary_table.add_column("Trail%", style="yellow", width=7) 
            summary_table.add_column("Win Rate%", style="green")
            summary_table.add_column("Return%", style="green")
            summary_table.add_column("Max DD%", style="red")
            summary_table.add_column("Trades", style="yellow")
            summary_table.add_column("Profit Factor", style="blue")
            
            for result in backtest_results:
                profit_factor = sum(trade.pnl for trade in result.trades if trade.pnl > 0) / \
                               abs(sum(trade.pnl for trade in result.trades if trade.pnl < 0)) \
                               if result.trades and any(trade.pnl < 0 for trade in result.trades) else 2.0
                
                params = result.parameters
                summary_table.add_row(
                    result.symbol,
                    f"{params['sl_percent']:.2f}",
                    f"{params['trailing_stop_percent']:.2f}",
                    f"{result.win_rate:.1f}",
                    f"{result.total_return_percent:.2f}",
                    f"{result.max_drawdown:.2f}",
                    str(result.total_trades),
                    f"{profit_factor:.2f}"
                )
            
            console.print(summary_table)
            
            return html_filename
            
        except Exception as e:
            console.print(f"[red]❌ Error generating individual backtest: {str(e)}[/red]")
            return None

    def save_results(self, results: List[OptimizationResult], method: str = "bayesian"):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"smart_optimization_{method}_{timestamp}.json"
        
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
            'symbols': self.symbols,
            'days_back': self.days_back,
            'total_evaluations': len(json_results),
            'best_score': results[0].score if results else 0,
            'best_win_rate': results[0].win_rate if results else 0,
            'optimization_time_seconds': getattr(self, 'optimization_time', 0)
        }
        
        output = {
            'metadata': metadata,
            'results': json_results
        }
        
        with open(filename, 'w') as f:
            json.dump(output, f, indent=2)
        
        console.print(f"[green]✅ Results saved to {filename}[/green]")
        return filename
    
    def run_ultra_fast_optimization(self, n_calls: int = 150) -> List[OptimizationResult]:
        """Ultra-fast optimization combining all speed techniques"""
        
        console.print(Panel.fit(
            f"[bold green]⚡ ULTRA-FAST Bayesian Optimization[/bold green]\n"
            f"🚀 Vectorized Operations: 10-100x speedup\n"
            f"🔧 Preprocessed Data: Instant signal generation\n" 
            f"⚡ Numba JIT Compilation: Near C-speed\n"
            f"🎯 Smart Sampling: 2x data reduction\n"
            f"Evaluations: {n_calls}",
            border_style="green"
        ))
        
        if not self.processed_data:
            console.print("[red]❌ No preprocessed data available![/red]")
            return []
        
        # Use fast evaluation method
        original_evaluate = self.evaluate_parameters
        self.evaluate_parameters = self.evaluate_parameters_fast
        
        try:
            # Run optimization with speed optimizations
            start_time = time.time()
            results = self.run_bayesian_optimization(n_calls=n_calls)
            total_time = time.time() - start_time
            
            speedup_estimate = (12 * 60) / total_time if total_time > 0 else 1  # Compare to your 12min baseline
            console.print(f"[bold green]🚀 SPEED BOOST: ~{speedup_estimate:.1f}x faster than original![/bold green]")
            console.print(f"[cyan]⏱️  Completed in {total_time:.1f}s vs estimated {12*60}s[/cyan]")
            
            return results
            
        finally:
            # Restore original method
            self.evaluate_parameters = original_evaluate

    def run_individual_symbol_optimization(self, n_calls: int = 150) -> Dict[str, List[OptimizationResult]]:
        """Run separate optimization for each symbol to find individual optimal parameters"""
        
        console.print(Panel.fit(
            f"[bold magenta]🎯 INDIVIDUAL SYMBOL OPTIMIZATION[/bold magenta]\n"
            f"🚀 Each symbol gets its own optimal parameters\n"
            f"📈 Better performance per symbol expected\n"
            f"⚡ Ultra-fast vectorized evaluation\n"
            f"Evaluations per symbol: {n_calls}\n"
            f"Total symbols: {len(self.symbols)}",
            border_style="magenta"
        ))
        
        if not self.processed_data:
            console.print("[red]❌ No preprocessed data available![/red]")
            return {}
        
        symbol_results = {}
        overall_start_time = time.time()
        
        # Store original data
        original_processed_data = self.processed_data.copy()
        original_cached_data = self.cached_data.copy()
        
        # Use fast evaluation method
        original_evaluate = self.evaluate_parameters
        self.evaluate_parameters = self.evaluate_parameters_fast_single_symbol
        
        try:
            for i, symbol in enumerate(self.symbols, 1):
                console.print(f"\n[bold cyan]🔍 Optimizing {symbol} ({i}/{len(self.symbols)})[/bold cyan]")
                
                # Temporarily set data to only this symbol
                self.processed_data = {symbol: original_processed_data[symbol]}
                self.cached_data = {symbol: original_cached_data[symbol]}
                
                # Reset optimization history for this symbol
                self.optimization_history = []
                self.best_score = -np.inf
                self.no_improvement_count = 0
                
                # Run optimization for this symbol only
                symbol_start_time = time.time()
                results = self.run_bayesian_optimization(n_calls=n_calls)
                symbol_time = time.time() - symbol_start_time
                
                console.print(f"[green]✅ {symbol} optimization complete in {symbol_time:.1f}s[/green]")
                
                if results:
                    symbol_results[symbol] = results
                    best = results[0]
                    console.print(f"[yellow]🏆 {symbol} Best: Win Rate {best.win_rate:.1f}%, "
                                f"Return {best.total_return_percent:.2f}%, Score {best.score:.2f}[/yellow]")
                else:
                    console.print(f"[red]❌ No valid results for {symbol}[/red]")
                    symbol_results[symbol] = []
        
        finally:
            # Restore all data
            self.processed_data = original_processed_data
            self.cached_data = original_cached_data
            self.evaluate_parameters = original_evaluate
        
        total_time = time.time() - overall_start_time
        console.print(f"\n[bold green]🎊 INDIVIDUAL OPTIMIZATION COMPLETE![/bold green]")
        console.print(f"[cyan]⏱️  All {len(self.symbols)} symbols optimized in {total_time:.1f}s[/cyan]")
        console.print(f"[cyan]📊 Average time per symbol: {total_time/len(self.symbols):.1f}s[/cyan]")
        
        return symbol_results

    def evaluate_parameters_fast_single_symbol(self, params: List[float]) -> float:
        """Ultra-fast parameter evaluation for single symbol"""
        sl_percent, trailing_stop_percent, position_size_percent, max_intraday_loss_percent, min_hold_minutes = params
        
        param_dict = {
            'sl_percent': sl_percent,
            'trailing_stop_percent': trailing_stop_percent,
            'position_size_percent': position_size_percent,
            'max_intraday_loss_percent': max_intraday_loss_percent,
            'min_hold_minutes': int(min_hold_minutes)
        }
        
        # Should only have one symbol in processed_data during individual optimization
        symbol = list(self.processed_data.keys())[0]
        data = self.processed_data[symbol]
        
        try:
            # Use vectorized backtesting (10-100x faster)
            result = VectorizedBacktester.run_fast_backtest(
                pd.DataFrame({
                    'high': data['highs'],
                    'low': data['lows'],
                    'close': data['closes'],
                    'volume': data['volumes']
                }),
                sl_percent,
                trailing_stop_percent, 
                position_size_percent,
                max_loss_dollars=8.0
            )
            
            # Single symbol metrics
            win_rate = result['win_rate']
            total_return = result['total_return_percent']
            max_drawdown = result['max_drawdown']
            total_trades = result['total_trades']
            profit_factor = result['profit_factor']
            
            # Calculate Sharpe ratio
            if len(result['trades_pnl']) > 1:
                mean_return = np.mean(result['trades_pnl'])
                std_return = np.std(result['trades_pnl'])
                sharpe_ratio = (mean_return / std_return) * np.sqrt(365) if std_return > 0 else 0.0
            else:
                sharpe_ratio = 0.0
            
            # ENHANCED SCORING for single symbol
            win_rate_bonus = max(0, (win_rate - 40) * 0.8)  # Strong bonus for win rates > 40%
            consistency_bonus = max(0, (3.0 - max_drawdown) * 0.4)  # Bonus for low drawdown
            trade_volume_score = min(5, total_trades / 50)  # Adjusted for single symbol
            
            score = (
                win_rate * 0.45 +                               # 45% win rate (highest priority)
                max(0, total_return) * 0.20 +                  # 20% returns  
                max(0, (30 - max_drawdown)) * 0.15 +           # 15% drawdown control
                min(8, profit_factor) * 0.08 +                 # 8% profit factor
                min(6, max(0, sharpe_ratio)) * 0.07 +          # 7% sharpe ratio
                win_rate_bonus +                               # Extra bonus for high win rates
                consistency_bonus +                            # Extra bonus for low drawdown
                trade_volume_score                             # Bonus for trade volume
            )
            
            # Store result
            result_obj = OptimizationResult(
                parameters=param_dict.copy(),
                win_rate=win_rate,
                total_return_percent=total_return,
                max_drawdown=max_drawdown,
                total_trades=total_trades,
                profit_factor=profit_factor,
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
            
        except Exception:
            return 1000.0  # Large penalty for failed parameter sets

    def run_detailed_backtest_with_best_params(self, best_params: Dict) -> str:
        """Run detailed backtest with optimal parameters and generate HTML report"""
        console.print(Panel.fit(
            f"[bold cyan]📊 Running Detailed Backtest with Optimal Parameters[/bold cyan]\n"
            f"Stop Loss: {best_params['sl_percent']:.2f}%\n"
            f"Trailing Stop: {best_params['trailing_stop_percent']:.2f}%\n"
            f"Position Size: {best_params['position_size_percent']:.1f}%\n"
            f"Max Daily Loss: {best_params['max_intraday_loss_percent']:.2f}%\n"
            f"Min Hold Time: {best_params['min_hold_minutes']} minutes",
            border_style="cyan"
        ))
        
        try:
            # Create strategy with optimal parameters
            strategy = BarUpDnStrategy(
                sl_percent=best_params['sl_percent'],
                trailing_stop_percent=best_params['trailing_stop_percent'],
                position_size_percent=best_params['position_size_percent'],
                max_intraday_loss_percent=best_params['max_intraday_loss_percent'],
                min_hold_minutes=best_params['min_hold_minutes'],
                max_loss_dollars=8.0  # Fixed at $8 max loss per trade
            )
            
            # Run backtests for all symbols
            backtest_results = []
            
            for symbol, df in self.cached_data.items():
                console.print(f"[cyan]Running detailed backtest for {symbol}...[/cyan]")
                
                backtester = BarUpDnBacktester(initial_capital=10000)
                backtester.strategy = strategy
                result = backtester.run_backtest(df, symbol, show_progress=True)
                
                # Store raw OHLCV data for candlestick charts (like traditional optimizer)
                result.raw_data = df.copy()
                
                # Add parameter info to result (like traditional optimizer)
                result.parameters = best_params
                
                backtest_results.append(result)
            
            # Generate timestamp for filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            html_filename = f"smart_optimization_backtest_{timestamp}.html"
            
            # Structure results in the same format as traditional optimization
            optimization_results = {
                'best_parameters': {
                    'parameters': best_params,
                    'results': backtest_results,
                    'metrics': {
                        'avg_return_percent': sum([r.total_return_percent for r in backtest_results]) / len(backtest_results),
                        'avg_win_rate': sum([r.win_rate for r in backtest_results]) / len(backtest_results),
                        'avg_sharpe_ratio': sum([r.sharpe_ratio for r in backtest_results if not np.isnan(r.sharpe_ratio)]) / len([r for r in backtest_results if not np.isnan(r.sharpe_ratio)]) if any(not np.isnan(r.sharpe_ratio) for r in backtest_results) else 0,
                        'avg_drawdown': sum([r.max_drawdown for r in backtest_results]) / len(backtest_results)
                    }
                },
                'metadata': {
                    'symbols_tested': list(self.cached_data.keys()),
                    'method': 'Bayesian Optimization',
                    'timestamp': timestamp
                }
            }
            
            # Use the SAME HTML generator as traditional optimization
            console.print("[cyan]Generating comprehensive HTML chart (same as traditional method)...[/cyan]")
            
            # Import the exact same function that traditional optimization uses
            from bar_updn_optimization import generate_comprehensive_html_chart
            
            # Generate HTML using the traditional method's function
            generate_comprehensive_html_chart(optimization_results, html_filename)
            
            console.print(f"[green]✅ Detailed backtest HTML report saved: {html_filename}[/green]")
            console.print(f"[yellow]📊 Using same HTML format as traditional optimization method[/yellow]")
            
            # Display summary
            console.print("\n[bold green]📈 Detailed Backtest Summary:[/bold green]")
            
            from rich.table import Table
            summary_table = Table(title="Symbol-wise Performance with Optimal Parameters")
            summary_table.add_column("Symbol", style="cyan")
            summary_table.add_column("Win Rate%", style="green")
            summary_table.add_column("Return%", style="green")
            summary_table.add_column("Max DD%", style="red")
            summary_table.add_column("Trades", style="yellow")
            summary_table.add_column("Profit Factor", style="blue")
            
            for result in backtest_results:
                profit_factor = sum(trade.pnl for trade in result.trades if trade.pnl > 0) / \
                               abs(sum(trade.pnl for trade in result.trades if trade.pnl < 0)) \
                               if result.trades and any(trade.pnl < 0 for trade in result.trades) else 2.0
                               
                summary_table.add_row(
                    result.symbol,
                    f"{result.win_rate:.1f}",
                    f"{result.total_return_percent:.2f}",
                    f"{result.max_drawdown:.2f}",
                    str(result.total_trades),
                    f"{profit_factor:.2f}"
                )
            
            console.print(summary_table)
            
            return html_filename
            
        except Exception as e:
            console.print(f"[red]❌ Error generating detailed backtest: {str(e)}[/red]")
            return None

def main():
    """Main function with ultra-fast optimization"""
    console.print("[bold blue]⚡ ULTRA-FAST Smart BarUpDn Strategy Optimizer[/bold blue]")
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize optimizer
    optimizer = SmartStrategyOptimizer(
        symbols=["BTCUSDT", "ETHUSDT"],
        days_back=100,  # 6 months now feasible!
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No cached data available.[/red]")
        return
    
    # Choose optimization mode
    console.print("\n[bold yellow]🔧 OPTIMIZATION MODE SELECTION[/bold yellow]")
    console.print("[cyan]1. Combined Optimization: Find one set of parameters for all symbols (faster)[/cyan]")
    console.print("[cyan]2. Individual Optimization: Find optimal parameters for each symbol (better performance)[/cyan]")
    
    # For now, let's run individual optimization by default (you can change this)
    optimization_mode = "individual"  # Change to "combined" for the old method
    
    if optimization_mode == "individual":
        # Run INDIVIDUAL optimization for each symbol
        console.print("\n[bold magenta]🎯 Running INDIVIDUAL optimization for each symbol![/bold magenta]")
        start_time = time.time()
        
        # Run individual optimization with fewer calls per symbol for speed
        symbol_results = optimizer.run_individual_symbol_optimization(n_calls=200)  # 200 per symbol
        
        optimization_time = time.time() - start_time
        
        console.print(f"\n[bold green]⚡ INDIVIDUAL OPTIMIZATION COMPLETE![/bold green]")
        console.print(f"[yellow]⏱️  All symbols optimized in {optimization_time:.1f}s[/yellow]")
        console.print(f"[cyan]📊 Each symbol has its own optimal parameters![/cyan]")
        
        if symbol_results:
            optimizer.display_individual_results(symbol_results, top_n=5)
            
            # Save individual results
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            individual_filename = f"individual_optimization_{timestamp}.json"
            
            # Convert to JSON format
            json_data = {
                'metadata': {
                    'timestamp': datetime.now().isoformat(),
                    'method': 'Individual Symbol Bayesian Optimization',
                    'symbols': optimizer.symbols,
                    'days_back': optimizer.days_back,
                    'optimization_time_seconds': optimization_time
                },
                'symbol_results': {}
            }
            
            for symbol, results in symbol_results.items():
                json_data['symbol_results'][symbol] = []
                if results and isinstance(results, list):
                    for result in results:
                        if hasattr(result, 'parameters') and hasattr(result, 'win_rate'):
                            json_data['symbol_results'][symbol].append({
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
                        else:
                            console.print(f"[yellow]⚠️  Invalid result object for {symbol} in JSON saving[/yellow]")
            
            with open(individual_filename, 'w') as f:
                json.dump(json_data, f, indent=2)
            
            console.print(f"[green]✅ Individual results saved to {individual_filename}[/green]")
            
            # Generate detailed backtest with individual parameters
            html_file = optimizer.run_detailed_backtest_with_individual_params(symbol_results)
            
            if html_file:
                console.print(f"\n[bold green]🎊 Complete! Generated individual HTML report: {html_file}[/bold green]")
                console.print(f"[yellow]💡 Each symbol uses its own optimal parameters![/yellow]")
                
                # Try to open HTML file automatically
                try:
                    import webbrowser
                    import os
                    html_path = os.path.abspath(html_file)
                    webbrowser.open(f'file://{html_path}')
                    console.print(f"[green]🌐 Opened individual optimization report in browser[/green]")
                except Exception:
                    console.print(f"[yellow]📂 HTML file saved - open manually: {html_file}[/yellow]")
        else:
            console.print("[red]❌ No valid individual results found.[/red]")
    
    else:
        # Run COMBINED optimization (original method)
        console.print("\n[bold green]🚀 Running COMBINED optimization (one set for all symbols)[/bold green]")
        start_time = time.time()
        
        # Use the ultra-fast method with MORE evaluations for better discovery
        fast_results = optimizer.run_ultra_fast_optimization(n_calls=350)  # Increased from 200 to 350!
        
        optimization_time = time.time() - start_time
        
        console.print(f"\n[bold green]⚡ ULTRA-FAST COMPLETE![/bold green]")
        console.print(f"[yellow]⏱️  6 months optimized in {optimization_time:.1f}s (was 12+ minutes!)[/yellow]")
        console.print(f"[cyan]🚀 Speedup achieved: ~{(12*60)/optimization_time:.1f}x faster![/cyan]")
        
        if fast_results:
            optimizer.display_results(fast_results, top_n=15)
            optimizer.save_results(fast_results, method="ultra_fast")
            
            # Generate detailed backtest
            best_params = fast_results[0].parameters
            html_file = optimizer.run_detailed_backtest_with_best_params(best_params)
            
            if html_file:
                console.print(f"\n[bold green]🎊 Complete! Generated detailed HTML report: {html_file}[/bold green]")
                console.print(f"[yellow]💡 Open the HTML file to view interactive charts and detailed analysis[/yellow]")
                
                # Try to open HTML file automatically
                try:
                    import webbrowser
                    import os
                    html_path = os.path.abspath(html_file)
                    webbrowser.open(f'file://{html_path}')
                    console.print(f"[green]🌐 Opened HTML report in browser[/green]")
                except Exception:
                    console.print(f"[yellow]📂 HTML file saved - open manually: {html_file}[/yellow]")
        else:
            console.print("[red]❌ No valid results found.[/red]")

if __name__ == "__main__":
    main()

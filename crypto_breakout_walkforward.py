#!/usr/bin/env python3
"""
Crypto Breakout Strategy - Walk-Forward Analysis
Validates strategy robustness by testing on rolling time windows
"""

import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import warnings
from pathlib import Path

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

# Import modules
from enhanced_data_fetcher import EnhancedDataFetcher
try:
    from optimizers.unified_optimizer import VectorizedBacktester
    UNIFIED_OPTIMIZER_AVAILABLE = True
except ImportError:
    UNIFIED_OPTIMIZER_AVAILABLE = False

warnings.filterwarnings('ignore')
console = Console()

class CryptoBreakoutWalkForward:
    """Walk-Forward Analysis for Crypto Breakout Strategy"""
    
    def __init__(self, symbols: List[str] = None, api_key: str = None, api_secret: str = None):
        self.symbols = symbols or ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
        self.fetcher = EnhancedDataFetcher(api_key=api_key, api_secret=api_secret)
        self.data_cache = {}
        
        # Optimal parameters from your successful optimization
        self.optimal_params = {
            'lookback_periods': 15,
            'volume_multiplier': 1.1,
            'min_breakout_percent': 0.05,
            'sl_percent': 1.0,
            'tp_percent': 7.0,
            'trailing_stop_percent': 0.5,
            'position_size_percent': 18.397535100780317,
            'min_hold_minutes': 60,
            'quick_exit_percent': 0.7266827221659062,
            'momentum_periods': 10,
            'volume_exit_threshold': 0.8741137897405451,
            'rsi_oversold': 37,
            'rsi_overbought': 58,
            'breakout_failure_threshold': 0.3963184317780166
        }
        
    def load_historical_data(self, days_back: int = 180):
        """Load comprehensive historical data for walk-forward analysis"""
        console.print(f"\n[cyan]📊 Loading {days_back} days of historical data...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        for symbol in self.symbols:
            try:
                console.print(f"[cyan]Fetching {symbol} 15m data: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}[/cyan]")
                
                # Fetch 15-minute data
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is not None and not df.empty:
                    self.data_cache[symbol] = df
                    console.print(f"[green]✓ {symbol}: {len(df):,} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
                    
            except Exception as e:
                console.print(f"[red]✗ Failed to fetch {symbol}: {str(e)}[/red]")
        
        total_bars = sum(len(df) for df in self.data_cache.values())
        console.print(f"[green]✅ {len(self.data_cache)} symbols ready ({total_bars:,} total bars)[/green]")
    
    def run_walk_forward_analysis(self, 
                                 train_days: int = 30,
                                 test_days: int = 7,
                                 step_days: int = 7,
                                 optimize_every_step: bool = True) -> Dict:
        """
        Run walk-forward analysis
        
        Args:
            train_days: Days of data for training/optimization
            test_days: Days of data for testing
            step_days: Days to step forward for each window
            optimize_every_step: Whether to re-optimize parameters for each window
        """
        
        console.print(Panel.fit(
            f"[bold cyan]🚀 CRYPTO BREAKOUT WALK-FORWARD ANALYSIS[/bold cyan]\n"
            f"Training Period: {train_days} days\n"
            f"Testing Period: {test_days} days\n"
            f"Step Size: {step_days} days\n"
            f"Re-optimize: {'Yes' if optimize_every_step else 'No (use fixed optimal params)'}\n"
            f"Symbols: {', '.join(self.symbols)}",
            border_style="cyan"
        ))
        
        results = {}
        
        for symbol in self.symbols:
            if symbol not in self.data_cache:
                console.print(f"[red]⚠️ Skipping {symbol} - no data available[/red]")
                continue
                
            console.print(f"\n[bold yellow]📈 Analyzing {symbol}...[/bold yellow]")
            symbol_results = self._run_symbol_walkforward(
                symbol, train_days, test_days, step_days, optimize_every_step
            )
            results[symbol] = symbol_results
        
        # Generate summary report
        self._generate_walkforward_report(results, train_days, test_days, step_days)
        
        return results
    
    def _run_symbol_walkforward(self, symbol: str, train_days: int, test_days: int, 
                               step_days: int, optimize_every_step: bool) -> List[Dict]:
        """Run walk-forward analysis for a single symbol"""
        
        df = self.data_cache[symbol]
        
        # Calculate time windows
        windows = self._generate_time_windows(df, train_days, test_days, step_days)
        
        console.print(f"[cyan]Generated {len(windows)} walk-forward windows for {symbol}[/cyan]")
        
        window_results = []
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            task = progress.add_task(f"Walk-forward {symbol}", total=len(windows))
            
            for i, window in enumerate(windows):
                train_data = df[window['train_start']:window['train_end']]
                test_data = df[window['test_start']:window['test_end']]
                
                if len(train_data) < 100 or len(test_data) < 20:
                    progress.advance(task)
                    continue
                
                # Use optimal parameters or re-optimize
                if optimize_every_step and len(train_data) >= 500:
                    best_params = self._optimize_window(train_data, symbol, i+1)
                else:
                    best_params = self.optimal_params.copy()
                
                # Test on out-of-sample data
                test_results = self._test_parameters(test_data, best_params, symbol)
                
                window_result = {
                    'window': i + 1,
                    'train_start': window['train_start'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'train_end': window['train_end'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'test_start': window['test_start'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'test_end': window['test_end'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'train_bars': len(train_data),
                    'test_bars': len(test_data),
                    'best_params': best_params,
                    'test_results': test_results
                }
                
                window_results.append(window_result)
                progress.advance(task)
        
        return window_results
    
    def _generate_time_windows(self, df: pd.DataFrame, train_days: int, 
                              test_days: int, step_days: int) -> List[Dict]:
        """Generate overlapping time windows for walk-forward analysis"""
        
        windows = []
        start_date = df.index.min()
        end_date = df.index.max()
        
        current_start = start_date
        
        while True:
            # Calculate window boundaries
            train_start = current_start
            train_end = train_start + timedelta(days=train_days)
            test_start = train_end
            test_end = test_start + timedelta(days=test_days)
            
            # Check if we have enough data
            if test_end > end_date:
                break
            
            windows.append({
                'train_start': train_start,
                'train_end': train_end,
                'test_start': test_start,
                'test_end': test_end
            })
            
            # Step forward
            current_start += timedelta(days=step_days)
        
        return windows
    
    def _optimize_window(self, train_data: pd.DataFrame, symbol: str, window_num: int) -> Dict:
        """Optimize parameters for a specific training window"""
        
        # Use simplified optimization for speed
        param_space = [
            Integer(10, 25, name='lookback_periods'),
            Real(1.05, 1.3, name='volume_multiplier'),
            Real(0.02, 0.15, name='min_breakout_percent'),
            Real(0.5, 2.0, name='sl_percent'),
            Real(3.0, 10.0, name='tp_percent'),
            Real(0.3, 1.0, name='trailing_stop_percent'),
            Real(10.0, 25.0, name='position_size_percent')
        ]
        
        @use_named_args(param_space)
        def objective(**params):
            # Add fixed parameters
            full_params = self.optimal_params.copy()
            full_params.update(params)
            
            # Test parameters
            result = self._test_parameters(train_data, full_params, symbol)
            
            # Return negative score (since we minimize)
            score = result.get('win_rate', 0) * result.get('total_return_percent', 0) / (result.get('max_drawdown', 1) + 1)
            return -score
        
        if BAYESIAN_AVAILABLE:
            try:
                # Quick optimization with fewer calls for speed
                res = gp_minimize(objective, param_space, n_calls=30, random_state=42)
                
                # Extract best parameters
                best_params = self.optimal_params.copy()
                param_names = [dim.name for dim in param_space]
                for i, param_name in enumerate(param_names):
                    best_params[param_name] = res.x[i]
                
                return best_params
                
            except Exception as e:
                console.print(f"[yellow]⚠️ Optimization failed for window {window_num}: {e}[/yellow]")
                return self.optimal_params.copy()
        else:
            return self.optimal_params.copy()
    
    def _test_parameters(self, test_data: pd.DataFrame, params: Dict, symbol: str) -> Dict:
        """Test parameters on given data"""
        
        if UNIFIED_OPTIMIZER_AVAILABLE:
            try:
                # Use vectorized backtester for speed
                result = VectorizedBacktester.run_fast_backtest(
                    test_data, 'Crypto Breakout', params
                )
                return result
            except Exception as e:
                console.print(f"[yellow]⚠️ Vectorized backtest failed: {e}[/yellow]")
        
        # Fallback to simple backtest
        return self._simple_backtest(test_data, params)
    
    def _simple_backtest(self, df: pd.DataFrame, params: Dict) -> Dict:
        """Simple backtesting implementation"""
        
        # Calculate basic indicators
        df = df.copy()
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        df['high_max'] = df['high'].rolling(window=params['lookback_periods']).max().shift(1)
        df['low_min'] = df['low'].rolling(window=params['lookback_periods']).min().shift(1)
        
        portfolio_value = 10000.0
        trades = []
        position = None
        
        for i in range(params['lookback_periods'], len(df)):
            row = df.iloc[i]
            
            if position is None:
                # Entry conditions
                breakout_up = row['close'] > row['high_max'] * (1 + params['min_breakout_percent']/100)
                volume_ok = row['volume'] > row['volume_ma'] * params['volume_multiplier']
                
                if breakout_up and volume_ok:
                    position = {
                        'type': 'LONG',
                        'entry_price': row['close'],
                        'entry_time': row.name,
                        'size': (portfolio_value * params['position_size_percent'] / 100) / row['close']
                    }
            else:
                # Exit conditions
                current_price = row['close']
                entry_price = position['entry_price']
                
                # Stop loss
                stop_loss = entry_price * (1 - params['sl_percent']/100)
                # Take profit
                take_profit = entry_price * (1 + params['tp_percent']/100)
                
                if current_price <= stop_loss or current_price >= take_profit:
                    # Exit trade
                    exit_price = current_price
                    pnl = position['size'] * (exit_price - entry_price)
                    
                    trades.append({
                        'entry_time': position['entry_time'],
                        'exit_time': row.name,
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'pnl': pnl,
                        'return_pct': (exit_price - entry_price) / entry_price * 100
                    })
                    
                    portfolio_value += pnl
                    position = None
        
        # Calculate metrics
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            # Simple max drawdown
            running_pnl = 0
            max_dd = 0
            peak = 0
            for trade in trades:
                running_pnl += trade['pnl']
                if running_pnl > peak:
                    peak = running_pnl
                drawdown = peak - running_pnl
                if drawdown > max_dd:
                    max_dd = drawdown
            
            max_dd_pct = max_dd / 10000 * 100
            
            total_wins = sum(t['pnl'] for t in trades if t['pnl'] > 0)
            total_losses = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
            profit_factor = total_wins / total_losses if total_losses > 0 else 2.0
            
            return {
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'max_drawdown': max_dd_pct,
                'total_trades': len(trades),
                'profit_factor': profit_factor,
                'trades': trades
            }
        else:
            return {
                'win_rate': 0.0,
                'total_return_percent': 0.0,
                'max_drawdown': 0.0,
                'total_trades': 0,
                'profit_factor': 0.0,
                'trades': []
            }
    
    def _generate_walkforward_report(self, results: Dict, train_days: int, test_days: int, step_days: int):
        """Generate comprehensive walk-forward analysis report"""
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Calculate summary statistics
        summary_stats = {}
        
        for symbol, windows in results.items():
            if not windows:
                continue
                
            win_rates = [w['test_results']['win_rate'] for w in windows]
            returns = [w['test_results']['total_return_percent'] for w in windows]
            drawdowns = [w['test_results']['max_drawdown'] for w in windows]
            trades = [w['test_results']['total_trades'] for w in windows]
            
            summary_stats[symbol] = {
                'total_windows': len(windows),
                'avg_win_rate': np.mean(win_rates),
                'avg_return': np.mean(returns),
                'avg_drawdown': np.mean(drawdowns),
                'avg_trades': np.mean(trades),
                'win_rate_std': np.std(win_rates),
                'return_std': np.std(returns),
                'positive_windows': sum(1 for r in returns if r > 0),
                'consistency_score': (np.mean(returns) / (np.std(returns) + 1)) * (sum(1 for r in returns if r > 0) / len(returns))
            }
        
        # Display summary table
        console.print(f"\n[bold green]📊 WALK-FORWARD ANALYSIS RESULTS[/bold green]")
        
        table = Table(title="Walk-Forward Summary Statistics")
        table.add_column("Symbol", style="cyan")
        table.add_column("Windows", justify="right")
        table.add_column("Avg Win%", justify="right")
        table.add_column("Avg Return%", justify="right") 
        table.add_column("Avg DD%", justify="right")
        table.add_column("Positive Windows", justify="right")
        table.add_column("Consistency", justify="right")
        
        for symbol, stats in summary_stats.items():
            positive_pct = stats['positive_windows'] / stats['total_windows'] * 100
            table.add_row(
                symbol,
                str(stats['total_windows']),
                f"{stats['avg_win_rate']:.1f}",
                f"{stats['avg_return']:.1f}",
                f"{stats['avg_drawdown']:.1f}",
                f"{positive_pct:.0f}%",
                f"{stats['consistency_score']:.2f}"
            )
        
        console.print(table)
        
        # Save detailed results
        filename = f"crypto_breakout_walkforward_{timestamp}.json"
        
        save_data = {
            'timestamp': timestamp,
            'parameters': {
                'train_days': train_days,
                'test_days': test_days,
                'step_days': step_days,
                'symbols': self.symbols
            },
            'optimal_params': self.optimal_params,
            'summary_statistics': summary_stats,
            'detailed_results': results
        }
        
        with open(filename, 'w') as f:
            json.dump(save_data, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Walk-forward results saved to: {filename}[/green]")
        
        # Performance insights
        self._display_insights(summary_stats)
    
    def _display_insights(self, summary_stats: Dict):
        """Display insights from walk-forward analysis"""
        
        console.print(f"\n[bold yellow]💡 WALK-FORWARD INSIGHTS[/bold yellow]")
        
        insights = []
        
        # Overall performance
        avg_consistency = np.mean([stats['consistency_score'] for stats in summary_stats.values()])
        avg_positive_rate = np.mean([stats['positive_windows'] / stats['total_windows'] for stats in summary_stats.values()])
        
        if avg_consistency > 0.5:
            insights.append("✅ Strategy shows good consistency across time periods")
        else:
            insights.append("⚠️ Strategy performance varies significantly across time periods")
            
        if avg_positive_rate > 0.6:
            insights.append("✅ Strategy is profitable in majority of test periods")
        else:
            insights.append("⚠️ Strategy struggles in many test periods - consider parameter adjustment")
        
        # Best and worst performers
        if summary_stats:
            best_symbol = max(summary_stats.keys(), key=lambda s: summary_stats[s]['consistency_score'])
            worst_symbol = min(summary_stats.keys(), key=lambda s: summary_stats[s]['consistency_score'])
            
            insights.append(f"🏆 Best performing symbol: {best_symbol}")
            insights.append(f"📉 Needs improvement: {worst_symbol}")
        
        for insight in insights:
            console.print(f"   {insight}")
        
        # Recommendations
        console.print(f"\n[bold cyan]🎯 RECOMMENDATIONS[/bold cyan]")
        
        if avg_consistency < 0.3:
            console.print("   📝 Consider more frequent parameter re-optimization")
            console.print("   📝 Evaluate market regime filters")
            console.print("   📝 Consider reducing position sizes during volatile periods")
        elif avg_consistency > 0.7:
            console.print("   📝 Strategy shows strong robustness - suitable for live trading")
            console.print("   📝 Consider increasing position sizes gradually")
        else:
            console.print("   📝 Strategy shows moderate consistency - monitor closely")
            console.print("   📝 Consider implementing adaptive position sizing")

def main():
    """Main function to run walk-forward analysis"""
    
    console.print(Panel.fit(
        "[bold cyan]🚀 CRYPTO BREAKOUT WALK-FORWARD ANALYSIS[/bold cyan]\n"
        "Validate strategy robustness across time periods\n"
        "Test optimal parameters on rolling windows",
        border_style="cyan"
    ))
    
    # Initialize walk-forward analyzer
    analyzer = CryptoBreakoutWalkForward()
    
    # Load historical data
    analyzer.load_historical_data(days_back=180)  # 6 months of data
    
    # Run walk-forward analysis
    results = analyzer.run_walk_forward_analysis(
        train_days=30,      # 30 days training
        test_days=7,        # 7 days testing  
        step_days=7,        # Step forward 1 week
        optimize_every_step=False  # Use fixed optimal parameters for speed
    )
    
    console.print(f"\n[bold green]🎊 Walk-forward analysis complete![/bold green]")

if __name__ == "__main__":
    main() 
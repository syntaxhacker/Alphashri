#!/usr/bin/env python3
"""
Iterative Strategy Tester - Uses cached data to quickly test and optimize BarUpDn strategy
Focus on improving win rate through rapid parameter testing
"""

import itertools
import json
import time
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import pandas as pd
import numpy as np
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel
from pathlib import Path
import concurrent.futures
from dataclasses import asdict, dataclass
import warnings

# Import our enhanced modules
from enhanced_data_fetcher import EnhancedDataFetcher
from bar_updn_extreme_backtest import BarUpDnStrategy, BarUpDnBacktester, BacktestResult, TradeResult

warnings.filterwarnings('ignore')
console = Console()

@dataclass
class OptimizationResult:
    """Results from parameter optimization"""
    parameters: Dict
    win_rate: float
    total_return_percent: float
    sharpe_ratio: float
    max_drawdown: float
    total_trades: int
    avg_trade_duration_minutes: float
    profit_factor: float  # Total wins / Total losses
    expectancy: float  # Average profit per trade
    score: float  # Combined optimization score

class IterativeStrategyTester:
    """Fast iterative testing using cached data"""
    
    def __init__(self, symbols: List[str] = ["BTCUSDT", "ETHUSDT"], 
                 days_back: int = 30, api_key: str = None, api_secret: str = None):
        self.symbols = symbols
        self.days_back = days_back
        self.fetcher = EnhancedDataFetcher(api_key, api_secret)
        self.cached_data = {}
        
        console.print("[bold cyan]🧪 Iterative Strategy Tester Initialized[/bold cyan]")
        self._load_cached_data()
    
    def _load_cached_data(self):
        """Load data from cache (should be fast)"""
        console.print("[cyan]📊 Loading cached data...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days_back)
        
        for symbol in self.symbols:
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date)
                if df is not None and not df.empty:
                    self.cached_data[symbol] = df
                    console.print(f"[green]✓ {symbol}: {len(df):,} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error loading data - {str(e)}[/red]")
                
        if not self.cached_data:
            console.print("[red]❌ No cached data available! Run data download first.[/red]")
        else:
            console.print(f"[green]✅ {len(self.cached_data)} symbols ready for testing[/green]")
    
    def _calculate_enhanced_metrics(self, result: BacktestResult) -> Dict:
        """Calculate additional metrics for optimization"""
        if not result.trades:
            return {
                'profit_factor': 0,
                'expectancy': 0,
                'avg_trade_duration_minutes': 0
            }
        
        # Calculate profit factor (Total wins / Total losses)
        total_wins = sum(trade.pnl for trade in result.trades if trade.pnl > 0)
        total_losses = abs(sum(trade.pnl for trade in result.trades if trade.pnl < 0))
        profit_factor = total_wins / total_losses if total_losses > 0 else float('inf')
        
        # Calculate expectancy (average profit per trade)
        expectancy = sum(trade.pnl for trade in result.trades) / len(result.trades)
        
        # Calculate average trade duration
        durations = []
        for trade in result.trades:
            duration = (trade.exit_time - trade.entry_time).total_seconds() / 60  # minutes
            durations.append(duration)
        
        avg_duration = np.mean(durations) if durations else 0
        
        return {
            'profit_factor': profit_factor,
            'expectancy': expectancy,
            'avg_trade_duration_minutes': avg_duration
        }
    
    def _calculate_optimization_score(self, result: BacktestResult, enhanced_metrics: Dict) -> float:
        """Calculate optimization score focusing on win rate and risk management"""
        
        # Base score components
        win_rate_score = result.win_rate / 100  # 0-1
        return_score = max(0, result.total_return_percent) / 100  # Positive returns only
        
        # Risk management scores
        drawdown_penalty = max(0, (20 - result.max_drawdown) / 20)  # Penalize drawdown > 20%
        trade_count_bonus = min(1, result.total_trades / 50)  # Bonus for having enough trades
        
        # Sharpe ratio component (handle NaN)
        sharpe_component = max(0, result.sharpe_ratio) / 3 if not np.isnan(result.sharpe_ratio) else 0
        
        # Profit factor component
        profit_factor_score = min(1, enhanced_metrics['profit_factor'] / 2)  # Cap at 2.0
        
        # Expectancy component
        expectancy_score = max(0, enhanced_metrics['expectancy'] / 50)  # Normalize expectancy
        
        # Combined score with weights
        score = (
            win_rate_score * 0.35 +          # 35% weight on win rate
            return_score * 0.20 +            # 20% weight on returns
            drawdown_penalty * 0.15 +        # 15% weight on drawdown control
            sharpe_component * 0.10 +        # 10% weight on risk-adjusted returns
            profit_factor_score * 0.10 +     # 10% weight on profit factor
            expectancy_score * 0.05 +        # 5% weight on expectancy
            trade_count_bonus * 0.05         # 5% weight on having enough trades
        )
        
        return score
    
    def test_parameter_set(self, params: Dict) -> List[OptimizationResult]:
        """Test a single parameter set across all symbols"""
        results = []
        
        for symbol, df in self.cached_data.items():
            try:
                # Create strategy with these parameters
                strategy = BarUpDnStrategy(
                    sl_percent=params['sl_percent'],
                    trailing_stop_percent=params['trailing_stop_percent'],
                    position_size_percent=params['position_size_percent'],
                    max_intraday_loss_percent=params['max_intraday_loss_percent'],
                    min_hold_minutes=params.get('min_hold_minutes', 15)
                )
                
                # Run backtest
                backtester = BarUpDnBacktester(initial_capital=10000)
                backtester.strategy = strategy
                result = backtester.run_backtest(df, symbol, show_progress=False)
                
                # Calculate enhanced metrics
                enhanced_metrics = self._calculate_enhanced_metrics(result)
                
                # Calculate optimization score
                score = self._calculate_optimization_score(result, enhanced_metrics)
                
                # Create optimization result
                opt_result = OptimizationResult(
                    parameters=params.copy(),
                    win_rate=result.win_rate,
                    total_return_percent=result.total_return_percent,
                    sharpe_ratio=result.sharpe_ratio if not np.isnan(result.sharpe_ratio) else 0,
                    max_drawdown=result.max_drawdown,
                    total_trades=result.total_trades,
                    avg_trade_duration_minutes=enhanced_metrics['avg_trade_duration_minutes'],
                    profit_factor=enhanced_metrics['profit_factor'],
                    expectancy=enhanced_metrics['expectancy'],
                    score=score
                )
                
                results.append(opt_result)
                
            except Exception as e:
                console.print(f"[red]Error testing {symbol} with params {params}: {str(e)}[/red]")
                continue
        
        return results
    
    def run_iterative_optimization(self, 
                                  max_iterations: int = 50,
                                  target_win_rate: float = 65.0,
                                  parameter_ranges: Dict = None) -> List[OptimizationResult]:
        """Run iterative optimization to improve win rate"""
        
        if parameter_ranges is None:
            parameter_ranges = {
                'sl_percent': [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0],
                'trailing_stop_percent': [0.3, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0],
                'position_size_percent': [5.0, 8.0, 10.0, 12.0, 15.0],
                'max_intraday_loss_percent': [1.0, 1.5, 2.0, 2.5, 3.0],
                'min_hold_minutes': [5, 10, 15, 20, 30]
            }
        
        console.print(Panel.fit(
            f"[bold cyan]🔄 Iterative Parameter Optimization[/bold cyan]\n"
            f"Max Iterations: {max_iterations}\n"
            f"Target Win Rate: {target_win_rate}%\n"
            f"Symbols: {', '.join(self.symbols)}\n"
            f"Cached Data: {sum(len(df) for df in self.cached_data.values()):,} total bars",
            border_style="cyan"
        ))
        
        best_results = []
        iteration = 0
        
        # Generate initial parameter combinations (random sampling for speed)
        all_combinations = list(itertools.product(*parameter_ranges.values()))
        
        # If too many combinations, sample randomly
        if len(all_combinations) > max_iterations:
            import random
            random.seed(42)  # Reproducible results
            test_combinations = random.sample(all_combinations, max_iterations)
        else:
            test_combinations = all_combinations[:max_iterations]
        
        param_keys = list(parameter_ranges.keys())
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Optimizing parameters...", total=len(test_combinations))
            
            for combo in test_combinations:
                iteration += 1
                
                # Create parameter dictionary
                params = dict(zip(param_keys, combo))
                
                # Test this parameter set
                results = self.test_parameter_set(params)
                
                if results:
                    # Calculate average metrics across symbols
                    avg_win_rate = np.mean([r.win_rate for r in results])
                    avg_score = np.mean([r.score for r in results])
                    
                    # Create combined result
                    combined_result = OptimizationResult(
                        parameters=params,
                        win_rate=avg_win_rate,
                        total_return_percent=np.mean([r.total_return_percent for r in results]),
                        sharpe_ratio=np.mean([r.sharpe_ratio for r in results]),
                        max_drawdown=np.mean([r.max_drawdown for r in results]),
                        total_trades=sum([r.total_trades for r in results]),
                        avg_trade_duration_minutes=np.mean([r.avg_trade_duration_minutes for r in results]),
                        profit_factor=np.mean([r.profit_factor for r in results if r.profit_factor != float('inf')]),
                        expectancy=np.mean([r.expectancy for r in results]),
                        score=avg_score
                    )
                    
                    best_results.append(combined_result)
                    
                    # Check if we've reached target win rate
                    if avg_win_rate >= target_win_rate:
                        console.print(f"[green]🎯 Target win rate achieved: {avg_win_rate:.1f}%[/green]")
                
                progress.update(task, advance=1)
        
        # Sort by score (best first)
        best_results.sort(key=lambda x: x.score, reverse=True)
        
        return best_results
    
    def display_optimization_results(self, results: List[OptimizationResult], top_n: int = 10):
        """Display optimization results in a nice table"""
        
        if not results:
            console.print("[red]No optimization results to display[/red]")
            return
        
        # Best result summary
        best = results[0]
        console.print(Panel.fit(
            f"[bold green]🏆 BEST PARAMETERS FOUND[/bold green]\n\n"
            f"Stop Loss: {best.parameters['sl_percent']}%\n"
            f"Trailing Stop: {best.parameters['trailing_stop_percent']}%\n"
            f"Position Size: {best.parameters['position_size_percent']}%\n"
            f"Max Daily Loss: {best.parameters['max_intraday_loss_percent']}%\n"
            f"Min Hold Time: {best.parameters['min_hold_minutes']} minutes\n\n"
            f"[cyan]Performance:[/cyan]\n"
            f"Win Rate: {best.win_rate:.1f}%\n"
            f"Return: {best.total_return_percent:.2f}%\n"
            f"Max Drawdown: {best.max_drawdown:.2f}%\n"
            f"Profit Factor: {best.profit_factor:.2f}\n"
            f"Expectancy: ${best.expectancy:.2f}\n"
            f"Score: {best.score:.4f}",
            border_style="green"
        ))
        
        # Top results table
        table = Table(title=f"Top {min(top_n, len(results))} Parameter Combinations")
        table.add_column("Rank", style="cyan", width=4)
        table.add_column("SL%", style="yellow", width=5)
        table.add_column("Trail%", style="yellow", width=6)
        table.add_column("Pos%", style="yellow", width=5)
        table.add_column("MaxLoss%", style="yellow", width=8)
        table.add_column("Hold(m)", style="yellow", width=7)
        table.add_column("Win Rate%", style="green", width=9)
        table.add_column("Return%", style="green", width=8)
        table.add_column("Drawdown%", style="red", width=10)
        table.add_column("PF", style="green", width=6)
        table.add_column("Score", style="bold green", width=8)
        
        for i, result in enumerate(results[:top_n], 1):
            p = result.parameters
            
            table.add_row(
                str(i),
                f"{p['sl_percent']:.1f}",
                f"{p['trailing_stop_percent']:.1f}",
                f"{p['position_size_percent']:.0f}",
                f"{p['max_intraday_loss_percent']:.1f}",
                f"{p['min_hold_minutes']}",
                f"{result.win_rate:.1f}",
                f"{result.total_return_percent:.2f}",
                f"{result.max_drawdown:.2f}",
                f"{result.profit_factor:.2f}",
                f"{result.score:.4f}"
            )
        
        console.print(table)
    
    def save_optimization_results(self, results: List[OptimizationResult], filename: str = None):
        """Save optimization results to JSON file"""
        if filename is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"iterative_optimization_results_{timestamp}.json"
        
        # Convert results to JSON-serializable format
        json_results = []
        for result in results:
            json_results.append(asdict(result))
        
        with open(filename, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'symbols': self.symbols,
                'days_back': self.days_back,
                'total_results': len(json_results),
                'results': json_results
            }, f, indent=2)
        
        console.print(f"[green]✓ Results saved to {filename}[/green]")
    
    def run_focused_win_rate_optimization(self, current_win_rate: float = 45.0) -> List[OptimizationResult]:
        """Run focused optimization specifically to improve win rate"""
        
        console.print(f"[bold yellow]🎯 Focused Win Rate Optimization[/bold yellow]")
        console.print(f"Current Win Rate: {current_win_rate:.1f}%")
        console.print(f"Target: Improve by 10-20 percentage points")
        
        # Focused parameter ranges for win rate improvement
        focused_ranges = {
            # Tighter stop losses to reduce losing trade size
            'sl_percent': [1.0, 1.5, 2.0, 2.5],
            # More aggressive trailing stops to lock in profits
            'trailing_stop_percent': [0.3, 0.5, 0.8, 1.0],
            # Smaller position sizes for better risk management
            'position_size_percent': [3.0, 5.0, 8.0, 10.0],
            # Stricter daily loss limits
            'max_intraday_loss_percent': [0.5, 1.0, 1.5],
            # Longer minimum hold times to avoid noise
            'min_hold_minutes': [15, 20, 30, 45]
        }
        
        return self.run_iterative_optimization(
            max_iterations=200,
            target_win_rate=current_win_rate + 15,  # Aim for 15% improvement
            parameter_ranges=focused_ranges
        )

def main():
    """Main function for testing"""
    console.print("[bold blue]🧪 BarUpDn Iterative Strategy Tester[/bold blue]")
    
    # Use your API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize tester
    tester = IterativeStrategyTester(
        symbols=["BTCUSDT", "ETHUSDT"],
        days_back=30,  # Test with 30 days of data
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not tester.cached_data:
        console.print("[red]❌ No cached data available. Please run the main optimization first to download data.[/red]")
        return
    
    # Run optimization
    console.print("\n[bold cyan]🚀 Starting iterative optimization...[/bold cyan]")
    results = tester.run_iterative_optimization(max_iterations=100)
    
    # Display results
    tester.display_optimization_results(results, top_n=15)
    
    # Save results
    tester.save_optimization_results(results)
    
    # Check if we should run focused win rate optimization
    if results and results[0].win_rate < 60:
        console.print(f"\n[yellow]🎯 Win rate is {results[0].win_rate:.1f}% - Running focused optimization...[/yellow]")
        focused_results = tester.run_focused_win_rate_optimization(results[0].win_rate)
        
        if focused_results:
            console.print("\n[bold green]🎯 Focused Optimization Results:[/bold green]")
            tester.display_optimization_results(focused_results, top_n=10)
            
            # Save focused results
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            tester.save_optimization_results(focused_results, f"focused_optimization_{timestamp}.json")

if __name__ == "__main__":
    main() 
#!/usr/bin/env python3
"""
Quick Strategy Optimizer - Fast iterative parameter testing using cached data
Focus on improving win rate without affecting main optimization process
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
from dataclasses import dataclass
import warnings

# Import our modules
from enhanced_data_fetcher import EnhancedDataFetcher
from bar_updn_extreme_backtest import BarUpDnStrategy, BarUpDnBacktester, BacktestResult

warnings.filterwarnings('ignore')
console = Console()

@dataclass
class QuickResult:
    """Simplified result for quick testing"""
    parameters: Dict
    win_rate: float
    total_return_percent: float
    max_drawdown: float
    total_trades: int
    profit_factor: float
    score: float

class QuickStrategyOptimizer:
    """Fast parameter testing using cached data"""
    
    def __init__(self, symbols: List[str] = ["BTCUSDT", "ETHUSDT"], 
                 days_back: int = 20, api_key: str = None, api_secret: str = None):
        self.symbols = symbols
        self.days_back = days_back
        self.fetcher = EnhancedDataFetcher(api_key, api_secret)
        self.cached_data = {}
        
        console.print("[bold cyan]⚡ Quick Strategy Optimizer Initialized[/bold cyan]")
        self._load_cached_data()
    
    def _load_cached_data(self):
        """Load data from cache (should be very fast now)"""
        console.print("[cyan]📊 Loading cached data...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days_back)
        
        total_bars = 0
        start_time = time.time()
        
        for symbol in self.symbols:
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date)
                if df is not None and not df.empty:
                    self.cached_data[symbol] = df
                    total_bars += len(df)
                    console.print(f"[green]✓ {symbol}: {len(df):,} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error loading data - {str(e)}[/red]")
        
        load_time = time.time() - start_time
        
        if not self.cached_data:
            console.print("[red]❌ No cached data available! Run main optimization first.[/red]")
        else:
            console.print(f"[green]✅ {len(self.cached_data)} symbols ready ({total_bars:,} total bars in {load_time:.2f}s)[/green]")
    
    def test_quick_parameters(self, param_set: Dict) -> QuickResult:
        """Test a single parameter set quickly"""
        results = []
        
        for symbol, df in self.cached_data.items():
            try:
                # Create strategy
                strategy = BarUpDnStrategy(
                    sl_percent=param_set['sl_percent'],
                    trailing_stop_percent=param_set['trailing_stop_percent'],
                    position_size_percent=param_set['position_size_percent'],
                    max_intraday_loss_percent=param_set['max_intraday_loss_percent'],
                    min_hold_minutes=param_set.get('min_hold_minutes', 15)
                )
                
                # Run backtest
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
                
            except Exception as e:
                continue
        
        if not results:
            return None
        
        # Calculate averages
        avg_win_rate = np.mean([r['win_rate'] for r in results])
        avg_return = np.mean([r['total_return_percent'] for r in results])
        avg_drawdown = np.mean([r['max_drawdown'] for r in results])
        total_trades = sum([r['total_trades'] for r in results])
        avg_profit_factor = np.mean([r['profit_factor'] for r in results])
        
        # Calculate score (focused on win rate)
        score = (
            avg_win_rate * 0.4 +                           # 40% win rate
            max(0, avg_return) * 0.3 +                     # 30% returns
            max(0, (15 - avg_drawdown)) * 0.2 +            # 20% drawdown control
            min(20, avg_profit_factor) * 0.1               # 10% profit factor
        )
        
        return QuickResult(
            parameters=param_set.copy(),
            win_rate=avg_win_rate,
            total_return_percent=avg_return,
            max_drawdown=avg_drawdown,
            total_trades=total_trades,
            profit_factor=avg_profit_factor,
            score=score
        )
    
    def run_quick_optimization(self, max_tests: int = 100) -> List[QuickResult]:
        """Run quick parameter optimization"""
        
        # Define focused parameter ranges for win rate improvement
        param_ranges = {
            'sl_percent': [1.5, 2.0, 2.5, 3.0, 3.5, 4.0],        # Stop loss
            'trailing_stop_percent': [0.5, 0.8, 1.0, 1.2, 1.5],   # Trailing stop
            'position_size_percent': [5.0, 8.0, 10.0, 12.0],      # Position size
            'max_intraday_loss_percent': [1.0, 1.5, 2.0, 2.5],    # Daily loss limit
            'min_hold_minutes': [60 , 90, 120]                               # Fixed to 1 hour (60 minutes)
        }
        
        console.print(Panel.fit(
            f"[bold cyan]⚡ Quick Parameter Optimization[/bold cyan]\n"
            f"Max Tests: {max_tests}\n"
            f"Symbols: {', '.join(self.symbols)}\n"
            f"Data Period: {self.days_back} days\n"
            f"Total Bars: {sum(len(df) for df in self.cached_data.values()):,}",
            border_style="cyan"
        ))
        
        # Generate parameter combinations
        all_combinations = list(itertools.product(*param_ranges.values()))
        
        # Sample if too many
        if len(all_combinations) > max_tests:
            import random
            random.seed(42)
            test_combinations = random.sample(all_combinations, max_tests)
        else:
            test_combinations = all_combinations
        
        param_keys = list(param_ranges.keys())
        results = []
        
        start_time = time.time()
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Testing parameters...", total=len(test_combinations))
            
            for combo in test_combinations:
                # Create parameter set
                param_set = dict(zip(param_keys, combo))
                
                # Test this parameter set
                result = self.test_quick_parameters(param_set)
                
                if result:
                    results.append(result)
                
                progress.update(task, advance=1)
        
        total_time = time.time() - start_time
        
        # Sort by score
        results.sort(key=lambda x: x.score, reverse=True)
        
        console.print(f"[green]✓ Completed {len(results)} tests in {total_time:.2f}s ({len(results)/total_time:.1f} tests/sec)[/green]")
        
        return results
    
    def display_results(self, results: List[QuickResult], top_n: int = 10):
        """Display optimization results"""
        
        if not results:
            console.print("[red]No results to display[/red]")
            return
        
        # Best result summary
        best = results[0]
        console.print(Panel.fit(
            f"[bold green]🏆 BEST PARAMETERS (Quick Test)[/bold green]\n\n"
            f"Stop Loss: {best.parameters['sl_percent']}%\n"
            f"Trailing Stop: {best.parameters['trailing_stop_percent']}%\n"
            f"Position Size: {best.parameters['position_size_percent']}%\n"
            f"Max Daily Loss: {best.parameters['max_intraday_loss_percent']}%\n"
            f"Min Hold Time: {best.parameters['min_hold_minutes']} minutes\n\n"
            f"[cyan]Performance:[/cyan]\n"
            f"Win Rate: {best.win_rate:.1f}%\n"
            f"Return: {best.total_return_percent:.2f}%\n"
            f"Max Drawdown: {best.max_drawdown:.2f}%\n"
            f"Total Trades: {best.total_trades}\n"
            f"Profit Factor: {best.profit_factor:.2f}\n"
            f"Score: {best.score:.2f}",
            border_style="green"
        ))
        
        # Top results table
        table = Table(title=f"Top {min(top_n, len(results))} Quick Test Results")
        table.add_column("Rank", style="cyan", width=4)
        table.add_column("SL%", style="yellow", width=5)
        table.add_column("Trail%", style="yellow", width=6)
        table.add_column("Pos%", style="yellow", width=5)
        table.add_column("MaxLoss%", style="yellow", width=8)
        table.add_column("Hold(m)", style="yellow", width=7)
        table.add_column("Win Rate%", style="green", width=9)
        table.add_column("Return%", style="green", width=8)
        table.add_column("Trades", style="cyan", width=7)
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
                f"{result.total_trades}",
                f"{result.score:.2f}"
            )
        
        console.print(table)
    
    def save_results(self, results: List[QuickResult]):
        """Save results to JSON"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"quick_optimization_{timestamp}.json"
        
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
                'score': result.score
            })
        
        with open(filename, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'symbols': self.symbols,
                'days_back': self.days_back,
                'total_results': len(json_results),
                'results': json_results
            }, f, indent=2)
        
        console.print(f"[green]✓ Results saved to {filename}[/green]")

def main():
    """Main function"""
    console.print("[bold blue]⚡ Quick BarUpDn Strategy Optimizer[/bold blue]")
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize optimizer
    optimizer = QuickStrategyOptimizer(
        symbols=["BTCUSDT", "ETHUSDT"],
        days_back=7,  # Use 20 days for quick testing
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No cached data available. Please run main optimization first to download data.[/red]")
        console.print("[yellow]💡 Run: python run_optimization.py[/yellow]")
        return
    
    # Run quick optimization
    console.print("\n[bold cyan]🚀 Starting quick optimization...[/bold cyan]")
    results = optimizer.run_quick_optimization(max_tests=150)
    
    # Display results
    if results:
        optimizer.display_results(results, top_n=15)
        optimizer.save_results(results)
        
        # Check if we found good win rates
        best_win_rate = results[0].win_rate
        if best_win_rate >= 60:
            console.print(f"\n[bold green]🎉 Great! Found parameters with {best_win_rate:.1f}% win rate![/bold green]")
        elif best_win_rate >= 50:
            console.print(f"\n[bold yellow]👍 Good! Found parameters with {best_win_rate:.1f}% win rate. Keep optimizing![/bold yellow]")
        else:
            console.print(f"\n[bold red]📈 Current best: {best_win_rate:.1f}% win rate. Need more optimization.[/bold red]")
            console.print("[yellow]💡 Try running with more data or different parameter ranges.[/yellow]")
    else:
        console.print("[red]❌ No valid results found. Check your data and parameters.[/red]")

if __name__ == "__main__":
    main() 
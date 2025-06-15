#!/usr/bin/env python3
"""
Smart Strategy Optimizer - Using Bayesian Optimization for intelligent parameter search
Much faster and more effective than grid search
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
        self.optimization_history = []
        self.best_score = -np.inf
        self.no_improvement_count = 0
        
        console.print("[bold cyan]🧠 Smart Strategy Optimizer Initialized[/bold cyan]")
        self._check_dependencies()
        self._load_cached_data()
    
    def _check_dependencies(self):
        """Check if required packages are installed"""
        if not BAYESIAN_AVAILABLE:
            console.print("[red]❌ scikit-optimize not installed![/red]")
            console.print("[yellow]Install with: pip install scikit-optimize[/yellow]")
            raise ImportError("scikit-optimize is required for Bayesian optimization")
        
        console.print("[green]✓ Bayesian optimization libraries available[/green]")
    
    def _load_cached_data(self):
        """Load data from cache"""
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
            console.print("[red]❌ No cached data available![/red]")
        else:
            console.print(f"[green]✅ {len(self.cached_data)} symbols ready ({total_bars:,} total bars in {load_time:.2f}s)[/green]")
    
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
    
    def evaluate_parameters(self, params: List[float]) -> float:
        """Evaluate a parameter set and return negative score (for minimization)"""
        sl_percent, trailing_stop_percent, position_size_percent, max_intraday_loss_percent, min_hold_minutes = params
        
        param_dict = {
            'sl_percent': sl_percent,
            'trailing_stop_percent': trailing_stop_percent,
            'position_size_percent': position_size_percent,
            'max_intraday_loss_percent': max_intraday_loss_percent,
            'min_hold_minutes': int(min_hold_minutes)
        }
        
        results = []
        all_trades = []
        
        for symbol, df in self.cached_data.items():
            try:
                # Create strategy
                strategy = BarUpDnStrategy(
                    sl_percent=sl_percent,
                    trailing_stop_percent=trailing_stop_percent,
                    position_size_percent=position_size_percent,
                    max_intraday_loss_percent=max_intraday_loss_percent,
                    min_hold_minutes=int(min_hold_minutes)
                )
                
                # Run backtest
                backtester = BarUpDnBacktester(initial_capital=10000)
                backtester.strategy = strategy
                result = backtester.run_backtest(df, symbol, show_progress=False)
                
                # Calculate metrics
                if result.trades:
                    total_wins = sum(trade.pnl for trade in result.trades if trade.pnl > 0)
                    total_losses = abs(sum(trade.pnl for trade in result.trades if trade.pnl < 0))
                    profit_factor = total_wins / total_losses if total_losses > 0 else 2.0
                    all_trades.extend(result.trades)
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
            return 1000.0  # Large penalty for failed parameter sets
        
        # Calculate averages
        avg_win_rate = np.mean([r['win_rate'] for r in results])
        avg_return = np.mean([r['total_return_percent'] for r in results])
        avg_drawdown = np.mean([r['max_drawdown'] for r in results])
        total_trades = sum([r['total_trades'] for r in results])
        avg_profit_factor = np.mean([r['profit_factor'] for r in results])
        sharpe_ratio = self._calculate_sharpe_ratio(all_trades)
        
        # Enhanced scoring function
        score = (
            avg_win_rate * 0.35 +                          # 35% win rate
            max(0, avg_return) * 0.25 +                    # 25% returns
            max(0, (20 - avg_drawdown)) * 0.20 +           # 20% drawdown control
            min(15, avg_profit_factor) * 0.10 +            # 10% profit factor
            min(10, max(0, sharpe_ratio)) * 0.10           # 10% sharpe ratio
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
        
        # Define search space - optimized for balanced opposite signal exits
        space = [
            Real(1.0, 3.0, name='sl_percent'),                    # Stop loss (max 3% as requested)
            Real(0.5, 1.5, name='trailing_stop_percent'),         # Trailing stop (min 1.5% for max profits)
            Real(5.0, 15.0, name='position_size_percent'),        # Position size (wider range for flexibility)
            Real(0.5, 2.0, name='max_intraday_loss_percent'),     # Max daily loss (wider range)
            Integer(60, 100, name='min_hold_minutes')              # Fixed to 1 hour (60 minutes)
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
                
                # Early stopping
                if self.no_improvement_count >= 30:
                    console.print(f"\n[yellow]⏹️  Early stopping: No improvement for 30 iterations[/yellow]")
                    return True  # Stop optimization
                
                # Show current best every 20 iterations
                if len(self.optimization_history) % 20 == 0 and self.optimization_history:
                    best = max(self.optimization_history, key=lambda x: x.score)
                    console.print(f"\n[green]Current best (iter {len(self.optimization_history)}): "
                                f"Score {best.score:.2f}, Win Rate {best.win_rate:.1f}%[/green]")
            
            # Run optimization
            result = gp_minimize(
                func=self.evaluate_parameters,
                dimensions=space,
                n_calls=n_calls,
                random_state=random_state,
                callback=progress_callback,
                acq_func="EI",  # Expected Improvement
                n_initial_points=20,  # Random exploration first
                acq_optimizer="sampling"
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
                    np.random.uniform(1.0, 3.0),      # sl_percent (corrected)
                    np.random.uniform(1.5, 3.0),      # trailing_stop_percent (corrected)
                    np.random.uniform(3.0, 15.0),     # position_size_percent
                    np.random.uniform(0.5, 2.0),      # max_intraday_loss_percent (corrected)
                    np.random.randint(5, 31)          # min_hold_minutes (balanced range)
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
    
    def save_results(self, results: List[OptimizationResult], method: str = "bayesian"):
        """Save results to JSON with enhanced metadata"""
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
    
    def _generate_simple_html_report(self, all_results: Dict, best_params: Dict, detailed_results: List) -> str:
        """Generate a simple HTML report with charts and analysis"""
        
        # Prepare trade data for each symbol
        trades_data = {}
        equity_data = {}
        
        for symbol, data in all_results.items():
            result = data['result']
            df = data['data']
            
            # Prepare trade data
            trades_list = []
            for i, trade in enumerate(result.trades, 1):
                trades_list.append({
                    'id': i,
                    'entry_time': trade.entry_time.strftime('%Y-%m-%d %H:%M:%S'),
                    'exit_time': trade.exit_time.strftime('%Y-%m-%d %H:%M:%S'),
                    'side': trade.side,
                    'entry_price': f"{trade.entry_price:.4f}",
                    'exit_price': f"{trade.exit_price:.4f}",
                    'pnl': f"{trade.pnl:.2f}",
                    'pnl_percent': f"{trade.pnl_percent:.2f}%",
                    'exit_reason': trade.exit_reason
                })
            
            trades_data[symbol] = trades_list
            
            # Prepare equity curve data
            equity_curve = result.equity_curve.reset_index()
            equity_data[symbol] = {
                'timestamps': [ts.strftime('%Y-%m-%d %H:%M:%S') for ts in equity_curve['timestamp']],
                'equity': equity_curve['equity'].tolist(),
                'returns': [f"{ret:.2f}%" for ret in ((equity_curve['equity'] / 10000 - 1) * 100)]
            }
        
        # Calculate overall performance
        total_return = sum([r['total_return_percent'] for r in detailed_results])
        avg_win_rate = sum([r['win_rate'] for r in detailed_results]) / len(detailed_results)
        total_trades = sum([r['total_trades'] for r in detailed_results])
        
        # Generate HTML content
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smart Bayesian Optimization - Detailed Backtest Results</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }}
        
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }}
        
        .header {{
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            text-align: center;
        }}
        
        .header h1 {{
            color: #2c3e50;
            margin-bottom: 10px;
            font-size: 2.5em;
        }}
        
        .header .subtitle {{
            color: #7f8c8d;
            font-size: 1.2em;
            margin-bottom: 20px;
        }}
        
        .params-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }}
        
        .param-card {{
            background: #f8f9fa;
            padding: 15px;
            border-radius: 10px;
            text-align: center;
            border-left: 4px solid #3498db;
        }}
        
        .param-label {{
            font-size: 0.9em;
            color: #666;
            margin-bottom: 5px;
        }}
        
        .param-value {{
            font-size: 1.3em;
            font-weight: bold;
            color: #2c3e50;
        }}
        
        .content-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 30px;
        }}
        
        .card {{
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }}
        
        .card h2 {{
            color: #2c3e50;
            margin-bottom: 20px;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
        }}
        
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }}
        
        .metric {{
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
        }}
        
        .metric-value {{
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        
        .metric-label {{
            font-size: 0.9em;
            color: #666;
        }}
        
        .positive {{ color: #27ae60; }}
        .negative {{ color: #e74c3c; }}
        .neutral {{ color: #3498db; }}
        
        .symbol-tabs {{
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }}
        
        .symbol-tab {{
            padding: 10px 20px;
            background: #ecf0f1;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s ease;
        }}
        
        .symbol-tab.active {{
            background: #3498db;
            color: white;
        }}
        
        .symbol-content {{
            display: none;
        }}
        
        .symbol-content.active {{
            display: block;
        }}
        
        .chart-container {{
            height: 400px;
            margin-bottom: 20px;
        }}
        
        .trades-table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }}
        
        .trades-table th,
        .trades-table td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        
        .trades-table th {{
            background: #f8f9fa;
            font-weight: bold;
            color: #2c3e50;
        }}
        
        .trades-table tr:hover {{
            background: #f8f9fa;
        }}
        
        .trade-profit {{ color: #27ae60; }}
        .trade-loss {{ color: #e74c3c; }}
        
        @media (max-width: 768px) {{
            .content-grid {{
                grid-template-columns: 1fr;
            }}
            
            .params-grid {{
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧠 Smart Bayesian Optimization Results</h1>
            <div class="subtitle">Detailed Backtest Analysis with Optimal Parameters</div>
            
            <div class="params-grid">
                <div class="param-card">
                    <div class="param-label">Stop Loss</div>
                    <div class="param-value">{best_params['sl_percent']:.2f}%</div>
                </div>
                <div class="param-card">
                    <div class="param-label">Trailing Stop</div>
                    <div class="param-value">{best_params['trailing_stop_percent']:.2f}%</div>
                </div>
                <div class="param-card">
                    <div class="param-label">Position Size</div>
                    <div class="param-value">{best_params['position_size_percent']:.1f}%</div>
                </div>
                <div class="param-card">
                    <div class="param-label">Max Daily Loss</div>
                    <div class="param-value">{best_params['max_intraday_loss_percent']:.2f}%</div>
                </div>
                <div class="param-card">
                    <div class="param-label">Min Hold Time</div>
                    <div class="param-value">{best_params['min_hold_minutes']} min</div>
                </div>
            </div>
        </div>
        
        <div class="content-grid">
            <div class="card">
                <h2>📊 Overall Performance</h2>
                <div class="metrics-grid">
                    <div class="metric">
                        <div class="metric-value positive">{avg_win_rate:.1f}%</div>
                        <div class="metric-label">Avg Win Rate</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value {'positive' if total_return >= 0 else 'negative'}">{total_return:.2f}%</div>
                        <div class="metric-label">Total Return</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value neutral">{total_trades}</div>
                        <div class="metric-label">Total Trades</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value neutral">{len(detailed_results)}</div>
                        <div class="metric-label">Symbols</div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h2>📈 Symbol Performance</h2>
                <div class="metrics-grid">"""
        
        for result in detailed_results:
            html_content += f"""
                    <div class="metric">
                        <div class="metric-value {'positive' if result['total_return_percent'] >= 0 else 'negative'}">{result['total_return_percent']:.2f}%</div>
                        <div class="metric-label">{result['symbol']}</div>
                    </div>"""
        
        html_content += f"""
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>📊 Detailed Analysis by Symbol</h2>
            
            <div class="symbol-tabs">"""
        
        for i, symbol in enumerate(equity_data.keys()):
            active_class = "active" if i == 0 else ""
            html_content += f'<button class="symbol-tab {active_class}" onclick="showSymbol(\'{symbol}\')">{symbol}</button>'
        
        html_content += "</div>"
        
        for i, (symbol, equity) in enumerate(equity_data.items()):
            active_class = "active" if i == 0 else ""
            trades = trades_data[symbol]
            symbol_result = next(r for r in detailed_results if r['symbol'] == symbol)
            
            html_content += f"""
            <div id="{symbol}" class="symbol-content {active_class}">
                <h3>{symbol} Performance</h3>
                
                <div class="metrics-grid" style="margin-bottom: 20px;">
                    <div class="metric">
                        <div class="metric-value {'positive' if symbol_result['win_rate'] >= 50 else 'negative'}">{symbol_result['win_rate']:.1f}%</div>
                        <div class="metric-label">Win Rate</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value {'positive' if symbol_result['total_return_percent'] >= 0 else 'negative'}">{symbol_result['total_return_percent']:.2f}%</div>
                        <div class="metric-label">Return</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value negative">{symbol_result['max_drawdown']:.2f}%</div>
                        <div class="metric-label">Max Drawdown</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value neutral">{symbol_result['total_trades']}</div>
                        <div class="metric-label">Trades</div>
                    </div>
                </div>
                
                <div id="equity-chart-{symbol}" class="chart-container"></div>
                
                <h4>Trade History</h4>
                <table class="trades-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Entry Time</th>
                            <th>Exit Time</th>
                            <th>Side</th>
                            <th>Entry Price</th>
                            <th>Exit Price</th>
                            <th>P&L</th>
                            <th>P&L %</th>
                            <th>Exit Reason</th>
                        </tr>
                    </thead>
                    <tbody>"""
            
            for trade in trades:
                pnl_class = "trade-profit" if float(trade['pnl']) >= 0 else "trade-loss"
                html_content += f"""
                        <tr>
                            <td>{trade['id']}</td>
                            <td>{trade['entry_time']}</td>
                            <td>{trade['exit_time']}</td>
                            <td>{trade['side']}</td>
                            <td>{trade['entry_price']}</td>
                            <td>{trade['exit_price']}</td>
                            <td class="{pnl_class}">${trade['pnl']}</td>
                            <td class="{pnl_class}">{trade['pnl_percent']}</td>
                            <td>{trade['exit_reason']}</td>
                        </tr>"""
            
            html_content += """
                    </tbody>
                </table>
            </div>"""
        
        html_content += f"""
        </div>
    </div>
    
    <script>
        // Equity curve data
        const equityData = {json.dumps(equity_data)};
        
        function showSymbol(symbol) {{
            // Hide all symbol contents
            document.querySelectorAll('.symbol-content').forEach(content => {{
                content.classList.remove('active');
            }});
            
            // Remove active class from all tabs
            document.querySelectorAll('.symbol-tab').forEach(tab => {{
                tab.classList.remove('active');
            }});
            
            // Show selected symbol content
            document.getElementById(symbol).classList.add('active');
            
            // Add active class to clicked tab
            event.target.classList.add('active');
            
            // Create equity chart for this symbol
            createEquityChart(symbol);
        }}
        
        function createEquityChart(symbol) {{
            const data = equityData[symbol];
            
            const trace = {{
                x: data.timestamps,
                y: data.equity,
                type: 'scatter',
                mode: 'lines',
                name: 'Equity',
                line: {{
                    color: '#3498db',
                    width: 2
                }},
                hovertemplate: '<b>%{{x}}</b><br>Equity: $%{{y:.2f}}<extra></extra>'
            }};
            
            const layout = {{
                title: `${{symbol}} Equity Curve`,
                xaxis: {{
                    title: 'Time',
                    type: 'date'
                }},
                yaxis: {{
                    title: 'Equity ($)',
                    tickformat: '$,.0f'
                }},
                margin: {{ t: 50, r: 50, b: 50, l: 80 }},
                plot_bgcolor: '#f8f9fa',
                paper_bgcolor: 'transparent'
            }};
            
            const config = {{
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d']
            }};
            
            Plotly.newPlot(`equity-chart-${{symbol}}`, [trace], layout, config);
        }}
        
        // Initialize first chart
        document.addEventListener('DOMContentLoaded', function() {{
            const firstSymbol = Object.keys(equityData)[0];
            createEquityChart(firstSymbol);
        }});
    </script>
</body>
</html>"""
        
        return html_content
    
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
                min_hold_minutes=best_params['min_hold_minutes']
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
    """Main function demonstrating smart optimization"""
    console.print("[bold blue]🧠 Smart BarUpDn Strategy Optimizer[/bold blue]")
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize optimizer
    optimizer = SmartStrategyOptimizer(
        symbols=["BTCUSDT", "ETHUSDT"],
        days_back=20,
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No cached data available.[/red]")
        return
    
    # Choice of optimization method
    console.print("\n[bold cyan]🚀 Starting intelligent optimization...[/bold cyan]")
    
    # Method 1: Bayesian Optimization (Recommended)
    console.print("\n[bold green]🎯 Running Bayesian Optimization[/bold green]")
    start_time = time.time()
    bayesian_results = optimizer.run_bayesian_optimization(n_calls=120)
    optimizer.optimization_time = time.time() - start_time
    
    if bayesian_results:
        optimizer.display_results(bayesian_results, top_n=15)
        optimizer.save_results(bayesian_results, method="bayesian")
        
        # Performance assessment
        best_win_rate = bayesian_results[0].win_rate
        best_score = bayesian_results[0].score
        
        if best_win_rate >= 65:
            console.print(f"\n[bold green]🎉 Excellent! Found parameters with {best_win_rate:.1f}% win rate![/bold green]")
        elif best_win_rate >= 55:
            console.print(f"\n[bold yellow]👍 Good! Found parameters with {best_win_rate:.1f}% win rate.[/bold yellow]")
        else:
            console.print(f"\n[bold red]📈 Best: {best_win_rate:.1f}% win rate. Consider longer data period.[/bold red]")
        
        console.print(f"[cyan]🔬 Optimization efficiency: {len(bayesian_results)} evaluations vs {5**5}+ grid search combinations[/cyan]")
        
        # Generate detailed HTML backtest with optimal parameters
        console.print(f"\n[bold cyan]🔍 Generating detailed backtest with optimal parameters...[/bold cyan]")
        best_params = bayesian_results[0].parameters
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

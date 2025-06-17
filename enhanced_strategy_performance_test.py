#!/usr/bin/env python3
"""
Enhanced Strategy Performance Test - 360 Days Analysis
Test all strategies with ultra-fast JIT optimization over a full year of data
"""

import sys
import time
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
import webbrowser
import os

# Add strategies and optimizers to path
sys.path.append(str(Path(__file__).parent))

# Import strategies
from strategies.bar_updn_strategy import BarUpDnStrategy
from strategies.breakout_strategy import BreakoutStrategy
from strategies.mean_reversion_strategy import MeanReversionStrategy
from strategies.ema_crossover_strategy import EMACrossoverStrategy
from strategies.bollinger_strategy import BollingerStrategy

# Import unified optimizer
from optimizers.unified_optimizer import UnifiedOptimizer

console = Console()

def enhanced_strategy_test():
    """Enhanced test of all strategies with 360 days of data"""
    
    console.print(Panel.fit(
        "[bold cyan]🧪 ENHANCED STRATEGY PERFORMANCE TEST[/bold cyan]\n"
        "📊 Testing ALL 5 strategies with 360 days of data\n"
        "⚡ Using ultra-fast JIT optimization\n"
        "🏆 Comprehensive performance analysis",
        border_style="cyan"
    ))
    
    # API credentials
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Create all strategies
    strategies = [
        BarUpDnStrategy(),
        BreakoutStrategy(),
        MeanReversionStrategy(),
        EMACrossoverStrategy(),
        BollingerStrategy()
    ]
    
    console.print(f"\n[green]📊 Testing {len(strategies)} strategies with 360 days of data:[/green]")
    strategy_table = Table(title="Strategies Under Test")
    strategy_table.add_column("ID", style="cyan", width=4)
    strategy_table.add_column("Strategy Name", style="green", width=25)
    strategy_table.add_column("Type", style="yellow", width=15)
    strategy_table.add_column("JIT Support", style="blue", width=12)
    
    strategy_table.add_row("1", "BarUpDn Enhanced", "Reversal", "✅ Yes")
    strategy_table.add_row("2", "Crypto Breakout", "Momentum", "✅ Yes")
    strategy_table.add_row("3", "Mean Reversion", "Mean Reversion", "✅ Yes")
    strategy_table.add_row("4", "EMA Crossover", "Trend Following", "✅ Yes")
    strategy_table.add_row("5", "Bollinger Bands", "Volatility", "✅ Yes")
    
    console.print(strategy_table)
    
    # Test configuration
    console.print(f"\n[bold yellow]⚙️ TEST CONFIGURATION:[/bold yellow]")
    console.print(f"[cyan]📅 Historical Data: 360 days (full year)[/cyan]")
    console.print(f"[cyan]💰 Symbols: BTCUSDT, ETHUSDT (major crypto pairs)[/cyan]")
    console.print(f"[cyan]⏱️ Timeframe: 15 minutes (optimal for strategies)[/cyan]")
    console.print(f"[cyan]🔍 Evaluations per strategy: 150 (thorough optimization)[/cyan]")
    console.print(f"[cyan]⚡ JIT Acceleration: Enabled (10-100x speedup)[/cyan]")
    
    # Initialize unified optimizer
    console.print(f"\n[cyan]🔧 Initializing Enhanced Optimizer...[/cyan]")
    start_init_time = time.time()
    
    optimizer = UnifiedOptimizer(
        strategies=strategies,
        symbols=["BTCUSDT", "ETHUSDT"],  # Major crypto pairs
        days_back=360,  # Full year of data
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    init_time = time.time() - start_init_time
    console.print(f"[green]✅ Optimizer initialized in {init_time:.2f}s[/green]")
    
    if not optimizer.cached_data:
        console.print("[red]❌ No data available for testing.[/red]")
        return
    
    # Calculate total data points
    total_bars = sum(len(df) for df in optimizer.cached_data.values())
    console.print(f"[yellow]📊 Total data points: {total_bars:,} bars[/yellow]")
    
    # Run comprehensive optimization
    console.print(f"\n[bold green]🚀 Starting Comprehensive Performance Test...[/bold green]")
    console.print(f"[yellow]💡 This will test each strategy thoroughly with 150 evaluations[/yellow]")
    
    start_test_time = time.time()
    all_results = optimizer.optimize_all_strategies(n_calls=150)
    test_time = time.time() - start_test_time
    
    console.print(f"\n[bold green]⚡ All strategies tested in {test_time:.1f}s![/bold green]")
    console.print(f"[cyan]📊 Average time per strategy: {test_time/len(strategies):.1f}s[/cyan]")
    
    # Analyze results
    console.print(f"\n[bold yellow]📈 COMPREHENSIVE PERFORMANCE ANALYSIS:[/bold yellow]")
    
    performance_data = []
    successful_strategies = []
    failed_strategies = []
    
    for strategy_name, results in all_results.items():
        if results and len(results) > 0:
            best = results[0]
            performance_data.append({
                'name': strategy_name,
                'score': best.score,
                'win_rate': best.win_rate,
                'return': best.total_return_percent,
                'drawdown': best.max_drawdown,
                'trades': best.total_trades,
                'profit_factor': best.profit_factor,
                'sharpe': best.sharpe_ratio,
                'parameters': best.parameters
            })
            successful_strategies.append(strategy_name)
        else:
            failed_strategies.append(strategy_name)
    
    # Sort by score (best performance first)
    performance_data.sort(key=lambda x: x['score'], reverse=True)
    
    # Display comprehensive results
    results_table = Table(title="📊 360-Day Performance Ranking (Best to Worst)")
    results_table.add_column("Rank", style="bold cyan", width=6)
    results_table.add_column("Strategy", style="green", width=20)
    results_table.add_column("Score", style="bold yellow", width=8)
    results_table.add_column("Win Rate%", style="blue", width=10)
    results_table.add_column("Return%", style="green", width=10)
    results_table.add_column("Max DD%", style="red", width=9)
    results_table.add_column("Trades", style="cyan", width=8)
    results_table.add_column("Profit Factor", style="magenta", width=13)
    results_table.add_column("Sharpe", style="yellow", width=8)
    
    for i, data in enumerate(performance_data, 1):
        rank_style = "bold green" if i == 1 else "bold yellow" if i == 2 else "bold white" if i == 3 else "dim"
        rank_symbol = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else f"{i}"
        
        results_table.add_row(
            f"[{rank_style}]{rank_symbol}[/{rank_style}]",
            data['name'],
            f"{data['score']:.2f}",
            f"{data['win_rate']:.1f}",
            f"{data['return']:.2f}",
            f"{data['drawdown']:.2f}",
            str(data['trades']),
            f"{data['profit_factor']:.2f}",
            f"{data['sharpe']:.2f}"
        )
    
    console.print(results_table)
    
    # Winner analysis
    if performance_data:
        winner = performance_data[0]
        console.print(Panel.fit(
            f"[bold yellow]🏆 CHAMPION STRATEGY: {winner['name']}[/bold yellow]\n\n"
            f"[green]📊 Performance Metrics (360 days):[/green]\n"
            f"🎯 Optimization Score: {winner['score']:.2f}\n"
            f"🎲 Win Rate: {winner['win_rate']:.1f}%\n"
            f"💰 Total Return: {winner['return']:.2f}%\n"
            f"📉 Max Drawdown: {winner['drawdown']:.2f}%\n"
            f"📈 Total Trades: {winner['trades']:,}\n"
            f"⚖️ Profit Factor: {winner['profit_factor']:.2f}\n"
            f"📊 Sharpe Ratio: {winner['sharpe']:.2f}\n\n"
            f"[yellow]💡 This strategy showed the best risk-adjusted returns over a full year![/yellow]",
            border_style="yellow"
        ))
        
        # Show optimal parameters for winner
        console.print(f"\n[bold cyan]⚙️ OPTIMAL PARAMETERS FOR {winner['name']}:[/bold cyan]")
        params_table = Table(title=f"Best Parameters for {winner['name']}")
        params_table.add_column("Parameter", style="cyan", width=25)
        params_table.add_column("Optimal Value", style="green", width=20)
        
        for param, value in winner['parameters'].items():
            if isinstance(value, float):
                params_table.add_row(param, f"{value:.4f}")
            else:
                params_table.add_row(param, str(value))
        
        console.print(params_table)
    
    # Performance insights
    if len(performance_data) >= 2:
        console.print(f"\n[bold blue]🔍 PERFORMANCE INSIGHTS:[/bold blue]")
        
        insights = []
        
        # Best vs worst comparison
        best = performance_data[0]
        worst = performance_data[-1]
        
        insights.append(f"🏆 Best strategy ({best['name']}) outperformed worst by {best['score'] - worst['score']:.1f} points")
        insights.append(f"📈 Return difference: {best['return'] - worst['return']:.2f}% ({best['name']} vs {worst['name']})")
        insights.append(f"🎯 Win rate spread: {max(d['win_rate'] for d in performance_data) - min(d['win_rate'] for d in performance_data):.1f}%")
        
        # Average performance
        avg_return = sum(d['return'] for d in performance_data) / len(performance_data)
        avg_win_rate = sum(d['win_rate'] for d in performance_data) / len(performance_data)
        avg_drawdown = sum(d['drawdown'] for d in performance_data) / len(performance_data)
        
        insights.append(f"📊 Average return across all strategies: {avg_return:.2f}%")
        insights.append(f"🎲 Average win rate: {avg_win_rate:.1f}%")
        insights.append(f"📉 Average max drawdown: {avg_drawdown:.2f}%")
        
        # Strategy type analysis
        if len(performance_data) >= 3:
            top_3 = [d['name'] for d in performance_data[:3]]
            insights.append(f"🥇 Top 3 strategies: {', '.join(top_3)}")
        
        for insight in insights:
            console.print(f"[yellow]💡 {insight}[/yellow]")
    
    # JIT performance summary
    console.print(f"\n[bold green]⚡ JIT ACCELERATION SUMMARY:[/bold green]")
    console.print(f"[green]✅ Successful strategies with JIT: {len(successful_strategies)}/{len(strategies)}[/green]")
    if successful_strategies:
        console.print(f"[yellow]🚀 JIT-accelerated strategies: {', '.join(successful_strategies)}[/yellow]")
    if failed_strategies:
        console.print(f"[red]❌ Strategies needing optimization: {', '.join(failed_strategies)}[/red]")
    
    # Save results
    console.print(f"\n[cyan]💾 Saving comprehensive results...[/cyan]")
    json_file = optimizer.save_results(all_results, method="360_day_comprehensive_test")
    
    # Generate detailed HTML report
    console.print(f"[cyan]📊 Generating detailed HTML report...[/cyan]")
    html_file = optimizer.run_detailed_backtest(all_results)
    
    # Final summary
    console.print(Panel.fit(
        f"[bold green]🎊 360-DAY COMPREHENSIVE TEST COMPLETE![/bold green]\n\n"
        f"📊 Strategies tested: {len(strategies)}\n"
        f"✅ Successful optimizations: {len(successful_strategies)}\n"
        f"⏱️ Total test time: {test_time:.1f}s\n"
        f"⚡ JIT acceleration: {len(successful_strategies)}/{len(strategies)} strategies\n"
        f"📁 Results saved: {json_file}\n"
        f"🌐 HTML report: {html_file if html_file else 'Generation failed'}\n\n"
        f"[yellow]🏆 Winner: {performance_data[0]['name'] if performance_data else 'No clear winner'}[/yellow]",
        border_style="green"
    ))
    
    # Try to open HTML report
    if html_file:
        try:
            html_path = os.path.abspath(html_file)
            webbrowser.open(f'file://{html_path}')
            console.print(f"[green]🌐 Opened detailed HTML report in browser[/green]")
        except Exception:
            console.print(f"[yellow]📂 HTML file saved - open manually: {html_file}[/yellow]")
    
    return performance_data

if __name__ == "__main__":
    try:
        console.print("[bold blue]🚀 Starting Enhanced Strategy Performance Test...[/bold blue]")
        results = enhanced_strategy_test()
        
        if results:
            console.print(f"\n[bold green]✅ Test completed successfully![/bold green]")
            console.print(f"[yellow]🏆 Champion: {results[0]['name']} with score {results[0]['score']:.2f}[/yellow]")
        else:
            console.print(f"[red]❌ Test failed - no results generated[/red]")
            
    except KeyboardInterrupt:
        console.print(f"\n[yellow]⏹️ Test interrupted by user[/yellow]")
    except Exception as e:
        console.print(f"[red]❌ Test failed with error: {str(e)}[/red]")
        import traceback
        traceback.print_exc() 
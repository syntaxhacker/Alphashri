#!/usr/bin/env python3
"""
Main Strategy Optimizer
Unified system for testing multiple strategies simultaneously
"""

import sys
from pathlib import Path
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
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


def display_strategy_menu():
    """Display available strategies"""
    console.print("\n[bold cyan]📋 AVAILABLE STRATEGIES[/bold cyan]")
    
    strategies_table = Table(title="Strategy Options")
    strategies_table.add_column("ID", style="cyan", width=4)
    strategies_table.add_column("Strategy Name", style="green", width=25)
    strategies_table.add_column("Type", style="yellow", width=15)
    strategies_table.add_column("Description", style="white", width=50)
    
    strategies_table.add_row("1", "BarUpDn Enhanced", "Reversal", "Pattern-based reversal strategy with volume and trend filters")
    strategies_table.add_row("2", "Crypto Breakout", "Momentum", "Momentum-based breakout strategy optimized for crypto markets")
    strategies_table.add_row("3", "Mean Reversion", "Mean Reversion", "RSI and Bollinger Bands mean reversion strategy")
    strategies_table.add_row("4", "EMA Crossover", "Trend Following", "Multi-timeframe EMA crossover with momentum filters")
    strategies_table.add_row("5", "Bollinger Bands", "Volatility", "Bollinger squeeze/expansion with volatility analysis")
    strategies_table.add_row("6", "All Strategies", "Combined", "Test all 5 strategies simultaneously and compare results")
    
    console.print(strategies_table)


def get_strategy_selection():
    """Get user's strategy selection"""
    while True:
        try:
            choice = input("\nSelect strategies to test (1-6): ").strip()
            
            if choice == "1":
                return [BarUpDnStrategy()]
            elif choice == "2":
                return [BreakoutStrategy()]
            elif choice == "3":
                return [MeanReversionStrategy()]
            elif choice == "4":
                return [EMACrossoverStrategy()]
            elif choice == "5":
                return [BollingerStrategy()]
            elif choice == "6":
                return [BarUpDnStrategy(), BreakoutStrategy(), MeanReversionStrategy(), EMACrossoverStrategy(), BollingerStrategy()]
            else:
                console.print("[red]Invalid choice. Please enter 1-6.[/red]")
        except KeyboardInterrupt:
            console.print("\n[yellow]Exiting...[/yellow]")
            sys.exit(0)


def get_symbols_selection():
    """Get symbols to test"""
    console.print("\n[bold cyan]💰 SYMBOL SELECTION[/bold cyan]")
    console.print("[green]Default symbols: BTCUSDT, ETHUSDT[/green]")
    console.print("[yellow]You can add more symbols separated by commas (e.g., BTCUSDT,ETHUSDT,ADAUSDT)[/yellow]")
    
    user_input = input("\nEnter symbols (or press Enter for default): ").strip()
    
    if not user_input:
        return ["BTCUSDT", "ETHUSDT"]
    
    # Parse user input
    symbols = [symbol.strip().upper() for symbol in user_input.split(",")]
    # Ensure USDT pairs
    symbols = [symbol if symbol.endswith("USDT") else f"{symbol}USDT" for symbol in symbols]
    
    console.print(f"[green]✓ Selected symbols: {', '.join(symbols)}[/green]")
    return symbols


def get_optimization_settings():
    """Get optimization settings"""
    console.print("\n[bold cyan]⚙️  OPTIMIZATION SETTINGS[/bold cyan]")
    
    # Days back
    console.print("[green]Historical data period (default: 60 days)[/green]")
    days_input = input("Enter days of historical data (or press Enter for default): ").strip()
    days_back = int(days_input) if days_input.isdigit() else 60
    
    # Optimization calls
    console.print("[green]Optimization evaluations per strategy (default: 150)[/green]")
    console.print("[yellow]More evaluations = better optimization but slower[/yellow]")
    calls_input = input("Enter evaluations per strategy (or press Enter for default): ").strip()
    n_calls = int(calls_input) if calls_input.isdigit() else 150
    
    return days_back, n_calls


def main():
    """Main function for unified strategy optimization"""
    
    console.print(Panel.fit(
        "[bold blue]🚀 UNIFIED STRATEGY OPTIMIZER[/bold blue]\n"
        "Test and optimize multiple trading strategies simultaneously\n"
        "Compare performance, find optimal parameters, and generate reports",
        border_style="blue"
    ))
    
    # API credentials
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    try:
        # Strategy selection
        display_strategy_menu()
        strategies = get_strategy_selection()
        
        # Symbol selection
        symbols = get_symbols_selection()
        
        # Optimization settings
        days_back, n_calls = get_optimization_settings()
        
        # Display configuration
        console.print(Panel.fit(
            f"[bold yellow]📋 OPTIMIZATION CONFIGURATION[/bold yellow]\n\n"
            f"Strategies: {[s.get_display_name() for s in strategies]}\n"
            f"Symbols: {', '.join(symbols)}\n"
            f"Timeframe: 15 minutes (optimized for strategy performance)\n"
            f"Historical Data: {days_back} days\n"
            f"Evaluations per strategy: {n_calls}\n"
            f"Total evaluations: {len(strategies) * n_calls}",
            border_style="yellow"
        ))
        
        # Confirm to proceed
        proceed = input("\nProceed with optimization? (y/n): ").strip().lower()
        if proceed != 'y':
            console.print("[yellow]Optimization cancelled.[/yellow]")
            return
        
        # Initialize unified optimizer
        console.print("\n[bold cyan]🔧 Initializing Unified Optimizer...[/bold cyan]")
        optimizer = UnifiedOptimizer(
            strategies=strategies,
            symbols=symbols,
            days_back=days_back,
            api_key=API_KEY,
            api_secret=API_SECRET
        )
        
        if not optimizer.cached_data:
            console.print("[red]❌ No data available for optimization.[/red]")
            return
        
        # Run optimization
        console.print("\n[bold green]🚀 Starting Multi-Strategy Optimization...[/bold green]")
        all_results = optimizer.optimize_all_strategies(n_calls=n_calls)
        
        if not all_results:
            console.print("[red]❌ No optimization results generated.[/red]")
            return
        
        # Display results
        optimizer.display_results(all_results, top_n=5)
        
        # Save results
        json_file = optimizer.save_results(all_results, method="unified_multi_strategy")
        
        # Generate detailed backtest and HTML report
        console.print("\n[bold cyan]📊 Generating Detailed Backtest Report...[/bold cyan]")
        html_file = optimizer.run_detailed_backtest(all_results)
        
        if html_file:
            console.print(f"\n[bold green]🎊 OPTIMIZATION COMPLETE![/bold green]")
            console.print(f"[cyan]📄 JSON Results: {json_file}[/cyan]")
            console.print(f"[cyan]🌐 HTML Report: {html_file}[/cyan]")
            
            # Try to open HTML file automatically
            try:
                html_path = os.path.abspath(html_file)
                webbrowser.open(f'file://{html_path}')
                console.print(f"[green]🌐 Opened HTML report in browser[/green]")
            except Exception:
                console.print(f"[yellow]📂 Open manually: {html_file}[/yellow]")
            
            # Display summary insights
            display_final_insights(all_results)
        else:
            console.print("[red]❌ Failed to generate HTML report[/red]")
    
    except KeyboardInterrupt:
        console.print("\n[yellow]Optimization interrupted by user.[/yellow]")
    except Exception as e:
        console.print(f"[red]❌ Error during optimization: {str(e)}[/red]")
        import traceback
        traceback.print_exc()


def display_final_insights(all_results):
    """Display final insights and recommendations"""
    
    console.print(f"\n[bold green]💡 OPTIMIZATION INSIGHTS[/bold green]")
    
    insights_table = Table(title="Strategy Performance Comparison")
    insights_table.add_column("Metric", style="cyan", width=20)
    
    # Add columns for each strategy
    strategy_names = list(all_results.keys())
    for strategy_name in strategy_names:
        insights_table.add_column(strategy_name, style="green", width=15)
    
    # Collect metrics for comparison
    metrics = ['Win Rate %', 'Return %', 'Max DD %', 'Profit Factor', 'Score']
    
    for metric in metrics:
        row = [metric]
        for strategy_name in strategy_names:
            if all_results[strategy_name]:
                best = all_results[strategy_name][0]
                if metric == 'Win Rate %':
                    row.append(f"{best.win_rate:.1f}")
                elif metric == 'Return %':
                    row.append(f"{best.total_return_percent:.2f}")
                elif metric == 'Max DD %':
                    row.append(f"{best.max_drawdown:.2f}")
                elif metric == 'Profit Factor':
                    row.append(f"{best.profit_factor:.2f}")
                elif metric == 'Score':
                    row.append(f"{best.score:.2f}")
            else:
                row.append("N/A")
        insights_table.add_row(*row)
    
    console.print(insights_table)
    
    # Find best strategy
    best_strategy = None
    best_score = 0
    
    for strategy_name, results in all_results.items():
        if results and results[0].score > best_score:
            best_score = results[0].score
            best_strategy = strategy_name
    
    if best_strategy:
        console.print(f"\n[bold yellow]🏆 RECOMMENDATION: {best_strategy} shows the best overall performance![/bold yellow]")
        
        best_result = all_results[best_strategy][0]
        console.print(Panel.fit(
            f"[bold green]🎯 OPTIMAL CONFIGURATION[/bold green]\n\n"
            f"Strategy: {best_strategy}\n"
            f"Expected Win Rate: {best_result.win_rate:.1f}%\n"
            f"Expected Return: {best_result.total_return_percent:.2f}%\n"
            f"Max Drawdown: {best_result.max_drawdown:.2f}%\n"
            f"Optimization Score: {best_result.score:.2f}\n\n"
            f"[cyan]Parameters:[/cyan]\n" +
            "\n".join([f"{k}: {v}" for k, v in best_result.parameters.items()]),
            border_style="green"
        ))


if __name__ == "__main__":
    main() 
#!/usr/bin/env python3
"""
Enhanced runner for BarUpDn parameter optimization
Includes both traditional optimization and smart Bayesian optimization
"""

import time
from bar_updn_optimization import run_complete_optimization
from smart_strategy_optimizer import SmartStrategyOptimizer
from rich.console import Console
from rich.panel import Panel

console = Console()

# Binance API keys (using the ones from your README)
API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"

def run_smart_optimization():
    """Run smart Bayesian optimization"""
    console.print("\n" + "="*60)
    console.print("[bold green]🧠 SMART BAYESIAN OPTIMIZATION[/bold green]")
    console.print("="*60)
    
    # Configuration
    symbols = ["ETHUSDT"]
    days_back = 180# Use more data for better optimization
    
    console.print(f"[cyan]Smart Optimization Configuration:[/cyan]")
    console.print(f"• Symbols: {', '.join(symbols)}")
    console.print(f"• Historical Period: {days_back} days")
    console.print(f"• Method: Bayesian Optimization (Gaussian Process)")
    console.print(f"• Evaluations: ~120 (with early stopping)")
    console.print()
    
    try:
        start_time = time.time()
        
        # Initialize smart optimizer
        optimizer = SmartStrategyOptimizer(
            symbols=symbols,
            days_back=days_back,
            api_key=API_KEY,
            api_secret=API_SECRET
        )
        
        if not optimizer.cached_data:
            console.print("[red]❌ No cached data available for smart optimization.[/red]")
            return None
        
        # Run Bayesian optimization
        results = optimizer.run_bayesian_optimization(n_calls=120)
        
        if results:
            optimizer.display_results(results, top_n=10)
            filename = optimizer.save_results(results, method="bayesian")
            
            optimization_time = time.time() - start_time
            
            # Generate detailed HTML backtest with optimal parameters
            console.print(f"\n[bold cyan]🔍 Generating detailed backtest with optimal parameters...[/bold cyan]")
            best_params = results[0].parameters
            html_file = optimizer.run_detailed_backtest_with_best_params(best_params)
            
            # Performance summary
            best = results[0]
            console.print(Panel.fit(
                f"[bold green]🏆 SMART OPTIMIZATION SUMMARY[/bold green]\n\n"
                f"[cyan]Best Parameters Found:[/cyan]\n"
                f"• Stop Loss: {best.parameters['sl_percent']:.2f}%\n"
                f"• Trailing Stop: {best.parameters['trailing_stop_percent']:.2f}%\n"
                f"• Position Size: {best.parameters['position_size_percent']:.1f}%\n"
                f"• Max Daily Loss: {best.parameters['max_intraday_loss_percent']:.2f}%\n"
                f"• Min Hold Time: {best.parameters['min_hold_minutes']} minutes\n\n"
                f"[cyan]Performance:[/cyan]\n"
                f"• Win Rate: {best.win_rate:.1f}%\n"
                f"• Return: {best.total_return_percent:.2f}%\n"
                f"• Max Drawdown: {best.max_drawdown:.2f}%\n"
                f"• Profit Factor: {best.profit_factor:.2f}\n"
                f"• Sharpe Ratio: {best.sharpe_ratio:.2f}\n"
                f"• Total Trades: {best.total_trades}\n\n"
                f"[cyan]Efficiency:[/cyan]\n"
                f"• Evaluations: {len(results)}\n"
                f"• Time: {optimization_time:.1f}s\n"
                f"• Speed: {len(results)/optimization_time:.1f} eval/sec\n"
                f"• Found at iteration: {best.iteration + 1}\n\n"
                f"[cyan]Generated Files:[/cyan]\n"
                f"• {filename} (Optimization results)\n"
                f"• {html_file or 'HTML generation failed'} (Detailed backtest)",
                border_style="green"
            ))
            
            # Add information about parameter conflicts and solutions
            min_hold = best.parameters.get('min_hold_minutes', 15)
            if min_hold > 10:
                console.print(Panel(
                    f"[yellow]📝 Parameter Conflict Analysis:[/yellow]\n\n"
                    f"[cyan]Current Configuration:[/cyan]\n"
                    f"• Min Hold Time: {min_hold} minutes\n"
                    f"• Opposite Signal Exits: Enabled (smart logic)\n\n"
                    f"[cyan]Conflict Resolution:[/cyan]\n"
                    f"• ✅ Smart exit logic respects min hold time\n"
                    f"• ✅ Emergency exits for >2% losses (ignores min hold)\n"
                    f"• ✅ Balances trend reversal speed vs. noise filtering\n\n"
                    f"[cyan]To reduce conflict:[/cyan]\n"
                    f"• Min hold time fixed to 60 minutes (1 hour) for testing\n"
                    f"• Strategy will hold positions for minimum 1 hour\n"
                    f"• Or use longer timeframes (5m/15m) for natural filtering",
                    title="⚖️ Strategy Balance",
                    border_style="yellow"
                ))
            
            # Try to open HTML file automatically
            if html_file:
                try:
                    import webbrowser
                    import os
                    html_path = os.path.abspath(html_file)
                    webbrowser.open(f'file://{html_path}')
                    console.print(f"[green]🌐 Opened detailed backtest HTML in browser[/green]")
                except Exception:
                    console.print(f"[yellow]📂 HTML file saved - open manually: {html_file}[/yellow]")
            
            return {
                'method': 'Bayesian Optimization',
                'best_params': best.parameters,
                'best_win_rate': best.win_rate,
                'best_return': best.total_return_percent,
                'optimization_time': optimization_time,
                'evaluations': len(results),
                'results_file': filename,
                'html_file': html_file
            }
        else:
            console.print("[red]❌ No results from smart optimization.[/red]")
            return None
        
    except Exception as e:
        console.print(f"[red]❌ Error during smart optimization: {str(e)}[/red]")
        return None

def run_traditional_optimization():
    """Run traditional grid search optimization"""
    console.print("\n" + "="*60)
    console.print("[bold yellow]⚙️  TRADITIONAL GRID SEARCH OPTIMIZATION[/bold yellow]")
    console.print("="*60)
    
    # Configuration
    symbols = ["ETHUSDT"]
    days_back = 3  # Match smart optimization period
    
    console.print(f"[cyan]Traditional Optimization Configuration:[/cyan]")
    console.print(f"• Symbols: {', '.join(symbols)}")
    console.print(f"• Historical Period: {days_back} days")
    console.print(f"• Method: Grid Search")
    console.print(f"• API: Binance (1-minute data)")
    console.print()
    
    try:
        start_time = time.time()
        
        # Run complete optimization
        results = run_complete_optimization(
            symbols=symbols,
            api_key=API_KEY,
            api_secret=API_SECRET,
            days_back=days_back
        )
        
        optimization_time = time.time() - start_time
        
        console.print(Panel.fit(
            f"[bold yellow]⚙️  TRADITIONAL OPTIMIZATION SUMMARY[/bold yellow]\n\n"
            f"[cyan]Method:[/cyan] Grid Search\n"
            f"[cyan]Time:[/cyan] {optimization_time:.1f}s\n"
            f"[cyan]Generated:[/cyan]\n"
            f"• Parameter optimization results\n"
            f"• Interactive HTML chart (bar_updn_analysis.html)\n"
            f"• JSON results file\n"
            f"• Console performance summary",
            border_style="yellow"
        ))
        
        return {
            'method': 'Grid Search',
            'optimization_time': optimization_time,
            'results_file': 'bar_updn_analysis.html'
        }
        
    except Exception as e:
        console.print(f"[red]❌ Error during traditional optimization: {str(e)}[/red]")
        return None

def compare_methods(smart_results, traditional_results):
    """Compare optimization methods"""
    console.print("\n" + "="*60)
    console.print("[bold blue]📊 OPTIMIZATION METHODS COMPARISON[/bold blue]")
    console.print("="*60)
    
    if smart_results and traditional_results:
        # Create comparison table
        from rich.table import Table
        
        table = Table(title="Optimization Methods Comparison")
        table.add_column("Metric", style="cyan")
        table.add_column("Smart Bayesian", style="green")
        table.add_column("Traditional Grid", style="yellow")
        
        table.add_row(
            "Method",
            "Gaussian Process + Expected Improvement",
            "Exhaustive Grid Search"
        )
        
        table.add_row(
            "Time",
            f"{smart_results['optimization_time']:.1f}s",
            f"{traditional_results['optimization_time']:.1f}s"
        )
        
        if 'evaluations' in smart_results:
            table.add_row(
                "Evaluations",
                f"{smart_results['evaluations']}",
                "~3,125+ combinations"
            )
        
        if 'best_win_rate' in smart_results:
            table.add_row(
                "Best Win Rate",
                f"{smart_results['best_win_rate']:.1f}%",
                "See HTML report"
            )
        
        if 'best_return' in smart_results:
            table.add_row(
                "Best Return",
                f"{smart_results['best_return']:.2f}%",
                "See HTML report"
            )
        
        table.add_row(
            "Output",
            "JSON + HTML + Console",
            "HTML + JSON + Console"
        )
        
        console.print(table)
        
        # Efficiency calculation
        if 'evaluations' in smart_results:
            efficiency_gain = 3125 / smart_results['evaluations']
            console.print(f"\n[bold green]⚡ Efficiency Gain: {efficiency_gain:.1f}x faster parameter search![/bold green]")
    
    console.print(f"\n[cyan]📋 Generated Files:[/cyan]")
    if smart_results and 'results_file' in smart_results:
        console.print(f"• {smart_results['results_file']} (Smart optimization)")
        if 'html_file' in smart_results and smart_results['html_file']:
            console.print(f"• {smart_results['html_file']} (Smart detailed backtest)")
    if traditional_results and 'results_file' in traditional_results:
        console.print(f"• {traditional_results['results_file']} (Traditional optimization)")

def main():
    """Run both optimization methods and compare"""
    
    console.print("[bold blue]🚀 BarUpDn Strategy - Complete Optimization Suite[/bold blue]\n")
    
    console.print(Panel.fit(
        "[bold cyan]This script will run two optimization methods:[/bold cyan]\n\n"
        "1. [green]Smart Bayesian Optimization[/green] - Fast, intelligent parameter search\n"
        "2. [yellow]Traditional Grid Search[/yellow] - Comprehensive but slower\n\n"
        "[cyan]You can compare their efficiency and results![/cyan]",
        border_style="blue"
    ))
    
    # Ask user which method to run
    console.print("\n[bold cyan]Choose optimization method:[/bold cyan]")
    console.print("1. Smart Bayesian only (recommended)")
    console.print("2. Traditional Grid Search only")
    console.print("3. Both methods (for comparison)")
    
    try:
        choice = console.input("\n[cyan]Enter your choice (1-3): [/cyan]")
        
        smart_results = None
        traditional_results = None
        
        if choice in ['1', '3']:
            smart_results = run_smart_optimization()
        
        if choice in ['2', '3']:
            traditional_results = run_traditional_optimization()
        
        if choice == '3':
            compare_methods(smart_results, traditional_results)
        
        # Final summary
        console.print("\n[bold green]🎉 Optimization Complete![/bold green]")
        
        if smart_results:
            console.print(f"\n[green]✅ Smart optimization completed in {smart_results.get('optimization_time', 0):.1f}s[/green]")
            if 'best_win_rate' in smart_results:
                console.print(f"[green]🎯 Best win rate: {smart_results['best_win_rate']:.1f}%[/green]")
            if 'html_file' in smart_results and smart_results['html_file']:
                console.print(f"[green]📊 Detailed backtest HTML: {smart_results['html_file']}[/green]")
        
        if traditional_results:
            console.print(f"\n[yellow]✅ Traditional optimization completed in {traditional_results.get('optimization_time', 0):.1f}s[/yellow]")
            console.print(f"[yellow]📊 Open 'bar_updn_analysis.html' to view detailed results[/yellow]")
        
        console.print("\n[bold cyan]📊 Next Steps:[/bold cyan]")
        console.print("1. Review the optimized parameters")
        console.print("2. Open the HTML report to analyze performance charts")
        console.print("3. Test parameters on paper trading")
        console.print("4. Analyze individual symbol performance")
        console.print("5. Consider forward testing before live deployment")
        
        return smart_results or traditional_results
        
    except KeyboardInterrupt:
        console.print("\n[yellow]⏹️  Optimization cancelled by user[/yellow]")
        return None
    except Exception as e:
        console.print(f"\n[red]❌ Error: {str(e)}[/red]")
        return None

if __name__ == "__main__":
    main()

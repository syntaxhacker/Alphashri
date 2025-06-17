#!/usr/bin/env python3
"""
Demo: Unified Strategy Optimizer
Quick demonstration of the new multi-strategy system with 15-minute timeframes
"""

from strategies.bar_updn_strategy import BarUpDnStrategy
from strategies.breakout_strategy import BreakoutStrategy
from optimizers.unified_optimizer import UnifiedOptimizer
from rich.console import Console
from rich.panel import Panel

console = Console()

def demo_single_strategy():
    """Demo: Single strategy optimization"""
    console.print(Panel.fit(
        "[bold blue]🎯 DEMO: Single Strategy Optimization[/bold blue]\n"
        "Testing Crypto Breakout strategy on BTCUSDT with 15-minute timeframes",
        border_style="blue"
    ))
    
    # API credentials
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize single strategy
    strategy = BreakoutStrategy()
    
    # Initialize optimizer
    optimizer = UnifiedOptimizer(
        strategies=[strategy],
        symbols=["BTCUSDT"],
        days_back=30,  # 30 days of 15-minute data
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No data available[/red]")
        return
    
    # Quick optimization (50 evaluations for demo)
    console.print("[cyan]🚀 Running quick optimization (50 evaluations)...[/cyan]")
    results = optimizer.optimize_all_strategies(n_calls=50)
    
    # Display results
    optimizer.display_results(results, top_n=3)
    
    return results

def demo_multi_strategy():
    """Demo: Multi-strategy comparison"""
    console.print(Panel.fit(
        "[bold green]🏆 DEMO: Multi-Strategy Comparison[/bold green]\n"
        "Comparing BarUpDn vs Breakout strategies on ETHUSDT with 15-minute timeframes",
        border_style="green"
    ))
    
    # API credentials
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize both strategies
    strategies = [BarUpDnStrategy(), BreakoutStrategy()]
    
    # Initialize optimizer
    optimizer = UnifiedOptimizer(
        strategies=strategies,
        symbols=["ETHUSDT"],
        days_back=45,  # 45 days of 15-minute data
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No data available[/red]")
        return
    
    # Quick optimization (30 evaluations each for demo)
    console.print("[cyan]🚀 Running multi-strategy optimization (30 evaluations each)...[/cyan]")
    results = optimizer.optimize_all_strategies(n_calls=30)
    
    # Display comparison results
    optimizer.display_results(results, top_n=3)
    
    # Save results for later analysis
    json_file = optimizer.save_results(results, method="demo_multi_strategy")
    console.print(f"[green]✅ Demo results saved: {json_file}[/green]")
    
    return results

def main():
    """Run both demos"""
    console.print("[bold cyan]🚀 UNIFIED STRATEGY OPTIMIZER DEMO[/bold cyan]")
    console.print("[yellow]Using 15-minute timeframes for optimal performance[/yellow]")
    
    # Demo 1: Single strategy
    demo_results_1 = demo_single_strategy()
    
    console.print("\n" + "="*60 + "\n")
    
    # Demo 2: Multi-strategy
    demo_results_2 = demo_multi_strategy()
    
    # Summary
    console.print(Panel.fit(
        "[bold yellow]🎊 DEMO COMPLETE![/bold yellow]\n\n"
        "[green]✅ Timeframe: 15-minute bars (much faster than 1-minute)[/green]\n"
        "[green]✅ Modular architecture: Easy to add new strategies[/green]\n"
        "[green]✅ Side-by-side comparison: Find the best strategy[/green]\n"
        "[green]✅ JSON serialization: Fixed for reliable results export[/green]\n\n"
        "[cyan]Key Benefits:[/cyan]\n"
        "• 15-minute data = 96x less data points than 1-minute\n"
        "• Better signal quality, less noise\n"
        "• Faster optimization and backtesting\n"
        "• Strategies work well on higher timeframes",
        border_style="yellow"
    ))

if __name__ == "__main__":
    main() 
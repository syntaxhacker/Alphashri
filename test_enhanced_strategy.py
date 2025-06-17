#!/usr/bin/env python3
"""
Test Enhanced BarUpDn Strategy with Volume and Trend Analysis
Demonstrates the improved filtering and signal quality
"""

import sys
import time
from datetime import datetime, timedelta
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# Import our enhanced modules
from bar_updn_extreme_backtest import BarUpDnStrategy, BarUpDnBacktester, DataFetcher, display_results
from smart_strategy_optimizer import SmartStrategyOptimizer

console = Console()

def test_enhanced_vs_original():
    """Compare enhanced strategy vs original strategy"""
    
    console.print(Panel.fit(
        "[bold cyan]🔬 Enhanced BarUpDn Strategy Testing[/bold cyan]\n"
        "Comparing enhanced filters vs original strategy\n"
        "✅ Volume Analysis: Above average volume + spikes\n"
        "📈 Trend Analysis: Moving averages + RSI\n"
        "🎯 Quality Filters: Body size + volatility\n"
        "🔍 Market Structure: Price position + extremes",
        border_style="cyan"
    ))
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Test parameters
    symbol = "BTCUSDT"
    days_back = 7  # Short test period
    
    try:
        # Fetch data
        fetcher = DataFetcher(API_KEY, API_SECRET)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        console.print(f"[cyan]📊 Fetching {days_back} days of 1-minute data for {symbol}...[/cyan]")
        df = fetcher.fetch_data(symbol, start_date, end_date)
        console.print(f"[green]✓ Fetched {len(df):,} bars[/green]")
        
        # Test 1: Original strategy (filters disabled)
        console.print("\n[bold yellow]🔍 Test 1: Original Strategy (No Enhanced Filters)[/bold yellow]")
        original_strategy = BarUpDnStrategy(
            sl_percent=3.0,
            trailing_stop_percent=1.5,
            position_size_percent=10.0,
            use_volume_filter=False,  # Disable enhanced filters
            use_trend_filter=False
        )
        
        original_backtester = BarUpDnBacktester(initial_capital=10000)
        original_backtester.strategy = original_strategy
        original_result = original_backtester.run_backtest(df, f"{symbol}_Original", show_progress=False)
        
        # Test 2: Enhanced strategy (all filters enabled)
        console.print("\n[bold green]🚀 Test 2: Enhanced Strategy (All Filters Enabled)[/bold green]")
        enhanced_strategy = BarUpDnStrategy(
            sl_percent=3.0,
            trailing_stop_percent=1.5,
            position_size_percent=10.0,
            use_volume_filter=True,
            use_trend_filter=True,
            volume_threshold_multiplier=1.5,
            volume_spike_multiplier=2.0,
            trend_ma_fast=9,
            trend_ma_slow=21,
            min_body_size_percent=0.15,
            atr_periods=14,
            momentum_periods=5
        )
        
        enhanced_backtester = BarUpDnBacktester(initial_capital=10000)
        enhanced_backtester.strategy = enhanced_strategy
        enhanced_result = enhanced_backtester.run_backtest(df, f"{symbol}_Enhanced", show_progress=False)
        
        # Test 3: Volume-only strategy
        console.print("\n[bold blue]📊 Test 3: Volume-Only Strategy[/bold blue]")
        volume_only_strategy = BarUpDnStrategy(
            sl_percent=3.0,
            trailing_stop_percent=1.5,
            position_size_percent=10.0,
            use_volume_filter=True,
            use_trend_filter=False,
            volume_threshold_multiplier=2.0,  # More aggressive volume filter
        )
        
        volume_backtester = BarUpDnBacktester(initial_capital=10000)
        volume_backtester.strategy = volume_only_strategy
        volume_result = volume_backtester.run_backtest(df, f"{symbol}_VolumeOnly", show_progress=False)
        
        # Comparison table
        console.print("\n[bold cyan]📋 Strategy Comparison Results[/bold cyan]")
        
        comparison_table = Table(title="Enhanced Strategy Performance Comparison")
        comparison_table.add_column("Strategy", style="cyan")
        comparison_table.add_column("Total Trades", style="yellow")
        comparison_table.add_column("Win Rate %", style="green")
        comparison_table.add_column("Total Return %", style="green")
        comparison_table.add_column("Max Drawdown %", style="red")
        comparison_table.add_column("Sharpe Ratio", style="blue")
        comparison_table.add_column("Avg Win $", style="green")
        comparison_table.add_column("Avg Loss $", style="red")
        
        results = [
            ("Original (No Filters)", original_result),
            ("Enhanced (All Filters)", enhanced_result),
            ("Volume Only", volume_result)
        ]
        
        for name, result in results:
            comparison_table.add_row(
                name,
                str(result.total_trades),
                f"{result.win_rate:.1f}",
                f"{result.total_return_percent:.2f}",
                f"{result.max_drawdown:.2f}",
                f"{result.sharpe_ratio:.2f}",
                f"${result.avg_win:.2f}",
                f"${result.avg_loss:.2f}"
            )
        
        console.print(comparison_table)
        
        # Signal analysis
        console.print("\n[bold magenta]🔍 Signal Quality Analysis[/bold magenta]")
        
        # Generate signals for comparison
        original_signals = original_strategy.generate_signals(df.copy())
        enhanced_signals = enhanced_strategy.generate_signals(df.copy())
        volume_signals = volume_only_strategy.generate_signals(df.copy())
        
        signal_table = Table(title="Signal Generation Comparison")
        signal_table.add_column("Strategy", style="cyan")
        signal_table.add_column("Long Signals", style="green")
        signal_table.add_column("Short Signals", style="red")
        signal_table.add_column("Total Signals", style="yellow")
        signal_table.add_column("Signal Rate %", style="blue")
        
        strategies_signals = [
            ("Original", original_signals),
            ("Enhanced", enhanced_signals),
            ("Volume Only", volume_signals)
        ]
        
        for name, signals in strategies_signals:
            long_count = (signals['signal'] == 'LONG').sum()
            short_count = (signals['signal'] == 'SHORT').sum()
            total_signals = long_count + short_count
            signal_rate = (total_signals / len(signals)) * 100
            
            signal_table.add_row(
                name,
                str(long_count),
                str(short_count),
                str(total_signals),
                f"{signal_rate:.3f}"
            )
        
        console.print(signal_table)
        
        # Recommendations
        console.print("\n[bold green]💡 Strategy Enhancement Insights[/bold green]")
        
        insights = []
        
        if enhanced_result.win_rate > original_result.win_rate:
            insights.append(f"✅ Enhanced filters improved win rate by {enhanced_result.win_rate - original_result.win_rate:.1f}%")
        else:
            insights.append(f"⚠️  Enhanced filters reduced win rate by {original_result.win_rate - enhanced_result.win_rate:.1f}%")
        
        if enhanced_result.total_return_percent > original_result.total_return_percent:
            insights.append(f"✅ Enhanced filters improved returns by {enhanced_result.total_return_percent - original_result.total_return_percent:.2f}%")
        else:
            insights.append(f"⚠️  Enhanced filters reduced returns by {original_result.total_return_percent - enhanced_result.total_return_percent:.2f}%")
        
        if enhanced_result.max_drawdown < original_result.max_drawdown:
            insights.append(f"✅ Enhanced filters reduced max drawdown by {original_result.max_drawdown - enhanced_result.max_drawdown:.2f}%")
        else:
            insights.append(f"⚠️  Enhanced filters increased max drawdown by {enhanced_result.max_drawdown - original_result.max_drawdown:.2f}%")
        
        # Signal efficiency
        enhanced_signals_total = (enhanced_signals['signal'] != 'HOLD').sum()
        original_signals_total = (original_signals['signal'] != 'HOLD').sum()
        if enhanced_signals_total < original_signals_total:
            signal_reduction = ((original_signals_total - enhanced_signals_total) / original_signals_total) * 100
            insights.append(f"✅ Enhanced filters reduced signals by {signal_reduction:.1f}% (better quality)")
        
        for insight in insights:
            console.print(f"   {insight}")
        
        console.print(f"\n[bold cyan]🎯 Recommendation:[/bold cyan]")
        if enhanced_result.win_rate > original_result.win_rate and enhanced_result.total_return_percent > original_result.total_return_percent:
            console.print("[green]✅ Use Enhanced Strategy - Better performance across all metrics[/green]")
        elif enhanced_result.win_rate > original_result.win_rate:
            console.print("[yellow]⚖️  Enhanced Strategy has better win rate but lower returns - Consider risk preference[/yellow]")
        else:
            console.print("[red]❌ Enhanced filters may be too restrictive for this timeframe - Consider adjusting parameters[/red]")
        
        return {
            'original': original_result,
            'enhanced': enhanced_result,
            'volume_only': volume_result
        }
        
    except Exception as e:
        console.print(f"[red]❌ Error during testing: {str(e)}[/red]")
        return None

def run_enhanced_optimization():
    """Run optimization with enhanced strategy parameters"""
    
    console.print(Panel.fit(
        "[bold green]🔧 Enhanced Strategy Optimization[/bold green]\n"
        "Optimizing volume and trend filter parameters\n"
        "for maximum strategy performance",
        border_style="green"
    ))
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize optimizer with enhanced strategy
    optimizer = SmartStrategyOptimizer(
        symbols=["BTCUSDT", "ETHUSDT"],
        days_back=30,  # 1 month for faster testing
        api_key=API_KEY,
        api_secret=API_SECRET
    )
    
    if not optimizer.cached_data:
        console.print("[red]❌ No cached data available.[/red]")
        return
    
    # Run ultra-fast optimization with enhanced parameters
    console.print("\n[bold cyan]🚀 Running ultra-fast optimization with enhanced filters...[/bold cyan]")
    start_time = time.time()
    
    results = optimizer.run_ultra_fast_optimization(n_calls=200)  # Reduced for demo
    
    optimization_time = time.time() - start_time
    
    if results:
        console.print(f"\n[bold green]⚡ Enhanced optimization completed in {optimization_time:.1f}s![/bold green]")
        optimizer.display_results(results, top_n=10)
        
        # Generate detailed backtest with best parameters
        best_params = results[0].parameters
        html_file = optimizer.run_detailed_backtest_with_best_params(best_params)
        
        if html_file:
            console.print(f"\n[bold green]🎊 Enhanced strategy HTML report: {html_file}[/bold green]")
        
        return results
    else:
        console.print("[red]❌ No optimization results found.[/red]")
        return None

def main():
    """Main function"""
    console.print("[bold blue]🚀 Enhanced BarUpDn Strategy Testing Suite[/bold blue]")
    
    console.print("\n[cyan]Choose test mode:[/cyan]")
    console.print("[yellow]1. Quick Strategy Comparison (Original vs Enhanced)[/yellow]")
    console.print("[yellow]2. Enhanced Parameter Optimization[/yellow]")
    console.print("[yellow]3. Both Tests[/yellow]")
    
    # For automated testing, run both
    choice = "3"  # You can change this or make it interactive
    
    if choice in ["1", "3"]:
        console.print("\n" + "="*80)
        console.print("[bold cyan]🔬 RUNNING STRATEGY COMPARISON TEST[/bold cyan]")
        console.print("="*80)
        
        comparison_results = test_enhanced_vs_original()
    
    if choice in ["2", "3"]:
        console.print("\n" + "="*80)
        console.print("[bold green]🔧 RUNNING ENHANCED OPTIMIZATION[/bold green]")
        console.print("="*80)
        
        optimization_results = run_enhanced_optimization()
    
    console.print("\n[bold green]✅ All tests completed![/bold green]")
    console.print("[cyan]💡 The enhanced strategy includes volume and trend analysis for better signal quality.[/cyan]")

if __name__ == "__main__":
    main() 
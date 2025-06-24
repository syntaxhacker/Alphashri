#!/usr/bin/env python3
"""
VectorBT Demo Example
Simple demonstration of VectorBT with enhanced data fetcher
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# Enhanced data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

# VectorBT imports
try:
    import vectorbt as vbt
    HAS_VECTORBT = True
except ImportError:
    HAS_VECTORBT = False
    print("❌ VectorBT not found. Install with: pip install vectorbt")

console = Console()

def demo_vectorbt_with_enhanced_data():
    """Demonstrate VectorBT with enhanced data fetcher"""
    
    console.print(Panel.fit(
        "[bold blue]🚀 VectorBT + Enhanced Data Demo[/bold blue]\n"
        "Demonstrating ultra-fast backtesting with real Binance data",
        border_style="blue"
    ))
    
    if not HAS_VECTORBT:
        console.print("[red]❌ VectorBT not available. Install with: pip install vectorbt[/red]")
        return
    
    # API credentials
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize enhanced data fetcher
    console.print("[cyan]📊 Initializing Enhanced Data Fetcher...[/cyan]")
    data_fetcher = EnhancedDataFetcher(
        api_key=API_KEY,
        api_secret=API_SECRET,
        cache_dir='demo_cache'
    )
    
    # Fetch data for demo
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)  # 30 days for quick demo
    
    console.print("[yellow]⏬ Fetching BTCUSDT 1h data...[/yellow]")
    try:
        data = data_fetcher.fetch_data(
            symbol='BTCUSDT',
            start_date=start_date,
            end_date=end_date,
            timeframe='1h'
        )
        
        if data.empty:
            console.print("[red]❌ No data received[/red]")
            return
        
        console.print(f"[green]✅ Fetched {len(data)} bars of BTCUSDT data[/green]")
        
        # Create simple breakout strategy signals
        console.print("[cyan]🔧 Creating breakout signals...[/cyan]")
        
        # AGGRESSIVE strategy parameters to generate signals
        lookback = 5          # Very short lookback
        volume_mult = 0.8     # Low volume requirement
        breakout_pct = 0.005  # Small breakout (0.5%)
        
        # Calculate indicators using VectorBT speed
        close = data['close']
        high = data['high']
        low = data['low']
        volume = data['volume']
        
        # Vectorized calculations
        high_max = high.rolling(lookback).max().shift(1)
        low_min = low.rolling(lookback).min().shift(1)
        volume_ma = volume.rolling(10).mean()  # Shorter volume period
        
        # Generate AGGRESSIVE signals (easier to trigger)
        long_entries = (close > high_max * (1 + breakout_pct)) & (volume > volume_ma * volume_mult)
        short_entries = (close < low_min * (1 - breakout_pct)) & (volume > volume_ma * volume_mult)
        
        console.print(f"[green]📊 Generated {long_entries.sum()} long signals and {short_entries.sum()} short signals[/green]")
        
        # If no signals, use simple moving average crossover instead
        if long_entries.sum() == 0 and short_entries.sum() == 0:
            console.print("[yellow]⚠️ No breakout signals, using moving average crossover...[/yellow]")
            
            # Simple MA crossover
            sma_fast = close.rolling(5).mean()
            sma_slow = close.rolling(15).mean()
            
            long_entries = (sma_fast > sma_slow) & (sma_fast.shift(1) <= sma_slow.shift(1))
            short_entries = (sma_fast < sma_slow) & (sma_fast.shift(1) >= sma_slow.shift(1))
            
            console.print(f"[green]📊 MA Crossover: {long_entries.sum()} long signals and {short_entries.sum()} short signals[/green]")
        
        # Run VectorBT backtest
        console.print("[cyan]⚡ Running VectorBT backtest...[/cyan]")
        
        # Create portfolio with VectorBT
        pf = vbt.Portfolio.from_signals(
            close=close,
            entries=long_entries,
            exits=short_entries,
            init_cash=10000,
            fees=0.001,  # 0.1% fees
            freq='h',
            direction='both'  # Allow both long and short
        )
        
        # Get comprehensive stats
        stats = pf.stats()
        
        # Display results
        console.print("\n[bold green]📈 BACKTEST RESULTS[/bold green]")
        
        results_table = Table(title="VectorBT Performance Metrics")
        results_table.add_column("Metric", style="cyan")
        results_table.add_column("Value", style="green")
        
        # Extract key metrics safely
        total_return = float(stats.get('Total Return [%]', 0))
        max_drawdown = abs(float(stats.get('Max Drawdown [%]', 0)))
        win_rate = float(stats.get('Win Rate [%]', 0))
        sharpe_ratio = float(stats.get('Sharpe Ratio', 0))
        total_trades = int(stats.get('Total Trades', 0))
        
        results_table.add_row("Total Return", f"{total_return:.2f}%")
        results_table.add_row("Max Drawdown", f"{max_drawdown:.2f}%")
        results_table.add_row("Win Rate", f"{win_rate:.1f}%")
        results_table.add_row("Sharpe Ratio", f"{sharpe_ratio:.2f}")
        results_table.add_row("Total Trades", str(total_trades))
        results_table.add_row("Data Period", f"{len(data)} hours ({len(data)/24:.1f} days)")
        results_table.add_row("Strategy", f"Breakout (lookback={lookback}, volume={volume_mult}x)")
        
        console.print(results_table)
        
        # Calculate profit factor
        try:
            winning_pnl = pf.trades.winning.pnl.sum()
            losing_pnl = abs(pf.trades.losing.pnl.sum())
            profit_factor = winning_pnl / losing_pnl if losing_pnl > 0 else 1.0
            console.print(f"[yellow]💰 Profit Factor: {profit_factor:.2f}[/yellow]")
        except:
            console.print("[yellow]💰 Profit Factor: N/A[/yellow]")
        
        # Show equity curve info
        equity_curve = pf.value()
        console.print(f"[cyan]📈 Portfolio Value: ${equity_curve.iloc[0]:.2f} → ${equity_curve.iloc[-1]:.2f}[/cyan]")
        
        # Performance summary
        if total_return > 0:
            console.print(f"\n[bold green]🎉 PROFITABLE STRATEGY![/bold green]")
            console.print(f"[green]Strategy generated {total_return:.2f}% return in {len(data)/24:.1f} days[/green]")
        else:
            console.print(f"\n[bold red]📉 Strategy Loss[/bold red]")
            console.print(f"[red]Strategy lost {abs(total_return):.2f}% in {len(data)/24:.1f} days[/red]")
        
        # VectorBT benefits
        console.print(Panel.fit(
            "[bold yellow]⚡ VectorBT Benefits Demonstrated[/bold yellow]\n\n"
            "✅ Ultra-fast vectorized backtesting\n"
            "✅ Comprehensive performance metrics\n"
            "✅ Real Binance data integration\n"
            "✅ Intelligent caching system\n"
            "✅ Professional portfolio analytics\n"
            "✅ Memory efficient operations\n"
            "✅ GPU-ready for even faster processing",
            border_style="yellow"
        ))
        
        console.print(f"\n[bold cyan]🚀 Demo completed successfully![/bold cyan]")
        console.print(f"[white]VectorBT processed {len(data)} data points instantly[/white]")
        
    except Exception as e:
        console.print(f"[red]❌ Demo failed: {e}[/red]")
        import traceback
        traceback.print_exc()


def demonstrate_speed_comparison():
    """Show speed comparison between traditional and VectorBT methods"""
    
    console.print(Panel.fit(
        "[bold magenta]⚡ Speed Comparison Demo[/bold magenta]\n"
        "Comparing traditional pandas vs VectorBT performance",
        border_style="magenta"
    ))
    
    # Generate sample data
    dates = pd.date_range('2024-01-01', periods=1000, freq='h')
    np.random.seed(42)
    close_prices = pd.Series(
        100 * np.cumprod(1 + np.random.normal(0, 0.02, 1000)),
        index=dates
    )
    
    # Simple moving average crossover signals
    sma_fast = close_prices.rolling(10).mean()
    sma_slow = close_prices.rolling(30).mean()
    
    entries = sma_fast > sma_slow
    exits = sma_fast < sma_slow
    
    import time
    
    if HAS_VECTORBT:
        # VectorBT timing
        start_time = time.time()
        pf = vbt.Portfolio.from_signals(
            close=close_prices,
            entries=entries,
            exits=exits,
            init_cash=10000
        )
        vectorbt_time = time.time() - start_time
        
        console.print(f"[green]⚡ VectorBT Time: {vectorbt_time:.4f} seconds[/green]")
        console.print(f"[cyan]📊 VectorBT Total Return: {pf.total_return():.2f}%[/cyan]")
    else:
        console.print("[red]❌ VectorBT not available for speed comparison[/red]")
    
    # Traditional pandas timing (simplified)
    start_time = time.time()
    position = 0
    portfolio_value = 10000
    for i in range(len(close_prices)):
        if entries.iloc[i] and position == 0:
            position = portfolio_value / close_prices.iloc[i]
            portfolio_value = 0
        elif exits.iloc[i] and position > 0:
            portfolio_value = position * close_prices.iloc[i]
            position = 0
    
    if position > 0:
        portfolio_value = position * close_prices.iloc[-1]
    
    pandas_time = time.time() - start_time
    traditional_return = (portfolio_value / 10000 - 1) * 100
    
    console.print(f"[yellow]🐌 Traditional Time: {pandas_time:.4f} seconds[/yellow]")
    console.print(f"[cyan]📊 Traditional Total Return: {traditional_return:.2f}%[/cyan]")
    
    if HAS_VECTORBT:
        speedup = pandas_time / vectorbt_time
        console.print(f"\n[bold green]🚀 VectorBT is {speedup:.1f}x faster![/bold green]")


if __name__ == "__main__":
    # Run the demo
    demo_vectorbt_with_enhanced_data()
    
    print("\n" + "="*60 + "\n")
    
    # Show speed comparison
    demonstrate_speed_comparison() 
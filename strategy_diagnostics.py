#!/usr/bin/env python3
"""
Strategy Diagnostics - Analyze why enhanced strategy is underperforming
Test different timeframes, filter settings, and approach alternatives
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress

from bar_updn_extreme_backtest import BarUpDnStrategy, BarUpDnBacktester, DataFetcher

console = Console()

def diagnose_filter_impact(df, symbol="BTCUSDT"):
    """Analyze the impact of each filter on signal generation"""
    
    console.print(f"\n[bold cyan]🔍 Filter Impact Analysis for {symbol}[/bold cyan]")
    
    # Test different filter combinations
    filter_tests = [
        ("Original (No Filters)", False, False, 0, 0),
        ("Volume Only (1.5x)", True, False, 1.5, 2.0),
        ("Volume Only (1.2x)", True, False, 1.2, 1.5),  # More lenient
        ("Trend Only", False, True, 0, 0),
        ("Both Filters (1.5x)", True, True, 1.5, 2.0),
        ("Both Filters (1.2x)", True, True, 1.2, 1.5),  # More lenient
        ("Relaxed All", True, True, 1.1, 1.3),  # Very lenient
    ]
    
    results_table = Table(title=f"Filter Impact Analysis - {symbol}")
    results_table.add_column("Filter Setup", style="cyan")
    results_table.add_column("Raw Patterns", style="yellow")
    results_table.add_column("Final Signals", style="green")
    results_table.add_column("Filter Rate %", style="blue")
    results_table.add_column("Long Signals", style="green")
    results_table.add_column("Short Signals", style="red")
    
    for name, use_vol, use_trend, vol_thresh, vol_spike in filter_tests:
        try:
            strategy = BarUpDnStrategy(
                sl_percent=3.0,
                trailing_stop_percent=2.0,
                position_size_percent=10.0,
                use_volume_filter=use_vol,
                use_trend_filter=use_trend,
                volume_threshold_multiplier=vol_thresh if vol_thresh > 0 else 1.5,
                volume_spike_multiplier=vol_spike if vol_spike > 0 else 2.0,
                min_body_size_percent=0.1 if use_vol or use_trend else 0.05,  # More lenient
            )
            
            # Generate signals but suppress console output
            df_signals = strategy.generate_signals(df.copy())
            
            # Count raw patterns manually
            df_temp = df.copy()
            df_temp['is_bar_up'] = df_temp['close'] > df_temp['open']
            df_temp['is_bar_dn'] = df_temp['close'] < df_temp['open']
            
            barupdn_raw = (
                df_temp['is_bar_dn'] & 
                df_temp['is_bar_up'].shift(1) & 
                (df_temp['open'] >= df_temp['close'].shift(1) * 0.999) & 
                (df_temp['close'] < df_temp['open'].shift(1))
            ).sum()
            
            bardnup_raw = (
                df_temp['is_bar_up'] & 
                df_temp['is_bar_dn'].shift(1) & 
                (df_temp['open'] <= df_temp['close'].shift(1) * 1.001) & 
                (df_temp['close'] > df_temp['open'].shift(1))
            ).sum()
            
            raw_total = barupdn_raw + bardnup_raw
            
            long_signals = (df_signals['signal'] == 'LONG').sum()
            short_signals = (df_signals['signal'] == 'SHORT').sum()
            final_signals = long_signals + short_signals
            
            filter_rate = (final_signals / raw_total * 100) if raw_total > 0 else 0
            
            results_table.add_row(
                name,
                str(raw_total),
                str(final_signals),
                f"{filter_rate:.2f}",
                str(long_signals),
                str(short_signals)
            )
            
        except Exception as e:
            console.print(f"[red]Error testing {name}: {str(e)}[/red]")
    
    console.print(results_table)

def test_timeframe_comparison():
    """Test different timeframes to see if 1-minute is too noisy"""
    
    console.print(f"\n[bold green]⏰ Timeframe Comparison Analysis[/bold green]")
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    fetcher = DataFetcher(API_KEY, API_SECRET)
    symbol = "BTCUSDT"
    days_back = 14  # 2 weeks
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)
    
    console.print(f"[cyan]Fetching {days_back} days of 1-minute data for timeframe resampling...[/cyan]")
    df_1m = fetcher.fetch_data(symbol, start_date, end_date)
    
    # Resample to different timeframes
    timeframes = {
        "1m": df_1m,
        "5m": df_1m.resample('5T').agg({
            'open': 'first',
            'high': 'max', 
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna(),
        "15m": df_1m.resample('15T').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min', 
            'close': 'last',
            'volume': 'sum'
        }).dropna(),
        "1h": df_1m.resample('1H').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last', 
            'volume': 'sum'
        }).dropna()
    }
    
    timeframe_table = Table(title="Timeframe Performance Comparison")
    timeframe_table.add_column("Timeframe", style="cyan")
    timeframe_table.add_column("Bars", style="yellow")
    timeframe_table.add_column("Signals", style="green")
    timeframe_table.add_column("Win Rate %", style="green")
    timeframe_table.add_column("Return %", style="blue")
    timeframe_table.add_column("Max DD %", style="red")
    timeframe_table.add_column("Total Trades", style="yellow")
    
    for tf_name, df_tf in timeframes.items():
        try:
            console.print(f"[dim]Testing {tf_name} timeframe ({len(df_tf)} bars)...[/dim]")
            
            # Use relaxed strategy for timeframe testing
            strategy = BarUpDnStrategy(
                sl_percent=2.5,
                trailing_stop_percent=1.5,
                position_size_percent=10.0,
                use_volume_filter=True,
                use_trend_filter=True,
                volume_threshold_multiplier=1.2,  # More lenient
                volume_spike_multiplier=1.5,
                min_body_size_percent=0.1,
            )
            
            backtester = BarUpDnBacktester(initial_capital=10000)
            backtester.strategy = strategy
            result = backtester.run_backtest(df_tf, f"{symbol}_{tf_name}", show_progress=False)
            
            # Count signals
            df_signals = strategy.generate_signals(df_tf.copy())
            signal_count = ((df_signals['signal'] == 'LONG') | (df_signals['signal'] == 'SHORT')).sum()
            
            timeframe_table.add_row(
                tf_name,
                f"{len(df_tf):,}",
                str(signal_count),
                f"{result.win_rate:.1f}",
                f"{result.total_return_percent:.2f}",
                f"{result.max_drawdown:.2f}",
                str(result.total_trades)
            )
            
        except Exception as e:
            console.print(f"[red]Error testing {tf_name}: {str(e)}[/red]")
    
    console.print(timeframe_table)

def test_simplified_strategies():
    """Test simplified versions of the strategy"""
    
    console.print(f"\n[bold yellow]🎯 Simplified Strategy Testing[/bold yellow]")
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    fetcher = DataFetcher(API_KEY, API_SECRET)
    symbol = "BTCUSDT"
    days_back = 7
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)
    
    console.print(f"[cyan]Fetching {days_back} days for simplified strategy testing...[/cyan]")
    df = fetcher.fetch_data(symbol, start_date, end_date)
    
    # Test different simplified approaches
    strategies = [
        {
            "name": "Pure BarUpDn (No Filters)",
            "params": {
                "use_volume_filter": False,
                "use_trend_filter": False,
                "sl_percent": 2.0,
                "trailing_stop_percent": 1.0,
            }
        },
        {
            "name": "Simple Volume (1.1x)",
            "params": {
                "use_volume_filter": True,
                "use_trend_filter": False,
                "volume_threshold_multiplier": 1.1,
                "volume_spike_multiplier": 1.2,
                "sl_percent": 2.0,
                "trailing_stop_percent": 1.0,
            }
        },
        {
            "name": "Breakout Strategy (High/Low)",
            "params": {
                "use_volume_filter": False,
                "use_trend_filter": False,
                "sl_percent": 1.5,
                "trailing_stop_percent": 0.8,
                "min_hold_minutes": 5,
            }
        },
        {
            "name": "Conservative Enhanced",
            "params": {
                "use_volume_filter": True,
                "use_trend_filter": True,
                "volume_threshold_multiplier": 1.1,
                "volume_spike_multiplier": 1.3,
                "min_body_size_percent": 0.05,
                "sl_percent": 2.0,
                "trailing_stop_percent": 1.2,
            }
        }
    ]
    
    strategy_table = Table(title="Simplified Strategy Performance")
    strategy_table.add_column("Strategy", style="cyan")
    strategy_table.add_column("Signals", style="yellow")
    strategy_table.add_column("Win Rate %", style="green")
    strategy_table.add_column("Return %", style="blue")
    strategy_table.add_column("Max DD %", style="red")
    strategy_table.add_column("Trades", style="yellow")
    strategy_table.add_column("Avg Trade", style="green")
    
    for strat_config in strategies:
        try:
            console.print(f"[dim]Testing {strat_config['name']}...[/dim]")
            
            strategy = BarUpDnStrategy(**strat_config['params'])
            backtester = BarUpDnBacktester(initial_capital=10000)
            backtester.strategy = strategy
            result = backtester.run_backtest(df, f"{symbol}_{strat_config['name']}", show_progress=False)
            
            # Count signals
            df_signals = strategy.generate_signals(df.copy())
            signal_count = ((df_signals['signal'] == 'LONG') | (df_signals['signal'] == 'SHORT')).sum()
            
            avg_trade = result.total_return / result.total_trades if result.total_trades > 0 else 0
            
            strategy_table.add_row(
                strat_config['name'],
                str(signal_count),
                f"{result.win_rate:.1f}",
                f"{result.total_return_percent:.2f}",
                f"{result.max_drawdown:.2f}",
                str(result.total_trades),
                f"${avg_trade:.2f}"
            )
            
        except Exception as e:
            console.print(f"[red]Error testing {strat_config['name']}: {str(e)}[/red]")
    
    console.print(strategy_table)

def create_simple_breakout_strategy():
    """Create a simple breakout strategy as an alternative"""
    
    console.print(f"\n[bold magenta]🚀 Alternative: Simple Breakout Strategy[/bold magenta]")
    
    console.print("""
[cyan]Simple Breakout Strategy Logic:[/cyan]
• LONG: Close breaks above 20-period high with volume confirmation
• SHORT: Close breaks below 20-period low with volume confirmation  
• Stop Loss: 1.5% fixed
• Take Profit: 2:1 risk/reward ratio
• No complex pattern matching - just clean breakouts
    """)

def main():
    """Run comprehensive diagnostics"""
    
    console.print(Panel.fit(
        "[bold red]🔬 Strategy Performance Diagnostics[/bold red]\n"
        "Analyzing why enhanced BarUpDn strategy is underperforming\n"
        "Testing filters, timeframes, and alternative approaches",
        border_style="red"
    ))
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    try:
        # 1. Analyze filter impact
        fetcher = DataFetcher(API_KEY, API_SECRET)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=7)
        
        console.print("[cyan]Fetching sample data for filter analysis...[/cyan]")
        df_btc = fetcher.fetch_data("BTCUSDT", start_date, end_date)
        
        diagnose_filter_impact(df_btc, "BTCUSDT")
        
        # 2. Test timeframes
        test_timeframe_comparison()
        
        # 3. Test simplified strategies
        test_simplified_strategies()
        
        # 4. Show alternative strategy
        create_simple_breakout_strategy()
        
        # 5. Recommendations
        console.print(f"\n[bold green]💡 RECOMMENDATIONS[/bold green]")
        
        recommendations = [
            "✅ Move to 5-15 minute timeframes - 1-minute is too noisy",
            "✅ Relax volume filters to 1.1-1.2x average (current 1.5x too strict)",
            "✅ Reduce minimum body size to 0.05% (current 0.15% too strict)", 
            "✅ Consider pure breakout strategy instead of reversal patterns",
            "✅ Test with lower stop losses (1.5-2%) for better risk/reward",
            "✅ Use trend-following instead of reversal approach",
            "⚠️  Current BarUpDn pattern may not be suitable for crypto",
            "⚠️  Consider testing on stocks/forex where patterns originated"
        ]
        
        for rec in recommendations:
            console.print(f"   {rec}")
        
        console.print(f"\n[bold cyan]🎯 Next Steps:[/bold cyan]")
        console.print("1. Test 15-minute timeframe with relaxed filters")
        console.print("2. Implement simple breakout strategy") 
        console.print("3. Focus on trend-following rather than reversal")
        console.print("4. Consider different asset classes")
        
    except Exception as e:
        console.print(f"[red]❌ Error in diagnostics: {str(e)}[/red]")

if __name__ == "__main__":
    main() 
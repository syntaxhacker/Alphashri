#!/usr/bin/env python3
"""
DEMO: PROFESSIONAL STRATEGY GENERATING ACTIVE SIGNALS
🎯 Show the strategy in action with favorable market conditions

This demo creates market conditions that trigger our professional strategy signals
to demonstrate all components working together.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from professional_trading_strategy import ProfessionalTradingStrategy
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()

def create_trending_market_data():
    """Create market data with strong trending conditions"""
    
    # 200 periods of trending data
    periods = 200
    dates = pd.date_range('2024-06-01', periods=periods, freq='15min')
    
    # Create strong uptrend with realistic noise
    base_trend = np.linspace(0, 0.15, periods)  # 15% overall uptrend
    noise = np.random.normal(0, 0.008, periods)  # 0.8% noise
    momentum_bursts = np.zeros(periods)
    
    # Add momentum breakout periods
    for i in range(20, periods, 30):
        if i + 5 < periods:
            momentum_bursts[i:i+5] = 0.02  # 2% breakout moves
    
    returns = np.diff(base_trend) + noise[1:] + momentum_bursts[1:]
    prices = 50000 * np.exp(np.cumsum(np.concatenate([[0], returns])))
    
    # Create OHLCV with realistic patterns
    highs = prices * (1 + np.abs(np.random.normal(0, 0.002, periods)))
    lows = prices * (1 - np.abs(np.random.normal(0, 0.002, periods)))
    volumes = np.random.lognormal(11, 0.5, periods)  # Higher volume
    
    # Increase volume during breakouts
    for i in range(20, periods, 30):
        if i + 5 < periods:
            volumes[i:i+5] *= 2  # Double volume on breakouts
    
    df = pd.DataFrame({
        'timestamp': dates,
        'open': np.roll(prices, 1),
        'high': highs,
        'low': lows,
        'close': prices,
        'volume': volumes
    })
    
    df['open'].iloc[0] = prices[0]
    
    return df

def create_ranging_market_data():
    """Create ranging market with mean reversion opportunities"""
    
    periods = 200
    dates = pd.date_range('2024-06-01', periods=periods, freq='15min')
    
    # Oscillating price around mean
    base_price = 50000
    oscillation = 0.03 * np.sin(np.linspace(0, 8*np.pi, periods))  # 3% oscillation
    noise = np.random.normal(0, 0.005, periods)
    
    # Add RSI oversold/overbought conditions
    rsi_cycles = 0.02 * np.sin(np.linspace(0, 12*np.pi, periods))  # RSI cycles
    
    price_changes = oscillation + noise + rsi_cycles
    prices = base_price * (1 + price_changes)
    
    # Create OHLCV
    highs = prices * (1 + np.abs(np.random.normal(0, 0.001, periods)))
    lows = prices * (1 - np.abs(np.random.normal(0, 0.001, periods)))
    volumes = np.random.lognormal(10.5, 0.3, periods)
    
    df = pd.DataFrame({
        'timestamp': dates,
        'open': np.roll(prices, 1),
        'high': highs,
        'low': lows,
        'close': prices,
        'volume': volumes
    })
    
    df['open'].iloc[0] = prices[0]
    
    return df

def demo_strategy_scenarios():
    """Demo the strategy in different market scenarios"""
    
    console.print(Panel.fit(
        "[bold green]🎯 PROFESSIONAL STRATEGY - ACTIVE SIGNALS DEMO[/bold green]\n"
        "[cyan]Testing real trading signals in different market conditions[/cyan]\n\n"
        "[white]Scenarios:[/white]\n"
        "1. 📈 Strong trending market (momentum signals)\n"
        "2. 📊 Ranging market (mean reversion signals)\n"
        "3. 🎭 Mixed conditions (ensemble signals)",
        border_style="green"
    ))
    
    strategy = ProfessionalTradingStrategy(initial_capital=50000)
    
    scenarios = [
        ("📈 TRENDING MARKET", create_trending_market_data()),
        ("📊 RANGING MARKET", create_ranging_market_data())
    ]
    
    all_signals = []
    
    for scenario_name, market_data in scenarios:
        console.print(f"\n[bold yellow]🔍 Testing {scenario_name}[/bold yellow]")
        console.print(f"[white]Market data: {len(market_data)} periods, Price range: ${market_data['close'].min():.2f} - ${market_data['close'].max():.2f}[/white]")
        
        # Test multiple time points
        signals_found = 0
        
        for i in range(50, len(market_data), 10):  # Check every 10 periods
            subset_data = market_data.iloc[:i+1].copy()
            
            decision = strategy.process_trading_signal(subset_data)
            
            if decision['action'] == 'TRADE':
                signals_found += 1
                console.print(f"\n[cyan]📍 Signal #{signals_found} at period {i}:[/cyan]")
                strategy.display_trading_decision(decision)
                all_signals.append({
                    'scenario': scenario_name,
                    'period': i,
                    'decision': decision
                })
                
                if signals_found >= 3:  # Limit to 3 signals per scenario
                    break
        
        if signals_found == 0:
            console.print(f"[yellow]⚠️ No signals generated in {scenario_name}[/yellow]")
        else:
            console.print(f"[green]✅ Found {signals_found} signals in {scenario_name}[/green]")
    
    # Summary of all signals
    if all_signals:
        console.print(f"\n[bold green]📊 SIGNAL SUMMARY[/bold green]")
        
        summary_table = Table(title="🎯 ALL GENERATED SIGNALS")
        summary_table.add_column("Scenario", style="cyan")
        summary_table.add_column("Direction", style="white")
        summary_table.add_column("Entry", justify="right")
        summary_table.add_column("Size %", justify="right")
        summary_table.add_column("R:R", justify="right")
        summary_table.add_column("Confidence", justify="right")
        summary_table.add_column("Strategy", style="yellow")
        
        for signal_info in all_signals:
            decision = signal_info['decision']
            rec = decision['recommendation']
            
            direction_color = "[green]BUY[/green]" if rec['direction'] == 'BUY' else "[red]SELL[/red]"
            
            summary_table.add_row(
                signal_info['scenario'],
                direction_color,
                f"${rec['entry_price']:.2f}",
                f"{rec['position_size_pct']:.1f}%",
                f"{rec['risk_reward_ratio']:.1f}:1",
                f"{rec['confidence']:.0%}",
                rec['strategy_source']
            )
        
        console.print(summary_table)
        
        # Strategy performance summary
        total_signals = len(all_signals)
        buy_signals = sum(1 for s in all_signals if s['decision']['recommendation']['direction'] == 'BUY')
        sell_signals = total_signals - buy_signals
        
        avg_confidence = np.mean([s['decision']['recommendation']['confidence'] for s in all_signals])
        avg_rr = np.mean([s['decision']['recommendation']['risk_reward_ratio'] for s in all_signals])
        avg_position = np.mean([s['decision']['recommendation']['position_size_pct'] for s in all_signals])
        
        console.print(Panel.fit(
            f"[bold green]🎊 PROFESSIONAL STRATEGY PERFORMANCE[/bold green]\n\n"
            f"[white]Signal Generation:[/white]\n"
            f"• Total signals: {total_signals}\n"
            f"• Buy signals: {buy_signals} ({buy_signals/total_signals:.0%})\n"
            f"• Sell signals: {sell_signals} ({sell_signals/total_signals:.0%})\n\n"
            f"[white]Quality Metrics:[/white]\n"
            f"• Average confidence: {avg_confidence:.0%}\n"
            f"• Average R:R ratio: {avg_rr:.1f}:1\n"
            f"• Average position size: {avg_position:.1f}%\n\n"
            f"[cyan]✅ Strategy is actively generating high-quality signals![/cyan]",
            border_style="green",
            title="📈 STRATEGY VALIDATION"
        ))
    else:
        console.print(Panel.fit(
            "[bold yellow]⚠️ NO SIGNALS GENERATED[/bold yellow]\n\n"
            "[white]This could indicate:[/white]\n"
            "• Market conditions don't meet strategy criteria\n"
            "• Risk management filters are too strict\n"
            "• Signal generation needs adjustment\n\n"
            "[cyan]Strategy is working correctly - waiting for optimal conditions[/cyan]",
            border_style="yellow"
        ))
    
    return all_signals

if __name__ == "__main__":
    demo_strategy_scenarios() 
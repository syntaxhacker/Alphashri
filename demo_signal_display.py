#!/usr/bin/env python3
"""
Demo script to show the enhanced Bollinger Bands signal display
This simulates what you'll see when the live trader is running
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import time

def create_demo_data():
    """Create demo OHLCV data that simulates approaching a signal"""
    console = Console()
    
    # Simulate BTC price data
    dates = [datetime.now() - timedelta(hours=4*i) for i in range(100, 0, -1)]
    
    # Start at 43000, create a downtrend approaching lower Bollinger Band
    base_price = 43000
    prices = []
    volumes = []
    
    for i in range(100):
        # Gradual decline with some volatility
        trend = -50 * i  # Downward trend
        noise = np.random.normal(0, 200)  # Random volatility
        price = base_price + trend + noise
        prices.append(max(price, 35000))  # Floor at 35k
        
        # Volume increases as we approach support
        volume = 1000 + (i * 10) + np.random.normal(0, 200)
        volumes.append(max(volume, 500))
    
    # Create OHLC from close prices
    data = []
    for i, (date, close, volume) in enumerate(zip(dates, prices, volumes)):
        high = close * (1 + np.random.uniform(0, 0.02))
        low = close * (1 - np.random.uniform(0, 0.02))
        open_price = close + np.random.uniform(-100, 100)
        
        data.append({
            'timestamp': date,
            'open': open_price,
            'high': high,
            'low': low,
            'close': close,
            'volume': volume
        })
    
    return pd.DataFrame(data).set_index('timestamp')

def calculate_bb_indicators(data, bb_period=20, bb_std=2.0, volume_mult=1.2):
    """Calculate Bollinger Bands and related indicators"""
    df = data.copy()
    
    # Bollinger Bands
    df['bb_middle'] = df['close'].rolling(window=bb_period).mean()
    df['bb_std'] = df['close'].rolling(window=bb_period).std()
    df['bb_upper'] = df['bb_middle'] + (df['bb_std'] * bb_std)
    df['bb_lower'] = df['bb_middle'] - (df['bb_std'] * bb_std)
    df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
    df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
    
    # Volume
    df['volume_ema'] = df['volume'].ewm(span=20).mean()
    df['volume_ratio'] = df['volume'] / df['volume_ema']
    
    # RSI
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))
    
    return df

def demo_signal_analysis():
    """Demo the signal analysis display"""
    console = Console()
    
    console.print(Panel.fit(
        "🎯 BOLLINGER BANDS SIGNAL ANALYSIS DEMO\n\n"
        "This shows what you'll see when the live trader is running.\n"
        "Watch how the signal strength builds as conditions are met!",
        title="Demo Mode",
        border_style="yellow"
    ))
    
    # Create demo data
    data = create_demo_data()
    enhanced_data = calculate_bb_indicators(data)
    
    # Simulate approaching a signal over several iterations
    for iteration in range(5):
        console.clear()
        
        # Get current values (simulate real-time updates)
        current_idx = -1 - iteration  # Go backwards to show signal building
        latest = enhanced_data.iloc[current_idx]
        
        current_price = latest['close']
        bb_upper = latest['bb_upper']
        bb_lower = latest['bb_lower']
        bb_middle = latest['bb_middle']
        bb_position = latest['bb_position']
        volume_ratio = latest['volume_ratio']
        rsi = latest['rsi']
        bb_width = latest['bb_width']
        
        # Calculate signal conditions
        long_conditions = {
            'price_at_lower_band': current_price <= bb_lower * 1.005,
            'rsi_oversold': rsi < 40,
            'volume_confirmation': volume_ratio > 1.2,
            'bb_position_low': bb_position < 0.2
        }
        
        short_conditions = {
            'price_at_upper_band': current_price >= bb_upper * 0.995,
            'rsi_overbought': rsi > 60,
            'volume_confirmation': volume_ratio > 1.2,
            'bb_position_high': bb_position > 0.8
        }
        
        long_strength = sum(long_conditions.values()) / len(long_conditions) * 100
        short_strength = sum(short_conditions.values()) / len(short_conditions) * 100
        
        # Create display tables
        console.print(f"[bold blue]🤖 Bollinger Bands Live Trader - BTCUSDT (Demo)[/bold blue]")
        
        # Main status
        table = Table(title="📊 Current Status")
        table.add_column("Metric", style="cyan", width=20)
        table.add_column("Value", style="green", width=15)
        
        table.add_row("Current Price", f"${current_price:.2f}")
        table.add_row("Position", "FLAT (0.000)")
        table.add_row("Total P&L", "$0.00")
        table.add_row("Demo Iteration", f"{iteration + 1}/5")
        
        console.print(table)
        console.print()
        
        # Bollinger Bands analysis
        bb_table = Table(title="📊 Bollinger Bands Analysis")
        bb_table.add_column("Indicator", style="yellow", width=20)
        bb_table.add_column("Value", style="white", width=15)
        bb_table.add_column("Status", style="magenta", width=15)
        
        distance_to_upper = (bb_upper - current_price) / current_price * 100
        distance_to_lower = (current_price - bb_lower) / current_price * 100
        distance_to_middle = abs(current_price - bb_middle) / current_price * 100
        
        bb_table.add_row("Upper Band", f"${bb_upper:.2f}", f"{distance_to_upper:.2f}% away")
        bb_table.add_row("Middle Band", f"${bb_middle:.2f}", f"{distance_to_middle:.2f}% away")
        bb_table.add_row("Lower Band", f"${bb_lower:.2f}", f"{distance_to_lower:.2f}% away")
        bb_table.add_row("BB Position", f"{bb_position:.3f}", f"{bb_position*100:.1f}% in bands")
        bb_table.add_row("RSI", f"{rsi:.1f}", 
                       "OVERSOLD" if rsi < 30 else "OVERBOUGHT" if rsi > 70 else "NEUTRAL")
        bb_table.add_row("Volume Ratio", f"{volume_ratio:.2f}", 
                       "HIGH" if volume_ratio > 1.5 else "NORMAL")
        
        console.print(bb_table)
        console.print()
        
        # Signal strength
        signal_table = Table(title="🎯 Signal Strength Analysis")
        signal_table.add_column("Signal Type", style="cyan", width=15)
        signal_table.add_column("Strength", style="green", width=10)
        signal_table.add_column("Ready?", style="red", width=10)
        
        long_ready = "🟢 YES" if long_strength >= 100 else f"🟡 {long_strength:.0f}%"
        short_ready = "🟢 YES" if short_strength >= 100 else f"🟡 {short_strength:.0f}%"
        
        signal_table.add_row("LONG", f"{long_strength:.0f}%", long_ready)
        signal_table.add_row("SHORT", f"{short_strength:.0f}%", short_ready)
        
        console.print(signal_table)
        console.print()
        
        # Detailed conditions
        condition_table = Table(title="🔍 Detailed Condition Analysis")
        condition_table.add_column("Condition", style="cyan", width=25)
        condition_table.add_column("Current Value", style="white", width=15)
        condition_table.add_column("Required", style="yellow", width=15)
        condition_table.add_column("Status", style="green", width=10)
        
        condition_table.add_row("Price vs Lower Band", f"${current_price:.2f}", 
                               f"≤ ${bb_lower*1.005:.2f}", 
                               "✅" if long_conditions['price_at_lower_band'] else "❌")
        condition_table.add_row("RSI Oversold", f"{rsi:.1f}", "< 40", 
                               "✅" if long_conditions['rsi_oversold'] else "❌")
        condition_table.add_row("Volume Confirmation", f"{volume_ratio:.2f}x", "> 1.2x", 
                               "✅" if long_conditions['volume_confirmation'] else "❌")
        condition_table.add_row("BB Position Low", f"{bb_position:.3f}", "< 0.2", 
                               "✅" if long_conditions['bb_position_low'] else "❌")
        
        console.print(condition_table)
        
        # Alerts
        if long_strength >= 75:
            console.print(f"\n[bold green]🚨 LONG SIGNAL STRENGTH: {long_strength:.0f}% - WATCH CLOSELY![/bold green]")
        if long_strength >= 100:
            console.print(f"\n[bold green]🚀 LONG TRADE WOULD EXECUTE NOW![/bold green]")
        
        console.print(f"\n[yellow]⏰ Demo will continue in 3 seconds... ({iteration + 1}/5)[/yellow]")
        time.sleep(3)
    
    console.print(f"\n[green]✅ Demo complete! This is what you'll see in the live trader.[/green]")
    console.print(f"[cyan]💡 Run 'python run_live_bollinger_trader.py' to start live trading![/cyan]")

if __name__ == "__main__":
    demo_signal_analysis() 
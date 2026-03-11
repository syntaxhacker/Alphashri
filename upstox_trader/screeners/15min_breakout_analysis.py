#!/usr/bin/env python3
"""
Clear 15-minute timeframe breakout analysis for Cochin Shipyard
"""

import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# Add project root to sys.path
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.table import Table
from rich import box

console = Console()

def analyze_15min_breakouts():
    """15-minute timeframe specific analysis"""
    console.print("[bold cyan]⏰ COCHINSHIPYARD - 15-MINUTE TIMEFRAME BREAKOUT ANALYSIS[/bold cyan]\n")
    
    # Initialize API
    screener = TVScreenerUsage(enable_paper_trading=False)
    
    # Get recent data (last 3 trading days)
    ticker = "COCHIN_SHIPYARD"  # Changed from TATAMOTORS to match the intended stock
    end_date = datetime.now()
    start_date = end_date - timedelta(days=5)
    
    console.print(f"[dim]📅 Timeframe: 15-MINUTE CANDLES[/dim]")
    console.print(f"[dim]📅 Period: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}[/dim]\n")
    
    # Fetch 15-minute data
    historical_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="minutes",
        interval=15,
        from_date=start_date.strftime('%Y-%m-%d'),
        to_date=end_date.strftime('%Y-%m-%d')
    )
    
    if historical_df is None or historical_df.empty:
        console.print("[red]❌ No 15-minute data available[/red]")
        return
    
    historical_df = historical_df.sort_index(ascending=True)
    
    # Get last 3 trading days
    unique_dates = sorted(set([idx.date() for idx in historical_df.index if idx.weekday() < 5]))
    if len(unique_dates) > 3:
        target_dates = unique_dates[-3:]
    else:
        target_dates = unique_dates
    
    # Filter for target dates
    recent_df = historical_df[[idx.date() in target_dates for idx in historical_df.index]]
    
    console.print(f"[green]✅ 15-minute data loaded: {len(recent_df)} candles[/green]")
    console.print(f"[green]✅ Trading days: {', '.join([d.strftime('%Y-%m-%d') for d in target_dates])}[/green]\n")
    
    # 15-minute specific breakout detection
    signals = []
    
    # Shorter windows for 15-min timeframe (intraday sensitivity)
    for window in [4, 6, 8, 12]:  # 1hr, 1.5hr, 2hr, 3hr equivalents
        df = recent_df.copy()
        
        # Calculate levels
        df[f'resistance_{window}'] = df['high'].rolling(window=window, min_periods=3).max()
        df[f'support_{window}'] = df['low'].rolling(window=window, min_periods=3).min()
        df[f'range_{window}'] = df[f'resistance_{window}'] - df[f'support_{window}']
        df[f'vol_sma_{window}'] = df['volume'].rolling(window=window).mean()
        
        for i in range(window, len(df)):
            current_close = df['close'].iloc[i]
            current_high = df['high'].iloc[i]
            current_low = df['low'].iloc[i]
            current_volume = df['volume'].iloc[i]
            
            resistance = df[f'resistance_{window}'].iloc[i-1]
            support = df[f'support_{window}'].iloc[i-1]
            range_size = df[f'range_{window}'].iloc[i-1]
            
            # Range check for consolidation (15-min specific)
            range_pct = (range_size / current_close) * 100
            
            # 15-min timeframe specific thresholds
            if range_pct < 0.8:  # Tighter range for 15-min (0.8% vs 1.5% for daily)
                avg_vol = df[f'vol_sma_{window}'].iloc[i]
                vol_ratio = current_volume / avg_vol if avg_vol > 0 else 1
                
                if vol_ratio > 1.3:  # Higher volume threshold for 15-min
                    # Bullish breakout
                    if current_high > resistance:
                        strength = (current_high - resistance) / resistance * 100
                        
                        signals.append({
                            'timestamp': df.index[i],
                            'type': 'BULLISH',
                            'breakout_level': resistance,
                            'breakout_price': current_high,
                            'close_price': current_close,
                            'strength_pct': strength,
                            'window': window,
                            'volume_ratio': vol_ratio,
                            'support_level': support,
                            'timeframe': '15min',
                            'window_hours': window * 0.25  # Convert to hours
                        })
                    
                    # Bearish breakout
                    elif current_low < support:
                        strength = (support - current_low) / support * 100
                        
                        signals.append({
                            'timestamp': df.index[i],
                            'type': 'BEARISH',
                            'breakout_level': support,
                            'breakout_price': current_low,
                            'close_price': current_close,
                            'strength_pct': strength,
                            'window': window,
                            'volume_ratio': vol_ratio,
                            'support_level': support,
                            'timeframe': '15min',
                            'window_hours': window * 0.25
                        })
    
    # Remove duplicates (within 30 minutes for 15-min timeframe)
    unique_signals = []
    for signal in sorted(signals, key=lambda x: x['timestamp'], reverse=True):
        is_duplicate = False
        for existing in unique_signals:
            time_diff = abs((signal['timestamp'] - existing['timestamp']).total_seconds() / 60)
            if time_diff <= 30:  # 30 minutes for 15-min timeframe
                if (signal['type'] == existing['type'] and 
                    abs(signal['breakout_level'] - existing['breakout_level']) < 1.0):  # Within ₹1
                    is_duplicate = True
                    break
        
        if not is_duplicate:
            unique_signals.append(signal)
    
    # Display 15-minute timeframe results
    if unique_signals:
        console.print("[bold green]📈 15-MINUTE TIMEFRAME BREAKOUT LEVELS:[/bold green]\n")
        
        results_table = Table(
            title=f"15-MINUTE BREAKOUTS - {ticker}",
            box=box.ROUNDED,
            show_header=True,
            header_style="bold blue"
        )
        
        results_table.add_column("Date", style="cyan", width=10)
        results_table.add_column("Time", style="cyan", width=8)
        results_table.add_column("Type", style="bold", width=8)
        results_table.add_column("Level (₹)", justify="right", style="yellow", width=10)
        results_table.add_column("Breakout (₹)", justify="right", style="green", width=10)
        results_table.add_column("Close (₹)", justify="right", style="white", width=10)
        results_table.add_column("Strength %", justify="right", style="magenta", width=8)
        results_table.add_column("Window", justify="right", style="blue", width=8)
        results_table.add_column("Volume", justify="right", style="yellow", width=6)
        
        for signal in unique_signals[:15]:  # Show top 15 signals
            date_str = signal['timestamp'].strftime('%m-%d')
            time_str = signal['timestamp'].strftime('%H:%M')
            type_color = "green" if signal['type'] == 'BULLISH' else "red"
            
            results_table.add_row(
                date_str,
                time_str,
                f"[{type_color}]{signal['type']}[/{type_color}]",
                f"₹{signal['breakout_level']:.2f}",
                f"₹{signal['breakout_price']:.2f}",
                f"₹{signal['close_price']:.2f}",
                f"{signal['strength_pct']:+.2f}%",
                f"{signal['window_hours']:.1f}h",
                f"{signal['volume_ratio']:.1f}x"
            )
        
        console.print(results_table)
        
        # 15-minute timeframe summary
        bullish_count = len([s for s in unique_signals if s['type'] == 'BULLISH'])
        bearish_count = len([s for s in unique_signals if s['type'] == 'BEARISH'])
        
        console.print(f"\n[dim]📊 15-MINUTE SUMMARY:[/dim]")
        console.print(f"[dim]   Total Signals: {len(unique_signals)}[/dim]")
        console.print(f"[dim]   Bullish: {bullish_count} | Bearish: {bearish_count}[/dim]")
        
        # Current 15-minute status
        current_price = recent_df['close'].iloc[-1]
        current_time = recent_df.index[-1]
        
        console.print(f"\n[dim]💡 CURRENT 15-MIN STATUS (as of {current_time.strftime('%m-%d %H:%M')}):[/dim]")
        console.print(f"[dim]   Current Price: ₹{current_price:.2f}[/dim]")
        
        # Key 15-minute levels
        if unique_signals:
            # Resistance levels above current price
            resistances = [s['breakout_level'] for s in unique_signals if s['type'] == 'BULLISH']
            above_resistances = [r for r in resistances if r > current_price]
            if above_resistances:
                nearest_resistance = min(above_resistances)
                console.print(f"[dim]   15-min Resistance: ₹{nearest_resistance:.2f}[/dim]")
            
            # Support levels below current price  
            supports = [s['breakout_level'] for s in unique_signals if s['type'] == 'BEARISH']
            below_supports = [s for s in supports if s < current_price]
            if below_supports:
                nearest_support = max(below_supports)
                console.print(f"[dim]   15-min Support: ₹{nearest_support:.2f}[/dim]")
        
        # Recent 15-minute range
        recent_high = recent_df['high'].tail(16).max()  # Last 4 hours (16 candles)
        recent_low = recent_df['low'].tail(16).min()
        console.print(f"[dim]   4-hour Range: ₹{recent_low:.2f} - ₹{recent_high:.2f}[/dim]")
        
    else:
        console.print("[yellow]📊 No 15-minute breakouts detected in recent data[/yellow]")
        
        current_price = recent_df['close'].iloc[-1]
        recent_high = recent_df['high'].max()
        recent_low = recent_df['low'].min()
        
        console.print(f"\n[dim]💡 CURRENT 15-MIN LEVELS:[/dim]")
        console.print(f"[dim]   Current Price: ₹{current_price:.2f}[/dim]")
        console.print(f"[dim]   Period High: ₹{recent_high:.2f}[/dim]")
        console.print(f"[dim]   Period Low: ₹{recent_low:.2f}[/dim]")
    
    # 15-minute timeframe characteristics
    console.print(f"\n[dim]⚙️ 15-MINUTE TIMEFRAME CHARACTERISTICS:[/dim]")
    console.print(f"[dim]   • Each candle = 15 minutes of trading[/dim]")
    console.print(f"[dim]   • 4 candles = 1 hour[/dim]")
    console.print(f"[dim]   • 16 candles = 4 hours (half trading session)[/dim]")
    console.print(f"[dim]   • 32 candles = full trading session (9:15-15:30)[/dim]")
    console.print(f"[dim]   • Tighter ranges required (0.8% vs 1.5% daily)[/dim]")
    console.print(f"[dim]   • Higher volume confirmation needed (1.3x vs 1.2x daily)[/dim]")
    
    console.print(f"\n[bold green]✅ 15-MINUTE ANALYSIS COMPLETE![/bold green]")

if __name__ == "__main__":
    analyze_15min_breakouts()
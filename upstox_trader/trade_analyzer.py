#!/usr/bin/env python3
"""
Trade Analyzer - Examine individual trades to understand what went wrong
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np
from datetime import datetime
from strategies.simple_real_strategy import SimpleTwoCandleStrategy
from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from rich.console import Console
from rich.table import Table

console = Console()


def analyze_trades_in_detail(symbol: str, days: int = 15):
    """Analyze trades in detail to see exactly what happened"""
    
    # Initialize API
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    # Fetch data
    console.print(f"📊 Fetching {days} days of 15min data for {symbol}...")
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - pd.Timedelta(days=days)).strftime('%Y-%m-%d')
    
    df = api.fetch_historical_data_v3(
        symbol=symbol,
        unit='minutes',
        interval=15,
        from_date=from_date,
        to_date=to_date
    )
    
    if df is None or len(df) == 0:
        console.print(f"❌ No data for {symbol}")
        return
    
    console.print(f"✅ Fetched {len(df)} records from {df.index[0]} to {df.index[-1]}")
    
    # Initialize strategy
    strategy = SimpleTwoCandleStrategy()
    
    # Calculate indicators
    indicators = strategy.calculate_indicators(df)
    
    # Get signals
    buy_signals, sell_signals = strategy.generate_signals(indicators)
    
    # Analyze day by day
    console.print(f"\n🔍 **DETAILED TRADE ANALYSIS FOR {symbol}**")
    console.print("=" * 80)
    
    # Group by date
    daily_groups = df.groupby(df.index.date)
    
    for date, group in daily_groups:
        if len(group) >= 2:
            analyze_single_day(date, group, indicators, buy_signals, sell_signals)


def analyze_single_day(date, group, indicators, buy_signals, sell_signals):
    """Analyze a single trading day in detail"""
    
    # Get first and second candles
    first_candle = group.iloc[0]
    second_candle = group.iloc[1]
    
    # Get the relevant indicators for this day
    day_data = group.copy()
    
    first_close = first_candle['close']
    second_close = second_candle['close']
    
    # Determine expected direction
    if second_close > first_close:
        expected_direction = "LONG"
        direction_strength = ((second_close - first_close) / first_close) * 100
    else:
        expected_direction = "SHORT" 
        direction_strength = ((first_close - second_close) / first_close) * 100
    
    # Check if we had a buy signal on second candle
    second_idx = group.index[1]
    had_buy_signal = buy_signals.loc[second_idx] if second_idx in buy_signals.index else False
    
    # Check if we had trades during the day
    day_buy_signals = buy_signals.loc[group.index]
    day_sell_signals = sell_signals.loc[group.index]
    
    trade_entries = day_buy_signals[day_buy_signals == True]
    trade_exits = day_sell_signals[day_sell_signals == True]
    
    # Calculate day's price movement
    day_high = group['high'].max()
    day_low = group['low'].min()
    day_open = group['open'].iloc[0]
    day_close = group['close'].iloc[-1]
    
    daily_return = ((day_close - day_open) / day_open) * 100
    
    # Display analysis
    console.print(f"\n📅 **{date}** - {expected_direction} Day")
    console.print(f"   First Candle (9:15):  ₹{first_close:.2f}")
    console.print(f"   Second Candle (9:30): ₹{second_close:.2f}")
    console.print(f"   Direction Signal: {expected_direction} ({direction_strength:.2f}% strength)")
    console.print(f"   Strategy Signal: {'✅ BUY' if had_buy_signal else '❌ NO SIGNAL'}")
    
    # Show what happened during the day
    console.print(f"   Day Performance:")
    console.print(f"     • Open: ₹{day_open:.2f} → Close: ₹{day_close:.2f}")
    console.print(f"     • High: ₹{day_high:.2f}, Low: ₹{day_low:.2f}")
    console.print(f"     • Daily Return: {daily_return:.2f}%")
    
    # Analyze trades
    if len(trade_entries) > 0:
        console.print(f"   📈 **TRADE EXECUTED**")
        entry_time = trade_entries.index[0]
        entry_price = group.loc[entry_time, 'close']
        
        # Find exit
        exits_after_entry = trade_exits[trade_exits.index > entry_time]
        if len(exits_after_entry) > 0:
            exit_time = exits_after_entry.index[0]
            exit_price = group.loc[exit_time, 'close']
            trade_return = ((exit_price - entry_price) / entry_price) * 100
            
            console.print(f"     • Entry: {entry_time.time()} at ₹{entry_price:.2f}")
            console.print(f"     • Exit:  {exit_time.time()} at ₹{exit_price:.2f}")
            console.print(f"     • Trade Return: {trade_return:.2f}%")
            
            # Analyze what went wrong
            if trade_return < 0:
                console.print(f"     ❌ **LOSS ANALYSIS:**")
                
                # Check if we hit stop loss or profit target
                profit_target = entry_price * 1.015  # 1.5% target
                stop_loss = entry_price * 0.99       # 1.0% stop
                
                if exit_price <= stop_loss:
                    console.print(f"        Reason: Hit STOP LOSS (₹{stop_loss:.2f})")
                elif exit_price >= profit_target:
                    console.print(f"        Reason: Hit PROFIT TARGET (₹{profit_target:.2f})")
                else:
                    console.print(f"        Reason: End of session exit")
                
                # Check how far price moved against us
                worst_price = group.loc[entry_time:, 'low'].min()
                max_drawdown = ((worst_price - entry_price) / entry_price) * 100
                console.print(f"        Max Drawdown: {max_drawdown:.2f}%")
                
                # Check if direction prediction was wrong
                actual_direction = "UP" if daily_return > 0 else "DOWN"
                predicted_direction = "UP" if expected_direction == "LONG" else "DOWN"
                
                if actual_direction != predicted_direction:
                    console.print(f"        ⚠️  WRONG DIRECTION: Predicted {predicted_direction}, Actual {actual_direction}")
                else:
                    console.print(f"        ⚠️  RIGHT DIRECTION, POOR TIMING: Predicted {predicted_direction}, Actual {actual_direction}")
            
        else:
            console.print(f"     • Entry: {entry_time.time()} at ₹{entry_price:.2f}")
            console.print(f"     • No exit found (likely end-of-session)")
    
    else:
        console.print(f"   ⏸️  **NO TRADE** - Strategy conditions not met")
        
        # Analyze why no trade
        if expected_direction == "LONG" and not had_buy_signal:
            console.print(f"     • Expected LONG but strategy didn't trigger")
            console.print(f"     • Possible reasons: insufficient momentum, volume, or trend conditions")
    
    console.print("-" * 60)


def main():
    """Main analysis function"""
    console.print("🔍 **TRADE ANALYSIS - What Went Wrong?**")
    console.print("Analyzing each trade to understand losses\n")
    
    # Analyze RELIANCE trades
    analyze_trades_in_detail("RELIANCE", days=15)
    
    console.print("\n" + "=" * 80)
    console.print("📋 **SUMMARY OF ISSUES**")
    console.print("This analysis shows exactly where our strategy failed and why.")


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Test script to analyze FOMO mode buy signal timing with historical data
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
import yfinance as yf
import sys
import os

# Add the parent directory to sys.path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def simulate_fomo_signals(symbol, start_date, end_date):
    """
    Simulate FOMO mode signals on historical data to identify timing issues
    """
    print(f"\n🔍 Analyzing FOMO signals for {symbol} from {start_date} to {end_date}")
    
    try:
        # Download historical data
        ticker = yf.Ticker(f"{symbol}.NS")  # NSE format
        data = ticker.history(start=start_date, end=end_date, interval="1d")
        
        if data.empty:
            print(f"❌ No data found for {symbol}")
            return None
            
        print(f"✅ Downloaded {len(data)} days of data")
        
        # Calculate technical indicators
        data['volume_sma_10'] = data['Volume'].rolling(10).mean()
        data['volume_ratio'] = data['Volume'] / data['volume_sma_10']
        data['change_pct'] = ((data['Close'] - data['Open']) / data['Open']) * 100
        data['rsi'] = calculate_rsi(data['Close'])
        
        # Calculate 52-week high
        data['52w_high'] = data['High'].rolling(252, min_periods=1).max()
        data['distance_from_high'] = ((data['52w_high'] - data['Close']) / data['Close']) * 100
        
        # FOMO signal conditions
        signals = []
        
        for i in range(10, len(data)):  # Start after 10 days for moving averages
            row = data.iloc[i]
            
            # FOMO criteria from the code
            volume_threshold = 2.0
            if (row['volume_ratio'] > volume_threshold and 
                0.5 <= row['change_pct'] <= 4 and
                row['rsi'] <= 85):
                
                # Check if overextended (likely to be at top)
                is_overextended = (
                    row['distance_from_high'] < 3.0 or  # Very close to 52w high
                    row['rsi'] > 75 or                  # Overbought RSI
                    row['change_pct'] > 3               # Strong daily move
                )
                
                signal = {
                    'date': row.name,
                    'price': row['Close'],
                    'volume_ratio': row['volume_ratio'],
                    'change_pct': row['change_pct'],
                    'rsi': row['rsi'],
                    'distance_from_high': row['distance_from_high'],
                    'is_overextended': is_overextended,
                    'signal_type': 'BUY' if not is_overextended else 'SHOULD_AVOID'
                }
                signals.append(signal)
        
        # Analyze signal quality
        analyze_signal_timing(data, signals, symbol)
        
        return signals
        
    except Exception as e:
        print(f"❌ Error analyzing {symbol}: {e}")
        return None

def calculate_rsi(prices, period=14):
    """Calculate RSI"""
    delta = prices.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def analyze_signal_timing(data, signals, symbol):
    """
    Analyze if signals are triggering at market tops
    """
    if not signals:
        print(f"❌ No FOMO signals found for {symbol}")
        return
    
    print(f"\n📊 Analysis Results for {symbol}:")
    print(f"Total FOMO signals: {len(signals)}")
    
    buy_signals = [s for s in signals if s['signal_type'] == 'BUY']
    avoided_signals = [s for s in signals if s['signal_type'] == 'SHOULD_AVOID']
    
    print(f"BUY signals: {len(buy_signals)}")
    print(f"Avoided signals (overextended): {len(avoided_signals)}")
    
    if buy_signals:
        print(f"\n🎯 BUY Signal Analysis:")
        total_profit = 0
        profitable_trades = 0
        
        for signal in buy_signals:
            # Check performance 1, 3, and 5 days later
            signal_date = signal['date']
            entry_price = signal['price']
            
            # Find future prices
            future_data = data[data.index > signal_date].head(5)
            if len(future_data) >= 1:
                day1_price = future_data.iloc[0]['Close']
                day1_return = ((day1_price - entry_price) / entry_price) * 100
                
                if len(future_data) >= 3:
                    day3_price = future_data.iloc[2]['Close']
                    day3_return = ((day3_price - entry_price) / entry_price) * 100
                else:
                    day3_return = day1_return
                
                if day3_return > 0:
                    profitable_trades += 1
                
                total_profit += day3_return
                
                status = "✅" if day3_return > 0 else "❌"
                print(f"  {signal_date.strftime('%Y-%m-%d')}: Entry ₹{entry_price:.2f}, "
                      f"RSI {signal['rsi']:.1f}, VR {signal['volume_ratio']:.1f}, "
                      f"3d return: {day3_return:+.1f}% {status}")
        
        avg_return = total_profit / len(buy_signals)
        win_rate = (profitable_trades / len(buy_signals)) * 100
        
        print(f"\n📈 Performance Summary:")
        print(f"Average 3-day return: {avg_return:+.2f}%")
        print(f"Win rate: {win_rate:.1f}%")
        
        # Identify problematic patterns
        if avg_return < 0:
            print(f"⚠️  ISSUE: Average return is negative - signals triggering at tops!")
            
        if win_rate < 50:
            print(f"⚠️  ISSUE: Win rate below 50% - poor signal quality!")
    
    print(f"\n🔴 Avoided Signals (would have been losses):")
    for signal in avoided_signals[:5]:  # Show first 5
        print(f"  {signal['date'].strftime('%Y-%m-%d')}: ₹{signal['price']:.2f}, "
              f"RSI {signal['rsi']:.1f}, Distance from high: {signal['distance_from_high']:.1f}%")

def main():
    """Test FOMO timing with real historical data"""
    
    # Test with a few popular stocks
    test_symbols = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK']
    
    # Test recent data (last 3 months)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=90)
    
    print("🚀 Testing FOMO Mode Timing Issues")
    print(f"Period: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    
    all_results = {}
    
    for symbol in test_symbols:
        results = simulate_fomo_signals(symbol, start_date, end_date)
        if results:
            all_results[symbol] = results
        print("-" * 80)
    
    # Overall summary
    if all_results:
        print(f"\n🎯 OVERALL SUMMARY:")
        total_signals = sum(len(signals) for signals in all_results.values())
        print(f"Total signals across all stocks: {total_signals}")
        
        if total_signals > 0:
            print(f"\n💡 RECOMMENDATIONS:")
            print(f"1. Entry timing is crucial - avoid buying at RSI > 75")
            print(f"2. Avoid stocks within 3% of 52-week high")
            print(f"3. Consider momentum cooling before entry")
            print(f"4. Use trailing stops aggressively given quick reversals")

if __name__ == "__main__":
    main()
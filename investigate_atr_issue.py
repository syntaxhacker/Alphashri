#!/usr/bin/env python3
"""
Investigate why Historical ATR is 0.000 for EIEL
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

import numpy as np
from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner, VolatilityAnalyzer
from datetime import datetime

def investigate_atr_issue():
    """Deep dive into ATR calculation issue"""
    print("🔍 Investigating ATR calculation issue for EIEL...")
    
    scanner = VolatilityTrendScanner()
    
    print("🔑 Authenticating...")
    if not scanner.authenticate():
        print("❌ Authentication failed")
        return
    
    print("📊 Fetching EIEL data...")
    candles = scanner.get_market_data('EIEL', '15min')
    
    if not candles or len(candles) < 50:
        print("❌ Insufficient data")
        return
    
    print(f"✅ Got {len(candles)} candles")
    
    # Extract OHLC data
    highs = [c['high'] for c in candles]
    lows = [c['low'] for c in candles]
    closes = [c['close'] for c in candles]
    
    print(f"\n📊 Data Analysis:")
    print(f"   Total candles: {len(candles)}")
    print(f"   Date range: {datetime.fromtimestamp(candles[0]['timestamp']/1000).strftime('%Y-%m-%d %H:%M')} to {datetime.fromtimestamp(candles[-1]['timestamp']/1000).strftime('%Y-%m-%d %H:%M')}")
    
    # Test ATR calculation step by step
    print(f"\n🔍 ATR Calculation Debug:")
    
    # Current ATR (last 15 periods)
    print(f"\n1. Current ATR (last 15 periods):")
    current_highs = highs[-15:]
    current_lows = lows[-15:]
    current_closes = closes[-15:]
    
    print(f"   Data points: {len(current_highs)}")
    if len(current_highs) >= 2:
        print(f"   Sample data:")
        for i in range(min(5, len(current_highs))):
            idx = -(len(current_highs)) + i
            print(f"     [{idx:2d}] H:{current_highs[i]:7.2f} L:{current_lows[i]:7.2f} C:{current_closes[i]:7.2f}")
    
    current_atr = VolatilityAnalyzer.calculate_atr(current_highs, current_lows, current_closes)
    print(f"   Current ATR: {current_atr:.6f}")
    
    # Historical ATR (periods -29 to -15)
    print(f"\n2. Historical ATR (periods -29 to -15):")
    if len(candles) >= 29:
        historical_highs = highs[-29:-15]
        historical_lows = lows[-29:-15]
        historical_closes = closes[-29:-15]
        
        print(f"   Data points: {len(historical_highs)}")
        print(f"   Index range: -{len(highs)} to -{len(highs)-len(historical_highs)}")
        
        if len(historical_highs) >= 2:
            print(f"   Sample data:")
            for i in range(min(5, len(historical_highs))):
                idx = -29 + i
                print(f"     [{idx:2d}] H:{historical_highs[i]:7.2f} L:{historical_lows[i]:7.2f} C:{historical_closes[i]:7.2f}")
        
        historical_atr = VolatilityAnalyzer.calculate_atr(historical_highs, historical_lows, historical_closes)
        print(f"   Historical ATR: {historical_atr:.6f}")
        
        # Manual ATR calculation to debug
        print(f"\n3. Manual ATR Calculation (Historical):")
        if len(historical_highs) > 1:
            true_ranges = []
            for i in range(1, len(historical_highs)):
                tr1 = historical_highs[i] - historical_lows[i]
                tr2 = abs(historical_highs[i] - historical_closes[i-1])
                tr3 = abs(historical_lows[i] - historical_closes[i-1])
                tr = max(tr1, tr2, tr3)
                true_ranges.append(tr)
                if i <= 5:  # Show first 5 calculations
                    print(f"     TR[{i}]: max({tr1:.3f}, {tr2:.3f}, {tr3:.3f}) = {tr:.3f}")
            
            manual_atr = np.mean(true_ranges[-14:]) if len(true_ranges) >= 14 else np.mean(true_ranges)
            print(f"   Manual ATR (last 14 TRs): {manual_atr:.6f}")
            print(f"   Total True Ranges calculated: {len(true_ranges)}")
            print(f"   True Range values: {[f'{tr:.3f}' for tr in true_ranges[:10]]}")
        else:
            print("   ❌ Insufficient data for manual calculation")
    else:
        print("   ❌ Not enough total candles for historical period")
    
    # Test with different periods to see where the issue is
    print(f"\n4. ATR Testing with Different Periods:")
    test_periods = [5, 10, 14, 20, 25]
    for period in test_periods:
        if len(candles) >= period + 5:
            test_highs = highs[-(period+5):-5]
            test_lows = lows[-(period+5):-5]
            test_closes = closes[-(period+5):-5]
            test_atr = VolatilityAnalyzer.calculate_atr(test_highs, test_lows, test_closes, period)
            print(f"   ATR (period {period:2d}, data points {len(test_highs):2d}): {test_atr:.6f}")
    
    # Check if data has any variation
    print(f"\n5. Data Quality Check:")
    recent_highs = highs[-30:]
    recent_lows = lows[-30:]
    recent_closes = closes[-30:]
    
    high_range = max(recent_highs) - min(recent_highs)
    low_range = max(recent_lows) - min(recent_lows)
    close_range = max(recent_closes) - min(recent_closes)
    
    print(f"   High range (last 30): {high_range:.3f} ({min(recent_highs):.2f} - {max(recent_highs):.2f})")
    print(f"   Low range (last 30): {low_range:.3f} ({min(recent_lows):.2f} - {max(recent_lows):.2f})")
    print(f"   Close range (last 30): {close_range:.3f} ({min(recent_closes):.2f} - {max(recent_closes):.2f})")
    
    # Check for constant values (which would cause ATR=0)
    unique_highs = len(set(recent_highs))
    unique_lows = len(set(recent_lows))
    unique_closes = len(set(recent_closes))
    
    print(f"   Unique highs: {unique_highs}/{len(recent_highs)}")
    print(f"   Unique lows: {unique_lows}/{len(recent_lows)}")
    print(f"   Unique closes: {unique_closes}/{len(recent_closes)}")
    
    # Compare with a working stock
    print(f"\n6. Comparison with TATAMOTORS:")
    tata_candles = scanner.get_market_data('TATAMOTORS', '15min')
    if tata_candles and len(tata_candles) >= 29:
        tata_highs = [c['high'] for c in tata_candles]
        tata_lows = [c['low'] for c in tata_candles]
        tata_closes = [c['close'] for c in tata_candles]
        
        tata_current_atr = VolatilityAnalyzer.calculate_atr(tata_highs[-15:], tata_lows[-15:], tata_closes[-15:])
        tata_historical_atr = VolatilityAnalyzer.calculate_atr(tata_highs[-29:-15], tata_lows[-29:-15], tata_closes[-29:-15])
        
        print(f"   TATAMOTORS Current ATR: {tata_current_atr:.6f}")
        print(f"   TATAMOTORS Historical ATR: {tata_historical_atr:.6f}")
        print(f"   TATAMOTORS ATR Ratio: {tata_current_atr/tata_historical_atr if tata_historical_atr > 0 else 'N/A':.3f}")

if __name__ == "__main__":
    investigate_atr_issue()
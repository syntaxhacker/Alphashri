#!/usr/bin/env python3
"""
Debug the exact ATR calculation bug
"""

import numpy as np

def debug_atr_calculation():
    """Debug the ATR calculation step by step"""
    print("🐛 Debugging ATR calculation bug...")
    
    # Simulate the historical data (14 data points from EIEL)
    highs = [246.36, 246.50, 246.00, 246.00, 252.25, 258.94, 254.94, 254.94, 262.94, 259.24, 263.94, 258.94, 259.94, 253.94]
    lows = [245.36, 245.63, 245.00, 244.15, 247.19, 252.25, 250.25, 250.25, 254.94, 255.25, 259.24, 255.25, 255.25, 249.25]
    closes = [246.07, 246.13, 245.09, 244.55, 247.70, 258.70, 254.70, 254.70, 262.70, 259.00, 263.70, 258.70, 259.70, 253.70]
    
    period = 14
    
    print(f"📊 Input data:")
    print(f"   Highs: {len(highs)} values")
    print(f"   Lows: {len(lows)} values") 
    print(f"   Closes: {len(closes)} values")
    print(f"   Period: {period}")
    
    # Current ATR function logic
    print(f"\n🔍 Current ATR Function Logic:")
    print(f"1. Check: len(highs) < period + 1")
    print(f"   len(highs)={len(highs)} < period+1={period+1} = {len(highs) < period + 1}")
    
    if len(highs) < period + 1:
        print(f"   ❌ EARLY RETURN 0.0 - This is the bug!")
        print(f"   Function returns 0.0 because {len(highs)} < {period + 1}")
        return
    
    print(f"   ✅ Condition passed, continuing...")
    
    # Calculate true ranges
    true_ranges = []
    print(f"\n2. Calculate True Ranges:")
    for i in range(1, len(highs)):
        tr1 = highs[i] - lows[i]
        tr2 = abs(highs[i] - closes[i-1])
        tr3 = abs(lows[i] - closes[i-1])
        tr = max(tr1, tr2, tr3)
        true_ranges.append(tr)
        if i <= 5:
            print(f"   TR[{i}]: max({tr1:.3f}, {tr2:.3f}, {tr3:.3f}) = {tr:.3f}")
    
    print(f"   Total True Ranges: {len(true_ranges)}")
    
    # ATR calculation
    print(f"\n3. ATR Calculation:")
    print(f"   len(true_ranges)={len(true_ranges)} >= period={period} = {len(true_ranges) >= period}")
    
    if len(true_ranges) >= period:
        atr = np.mean(true_ranges[-period:])
        print(f"   ✅ ATR = mean(last {period} TRs) = {atr:.6f}")
    else:
        print(f"   ❌ Would return 0.0 because not enough TRs")
    
    print(f"\n💡 The Bug Analysis:")
    print(f"   The condition 'len(highs) < period + 1' is too strict!")
    print(f"   For period=14, it requires 15+ data points")
    print(f"   But we're passing exactly 14 data points (historical period -29 to -15)")
    print(f"   This causes immediate return of 0.0")
    
    print(f"\n🔧 Correct Logic Should Be:")
    print(f"   For ATR calculation, we need at least 'period' data points")
    print(f"   The condition should be: 'len(highs) < period + 1' only if we need the previous close")
    print(f"   OR: 'len(highs) < 2' (minimum for any TR calculation)")
    
    # Test corrected calculation
    print(f"\n✅ Corrected Calculation:")
    if len(highs) >= 2:  # Only need 2 points minimum
        corrected_true_ranges = []
        for i in range(1, len(highs)):
            tr1 = highs[i] - lows[i]
            tr2 = abs(highs[i] - closes[i-1])
            tr3 = abs(lows[i] - closes[i-1])
            corrected_true_ranges.append(max(tr1, tr2, tr3))
        
        # Take last 'period' TRs or all if less than period
        atr_values = corrected_true_ranges[-period:] if len(corrected_true_ranges) >= period else corrected_true_ranges
        corrected_atr = np.mean(atr_values)
        print(f"   Corrected ATR: {corrected_atr:.6f}")
        print(f"   Used {len(atr_values)} TR values for calculation")

if __name__ == "__main__":
    debug_atr_calculation()
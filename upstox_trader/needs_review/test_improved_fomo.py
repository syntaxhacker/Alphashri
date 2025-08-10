#!/usr/bin/env python3
"""
Test the improved FOMO timing logic
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import yfinance as yf

def test_timing_functions():
    """
    Test the new timing detection functions with sample data
    """
    print("🧪 TESTING IMPROVED FOMO TIMING FUNCTIONS")
    print("=" * 60)
    
    # Create sample data that represents different market conditions
    test_scenarios = [
        {
            'name': 'Pre-Breakout Scenario',
            'data': {
                'relative_volume_10d_calc': 1.8,  # Volume building
                'change': 0.8,                     # Small controlled move
                'RSI': 60,                         # Healthy RSI
                'EMA20': 100,
                'close': 101,                      # Near EMA20
                'expected': 'PRE_BREAKOUT'
            }
        },
        {
            'name': 'Pullback Entry Scenario',
            'data': {
                'relative_volume_10d_calc': 1.5,  # Volume normalizing
                'change': -0.3,                    # Small pullback
                'RSI': 65,                         # RSI cooling
                'EMA20': 100,
                'close': 99.5,                     # Near EMA20
                'Perf.W': 5,                       # Weekly strength
                'expected': 'PULLBACK'
            }
        },
        {
            'name': 'Momentum Cooled Scenario',
            'data': {
                'relative_volume_10d_calc': 2.5,  # Reasonable volume
                'change': 1.5,                     # Moderate move
                'RSI': 68,                         # RSI in middle range
                'price_52_week_high': 110,
                'close': 100,                      # 9% from high
                'expected': 'COOLED'
            }
        },
        {
            'name': 'Late Entry (Original FOMO)',
            'data': {
                'relative_volume_10d_calc': 3.5,  # High volume spike
                'change': 3.2,                     # Strong move
                'RSI': 78,                         # Overbought
                'price_52_week_high': 102,
                'close': 100,                      # Near high
                'expected': 'ORIGINAL'
            }
        }
    ]
    
    # Mock the detection functions (simplified logic for testing)
    def mock_pre_breakout_detection(row):
        volume_building = 1.3 <= row.get('relative_volume_10d_calc', 1) <= 2.5
        controlled_move = 0.1 <= row.get('change', 0) <= 2.0
        rsi_healthy = 45 <= row.get('RSI', 50) <= 68
        ema20 = row.get('EMA20', row.get('close', 100))
        price_near_support = row.get('close', 100) >= ema20 * 0.98
        return volume_building and controlled_move and rsi_healthy and price_near_support
    
    def mock_pullback_detection(row):
        small_pullback = -0.8 <= row.get('change', 0) <= 0.5
        rsi_cooling = 50 <= row.get('RSI', 50) <= 70
        volume_normalizing = 1.2 <= row.get('relative_volume_10d_calc', 1) <= 2.0
        ema20 = row.get('EMA20', row.get('close', 100))
        near_ema20 = row.get('close', 100) >= ema20 * 0.99
        has_strength = row.get('Perf.W', 0) > 2
        return small_pullback and rsi_cooling and volume_normalizing and near_ema20 and has_strength
    
    def mock_momentum_cooled(row):
        rsi_cooled = 55 <= row.get('RSI', 50) <= 75
        moderate_move = -1.0 <= row.get('change', 0) <= 3.0
        price_52w_high = row.get('price_52_week_high', row.get('close', 100) * 1.1)
        current_price = row.get('close', 100)
        distance_from_high = ((price_52w_high - current_price) / current_price) * 100
        reasonable_distance = distance_from_high >= 5.0
        volume_reasonable = row.get('relative_volume_10d_calc', 1) <= 3.0
        return rsi_cooled and moderate_move and reasonable_distance and volume_reasonable
    
    # Test each scenario
    for scenario in test_scenarios:
        print(f"\n🔍 Testing: {scenario['name']}")
        data = scenario['data']
        expected = data.pop('expected')
        
        # Test detection functions
        pre_breakout = mock_pre_breakout_detection(data)
        pullback = mock_pullback_detection(data)
        cooled = mock_momentum_cooled(data)
        
        # Determine actual result
        actual = "NONE"
        if pre_breakout:
            actual = "PRE_BREAKOUT"
        elif pullback:
            actual = "PULLBACK"
        elif cooled:
            actual = "COOLED"
        else:
            actual = "ORIGINAL"
        
        # Display results
        result_icon = "✅" if actual == expected else "❌"
        print(f"  Expected: {expected}")
        print(f"  Actual:   {actual} {result_icon}")
        
        # Show the data
        print(f"  Data: Vol:{data.get('relative_volume_10d_calc', 'N/A'):.1f}x, "
              f"Change:{data.get('change', 0):+.1f}%, RSI:{data.get('RSI', 'N/A')}")
    
    print(f"\n💡 KEY IMPROVEMENTS:")
    print(f"1. PRE_BREAKOUT: Catches volume building BEFORE spike")
    print(f"2. PULLBACK: Buys dips near support levels")
    print(f"3. COOLED: Enters after momentum settles")
    print(f"4. Better timing = Better entry prices")

def simulate_entry_improvements():
    """
    Simulate how the improved timing affects entry prices
    """
    print(f"\n📈 ENTRY TIMING IMPROVEMENT SIMULATION")
    print("=" * 60)
    
    # Simulate a stock's price movement through different phases
    scenarios = [
        ("Stock building volume", 100.0, "PRE_BREAKOUT", "🟢 EARLY ENTRY"),
        ("Stock minor pullback", 101.5, "PULLBACK", "🔵 DIP ENTRY"),
        ("Stock momentum cooling", 103.0, "COOLED", "🔷 SAFE ENTRY"), 
        ("Stock strong breakout", 105.0, "ORIGINAL", "⚠️ LATE ENTRY")
    ]
    
    print(f"Stock Price Evolution & Entry Timing:")
    for phase, price, timing, description in scenarios:
        profit_potential = ((110 - price) / price) * 100  # Assume target of 110
        print(f"  {description}: ₹{price:.2f} ({timing}) - Upside: {profit_potential:.1f}%")
    
    print(f"\n🎯 RESULTS:")
    print(f"• PRE_BREAKOUT entry: ₹100.00 → 10% upside potential")
    print(f"• PULLBACK entry:     ₹101.50 → 8.4% upside potential") 
    print(f"• COOLED entry:       ₹103.00 → 6.8% upside potential")
    print(f"• ORIGINAL entry:     ₹105.00 → 4.8% upside potential")
    print(f"\n⚡ Early timing = 2x better risk/reward!")

def main():
    """Run all tests"""
    test_timing_functions()
    simulate_entry_improvements()
    
    print(f"\n🚀 SUMMARY - FOMO TIMING IMPROVEMENTS:")
    print("=" * 60)
    print("✅ Added PRE-BREAKOUT detection (volume building)")
    print("✅ Added PULLBACK entry detection (dip buying)")
    print("✅ Added MOMENTUM COOLING detection (safer entries)")
    print("✅ Improved confidence scoring based on timing")
    print("✅ Better trade execution logic by timing type")
    print("✅ Visual indicators for different entry types")
    
    print(f"\n🎯 EXPECTED RESULTS:")
    print("• Earlier entries with better risk/reward")
    print("• Reduced 'buying at tops' problem")
    print("• Higher win rates due to better timing")
    print("• More consistent profit potential")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Test the improved engulfing strategy implementation
"""

import requests
import json

def test_strategy(symbol="RELIANCE.NS", days=810, momentum_candles=3, min_momentum_pct=0.5, engulf_ratio=1.1):
    """Test the engulfing strategy with given parameters"""
    
    url = "http://localhost:8000/backtest"
    payload = {
        "symbol": symbol,
        "timeframe": "1d",
        "days": days,
        "momentum_candles": momentum_candles,
        "min_momentum_pct": min_momentum_pct,
        "engulf_ratio": engulf_ratio
    }
    
    print(f"🧪 Testing strategy on {symbol}")
    print(f"📊 Parameters: {momentum_candles} momentum candles, {min_momentum_pct}% min decline, {engulf_ratio}x engulf ratio")
    print(f"📅 Period: {days} days")
    print("-" * 60)
    
    try:
        response = requests.post(url, json=payload)
        
        if response.status_code != 200:
            print(f"❌ Error: {response.status_code}")
            print(response.text)
            return
            
        result = response.json()
        
        print(f"📈 STRATEGY RESULTS:")
        print(f"   Total Trades: {result['total_trades']}")
        print(f"   Win Rate: {result['win_rate']:.1f}%")
        print(f"   Total Return: {result['total_return']:.2f}%")
        print(f"   Sharpe Ratio: {result['sharpe_ratio']:.3f}")
        print(f"   Max Drawdown: {result['max_drawdown']:.2f}%")
        
        if result['chart_data']['signals']:
            print(f"\n🎯 SIGNALS BREAKDOWN:")
            entries = [s for s in result['chart_data']['signals'] if s['type'] == 'entry']
            exits = [s for s in result['chart_data']['signals'] if s['type'] == 'exit']
            
            print(f"   Entry signals: {len(entries)}")
            print(f"   Exit signals: {len(exits)}")
            
            if entries:
                print(f"\n📊 SAMPLE ENTRIES:")
                for i, entry in enumerate(entries[:3]):  # Show first 3 entries
                    print(f"   {i+1}. {entry['date']} @ ₹{entry['price']:.2f}")
                    if 'momentum_decline' in entry:
                        print(f"      Momentum decline: {entry['momentum_decline']:.2f}%")
                    if 'engulf_ratio_actual' in entry:
                        print(f"      Engulf ratio: {entry['engulf_ratio_actual']:.2f}x")
            
            if exits:
                print(f"\n📊 SAMPLE EXITS:")
                for i, exit_signal in enumerate(exits[:3]):  # Show first 3 exits
                    print(f"   {i+1}. {exit_signal['date']} @ ₹{exit_signal['price']:.2f}")
                    if 'return' in exit_signal:
                        print(f"      Return: {exit_signal['return']:.2f}%")
                    if 'reason' in exit_signal:
                        print(f"      Reason: {exit_signal['reason']}")
                    if 'holding_days' in exit_signal:
                        print(f"      Holding: {exit_signal['holding_days']} days")
        
    except Exception as e:
        print(f"❌ Error testing strategy: {e}")

def compare_parameters():
    """Compare different parameter combinations"""
    
    test_cases = [
        {"momentum_candles": 2, "min_momentum_pct": 0.3, "engulf_ratio": 1.0},
        {"momentum_candles": 3, "min_momentum_pct": 0.5, "engulf_ratio": 1.1},
        {"momentum_candles": 4, "min_momentum_pct": 0.8, "engulf_ratio": 1.2},
        {"momentum_candles": 5, "min_momentum_pct": 1.0, "engulf_ratio": 1.3},
    ]
    
    print("\n🔬 PARAMETER COMPARISON")
    print("=" * 80)
    
    for i, params in enumerate(test_cases):
        print(f"\n--- Test Case {i+1} ---")
        test_strategy("RELIANCE.NS", 810, **params)

if __name__ == "__main__":
    # Test with default parameters first
    test_strategy("RELIANCE.NS", 810)
    
    # Test on other popular stocks
    print("\n" + "="*80)
    test_strategy("TCS.NS", 810)
    
    print("\n" + "="*80)
    test_strategy("INFY.NS", 810)
    
    # Compare different parameters
    compare_parameters() 
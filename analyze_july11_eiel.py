#!/usr/bin/env python3
"""
Analyze EIEL's July 11th surge specifically
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner, VolatilityAnalyzer
import numpy as np
from datetime import datetime, timedelta

def analyze_july11_surge():
    """Analyze EIEL's July 11th surge in detail"""
    print("📊 Analyzing EIEL's July 11th surge...")
    
    scanner = VolatilityTrendScanner()
    
    print("🔑 Authenticating...")
    if not scanner.authenticate():
        print("❌ Authentication failed")
        return
    
    print("📊 Fetching EIEL data...")
    candles = scanner.get_market_data('EIEL', '15min')
    
    if not candles:
        print("❌ No data received")
        return
    
    print(f"✅ Got {len(candles)} candles")
    
    # Filter for July 11th data
    july11_candles = []
    july10_close = None
    
    for i, candle in enumerate(candles):
        timestamp = datetime.fromtimestamp(candle['timestamp']/1000)
        
        if timestamp.date() == datetime(2025, 7, 10).date():
            july10_close = candle['close']  # Get July 10th closing price
        
        if timestamp.date() == datetime(2025, 7, 11).date():
            july11_candles.append({
                'candle': candle,
                'timestamp': timestamp,
                'index': i
            })
    
    if not july11_candles:
        print("❌ No July 11th data found")
        return
    
    print(f"\n📅 July 11th EIEL trading data:")
    print(f"   July 10th close: ₹{july10_close:.2f}" if july10_close else "   July 10th close: Not available")
    print(f"   July 11th candles: {len(july11_candles)}")
    
    # Show July 11th intraday progression
    print(f"\n📈 July 11th intraday progression:")
    max_surge = 0
    best_candle = None
    
    for entry in july11_candles:
        candle = entry['candle']
        timestamp = entry['timestamp']
        
        # Calculate surge from July 10th close if available
        if july10_close:
            surge_from_prev_close = ((candle['close'] - july10_close) / july10_close) * 100
            if surge_from_prev_close > max_surge:
                max_surge = surge_from_prev_close
                best_candle = entry
        else:
            surge_from_prev_close = 0
        
        print(f"   {timestamp.strftime('%H:%M')} | O:{candle['open']:6.2f} H:{candle['high']:6.2f} L:{candle['low']:6.2f} C:{candle['close']:6.2f} | Vol:{candle['volume']:8,.0f} | Surge:{surge_from_prev_close:+5.1f}%")
    
    print(f"\n🎯 Maximum surge on July 11th: {max_surge:+.1f}%")
    
    if best_candle and max_surge >= 10:
        print(f"🔥 Analyzing the peak surge candle at {best_candle['timestamp'].strftime('%H:%M')}...")
        
        # Get data up to that candle for signal simulation
        candle_idx = best_candle['index']
        sim_candles = candles[:candle_idx+1]
        
        if len(sim_candles) >= 30:
            highs = [c['high'] for c in sim_candles]
            lows = [c['low'] for c in sim_candles]
            closes = [c['close'] for c in sim_candles]
            volumes = [c['volume'] for c in sim_candles]
            
            # Signal detection analysis
            current_volume = volumes[-1]
            avg_volume_20 = np.mean(volumes[-21:-1]) if len(volumes) >= 21 else np.mean(volumes[:-1])
            volume_ratio = current_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
            
            current_atr = VolatilityAnalyzer.calculate_atr(highs[-15:], lows[-15:], closes[-15:])
            historical_atr = VolatilityAnalyzer.calculate_atr(highs[-29:-15], lows[-29:-15], closes[-29:-15])
            atr_ratio = current_atr / historical_atr if historical_atr > 0 else 1.0
            
            daily_range = ((highs[-1] - lows[-1]) / closes[-2]) * 100 if len(closes) > 1 else 0.0
            rsi = VolatilityAnalyzer.calculate_rsi(closes)
            
            print(f"\n📊 Signal Analysis at peak surge ({best_candle['timestamp'].strftime('%H:%M')}):")
            print(f"   Price: ₹{closes[-1]:.2f}")
            print(f"   Surge: {max_surge:+.1f}%")
            print(f"   Volume: {current_volume:,.0f}")
            print(f"   Volume ratio: {volume_ratio:.2f}x (need >{scanner.volume_threshold}x) {'✅' if volume_ratio >= scanner.volume_threshold else '❌'}")
            print(f"   ATR ratio: {atr_ratio:.2f}x (need >{scanner.atr_threshold}x) {'✅' if atr_ratio >= scanner.atr_threshold else '❌'}")
            print(f"   Daily volatility: {daily_range:.2f}% (need >{scanner.price_vol_threshold}%) {'✅' if daily_range >= scanner.price_vol_threshold else '❌'}")
            print(f"   RSI: {rsi:.1f}")
            
            # Test signal criteria
            volatility_breakout = (volume_ratio >= scanner.volume_threshold and 
                                  atr_ratio >= scanner.atr_threshold and 
                                  daily_range >= scanner.price_vol_threshold and
                                  30 <= rsi <= 70)
            
            trend_acceleration = (volume_ratio >= 1.2 and 
                                 atr_ratio >= 1.2 and 
                                 daily_range >= 2.0)
            
            momentum_surge = (volume_ratio >= 2.0 and atr_ratio >= 1.0)
            
            detected = volatility_breakout or trend_acceleration or momentum_surge
            
            print(f"\n🎯 Signal Detection Results:")
            print(f"   Volatility Breakout: {'✅' if volatility_breakout else '❌'}")
            print(f"   Trend Acceleration: {'✅' if trend_acceleration else '❌'}")
            print(f"   Momentum Surge: {'✅' if momentum_surge else '❌'}")
            print(f"   OVERALL: {'🔥 SIGNAL DETECTED' if detected else '❌ NO SIGNAL'}")
            
            if not detected:
                print(f"\n💡 Why the {max_surge:+.1f}% surge wasn't detected:")
                reasons = []
                if volume_ratio < scanner.volume_threshold:
                    reasons.append(f"Volume too low: {volume_ratio:.2f}x < {scanner.volume_threshold}x")
                if atr_ratio < scanner.atr_threshold:
                    reasons.append(f"ATR too low: {atr_ratio:.2f}x < {scanner.atr_threshold}x") 
                if daily_range < scanner.price_vol_threshold:
                    reasons.append(f"Volatility too low: {daily_range:.2f}% < {scanner.price_vol_threshold}%")
                if not (30 <= rsi <= 70):
                    reasons.append(f"RSI out of range: {rsi:.1f} (need 30-70)")
                
                for reason in reasons:
                    print(f"   • {reason}")
                    
                # Suggest threshold adjustments
                print(f"\n🔧 Suggested threshold adjustments to catch this surge:")
                if volume_ratio < scanner.volume_threshold:
                    print(f"   • Lower volume threshold to {volume_ratio*0.9:.1f}x")
                if atr_ratio < scanner.atr_threshold:
                    print(f"   • Lower ATR threshold to {atr_ratio*0.9:.1f}x")
                if daily_range < scanner.price_vol_threshold:
                    print(f"   • Lower volatility threshold to {daily_range*0.9:.1f}%")
    
    else:
        print(f"🤔 Maximum surge of {max_surge:+.1f}% may not qualify as a major surge (< 10%)")
        print(f"   This could explain why it wasn't detected.")
    
    # Also check if scanner was actually running on July 11th
    print(f"\n📋 Checking if scanner was running on July 11th...")
    
    # Check log files for July 11th activity
    try:
        with open('upstox_trader/volatility_trend_scanner.log', 'r') as f:
            log_content = f.read()
            
        july11_logs = []
        for line in log_content.split('\n'):
            if '2025-07-11' in line:
                july11_logs.append(line)
        
        if july11_logs:
            print(f"   ✅ Scanner was active on July 11th ({len(july11_logs)} log entries)")
            print(f"   Last July 11th log: {july11_logs[-1][:100]}..." if july11_logs[-1] else "")
        else:
            print(f"   ❌ No scanner activity found in logs for July 11th")
            print(f"   This could explain why the surge was missed!")
            
    except Exception as e:
        print(f"   ⚠️ Could not check logs: {e}")

if __name__ == "__main__":
    analyze_july11_surge()
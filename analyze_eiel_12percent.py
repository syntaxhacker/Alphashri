#!/usr/bin/env python3
"""
Analyze if EIEL's 12% surge day would have been detected
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner, VolatilityAnalyzer
import numpy as np
from datetime import datetime, timedelta

def analyze_eiel_12_percent():
    """Analyze EIEL data around the 12% surge day"""
    print("📊 Analyzing EIEL's 12% surge day...")
    
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
    
    # Look for the biggest price movements in recent data
    print(f"\n🔍 Finding biggest price movements in EIEL data...")
    
    price_moves = []
    for i in range(1, len(candles)):
        prev_close = candles[i-1]['close']
        current_close = candles[i]['close']
        percent_change = ((current_close - prev_close) / prev_close) * 100
        
        timestamp = datetime.fromtimestamp(candles[i]['timestamp']/1000)
        
        price_moves.append({
            'timestamp': timestamp,
            'percent_change': percent_change,
            'volume': candles[i]['volume'],
            'close': current_close,
            'candle_index': i
        })
    
    # Sort by biggest moves
    price_moves.sort(key=lambda x: abs(x['percent_change']), reverse=True)
    
    print(f"\n📈 Top 10 biggest EIEL moves:")
    for i, move in enumerate(price_moves[:10], 1):
        print(f"  {i:2d}. {move['timestamp'].strftime('%Y-%m-%d %H:%M')} | {move['percent_change']:+6.2f}% | ₹{move['close']:6.2f} | Vol: {move['volume']:8,.0f}")
    
    # Check if any move is around 12%
    big_moves = [m for m in price_moves if abs(m['percent_change']) >= 8.0]
    
    if big_moves:
        print(f"\n🔥 Found {len(big_moves)} moves >= 8%:")
        
        for move in big_moves[:3]:  # Check top 3 big moves
            print(f"\n📊 Analyzing move on {move['timestamp'].strftime('%Y-%m-%d %H:%M')} ({move['percent_change']:+.2f}%):")
            
            candle_idx = move['candle_index']
            
            # Simulate signal detection at that point
            if candle_idx >= 30:  # Need enough historical data
                
                # Get data up to that candle (simulate real-time)
                sim_candles = candles[:candle_idx+1]
                
                highs = [c['high'] for c in sim_candles]
                lows = [c['low'] for c in sim_candles]
                closes = [c['close'] for c in sim_candles]
                volumes = [c['volume'] for c in sim_candles]
                
                # Volume analysis
                current_volume = volumes[-1]
                avg_volume_20 = np.mean(volumes[-21:-1]) if len(volumes) >= 21 else np.mean(volumes[:-1])
                volume_ratio = current_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
                
                # ATR analysis
                current_atr = VolatilityAnalyzer.calculate_atr(highs[-15:], lows[-15:], closes[-15:])
                historical_atr = VolatilityAnalyzer.calculate_atr(highs[-29:-15], lows[-29:-15], closes[-29:-15])
                atr_ratio = current_atr / historical_atr if historical_atr > 0 else 1.0
                
                # Daily volatility
                daily_range = ((highs[-1] - lows[-1]) / closes[-2]) * 100 if len(closes) > 1 else 0.0
                
                # RSI
                rsi = VolatilityAnalyzer.calculate_rsi(closes)
                
                print(f"   Volume ratio: {volume_ratio:.2f}x (need >{scanner.volume_threshold}x)")
                print(f"   ATR ratio: {atr_ratio:.2f}x (need >{scanner.atr_threshold}x)")
                print(f"   Daily volatility: {daily_range:.2f}% (need >{scanner.price_vol_threshold}%)")
                print(f"   RSI: {rsi:.1f}")
                
                # Check signal criteria
                volatility_breakout = (volume_ratio >= scanner.volume_threshold and 
                                      atr_ratio >= scanner.atr_threshold and 
                                      daily_range >= scanner.price_vol_threshold and
                                      30 <= rsi <= 70)
                
                trend_acceleration = (volume_ratio >= 1.2 and 
                                     atr_ratio >= 1.2 and 
                                     daily_range >= 2.0)
                
                momentum_surge = (volume_ratio >= 2.0 and atr_ratio >= 1.0)
                
                detected = volatility_breakout or trend_acceleration or momentum_surge
                
                print(f"   Signal detected: {'✅ YES' if detected else '❌ NO'}")
                
                if detected:
                    signal_type = "volatility_breakout" if volatility_breakout else ("trend_acceleration" if trend_acceleration else "momentum_surge")
                    print(f"   Signal type: {signal_type}")
                    print(f"   🎯 This {move['percent_change']:+.2f}% move WOULD have been detected!")
                else:
                    print(f"   Missing criteria:")
                    if volume_ratio < scanner.volume_threshold:
                        print(f"     - Volume too low: {volume_ratio:.2f}x < {scanner.volume_threshold}x")
                    if atr_ratio < scanner.atr_threshold:
                        print(f"     - ATR too low: {atr_ratio:.2f}x < {scanner.atr_threshold}x")
                    if daily_range < scanner.price_vol_threshold:
                        print(f"     - Volatility too low: {daily_range:.2f}% < {scanner.price_vol_threshold}%")
    else:
        print(f"\n❌ No moves >= 8% found in recent data")
        print(f"   This suggests the 12% surge either:")
        print(f"   - Happened before our data range")
        print(f"   - Was spread across multiple 15-min candles")
        print(f"   - Occurred on a different timeframe")
    
    # Check the latest data point again
    print(f"\n📊 Current EIEL status (latest candle):")
    latest = candles[-1]
    timestamp = datetime.fromtimestamp(latest['timestamp']/1000)
    print(f"   Time: {timestamp.strftime('%Y-%m-%d %H:%M')}")
    print(f"   Price: ₹{latest['close']:.2f}")
    print(f"   Volume: {latest['volume']:,.0f}")
    
    # Daily move calculation
    if len(candles) >= 2:
        prev_close = candles[-2]['close']
        latest_close = candles[-1]['close']
        daily_change = ((latest_close - prev_close) / prev_close) * 100
        print(f"   15-min change: {daily_change:+.2f}%")

if __name__ == "__main__":
    analyze_eiel_12_percent()
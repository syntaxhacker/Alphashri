#!/usr/bin/env python3
"""
Debug why EIEL doesn't generate a signal despite meeting criteria
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

import numpy as np
import pandas as pd
from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner, VolatilityAnalyzer

def debug_eiel_signal():
    """Debug EIEL signal detection step by step"""
    print("🔍 Debugging EIEL signal detection...")
    
    scanner = VolatilityTrendScanner()
    
    print("🔑 Authenticating...")
    if not scanner.authenticate():
        print("❌ Authentication failed")
        return
    
    print("📊 Fetching EIEL data...")
    candles = scanner.get_market_data('EIEL', '15min')
    
    if not candles or len(candles) < 30:
        print("❌ Insufficient data")
        return
    
    print(f"✅ Got {len(candles)} candles")
    
    # Extract data like the scanner does
    opens = [c['open'] for c in candles]
    highs = [c['high'] for c in candles]
    lows = [c['low'] for c in candles]
    closes = [c['close'] for c in candles]
    volumes = [c['volume'] for c in candles]
    
    current_price = closes[-1]
    current_volume = volumes[-1]
    
    print(f"\n📈 Current EIEL Status:")
    print(f"   Price: ₹{current_price:.2f}")
    print(f"   Volume: {current_volume:,.0f}")
    
    # Step-by-step analysis like in detect_volatility_spike
    print(f"\n🔍 Step-by-step signal analysis:")
    
    # 1. Volume analysis
    avg_volume_20 = np.mean(volumes[-21:-1])
    volume_ratio = current_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
    print(f"1. Volume Analysis:")
    print(f"   Current volume: {current_volume:,.0f}")
    print(f"   20-day average: {avg_volume_20:,.0f}")
    print(f"   Volume ratio: {volume_ratio:.2f}x (need >{scanner.volume_threshold}x)")
    print(f"   ✅ PASS" if volume_ratio >= scanner.volume_threshold else f"   ❌ FAIL")
    
    # 2. ATR analysis
    current_atr = VolatilityAnalyzer.calculate_atr(highs[-15:], lows[-15:], closes[-15:])
    historical_atr = VolatilityAnalyzer.calculate_atr(highs[-29:-15], lows[-29:-15], closes[-29:-15])
    atr_ratio = current_atr / historical_atr if historical_atr > 0 else 1.0
    print(f"\n2. ATR Analysis:")
    print(f"   Current ATR: {current_atr:.3f}")
    print(f"   Historical ATR: {historical_atr:.3f}")
    print(f"   ATR ratio: {atr_ratio:.2f}x (need >{scanner.atr_threshold}x)")
    print(f"   ✅ PASS" if atr_ratio >= scanner.atr_threshold else f"   ❌ FAIL")
    
    # 3. Daily volatility
    daily_range = ((highs[-1] - lows[-1]) / closes[-2]) * 100 if len(closes) > 1 else 0.0
    print(f"\n3. Daily Volatility:")
    print(f"   Today's range: {highs[-1]:.2f} - {lows[-1]:.2f} = {highs[-1] - lows[-1]:.2f}")
    print(f"   Previous close: {closes[-2]:.2f}")
    print(f"   Daily volatility: {daily_range:.2f}% (need >{scanner.price_vol_threshold}%)")
    print(f"   ✅ PASS" if daily_range >= scanner.price_vol_threshold else f"   ❌ FAIL")
    
    # 4. RSI analysis
    rsi = VolatilityAnalyzer.calculate_rsi(closes)
    print(f"\n4. RSI Analysis:")
    print(f"   RSI: {rsi:.1f} (need between 30-70 for volatility breakout)")
    print(f"   ✅ PASS" if 30 <= rsi <= 70 else f"   ❌ FAIL")
    
    # 5. Trend direction
    if len(closes) >= 20:
        ema_fast = pd.Series(closes).ewm(span=8).mean().iloc[-1]
        ema_slow = pd.Series(closes).ewm(span=20).mean().iloc[-1]
        trend_direction = "BULLISH" if ema_fast > ema_slow else "BEARISH"
    else:
        trend_direction = "NEUTRAL"
    
    print(f"\n5. Trend Analysis:")
    print(f"   Fast EMA (8): {ema_fast:.2f}")
    print(f"   Slow EMA (20): {ema_slow:.2f}")
    print(f"   Trend: {trend_direction}")
    
    # Test signal detection logic
    print(f"\n🔥 Signal Detection Logic:")
    
    # Test 1: High volatility breakout
    volatility_breakout = (volume_ratio >= scanner.volume_threshold and 
                          atr_ratio >= scanner.atr_threshold and 
                          daily_range >= scanner.price_vol_threshold and
                          30 <= rsi <= 70)
    
    print(f"📊 Volatility Breakout Test:")
    print(f"   Volume ≥ {scanner.volume_threshold}x: {volume_ratio:.2f}x ✅" if volume_ratio >= scanner.volume_threshold else f"   Volume ≥ {scanner.volume_threshold}x: {volume_ratio:.2f}x ❌")
    print(f"   ATR ≥ {scanner.atr_threshold}x: {atr_ratio:.2f}x ✅" if atr_ratio >= scanner.atr_threshold else f"   ATR ≥ {scanner.atr_threshold}x: {atr_ratio:.2f}x ❌")
    print(f"   Volatility ≥ {scanner.price_vol_threshold}%: {daily_range:.2f}% ✅" if daily_range >= scanner.price_vol_threshold else f"   Volatility ≥ {scanner.price_vol_threshold}%: {daily_range:.2f}% ❌")
    print(f"   RSI 30-70: {rsi:.1f} ✅" if 30 <= rsi <= 70 else f"   RSI 30-70: {rsi:.1f} ❌")
    print(f"   Result: {'✅ VOLATILITY BREAKOUT DETECTED' if volatility_breakout else '❌ No volatility breakout'}")
    
    # Test 2: Trend acceleration
    trend_acceleration = (volume_ratio >= 1.2 and 
                         atr_ratio >= 1.2 and 
                         daily_range >= 2.0 and
                         ((trend_direction == "BULLISH" and rsi > 50) or 
                          (trend_direction == "BEARISH" and rsi < 50)))
    
    print(f"\n📈 Trend Acceleration Test:")
    print(f"   Volume ≥ 1.2x: {volume_ratio:.2f}x ✅" if volume_ratio >= 1.2 else f"   Volume ≥ 1.2x: {volume_ratio:.2f}x ❌")
    print(f"   ATR ≥ 1.2x: {atr_ratio:.2f}x ✅" if atr_ratio >= 1.2 else f"   ATR ≥ 1.2x: {atr_ratio:.2f}x ❌")
    print(f"   Volatility ≥ 2.0%: {daily_range:.2f}% ✅" if daily_range >= 2.0 else f"   Volatility ≥ 2.0%: {daily_range:.2f}% ❌")
    trend_rsi_ok = (trend_direction == "BULLISH" and rsi > 50) or (trend_direction == "BEARISH" and rsi < 50)
    print(f"   Trend+RSI: {trend_direction} & RSI {rsi:.1f} ✅" if trend_rsi_ok else f"   Trend+RSI: {trend_direction} & RSI {rsi:.1f} ❌")
    print(f"   Result: {'✅ TREND ACCELERATION DETECTED' if trend_acceleration else '❌ No trend acceleration'}")
    
    # Test 3: Momentum surge
    momentum_surge = (volume_ratio >= 2.0 and 
                     atr_ratio >= 1.0 and
                     ((rsi > 60 and trend_direction == "BULLISH") or 
                      (rsi < 40 and trend_direction == "BEARISH")))
    
    print(f"\n🚀 Momentum Surge Test:")
    print(f"   Volume ≥ 2.0x: {volume_ratio:.2f}x ✅" if volume_ratio >= 2.0 else f"   Volume ≥ 2.0x: {volume_ratio:.2f}x ❌")
    print(f"   ATR ≥ 1.0x: {atr_ratio:.2f}x ✅" if atr_ratio >= 1.0 else f"   ATR ≥ 1.0x: {atr_ratio:.2f}x ❌")
    momentum_rsi_ok = (rsi > 60 and trend_direction == "BULLISH") or (rsi < 40 and trend_direction == "BEARISH")
    print(f"   Momentum+RSI: {trend_direction} & RSI {rsi:.1f} ✅" if momentum_rsi_ok else f"   Momentum+RSI: {trend_direction} & RSI {rsi:.1f} ❌")
    print(f"   Result: {'✅ MOMENTUM SURGE DETECTED' if momentum_surge else '❌ No momentum surge'}")
    
    # Overall result
    any_signal = volatility_breakout or trend_acceleration or momentum_surge
    print(f"\n🎯 FINAL RESULT: {'✅ SIGNAL DETECTED' if any_signal else '❌ NO SIGNAL'}")
    
    if not any_signal:
        print(f"\n💡 Why EIEL didn't trigger:")
        print(f"   RSI is too low ({rsi:.1f}) - indicates oversold/weak momentum")
        print(f"   ATR ratio might be insufficient ({atr_ratio:.2f}x)")
        print(f"   Need either:")
        print(f"   • RSI between 30-70 for volatility breakout")
        print(f"   • RSI > 50 for bullish trend acceleration") 
        print(f"   • RSI > 60 for bullish momentum surge")

if __name__ == "__main__":
    debug_eiel_signal()
#!/usr/bin/env python3
"""
Test the ATR fix with EIEL data
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner

def test_atr_fix():
    """Test if EIEL now generates signals after ATR fix"""
    print("🧪 Testing ATR fix with EIEL...")
    
    scanner = VolatilityTrendScanner()
    
    print("🔑 Authenticating...")
    if not scanner.authenticate():
        print("❌ Authentication failed")
        return
    
    print("📊 Testing EIEL signal detection after fix...")
    signal = scanner.scan_symbol_for_volatility('EIEL')
    
    if signal:
        print(f"🔥 SUCCESS! EIEL signal detected after fix!")
        print(f"   Signal Type: {signal.signal_type}")
        print(f"   Confidence: {signal.confidence:.1%}")
        print(f"   Price: ₹{signal.price:,.2f}")
        print(f"   Volume Ratio: {signal.volume_ratio:.2f}x")
        print(f"   ATR Ratio: {signal.atr_ratio:.2f}x")
        print(f"   Daily Volatility: {signal.daily_volatility:.2f}%")
        print(f"   RSI: {signal.rsi:.1f}")
        print(f"   Trend: {signal.trend_direction}")
        print(f"   Risk:Reward: 1:{signal.risk_reward_ratio:.2f}")
    else:
        print("❌ Still no signal - investigating further...")
        
        # Get the data to check ATR values
        candles = scanner.get_market_data('EIEL', '15min')
        if candles and len(candles) >= 30:
            from upstox_trader.volatility_trend_scanner import VolatilityAnalyzer
            
            highs = [c['high'] for c in candles]
            lows = [c['low'] for c in candles]
            closes = [c['close'] for c in candles]
            
            current_atr = VolatilityAnalyzer.calculate_atr(highs[-15:], lows[-15:], closes[-15:])
            historical_atr = VolatilityAnalyzer.calculate_atr(highs[-29:-15], lows[-29:-15], closes[-29:-15])
            atr_ratio = current_atr / historical_atr if historical_atr > 0 else 1.0
            
            print(f"   Current ATR: {current_atr:.6f}")
            print(f"   Historical ATR: {historical_atr:.6f}")
            print(f"   ATR Ratio: {atr_ratio:.3f}")
            print(f"   ATR Fixed: {'✅' if historical_atr > 0 else '❌'}")
    
    # Test a few other stocks to make sure fix doesn't break anything
    print(f"\n🔍 Testing other stocks to ensure fix doesn't break them...")
    test_stocks = ['TATAMOTORS', 'RELIANCE', 'TCS']
    
    for stock in test_stocks:
        try:
            test_signal = scanner.scan_symbol_for_volatility(stock)
            print(f"   {stock}: {'✅ Signal' if test_signal else '❌ No signal'}")
        except Exception as e:
            print(f"   {stock}: ❌ Error - {str(e)}")

if __name__ == "__main__":
    test_atr_fix()
#!/usr/bin/env python3
"""
Test EIEL data availability and why it might not trigger signals
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

from upstox_trader.volatility_trend_scanner import VolatilityTrendScanner
from datetime import datetime, timedelta

def test_eiel_data():
    """Test EIEL data availability and signal generation"""
    print("🔍 Testing EIEL data availability and signal detection...")
    
    scanner = VolatilityTrendScanner()
    
    print("🔑 Authenticating with Upstox...")
    if not scanner.authenticate():
        print("❌ Authentication failed - cannot test EIEL data")
        return
    
    print("✅ Authentication successful")
    
    print("\n📊 Testing EIEL data fetch...")
    try:
        # Test data fetching for EIEL
        candles = scanner.get_market_data('EIEL', '15min')
        
        if candles is None:
            print("❌ No data returned for EIEL")
            print("   Possible reasons:")
            print("   - EIEL symbol not found in Upstox database")
            print("   - EIEL trading suspended or delisted")
            print("   - Wrong symbol format")
            return
        
        if len(candles) == 0:
            print("❌ Empty data returned for EIEL")
            return
            
        print(f"✅ Successfully fetched {len(candles)} candles for EIEL")
        
        # Show recent data
        print("\n📈 Recent EIEL data (last 5 candles):")
        for i, candle in enumerate(candles[-5:], 1):
            timestamp = datetime.fromtimestamp(candle['timestamp']/1000)
            print(f"  {i}. {timestamp.strftime('%Y-%m-%d %H:%M')} | O:{candle['open']:6.2f} H:{candle['high']:6.2f} L:{candle['low']:6.2f} C:{candle['close']:6.2f} V:{candle['volume']:8.0f}")
        
        # Test volatility detection
        print("\n🔥 Testing EIEL volatility signal detection...")
        signal = scanner.scan_symbol_for_volatility('EIEL')
        
        if signal:
            print(f"✅ VOLATILITY SIGNAL DETECTED for EIEL!")
            print(f"   Signal Type: {signal.signal_type}")
            print(f"   Confidence: {signal.confidence:.1%}")
            print(f"   Price: ₹{signal.price:,.2f}")
            print(f"   Volume Ratio: {signal.volume_ratio:.2f}x")
            print(f"   Daily Volatility: {signal.daily_volatility:.2f}%")
            print(f"   RSI: {signal.rsi:.1f}")
            print(f"   Trend: {signal.trend_direction}")
        else:
            print("❌ NO signal detected for EIEL")
            
            # Let's analyze why
            if len(candles) >= 30:
                print("\n🔍 Analyzing why EIEL didn't trigger:")
                
                current_candle = candles[-1]
                current_price = current_candle['close']
                current_volume = current_candle['volume']
                
                # Volume analysis
                volumes = [c['volume'] for c in candles[-21:-1]]  # Last 20 excluding current
                avg_volume_20 = sum(volumes) / len(volumes) if volumes else 1
                volume_ratio = current_volume / avg_volume_20 if avg_volume_20 > 0 else 1.0
                
                # Price volatility
                if len(candles) > 1:
                    daily_volatility = ((current_candle['high'] - current_candle['low']) / candles[-2]['close']) * 100
                else:
                    daily_volatility = 0
                
                print(f"   Current Price: ₹{current_price:.2f}")
                print(f"   Current Volume: {current_volume:,.0f}")
                print(f"   Avg Volume (20d): {avg_volume_20:,.0f}")
                print(f"   Volume Ratio: {volume_ratio:.2f}x (need >{scanner.volume_threshold}x)")
                print(f"   Daily Volatility: {daily_volatility:.2f}% (need >{scanner.price_vol_threshold}%)")
                print(f"   Min Volume Check: {current_volume:,.0f} > {scanner.min_volume:,.0f} = {current_volume > scanner.min_volume}")
                print(f"   Min Price Check: ₹{current_price:.2f} > ₹{scanner.min_price:.2f} = {current_price > scanner.min_price}")
                
                print("\n📋 Signal Requirements:")
                print(f"   ✓ Volume ratio > {scanner.volume_threshold}x: {'✅' if volume_ratio > scanner.volume_threshold else '❌'} ({volume_ratio:.2f}x)")
                print(f"   ✓ Daily volatility > {scanner.price_vol_threshold}%: {'✅' if daily_volatility > scanner.price_vol_threshold else '❌'} ({daily_volatility:.2f}%)")
                print(f"   ✓ Volume > {scanner.min_volume:,}: {'✅' if current_volume > scanner.min_volume else '❌'} ({current_volume:,.0f})")
                print(f"   ✓ Price > ₹{scanner.min_price}: {'✅' if current_price > scanner.min_price else '❌'} (₹{current_price:.2f})")
                
    except Exception as e:
        print(f"❌ Error testing EIEL: {str(e)}")
        print("   This could indicate:")
        print("   - EIEL symbol not available in Upstox")
        print("   - Data fetch timeout")
        print("   - Authentication issues")

if __name__ == "__main__":
    test_eiel_data()
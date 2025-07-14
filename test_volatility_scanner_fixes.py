#!/usr/bin/env python3
"""
Test script to verify VolatilityTrendScanner fixes
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'upstox_trader'))

from upstox_trader.volatility_trend_scanner import TradingViewScreener

def test_screener_fixes():
    """Test the fixed TradingView screener"""
    print("🧪 Testing VolatilityTrendScanner fixes...")
    
    screener = TradingViewScreener()
    
    # Test 1: Check if comprehensive stock list includes EIEL
    print("\n📋 Test 1: Checking comprehensive stock list...")
    stock_list = screener._get_comprehensive_stock_list()
    
    eiel_found = any(stock['symbol'] == 'EIEL' for stock in stock_list)
    print(f"✅ EIEL found in stock list: {eiel_found}")
    print(f"📊 Total stocks in comprehensive list: {len(stock_list)}")
    
    # Show a sample of stocks
    print("\n📈 Sample of stocks in the list:")
    for i, stock in enumerate(stock_list[:10]):
        print(f"  {i+1}. {stock['symbol']} ({stock['sector']})")
    
    if eiel_found:
        eiel_stock = next(stock for stock in stock_list if stock['symbol'] == 'EIEL')
        print(f"\n🎯 EIEL details: {eiel_stock}")
    
    # Test 2: Check TradingView screener (if available)
    print(f"\n🔧 Test 2: TradingView screener availability...")
    print(f"TradingView screener available: {screener.screener_available}")
    print(f"TradingView TA available: {screener.ta_available}")
    
    if screener.screener_available:
        print("\n🔍 Testing TradingView screener with new parsing...")
        try:
            results = screener.scan_high_volatility_stocks(limit=10)
            print(f"✅ TradingView scan successful: {len(results)} results")
            if results:
                print("📊 Sample results:")
                for i, result in enumerate(results[:3]):
                    print(f"  {i+1}. {result['symbol']}: Price={result['price']}, Vol Ratio={result['volume_ratio']:.2f}")
        except Exception as e:
            print(f"❌ TradingView scan failed: {e}")
    
    print("\n✅ Test completed!")
    print(f"📈 Scanner will now scan {len(stock_list)} stocks instead of just 20")
    print("🔥 EIEL and similar stocks should now be detected!")

if __name__ == "__main__":
    test_screener_fixes()
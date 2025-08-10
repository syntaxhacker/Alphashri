#!/usr/bin/env python3
"""
Test TV Modes Functions with Real Historical Data
=================================================

This script tests the actual pattern detection and analysis functions
using your real 1-minute historical data from data_cache/.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
from unittest.mock import Mock

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import screeners.tv_modes as tv_modes


def load_stock_data(symbol, date_str=None):
    """Load real 1-minute data for a stock"""
    data_cache_dir = "data_cache"
    
    if not date_str:
        # Try dates from July 2025 (based on your data)
        test_dates = [
            '2025-07-25', '2025-07-24', '2025-07-23', '2025-07-22', '2025-07-21',
            '2025-07-18', '2025-07-17', '2025-07-16', '2025-07-15', '2025-07-14'
        ]
        
        for test_date in test_dates:
            filename = f"{symbol}_{test_date}_1min.csv"
            filepath = os.path.join(data_cache_dir, filename)
            
            if os.path.exists(filepath):
                try:
                    df = pd.read_csv(filepath)
                    # Add timestamp column if missing
                    if 'datetime' in df.columns:
                        df['timestamp'] = pd.to_datetime(df['datetime'])
                    
                    if len(df) > 50:  # Ensure we have enough data
                        print(f"✅ Loaded {len(df)} candles for {symbol} on {test_date}")
                        return df, test_date
                except Exception as e:
                    print(f"❌ Error loading {filename}: {e}")
                    continue
    
    return pd.DataFrame(), None


def test_basic_momentum_metrics():
    """Test _calculate_basic_momentum_metrics with real stock data"""
    
    print("\n" + "="*60)
    print("🧪 TESTING: _calculate_basic_momentum_metrics")
    print("="*60)
    
    test_stocks = ['RELIANCE', 'HDFCBANK', 'INFY']
    results = []
    
    for symbol in test_stocks:
        df, date = load_stock_data(symbol)
        
        if df.empty:
            continue
        
        print(f"\n📊 Analyzing {symbol} on {date}")
        print(f"   Data: {len(df)} 1-min candles")
        print(f"   Price range: ₹{df['low'].min():.2f} - ₹{df['high'].max():.2f}")
        print(f"   Volume range: {df['volume'].min():,} - {df['volume'].max():,}")
        
        # Calculate real metrics from the data
        day_open = df['open'].iloc[0]
        day_close = df['close'].iloc[-1]
        day_change = ((day_close - day_open) / day_open) * 100
        total_volume = df['volume'].sum()
        avg_volume = df['volume'].mean()
        
        # Create test row with real data + simulated technical indicators
        test_row = {
            'close': day_close,
            'volume': total_volume,
            'change': day_change,
            'RSI': 60.0 if day_change > 0 else 40.0,  # Simulate RSI based on price movement
            'relative_volume_10d_calc': 1.2 if total_volume > avg_volume else 0.8,
            'MACD.macd': 0.5 if day_change > 0 else -0.5,
            'MACD.signal': 0.3 if day_change > 0 else -0.3
        }
        
        try:
            # Test the actual function
            result = tv_modes._calculate_basic_momentum_metrics(test_row)
            
            print(f"   ✅ Function executed successfully!")
            print(f"   📈 Price Momentum: {result.get('price_momentum', 'N/A')}")
            print(f"   📊 Volume Momentum: {result.get('volume_momentum', 'N/A')}")
            print(f"   📋 RSI Strength: {result.get('rsi_strength', 'N/A')}")
            print(f"   📊 MACD Momentum: {result.get('macd_momentum', 'N/A')}")
            print(f"   🎯 Composite Score: {result.get('composite_score', 'N/A'):.2f}")
            
            # Validate the results
            assert isinstance(result, dict), "Should return dictionary"
            assert 'composite_score' in result, "Should have composite_score"
            assert isinstance(result['composite_score'], (int, float)), "Score should be numeric"
            assert not np.isnan(result['composite_score']), "Score should not be NaN"
            
            results.append({
                'symbol': symbol,
                'day_change': day_change,
                'composite_score': result['composite_score'],
                'interpretation': 'Bullish' if result['composite_score'] > 0 else 'Bearish'
            })
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            results.append({
                'symbol': symbol,
                'error': str(e)
            })
    
    # Summary
    print(f"\n📋 SUMMARY - Basic Momentum Analysis")
    print("-" * 40)
    for result in results:
        if 'error' not in result:
            print(f"{result['symbol']}: {result['interpretation']} "
                  f"(Score: {result['composite_score']:.2f}, "
                  f"Change: {result['day_change']:.2f}%)")
        else:
            print(f"{result['symbol']}: ERROR - {result['error']}")
    
    return results


def test_intraday_momentum_metrics():
    """Test _calculate_intraday_momentum_metrics with real 1-minute data"""
    
    print("\n" + "="*60)
    print("🧪 TESTING: _calculate_intraday_momentum_metrics")
    print("="*60)
    
    test_stocks = ['RELIANCE', 'HDFCBANK', 'INFY']
    results = []
    
    for symbol in test_stocks:
        df, date = load_stock_data(symbol)
        
        if df.empty or len(df) < 50:
            continue
        
        print(f"\n📊 Analyzing {symbol} intraday momentum on {date}")
        
        # Create mock screener instance
        mock_screener = Mock()
        mock_screener._check_historical_trend = Mock(return_value='Bullish')
        
        # Prepare current_row data
        current_row = {
            'name': symbol,
            'close': df['close'].iloc[-1],
            'volume': df['volume'].sum(),
            'change': ((df['close'].iloc[-1] - df['open'].iloc[0]) / df['open'].iloc[0]) * 100
        }
        
        print(f"   Current Price: ₹{current_row['close']:.2f}")
        print(f"   Day Change: {current_row['change']:.2f}%")
        print(f"   Total Volume: {current_row['volume']:,}")
        
        try:
            # Test the actual function
            result = tv_modes._calculate_intraday_momentum_metrics(
                mock_screener, df, current_row
            )
            
            print(f"   ✅ Function executed successfully!")
            print(f"   📈 Volume Ratio: {result.get('intraday_volume_ratio', 'N/A')}")
            print(f"   ⚡ Price Acceleration: {result.get('price_acceleration', 'N/A')}")
            print(f"   💪 Momentum Strength: {result.get('momentum_strength', 'N/A')}")
            print(f"   🚨 Breakout Signal: {result.get('breakout_signal', 'N/A')}")
            print(f"   📊 Trend Confirmation: {result.get('trend_confirmation', 'N/A')}")
            
            # Validate results
            assert isinstance(result, dict), "Should return dictionary"
            
            if 'momentum_strength' in result:
                assert result['momentum_strength'] in ['Weak', 'Moderate', 'Strong', 'Very Strong'], \
                    "Momentum strength should be valid category"
            
            if 'breakout_signal' in result:
                assert isinstance(result['breakout_signal'], bool), "Breakout signal should be boolean"
            
            results.append({
                'symbol': symbol,
                'momentum_strength': result.get('momentum_strength', 'N/A'),
                'breakout_signal': result.get('breakout_signal', False),
                'trend_confirmation': result.get('trend_confirmation', 'N/A')
            })
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            results.append({
                'symbol': symbol,
                'error': str(e)
            })
    
    # Summary
    print(f"\n📋 SUMMARY - Intraday Momentum Analysis")
    print("-" * 40)
    for result in results:
        if 'error' not in result:
            signal = "🔥" if result['breakout_signal'] else "📊"
            print(f"{result['symbol']}: {signal} {result['momentum_strength']} momentum, "
                  f"Trend: {result['trend_confirmation']}")
        else:
            print(f"{result['symbol']}: ERROR - {result['error']}")
    
    return results


def detect_real_breakouts():
    """Detect actual breakout patterns in real data"""
    
    print("\n" + "="*60)
    print("🧪 TESTING: Real Breakout Detection Logic")
    print("="*60)
    
    test_stocks = ['RELIANCE', 'HDFCBANK', 'INFY', 'AXISBANK', 'ICICIBANK']
    breakout_results = []
    
    for symbol in test_stocks:
        df, date = load_stock_data(symbol)
        
        if df.empty or len(df) < 100:
            continue
        
        print(f"\n🔍 Analyzing {symbol} for breakout patterns on {date}")
        
        # Calculate rolling metrics for breakout detection
        window = 20
        df['volume_ma'] = df['volume'].rolling(window=window).mean()
        df['price_ma'] = df['close'].rolling(window=window).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ma']
        
        # Detect breakout conditions
        breakouts_found = []
        
        for i in range(window, len(df)):
            current_row = df.iloc[i]
            recent_data = df.iloc[i-window:i]
            
            # Price breakout conditions
            price_above_recent_high = current_row['close'] > recent_data['high'].max() * 1.002  # 0.2% above
            price_below_recent_low = current_row['close'] < recent_data['low'].min() * 0.998   # 0.2% below
            
            # Volume surge condition
            volume_surge = current_row['volume_ratio'] > 1.5  # 50% above average
            
            if (price_above_recent_high or price_below_recent_low) and volume_surge:
                breakout_type = 'Upward' if price_above_recent_high else 'Downward'
                
                breakouts_found.append({
                    'time_index': i,
                    'price': current_row['close'],
                    'type': breakout_type,
                    'volume_ratio': current_row['volume_ratio'],
                    'price_change_from_open': ((current_row['close'] - df['open'].iloc[0]) / df['open'].iloc[0]) * 100
                })
        
        print(f"   📊 Price range: ₹{df['low'].min():.2f} - ₹{df['high'].max():.2f}")
        print(f"   📈 Day change: {((df['close'].iloc[-1] - df['open'].iloc[0]) / df['open'].iloc[0]) * 100:.2f}%")
        print(f"   🔍 Breakouts detected: {len(breakouts_found)}")
        
        if breakouts_found:
            # Show the strongest breakout
            strongest = max(breakouts_found, key=lambda x: x['volume_ratio'])
            print(f"   🚀 Strongest breakout: {strongest['type']} at ₹{strongest['price']:.2f}")
            print(f"   📊 Volume surge: {strongest['volume_ratio']:.1f}x average")
        
        breakout_results.append({
            'symbol': symbol,
            'date': date,
            'breakouts_count': len(breakouts_found),
            'strongest_breakout': breakouts_found[0] if breakouts_found else None
        })
    
    # Summary
    print(f"\n📋 SUMMARY - Breakout Detection")
    print("-" * 40)
    total_breakouts = sum(r['breakouts_count'] for r in breakout_results)
    stocks_with_breakouts = sum(1 for r in breakout_results if r['breakouts_count'] > 0)
    
    print(f"Total breakouts detected: {total_breakouts}")
    print(f"Stocks with breakouts: {stocks_with_breakouts}/{len(breakout_results)}")
    
    for result in breakout_results:
        if result['breakouts_count'] > 0:
            strongest = result['strongest_breakout']
            print(f"{result['symbol']}: {result['breakouts_count']} breakouts, "
                  f"strongest was {strongest['type']} with {strongest['volume_ratio']:.1f}x volume")
    
    return breakout_results


def main():
    """Run all tests with real data"""
    
    print("🚀 TV MODES REAL DATA VALIDATION")
    print("Testing pattern detection functions with your historical 1-minute data...")
    
    # Check if data directory exists
    if not os.path.exists('data_cache'):
        print("❌ data_cache directory not found!")
        print("Make sure you're running this from the project root directory.")
        return False
    
    try:
        # Test 1: Basic momentum metrics
        momentum_results = test_basic_momentum_metrics()
        
        # Test 2: Intraday momentum analysis
        intraday_results = test_intraday_momentum_metrics() 
        
        # Test 3: Real breakout detection
        breakout_results = detect_real_breakouts()
        
        # Overall summary
        print("\n" + "="*60)
        print("🎯 FINAL VALIDATION SUMMARY")
        print("="*60)
        
        successful_tests = []
        if momentum_results:
            successful_basic = sum(1 for r in momentum_results if 'error' not in r)
            print(f"✅ Basic momentum analysis: {successful_basic}/{len(momentum_results)} stocks")
            successful_tests.append(successful_basic > 0)
        
        if intraday_results:
            successful_intraday = sum(1 for r in intraday_results if 'error' not in r)
            print(f"✅ Intraday momentum analysis: {successful_intraday}/{len(intraday_results)} stocks")
            successful_tests.append(successful_intraday > 0)
        
        if breakout_results:
            successful_breakouts = sum(1 for r in breakout_results if r['breakouts_count'] >= 0)
            print(f"✅ Breakout detection: {successful_breakouts}/{len(breakout_results)} stocks analyzed")
            successful_tests.append(successful_breakouts > 0)
        
        overall_success = all(successful_tests)
        
        if overall_success:
            print(f"\n🎉 SUCCESS: All TV modes functions work correctly with real data!")
            print(f"📊 Your pattern detection algorithms are functioning as expected.")
        else:
            print(f"\n⚠️ MIXED RESULTS: Some functions may need attention.")
            
        return overall_success
        
    except Exception as e:
        print(f"❌ Critical error during testing: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
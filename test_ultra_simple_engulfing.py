#!/usr/bin/env python3
"""
🕯️ ULTRA-SIMPLE ENGULFING TEST

Your simplified logic:
1. Previous candle: Green or Red
2. Current candle: Opposite color + ENGULFS previous  
3. Trade: In direction of engulfing candle

No 3-candle momentum needed!
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from enhanced_data_fetcher import EnhancedDataFetcher

def test_ultra_simple_engulfing(symbol='ETHUSDT', timeframe='4h', days=180):
    """Test ultra-simple engulfing: just 1 candle + engulfing"""
    
    data_fetcher = EnhancedDataFetcher(
        api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
        api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c",
        cache_dir="vectorbt_cache"
    )
    
    print(f"📊 Testing ULTRA-SIMPLE: {symbol} {timeframe} for {days} days")
    
    # Fetch data
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    data = data_fetcher.fetch_data(
        symbol=symbol, start_date=start_date, end_date=end_date, timeframe=timeframe
    )
    
    if data.empty:
        print("❌ No data")
        return None
    
    print(f"✅ Fetched {len(data)} bars")
    
    # Candlestick properties
    data['is_green'] = data['close'] > data['open']
    data['body_size'] = abs(data['close'] - data['open'])
    
    long_signals = pd.Series(False, index=data.index)
    short_signals = pd.Series(False, index=data.index)
    
    print("🔍 ULTRA-SIMPLE engulfing detection...")
    signal_count = 0
    
    # ULTRA-SIMPLE: Just check current vs previous candle
    for i in range(1, len(data)):  # Start from index 1 (need previous candle)
        current = data.iloc[i]
        previous = data.iloc[i-1]
        
        # Skip if no body (doji candles)
        if current['body_size'] == 0 or previous['body_size'] == 0:
            continue
        
        # ULTRA-SIMPLE ENGULFING CONDITIONS
        current_body = current['body_size']
        previous_body = previous['body_size']
        
        # Minimum engulfing ratio (just 20% bigger)
        engulf_ratio = 1.2
        
        # BULLISH ENGULFING: Red previous + Green current that engulfs it
        if (not previous['is_green'] and  # Previous red
            current['is_green'] and      # Current green
            current['open'] <= previous['close'] and    # Opens at/below prev close
            current['close'] >= previous['open'] and    # Closes at/above prev open
            current_body >= previous_body * engulf_ratio):  # 20% bigger body
            
            long_signals.iloc[i] = True
            signal_count += 1
            if signal_count <= 5:
                print(f"🔺 BUY {signal_count}: Red candle engulfed by green")
        
        # BEARISH ENGULFING: Green previous + Red current that engulfs it
        elif (previous['is_green'] and   # Previous green
              not current['is_green'] and # Current red
              current['open'] >= previous['close'] and    # Opens at/above prev close
              current['close'] <= previous['open'] and    # Closes at/below prev open
              current_body >= previous_body * engulf_ratio):  # 20% bigger body
            
            short_signals.iloc[i] = True
            signal_count += 1
            if signal_count <= 5:
                print(f"🔻 SELL {signal_count}: Green candle engulfed by red")
    
    print(f"✅ ULTRA-SIMPLE found {long_signals.sum()} BUY and {short_signals.sum()} SELL signals")
    
    if long_signals.sum() == 0 and short_signals.sum() == 0:
        print("❌ No signals found")
        return None
    
    # SIMPLE exits: opposite signal + time-based
    long_exits = short_signals.copy()
    short_exits = long_signals.copy()
    
    # Time-based exits
    max_hold = 8 if timeframe == '4h' else 12  # 32h for 4h, 12h for 1h
    
    for i in range(len(long_signals)):
        if long_signals.iloc[i]:
            exit_idx = min(i + max_hold, len(long_signals) - 1)
            if not any(short_signals.iloc[i+1:exit_idx+1]):
                long_exits.iloc[exit_idx] = True
    
    for i in range(len(short_signals)):
        if short_signals.iloc[i]:
            exit_idx = min(i + max_hold, len(short_signals) - 1)
            if not any(long_signals.iloc[i+1:exit_idx+1]):
                short_exits.iloc[exit_idx] = True
    
    # Backtest
    portfolio = vbt.Portfolio.from_signals(
        close=data['close'],
        entries=long_signals, exits=long_exits,
        short_entries=short_signals, short_exits=short_exits,
        init_cash=10000, fees=0.001, freq=timeframe
    )
    
    # Results
    stats = portfolio.stats()
    
    print(f"\n📊 ULTRA-SIMPLE RESULTS for {symbol} {timeframe}:")
    print(f"📈 Total Return: {stats['Total Return [%]']:.2f}%")
    print(f"🎯 Win Rate: {stats['Win Rate [%]']:.1f}%")
    print(f"📊 Trades: {stats['Total Trades']}")
    print(f"⚡ Sharpe: {stats['Sharpe Ratio']:.2f}")
    print(f"📉 Max DD: {stats['Max Drawdown [%]']:.2f}%")
    
    return stats

def main():
    print("🕯️ ULTRA-SIMPLE ENGULFING TEST")
    print("Just 1 candle + engulfing = trade!")
    print("="*40)
    
    # Test multiple configurations with ultra-simple logic
    configs = [
        {'symbol': 'ETHUSDT', 'timeframe': '4h', 'days': 180, 'name': 'ETH 4H (6mo)'},
        {'symbol': 'BTCUSDT', 'timeframe': '4h', 'days': 180, 'name': 'BTC 4H (6mo)'},
        {'symbol': 'ETHUSDT', 'timeframe': '1h', 'days': 90, 'name': 'ETH 1H (3mo)'},
        {'symbol': 'BTCUSDT', 'timeframe': '1h', 'days': 90, 'name': 'BTC 1H (3mo)'},
    ]
    
    all_results = []
    
    for config in configs:
        print(f"\n{'='*15} {config['name']} {'='*15}")
        try:
            stats = test_ultra_simple_engulfing(
                symbol=config['symbol'],
                timeframe=config['timeframe'], 
                days=config['days']
            )
            if stats:
                all_results.append({
                    'name': config['name'],
                    'return': stats['Total Return [%]'],
                    'win_rate': stats['Win Rate [%]'],
                    'trades': stats['Total Trades'],
                    'sharpe': stats['Sharpe Ratio']
                })
        except Exception as e:
            print(f"❌ Error: {e}")
    
    # Summary
    if all_results:
        print(f"\n{'='*50}")
        print("📊 ULTRA-SIMPLE ENGULFING SUMMARY")
        print(f"{'='*50}")
        
        for result in all_results:
            print(f"\n{result['name']}:")
            print(f"  💰 Return: {result['return']:+.2f}%")
            print(f"  🎯 Win Rate: {result['win_rate']:.1f}%")
            print(f"  📊 Trades: {result['trades']}")
            print(f"  ⚡ Sharpe: {result['sharpe']:.2f}")
        
        # Best performer
        if all_results:
            best = max(all_results, key=lambda x: x['return'])
            print(f"\n🏆 BEST: {best['name']}")
            print(f"   📈 {best['return']:+.2f}% | 🎯 {best['win_rate']:.1f}% wins | ⚡ {best['sharpe']:.2f} Sharpe")
        
        # Count profitable
        profitable = [r for r in all_results if r['return'] > 0]
        print(f"\n💡 PROFITABLE: {len(profitable)}/{len(all_results)} configurations")
        
        if profitable:
            avg_return = np.mean([r['return'] for r in profitable])
            print(f"✅ ULTRA-SIMPLE approach works! Avg profitable return: {avg_return:.2f}%")
        else:
            print("❌ Ultra-simple needs refinement")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
🕯️ FINAL TEST: Optimized Engulfing Strategy

Let's try:
1. Longer test period (6 months)
2. Different timeframes
3. Relaxed parameters for more signals
4. Better risk management
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from enhanced_data_fetcher import EnhancedDataFetcher

def test_engulfing_strategy(symbol='BTCUSDT', timeframe='4h', days=180):
    """Test engulfing strategy with different parameters"""
    
    data_fetcher = EnhancedDataFetcher(
        api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
        api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c",
        cache_dir="vectorbt_cache"
    )
    
    print(f"📊 Testing {symbol} {timeframe} for {days} days")
    
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
    
    # Add indicators
    data['ma_10'] = data['close'].rolling(10).mean()
    data['ma_20'] = data['close'].rolling(20).mean()
    data['volume_ma'] = data['volume'].rolling(10).mean()
    data['volume_ratio'] = data['volume'] / data['volume_ma']
    
    # Candlestick properties
    data['is_green'] = data['close'] > data['open']
    data['body_size'] = abs(data['close'] - data['open'])
    
    long_signals = pd.Series(False, index=data.index)
    short_signals = pd.Series(False, index=data.index)
    
    print("🔍 Detecting patterns...")
    signal_count = 0
    
    # RELAXED parameters for more signals
    for i in range(15, len(data)):
        # 3-candle momentum
        momentum_candles = data.iloc[i-3:i]
        current = data.iloc[i]
        previous = data.iloc[i-1]
        
        all_green = all(momentum_candles['is_green'])
        all_red = all(~momentum_candles['is_green'])
        
        if not (all_green or all_red):
            continue
        
        # RELAXED momentum requirement
        momentum_pct = abs((momentum_candles['close'].iloc[-1] - momentum_candles['open'].iloc[0]) / momentum_candles['open'].iloc[0]) * 100
        if momentum_pct < 0.02:  # Very low 0.02%
            continue
        
        # Engulfing pattern
        current_body = current['body_size']
        previous_body = previous['body_size']
        
        if previous_body == 0:  # Avoid division by zero
            continue
        
        # RELAXED engulfing ratio
        engulf_ratio = 1.1  # Just 10% bigger
        
        # BUY: Red momentum + Bullish engulfing
        if (all_red and current['is_green'] and not previous['is_green'] and
            current['open'] <= previous['close'] * 1.001 and  # Small tolerance
            current['close'] >= previous['open'] * 0.999 and  # Small tolerance
            current_body >= previous_body * engulf_ratio):
            
            long_signals.iloc[i] = True
            signal_count += 1
            if signal_count <= 3:
                print(f"🔺 BUY {signal_count}: Red momentum + Bullish engulfing")
        
        # SELL: Green momentum + Bearish engulfing
        elif (all_green and not current['is_green'] and previous['is_green'] and
              current['open'] >= previous['close'] * 0.999 and  # Small tolerance
              current['close'] <= previous['open'] * 1.001 and  # Small tolerance
              current_body >= previous_body * engulf_ratio):
            
            short_signals.iloc[i] = True
            signal_count += 1
            if signal_count <= 3:
                print(f"🔻 SELL {signal_count}: Green momentum + Bearish engulfing")
    
    print(f"✅ Found {long_signals.sum()} BUY and {short_signals.sum()} SELL signals")
    
    if long_signals.sum() == 0 and short_signals.sum() == 0:
        print("❌ No signals found")
        return None
    
    # Simple exits: Opposite signal + time-based
    long_exits = short_signals.copy()
    short_exits = long_signals.copy()
    
    # Add time-based exits (adjust for timeframe)
    max_hold = 10 if timeframe == '4h' else 24  # 40h for 4h, 24h for 1h
    
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
    
    print(f"\n📊 RESULTS for {symbol} {timeframe}:")
    print(f"📈 Total Return: {stats['Total Return [%]']:.2f}%")
    print(f"🎯 Win Rate: {stats['Win Rate [%]']:.1f}%")
    print(f"📊 Trades: {stats['Total Trades']}")
    print(f"⚡ Sharpe: {stats['Sharpe Ratio']:.2f}")
    print(f"📉 Max DD: {stats['Max Drawdown [%]']:.2f}%")
    
    return stats

def main():
    print("🕯️ FINAL ENGULFING STRATEGY TESTS")
    print("Testing multiple timeframes and longer periods")
    print("="*50)
    
    # Test different configurations
    configs = [
        {'symbol': 'BTCUSDT', 'timeframe': '4h', 'days': 180, 'name': '6-Month 4H BTC'},
        {'symbol': 'BTCUSDT', 'timeframe': '1h', 'days': 90, 'name': '3-Month 1H BTC'},
        {'symbol': 'ETHUSDT', 'timeframe': '4h', 'days': 180, 'name': '6-Month 4H ETH'},
    ]
    
    all_results = []
    
    for config in configs:
        print(f"\n{'='*20} {config['name']} {'='*20}")
        try:
            stats = test_engulfing_strategy(
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
        print("📊 FINAL SUMMARY - ENGULFING STRATEGY")
        print(f"{'='*50}")
        
        for result in all_results:
            print(f"\n{result['name']}:")
            print(f"  💰 Return: {result['return']:.2f}%")
            print(f"  🎯 Win Rate: {result['win_rate']:.1f}%")
            print(f"  �� Trades: {result['trades']}")
            print(f"  ⚡ Sharpe: {result['sharpe']:.2f}")
        
        # Best performer
        best = max(all_results, key=lambda x: x['return'])
        print(f"\n�� BEST PERFORMER: {best['name']}")
        print(f"   Return: {best['return']:.2f}% | Win Rate: {best['win_rate']:.1f}%")
        
        # Overall assessment
        positive_results = [r for r in all_results if r['return'] > 0]
        if positive_results:
            print(f"\n✅ CONCLUSION: {len(positive_results)}/{len(all_results)} configurations are profitable!")
            print("💡 Your simple engulfing logic has potential!")
        else:
            print(f"\n❌ CONCLUSION: Strategy needs more refinement")
            print("💡 Consider: Different timeframes, filters, or market conditions")

if __name__ == "__main__":
    main()

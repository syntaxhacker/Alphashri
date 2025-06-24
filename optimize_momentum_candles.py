#!/usr/bin/env python3
"""
🔧 OPTIMIZE MOMENTUM CANDLES

Test different numbers of momentum candles (1-5) and find the best:
- 1 candle: Simple engulfing
- 2 candles: 2-candle momentum + engulfing  
- 3 candles: 3-candle momentum + engulfing (our current best)
- 4 candles: 4-candle momentum + engulfing
- 5 candles: 5-candle momentum + engulfing

Find the OPTIMAL number!
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from enhanced_data_fetcher import EnhancedDataFetcher

class MomentumCandleOptimizer:
    def __init__(self):
        self.data_fetcher = EnhancedDataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c",
            cache_dir="vectorbt_cache"
        )
    
    def fetch_data(self, symbol='ETHUSDT', timeframe='4h', days=180):
        """Fetch data for optimization"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        data = self.data_fetcher.fetch_data(
            symbol=symbol, start_date=start_date, end_date=end_date, timeframe=timeframe
        )
        
        if data.empty:
            return None
        
        print(f"✅ Fetched {len(data)} bars for {symbol} {timeframe}")
        return data
    
    def test_momentum_candles(self, data, momentum_candles=3, min_momentum_pct=0.02, 
                             engulf_ratio=1.2, max_hold_periods=8):
        """Test engulfing strategy with variable momentum candles"""
        
        # Candlestick properties
        data['is_green'] = data['close'] > data['open']
        data['body_size'] = abs(data['close'] - data['open'])
        
        long_signals = pd.Series(False, index=data.index)
        short_signals = pd.Series(False, index=data.index)
        
        signal_count = 0
        
        # Start from momentum_candles + 1 to have enough history
        for i in range(momentum_candles + 1, len(data)):
            
            if momentum_candles == 1:
                # SIMPLE ENGULFING: Just previous + current
                previous = data.iloc[i-1]
                current = data.iloc[i]
                
                # No momentum check, just engulfing
                all_green = previous['is_green']
                all_red = not previous['is_green']
                
            else:
                # MOMENTUM-BASED: Check N candles + current
                momentum_candles_data = data.iloc[i-momentum_candles:i]
                current = data.iloc[i]
                previous = data.iloc[i-1]
                
                # Check momentum direction
                all_green = all(momentum_candles_data['is_green'])
                all_red = all(~momentum_candles_data['is_green'])
                
                if not (all_green or all_red):
                    continue  # No clear momentum
                
                # Calculate momentum strength
                momentum_start_price = momentum_candles_data['open'].iloc[0]
                momentum_end_price = momentum_candles_data['close'].iloc[-1]
                momentum_pct = abs((momentum_end_price - momentum_start_price) / momentum_start_price) * 100
                
                if momentum_pct < min_momentum_pct:
                    continue  # Not enough momentum
            
            # Engulfing pattern check
            current_body = current['body_size']
            previous_body = data.iloc[i-1]['body_size']
            
            if previous_body == 0:  # Avoid division by zero
                continue
            
            # BULLISH ENGULFING: Red momentum + Green current that engulfs
            if (all_red and current['is_green'] and 
                current['open'] <= data.iloc[i-1]['close'] and
                current['close'] >= data.iloc[i-1]['open'] and
                current_body >= previous_body * engulf_ratio):
                
                long_signals.iloc[i] = True
                signal_count += 1
            
            # BEARISH ENGULFING: Green momentum + Red current that engulfs
            elif (all_green and not current['is_green'] and
                  current['open'] >= data.iloc[i-1]['close'] and
                  current['close'] <= data.iloc[i-1]['open'] and
                  current_body >= previous_body * engulf_ratio):
                
                short_signals.iloc[i] = True
                signal_count += 1
        
        # Create exits
        long_exits = short_signals.copy()
        short_exits = long_signals.copy()
        
        # Time-based exits
        for i in range(len(long_signals)):
            if long_signals.iloc[i]:
                exit_idx = min(i + max_hold_periods, len(long_signals) - 1)
                if not any(short_signals.iloc[i+1:exit_idx+1]):
                    long_exits.iloc[exit_idx] = True
        
        for i in range(len(short_signals)):
            if short_signals.iloc[i]:
                exit_idx = min(i + max_hold_periods, len(short_signals) - 1)
                if not any(long_signals.iloc[i+1:exit_idx+1]):
                    short_exits.iloc[exit_idx] = True
        
        if long_signals.sum() == 0 and short_signals.sum() == 0:
            return None
        
        # Backtest
        try:
            portfolio = vbt.Portfolio.from_signals(
                close=data['close'],
                entries=long_signals, exits=long_exits,
                short_entries=short_signals, short_exits=short_exits,
                init_cash=10000, fees=0.001, freq='4h'
            )
            
            stats = portfolio.stats()
            
            return {
                'momentum_candles': momentum_candles,
                'total_return': stats['Total Return [%]'],
                'win_rate': stats['Win Rate [%]'],
                'total_trades': stats['Total Trades'],
                'sharpe_ratio': stats['Sharpe Ratio'],
                'max_drawdown': stats['Max Drawdown [%]'],
                'long_signals': long_signals.sum(),
                'short_signals': short_signals.sum()
            }
            
        except Exception as e:
            print(f"Error with {momentum_candles} candles: {e}")
            return None
    
    def optimize_momentum_candles(self, symbol='ETHUSDT', timeframe='4h', days=180):
        """Optimize the number of momentum candles"""
        
        print(f"🔧 OPTIMIZING MOMENTUM CANDLES for {symbol} {timeframe}")
        print("="*60)
        
        # Fetch data
        data = self.fetch_data(symbol, timeframe, days)
        if data is None:
            return
        
        # Test different momentum candle configurations
        momentum_configs = [
            {'momentum_candles': 1, 'name': '1-Candle (Simple Engulfing)'},
            {'momentum_candles': 2, 'name': '2-Candle Momentum'},
            {'momentum_candles': 3, 'name': '3-Candle Momentum'},
            {'momentum_candles': 4, 'name': '4-Candle Momentum'},
            {'momentum_candles': 5, 'name': '5-Candle Momentum'},
        ]
        
        # Parameter combinations to test
        parameter_sets = [
            {'min_momentum_pct': 0.01, 'engulf_ratio': 1.1, 'max_hold': 6},
            {'min_momentum_pct': 0.02, 'engulf_ratio': 1.2, 'max_hold': 8},
            {'min_momentum_pct': 0.03, 'engulf_ratio': 1.3, 'max_hold': 10},
        ]
        
        all_results = []
        
        for param_set in parameter_sets:
            print(f"\n📊 Testing parameter set: {param_set}")
            
            for config in momentum_configs:
                print(f"  🔍 Testing {config['name']}...")
                
                result = self.test_momentum_candles(
                    data=data.copy(),
                    momentum_candles=config['momentum_candles'],
                    min_momentum_pct=param_set['min_momentum_pct'],
                    engulf_ratio=param_set['engulf_ratio'],
                    max_hold_periods=param_set['max_hold']
                )
                
                if result:
                    result['config_name'] = config['name']
                    result['param_set'] = param_set
                    all_results.append(result)
                    
                    print(f"    📈 Return: {result['total_return']:+.2f}% | "
                          f"🎯 Win Rate: {result['win_rate']:.1f}% | "
                          f"📊 Trades: {result['total_trades']} | "
                          f"⚡ Sharpe: {result['sharpe_ratio']:.2f}")
                else:
                    print(f"    ❌ No signals generated")
        
        return all_results
    
    def analyze_optimization_results(self, results):
        """Analyze and display optimization results"""
        if not results:
            print("❌ No results to analyze")
            return
        
        print(f"\n{'='*80}")
        print("📊 MOMENTUM CANDLE OPTIMIZATION RESULTS")
        print(f"{'='*80}")
        
        # Sort by total return
        results_sorted = sorted(results, key=lambda x: x['total_return'], reverse=True)
        
        print(f"\n🏆 TOP PERFORMERS (by Total Return):")
        print("-" * 100)
        print(f"{'Rank':<4} {'Config':<25} {'Return':<10} {'Win Rate':<10} {'Trades':<8} {'Sharpe':<8} {'Signals':<12}")
        print("-" * 100)
        
        for i, result in enumerate(results_sorted[:10], 1):  # Top 10
            signals_str = f"{result['long_signals']}L/{result['short_signals']}S"
            print(f"{i:<4} {result['config_name']:<25} {result['total_return']:+7.2f}% "
                  f"{result['win_rate']:6.1f}%   {result['total_trades']:<8} "
                  f"{result['sharpe_ratio']:6.2f}  {signals_str:<12}")
        
        # Analysis by momentum candles
        print(f"\n📈 ANALYSIS BY MOMENTUM CANDLES:")
        print("-" * 60)
        
        for candles in [1, 2, 3, 4, 5]:
            candle_results = [r for r in results if r['momentum_candles'] == candles]
            if candle_results:
                avg_return = np.mean([r['total_return'] for r in candle_results])
                avg_win_rate = np.mean([r['win_rate'] for r in candle_results])
                best_return = max([r['total_return'] for r in candle_results])
                
                print(f"{candles}-Candle: Avg Return: {avg_return:+6.2f}% | "
                      f"Avg Win Rate: {avg_win_rate:5.1f}% | "
                      f"Best Return: {best_return:+6.2f}%")
        
        # Best overall configuration
        best_config = results_sorted[0]
        print(f"\n🎯 OPTIMAL CONFIGURATION:")
        print(f"{'='*50}")
        print(f"🕯️  Momentum Candles: {best_config['momentum_candles']}")
        print(f"📈 Total Return: {best_config['total_return']:+.2f}%")
        print(f"🎯 Win Rate: {best_config['win_rate']:.1f}%")
        print(f"📊 Total Trades: {best_config['total_trades']}")
        print(f"⚡ Sharpe Ratio: {best_config['sharpe_ratio']:.2f}")
        print(f"📉 Max Drawdown: {best_config['max_drawdown']:.2f}%")
        print(f"🔧 Parameters: {best_config['param_set']}")
        
        # Count profitable configurations
        profitable = [r for r in results if r['total_return'] > 0]
        print(f"\n💰 PROFITABLE CONFIGS: {len(profitable)}/{len(results)} ({len(profitable)/len(results)*100:.1f}%)")
        
        if profitable:
            # Best momentum candle count
            momentum_counts = {}
            for result in profitable:
                candles = result['momentum_candles']
                if candles not in momentum_counts:
                    momentum_counts[candles] = []
                momentum_counts[candles].append(result['total_return'])
            
            print(f"\n🔍 PROFITABLE MOMENTUM CANDLE ANALYSIS:")
            for candles, returns in momentum_counts.items():
                avg_return = np.mean(returns)
                count = len(returns)
                print(f"   {candles}-Candle: {count} profitable configs, avg return: {avg_return:+.2f}%")
        
        return best_config

def main():
    optimizer = MomentumCandleOptimizer()
    
    print("🔧 MOMENTUM CANDLE OPTIMIZATION")
    print("Finding the optimal number of momentum candles!")
    
    # Test on ETH 4H (our best performing combination so far)
    results = optimizer.optimize_momentum_candles('ETHUSDT', '4h', 180)
    
    if results:
        best_config = optimizer.analyze_optimization_results(results)
        
        print(f"\n💡 RECOMMENDATION:")
        if best_config['total_return'] > 0:
            print(f"✅ Use {best_config['momentum_candles']}-candle momentum for optimal performance!")
            print(f"   Expected return: {best_config['total_return']:+.2f}%")
            print(f"   Expected win rate: {best_config['win_rate']:.1f}%")
        else:
            print(f"⚠️  Strategy needs further refinement")
        
        # Test on BTC for validation
        print(f"\n🔄 VALIDATING on BTC...")
        btc_results = optimizer.optimize_momentum_candles('BTCUSDT', '4h', 180)
        if btc_results:
            btc_best = sorted(btc_results, key=lambda x: x['total_return'], reverse=True)[0]
            print(f"BTC Best: {btc_best['momentum_candles']}-candle, {btc_best['total_return']:+.2f}% return")

if __name__ == "__main__":
    main()

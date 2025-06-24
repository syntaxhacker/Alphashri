#!/usr/bin/env python3
"""
🕐 TATAMOTORS 15-MINUTE OPTIMIZER

Specialized for intraday trading with:
- 15-minute timeframe simulation
- More trading opportunities
- Realistic intraday patterns
- Beautiful visualizations
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from tatamotors_beautiful_eda import TATAMOTORSBeautifulEDA

class TATAMOTORS15MinOptimizer:
    def __init__(self):
        self.eda = TATAMOTORSBeautifulEDA()
    
    def optimize_15min_strategy(self):
        """Optimize TATAMOTORS strategy on 15-minute data"""
        print("🚀 TATAMOTORS 15-MINUTE STRATEGY OPTIMIZATION")
        print("="*60)
        
        # Load daily data
        daily_data = self.eda.load_data()
        
        # Create 15-minute simulation
        intraday_data = self.eda.create_15min_data('2023-01-01', '2024-06-28')
        
        # Test multiple configurations for more trades
        configs = [
            # Ultra-aggressive for maximum trades
            {'momentum_candles': 1, 'min_momentum_pct': 0.05, 'engulf_ratio': 1.01, 'name': 'Ultra-Aggressive'},
            # Aggressive but with some filtering
            {'momentum_candles': 2, 'min_momentum_pct': 0.1, 'engulf_ratio': 1.03, 'name': 'Aggressive'},
            # Balanced approach
            {'momentum_candles': 2, 'min_momentum_pct': 0.15, 'engulf_ratio': 1.05, 'name': 'Balanced'},
            # Conservative but still active
            {'momentum_candles': 3, 'min_momentum_pct': 0.2, 'engulf_ratio': 1.08, 'name': 'Conservative'},
            # Very selective
            {'momentum_candles': 3, 'min_momentum_pct': 0.3, 'engulf_ratio': 1.1, 'name': 'Selective'},
        ]
        
        results = []
        
        for config in configs:
            print(f"\n🔍 Testing {config['name']} configuration...")
            print(f"   Parameters: {config['momentum_candles']} candles, {config['min_momentum_pct']}% momentum, {config['engulf_ratio']} engulf ratio")
            
            # Generate signals
            signals = self.eda.generate_signals(
                intraday_data, 
                momentum_candles=config['momentum_candles'],
                min_momentum_pct=config['min_momentum_pct'],
                engulf_ratio=config['engulf_ratio']
            )
            
            # Backtest
            portfolio, trades = self.eda.backtest_strategy(intraday_data, signals)
            
            # Calculate metrics
            num_trades = len(trades[trades['action'] == 'SELL'])
            if num_trades > 0:
                total_return = (portfolio['total_value'].iloc[-1] / portfolio['total_value'].iloc[0] - 1) * 100
                win_trades = trades[trades['action'] == 'SELL'][trades[trades['action'] == 'SELL']['return_pct'] > 0]
                win_rate = len(win_trades) / num_trades * 100
                avg_return = trades[trades['action'] == 'SELL']['return_pct'].mean()
                
                # Risk metrics
                returns = portfolio['returns'].dropna()
                if len(returns) > 0:
                    volatility = returns.std() * np.sqrt(252 * 26) * 100  # Annualized
                    sharpe_ratio = (total_return / volatility) if volatility > 0 else 0
                    
                    # Max drawdown
                    rolling_max = portfolio['total_value'].expanding().max()
                    drawdown = (portfolio['total_value'] / rolling_max - 1) * 100
                    max_drawdown = drawdown.min()
                else:
                    volatility = sharpe_ratio = max_drawdown = 0
                
                result = {
                    'config': config['name'],
                    'total_return': total_return,
                    'num_trades': num_trades,
                    'win_rate': win_rate,
                    'avg_return': avg_return,
                    'sharpe_ratio': sharpe_ratio,
                    'max_drawdown': max_drawdown,
                    'signals': signals,
                    'portfolio': portfolio,
                    'trades': trades
                }
                
                results.append(result)
                
                print(f"   ✅ Results: {total_return:+.2f}% return, {num_trades} trades, {win_rate:.1f}% win rate")
            else:
                print(f"   ❌ No trades generated")
        
        return results, intraday_data
    
    def analyze_results(self, results):
        """Analyze and rank the results"""
        if not results:
            print("❌ No results to analyze")
            return None
        
        print(f"\n{'='*80}")
        print("📊 TATAMOTORS 15-MINUTE OPTIMIZATION RESULTS")
        print(f"{'='*80}")
        
        # Sort by a composite score (return * trades * win_rate)
        for result in results:
            # Composite score favoring strategies with good returns and sufficient trades
            trades_factor = min(result['num_trades'] / 10, 1.0)  # Cap at 10 trades
            result['composite_score'] = result['total_return'] * trades_factor * (result['win_rate'] / 100)
        
        results_sorted = sorted(results, key=lambda x: x['composite_score'], reverse=True)
        
        print(f"\n🏆 RANKING BY COMPOSITE SCORE (Return × Trade Frequency × Win Rate):")
        print("-" * 90)
        print(f"{'Rank':<4} {'Config':<15} {'Return':<10} {'Trades':<8} {'Win Rate':<10} {'Avg/Trade':<10} {'Score':<8}")
        print("-" * 90)
        
        for i, result in enumerate(results_sorted, 1):
            print(f"{i:<4} {result['config']:<15} {result['total_return']:+7.2f}% "
                  f"{result['num_trades']:<8} {result['win_rate']:7.1f}% "
                  f"{result['avg_return']:+7.2f}% {result['composite_score']:7.2f}")
        
        # Find best by different criteria
        best_return = max(results, key=lambda x: x['total_return'])
        best_trades = max(results, key=lambda x: x['num_trades'])
        best_winrate = max(results, key=lambda x: x['win_rate'])
        best_composite = results_sorted[0]
        
        print(f"\n🎯 BEST BY DIFFERENT CRITERIA:")
        print(f"   Best Return:     {best_return['config']} ({best_return['total_return']:+.2f}%)")
        print(f"   Most Trades:     {best_trades['config']} ({best_trades['num_trades']} trades)")
        print(f"   Best Win Rate:   {best_winrate['config']} ({best_winrate['win_rate']:.1f}%)")
        print(f"   Best Composite:  {best_composite['config']} (Score: {best_composite['composite_score']:.2f})")
        
        return best_composite

def main():
    """Run complete 15-minute optimization and visualization"""
    optimizer = TATAMOTORS15MinOptimizer()
    
    # Run optimization
    results, intraday_data = optimizer.optimize_15min_strategy()
    
    if results:
        # Analyze results
        best_config = optimizer.analyze_results(results)
        
        if best_config and best_config['num_trades'] >= 3:
            print(f"\n🎨 Creating beautiful charts for best configuration: {best_config['config']}")
            
            # Create beautiful charts with the best configuration
            fig = optimizer.eda.create_beautiful_charts(
                intraday_data,
                best_config['signals'],
                best_config['portfolio'],
                'tatamotors_15min_analysis.html'
            )
            
            # Performance summary
            optimizer.eda.portfolio_values = best_config['portfolio']
            optimizer.eda.trades = best_config['trades']
            performance = optimizer.eda.create_performance_summary()
            
            print(f"\n🎉 ANALYSIS COMPLETE!")
            print(f"📊 Interactive chart saved: tatamotors_15min_analysis.html")
            print(f"🌐 Open the HTML file in your browser to see beautiful visualizations!")
            
        else:
            print(f"\n⚠️ Best configuration has insufficient trades for visualization")
            print(f"   Consider relaxing parameters for more trading opportunities")
    
    else:
        print(f"\n❌ No successful configurations found")
        print(f"   Try adjusting parameters or different time periods")

if __name__ == "__main__":
    main() 
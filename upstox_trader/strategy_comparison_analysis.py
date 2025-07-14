#!/usr/bin/env python3
"""
Strategy Comparison Analysis - The Ultimate Reality Check
========================================================

This script compares different trading strategies and backtesting methods:
1. Traditional OHLC Backtesting (Breakout Strategy)
2. Realistic 1-minute Backtesting (Breakout Strategy)  
3. Conservative Momentum Strategy (OHLC)
4. Conservative Momentum Strategy (Realistic)

KEY INSIGHTS:
- Shows the gap between backtesting and real-world trading
- Demonstrates why most backtesting is overly optimistic
- Provides framework for realistic strategy development
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time
import warnings
warnings.filterwarnings('ignore')

# Import strategy modules
from vectorbt_breakout_backtester import BreakoutStrategyBacktester
from realistic_breakout_backtester import RealisticBreakoutBacktester
from conservative_momentum_strategy import ConservativeMomentumStrategy

class StrategyComparisonAnalyzer:
    """Comprehensive analysis comparing different strategies and backtesting methods"""
    
    def __init__(self):
        self.test_symbol = 'COCHINSHIP'  # Our focus stock
        self.test_period = '3mo'         # 3 months for faster testing
        self.results = {}
        
        print("🔬 Strategy Comparison Analyzer Initialized")
        print("📊 Comparing: OHLC vs Realistic vs Conservative approaches")
        print(f"🎯 Test Symbol: {self.test_symbol}")
        print(f"📅 Test Period: {self.test_period}")
    
    def run_comprehensive_analysis(self):
        """Run all strategy comparisons"""
        print("\n" + "="*80)
        print("🔬 COMPREHENSIVE STRATEGY & BACKTESTING ANALYSIS")
        print("="*80)
        
        # Test 1: Traditional OHLC Breakout Strategy
        print("\n🔸 TEST 1: Traditional OHLC Breakout Strategy (15-minute)")
        try:
            breakout_backtester = BreakoutStrategyBacktester()
            ohlc_results = breakout_backtester.run_comprehensive_backtest(
                [self.test_symbol], period=self.test_period, interval='15m'
            )
            if ohlc_results and ohlc_results['results']:
                self.results['ohlc_breakout'] = ohlc_results['results'][0]
                self.print_result_summary("OHLC Breakout (15min)", self.results['ohlc_breakout'])
            else:
                print("❌ OHLC Breakout test failed")
        except Exception as e:
            print(f"❌ OHLC Breakout error: {e}")
        
        # Test 2: Realistic 1-minute Breakout Strategy
        print("\n🔸 TEST 2: Realistic 1-minute Breakout Strategy")
        try:
            realistic_backtester = RealisticBreakoutBacktester()
            realistic_result = realistic_backtester.run_realistic_backtest(
                self.test_symbol, days=90  # 3 months
            )
            if realistic_result:
                self.results['realistic_breakout'] = realistic_result
                self.print_realistic_result_summary("Realistic Breakout (1min)", realistic_result)
            else:
                print("❌ Realistic Breakout test failed")
        except Exception as e:
            print(f"❌ Realistic Breakout error: {e}")
        
        # Test 3: Conservative Momentum Strategy (OHLC)
        print("\n🔸 TEST 3: Conservative Momentum Strategy (15-minute OHLC)")
        try:
            # Temporarily relax conservative parameters for testing
            conservative_strategy = ConservativeMomentumStrategy()
            # Override with more relaxed parameters
            conservative_strategy.strategy_params.update({
                'trend_strength_min': 0.8,
                'rsi_min': 55,
                'rsi_steady_periods': 2,
                'volume_ratio_min': 1.3,
                'volume_consistency': 2,
                'macd_bullish_periods': 2,
                'price_above_sma_periods': 2
            })
            
            conservative_results = conservative_strategy.run_comprehensive_backtest(
                [self.test_symbol], period=self.test_period, interval='15m'
            )
            if conservative_results and conservative_results['results']:
                self.results['conservative_ohlc'] = conservative_results['results'][0]
                self.print_result_summary("Conservative OHLC (15min)", self.results['conservative_ohlc'])
            else:
                print("❌ Conservative OHLC test failed - likely no signals generated")
        except Exception as e:
            print(f"❌ Conservative OHLC error: {e}")
        
        # Generate comparative analysis
        self.generate_comparative_analysis()
        
        return self.results
    
    def print_result_summary(self, strategy_name, result):
        """Print summary for standard backtest results"""
        print(f"✅ {strategy_name}:")
        print(f"   📈 Return: {result['total_return']:.1f}%")
        print(f"   📊 Sharpe: {result['sharpe_ratio']:.2f}")
        print(f"   📉 Drawdown: {result['max_drawdown']:.1f}%")
        print(f"   🎯 Win Rate: {result['win_rate']:.1f}%")
        print(f"   📋 Trades: {result['total_trades']}")
        if 'avg_trade_return' in result:
            print(f"   💰 Avg Trade: {result['avg_trade_return']:.2f}%")
    
    def print_realistic_result_summary(self, strategy_name, result):
        """Print summary for realistic backtest results"""
        print(f"✅ {strategy_name}:")
        print(f"   📈 Return: {result['total_return']:.1f}%")
        print(f"   📊 Sharpe: {result['sharpe_ratio']:.2f}")
        print(f"   📉 Drawdown: {result['max_drawdown']:.1f}%")
        print(f"   🎯 Win Rate: {result['win_rate']:.1f}%")
        print(f"   📋 Trades: {result['total_trades']}")
        if 'avg_trade_duration_minutes' in result:
            print(f"   ⏱️ Avg Duration: {result['avg_trade_duration_minutes']:.1f} minutes")
        if 'max_consecutive_losses' in result:
            print(f"   📉 Max Consecutive Losses: {result['max_consecutive_losses']}")
    
    def generate_comparative_analysis(self):
        """Generate detailed comparative analysis"""
        print("\n" + "="*80)
        print("📊 COMPARATIVE ANALYSIS RESULTS")
        print("="*80)
        
        if not self.results:
            print("❌ No results to compare")
            return
        
        # Create comparison table
        comparison_data = []
        
        for strategy_name, result in self.results.items():
            comparison_data.append({
                'Strategy': self.format_strategy_name(strategy_name),
                'Return %': f"{result['total_return']:.1f}%",
                'Sharpe': f"{result['sharpe_ratio']:.2f}",
                'Drawdown %': f"{result['max_drawdown']:.1f}%",
                'Win Rate %': f"{result['win_rate']:.1f}%",
                'Trades': int(result['total_trades']),
                'Avg Duration': self.get_avg_duration(result)
            })
        
        if comparison_data:
            df = pd.DataFrame(comparison_data)
            print(df.to_string(index=False))
            
            # Key insights
            print("\n🔍 KEY INSIGHTS:")
            
            # Compare OHLC vs Realistic if both exist
            if 'ohlc_breakout' in self.results and 'realistic_breakout' in self.results:
                ohlc = self.results['ohlc_breakout']
                realistic = self.results['realistic_breakout']
                
                return_diff = realistic['total_return'] - ohlc['total_return']
                trade_diff = realistic['total_trades'] - ohlc['total_trades']
                
                print(f"📈 OHLC vs Realistic Breakout Difference:")
                print(f"   • Return Difference: {return_diff:+.1f}% (Realistic vs OHLC)")
                print(f"   • Trade Count Difference: {trade_diff:+.0f} trades")
                print(f"   • Reality Check: {abs(return_diff):.1f}% performance gap!")
                
                if return_diff < -50:
                    print("   🚨 CRITICAL: Realistic model shows MASSIVE underperformance!")
                    print("   💡 This demonstrates why OHLC backtesting is misleading")
                elif return_diff < -10:
                    print("   ⚠️ WARNING: Significant performance gap between backtest and reality")
                elif return_diff < 0:
                    print("   📊 Moderate performance gap - realistic model more conservative")
                else:
                    print("   ✅ Realistic model performance comparable to OHLC")
            
            # Analyze strategy effectiveness
            best_return = max([r['total_return'] for r in self.results.values()])
            best_strategy = [name for name, r in self.results.items() if r['total_return'] == best_return][0]
            
            best_sharpe = max([r['sharpe_ratio'] for r in self.results.values() if r['sharpe_ratio'] is not None])
            best_sharpe_strategy = [name for name, r in self.results.items() 
                                   if r['sharpe_ratio'] == best_sharpe][0]
            
            print(f"\n🏆 PERFORMANCE ANALYSIS:")
            print(f"   • Best Return: {self.format_strategy_name(best_strategy)} ({best_return:.1f}%)")
            print(f"   • Best Risk-Adjusted: {self.format_strategy_name(best_sharpe_strategy)} (Sharpe: {best_sharpe:.2f})")
            
            # Trading frequency analysis
            trade_counts = [r['total_trades'] for r in self.results.values()]
            avg_trades = np.mean(trade_counts)
            print(f"   • Average Trades Across Strategies: {avg_trades:.0f}")
            
            if avg_trades > 100:
                print("   📊 High-frequency trading approach")
            elif avg_trades > 50:
                print("   📈 Moderate trading frequency")
            else:
                print("   🎯 Low-frequency, selective trading")
        
        # Generate recommendations
        self.generate_recommendations()
    
    def format_strategy_name(self, strategy_name):
        """Format strategy names for display"""
        name_map = {
            'ohlc_breakout': 'OHLC Breakout (15m)',
            'realistic_breakout': 'Realistic Breakout (1m)',
            'conservative_ohlc': 'Conservative Momentum (15m)',
            'conservative_realistic': 'Conservative Realistic (1m)'
        }
        return name_map.get(strategy_name, strategy_name)
    
    def get_avg_duration(self, result):
        """Get average trade duration"""
        if 'avg_trade_duration_minutes' in result:
            duration_mins = result['avg_trade_duration_minutes']
            if duration_mins < 60:
                return f"{duration_mins:.0f}m"
            elif duration_mins < 1440:  # Less than a day
                return f"{duration_mins/60:.1f}h"
            else:
                return f"{duration_mins/1440:.1f}d"
        else:
            return "15m+"  # OHLC minimum
    
    def generate_recommendations(self):
        """Generate trading recommendations based on analysis"""
        print("\n💡 STRATEGIC RECOMMENDATIONS:")
        print("="*50)
        
        if not self.results:
            print("❌ Insufficient data for recommendations")
            return
        
        # Analyze if any strategy is profitable
        profitable_strategies = [name for name, result in self.results.items() 
                               if result['total_return'] > 0]
        
        if not profitable_strategies:
            print("🚨 CRITICAL FINDING: No profitable strategies!")
            print("📊 Recommendations:")
            print("   1. Market conditions may be unfavorable for these strategies")
            print("   2. Consider testing in different market regimes")
            print("   3. Focus on capital preservation strategies")
            print("   4. Implement strict position sizing and risk management")
            
        else:
            print("✅ Profitable strategies found:")
            for strategy in profitable_strategies:
                result = self.results[strategy]
                print(f"   • {self.format_strategy_name(strategy)}: {result['total_return']:.1f}%")
            
            # Risk-adjusted recommendations
            good_sharpe = [name for name, result in self.results.items() 
                          if result['sharpe_ratio'] is not None and result['sharpe_ratio'] > 1.0]
            
            if good_sharpe:
                print(f"\n🎯 Risk-Adjusted Winners (Sharpe > 1.0):")
                for strategy in good_sharpe:
                    result = self.results[strategy]
                    print(f"   • {self.format_strategy_name(strategy)}: Sharpe {result['sharpe_ratio']:.2f}")
        
        # Implementation recommendations
        print("\n🔧 IMPLEMENTATION RECOMMENDATIONS:")
        
        if 'realistic_breakout' in self.results:
            realistic = self.results['realistic_breakout']
            print(f"   1. Real-world trading should expect ~{realistic['total_return']:.1f}% returns")
            print(f"   2. Average trade duration: {realistic.get('avg_trade_duration_minutes', 0):.0f} minutes")
            print(f"   3. Win rate will likely be ~{realistic['win_rate']:.1f}%")
        
        print("   4. Use realistic backtesting for strategy development")
        print("   5. Account for slippage, fees, and execution delays")
        print("   6. Test across multiple market conditions")
        print("   7. Implement robust risk management")
        
        # Save analysis
        self.save_analysis_report()
    
    def save_analysis_report(self):
        """Save comprehensive analysis to file"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"strategy_comparison_analysis_{timestamp}.txt"
            
            with open(filename, 'w') as f:
                f.write("STRATEGY COMPARISON ANALYSIS REPORT\n")
                f.write("="*50 + "\n")
                f.write(f"Generated: {datetime.now().isoformat()}\n")
                f.write(f"Test Symbol: {self.test_symbol}\n")
                f.write(f"Test Period: {self.test_period}\n\n")
                
                f.write("RESULTS SUMMARY:\n")
                f.write("-"*30 + "\n")
                
                for strategy_name, result in self.results.items():
                    f.write(f"\n{self.format_strategy_name(strategy_name)}:\n")
                    f.write(f"  Return: {result['total_return']:.1f}%\n")
                    f.write(f"  Sharpe: {result['sharpe_ratio']:.2f}\n")
                    f.write(f"  Drawdown: {result['max_drawdown']:.1f}%\n")
                    f.write(f"  Win Rate: {result['win_rate']:.1f}%\n")
                    f.write(f"  Trades: {result['total_trades']}\n")
                
                f.write(f"\nKEY INSIGHT: OHLC vs Realistic Backtesting Gap\n")
                if 'ohlc_breakout' in self.results and 'realistic_breakout' in self.results:
                    gap = self.results['realistic_breakout']['total_return'] - self.results['ohlc_breakout']['total_return']
                    f.write(f"Performance Gap: {gap:.1f}%\n")
                    f.write("This demonstrates the importance of realistic backtesting.\n")
            
            print(f"📄 Analysis report saved: {filename}")
            
        except Exception as e:
            print(f"❌ Error saving report: {e}")

def main():
    """Run comprehensive strategy comparison"""
    print("🔬 Starting Comprehensive Strategy Comparison Analysis")
    print("="*60)
    
    analyzer = StrategyComparisonAnalyzer()
    results = analyzer.run_comprehensive_analysis()
    
    print("\n✅ Comprehensive analysis completed!")
    print("📊 This analysis reveals the critical differences between:")
    print("   • Traditional OHLC backtesting")
    print("   • Realistic 1-minute simulation")
    print("   • Conservative vs aggressive strategies")
    print("\n💡 Use these insights to build strategies that work in real trading!")

if __name__ == "__main__":
    main()
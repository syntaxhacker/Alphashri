#!/usr/bin/env python3
"""
Test VectorBT Breakout Backtester with COCHINSHIP
"""

from vectorbt_breakout_backtester import BreakoutStrategyBacktester

def test_cochinship_breakout():
    print("🚀 Testing VectorBT Breakout Backtester with COCHINSHIP")
    print("=" * 60)
    
    # Initialize backtester
    backtester = BreakoutStrategyBacktester()
    
    # Test with COCHINSHIP only
    test_symbols = ['COCHINSHIP']
    
    print(f"📊 Testing {len(test_symbols)} symbols: {', '.join(test_symbols)}")
    print(f"🎯 Strategy: Breakout Detection + Support/Resistance Levels")
    print(f"📅 Period: 1 year, 15-minute timeframe")
    print(f"🔍 Patterns: Resistance breakouts, Support bounces")
    print(f"📈 Technical: RSI, ATR, Volume confirmation")
    
    # Run comprehensive backtest - 1 year with 15-minute timeframe
    results = backtester.run_comprehensive_backtest(test_symbols, period='1y', interval='15m')
    
    if results:
        print("\\n✅ Backtest completed successfully!")
        
        # Save results
        backtester.save_backtest_results(results)
        
        # Generate single comprehensive EDA report using ECharts
        print("🎨 Generating comprehensive ECharts analysis...")
        from echarts_eda_analyzer import EChartsEDAAnalyzer
        eda_analyzer = EChartsEDAAnalyzer()
        report_path = eda_analyzer.generate_single_report(results)
        
        print("📊 Check the generated files for detailed analysis")
        print("💡 Files generated:")
        print("   - breakout_backtest_results_*_summary.csv")
        if report_path:
            print(f"   - {report_path} (Single comprehensive report with ECharts)")
        
        # Print detailed summary
        print("\\n" + "=" * 60)
        print("📈 COCHINSHIP BREAKOUT STRATEGY RESULTS")
        print("=" * 60)
        
        for result in results['results']:
            print(f"Symbol: {result['symbol']}")
            print(f"📈 Total Return: {result['total_return']:.1f}%")
            print(f"📊 Sharpe Ratio: {result['sharpe_ratio']:.2f}")
            print(f"📉 Max Drawdown: {result['max_drawdown']:.1f}%")
            print(f"🎯 Win Rate: {result['win_rate']:.1f}%")
            print(f"📋 Total Trades: {result['total_trades']}")
            
            # Analyze breakout patterns
            if 'signals' in result:
                signals = result['signals']
                resistance_breakouts = signals['resistance_breakout'].sum()
                support_bounces = signals['support_bounce'].sum()
                total_entries = signals['entries'].sum()
                
                print(f"\\n🔍 Signal Analysis:")
                print(f"   • Total Entry Signals: {total_entries}")
                print(f"   • Resistance Breakouts: {resistance_breakouts}")
                print(f"   • Support Bounces: {support_bounces}")
                print(f"   • Signal Success Rate: {(result['win_rate']/100):.1%}")
        
        print("\\n💡 Strategy Notes:")
        print("   • Breakout strategy focuses on momentum + volume confirmation")
        print("   • Combines resistance breakouts and support bounces")
        print("   • Uses ATR-based position sizing and risk management")
        print("   • 15-minute timeframe captures intraday momentum")
        
    else:
        print("❌ Backtest failed")

if __name__ == "__main__":
    test_cochinship_breakout()
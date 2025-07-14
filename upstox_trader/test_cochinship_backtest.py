#!/usr/bin/env python3
"""
Test VectorBT Backtester with COCHINSHIP
"""

from vectorbt_volume_backtester import VolumeStrategyBacktester

def test_cochinship():
    print("🚀 Testing VectorBT Backtester with COCHINSHIP")
    print("=" * 60)
    
    # Initialize backtester
    backtester = VolumeStrategyBacktester()
    
    # Test with COCHINSHIP only
    test_symbols = ['COCHINSHIP']
    
    print(f"📊 Testing {len(test_symbols)} symbols: {', '.join(test_symbols)}")
    print(f"🎯 Strategy: Volume Momentum + Technical Indicators")
    print(f"📅 Period: 1 year, 15-minute timeframe")
    
    # Run comprehensive backtest - 1 year with 15-minute timeframe
    results = backtester.run_comprehensive_backtest(test_symbols, period='1y', interval='15m')
    
    if results:
        print("\n✅ Backtest completed successfully!")
        
        # Save results
        backtester.save_backtest_results(results)
        
        # Generate single comprehensive EDA report using ECharts
        print("🎨 Generating comprehensive ECharts analysis...")
        from echarts_eda_analyzer import EChartsEDAAnalyzer
        eda_analyzer = EChartsEDAAnalyzer()
        report_path = eda_analyzer.generate_single_report(results)
        
        print("📊 Check the generated files for detailed analysis")
        print("💡 Files generated:")
        print("   - volume_backtest_results_*_summary.csv")
        if report_path:
            print(f"   - {report_path} (Single comprehensive report with ECharts)")
        
    else:
        print("❌ Backtest failed")

if __name__ == "__main__":
    test_cochinship()
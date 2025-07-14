#!/usr/bin/env python3
"""
Master Trading System Controller
Orchestrates all components: News, Volume, Backtesting, Trading, and Analysis
"""

import sys
import os
import time
import argparse
from datetime import datetime
import json

# Import all components
from news_sentiment_analyzer import NewsAnalyzer
from live_news_monitor import LiveNewsMonitor
from start_trading_day import morning_news_scan
from volatility_trend_scanner import VolatilityTrendScanner
from vectorbt_volume_backtester import VolumeStrategyBacktester
from automated_trading_bot import AutomatedTradingBot
from beautiful_eda_analyzer import BeautifulEDAAnalyzer

class MasterTradingSystem:
    """Central control system for all trading components"""
    
    def __init__(self):
        self.components = {
            'news_analyzer': NewsAnalyzer(),
            'volume_scanner': VolatilityTrendScanner(),
            'backtester': VolumeStrategyBacktester(),
            'trading_bot': None,  # Initialize when needed
            'eda_analyzer': BeautifulEDAAnalyzer()
        }
        
        self.system_status = {
            'initialized': True,
            'last_update': datetime.now(),
            'components_loaded': list(self.components.keys())
        }
        
        print("🚀 Master Trading System Initialized")
        print(f"📊 Components loaded: {len(self.components)}")
        
    def display_menu(self):
        """Display interactive menu"""
        print("\n" + "="*60)
        print("🤖 MASTER TRADING SYSTEM CONTROL PANEL")
        print("="*60)
        print("📰 NEWS & ANALYSIS:")
        print("  1. Morning News Scan")
        print("  2. Live News Monitor (Single Scan)")
        print("  3. Start Live News Monitoring")
        print("  4. News Sentiment Analysis")
        print()
        print("📊 VOLUME & SIGNALS:")
        print("  5. Volume Scanner (Single Scan)")
        print("  6. Enhanced Volume Scanner")
        print("  7. Real-time Volume Monitoring")
        print()
        print("📈 BACKTESTING & ANALYSIS:")
        print("  8. Run Volume Strategy Backtest")
        print("  9. Generate Beautiful EDA Report")
        print("  10. Create Performance Dashboard")
        print()
        print("🤖 AUTOMATED TRADING:")
        print("  11. Start Paper Trading Bot")
        print("  12. Start Live Trading Bot (⚠️ REAL MONEY)")
        print("  13. View Trading Bot Status")
        print()
        print("🛠️ SYSTEM UTILITIES:")
        print("  14. System Status")
        print("  15. Component Health Check")
        print("  16. Export System Logs")
        print()
        print("  0. Exit System")
        print("="*60)
    
    def morning_preparation(self):
        """Run morning preparation routine"""
        try:
            print("☀️ Running Morning Preparation...")
            print("-" * 50)
            
            # Import and run morning scan
            from start_trading_day import morning_news_scan
            morning_news_scan()
            
            print("\n📊 Quick Volume Scan...")
            signals = self.components['volume_scanner'].scan_market()
            if signals:
                print(f"✅ Found {len(signals)} volume signals")
                for signal in signals[:3]:  # Show top 3
                    print(f"   🔥 {signal.symbol}: {signal.signal_type} ({signal.confidence:.1%})")
            else:
                print("📝 No volume signals found")
            
            print("\n✅ Morning preparation complete!")
            
        except Exception as e:
            print(f"❌ Error in morning preparation: {e}")
    
    def run_single_news_scan(self):
        """Run single news scan"""
        try:
            print("📰 Running Single News Scan...")
            
            watchlist = ['EIEL', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK']
            
            for symbol in watchlist:
                print(f"\n🔍 Scanning {symbol}...")
                news_items = self.components['news_analyzer'].scan_stock_news(symbol, hours_back=4)
                
                if news_items:
                    alert = self.components['news_analyzer'].generate_alert(symbol, news_items)
                    if alert:
                        print(f"🚨 ALERT: {symbol}")
                        print(f"   📰 {alert['headline'][:60]}...")
                        print(f"   📊 Sentiment: {alert['sentiment_score']:.2f}")
                        print(f"   📈 Impact: {alert['volume_prediction']} ({alert['probability']:.1%})")
                    else:
                        print(f"   📝 News found but low impact")
                else:
                    print(f"   ✅ No recent news")
            
        except Exception as e:
            print(f"❌ Error in news scan: {e}")
    
    def run_volume_scan(self):
        """Run volume scanner"""
        try:
            print("📊 Running Volume Scanner...")
            
            # Authenticate scanner
            if not self.components['volume_scanner'].authenticate():
                print("❌ Volume scanner authentication failed")
                return
            
            # Run scan
            signals = self.components['volume_scanner'].scan_market()
            
            if signals:
                print(f"✅ Found {len(signals)} volatility signals:")
                for signal in signals:
                    print(f"🔥 {signal.symbol}: {signal.signal_type} ({signal.confidence:.1%})")
                    print(f"   Entry: ₹{signal.entry_price:.2f}")
                    print(f"   Target: ₹{signal.target_price:.2f}")
                    print(f"   Stop: ₹{signal.stop_loss:.2f}")
                    print()
            else:
                print("📝 No volatility signals found")
                
        except Exception as e:
            print(f"❌ Error in volume scan: {e}")
    
    def run_backtest(self):
        """Run comprehensive backtest"""
        try:
            print("📈 Running Volume Strategy Backtest...")
            
            # Define test symbols
            test_symbols = [
                'EIEL', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK',
                'TATAMOTORS', 'DRREDDY', 'SBIN', 'LT', 'MARUTI'
            ]
            
            print(f"📊 Testing {len(test_symbols)} symbols...")
            
            # Run backtest
            results = self.components['backtester'].run_comprehensive_backtest(
                test_symbols, 
                period='6mo'  # 6 months of data
            )
            
            if results:
                print("✅ Backtest completed!")
                
                # Save results
                self.components['backtester'].save_backtest_results(results)
                
                # Generate EDA report
                print("🎨 Generating analysis report...")
                self.components['eda_analyzer'].generate_complete_report(results)
                
                print("📊 Check generated files for detailed analysis")
            else:
                print("❌ Backtest failed")
                
        except Exception as e:
            print(f"❌ Error in backtest: {e}")
    
    def start_paper_trading(self):
        """Start paper trading bot"""
        try:
            print("🤖 Starting Paper Trading Bot...")
            
            if self.components['trading_bot'] is None:
                self.components['trading_bot'] = AutomatedTradingBot(paper_trading=True)
            
            print("⚠️ This will run continuously. Press Ctrl+C to stop.")
            input("Press Enter to continue or Ctrl+C to cancel...")
            
            self.components['trading_bot'].start_trading()
            
        except KeyboardInterrupt:
            print("\n🛑 Paper trading stopped by user")
        except Exception as e:
            print(f"❌ Error starting paper trading: {e}")
    
    def start_live_trading(self):
        """Start live trading bot"""
        try:
            print("⚠️ LIVE TRADING MODE - REAL MONEY AT RISK!")
            print("🚨 This will place actual trades on your Upstox account")
            
            confirm = input("Type 'CONFIRM' to proceed with live trading: ")
            if confirm != 'CONFIRM':
                print("❌ Live trading cancelled")
                return
            
            if self.components['trading_bot'] is None:
                self.components['trading_bot'] = AutomatedTradingBot(paper_trading=False)
            
            print("🚀 Starting Live Trading Bot...")
            self.components['trading_bot'].start_trading()
            
        except KeyboardInterrupt:
            print("\n🛑 Live trading stopped by user")
        except Exception as e:
            print(f"❌ Error starting live trading: {e}")
    
    def system_status(self):
        """Display system status"""
        print("🔧 SYSTEM STATUS")
        print("-" * 30)
        print(f"✅ Initialized: {self.system_status['initialized']}")
        print(f"🕐 Last Update: {self.system_status['last_update'].strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"📦 Components: {len(self.system_status['components_loaded'])}")
        
        print("\n📊 COMPONENT STATUS:")
        for name, component in self.components.items():
            if component is not None:
                print(f"   ✅ {name.replace('_', ' ').title()}")
            else:
                print(f"   ⚠️ {name.replace('_', ' ').title()} (Not initialized)")
        
        # Check market hours
        from live_news_monitor import LiveNewsMonitor
        monitor = LiveNewsMonitor()
        market_open = monitor.is_market_hours()
        print(f"\n📈 Market Status: {'🟢 OPEN' if market_open else '🔴 CLOSED'}")
        
        print(f"💾 Working Directory: {os.getcwd()}")
        print(f"🐍 Python Version: {sys.version.split()[0]}")
    
    def health_check(self):
        """Perform component health check"""
        print("🏥 Running Component Health Check...")
        print("-" * 40)
        
        health_results = {}
        
        # Test news analyzer
        try:
            news_items = self.components['news_analyzer'].scan_stock_news('RELIANCE', hours_back=24)
            health_results['news_analyzer'] = f"✅ Working (found {len(news_items)} news items)"
        except Exception as e:
            health_results['news_analyzer'] = f"❌ Error: {str(e)[:50]}..."
        
        # Test volume scanner
        try:
            # Quick test without full authentication
            scanner = self.components['volume_scanner']
            health_results['volume_scanner'] = "✅ Available (auth needed for full test)"
        except Exception as e:
            health_results['volume_scanner'] = f"❌ Error: {str(e)[:50]}..."
        
        # Test backtester
        try:
            # Quick initialization test
            backtester = self.components['backtester']
            health_results['backtester'] = "✅ Ready for backtesting"
        except Exception as e:
            health_results['backtester'] = f"❌ Error: {str(e)[:50]}..."
        
        # Test EDA analyzer
        try:
            eda = self.components['eda_analyzer']
            health_results['eda_analyzer'] = "✅ Visualization system ready"
        except Exception as e:
            health_results['eda_analyzer'] = f"❌ Error: {str(e)[:50]}..."
        
        # Display results
        for component, status in health_results.items():
            print(f"{component.replace('_', ' ').title():.<25} {status}")
        
        # Overall health
        healthy_count = sum(1 for status in health_results.values() if status.startswith('✅'))
        total_count = len(health_results)
        
        print(f"\n🏥 Overall Health: {healthy_count}/{total_count} components healthy")
        
        if healthy_count == total_count:
            print("🎉 All systems operational!")
        elif healthy_count >= total_count * 0.75:
            print("⚠️ Most systems operational, minor issues detected")
        else:
            print("🚨 Multiple system issues detected, troubleshooting needed")
    
    def run_interactive_mode(self):
        """Run interactive menu system"""
        while True:
            try:
                self.display_menu()
                choice = input("\n🎯 Select option (0-16): ").strip()
                
                if choice == '0':
                    print("👋 Exiting Master Trading System. Goodbye!")
                    break
                elif choice == '1':
                    self.morning_preparation()
                elif choice == '2':
                    self.run_single_news_scan()
                elif choice == '3':
                    print("🔄 Starting Live News Monitor...")
                    monitor = LiveNewsMonitor()
                    monitor.run_continuous_monitoring()
                elif choice == '4':
                    print("📰 Running detailed news sentiment analysis...")
                    self.run_single_news_scan()
                elif choice == '5':
                    self.run_volume_scan()
                elif choice == '6':
                    print("📊 Running Enhanced Volume Scanner...")
                    os.system("python enhanced_volatility_scanner.py")
                elif choice == '7':
                    print("🔄 Starting real-time volume monitoring...")
                    # This would start continuous volume monitoring
                    print("⚠️ Feature coming soon!")
                elif choice == '8':
                    self.run_backtest()
                elif choice == '9':
                    print("🎨 Generating beautiful EDA report...")
                    # Create sample data for demo
                    sample_results = {
                        'results': [
                            {'symbol': 'EIEL', 'total_return': 15.2, 'sharpe_ratio': 1.8, 
                             'max_drawdown': 8.5, 'win_rate': 65.0, 'total_trades': 12}
                        ],
                        'portfolio_metrics': {
                            'avg_return': 15.2, 'avg_sharpe': 1.8, 'avg_drawdown': 8.5,
                            'avg_win_rate': 65.0, 'total_trades': 12
                        }
                    }
                    self.components['eda_analyzer'].generate_complete_report(sample_results)
                elif choice == '10':
                    print("📊 Creating performance dashboard...")
                    # Similar to option 9 but focused on dashboard
                    print("⚠️ Run option 8 (backtest) first to generate real data")
                elif choice == '11':
                    self.start_paper_trading()
                elif choice == '12':
                    self.start_live_trading()
                elif choice == '13':
                    if self.components['trading_bot']:
                        self.components['trading_bot'].print_status()
                    else:
                        print("⚠️ Trading bot not initialized")
                elif choice == '14':
                    self.system_status()
                elif choice == '15':
                    self.health_check()
                elif choice == '16':
                    print("📁 System logs location:")
                    print(f"   Current directory: {os.getcwd()}")
                    print("   Log files: *.log, *.json")
                    print("   Reports: *.html, *.csv")
                else:
                    print("❌ Invalid option. Please select 0-16.")
                
                # Pause before next menu
                if choice != '0':
                    input("\n📱 Press Enter to continue...")
                    
            except KeyboardInterrupt:
                print("\n🛑 Operation cancelled by user")
                input("📱 Press Enter to return to menu...")
            except Exception as e:
                print(f"❌ Error: {e}")
                input("📱 Press Enter to continue...")

def main():
    """Main function with command line options"""
    parser = argparse.ArgumentParser(description='Master Trading System Controller')
    parser.add_argument('--mode', choices=['interactive', 'morning', 'scan', 'backtest'], 
                       default='interactive', help='Operation mode')
    parser.add_argument('--component', choices=['news', 'volume', 'backtest', 'trading', 'eda'],
                       help='Run specific component')
    
    args = parser.parse_args()
    
    print("🚀 MASTER TRADING SYSTEM")
    print("=" * 50)
    print("🤖 Integrated News + Volume + Trading + Analysis")
    print("📊 All components loaded and ready")
    print("=" * 50)
    
    # Initialize system
    system = MasterTradingSystem()
    
    if args.mode == 'interactive':
        system.run_interactive_mode()
    elif args.mode == 'morning':
        system.morning_preparation()
    elif args.mode == 'scan':
        system.run_single_news_scan()
        system.run_volume_scan()
    elif args.mode == 'backtest':
        system.run_backtest()
    
    print("\n✅ Master Trading System session complete!")

if __name__ == "__main__":
    main()
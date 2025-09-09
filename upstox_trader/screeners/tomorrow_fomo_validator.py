#!/usr/bin/env python3
"""
Tomorrow's FOMO Trading Validator
================================

Run this script tomorrow to validate your FOMO trading strategy
based on today's pattern analysis.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
import json
import time

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
    UPSTOX_AVAILABLE = True
    print("✅ Upstox API available")
except ImportError as e:
    UPSTOX_AVAILABLE = False
    print(f"⚠️ Upstox API not available: {e}")

class TomorrowFOMOValidator:
    """Validate FOMO trading strategies with real tomorrow data"""
    
    def __init__(self):
        self.api = None
        self.trade_plans = self._load_trade_plans()
        
    def _load_trade_plans(self):
        """Load trade plans from today's analysis"""
        # These are the trade plans based on today's pattern analysis
        return {
            "RATEGAIN": {
                "setup": "extreme_mean_reversion",
                "entry_zone": 520,
                "stop_loss": 505,
                "target_1": 535,
                "target_2": 550,
                "expected_return": 5.8,  # (550-520)/520 * 100
                "risk_reward": 2.0,      # (550-520)/(520-505)
                "time_frame": "morning"
            },
            "SAFARI": {
                "setup": "mean_reversion",
                "entry_zone": 2155,
                "stop_loss": 2140,
                "target_1": 2165,
                "target_2": 2180,
                "expected_return": 1.2,
                "risk_reward": 1.5,
                "time_frame": "morning"
            },
            "NEWGEN": {
                "setup": "mean_reversion",
                "entry_zone": 915,
                "stop_loss": 905,
                "target_1": 922,
                "target_2": 930,
                "expected_return": 1.5,
                "risk_reward": 1.8,
                "time_frame": "morning"
            },
            "APOLLO": {
                "setup": "trend_continuation",
                "entry_zone": 255,
                "stop_loss": 245,
                "target_1": 265,
                "target_2": 275,
                "expected_return": 3.9,
                "risk_reward": 2.0,
                "time_frame": "first_hour"
            },
            "ACMESOLAR": {
                "setup": "volume_breakout",
                "entry_zone": 310,
                "stop_loss": 295,
                "target_1": 325,
                "target_2": 340,
                "expected_return": 4.8,
                "risk_reward": 2.3,
                "time_frame": "any_time"
            }
        }
    
    def initialize_api(self):
        """Initialize Upstox API connection"""
        if not UPSTOX_AVAILABLE:
            print("❌ Upstox API not available")
            return False
            
        try:
            self.api = UpstoxAPI(
                api_key=UPSTOX_CONFIG.get('api_key'),
                api_secret=UPSTOX_CONFIG.get('api_secret')
            )
            
            if not self.api.authenticate():
                print("❌ Failed to authenticate with Upstox API")
                return False
                
            print("✅ Successfully authenticated with Upstox API")
            return True
            
        except Exception as e:
            print(f"❌ Error initializing Upstox API: {e}")
            return False
    
    def fetch_real_time_data(self, symbol, duration_minutes=5):
        """Fetch real-time data for a symbol"""
        if not self.api:
            return None
            
        try:
            # Fetch 1-minute data for the specified duration
            df = self.api.fetch_intraday_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=1
            )
            
            if df is not None and not df.empty:
                # Return last few minutes of data
                return df.tail(duration_minutes)
            return None
            
        except Exception as e:
            print(f"❌ Error fetching data for {symbol}: {e}")
            return None
    
    def check_trade_setup(self, symbol, trade_plan):
        """Check if trade setup conditions are met"""
        print(f"\n🔍 Checking {symbol} trade setup...")
        
        # Fetch current data
        df = self.fetch_real_time_data(symbol, 3)
        if df is None or df.empty:
            print(f"   ❌ No data available for {symbol}")
            return False, {}
        
        current_price = float(df['close'].iloc[-1])
        current_volume = float(df['volume'].iloc[-1])
        
        print(f"   Current Price: ₹{current_price}")
        print(f"   Entry Zone: ₹{trade_plan['entry_zone']}")
        
        # Check entry condition
        entry_price = trade_plan['entry_zone']
        setup_type = trade_plan['setup']
        
        # Different entry conditions based on setup type
        if setup_type == "extreme_mean_reversion":
            # Enter on price above entry zone
            entry_condition = current_price >= entry_price
        elif setup_type == "mean_reversion":
            # Enter on price above entry zone
            entry_condition = current_price >= entry_price
        elif setup_type == "trend_continuation":
            # Enter on strong move above entry
            entry_condition = current_price >= entry_price
        elif setup_type == "volume_breakout":
            # Enter on price and volume confirmation
            avg_volume = df['volume'].mean()
            entry_condition = current_price >= entry_price and current_volume > (avg_volume * 1.5)
        else:
            entry_condition = current_price >= entry_price
        
        if entry_condition:
            print(f"   ✅ Entry condition met!")
            return True, {
                "entry_price": current_price,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "volume": current_volume
            }
        else:
            print(f"   ❌ Entry condition not met")
            return False, {}
    
    def monitor_trade_performance(self, symbol, trade_plan, entry_data):
        """Monitor trade performance after entry"""
        print(f"   📊 Monitoring {symbol} performance...")
        
        entry_price = entry_data['entry_price']
        stop_loss = trade_plan['stop_loss']
        target_1 = trade_plan['target_1']
        target_2 = trade_plan['target_2']
        
        # Monitor for 30 minutes or until target/stop hit
        monitoring_duration = 30  # minutes
        check_interval = 2  # minutes
        
        for i in range(monitoring_duration // check_interval):
            # Fetch current data
            df = self.fetch_real_time_data(symbol, 1)
            if df is None or df.empty:
                time.sleep(check_interval * 60)
                continue
                
            current_price = float(df['close'].iloc[-1])
            
            # Check stop loss
            if current_price <= stop_loss:
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
                print(f"   🔴 Stop Loss Hit! P&L: {pnl_pct:.2f}%")
                return {
                    "exit_type": "stop_loss",
                    "exit_price": current_price,
                    "pnl_pct": pnl_pct,
                    "reason": "Price hit stop loss level"
                }
            
            # Check target 1
            if current_price >= target_1:
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
                print(f"   🟢 Target 1 Hit! P&L: {pnl_pct:.2f}%")
                # For now, we'll exit at target 1 (you can modify this)
                return {
                    "exit_type": "target_1",
                    "exit_price": current_price,
                    "pnl_pct": pnl_pct,
                    "reason": "Price hit target 1 level"
                }
            
            # Check target 2
            if current_price >= target_2:
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
                print(f"   🚀 Target 2 Hit! P&L: {pnl_pct:.2f}%")
                return {
                    "exit_type": "target_2",
                    "exit_price": current_price,
                    "pnl_pct": pnl_pct,
                    "reason": "Price hit target 2 level"
                }
            
            print(f"   Current: ₹{current_price} (SL: ₹{stop_loss}, T1: ₹{target_1}, T2: ₹{target_2})")
            time.sleep(check_interval * 60)
        
        # If we reach here, time expired
        final_df = self.fetch_real_time_data(symbol, 1)
        if final_df is not None and not final_df.empty:
            final_price = float(final_df['close'].iloc[-1])
            pnl_pct = ((final_price - entry_price) / entry_price) * 100
            print(f"   ⏰ Time Expired. Final P&L: {pnl_pct:.2f}%")
            return {
                "exit_type": "time_expired",
                "exit_price": final_price,
                "pnl_pct": pnl_pct,
                "reason": "Monitoring period expired"
            }
        
        return {
            "exit_type": "error",
            "exit_price": entry_price,
            "pnl_pct": 0,
            "reason": "Unable to fetch final price"
        }
    
    def run_tomorrow_validation(self):
        """Run tomorrow's validation with real data"""
        print("="*70)
        print("TOMORROW'S FOMO TRADING VALIDATOR")
        print("="*70)
        print(f"Date: {datetime.now().strftime('%Y-%m-%d')}")
        print(f"Based on yesterday's pattern analysis")
        
        # Initialize API
        if not self.initialize_api():
            print("❌ Cannot proceed without API connection")
            return
        
        # Wait for market to open (9:15 AM IST)
        self._wait_for_market_open()
        
        # Track results
        results = []
        total_return = 0
        winning_trades = 0
        total_trades = 0
        
        # Process each trade plan
        for symbol, trade_plan in self.trade_plans.items():
            print(f"\n{'='*50}")
            print(f"Processing {symbol}")
            print(f"{'='*50}")
            
            # Check if trade setup is triggered
            setup_triggered, entry_data = self.check_trade_setup(symbol, trade_plan)
            
            if setup_triggered:
                print(f"✅ Trade entered for {symbol}")
                total_trades += 1
                
                # Monitor trade performance
                performance = self.monitor_trade_performance(symbol, trade_plan, entry_data)
                
                # Record results
                trade_result = {
                    "symbol": symbol,
                    "setup_type": trade_plan['setup'],
                    "entry_price": entry_data['entry_price'],
                    "exit_price": performance['exit_price'],
                    "pnl_pct": performance['pnl_pct'],
                    "exit_type": performance['exit_type'],
                    "reason": performance['reason']
                }
                
                results.append(trade_result)
                total_return += performance['pnl_pct']
                
                if performance['pnl_pct'] > 0:
                    winning_trades += 1
                    print(f"   🟢 Profit: {performance['pnl_pct']:.2f}%")
                else:
                    print(f"   🔴 Loss: {performance['pnl_pct']:.2f}%")
            else:
                print(f"❌ No entry for {symbol}")
                results.append({
                    "symbol": symbol,
                    "setup_type": trade_plan['setup'],
                    "entry_price": None,
                    "exit_price": None,
                    "pnl_pct": 0,
                    "exit_type": "no_entry",
                    "reason": "Entry conditions not met"
                })
        
        # Generate final report
        self._generate_final_report(results, total_return, winning_trades, total_trades)
    
    def _wait_for_market_open(self):
        """Wait for market to open at 9:15 AM IST"""
        now = datetime.now()
        market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
        
        if now < market_open:
            wait_time = (market_open - now).total_seconds()
            print(f"\n⏳ Waiting for market open at 9:15 AM...")
            print(f"   Waiting for {wait_time/60:.1f} minutes")
            time.sleep(wait_time)
        else:
            print(f"\n✅ Market already open")
    
    def _generate_final_report(self, results, total_return, winning_trades, total_trades):
        """Generate final validation report"""
        print(f"\n{'='*70}")
        print("FINAL VALIDATION REPORT")
        print(f"{'='*70}")
        
        if total_trades > 0:
            win_rate = (winning_trades / total_trades) * 100
            avg_return = total_return / total_trades if total_trades > 0 else 0
            
            print(f"📊 Trading Summary:")
            print(f"   Total Trades: {total_trades}")
            print(f"   Winning Trades: {winning_trades}")
            print(f"   Win Rate: {win_rate:.1f}%")
            print(f"   Total Return: {total_return:.2f}%")
            print(f"   Average Return: {avg_return:.2f}%")
            
            # Performance by setup type
            print(f"\n📈 Performance by Setup Type:")
            setup_performance = {}
            for result in results:
                setup = result['setup_type']
                if setup not in setup_performance:
                    setup_performance[setup] = {"trades": 0, "wins": 0, "total_return": 0}
                
                setup_performance[setup]["trades"] += 1
                setup_performance[setup]["total_return"] += result['pnl_pct']
                if result['pnl_pct'] > 0:
                    setup_performance[setup]["wins"] += 1
            
            for setup, perf in setup_performance.items():
                if perf["trades"] > 0:
                    setup_win_rate = (perf["wins"] / perf["trades"]) * 100
                    setup_avg_return = perf["total_return"] / perf["trades"]
                    print(f"   {setup}: {perf['trades']} trades, {setup_win_rate:.1f}% win rate, {setup_avg_return:.2f}% avg return")
            
            # Individual trade results
            print(f"\n📝 Individual Trade Results:")
            for result in results:
                if result['entry_price'] is not None:
                    print(f"   {result['symbol']}: {result['pnl_pct']:+.2f}% ({result['exit_type']})")
                else:
                    print(f"   {result['symbol']}: No entry - {result['reason']}")
            
            # Strategy assessment
            print(f"\n💡 Strategy Assessment:")
            if win_rate >= 60:
                print(f"   ✅ Strong Performance (Win Rate ≥ 60%)")
            elif win_rate >= 50:
                print(f"   ⚠️  Moderate Performance (50% ≤ Win Rate < 60%)")
            else:
                print(f"   ❌ Poor Performance (Win Rate < 50%)")
            
            if avg_return > 0:
                print(f"   ✅ Positive Expected Value (Average Return > 0)")
            else:
                print(f"   ❌ Negative Expected Value (Average Return ≤ 0)")
            
            # Recommendations
            print(f"\n📋 Recommendations:")
            if win_rate >= 60 and avg_return > 1:
                print(f"   ✅ Strategy is profitable - continue with confidence")
            elif win_rate >= 50:
                print(f"   ⚠️  Strategy is break-even - consider optimization")
            else:
                print(f"   ❌ Strategy needs significant improvement")
            
            # Save results
            self._save_results(results)
        else:
            print("❌ No trades were executed")
    
    def _save_results(self, results):
        """Save validation results to file"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"tomorrow_fomo_validation_{timestamp}.json"
        
        report_data = {
            "timestamp": timestamp,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "trade_plans": self.trade_plans,
            "results": results,
            "summary": {
                "total_trades": len([r for r in results if r['entry_price'] is not None]),
                "winning_trades": len([r for r in results if r['pnl_pct'] > 0]),
                "total_return": sum(r['pnl_pct'] for r in results),
                "win_rate": (len([r for r in results if r['pnl_pct'] > 0]) / len([r for r in results if r['entry_price'] is not None]) * 100) if len([r for r in results if r['entry_price'] is not None]) > 0 else 0
            }
        }
        
        try:
            with open(filename, 'w') as f:
                json.dump(report_data, f, indent=2)
            print(f"\n💾 Results saved to: {filename}")
        except Exception as e:
            print(f"❌ Error saving results: {e}")

def main():
    """Main function to run tomorrow's FOMO validator"""
    print("🚀 Starting Tomorrow's FOMO Trading Validator")
    print("This script will validate your trading strategy based on yesterday's pattern analysis.")
    
    validator = TomorrowFOMOValidator()
    validator.run_tomorrow_validation()

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Expanded Timeframe Testing
=========================

Test gap trading timeframes (1min, 5min, 15min) on 50+ stocks to validate
the 15-minute timeframe superiority across different:
- Market caps (Large, Mid, Small)
- Sectors (IT, Banking, Pharma, etc.)
- Volatility levels
- Gap sizes

Comprehensive analysis to confirm optimal timeframe.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
import warnings
import time
from typing import List, Dict, Optional, Tuple
import random
warnings.filterwarnings('ignore')

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

class ExpandedTimeframeTest:
    def __init__(self):
        self.api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        # Strategy parameters
        self.gap_threshold = 0.5  # Lower to catch more stocks
        self.stop_loss_pct = -1.0
        self.target_pct = 2.5
        self.trade_amount = 20000
        
        print("🚀 Expanded Timeframe Testing - 50+ Stocks")
        print("="*60)
        print(f"🎯 Testing: 5min, 15min intervals (1min removed - too noisy)")
        print(f"📈 Gap Threshold: {self.gap_threshold}% (lowered to catch more stocks)")
        print(f"🛑 Stop Loss: {self.stop_loss_pct}%")
        print(f"🎯 Target: {self.target_pct}%")
        print("="*60)

    def get_comprehensive_stock_list(self) -> List[Dict]:
        """Get comprehensive list of 50+ stocks across different categories"""
        
        # Large Cap Stocks (Nifty 50 + major stocks)
        large_cap = [
            'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'HINDUNILVR', 'INFY', 'ITC', 'SBIN',
            'BAJFINANCE', 'BHARTIARTL', 'KOTAKBANK', 'LT', 'ASIANPAINT', 'AXISBANK', 'MARUTI',
            'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'NESTLEIND', 'WIPRO', 'NTPC', 'POWERGRID',
            'TATAMOTORS', 'TECHM', 'HCLTECH', 'COALINDIA', 'INDUSINDBK', 'BAJAJFINSV', 'GRASIM',
            'ADANIPORTS', 'JSWSTEEL', 'TATASTEEL', 'HINDALCO', 'DRREDDY', 'CIPLA', 'DIVISLAB',
            'BRITANNIA', 'EICHERMOT', 'HEROMOTOCO', 'ONGC', 'IOC', 'BPCL'
        ]
        
        # Mid Cap Stocks
        mid_cap = [
            'GODREJCP', 'MARICO', 'COLPAL', 'HAVELLS', 'VOLTAS', 'BATAINDIA', 'PAGEIND',
            'BERGEPAINT', 'PIDILITIND', 'DABUR', 'MUTHOOTFIN', 'MANAPPURAM', 'CHOLAFIN',
            'FEDERALBNK', 'BANDHANBNK', 'IDFCFIRSTB', 'RBLBANK', 'APOLLOHOSP', 'FORTIS',
            'LALPATHLAB', 'BIOCON', 'TORNTPHARM', 'ALKEM', 'IPCA'
        ]
        
        # Small Cap / Recently Active Stocks
        small_cap = [
            'BOMDYEING', 'MANAKSIA', 'PNBGILTS', 'GREENPANEL', 'CREDITACC', 'SAPPHIRE',
            'ARIHANTCAP', 'ORIENTCEM', 'SHALBY', 'GTPL', 'ELGIEQUIP', 'MASTERTR',
            'JMFINANCIL', 'MUTHOOTMF', 'PROTEAN', 'DAMCAPITAL', 'GODREJAGRO', 'MRPL'
        ]
        
        # Combine all categories with metadata
        all_stocks = []
        
        # Add large cap stocks
        for symbol in large_cap:
            all_stocks.append({
                'symbol': symbol,
                'category': 'Large Cap',
                'expected_volatility': 'Low',
                'priority': 1  # Test first for reliability
            })
        
        # Add mid cap stocks  
        for symbol in mid_cap:
            all_stocks.append({
                'symbol': symbol,
                'category': 'Mid Cap',
                'expected_volatility': 'Medium',
                'priority': 2
            })
            
        # Add small cap stocks
        for symbol in small_cap:
            all_stocks.append({
                'symbol': symbol,
                'category': 'Small Cap',
                'expected_volatility': 'High',
                'priority': 3
            })
        
        # Randomize within priority groups to avoid bias
        random.seed(42)  # For reproducible results
        large_cap_shuffled = [s for s in all_stocks if s['category'] == 'Large Cap']
        mid_cap_shuffled = [s for s in all_stocks if s['category'] == 'Mid Cap']
        small_cap_shuffled = [s for s in all_stocks if s['category'] == 'Small Cap']
        
        random.shuffle(large_cap_shuffled)
        random.shuffle(mid_cap_shuffled)
        random.shuffle(small_cap_shuffled)
        
        # Take subset from each category for comprehensive but manageable testing
        selected_stocks = (
            large_cap_shuffled[:20] +   # Top 20 large caps
            mid_cap_shuffled[:15] +     # Top 15 mid caps
            small_cap_shuffled[:15]     # All small caps (we know these have gaps)
        )
        
        print(f"📊 Selected {len(selected_stocks)} stocks for testing:")
        print(f"  🏢 Large Cap: {len([s for s in selected_stocks if s['category'] == 'Large Cap'])}")
        print(f"  🏬 Mid Cap: {len([s for s in selected_stocks if s['category'] == 'Mid Cap'])}")
        print(f"  🏪 Small Cap: {len([s for s in selected_stocks if s['category'] == 'Small Cap'])}")
        
        return selected_stocks

    def test_single_stock_all_timeframes(self, stock_info: Dict, trade_date: str = '2025-07-23') -> List[Dict]:
        """Test a single stock across all timeframes"""
        symbol = stock_info['symbol']
        category = stock_info['category']
        results = []
        
        # Test each timeframe (removed 1min - too noisy/unreliable)
        for interval in [5, 15]:
            try:
                # Get data for this timeframe
                df = self.api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=interval,
                    to_date=trade_date,
                    from_date=(pd.to_datetime(trade_date) - timedelta(days=2)).strftime('%Y-%m-%d')
                )
                
                if df is None or df.empty:
                    continue
                
                # Filter for trade date
                target_date = pd.to_datetime(trade_date).date()
                day_data = df[df.index.date == target_date].copy()
                
                if day_data.empty:
                    continue
                
                # Calculate gap
                prev_day_data = df[df.index.date < target_date]
                if prev_day_data.empty:
                    continue
                
                prev_close = prev_day_data['close'].iloc[-1]
                current_open = day_data['open'].iloc[0]
                actual_gap_pct = ((current_open - prev_close) / prev_close) * 100
                
                if abs(actual_gap_pct) < self.gap_threshold:
                    continue
                
                # Simulate trade
                trade_result = self.simulate_timeframe_trade(
                    day_data, actual_gap_pct, interval, symbol
                )
                
                if trade_result['success']:
                    result = {
                        'symbol': symbol,
                        'category': category,
                        'timeframe': f'{interval}min',
                        'interval': interval,
                        'gap_pct': actual_gap_pct,
                        'gap_direction': 'Up' if actual_gap_pct > 0 else 'Down',
                        **trade_result
                    }
                    results.append(result)
                
            except Exception as e:
                # Silently continue - many stocks won't have data
                continue
                
            # Rate limiting
            time.sleep(0.05)
        
        return results

    def simulate_timeframe_trade(self, day_data: pd.DataFrame, gap_pct: float, interval: int, symbol: str) -> Dict:
        """Simulate trade for specific timeframe"""
        try:
            # Entry timing based on interval
            if interval == 1:
                entry_idx = 0  # Immediate entry
            elif interval == 5:
                entry_idx = min(1, len(day_data) - 1)  # After first candle
            else:  # 15 minutes
                entry_idx = min(1, len(day_data) - 1)  # After confirmation
            
            entry_price = day_data['open'].iloc[entry_idx]
            entry_time = day_data.index[entry_idx]
            
            # Position sizing
            qty = int(self.trade_amount / entry_price)
            if qty <= 0:
                return {'success': False}
            
            # Calculate levels
            if gap_pct > 0:  # Gap up - long trade
                stop_loss_price = entry_price * (1 + self.stop_loss_pct/100)
                target_price = entry_price * (1 + self.target_pct/100)
            else:  # Gap down - short trade (theoretical)
                stop_loss_price = entry_price * (1 - self.stop_loss_pct/100)
                target_price = entry_price * (1 - self.target_pct/100)
            
            # Track trade
            exit_price = None
            exit_time = None
            exit_reason = 'EOD'
            max_profit = 0
            max_loss = 0
            
            # Process candles after entry
            for i in range(entry_idx, len(day_data)):
                row = day_data.iloc[i]
                current_high = row['high']
                current_low = row['low']
                
                if gap_pct > 0:  # Long trade
                    # Track max profit/loss
                    high_pct = ((current_high - entry_price) / entry_price) * 100
                    low_pct = ((current_low - entry_price) / entry_price) * 100
                    max_profit = max(max_profit, high_pct)
                    max_loss = min(max_loss, low_pct)
                    
                    # Check stop loss
                    if current_low <= stop_loss_price:
                        exit_price = stop_loss_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Stop Loss'
                        break
                    
                    # Check target
                    if current_high >= target_price:
                        exit_price = target_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Target Hit'
                        break
                
                else:  # Short trade (theoretical)
                    # Track max profit/loss for short
                    high_pct = ((entry_price - current_low) / entry_price) * 100
                    low_pct = ((entry_price - current_high) / entry_price) * 100
                    max_profit = max(max_profit, high_pct)
                    max_loss = min(max_loss, low_pct)
                    
                    # Check stop loss (price going up)
                    if current_high >= stop_loss_price:
                        exit_price = stop_loss_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Stop Loss'
                        break
                    
                    # Check target (price going down)
                    if current_low <= target_price:
                        exit_price = target_price
                        exit_time = day_data.index[i]
                        exit_reason = 'Target Hit'
                        break
            
            # EOD exit if no stop/target hit
            if exit_price is None:
                exit_price = day_data['close'].iloc[-1]
                exit_time = day_data.index[-1]
                exit_reason = 'EOD'
            
            # Calculate P&L
            if gap_pct > 0:  # Long trade
                gross_pnl = (exit_price - entry_price) * qty
            else:  # Short trade
                gross_pnl = (entry_price - exit_price) * qty
            
            pnl_pct = (gross_pnl / (entry_price * qty)) * 100
            net_pnl = gross_pnl - 40  # Brokerage
            
            # Trade duration
            duration_min = (exit_time - entry_time).total_seconds() / 60
            
            return {
                'success': True,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'entry_time': entry_time,
                'exit_time': exit_time,
                'exit_reason': exit_reason,
                'qty': qty,
                'gross_pnl': gross_pnl,
                'net_pnl': net_pnl,
                'pnl_pct': pnl_pct,
                'duration_min': duration_min,
                'max_profit_pct': max_profit,
                'max_loss_pct': max_loss,
                'total_candles': len(day_data)
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def run_expanded_test(self) -> pd.DataFrame:
        """Run expanded test on 50+ stocks"""
        print(f"\n🚀 Starting Expanded Timeframe Test")
        print("="*60)
        
        stock_list = self.get_comprehensive_stock_list()
        all_results = []
        stocks_tested = 0
        stocks_with_data = 0
        
        print(f"\n📊 Testing stocks (showing progress every 10 stocks)...")
        
        for i, stock_info in enumerate(stock_list, 1):
            symbol = stock_info['symbol']
            
            # Show progress every 10 stocks
            if i % 10 == 0 or i <= 5:
                print(f"[{i}/{len(stock_list)}] Testing {symbol} ({stock_info['category']})...")
            
            stocks_tested += 1
            
            # Test this stock across all timeframes
            stock_results = self.test_single_stock_all_timeframes(stock_info)
            
            if stock_results:
                stocks_with_data += 1
                all_results.extend(stock_results)
                
                # Show brief results if significant
                if i <= 10 or len(stock_results) >= 2:  # Show details for first 10 or multi-timeframe stocks
                    print(f"  ✅ {symbol}: {len(stock_results)} timeframes with gaps")
                    for result in stock_results:
                        status = "📈" if result['net_pnl'] > 0 else "📉"
                        print(f"    {status} {result['timeframe']}: Gap {result['gap_pct']:+.1f}% → P&L {result['pnl_pct']:+.1f}% (₹{result['net_pnl']:+.0f})")
            
            # Rate limiting every 10 stocks
            if i % 10 == 0:
                time.sleep(1)
                print(f"  📊 Progress: {stocks_with_data}/{stocks_tested} stocks have usable data")
        
        print(f"\n📈 Test completed!")
        print(f"🔍 Stocks tested: {stocks_tested}")
        print(f"✅ Stocks with data: {stocks_with_data}")
        print(f"💼 Total trades: {len(all_results)}")
        
        if all_results:
            results_df = pd.DataFrame(all_results)
            self.analyze_expanded_results(results_df)
            return results_df
        else:
            print("❌ No trades found in expanded test")
            return pd.DataFrame()

    def analyze_expanded_results(self, results_df: pd.DataFrame):
        """Comprehensive analysis of expanded results"""
        print("\n" + "="*80)
        print("📊 EXPANDED TIMEFRAME ANALYSIS - 50+ STOCKS")
        print("="*80)
        
        if results_df.empty:
            print("No results to analyze")
            return
        
        total_trades = len(results_df)
        unique_stocks = results_df['symbol'].nunique()
        
        print(f"📈 Total Trades Analyzed: {total_trades}")
        print(f"🏢 Unique Stocks: {unique_stocks}")
        print(f"⏱️  Timeframes: {', '.join(sorted(results_df['timeframe'].unique()))}")
        
        # Overall timeframe comparison
        print(f"\n🏆 OVERALL TIMEFRAME PERFORMANCE:")
        print("-" * 60)
        
        timeframe_summary = results_df.groupby('timeframe').agg({
            'net_pnl': ['count', 'sum', 'mean'],
            'pnl_pct': 'mean',
            'duration_min': 'mean',
            'max_profit_pct': 'mean',
            'max_loss_pct': 'mean'
        }).round(2)
        
        # Flatten column names
        timeframe_summary.columns = ['_'.join(col).strip() for col in timeframe_summary.columns]
        
        # Add win rate calculation
        win_rates = results_df.groupby('timeframe').apply(
            lambda x: (x['net_pnl'] > 0).sum() / len(x) * 100
        ).round(1)
        
        # Display summary table
        print(f"{'Timeframe':<10} {'Trades':<8} {'Win Rate':<10} {'Total P&L':<12} {'Avg P&L':<10} {'Avg Duration':<12}")
        print("-" * 60)
        
        for timeframe in ['5min', '15min']:
            if timeframe in timeframe_summary.index:
                trades = int(timeframe_summary.loc[timeframe, 'net_pnl_count'])
                win_rate = win_rates[timeframe]
                total_pnl = timeframe_summary.loc[timeframe, 'net_pnl_sum']
                avg_pnl = timeframe_summary.loc[timeframe, 'net_pnl_mean']
                avg_duration = timeframe_summary.loc[timeframe, 'duration_min_mean']
                
                print(f"{timeframe:<10} {trades:<8} {win_rate:<9.1f}% ₹{total_pnl:<10.0f} ₹{avg_pnl:<8.0f} {avg_duration:<10.0f}min")
        
        # Category-wise analysis
        print(f"\n📊 PERFORMANCE BY STOCK CATEGORY:")
        print("-" * 60)
        
        category_analysis = results_df.groupby(['category', 'timeframe']).agg({
            'net_pnl': ['count', 'mean', 'sum'],
            'pnl_pct': 'mean'
        }).round(2)
        
        for category in ['Large Cap', 'Mid Cap', 'Small Cap']:
            cat_data = results_df[results_df['category'] == category]
            if not cat_data.empty:
                print(f"\n{category.upper()}:")
                for timeframe in ['5min', '15min']:
                    tf_cat_data = cat_data[cat_data['timeframe'] == timeframe]
                    if not tf_cat_data.empty:
                        trades = len(tf_cat_data)
                        win_rate = (tf_cat_data['net_pnl'] > 0).sum() / trades * 100
                        avg_pnl = tf_cat_data['net_pnl'].mean()
                        total_pnl = tf_cat_data['net_pnl'].sum()
                        
                        print(f"  {timeframe}: {trades} trades, {win_rate:.1f}% win rate, ₹{avg_pnl:.0f} avg, ₹{total_pnl:.0f} total")
        
        # Gap direction analysis
        print(f"\n📈 GAP DIRECTION ANALYSIS:")
        print("-" * 40)
        
        gap_analysis = results_df.groupby(['gap_direction', 'timeframe']).agg({
            'net_pnl': ['count', 'mean', 'sum']
        }).round(2)
        
        for direction in ['Up', 'Down']:
            dir_data = results_df[results_df['gap_direction'] == direction]
            if not dir_data.empty:
                print(f"\nGAP {direction.upper()} TRADES:")
                for timeframe in ['5min', '15min']:
                    tf_dir_data = dir_data[dir_data['timeframe'] == timeframe]
                    if not tf_dir_data.empty:
                        trades = len(tf_dir_data)
                        win_rate = (tf_dir_data['net_pnl'] > 0).sum() / trades * 100
                        avg_pnl = tf_dir_data['net_pnl'].mean()
                        
                        print(f"  {timeframe}: {trades} trades, {win_rate:.1f}% win rate, ₹{avg_pnl:.0f} avg")
        
        # Best and worst performers by timeframe
        print(f"\n🏆 TOP 5 PERFORMERS BY TIMEFRAME:")
        
        for timeframe in ['5min', '15min']:
            tf_data = results_df[results_df['timeframe'] == timeframe]
            if not tf_data.empty:
                top_5 = tf_data.nlargest(5, 'net_pnl')
                print(f"\n{timeframe.upper()} TIMEFRAME:")
                for i, (_, trade) in enumerate(top_5.iterrows(), 1):
                    print(f"  {i}. {trade['symbol']:12} ({trade['category']:<9}) | Gap: {trade['gap_pct']:+5.1f}% → P&L: ₹{trade['net_pnl']:+6.0f} ({trade['pnl_pct']:+.1f}%)")
        
        # Statistical significance test
        print(f"\n📊 STATISTICAL ANALYSIS:")
        print("-" * 40)
        
        # Calculate confidence intervals for mean P&L
        for timeframe in ['5min', '15min']:
            tf_data = results_df[results_df['timeframe'] == timeframe]
            if len(tf_data) >= 3:  # Need at least 3 samples
                mean_pnl = tf_data['net_pnl'].mean()
                std_pnl = tf_data['net_pnl'].std()
                n = len(tf_data)
                
                # 95% confidence interval
                margin_error = 1.96 * (std_pnl / np.sqrt(n))
                ci_lower = mean_pnl - margin_error
                ci_upper = mean_pnl + margin_error
                
                print(f"{timeframe}: Mean ₹{mean_pnl:.0f} (95% CI: ₹{ci_lower:.0f} to ₹{ci_upper:.0f})")
        
        # Final recommendation
        print(f"\n💡 EXPANDED TEST CONCLUSIONS:")
        print("="*40)
        
        # Find best overall timeframe
        tf_totals = results_df.groupby('timeframe')['net_pnl'].sum()
        tf_win_rates = results_df.groupby('timeframe').apply(lambda x: (x['net_pnl'] > 0).sum() / len(x) * 100)
        tf_counts = results_df.groupby('timeframe').size()
        
        best_total_tf = tf_totals.idxmax()
        best_winrate_tf = tf_win_rates.idxmax()
        most_trades_tf = tf_counts.idxmax()
        
        print(f"🏆 Best Total P&L: {best_total_tf.upper()} (₹{tf_totals[best_total_tf]:,.0f})")
        print(f"🎯 Best Win Rate: {best_winrate_tf.upper()} ({tf_win_rates[best_winrate_tf]:.1f}%)")
        print(f"📊 Most Trades: {most_trades_tf.upper()} ({tf_counts[most_trades_tf]} trades)")
        
        # Overall recommendation
        if best_total_tf == best_winrate_tf:
            print(f"\n✅ CLEAR WINNER: {best_total_tf.upper()} timeframe dominates both profit and win rate!")
        else:
            print(f"\n⚖️  MIXED RESULTS: {best_total_tf.upper()} for profit, {best_winrate_tf.upper()} for win rate")
        
        # Save comprehensive results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"expanded_timeframe_test_{timestamp}.csv"
        results_df.to_csv(filename, index=False)
        print(f"\n💾 Comprehensive results saved to: {filename}")
        
        # Save summary statistics
        summary_stats = {
            'timeframe': [],
            'total_trades': [],
            'win_rate': [],
            'total_pnl': [],
            'avg_pnl': [],
            'avg_duration': []
        }
        
        for timeframe in ['5min', '15min']:
            if timeframe in tf_totals.index:
                summary_stats['timeframe'].append(timeframe)
                summary_stats['total_trades'].append(tf_counts[timeframe])
                summary_stats['win_rate'].append(tf_win_rates[timeframe])
                summary_stats['total_pnl'].append(tf_totals[timeframe])
                summary_stats['avg_pnl'].append(tf_totals[timeframe] / tf_counts[timeframe])
                avg_dur = results_df[results_df['timeframe'] == timeframe]['duration_min'].mean()
                summary_stats['avg_duration'].append(avg_dur)
        
        summary_df = pd.DataFrame(summary_stats)
        summary_filename = f"timeframe_summary_{timestamp}.csv"
        summary_df.to_csv(summary_filename, index=False)
        print(f"📈 Summary statistics saved to: {summary_filename}")


def main():
    """Run the expanded timeframe test"""
    tester = ExpandedTimeframeTest()
    results = tester.run_expanded_test()
    
    if not results.empty:
        print(f"\n🎉 Expanded test completed successfully!")
        print(f"📊 {len(results)} trades analyzed across {results['symbol'].nunique()} stocks")
        print(f"🏆 Check the comprehensive analysis above for definitive timeframe conclusions")
    else:
        print(f"\n⚠️ No trades found - market conditions may not have suitable gaps")


if __name__ == "__main__":
    main()
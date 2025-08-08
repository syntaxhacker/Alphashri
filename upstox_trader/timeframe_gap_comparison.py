#!/usr/bin/env python3
"""
Timeframe Gap Trading Comparison
===============================

Compare gap trading performance across different timeframes:
- 1-minute intervals (ultra-precise entries)
- 5-minute intervals (standard entries) 
- 15-minute intervals (trend-following entries)

Analyzes which timeframe gives the best profit with gap strategies.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
import warnings
import time
from typing import List, Dict, Optional, Tuple
warnings.filterwarnings('ignore')

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

class TimeframeGapComparison:
    def __init__(self):
        self.api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        # Strategy parameters (consistent across timeframes)
        self.gap_threshold = 1.0
        self.stop_loss_pct = -1.0
        self.target_pct = 2.5
        self.trade_amount = 20000
        
        print("📊 Timeframe Gap Trading Comparison")
        print("="*60)
        print(f"🎯 Testing: 1min, 5min, 15min intervals")
        print(f"📈 Gap Threshold: {self.gap_threshold}%")
        print(f"🛑 Stop Loss: {self.stop_loss_pct}%")
        print(f"🎯 Target: {self.target_pct}%")
        print("="*60)

    def get_test_stocks(self) -> List[Dict]:
        """Get stocks with confirmed gaps for testing"""
        return [
            {'symbol': 'BOMDYEING', 'expected_gap': 1.74, 'volume_ratio': 89.8},
            {'symbol': 'MANAKSIA', 'expected_gap': 2.63, 'volume_ratio': 59.4},
            {'symbol': 'PNBGILTS', 'expected_gap': 1.17, 'volume_ratio': 19.1},
            {'symbol': 'SAPPHIRE', 'expected_gap': 1.27, 'volume_ratio': 10.1},
            {'symbol': 'ARIHANTCAP', 'expected_gap': 2.08, 'volume_ratio': 4.0},
            {'symbol': 'ORIENTCEM', 'expected_gap': 2.00, 'volume_ratio': 4.0},
        ]

    def simulate_gap_trade_by_timeframe(self, symbol: str, interval: int, trade_date: str = '2025-07-23') -> Dict:
        """
        Simulate gap trade using specific timeframe data
        """
        try:
            print(f"    📡 Fetching {interval}min data for {symbol}...")
            
            # Get intraday data for the specific interval
            df = self.api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=interval,
                to_date=trade_date,
                from_date=(pd.to_datetime(trade_date) - timedelta(days=1)).strftime('%Y-%m-%d')
            )
            
            if df is None or df.empty:
                return {'success': False, 'reason': f'No {interval}min data'}
            
            # Filter for trade date
            target_date = pd.to_datetime(trade_date).date()
            day_data = df[df.index.date == target_date].copy()
            
            if day_data.empty:
                return {'success': False, 'reason': f'No {interval}min data for trade date'}
            
            # Calculate actual gap using the data
            try:
                # Get previous day's last close
                prev_day_data = df[df.index.date < target_date]
                if prev_day_data.empty:
                    return {'success': False, 'reason': 'No previous day data for gap calculation'}
                
                prev_close = prev_day_data['close'].iloc[-1]
                current_open = day_data['open'].iloc[0]
                actual_gap_pct = ((current_open - prev_close) / prev_close) * 100
                
                if actual_gap_pct < self.gap_threshold:
                    return {'success': False, 'reason': f'Gap {actual_gap_pct:.2f}% below threshold'}
                
            except Exception as e:
                return {'success': False, 'reason': f'Gap calculation error: {e}'}
            
            # Entry strategy based on timeframe
            if interval == 1:
                # 1-minute: Enter immediately at market open for precision
                entry_time = pd.Timestamp('09:15:00').time()  # Market open
                entry_candle_idx = 0  # First candle
            elif interval == 5:
                # 5-minute: Enter after first 5-min candle (9:20 AM)
                entry_time = pd.Timestamp('09:20:00').time()
                entry_candle_idx = 1 if len(day_data) > 1 else 0
            else:  # 15-minute
                # 15-minute: Enter after first 15-min candle for trend confirmation
                entry_time = pd.Timestamp('09:30:00').time()
                entry_candle_idx = 1 if len(day_data) > 1 else 0
            
            # Get entry price
            if entry_candle_idx >= len(day_data):
                entry_candle_idx = 0
                
            entry_price = day_data['open'].iloc[entry_candle_idx]
            entry_time_actual = day_data.index[entry_candle_idx]
            
            # Position sizing
            qty = int(self.trade_amount / entry_price)
            if qty <= 0:
                return {'success': False, 'reason': 'Price too high for position size'}
            
            # Calculate stop loss and target prices
            stop_loss_price = entry_price * (1 + self.stop_loss_pct/100)
            target_price = entry_price * (1 + self.target_pct/100)
            
            # Track trade through the day
            exit_price = None
            exit_time = None
            exit_reason = 'EOD'
            max_profit_pct = 0
            max_loss_pct = 0
            candles_to_target = 0
            candles_to_stop = 0
            
            # Analyze each candle after entry
            for i, (idx, row) in enumerate(day_data.iloc[entry_candle_idx:].iterrows()):
                current_high = row['high']
                current_low = row['low'] 
                current_close = row['close']
                
                # Track maximum profit and loss during trade
                high_pct = ((current_high - entry_price) / entry_price) * 100
                low_pct = ((current_low - entry_price) / entry_price) * 100
                
                if high_pct > max_profit_pct:
                    max_profit_pct = high_pct
                if low_pct < max_loss_pct:
                    max_loss_pct = low_pct
                
                # Check stop loss first (priority)
                if current_low <= stop_loss_price:
                    exit_price = stop_loss_price
                    exit_time = idx
                    exit_reason = 'Stop Loss'
                    candles_to_stop = i + 1
                    break
                
                # Check target hit
                if current_high >= target_price:
                    exit_price = target_price
                    exit_time = idx
                    exit_reason = 'Target Hit'
                    candles_to_target = i + 1
                    break
            
            # If no exit triggered, exit at EOD
            if exit_price is None:
                exit_price = day_data['close'].iloc[-1]
                exit_time = day_data.index[-1]
                exit_reason = 'EOD'
            
            # Calculate P&L and metrics
            gross_pnl = (exit_price - entry_price) * qty
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            brokerage = 40  # ₹20 each way
            net_pnl = gross_pnl - brokerage
            
            # Calculate trade duration in minutes
            trade_duration = (exit_time - entry_time_actual).total_seconds() / 60
            
            # Risk metrics
            risk_reward_ratio = abs(self.target_pct / self.stop_loss_pct) if self.stop_loss_pct != 0 else 0
            max_drawdown_pct = max_loss_pct if max_loss_pct < 0 else 0
            
            return {
                'success': True,
                'interval': interval,
                'actual_gap_pct': actual_gap_pct,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'entry_time': entry_time_actual,
                'exit_time': exit_time,
                'exit_reason': exit_reason,
                'qty': qty,
                'gross_pnl': gross_pnl,
                'net_pnl': net_pnl,
                'pnl_pct': pnl_pct,
                'trade_duration_min': trade_duration,
                'max_profit_pct': max_profit_pct,
                'max_loss_pct': max_loss_pct,
                'max_drawdown_pct': max_drawdown_pct,
                'candles_to_target': candles_to_target,
                'candles_to_stop': candles_to_stop,
                'total_candles': len(day_data),
                'brokerage': brokerage
            }
            
        except Exception as e:
            return {'success': False, 'reason': f'Simulation error: {e}'}

    def run_timeframe_comparison(self) -> pd.DataFrame:
        """
        Run comprehensive timeframe comparison
        """
        print("\n🚀 Starting Timeframe Gap Trading Comparison")
        print("="*60)
        
        test_stocks = self.get_test_stocks()
        timeframes = [1, 5, 15]  # minutes
        all_results = []
        
        for stock_info in test_stocks:
            symbol = stock_info['symbol']
            expected_gap = stock_info['expected_gap']
            volume_ratio = stock_info['volume_ratio']
            
            print(f"\n📊 Testing {symbol} (Expected Gap: {expected_gap:+.1f}%, Volume: {volume_ratio:.1f}x)")
            print("-" * 40)
            
            stock_results = {}
            
            # Test each timeframe
            for interval in timeframes:
                print(f"  ⏱️  {interval}-minute interval:")
                
                result = self.simulate_gap_trade_by_timeframe(symbol, interval)
                
                if result['success']:
                    stock_results[f'{interval}min'] = result
                    
                    # Create comprehensive result record
                    full_result = {
                        'symbol': symbol,
                        'timeframe': f'{interval}min',
                        'interval_minutes': interval,
                        'expected_gap': expected_gap,
                        'volume_ratio': volume_ratio,
                        **result  # Unpack all simulation results
                    }
                    all_results.append(full_result)
                    
                    # Display result
                    status = "✅" if result['net_pnl'] > 0 else "❌"
                    duration_str = f"{result['trade_duration_min']:.0f}min"
                    max_profit_str = f"+{result['max_profit_pct']:.1f}%" if result['max_profit_pct'] > 0 else "0%"
                    max_loss_str = f"{result['max_loss_pct']:.1f}%" if result['max_loss_pct'] < 0 else "0%"
                    
                    print(f"    {status} Gap: {result['actual_gap_pct']:+.2f}% → P&L: {result['pnl_pct']:+.2f}% (₹{result['net_pnl']:+,.0f})")
                    print(f"       Duration: {duration_str} | Max Profit: {max_profit_str} | Max Loss: {max_loss_str}")
                    print(f"       Exit: {result['exit_reason']} | Candles: {result['total_candles']}")
                    
                else:
                    print(f"    ❌ Failed: {result['reason']}")
                
                time.sleep(0.2)  # Rate limiting
            
            # Compare timeframes for this stock
            if len(stock_results) > 1:
                print(f"\n  📈 {symbol} Timeframe Comparison:")
                best_pnl = -float('inf')
                best_timeframe = None
                
                for tf, result in stock_results.items():
                    pnl = result['net_pnl']
                    if pnl > best_pnl:
                        best_pnl = pnl
                        best_timeframe = tf
                
                for tf, result in stock_results.items():
                    marker = "🏆" if tf == best_timeframe else "  "
                    print(f"    {marker} {tf}: ₹{result['net_pnl']:+6.0f} ({result['pnl_pct']:+.1f}%) - {result['exit_reason']}")
        
        # Convert to DataFrame and analyze
        if all_results:
            results_df = pd.DataFrame(all_results)
            self.analyze_timeframe_results(results_df)
            return results_df
        else:
            print("\n❌ No successful trades found across any timeframe")
            return pd.DataFrame()

    def analyze_timeframe_results(self, results_df: pd.DataFrame):
        """Analyze and compare timeframe performance"""
        print("\n" + "="*60)
        print("📊 COMPREHENSIVE TIMEFRAME ANALYSIS")
        print("="*60)
        
        if results_df.empty:
            print("No results to analyze")
            return
        
        # Group by timeframe for comparison
        timeframe_stats = {}
        
        for timeframe in ['1min', '5min', '15min']:
            tf_data = results_df[results_df['timeframe'] == timeframe]
            
            if not tf_data.empty:
                total_trades = len(tf_data)
                winning_trades = len(tf_data[tf_data['net_pnl'] > 0])
                win_rate = (winning_trades / total_trades) * 100
                
                total_pnl = tf_data['net_pnl'].sum()
                avg_pnl = tf_data['net_pnl'].mean()
                avg_duration = tf_data['trade_duration_min'].mean()
                
                # Risk metrics
                avg_max_profit = tf_data['max_profit_pct'].mean()
                avg_max_loss = tf_data['max_loss_pct'].mean()
                avg_drawdown = tf_data['max_drawdown_pct'].mean()
                
                # Exit analysis
                target_hits = len(tf_data[tf_data['exit_reason'] == 'Target Hit'])
                stop_losses = len(tf_data[tf_data['exit_reason'] == 'Stop Loss'])
                eod_exits = len(tf_data[tf_data['exit_reason'] == 'EOD'])
                
                timeframe_stats[timeframe] = {
                    'total_trades': total_trades,
                    'win_rate': win_rate,
                    'total_pnl': total_pnl,
                    'avg_pnl': avg_pnl,
                    'avg_duration': avg_duration,
                    'avg_max_profit': avg_max_profit,
                    'avg_max_loss': avg_max_loss,
                    'avg_drawdown': avg_drawdown,
                    'target_hits': target_hits,
                    'stop_losses': stop_losses,
                    'eod_exits': eod_exits
                }
        
        # Display comparison table
        print("📈 TIMEFRAME PERFORMANCE COMPARISON:")
        print("-" * 60)
        print(f"{'Metric':<20} {'1-Min':<12} {'5-Min':<12} {'15-Min':<12}")
        print("-" * 60)
        
        for metric in ['total_trades', 'win_rate', 'total_pnl', 'avg_pnl', 'avg_duration']:
            print(f"{metric.replace('_', ' ').title():<20}", end="")
            
            for tf in ['1min', '5min', '15min']:
                if tf in timeframe_stats:
                    value = timeframe_stats[tf][metric]
                    if metric == 'win_rate':
                        print(f"{value:10.1f}%  ", end="")
                    elif 'pnl' in metric:
                        print(f"₹{value:9.0f}  ", end="")
                    elif metric == 'avg_duration':
                        print(f"{value:9.0f}min ", end="")
                    else:
                        print(f"{value:11.0f}  ", end="")
                else:
                    print(f"{'N/A':>11}  ", end="")
            print()
        
        print("-" * 60)
        
        # Risk metrics comparison
        print("\n🔍 RISK METRICS COMPARISON:")
        print("-" * 60)
        print(f"{'Risk Metric':<20} {'1-Min':<12} {'5-Min':<12} {'15-Min':<12}")
        print("-" * 60)
        
        for metric in ['avg_max_profit', 'avg_max_loss', 'avg_drawdown']:
            print(f"{metric.replace('_', ' ').title():<20}", end="")
            
            for tf in ['1min', '5min', '15min']:
                if tf in timeframe_stats:
                    value = timeframe_stats[tf][metric]
                    print(f"{value:+10.1f}%  ", end="")
                else:
                    print(f"{'N/A':>11}  ", end="")
            print()
        
        print("-" * 60)
        
        # Exit reason analysis
        print("\n🚪 EXIT REASON BREAKDOWN:")
        for tf in ['1min', '5min', '15min']:
            if tf in timeframe_stats:
                stats = timeframe_stats[tf]
                total = stats['total_trades']
                print(f"\n{tf.upper()} TIMEFRAME ({total} trades):")
                print(f"  🎯 Target Hit: {stats['target_hits']} ({stats['target_hits']/total*100:.1f}%)")
                print(f"  🛑 Stop Loss: {stats['stop_losses']} ({stats['stop_losses']/total*100:.1f}%)")
                print(f"  🌅 End of Day: {stats['eod_exits']} ({stats['eod_exits']/total*100:.1f}%)")
        
        # Find best timeframe
        best_timeframe = None
        best_total_pnl = -float('inf')
        best_win_rate = 0
        best_avg_pnl = -float('inf')
        
        for tf, stats in timeframe_stats.items():
            if stats['total_pnl'] > best_total_pnl:
                best_total_pnl = stats['total_pnl']
                best_timeframe = tf
            if stats['avg_pnl'] > best_avg_pnl:
                best_avg_pnl = stats['avg_pnl']
        
        print(f"\n🏆 BEST TIMEFRAME ANALYSIS:")
        print(f"  💰 Highest Total P&L: {best_timeframe.upper()} (₹{best_total_pnl:,.0f})")
        
        # Find timeframe with best win rate
        best_wr_tf = max(timeframe_stats.items(), key=lambda x: x[1]['win_rate'])
        print(f"  🎯 Highest Win Rate: {best_wr_tf[0].upper()} ({best_wr_tf[1]['win_rate']:.1f}%)")
        
        # Find fastest timeframe
        fastest_tf = min(timeframe_stats.items(), key=lambda x: x[1]['avg_duration'])
        print(f"  ⚡ Fastest Execution: {fastest_tf[0].upper()} ({fastest_tf[1]['avg_duration']:.0f} min avg)")
        
        # Stock-by-stock best timeframe
        print(f"\n📊 STOCK-BY-STOCK BEST TIMEFRAMES:")
        stock_best = results_df.groupby('symbol').apply(
            lambda x: x.loc[x['net_pnl'].idxmax()] if not x.empty else None
        ).dropna()
        
        for symbol, best_row in stock_best.iterrows():
            print(f"  • {symbol:12}: {best_row['timeframe']} (₹{best_row['net_pnl']:+.0f}, {best_row['pnl_pct']:+.1f}%)")
        
        # Recommendations
        print(f"\n💡 TIMEFRAME TRADING RECOMMENDATIONS:")
        
        if best_timeframe:
            best_stats = timeframe_stats[best_timeframe]
            print(f"  ✅ OVERALL BEST: {best_timeframe.upper()} timeframe")
            print(f"     - Total P&L: ₹{best_stats['total_pnl']:,.0f}")
            print(f"     - Win Rate: {best_stats['win_rate']:.1f}%")
            print(f"     - Avg Duration: {best_stats['avg_duration']:.0f} minutes")
        
        # Usage recommendations based on characteristics
        print(f"\n  📋 USAGE RECOMMENDATIONS:")
        
        if '1min' in timeframe_stats:
            print(f"  • 1-MINUTE: Best for ultra-precise entries and scalping")
            print(f"    - Fastest execution ({timeframe_stats['1min']['avg_duration']:.0f} min avg)")
            print(f"    - Highest precision but may have more noise")
        
        if '5min' in timeframe_stats:
            print(f"  • 5-MINUTE: Balanced approach for gap trading")
            print(f"    - Good balance of precision and trend confirmation")
            print(f"    - Standard timeframe for most gap strategies")
        
        if '15min' in timeframe_stats:
            print(f"  • 15-MINUTE: Best for trend confirmation entries")
            print(f"    - Reduces false signals with better trend confirmation")
            print(f"    - Slower but potentially more reliable")
        
        # Save detailed results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"timeframe_gap_comparison_{timestamp}.csv"
        results_df.to_csv(filename, index=False)
        print(f"\n💾 Detailed timeframe comparison saved to: {filename}")


def main():
    """Run the timeframe comparison"""
    comparator = TimeframeGapComparison()
    results = comparator.run_timeframe_comparison()
    
    if not results.empty:
        print(f"\n🎉 Timeframe comparison completed!")
        print(f"📊 {len(results)} trades analyzed across multiple timeframes")
        print(f"💡 Check the analysis above for optimal timeframe selection")


if __name__ == "__main__":
    main()
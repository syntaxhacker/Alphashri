#!/usr/bin/env python3
"""
Optimized Gap Trading Strategy
=============================

Enhanced gap trading with multiple optimizations to reduce losses:
1. Dynamic take profit based on gap size
2. False gap detection filters
3. Volume confirmation
4. Pre-market momentum analysis
5. Multiple exit strategies

Analyzes different parameter combinations to find optimal settings.
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

class OptimizedGapStrategy:
    def __init__(self):
        self.api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        print("🚀 Optimized Gap Trading Strategy Analyzer")
        print("="*60)

    def get_gap_stocks_with_data(self) -> List[Dict]:
        """Get gap stocks that actually have historical data available"""
        potential_stocks = [
            {'symbol': 'BOMDYEING', 'tv_gap': 13.63, 'volume_ratio': 89.8},
            {'symbol': 'MANAKSIA', 'tv_gap': 10.2, 'volume_ratio': 59.4},
            {'symbol': 'PNBGILTS', 'tv_gap': 8.25, 'volume_ratio': 19.1},
            {'symbol': 'GREENPANEL', 'tv_gap': 7.98, 'volume_ratio': 20.0},
            {'symbol': 'CREDITACC', 'tv_gap': 5.8, 'volume_ratio': 19.0},
            {'symbol': 'SAPPHIRE', 'tv_gap': 2.8, 'volume_ratio': 10.1},
            {'symbol': 'ARIHANTCAP', 'tv_gap': 2.7, 'volume_ratio': 4.0},
            {'symbol': 'ORIENTCEM', 'tv_gap': 4.1, 'volume_ratio': 4.0},
            {'symbol': 'MRPL', 'tv_gap': 7.6, 'volume_ratio': 9.5},
            {'symbol': 'GODREJAGRO', 'tv_gap': 4.7, 'volume_ratio': 10.3},
            # Add more large caps for comparison
            {'symbol': 'RELIANCE', 'tv_gap': 0.5, 'volume_ratio': 1.2},
            {'symbol': 'TCS', 'tv_gap': 0.3, 'volume_ratio': 1.1},
            {'symbol': 'SBIN', 'tv_gap': 0.6, 'volume_ratio': 1.5},
            {'symbol': 'ICICIBANK', 'tv_gap': 0.4, 'volume_ratio': 1.4},
        ]
        
        return [stock for stock in potential_stocks if stock['volume_ratio'] >= 1.0]

    def detect_false_gap(self, symbol: str, gap_pct: float, volume_ratio: float) -> Dict:
        """
        Detect false gaps using multiple filters
        Returns quality score and reasoning
        """
        quality_score = 100  # Start with perfect score
        warning_flags = []
        
        try:
            # Get more historical context (5 days)
            df = self.api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date='2025-07-24',
                from_date='2025-07-18'
            )
            
            if df is None or len(df) < 3:
                return {'quality_score': 0, 'flags': ['No historical data'], 'recommendation': 'SKIP'}
            
            # 1. Gap Size Analysis
            if gap_pct > 8:
                quality_score -= 30
                warning_flags.append('Large gap >8% - high retracement risk')
            elif gap_pct < 1:
                quality_score -= 20
                warning_flags.append('Small gap <1% - insufficient momentum')
            
            # 2. Volume Confirmation
            if volume_ratio < 2:
                quality_score -= 25
                warning_flags.append('Low volume ratio <2x - weak institutional interest')
            elif volume_ratio > 50:
                quality_score += 10  # Bonus for very high volume
                
            # 3. Recent Volatility Check
            if len(df) >= 3:
                recent_changes = []
                for i in range(1, len(df)):
                    prev_close = df['close'].iloc[i-1]
                    current_close = df['close'].iloc[i]
                    daily_change = ((current_close - prev_close) / prev_close) * 100
                    recent_changes.append(abs(daily_change))
                
                avg_volatility = np.mean(recent_changes)
                if avg_volatility > 5:
                    quality_score -= 15
                    warning_flags.append(f'High recent volatility {avg_volatility:.1f}% - unpredictable')
            
            # 4. Price Level Analysis
            current_price = df['close'].iloc[-1]
            if current_price < 50:
                quality_score -= 10
                warning_flags.append('Low price stock <₹50 - higher manipulation risk')
            elif current_price > 2000:
                quality_score -= 5
                warning_flags.append('High price stock >₹2000 - lower liquidity')
            
            # 5. Market Cap Estimation (rough)
            # Assume based on price and volume patterns
            if current_price < 100 and volume_ratio < 5:
                quality_score -= 15
                warning_flags.append('Likely small-cap with low liquidity')
            
            # Determine recommendation
            if quality_score >= 80:
                recommendation = 'BUY'
            elif quality_score >= 60:
                recommendation = 'CAUTIOUS'
            else:
                recommendation = 'AVOID'
                
            return {
                'quality_score': max(0, quality_score),
                'flags': warning_flags,
                'recommendation': recommendation,
                'avg_volatility': avg_volatility if 'avg_volatility' in locals() else 0
            }
            
        except Exception as e:
            return {'quality_score': 0, 'flags': [f'Analysis error: {e}'], 'recommendation': 'SKIP'}

    def calculate_dynamic_targets(self, gap_pct: float, volume_ratio: float, quality_score: int) -> Dict:
        """
        Calculate dynamic stop loss and take profit based on gap characteristics
        """
        # Base parameters
        base_stop = 1.0
        base_target = 2.0
        
        # Adjust based on gap size
        if gap_pct > 5:
            # Large gaps - reduce target, increase stop (more conservative)
            target_multiplier = 0.8
            stop_multiplier = 1.2
        elif gap_pct > 2:
            # Medium gaps - standard parameters
            target_multiplier = 1.0
            stop_multiplier = 1.0
        else:
            # Small gaps - increase target, reduce stop (more aggressive)
            target_multiplier = 1.5
            stop_multiplier = 0.8
        
        # Adjust based on volume
        if volume_ratio > 20:
            # Very high volume - more confident, increase targets
            target_multiplier *= 1.3
        elif volume_ratio < 3:
            # Low volume - more conservative
            target_multiplier *= 0.8
            stop_multiplier *= 1.2
        
        # Adjust based on quality score
        if quality_score >= 80:
            target_multiplier *= 1.2  # High quality - more aggressive
        elif quality_score < 60:
            target_multiplier *= 0.7  # Low quality - very conservative
            stop_multiplier *= 1.3
        
        # Calculate final parameters
        dynamic_stop = base_stop * stop_multiplier
        dynamic_target = base_target * target_multiplier
        
        # Additional exit strategies
        partial_exit_1 = dynamic_target * 0.5  # Take 50% profit at half target
        partial_exit_2 = dynamic_target * 0.75  # Take 25% more at 75% target
        
        return {
            'stop_loss_pct': -dynamic_stop,
            'target_pct': dynamic_target,
            'partial_exit_1': partial_exit_1,
            'partial_exit_2': partial_exit_2,
            'reasoning': f'Gap: {gap_pct:.1f}%, Vol: {volume_ratio:.1f}x, Quality: {quality_score}'
        }

    def simulate_enhanced_trade(self, symbol: str, gap_info: Dict, targets: Dict, entry_date: str = '2025-07-23') -> Dict:
        """
        Simulate trade with enhanced exit strategies
        """
        try:
            # Get intraday data
            df = self.api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=5,
                to_date=entry_date,
                from_date=(pd.to_datetime(entry_date) - timedelta(days=1)).strftime('%Y-%m-%d')
            )
            
            if df is None or df.empty:
                return {'success': False, 'reason': 'No intraday data'}
            
            # Filter for trade date
            target_date = pd.to_datetime(entry_date).date()
            day_data = df[df.index.date == target_date].copy()
            
            if day_data.empty:
                return {'success': False, 'reason': 'No data for trade date'}
            
            # Entry logic - wait for confirmation
            entry_time = pd.Timestamp('09:30:00').time()
            day_data_copy = day_data.copy()
            day_data_copy['time'] = day_data_copy.index.time
            
            # Look for entry after 9:30 AM
            entry_candidates = day_data_copy[day_data_copy['time'] >= entry_time]
            if entry_candidates.empty:
                entry_price = day_data['open'].iloc[0]
                entry_time_actual = day_data.index[0]
            else:
                # Enter at first available price after 9:30
                entry_price = entry_candidates['open'].iloc[0]
                entry_time_actual = entry_candidates.index[0]
            
            # Position sizing
            qty = int(20000 / entry_price)
            if qty <= 0:
                return {'success': False, 'reason': 'Price too high'}
            
            # Calculate all exit levels
            stop_loss_price = entry_price * (1 + targets['stop_loss_pct']/100)
            target_price = entry_price * (1 + targets['target_pct']/100)
            partial_1_price = entry_price * (1 + targets['partial_exit_1']/100)
            partial_2_price = entry_price * (1 + targets['partial_exit_2']/100)
            
            # Track trade with multiple exits
            remaining_qty = qty
            total_exit_value = 0
            exit_details = []
            final_exit_reason = 'EOD'
            trade_active = True
            
            # Process each candle
            for idx, row in day_data.iterrows():
                if idx < entry_time_actual or not trade_active:
                    continue
                
                current_low = row['low']
                current_high = row['high']
                current_close = row['close']
                
                # Check stop loss first (priority)
                if current_low <= stop_loss_price and remaining_qty > 0:
                    exit_value = stop_loss_price * remaining_qty
                    total_exit_value += exit_value
                    exit_details.append({
                        'time': idx,
                        'price': stop_loss_price,
                        'qty': remaining_qty,
                        'reason': 'Stop Loss',
                        'pct': targets['stop_loss_pct']
                    })
                    remaining_qty = 0
                    final_exit_reason = 'Stop Loss'
                    trade_active = False
                    break
                
                # Check partial exits (in order)
                if current_high >= partial_1_price and remaining_qty == qty:
                    # First partial exit - 50% position
                    partial_qty = qty // 2
                    exit_value = partial_1_price * partial_qty
                    total_exit_value += exit_value
                    remaining_qty -= partial_qty
                    exit_details.append({
                        'time': idx,
                        'price': partial_1_price,
                        'qty': partial_qty,
                        'reason': 'Partial Exit 1',
                        'pct': targets['partial_exit_1']
                    })
                
                if current_high >= partial_2_price and remaining_qty > qty // 4:
                    # Second partial exit - 25% more
                    partial_qty = qty // 4
                    if partial_qty <= remaining_qty:
                        exit_value = partial_2_price * partial_qty
                        total_exit_value += exit_value
                        remaining_qty -= partial_qty
                        exit_details.append({
                            'time': idx,
                            'price': partial_2_price,
                            'qty': partial_qty,
                            'reason': 'Partial Exit 2',
                            'pct': targets['partial_exit_2']
                        })
                
                # Check full target
                if current_high >= target_price and remaining_qty > 0:
                    exit_value = target_price * remaining_qty
                    total_exit_value += exit_value
                    exit_details.append({
                        'time': idx,
                        'price': target_price,
                        'qty': remaining_qty,
                        'reason': 'Target Hit',
                        'pct': targets['target_pct']
                    })
                    remaining_qty = 0
                    final_exit_reason = 'Target Hit'
                    trade_active = False
                    break
            
            # Exit remaining position at EOD
            if remaining_qty > 0:
                eod_price = day_data['close'].iloc[-1]
                exit_value = eod_price * remaining_qty
                total_exit_value += exit_value
                eod_pct = ((eod_price - entry_price) / entry_price) * 100
                exit_details.append({
                    'time': day_data.index[-1],
                    'price': eod_price,
                    'qty': remaining_qty,
                    'reason': 'EOD',
                    'pct': eod_pct
                })
                final_exit_reason = 'EOD'
            
            # Calculate overall P&L
            entry_value = entry_price * qty
            gross_pnl = total_exit_value - entry_value
            pnl_pct = (gross_pnl / entry_value) * 100
            brokerage = len(exit_details) * 20 + 20  # ₹20 per leg + entry
            net_pnl = gross_pnl - brokerage
            
            return {
                'success': True,
                'entry_price': entry_price,
                'entry_time': entry_time_actual,
                'total_qty': qty,
                'exit_details': exit_details,
                'final_exit_reason': final_exit_reason,
                'gross_pnl': gross_pnl,
                'net_pnl': net_pnl,
                'pnl_pct': pnl_pct,
                'brokerage': brokerage,
                'stop_loss_price': stop_loss_price,
                'target_price': target_price,
                'num_exits': len(exit_details)
            }
            
        except Exception as e:
            return {'success': False, 'reason': f'Simulation error: {e}'}

    def run_optimization_analysis(self) -> pd.DataFrame:
        """
        Run comprehensive optimization analysis
        """
        print("\n🔬 Running Comprehensive Gap Strategy Optimization")
        print("="*60)
        
        gap_stocks = self.get_gap_stocks_with_data()
        all_results = []
        
        for i, stock_info in enumerate(gap_stocks, 1):
            symbol = stock_info['symbol']
            tv_gap = stock_info['tv_gap']
            volume_ratio = stock_info['volume_ratio']
            
            print(f"\n[{i}/{len(gap_stocks)}] 🧪 Analyzing {symbol}")
            print(f"  📊 TV Gap: {tv_gap:+.1f}% | Volume: {volume_ratio:.1f}x")
            
            # Step 1: Get actual historical gap
            try:
                df = self.api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date='2025-07-24',
                    from_date='2025-07-21'
                )
                
                if df is None or len(df) < 2:
                    print(f"  ❌ No historical data")
                    continue
                
                # Calculate actual gap
                prev_close = df['close'].iloc[-2]
                yesterday_open = df['open'].iloc[-1]
                actual_gap_pct = ((yesterday_open - prev_close) / prev_close) * 100
                
                if actual_gap_pct < 1.0:
                    print(f"  ⚪ Gap too small: {actual_gap_pct:+.2f}%")
                    continue
                
                print(f"  🎯 Actual Gap: {actual_gap_pct:+.2f}%")
                
            except Exception as e:
                print(f"  ❌ Data error: {e}")
                continue
            
            # Step 2: Analyze gap quality
            quality_analysis = self.detect_false_gap(symbol, actual_gap_pct, volume_ratio)
            quality_score = quality_analysis['quality_score']
            recommendation = quality_analysis['recommendation']
            
            print(f"  🔍 Quality Score: {quality_score}/100 | Recommendation: {recommendation}")
            
            if recommendation == 'AVOID':
                print(f"  ⚠️  Skipping due to quality concerns: {', '.join(quality_analysis['flags'])}")
                continue
            
            # Step 3: Calculate dynamic parameters
            targets = self.calculate_dynamic_targets(actual_gap_pct, volume_ratio, quality_score)
            print(f"  🎯 Dynamic Targets: Stop {targets['stop_loss_pct']:.1f}% | Target {targets['target_pct']:.1f}%")
            
            # Step 4: Simulate enhanced trade
            trade_result = self.simulate_enhanced_trade(symbol, {'gap_pct': actual_gap_pct}, targets)
            
            if trade_result['success']:
                result = {
                    'symbol': symbol,
                    'tv_gap_pct': tv_gap,
                    'actual_gap_pct': actual_gap_pct,
                    'volume_ratio': volume_ratio,
                    'quality_score': quality_score,
                    'recommendation': recommendation,
                    'dynamic_stop': targets['stop_loss_pct'],
                    'dynamic_target': targets['target_pct'],
                    'entry_price': trade_result['entry_price'],
                    'final_exit_reason': trade_result['final_exit_reason'],
                    'num_exits': trade_result['num_exits'],
                    'gross_pnl': trade_result['gross_pnl'],
                    'net_pnl': trade_result['net_pnl'],
                    'pnl_pct': trade_result['pnl_pct'],
                    'brokerage': trade_result['brokerage']
                }
                all_results.append(result)
                
                status = "✅" if trade_result['net_pnl'] > 0 else "❌"
                print(f"  {status} P&L: {trade_result['pnl_pct']:+.2f}% (₹{trade_result['net_pnl']:+,.0f}) | {trade_result['final_exit_reason']} | {trade_result['num_exits']} exits")
                
                # Show exit details
                for exit_detail in trade_result['exit_details']:
                    exit_time = exit_detail['time'].strftime('%H:%M')
                    print(f"    └─ {exit_time}: {exit_detail['reason']} {exit_detail['qty']} @ ₹{exit_detail['price']:.2f} ({exit_detail['pct']:+.1f}%)")
            else:
                print(f"  ❌ Simulation failed: {trade_result['reason']}")
            
            time.sleep(0.3)  # Rate limiting
        
        if all_results:
            results_df = pd.DataFrame(all_results)
            self.analyze_optimization_results(results_df)
            return results_df
        else:
            print("\n❌ No successful optimizations found")
            return pd.DataFrame()

    def analyze_optimization_results(self, results_df: pd.DataFrame):
        """Analyze optimization results and provide recommendations"""
        print("\n" + "="*60)
        print("📊 OPTIMIZATION ANALYSIS RESULTS")
        print("="*60)
        
        if results_df.empty:
            print("No results to analyze")
            return
        
        # Basic stats
        total_trades = len(results_df)
        winning_trades = len(results_df[results_df['net_pnl'] > 0])
        win_rate = (winning_trades / total_trades) * 100
        
        total_pnl = results_df['net_pnl'].sum()
        avg_pnl = results_df['net_pnl'].mean()
        
        print(f"📈 Total Trades: {total_trades}")
        print(f"🎯 Win Rate: {win_rate:.1f}% ({winning_trades}/{total_trades})")
        print(f"💰 Total P&L: ₹{total_pnl:,.0f}")
        print(f"📊 Average P&L: ₹{avg_pnl:,.0f}")
        
        # Quality score analysis
        high_quality = results_df[results_df['quality_score'] >= 80]
        medium_quality = results_df[(results_df['quality_score'] >= 60) & (results_df['quality_score'] < 80)]
        low_quality = results_df[results_df['quality_score'] < 60]
        
        print(f"\n🔍 QUALITY SCORE BREAKDOWN:")
        if not high_quality.empty:
            hq_winrate = (len(high_quality[high_quality['net_pnl'] > 0]) / len(high_quality)) * 100
            print(f"  🟢 High Quality (≥80): {len(high_quality)} trades, {hq_winrate:.1f}% win rate, ₹{high_quality['net_pnl'].sum():,.0f} P&L")
        
        if not medium_quality.empty:
            mq_winrate = (len(medium_quality[medium_quality['net_pnl'] > 0]) / len(medium_quality)) * 100
            print(f"  🟡 Medium Quality (60-79): {len(medium_quality)} trades, {mq_winrate:.1f}% win rate, ₹{medium_quality['net_pnl'].sum():,.0f} P&L")
        
        if not low_quality.empty:
            lq_winrate = (len(low_quality[low_quality['net_pnl'] > 0]) / len(low_quality)) * 100
            print(f"  🔴 Low Quality (<60): {len(low_quality)} trades, {lq_winrate:.1f}% win rate, ₹{low_quality['net_pnl'].sum():,.0f} P&L")
        
        # Exit strategy analysis
        print(f"\n🚪 EXIT STRATEGY ANALYSIS:")
        exit_reasons = results_df['final_exit_reason'].value_counts()
        for reason, count in exit_reasons.items():
            reason_df = results_df[results_df['final_exit_reason'] == reason]
            reason_pnl = reason_df['net_pnl'].sum()
            print(f"  • {reason}: {count} trades, ₹{reason_pnl:,.0f} total P&L")
        
        # Multi-exit analysis
        multi_exit_trades = results_df[results_df['num_exits'] > 1]
        if not multi_exit_trades.empty:
            multi_pnl = multi_exit_trades['net_pnl'].sum()
            multi_avg = multi_exit_trades['net_pnl'].mean()
            print(f"\n📊 MULTI-EXIT TRADES: {len(multi_exit_trades)} trades")
            print(f"  💰 Total P&L: ₹{multi_pnl:,.0f}")
            print(f"  📈 Average: ₹{multi_avg:,.0f}")
        
        # Top performers
        print(f"\n🏆 TOP 3 OPTIMIZED TRADES:")
        top_3 = results_df.nlargest(3, 'net_pnl')
        for i, (_, trade) in enumerate(top_3.iterrows(), 1):
            print(f"  {i}. {trade['symbol']:12} | Gap: {trade['actual_gap_pct']:+.1f}% | Quality: {trade['quality_score']:3.0f} | P&L: ₹{trade['net_pnl']:+6.0f} ({trade['pnl_pct']:+.1f}%)")
        
        # Recommendations
        print(f"\n💡 OPTIMIZATION RECOMMENDATIONS:")
        
        if not high_quality.empty and high_quality['net_pnl'].mean() > results_df['net_pnl'].mean():
            print(f"  ✅ Focus on high-quality gaps (score ≥80) - they perform {high_quality['net_pnl'].mean() - results_df['net_pnl'].mean():+.0f} better on average")
        
        best_exit = exit_reasons.index[0]
        if best_exit != 'Stop Loss':
            print(f"  ✅ {best_exit} is the most common exit - strategy exits are working")
        
        if multi_exit_trades['net_pnl'].mean() > results_df['net_pnl'].mean():
            print(f"  ✅ Multi-exit strategy improves performance by ₹{multi_exit_trades['net_pnl'].mean() - results_df['net_pnl'].mean():+.0f} per trade")
        
        if win_rate < 60:
            print(f"  ⚠️  Win rate {win_rate:.1f}% could be improved - consider tighter quality filters")
        
        # Save results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"optimized_gap_analysis_{timestamp}.csv"
        results_df.to_csv(filename, index=False)
        print(f"\n💾 Optimization results saved to: {filename}")


def main():
    """Run the optimization analysis"""
    optimizer = OptimizedGapStrategy()
    results = optimizer.run_optimization_analysis()
    
    if not results.empty:
        print(f"\n🎉 Optimization completed!")
        print(f"📊 Enhanced strategy tested on {len(results)} trades")
        print(f"💡 Check the detailed analysis above for improvement recommendations")


if __name__ == "__main__":
    main()
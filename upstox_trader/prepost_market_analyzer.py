#!/usr/bin/env python3
"""
Pre/Post Market Data Analyzer
Analyzes pre-market and post-market trading data for gap and sentiment analysis
"""

from tradingview_screener import Query, Column
import pandas as pd
import numpy as np
from datetime import datetime
import sys

def get_prepost_market_data(limit=100, min_market_cap=500_000_000):
    """
    Get comprehensive pre/post market data
    
    Args:
        limit: Maximum number of results
        min_market_cap: Minimum market cap
    """
    
    print(f'📊 PRE/POST MARKET ANALYZER - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    print('=' * 80)
    print(f'Analyzing pre/post market data for top {limit} stocks')
    print()
    
    col = Column
    
    query = (Query()
        .select('name', 'close', 'open', 'high', 'low', 'change', 'volume',
                'gap', 'premarket_change', 'postmarket_change',
                'premarket_change_abs', 'postmarket_change_abs',
                'RSI', 'relative_volume_10d_calc', 'average_volume_10d_calc',
                'market_cap_basic', 'beta_1_year', 'ATR', 'Volatility.D',
                'price_52_week_high', 'price_52_week_low', 'sector')
        .set_markets('america')
        .where(
            col('market_cap_basic') > min_market_cap,
            col('volume') > 500_000,
            col('close') > 20
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(limit))
    
    try:
        data = query.get_scanner_data()
        
        if not data or len(data) < 2 or len(data[1]) == 0:
            print("❌ No pre/post market data found")
            return None
            
        df = data[1]
        
        # Convert numeric columns
        numeric_cols = ['close', 'open', 'high', 'low', 'change', 'volume',
                       'gap', 'premarket_change', 'postmarket_change',
                       'premarket_change_abs', 'postmarket_change_abs',
                       'RSI', 'relative_volume_10d_calc', 'average_volume_10d_calc',
                       'market_cap_basic', 'beta_1_year', 'ATR', 'Volatility.D',
                       'price_52_week_high', 'price_52_week_low']
        
        for col_name in numeric_cols:
            if col_name in df.columns:
                df[col_name] = pd.to_numeric(df[col_name], errors='coerce')
        
        return df
        
    except Exception as e:
        print(f'❌ Error: {e}')
        return None

def analyze_gap_patterns(df):
    """Analyze gap patterns and their follow-through"""
    
    if df is None or 'gap' not in df.columns:
        print("❌ No gap data available")
        return
    
    print("📊 GAP ANALYSIS:")
    print("=" * 50)
    
    # Filter out extreme gaps and missing data
    gap_data = df[df['gap'].notna() & (df['gap'].abs() < 20)].copy()
    
    if len(gap_data) == 0:
        print("No gap data available for analysis")
        return
    
    # Gap categories
    gap_up_large = gap_data[gap_data['gap'] > 3]
    gap_up_small = gap_data[(gap_data['gap'] > 0) & (gap_data['gap'] <= 3)]
    gap_down_small = gap_data[(gap_data['gap'] < 0) & (gap_data['gap'] >= -3)]
    gap_down_large = gap_data[gap_data['gap'] < -3]
    no_gap = gap_data[gap_data['gap'].abs() <= 0.5]
    
    print(f"📈 Large Gap Up (>3%): {len(gap_up_large)} stocks")
    print(f"📈 Small Gap Up (0-3%): {len(gap_up_small)} stocks")
    print(f"📉 Small Gap Down (0-3%): {len(gap_down_small)} stocks")
    print(f"📉 Large Gap Down (>3%): {len(gap_down_large)} stocks")
    print(f"😐 No Gap (<0.5%): {len(no_gap)} stocks")
    print()
    
    # Gap follow-through analysis
    if len(gap_up_large) > 0:
        print("🚀 LARGE GAP UP ANALYSIS:")
        print("-" * 30)
        gap_up_analysis = gap_up_large[['name', 'gap', 'change', 'volume', 'relative_volume_10d_calc']].head(10)
        gap_up_analysis['follow_through'] = gap_up_analysis['change'] - gap_up_analysis['gap']
        gap_up_analysis['vol_ratio'] = gap_up_analysis['relative_volume_10d_calc']
        
        for idx, row in gap_up_analysis.iterrows():
            follow_through = "✅ Continued" if row['follow_through'] > 0 else "❌ Faded"
            vol_status = "🔥 High" if row['vol_ratio'] > 2 else "📊 Normal"
            
            print(f"  {row['name']}: Gap {row['gap']:.1f}%, Change {row['change']:.1f}% ({follow_through})")
            print(f"    Volume: {vol_status} ({row['vol_ratio']:.1f}x average)")
        print()
    
    if len(gap_down_large) > 0:
        print("📉 LARGE GAP DOWN ANALYSIS:")
        print("-" * 30)
        gap_down_analysis = gap_down_large[['name', 'gap', 'change', 'volume', 'relative_volume_10d_calc']].head(10)
        gap_down_analysis['recovery'] = gap_down_analysis['change'] - gap_down_analysis['gap']
        gap_down_analysis['vol_ratio'] = gap_down_analysis['relative_volume_10d_calc']
        
        for idx, row in gap_down_analysis.iterrows():
            recovery = "🔄 Recovering" if row['recovery'] > 1 else "📉 Continuing Down"
            vol_status = "🔥 High" if row['vol_ratio'] > 2 else "📊 Normal"
            
            print(f"  {row['name']}: Gap {row['gap']:.1f}%, Change {row['change']:.1f}% ({recovery})")
            print(f"    Volume: {vol_status} ({row['vol_ratio']:.1f}x average)")
        print()
    
    return gap_data

def analyze_prepost_correlation(df):
    """Analyze correlation between pre-market and regular session"""
    
    if df is None:
        return
    
    print("🕐 PRE-MARKET vs REGULAR HOURS CORRELATION:")
    print("=" * 55)
    
    # Filter data with both pre-market and regular session data
    correlation_data = df[
        df['premarket_change'].notna() & 
        df['change'].notna() & 
        (df['premarket_change'].abs() > 0.1)  # Filter out minimal pre-market moves
    ].copy()
    
    if len(correlation_data) == 0:
        print("No correlation data available")
        return
    
    # Calculate correlation
    if len(correlation_data) > 5:
        correlation = correlation_data['premarket_change'].corr(correlation_data['change'])
        print(f"📊 Pre-market vs Regular Hours Correlation: {correlation:.3f}")
        
        if correlation > 0.7:
            print("✅ Strong positive correlation - pre-market predicts regular hours")
        elif correlation > 0.4:
            print("📊 Moderate correlation - pre-market somewhat predictive") 
        elif correlation > 0.1:
            print("⚠️ Weak correlation - pre-market not very predictive")
        else:
            print("❌ No correlation - pre-market and regular hours disconnected")
        print()
    
    # Analyze continuation patterns
    print("📈 PRE-MARKET CONTINUATION PATTERNS:")
    print("-" * 40)
    
    # Positive pre-market continuation
    positive_pre = correlation_data[correlation_data['premarket_change'] > 1]
    if len(positive_pre) > 0:
        continued_positive = positive_pre[positive_pre['change'] > 0]
        continuation_rate = len(continued_positive) / len(positive_pre) * 100
        
        print(f"🟢 Positive Pre-market (>{1}%): {len(positive_pre)} stocks")
        print(f"   Continued positive in regular hours: {continuation_rate:.1f}%")
        
        if len(positive_pre) > 0:
            avg_pre = positive_pre['premarket_change'].mean()
            avg_regular = positive_pre['change'].mean() 
            print(f"   Average pre-market: {avg_pre:.1f}%, Average regular: {avg_regular:.1f}%")
    
    # Negative pre-market continuation  
    negative_pre = correlation_data[correlation_data['premarket_change'] < -1]
    if len(negative_pre) > 0:
        continued_negative = negative_pre[negative_pre['change'] < 0]
        continuation_rate = len(continued_negative) / len(negative_pre) * 100
        
        print(f"🔴 Negative Pre-market (<-{1}%): {len(negative_pre)} stocks")
        print(f"   Continued negative in regular hours: {continuation_rate:.1f}%")
        
        if len(negative_pre) > 0:
            avg_pre = negative_pre['premarket_change'].mean()
            avg_regular = negative_pre['change'].mean()
            print(f"   Average pre-market: {avg_pre:.1f}%, Average regular: {avg_regular:.1f}%")
    
    print()
    return correlation_data

def find_gap_trading_opportunities(df):
    """Find specific gap trading opportunities"""
    
    if df is None:
        return
    
    print("🎯 GAP TRADING OPPORTUNITIES:")
    print("=" * 45)
    
    # Gap and Go (continuation) opportunities
    gap_and_go = df[
        (df['gap'] > 2) & 
        (df['change'] > df['gap']) & 
        (df['relative_volume_10d_calc'] > 1.5) &
        (df['RSI'] < 80)  # Not overbought
    ].copy()
    
    if len(gap_and_go) > 0:
        print(f"🚀 GAP AND GO OPPORTUNITIES ({len(gap_and_go)} found):")
        print("-" * 35)
        
        for idx, row in gap_and_go.head(10).iterrows():
            momentum = row['change'] - row['gap']
            vol_multiple = row['relative_volume_10d_calc']
            
            print(f"  📈 {row['name']}: ${row['close']:.2f}")
            print(f"      Gap: {row['gap']:.1f}% → Change: {row['change']:.1f}% (Momentum: +{momentum:.1f}%)")
            print(f"      Volume: {vol_multiple:.1f}x average | RSI: {row['RSI']:.1f}")
            
            # Entry/exit recommendations
            entry = row['close'] * 1.01  # 1% above current price
            stop = row['close'] * 0.96   # 4% stop loss
            target = row['close'] * 1.08  # 8% target
            
            print(f"      💡 Entry: ${entry:.2f} | Stop: ${stop:.2f} | Target: ${target:.2f}")
            print()
    
    # Gap Fill opportunities (reversal)
    gap_fill = df[
        (df['gap'].abs() > 2) & 
        (np.sign(df['gap']) != np.sign(df['change'])) &  # Opposite direction
        (df['relative_volume_10d_calc'] > 2) &
        (df['RSI'].between(30, 70))
    ].copy()
    
    if len(gap_fill) > 0:
        print(f"🔄 GAP FILL/REVERSAL OPPORTUNITIES ({len(gap_fill)} found):")
        print("-" * 45)
        
        for idx, row in gap_fill.head(8).iterrows():
            gap_direction = "Up" if row['gap'] > 0 else "Down"
            change_direction = "recovering" if row['change'] > 0 else "continuing down"
            
            print(f"  🔄 {row['name']}: ${row['close']:.2f}")
            print(f"      Gapped {gap_direction} {row['gap']:.1f}% but {change_direction} {row['change']:.1f}%")
            print(f"      Volume: {row['relative_volume_10d_calc']:.1f}x | RSI: {row['RSI']:.1f}")
            
            # Strategy depends on gap direction
            if row['gap'] > 0 and row['change'] < 0:
                print(f"      💡 Strategy: Gap down from gap up - possible continuation down")
            elif row['gap'] < 0 and row['change'] > 0:
                print(f"      💡 Strategy: Recovery from gap down - possible reversal")
            print()

def analyze_after_hours_sentiment(df):
    """Analyze post-market sentiment"""
    
    if df is None or 'postmarket_change' not in df.columns:
        print("❌ No post-market data available")
        return
    
    print("🌙 AFTER-HOURS SENTIMENT ANALYSIS:")
    print("=" * 45)
    
    # Filter post-market data
    postmarket_data = df[df['postmarket_change'].notna() & (df['postmarket_change'].abs() > 0.2)].copy()
    
    if len(postmarket_data) == 0:
        print("No significant after-hours movement found")
        return
    
    # Post-market movers
    positive_ah = postmarket_data[postmarket_data['postmarket_change'] > 1]
    negative_ah = postmarket_data[postmarket_data['postmarket_change'] < -1]
    
    print(f"📊 After-hours movers (>{0.2}% change): {len(postmarket_data)} stocks")
    print(f"🟢 Positive after-hours (>{1}%): {len(positive_ah)} stocks")  
    print(f"🔴 Negative after-hours (<-{1}%): {len(negative_ah)} stocks")
    print()
    
    # Top after-hours movers
    if len(positive_ah) > 0:
        print("🚀 TOP AFTER-HOURS GAINERS:")
        print("-" * 30)
        
        top_ah_gainers = positive_ah.nlargest(8, 'postmarket_change')
        for idx, row in top_ah_gainers.iterrows():
            regular_vs_ah = "Continued" if np.sign(row['change']) == np.sign(row['postmarket_change']) else "Reversed"
            
            print(f"  📈 {row['name']}: Regular {row['change']:.1f}% → AH {row['postmarket_change']:.1f}% ({regular_vs_ah})")
            
            # Predict next day based on pattern
            if row['postmarket_change'] > 3:
                print(f"      💡 Next day: Potential gap up, watch for continuation or fade")
            elif row['postmarket_change'] > 1:
                print(f"      💡 Next day: Small gap up likely, good for gap trading")
        print()
    
    if len(negative_ah) > 0:
        print("📉 TOP AFTER-HOURS LOSERS:")
        print("-" * 30)
        
        top_ah_losers = negative_ah.nsmallest(8, 'postmarket_change')
        for idx, row in top_ah_losers.iterrows():
            regular_vs_ah = "Continued" if np.sign(row['change']) == np.sign(row['postmarket_change']) else "Reversed"
            
            print(f"  📉 {row['name']}: Regular {row['change']:.1f}% → AH {row['postmarket_change']:.1f}% ({regular_vs_ah})")
            
            # Predict next day
            if row['postmarket_change'] < -3:
                print(f"      💡 Next day: Potential gap down, watch for bounce or continuation")
            elif row['postmarket_change'] < -1:
                print(f"      💡 Next day: Small gap down likely, reversal opportunity")
        print()


def generate_tomorrow_watchlist(df):
    """Generate tomorrow's watchlist with specific trading opportunities"""

    if df is None:
        return None

    print("🎯 TOMORROW'S WATCHLIST:")
    print("=" * 50)

    watchlist = []

    # 1. Gap and Go Opportunities (High conviction)
    gap_and_go = df[
        (df['gap'] > 2) &
        (df['change'] > df['gap'] * 0.8) &  # Most of gap maintained
        (df['relative_volume_10d_calc'] > 1.5) &
        (df['RSI'] < 80)
    ].copy()

    if len(gap_and_go) > 0:
        print("🚀 GAP AND GO (High Conviction):")
        print("-" * 40)

        for idx, row in gap_and_go.head(8).iterrows():
            momentum = row['change'] - row['gap']
            entry = row['close'] * 1.01
            stop = row['close'] * 0.96
            target = row['close'] * 1.08

            watchlist.append({
                'symbol': row['name'],
                'strategy': 'Gap and Go',
                'entry': entry,
                'stop': stop,
                'target': target,
                'conviction': 'HIGH',
                'reasoning': f"Gap {row['gap']:.1f}% → Change {row['change']:.1f}%"
            })

            print(f"  📈 {row['name']}: ${row['close']:.2f}")
            print(f"      Gap: {row['gap']:.1f}% → Change: {row['change']:.1f}%")
            print(f"      💡 Entry: ${entry:.2f} | Stop: ${stop:.2f} | Target: ${target:.2f}")
            print(f"      🎯 Watch: 9:30-10:30 AM for continuation")
            print()

    # 2. Gap Fade/Reversal Opportunities
    gap_fade = df[
        (df['gap'].abs() > 2) &
        (np.sign(df['gap']) != np.sign(df['change'])) &
        (df['relative_volume_10d_calc'] > 2) &
        (df['RSI'].between(30, 70))
    ].copy()

    if len(gap_fade) > 0:
        print("🔄 GAP FADE/REVERSAL:")
        print("-" * 30)

        for idx, row in gap_fade.head(6).iterrows():
            if row['gap'] > 0 and row['change'] < 0:
                # Gap up faded - short opportunity
                entry = row['close'] * 0.99
                stop = row['close'] * 1.02
                target = row['close'] * 0.94
                strategy = "Gap Up Fade (Short)"

                print(f"  📉 {row['name']}: ${row['close']:.2f}")
                print(f"      Gapped up {row['gap']:.1f}% but closed down {row['change']:.1f}%")
                print(f"      💡 Strategy: Short | Entry: ${entry:.2f} | Stop: ${stop:.2f} | Target: ${target:.2f}")
                print(f"      🎯 Watch: First 30 min for continued downside")

                watchlist.append({
                    'symbol': row['name'],
                    'strategy': strategy,
                    'entry': entry,
                    'stop': stop,
                    'target': target,
                    'conviction': 'MEDIUM',
                    'reasoning': f"Gap up faded {row['gap']:.1f}% to {row['change']:.1f}%"
                })
            else:
                # Gap down recovery - long opportunity
                entry = row['close'] * 1.01
                stop = row['close'] * 0.96
                target = row['close'] * 1.06
                strategy = "Gap Down Recovery (Long)"

                print(f"  📈 {row['name']}: ${row['close']:.2f}")
                print(f"      Gapped down {row['gap']:.1f}% but recovered to {row['change']:.1f}%")
                print(f"      💡 Strategy: Long | Entry: ${entry:.2f} | Stop: ${stop:.2f} | Target: ${target:.2f}")
                print(f"      🎯 Watch: 10:00-11:00 AM for bounce confirmation")

                watchlist.append({
                    'symbol': row['name'],
                    'strategy': strategy,
                    'entry': entry,
                    'stop': stop,
                    'target': target,
                    'conviction': 'MEDIUM',
                    'reasoning': f"Gap down recovered {row['gap']:.1f}% to {row['change']:.1f}%"
                })
            print()

    # 3. After-hours momentum for next day
    if 'postmarket_change' in df.columns:
        ah_momentum = df[
            (df['postmarket_change'].abs() > 2) &
            (df['relative_volume_10d_calc'] > 1.2)
        ].copy()

        if len(ah_momentum) > 0:
            print("🌙 AFTER-HOURS MOMENTUM:")
            print("-" * 30)

            for idx, row in ah_momentum.head(5).iterrows():
                ah_dir = "UP" if row['postmarket_change'] > 0 else "DOWN"
                gap_likely = "up" if row['postmarket_change'] > 0 else "down"

                print(f"  {row['name']}: After-hours {ah_dir} {row['postmarket_change']:.1f}%")
                print(f"    💡 Expect gap {gap_likely} tomorrow | Volume: {row['relative_volume_10d_calc']:.1f}x")
                print(f"    🎯 Watch: Pre-market (4:00-9:30 AM) for direction")

                watchlist.append({
                    'symbol': row['name'],
                    'strategy': f'After-hours {ah_dir} Setup',
                    'entry': 0,  # Set in pre-market
                    'stop': 0,   # Set in pre-market
                    'target': 0, # Set in pre-market
                    'conviction': 'MEDIUM',
                    'reasoning': f'AH {row["postmarket_change"]:.1f}% move'
                })
                print()

    # 4. Unusual volume alerts (potential news/catalyst)
    unusual_volume = df[
        (df['relative_volume_10d_calc'] > 3) &
        (df['gap'].abs() < 2) &
        (df['change'].abs() > 2)
    ].copy()

    if len(unusual_volume) > 0:
        print("⚡ UNUSUAL VOLUME (Potential Catalyst):")
        print("-" * 40)

        for idx, row in unusual_volume.head(5).iterrows():
            print(f"  {row['name']}: Volume {row['relative_volume_10d_calc']:.1f}x | Change {row['change']:.1f}%")
            print(f"    💡 Check news/catalyst | Watch for follow-through")
            print(f"    🎯 Monitor: First hour for direction confirmation")

            watchlist.append({
                'symbol': row['name'],
                'strategy': 'Unusual Volume Setup',
                'entry': row['close'] * (1.02 if row['change'] > 0 else 0.98),
                'stop': row['close'] * (0.96 if row['change'] > 0 else 1.04),
                'target': row['close'] * (1.08 if row['change'] > 0 else 0.92),
                'conviction': 'LOW-MEDIUM',
                'reasoning': f'Unusual volume {row["relative_volume_10d_calc"]:.1f}x'
            })
            print()

    if not watchlist:
        print("📊 No high-conviction setups for tomorrow")
        print("💡 Monitor market in first 30 minutes for new opportunities")
        return None

    print(f"📋 TOTAL WATCHLIST ITEMS: {len(watchlist)}")
    print("=" * 50)

    return watchlist

def generate_trading_alerts(df):
    """Generate specific trading alerts based on pre/post market data"""

    if df is None:
        return

    print("🚨 TRADING ALERTS & RECOMMENDATIONS:")
    print("=" * 50)

    alerts = []

    # Large gap alerts
    large_gaps = df[df['gap'].abs() > 3].copy()
    if len(large_gaps) > 0:
        alerts.append("🔥 LARGE GAP ALERT")
        print("🔥 LARGE GAP ALERT:")
        for _, row in large_gaps.head(5).iterrows():
            gap_type = "UP ⬆️" if row['gap'] > 0 else "DOWN ⬇️"
            print(f"  {row['name']}: {gap_type} {row['gap']:.1f}% | Volume: {row['relative_volume_10d_calc']:.1f}x")

    # High volume with small gaps (unusual activity)
    unusual_activity = df[(df['relative_volume_10d_calc'] > 3) & (df['gap'].abs() < 2)].copy()
    if len(unusual_activity) > 0:
        alerts.append("⚡ UNUSUAL VOLUME ALERT")
        print("\n⚡ UNUSUAL VOLUME ALERT:")
        for _, row in unusual_activity.head(5).iterrows():
            print(f"  {row['name']}: Volume {row['relative_volume_10d_calc']:.1f}x | Small gap {row['gap']:.1f}%")
            print("    💡 Potential news or insider activity")

    # Pre-market vs regular hours divergence
    if 'premarket_change' in df.columns:
        divergence = df[
            (df['premarket_change'].abs() > 2) &
            (np.sign(df['premarket_change']) != np.sign(df['change'])) &
            (df['change'].abs() > 1)
        ].copy()

        if len(divergence) > 0:
            alerts.append("🔄 PRE-MARKET REVERSAL ALERT")
            print("\n🔄 PRE-MARKET REVERSAL ALERT:")
            for _, row in divergence.head(3).iterrows():
                pre_dir = "UP" if row['premarket_change'] > 0 else "DOWN"
                reg_dir = "DOWN" if row['change'] < 0 else "UP"
                print(f"  {row['name']}: Pre-market {pre_dir} {row['premarket_change']:.1f}% → Regular {reg_dir} {row['change']:.1f}%")
                print("    💡 Sentiment reversal - monitor closely")

    # After hours continuation setup
    if 'postmarket_change' in df.columns:
        ah_setup = df[df['postmarket_change'].abs() > 2].copy()
        if len(ah_setup) > 0:
            alerts.append("🌙 AFTER-HOURS SETUP")
            print("\n🌙 AFTER-HOURS SETUP FOR TOMORROW:")
            for _, row in ah_setup.head(3).iterrows():
                ah_dir = "UP ⬆️" if row['postmarket_change'] > 0 else "DOWN ⬇️"
                print(f"  {row['name']}: After-hours {ah_dir} {row['postmarket_change']:.1f}%")
                if row['postmarket_change'] > 0:
                    print("    💡 Watch for gap up tomorrow - continuation or fade play")
                else:
                    print("    💡 Watch for gap down tomorrow - bounce or breakdown play")

    if not alerts:
        print("📊 No major alerts at this time")
        print("💡 Monitor for gap opportunities and unusual volume activity")

    print()

def main():
    """Main execution function"""

    # Default parameters
    limit = 100
    min_market_cap = 500_000_000

    # Handle command line arguments
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == '--limit' and i + 1 < len(args):
            try:
                limit = int(args[i + 1])
            except:
                pass
        elif arg == '--min-market-cap' and i + 1 < len(args):
            try:
                min_market_cap = int(args[i + 1])
            except:
                pass
        elif arg.isdigit() and i == 0:  # Backward compatibility - first arg as limit
            try:
                limit = int(arg)
            except:
                pass

    # Get pre/post market data
    market_data = get_prepost_market_data(limit=limit, min_market_cap=min_market_cap)

    if market_data is None:
        print("❌ Unable to retrieve market data")
        return

    # Run analysis
    print(f"✅ Analyzing {len(market_data)} stocks for pre/post market patterns\n")

    # Gap analysis
    gap_data = analyze_gap_patterns(market_data)

    # Pre-market correlation
    correlation_data = analyze_prepost_correlation(market_data)

    # Trading opportunities
    find_gap_trading_opportunities(market_data)

    # After-hours sentiment
    analyze_after_hours_sentiment(market_data)


    # Generate tomorrow's watchlist
    tomorrow_watchlist = generate_tomorrow_watchlist(market_data)

    # Trading alerts
    generate_trading_alerts(market_data)

    # Save results
    filename = f"prepost_market_analysis_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    market_data.to_csv(filename, index=False)
    print(f"💾 Full analysis saved to: {filename}")

    # Save watchlist if available
    if tomorrow_watchlist:
        watchlist_df = pd.DataFrame(tomorrow_watchlist)
        watchlist_filename = f"tomorrow_watchlist_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
        watchlist_df.to_csv(watchlist_filename, index=False)
        print(f"📋 Tomorrow's watchlist saved to: {watchlist_filename}")

        print("\n🎯 TOMORROW'S KEY FOCUS:")
        print("=" * 40)

        # Summary of high conviction setups
        high_conviction = [item for item in tomorrow_watchlist if item['conviction'] == 'HIGH']
        if high_conviction:
            print(f"🚨 HIGH PRIORITY ({len(high_conviction)} setups):")
            for item in high_conviction[:3]:
                print(f"   • {item['symbol']} - {item['strategy']}")
                print(f"     Entry: ${item['entry']:.2f} | Target: ${item['target']:.2f}")

        # Market preparation tips
        print("\n⏰ MARKET PREP CHECKLIST:")
        print("   ✅ Check pre-market futures (ES/NQ) for direction")
        print("   ✅ Review after-hours earnings/news")
        print("   ✅ Monitor VIX for volatility expectations")
        print("   ✅ Set price alerts for watchlist entries")
        print("   ✅ Prepare both long and short watchlists")
    print("=" * 60)

if __name__ == "__main__":
    main()
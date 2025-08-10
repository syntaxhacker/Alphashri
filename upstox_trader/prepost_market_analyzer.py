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
import matplotlib.pyplot as plt
import seaborn as sns

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

def create_prepost_visualizations(df):
    """Create visualizations for pre/post market analysis"""
    
    if df is None:
        return
    
    print("📊 CREATING PRE/POST MARKET VISUALIZATIONS...")
    
    # Create figure with subplots
    fig, axes = plt.subplots(2, 2, figsize=(20, 16))
    fig.suptitle('📊 Pre/Post Market Analysis Dashboard', fontsize=20, fontweight='bold')
    
    # 1. Gap vs Regular Hours Performance
    ax1 = axes[0, 0]
    gap_change_data = df[df['gap'].notna() & df['change'].notna()].copy()
    
    if len(gap_change_data) > 10:
        colors = ['green' if x > 0 else 'red' for x in gap_change_data['change']]
        ax1.scatter(gap_change_data['gap'], gap_change_data['change'], 
                   c=colors, alpha=0.6, s=60, edgecolor='black')
        ax1.axhline(0, color='black', linestyle='-', alpha=0.5)
        ax1.axvline(0, color='black', linestyle='-', alpha=0.5)
        ax1.set_xlabel('Gap %')
        ax1.set_ylabel('Regular Hours Change %')
        ax1.set_title('📊 Gap vs Regular Hours Performance', fontsize=14, fontweight='bold')
        ax1.grid(True, alpha=0.3)
        
        # Add correlation line if enough data
        if len(gap_change_data) > 5:
            z = np.polyfit(gap_change_data['gap'], gap_change_data['change'], 1)
            p = np.poly1d(z)
            ax1.plot(gap_change_data['gap'], p(gap_change_data['gap']), "r--", alpha=0.8)
    else:
        ax1.text(0.5, 0.5, 'Insufficient gap data', ha='center', va='center',
                transform=ax1.transAxes, fontsize=12)
    
    # 2. Pre-market vs Regular Hours
    ax2 = axes[0, 1]
    premarket_data = df[df['premarket_change'].notna() & df['change'].notna()].copy()
    
    if len(premarket_data) > 5:
        colors = ['blue' if abs(x) < 2 else 'orange' for x in premarket_data['premarket_change']]
        ax2.scatter(premarket_data['premarket_change'], premarket_data['change'],
                   c=colors, alpha=0.6, s=60, edgecolor='black')
        ax2.axhline(0, color='black', linestyle='-', alpha=0.5)
        ax2.axvline(0, color='black', linestyle='-', alpha=0.5)
        ax2.set_xlabel('Pre-market Change %')
        ax2.set_ylabel('Regular Hours Change %')
        ax2.set_title('🕐 Pre-market vs Regular Hours', fontsize=14, fontweight='bold')
        ax2.grid(True, alpha=0.3)
        
        # Add perfect correlation line
        max_val = max(abs(premarket_data['premarket_change'].max()), 
                     abs(premarket_data['change'].max()))
        ax2.plot([-max_val, max_val], [-max_val, max_val], 'r--', alpha=0.7, 
                label='Perfect Correlation')
        ax2.legend()
    else:
        ax2.text(0.5, 0.5, 'Insufficient pre-market data', ha='center', va='center',
                transform=ax2.transAxes, fontsize=12)
    
    # 3. Gap Distribution
    ax3 = axes[1, 0]
    gap_data = df[df['gap'].notna() & (df['gap'].abs() < 15)]['gap']
    
    if len(gap_data) > 0:
        ax3.hist(gap_data, bins=30, alpha=0.7, color='skyblue', edgecolor='black')
        ax3.axvline(0, color='red', linestyle='-', linewidth=2, label='No Gap')
        ax3.axvline(gap_data.mean(), color='orange', linestyle='--', linewidth=2,
                   label=f'Mean: {gap_data.mean():.2f}%')
        ax3.set_xlabel('Gap %')
        ax3.set_ylabel('Frequency')
        ax3.set_title('📊 Gap Distribution', fontsize=14, fontweight='bold')
        ax3.legend()
        ax3.grid(True, alpha=0.3)
    else:
        ax3.text(0.5, 0.5, 'No gap data', ha='center', va='center',
                transform=ax3.transAxes, fontsize=12)
    
    # 4. Volume vs Gap Size
    ax4 = axes[1, 1]
    vol_gap_data = df[df['gap'].notna() & df['relative_volume_10d_calc'].notna()].copy()
    
    if len(vol_gap_data) > 5:
        colors = ['red' if x < 0 else 'green' for x in vol_gap_data['gap']]
        ax4.scatter(vol_gap_data['gap'].abs(), vol_gap_data['relative_volume_10d_calc'],
                   c=colors, alpha=0.6, s=60, edgecolor='black')
        ax4.set_xlabel('Absolute Gap %')
        ax4.set_ylabel('Volume Ratio (vs 10d avg)')
        ax4.set_title('📊 Gap Size vs Volume', fontsize=14, fontweight='bold')
        ax4.set_yscale('log')
        ax4.grid(True, alpha=0.3)
        
        # Add trend line
        if len(vol_gap_data) > 10:
            z = np.polyfit(vol_gap_data['gap'].abs(), 
                          np.log(vol_gap_data['relative_volume_10d_calc']), 1)
            p = np.poly1d(z)
            x_trend = np.linspace(0, vol_gap_data['gap'].abs().max(), 100)
            ax4.plot(x_trend, np.exp(p(x_trend)), "r--", alpha=0.8, label='Trend')
            ax4.legend()
    else:
        ax4.text(0.5, 0.5, 'Insufficient volume/gap data', ha='center', va='center',
                transform=ax4.transAxes, fontsize=12)
    
    plt.tight_layout()
    plt.show()

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
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
        except:
            pass
    
    if len(sys.argv) > 2:
        try:
            min_market_cap = int(sys.argv[2])
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
    
    # Generate visualizations
    create_prepost_visualizations(market_data)
    
    # Trading alerts
    generate_trading_alerts(market_data)
    
    # Save results
    filename = f"prepost_market_analysis_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    market_data.to_csv(filename, index=False)
    print(f"💾 Full analysis saved to: {filename}")

if __name__ == "__main__":
    main()
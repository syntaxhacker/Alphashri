#!/usr/bin/env python3
"""
India Pre/Post Market Data Analyzer
Analyzes pre-market and post-market trading data for NSE stocks
"""

from tradingview_screener import Query, Column
import pandas as pd
import numpy as np
from datetime import datetime
import sys
import matplotlib.pyplot as plt
import seaborn as sns

def get_india_prepost_data(limit=100, min_market_cap=1_000_000_000):
    """
    Get comprehensive pre/post market data for Indian stocks
    
    Args:
        limit: Maximum number of results
        min_market_cap: Minimum market cap in INR
    """
    
    print(f'🇮🇳 INDIA PRE/POST MARKET ANALYZER - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    print('=' * 85)
    print(f'Analyzing pre/post market data for top {limit} NSE stocks')
    print()
    
    col = Column
    
    query = (Query()
        .select('name', 'close', 'open', 'high', 'low', 'change', 'volume',
                'gap', 'premarket_change', 'postmarket_change',
                'RSI', 'relative_volume_10d_calc', 'average_volume_10d_calc',
                'market_cap_basic', 'beta_1_year', 'ATR', 'Volatility.D',
                'price_52_week_high', 'price_52_week_low', 'sector',
                'price_earnings_ttm', 'Perf.W', 'Perf.3M')
        .set_markets('india')
        .where(
            col('market_cap_basic') > min_market_cap,
            col('volume') > 100_000,
            col('close') > 50
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(limit))
    
    try:
        data = query.get_scanner_data()
        
        if not data or len(data) < 2 or len(data[1]) == 0:
            print("❌ No India pre/post market data found")
            return None
            
        df = data[1]
        
        # Convert numeric columns
        numeric_cols = ['close', 'open', 'high', 'low', 'change', 'volume',
                       'gap', 'premarket_change', 'postmarket_change',
                       'RSI', 'relative_volume_10d_calc', 'average_volume_10d_calc',
                       'market_cap_basic', 'beta_1_year', 'ATR', 'Volatility.D',
                       'price_52_week_high', 'price_52_week_low',
                       'price_earnings_ttm', 'Perf.W', 'Perf.3M']
        
        for col_name in numeric_cols:
            if col_name in df.columns:
                df[col_name] = pd.to_numeric(df[col_name], errors='coerce')
        
        # Convert market cap to crores for easier reading
        if 'market_cap_basic' in df.columns:
            df['market_cap_cr'] = df['market_cap_basic'] / 10_000_000
        
        return df
        
    except Exception as e:
        print(f'❌ Error: {e}')
        return None

def analyze_india_gap_patterns(df):
    """Analyze gap patterns in Indian markets"""
    
    if df is None or 'gap' not in df.columns:
        print("❌ No gap data available for Indian stocks")
        return
    
    print("📊 INDIAN MARKET GAP ANALYSIS:")
    print("=" * 55)
    
    # Filter out extreme gaps and missing data
    gap_data = df[df['gap'].notna() & (df['gap'].abs() < 25)].copy()
    
    if len(gap_data) == 0:
        print("No gap data available for analysis")
        return
    
    # Gap categories (adjusted for Indian market volatility)
    gap_up_large = gap_data[gap_data['gap'] > 4]
    gap_up_small = gap_data[(gap_data['gap'] > 0) & (gap_data['gap'] <= 4)]
    gap_down_small = gap_data[(gap_data['gap'] < 0) & (gap_data['gap'] >= -4)]
    gap_down_large = gap_data[gap_data['gap'] < -4]
    no_gap = gap_data[gap_data['gap'].abs() <= 1]
    
    print(f"📈 Large Gap Up (>4%): {len(gap_up_large)} stocks")
    print(f"📈 Small Gap Up (0-4%): {len(gap_up_small)} stocks")
    print(f"📉 Small Gap Down (0-4%): {len(gap_down_small)} stocks")
    print(f"📉 Large Gap Down (>4%): {len(gap_down_large)} stocks")
    print(f"😐 No Gap (<1%): {len(no_gap)} stocks")
    print()
    
    # Sector-wise gap analysis
    if 'sector' in df.columns:
        print("🏢 SECTOR-WISE GAP ANALYSIS:")
        print("-" * 35)
        
        sector_gaps = gap_data.groupby('sector').agg({
            'gap': ['mean', 'count', 'std'],
            'change': 'mean',
            'relative_volume_10d_calc': 'mean'
        }).round(2)
        
        sector_gaps.columns = ['Avg_Gap', 'Count', 'Gap_Volatility', 'Avg_Change', 'Avg_Volume_Ratio']
        sector_gaps = sector_gaps[sector_gaps['Count'] >= 2].sort_values('Avg_Gap', ascending=False)
        
        if len(sector_gaps) > 0:
            print(sector_gaps.head(10).to_string())
            print()
    
    # Gap follow-through analysis
    if len(gap_up_large) > 0:
        print("🚀 LARGE GAP UP ANALYSIS (Indian Stocks):")
        print("-" * 40)
        gap_up_analysis = gap_up_large[['name', 'gap', 'change', 'volume', 'relative_volume_10d_calc', 'sector']].head(12)
        gap_up_analysis['follow_through'] = gap_up_analysis['change'] - gap_up_analysis['gap']
        
        for idx, row in gap_up_analysis.iterrows():
            follow_through = "✅ Continued" if row['follow_through'] > 0 else "❌ Faded"
            vol_status = "🔥 High" if row['relative_volume_10d_calc'] > 2 else "📊 Normal"
            sector_info = f"({row['sector']})" if pd.notna(row['sector']) else ""
            
            print(f"  {row['name']} {sector_info}: Gap {row['gap']:.1f}%, Change {row['change']:.1f}% ({follow_through})")
            print(f"    Volume: {vol_status} ({row['relative_volume_10d_calc']:.1f}x average)")
        print()
    
    # Large gap down analysis
    if len(gap_down_large) > 0:
        print("📉 LARGE GAP DOWN ANALYSIS (Indian Stocks):")
        print("-" * 42)
        gap_down_analysis = gap_down_large[['name', 'gap', 'change', 'volume', 'relative_volume_10d_calc', 'sector']].head(12)
        gap_down_analysis['recovery'] = gap_down_analysis['change'] - gap_down_analysis['gap']
        
        for idx, row in gap_down_analysis.iterrows():
            recovery = "🔄 Recovering" if row['recovery'] > 1 else "📉 Continuing Down"
            vol_status = "🔥 High" if row['relative_volume_10d_calc'] > 2 else "📊 Normal"
            sector_info = f"({row['sector']})" if pd.notna(row['sector']) else ""
            
            print(f"  {row['name']} {sector_info}: Gap {row['gap']:.1f}%, Change {row['change']:.1f}% ({recovery})")
            print(f"    Volume: {vol_status} ({row['relative_volume_10d_calc']:.1f}x average)")
        print()
    
    return gap_data

def analyze_india_prepost_correlation(df):
    """Analyze correlation between pre-market and regular session for Indian stocks"""
    
    if df is None:
        return
    
    print("🕘 INDIAN PRE-MARKET vs REGULAR HOURS CORRELATION:")
    print("=" * 60)
    
    # Filter data with both pre-market and regular session data
    correlation_data = df[
        df['premarket_change'].notna() & 
        df['change'].notna() & 
        (df['premarket_change'].abs() > 0.2)  # Filter out minimal pre-market moves
    ].copy()
    
    if len(correlation_data) == 0:
        print("❌ No correlation data available for Indian stocks")
        print("Note: Pre-market data might be limited for NSE stocks")
        return
    
    # Calculate correlation
    if len(correlation_data) > 5:
        correlation = correlation_data['premarket_change'].corr(correlation_data['change'])
        print(f"📊 Pre-market vs Regular Hours Correlation: {correlation:.3f}")
        
        if correlation > 0.6:
            print("✅ Strong correlation - pre-market predicts regular hours in Indian market")
        elif correlation > 0.3:
            print("📊 Moderate correlation - pre-market somewhat predictive in Indian market") 
        elif correlation > 0.1:
            print("⚠️ Weak correlation - pre-market not very predictive in Indian market")
        else:
            print("❌ No correlation - Indian pre-market and regular hours disconnected")
        print()
    
    # Indian market specific patterns
    print("📈 INDIAN MARKET PRE-MARKET PATTERNS:")
    print("-" * 45)
    
    # Positive pre-market continuation (adjusted thresholds for Indian market)
    positive_pre = correlation_data[correlation_data['premarket_change'] > 1.5]
    if len(positive_pre) > 0:
        continued_positive = positive_pre[positive_pre['change'] > 0]
        continuation_rate = len(continued_positive) / len(positive_pre) * 100
        
        print(f"🟢 Positive Pre-market (>1.5%): {len(positive_pre)} stocks")
        print(f"   Continued positive in regular hours: {continuation_rate:.1f}%")
        
        if len(positive_pre) > 0:
            avg_pre = positive_pre['premarket_change'].mean()
            avg_regular = positive_pre['change'].mean() 
            print(f"   Average pre-market: {avg_pre:.1f}%, Average regular: {avg_regular:.1f}%")
    
    # Negative pre-market continuation  
    negative_pre = correlation_data[correlation_data['premarket_change'] < -1.5]
    if len(negative_pre) > 0:
        continued_negative = negative_pre[negative_pre['change'] < 0]
        continuation_rate = len(continued_negative) / len(negative_pre) * 100
        
        print(f"🔴 Negative Pre-market (<-1.5%): {len(negative_pre)} stocks")
        print(f"   Continued negative in regular hours: {continuation_rate:.1f}%")
        
        if len(negative_pre) > 0:
            avg_pre = negative_pre['premarket_change'].mean()
            avg_regular = negative_pre['change'].mean()
            print(f"   Average pre-market: {avg_pre:.1f}%, Average regular: {avg_regular:.1f}%")
    
    print()
    return correlation_data

def find_india_gap_opportunities(df):
    """Find gap trading opportunities in Indian market"""
    
    if df is None:
        return
    
    print("🎯 INDIAN MARKET GAP TRADING OPPORTUNITIES:")
    print("=" * 55)
    
    # Gap and Go opportunities (adjusted for Indian market)
    gap_and_go = df[
        (df['gap'] > 3) & 
        (df['change'] > df['gap']) & 
        (df['relative_volume_10d_calc'] > 1.5) &
        (df['RSI'] < 80) &  # Not overbought
        (df['market_cap_cr'] > 500)  # Decent market cap (500 cr+)
    ].copy()
    
    if len(gap_and_go) > 0:
        print(f"🚀 INDIAN GAP AND GO OPPORTUNITIES ({len(gap_and_go)} found):")
        print("-" * 45)
        
        for idx, row in gap_and_go.head(10).iterrows():
            momentum = row['change'] - row['gap']
            vol_multiple = row['relative_volume_10d_calc']
            sector_info = f"({row['sector']})" if pd.notna(row['sector']) else ""
            
            print(f"  📈 {row['name']} {sector_info}: ₹{row['close']:.2f}")
            print(f"      Gap: {row['gap']:.1f}% → Change: {row['change']:.1f}% (Momentum: +{momentum:.1f}%)")
            print(f"      Volume: {vol_multiple:.1f}x average | RSI: {row['RSI']:.1f}")
            print(f"      Market Cap: {row['market_cap_cr']:.0f} Cr")
            
            # Entry/exit recommendations (adjusted for Indian market)
            entry = row['close'] * 1.015  # 1.5% above current price
            stop = row['close'] * 0.94    # 6% stop loss (wider for volatility)
            target = row['close'] * 1.12  # 12% target
            
            print(f"      💡 Entry: ₹{entry:.2f} | Stop: ₹{stop:.2f} | Target: ₹{target:.2f}")
            print()
    
    # Gap Fill opportunities for Indian stocks
    gap_fill = df[
        (df['gap'].abs() > 3) & 
        (np.sign(df['gap']) != np.sign(df['change'])) &  # Opposite direction
        (df['relative_volume_10d_calc'] > 2) &
        (df['RSI'].between(25, 75)) &
        (df['market_cap_cr'] > 200)  # 200 cr+ market cap
    ].copy()
    
    if len(gap_fill) > 0:
        print(f"🔄 INDIAN GAP FILL/REVERSAL OPPORTUNITIES ({len(gap_fill)} found):")
        print("-" * 55)
        
        for idx, row in gap_fill.head(8).iterrows():
            gap_direction = "Up" if row['gap'] > 0 else "Down"
            change_direction = "recovering" if row['change'] > 0 else "continuing down"
            sector_info = f"({row['sector']})" if pd.notna(row['sector']) else ""
            
            print(f"  🔄 {row['name']} {sector_info}: ₹{row['close']:.2f}")
            print(f"      Gapped {gap_direction} {row['gap']:.1f}% but {change_direction} {row['change']:.1f}%")
            print(f"      Volume: {row['relative_volume_10d_calc']:.1f}x | RSI: {row['RSI']:.1f}")
            print(f"      Market Cap: {row['market_cap_cr']:.0f} Cr")
            
            # Strategy based on pattern
            if row['gap'] > 0 and row['change'] < 0:
                print(f"      💡 Strategy: Gap fade - possible continued selling pressure")
            elif row['gap'] < 0 and row['change'] > 0:
                print(f"      💡 Strategy: Gap recovery - possible bounce/reversal")
            print()

def analyze_india_market_timing(df):
    """Analyze best timing patterns for Indian market"""
    
    if df is None:
        return
    
    print("⏰ INDIAN MARKET TIMING ANALYSIS:")
    print("=" * 45)
    
    # Volume patterns (Indian market typically has higher volume in first/last hour)
    if 'relative_volume_10d_calc' in df.columns:
        high_volume = df[df['relative_volume_10d_calc'] > 2].copy()
        
        print(f"📊 High Volume Stocks (>2x average): {len(high_volume)} found")
        
        if len(high_volume) > 0:
            # Analyze gap patterns with high volume
            gap_with_volume = high_volume[high_volume['gap'].abs() > 2]
            
            if len(gap_with_volume) > 0:
                print(f"🔥 High Volume + Significant Gaps: {len(gap_with_volume)} stocks")
                print("   💡 Best for first 30 minutes trading in Indian market")
                
                # Show top opportunities
                top_volume_gaps = gap_with_volume.nlargest(5, 'relative_volume_10d_calc')
                for _, row in top_volume_gaps.iterrows():
                    gap_dir = "⬆️" if row['gap'] > 0 else "⬇️"
                    print(f"   {row['name']}: {gap_dir} {row['gap']:.1f}% | Vol: {row['relative_volume_10d_calc']:.1f}x")
    
    # RSI extremes for reversal opportunities
    if 'RSI' in df.columns:
        oversold = df[(df['RSI'] < 30) & (df['change'] > 2)].copy()  # Oversold but recovering
        overbought = df[(df['RSI'] > 70) & (df['change'] < -2)].copy()  # Overbought and falling
        
        print(f"\n📊 Oversold Recovery Opportunities: {len(oversold)} stocks")
        print(f"📊 Overbought Fade Opportunities: {len(overbought)} stocks")
        
        if len(oversold) > 0:
            print("🔄 OVERSOLD RECOVERY PLAYS:")
            for _, row in oversold.head(5).iterrows():
                print(f"   {row['name']}: RSI {row['RSI']:.1f} | Change +{row['change']:.1f}%")
        
        if len(overbought) > 0:
            print("📉 OVERBOUGHT FADE PLAYS:")
            for _, row in overbought.head(5).iterrows():
                print(f"   {row['name']}: RSI {row['RSI']:.1f} | Change {row['change']:.1f}%")
    
    print()

def generate_india_trading_alerts(df):
    """Generate India-specific trading alerts"""
    
    if df is None:
        return
    
    print("🚨 INDIAN MARKET TRADING ALERTS:")
    print("=" * 45)
    
    alerts = []
    
    # Large cap unusual activity
    large_cap_activity = df[
        (df['market_cap_cr'] > 10000) &  # 1 lakh crore+
        (df['relative_volume_10d_calc'] > 3) &
        (df['change'].abs() > 3)
    ].copy()
    
    if len(large_cap_activity) > 0:
        alerts.append("🏢 LARGE CAP ALERT")
        print("🏢 LARGE CAP UNUSUAL ACTIVITY:")
        for _, row in large_cap_activity.head(5).iterrows():
            move_dir = "⬆️" if row['change'] > 0 else "⬇️"
            print(f"  {row['name']}: {move_dir} {row['change']:.1f}% | Vol: {row['relative_volume_10d_calc']:.1f}x")
            print(f"    Market Cap: ₹{row['market_cap_cr']:.0f} Cr | 💡 Blue chip move")
    
    # Sector momentum
    if 'sector' in df.columns:
        sector_movers = df.groupby('sector').agg({
            'change': 'mean',
            'name': 'count'
        }).round(2)
        sector_movers = sector_movers[sector_movers['name'] >= 3]  # At least 3 stocks
        sector_movers = sector_movers.sort_values('change', ascending=False)
        
        if len(sector_movers) > 0:
            alerts.append("🏭 SECTOR ROTATION ALERT")
            print("\n🏭 SECTOR MOMENTUM:")
            
            top_sectors = sector_movers.head(3)
            bottom_sectors = sector_movers.tail(3)
            
            print("  📈 OUTPERFORMING SECTORS:")
            for sector, data in top_sectors.iterrows():
                print(f"    {sector}: Avg {data['change']:.1f}% ({data['name']:.0f} stocks)")
            
            print("  📉 UNDERPERFORMING SECTORS:")
            for sector, data in bottom_sectors.iterrows():
                print(f"    {sector}: Avg {data['change']:.1f}% ({data['name']:.0f} stocks)")
    
    # High beta unusual moves
    if 'beta_1_year' in df.columns:
        high_beta_moves = df[
            (df['beta_1_year'] > 1.5) &
            (df['change'].abs() > 5) &
            (df['relative_volume_10d_calc'] > 2)
        ].copy()
        
        if len(high_beta_moves) > 0:
            alerts.append("⚡ HIGH BETA ALERT")
            print("\n⚡ HIGH BETA UNUSUAL MOVES:")
            for _, row in high_beta_moves.head(3).iterrows():
                move_dir = "⬆️" if row['change'] > 0 else "⬇️"
                print(f"  {row['name']}: {move_dir} {row['change']:.1f}% | Beta: {row['beta_1_year']:.2f}")
                print(f"    💡 High volatility stock - trade with smaller position size")
    
    # Post market setup for next day
    if 'postmarket_change' in df.columns:
        significant_ah = df[df['postmarket_change'].abs() > 3].copy()
        if len(significant_ah) > 0:
            alerts.append("🌆 NEXT DAY SETUP")
            print("\n🌆 NEXT DAY GAP SETUP:")
            for _, row in significant_ah.head(3).iterrows():
                ah_dir = "⬆️" if row['postmarket_change'] > 0 else "⬇️"
                print(f"  {row['name']}: After-hours {ah_dir} {row['postmarket_change']:.1f}%")
                if row['postmarket_change'] > 0:
                    print(f"    💡 Expect gap up tomorrow - watch 9:15-9:45 AM for direction")
                else:
                    print(f"    💡 Expect gap down tomorrow - potential bounce opportunity")
    
    if not alerts:
        print("📊 No major alerts in Indian market at this time")
        print("💡 Focus on high volume stocks and sector rotation opportunities")
    
    print()

def create_india_market_summary(df):
    """Create comprehensive summary for Indian market"""
    
    if df is None:
        return
    
    print("📈 INDIAN MARKET SUMMARY:")
    print("=" * 40)
    
    # Market breadth
    total_stocks = len(df)
    gainers = len(df[df['change'] > 0])
    losers = len(df[df['change'] < 0])
    unchanged = total_stocks - gainers - losers
    
    print(f"📊 Market Breadth:")
    print(f"   🟢 Gainers: {gainers} ({gainers/total_stocks*100:.1f}%)")
    print(f"   🔴 Losers: {losers} ({losers/total_stocks*100:.1f}%)")
    print(f"   😐 Unchanged: {unchanged} ({unchanged/total_stocks*100:.1f}%)")
    
    # Average performance
    avg_change = df['change'].mean()
    print(f"\n📈 Average Change: {avg_change:.2f}%")
    
    # Volume analysis
    if 'relative_volume_10d_calc' in df.columns:
        high_volume_count = len(df[df['relative_volume_10d_calc'] > 2])
        avg_volume_ratio = df['relative_volume_10d_calc'].mean()
        print(f"📊 Volume Analysis:")
        print(f"   🔥 High Volume Stocks (>2x): {high_volume_count}")
        print(f"   📊 Average Volume Ratio: {avg_volume_ratio:.1f}x")
    
    # Market cap distribution
    if 'market_cap_cr' in df.columns:
        large_cap = len(df[df['market_cap_cr'] > 10000])  # 1 lakh cr+
        mid_cap = len(df[(df['market_cap_cr'] > 5000) & (df['market_cap_cr'] <= 10000)])
        small_cap = len(df[df['market_cap_cr'] <= 5000])
        
        print(f"\n🏢 Market Cap Distribution:")
        print(f"   🏦 Large Cap (>1L Cr): {large_cap}")
        print(f"   🏢 Mid Cap (50K-1L Cr): {mid_cap}")
        print(f"   🏪 Small Cap (<50K Cr): {small_cap}")
    
    # Trading recommendations for Indian market
    print(f"\n💡 INDIAN MARKET TRADING TIPS:")
    print("   ⏰ Best trading hours: 9:15-10:00 AM & 2:30-3:30 PM")
    print("   📊 Focus on Nifty 50/100 stocks for better liquidity")
    print("   🎯 Use wider stops (5-8%) due to higher volatility")
    print("   📈 Monitor FII/DII flows for market direction")
    print("   ⚠️ Avoid trading during result seasons without proper analysis")

def main():
    """Main execution function for Indian market analysis"""
    
    # Default parameters
    limit = 100
    min_market_cap = 1_000_000_000  # 100 Cr minimum
    
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
    
    # Get Indian market pre/post data
    india_data = get_india_prepost_data(limit=limit, min_market_cap=min_market_cap)
    
    if india_data is None:
        print("❌ Unable to retrieve Indian market data")
        return
    
    # Run Indian market specific analysis
    print(f"✅ Analyzing {len(india_data)} NSE stocks for pre/post market patterns\n")
    
    # Gap analysis
    gap_data = analyze_india_gap_patterns(india_data)
    
    # Pre-market correlation
    correlation_data = analyze_india_prepost_correlation(india_data)
    
    # Trading opportunities
    find_india_gap_opportunities(india_data)
    
    # Market timing analysis
    analyze_india_market_timing(india_data)
    
    # Generate alerts
    generate_india_trading_alerts(india_data)
    
    # Market summary
    create_india_market_summary(india_data)
    
    # Save results
    filename = f"india_prepost_analysis_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    india_data.to_csv(filename, index=False)
    print(f"\n💾 Indian market analysis saved to: {filename}")
    
    print("\n" + "=" * 85)
    print("🇮🇳 INDIAN MARKET ANALYSIS COMPLETE")
    print("💡 Use this data for gap trading and intraday opportunities in NSE")
    print("=" * 85)

if __name__ == "__main__":
    main()
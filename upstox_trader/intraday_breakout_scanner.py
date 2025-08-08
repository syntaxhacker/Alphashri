#!/usr/bin/env python3
"""
Intraday Breakout Scanner for Indian Stocks
Finds top breakout candidates for intraday trading
"""

from tradingview_screener import Query, Column
import pandas as pd
from datetime import datetime
import sys

def scan_intraday_breakouts(limit=15, min_adx=25, min_volume_ratio=1.5, min_mcap=500_000_000):
    """
    Scan for intraday breakout candidates
    
    Args:
        limit: Maximum number of results
        min_adx: Minimum ADX for trend strength
        min_volume_ratio: Minimum volume ratio vs 10-day average
        min_mcap: Minimum market cap in INR
    """
    
    print(f'🇮🇳 INTRADAY BREAKOUT SCANNER - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    print('=' * 75)
    print(f'Scanning for breakout candidates...')
    print()
    
    col = Column
    
    query = (Query()
        .select('name', 'close', 'change', 'volume', 'gap', 'RSI', 'ADX',
                'relative_volume_10d_calc', 'ATR', 'Volatility.D',
                'price_52_week_high', 'price_52_week_low', 'market_cap_basic',
                'EMA20', 'EMA50', 'beta_1_year', 'sector')
        .set_markets('india')
        .where(
            col('market_cap_basic') > min_mcap,
            col('volume') > 100_000,
            col('close') > 50,
            col('relative_volume_10d_calc') > min_volume_ratio,
            col('ADX') > min_adx,
            col('RSI').between(45, 75),
            col('close') > col('EMA20')
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(limit))
    
    try:
        data = query.get_scanner_data()
        
        if not data or len(data) < 2 or len(data[1]) == 0:
            print("❌ No breakout candidates found")
            print("   Try reducing ADX or volume requirements")
            return None
            
        df = data[1]
        
        # Convert numeric columns
        numeric_cols = ['close', 'change', 'volume', 'gap', 'RSI', 'ADX',
                       'relative_volume_10d_calc', 'ATR', 'Volatility.D',
                       'price_52_week_high', 'price_52_week_low', 'market_cap_basic',
                       'EMA20', 'EMA50', 'beta_1_year']
        
        for col_name in numeric_cols:
            if col_name in df.columns:
                df[col_name] = pd.to_numeric(df[col_name], errors='coerce')
        
        # Filter for stocks with some gap (momentum)
        df = df[df['gap'].abs() > 1].copy()
        
        if len(df) == 0:
            print("❌ No stocks with sufficient gap momentum found")
            return None
        
        return df
        
    except Exception as e:
        print(f'❌ Error: {e}')
        return None

def calculate_breakout_score(df):
    """Calculate breakout potential score"""
    
    if df is None or len(df) == 0:
        return df
    
    # Breakout score formula
    df['breakout_score'] = (
        df['relative_volume_10d_calc'] * 0.3 +  # Volume weight (30%)
        df['ADX'] * 0.25 +                      # Trend strength (25%)
        df['gap'].abs() * 0.2 +                 # Gap momentum (20%)
        (df['close'] / df['EMA20'] - 1) * 100 * 0.15 +  # Price vs EMA20 (15%)
        df['Volatility.D'] * 1000 * 0.1         # Volatility (10%)
    )
    
    # Sort by breakout score
    df = df.sort_values('breakout_score', ascending=False)
    
    return df

def display_breakout_candidates(df, show_count=10):
    """Display top breakout candidates with detailed analysis"""
    
    if df is None or len(df) == 0:
        return
    
    print(f'🚀 TOP {show_count} INTRADAY BREAKOUT CANDIDATES:')
    print('=' * 60)
    
    for i, (_, stock) in enumerate(df.head(show_count).iterrows(), 1):
        # Calculate key metrics
        price_vs_52h = ((stock['close'] / stock['price_52_week_high']) - 1) * 100
        volume_status = get_volume_status(stock['relative_volume_10d_calc'])
        trend_strength = get_trend_strength(stock['ADX'])
        gap_dir = '⬆️ UP' if stock['gap'] > 0 else '⬇️ DOWN'
        
        # Market cap in crores
        mcap_cr = stock['market_cap_basic'] / 10_000_000
        
        print(f'{i:2d}. 🎯 {stock["name"]} ({stock.get("sector", "Unknown")})')
        print(f'    💰 Price: ₹{stock["close"]:.2f} | Gap: {gap_dir} {stock["gap"]:.1f}%')
        print(f'    📊 Volume: {volume_status} ({stock["relative_volume_10d_calc"]:.1f}x)')
        print(f'    🎯 Trend: {trend_strength} (ADX: {stock["ADX"]:.1f})')
        print(f'    📈 RSI: {stock["RSI"]:.1f} | From 52W High: {price_vs_52h:.1f}%')
        print(f'    🏢 Market Cap: ₹{mcap_cr:.0f} Cr | Volatility: {stock["Volatility.D"]:.3f}')
        
        # Calculate breakout levels
        current = stock['close']
        breakout_level = current * 1.02   # 2% above current
        stop_loss = current * 0.97        # 3% stop
        target1 = current * 1.06          # 6% target
        target2 = current * 1.10          # 10% target
        
        print(f'    🎯 BREAKOUT: ₹{breakout_level:.2f} | STOP: ₹{stop_loss:.2f}')
        print(f'    🏁 TARGET1: ₹{target1:.2f} | TARGET2: ₹{target2:.2f}')
        print(f'    ⚡ Score: {stock["breakout_score"]:.1f}')
        print()

def get_volume_status(volume_ratio):
    """Get volume status description"""
    if volume_ratio > 10:
        return '🔥 EXPLOSIVE'
    elif volume_ratio > 5:
        return '🔥 VERY HIGH'
    elif volume_ratio > 2:
        return '📈 HIGH'
    else:
        return '📊 NORMAL'

def get_trend_strength(adx):
    """Get trend strength description"""
    if adx > 40:
        return '💪 VERY STRONG'
    elif adx > 30:
        return '💪 STRONG'
    elif adx > 25:
        return '📈 MODERATE'
    else:
        return '😐 WEAK'

def generate_trading_alerts(df):
    """Generate specific trading alerts"""
    
    if df is None or len(df) == 0:
        return
    
    print("🚨 TRADING ALERTS:")
    print("=" * 40)
    
    # High volume alerts
    explosive_volume = df[df['relative_volume_10d_calc'] > 10]
    if len(explosive_volume) > 0:
        print("🔥 EXPLOSIVE VOLUME ALERTS:")
        for _, stock in explosive_volume.head(3).iterrows():
            print(f"  • {stock['name']}: {stock['relative_volume_10d_calc']:.1f}x volume")
    
    # Gap alerts
    large_gaps = df[df['gap'].abs() > 3]
    if len(large_gaps) > 0:
        print("\n📊 LARGE GAP ALERTS:")
        for _, stock in large_gaps.head(3).iterrows():
            gap_dir = "UP" if stock['gap'] > 0 else "DOWN"
            print(f"  • {stock['name']}: Gap {gap_dir} {stock['gap']:.1f}%")
    
    # Near 52-week high alerts
    near_highs = df[((df['close'] / df['price_52_week_high']) > 0.95)]
    if len(near_highs) > 0:
        print("\n🏆 NEAR 52-WEEK HIGH ALERTS:")
        for _, stock in near_highs.head(3).iterrows():
            high_dist = ((stock['close'] / stock['price_52_week_high']) - 1) * 100
            print(f"  • {stock['name']}: {high_dist:.1f}% from 52W high")
    
    print()

def print_trading_strategy():
    """Print intraday trading strategy and tips"""
    
    print("📋 INTRADAY BREAKOUT STRATEGY:")
    print("=" * 45)
    print("⏰ TIMING:")
    print("  • Best Entry: 9:15-9:45 AM (market opening)")
    print("  • Secondary: 1:00-2:00 PM (afternoon momentum)")
    print("  • Avoid: Last 30 minutes (3:00-3:30 PM)")
    print()
    print("🎯 ENTRY RULES:")
    print("  • Wait for price to break above breakout level with volume")
    print("  • Volume should be >2x average for confirmation")
    print("  • RSI should be between 45-75 (not overbought/oversold)")
    print("  • ADX >25 for trend confirmation")
    print()
    print("🛡️ RISK MANAGEMENT:")
    print("  • Stop Loss: 3% below entry price")
    print("  • Position Size: 1-2% of capital per trade")
    print("  • Max 3-4 positions simultaneously")
    print("  • Trail stops at EMA20 for momentum trades")
    print()
    print("🏁 PROFIT TARGETS:")
    print("  • Target 1: 6% (book 50% position)")
    print("  • Target 2: 10% (book remaining 50%)")
    print("  • Let winners run with trailing stops")
    print()
    print("⚠️ WARNING SIGNS:")
    print("  • Avoid if volume decreases on breakout")
    print("  • Skip if overall market is weak/falling")
    print("  • Don't chase after 3%+ move from breakout level")

def save_results(df):
    """Save results to CSV file"""
    
    if df is None or len(df) == 0:
        return
    
    filename = f"intraday_breakouts_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    df.to_csv(filename, index=False)
    print(f"💾 Results saved to: {filename}")

def main():
    """Main execution function"""
    
    # Default parameters
    limit = 15
    min_adx = 25
    min_volume_ratio = 1.5
    min_mcap = 500_000_000  # 50 Cr
    show_count = 10
    
    # Handle command line arguments
    if len(sys.argv) > 1:
        try:
            show_count = int(sys.argv[1])
        except:
            pass
    
    if len(sys.argv) > 2:
        try:
            min_adx = float(sys.argv[2])
        except:
            pass
    
    if len(sys.argv) > 3:
        try:
            min_volume_ratio = float(sys.argv[3])
        except:
            pass
    
    # Scan for breakout candidates
    candidates = scan_intraday_breakouts(
        limit=limit,
        min_adx=min_adx,
        min_volume_ratio=min_volume_ratio,
        min_mcap=min_mcap
    )
    
    if candidates is None:
        return
    
    # Calculate breakout scores
    candidates = calculate_breakout_score(candidates)
    
    # Display results
    display_breakout_candidates(candidates, show_count)
    
    # Generate alerts
    generate_trading_alerts(candidates)
    
    # Print strategy guide
    print_trading_strategy()
    
    # Save results
    save_results(candidates)
    
    print("\n" + "=" * 75)
    print("🎯 SCANNER COMPLETE - Ready for market open at 9:15 AM!")
    print("💡 Use this data for intraday breakout trading in NSE")
    print("=" * 75)

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Market Open Scanner - Perfect for 9:15 AM IST
Real-time scanner for immediate trading opportunities at market open
"""

from tradingview_screener import Query, Column
import pandas as pd
from datetime import datetime
import sys

def scan_market_open_opportunities(limit=20):
    """
    Scan for immediate trading opportunities at market open
    Optimized for 9:15 AM IST execution
    """
    
    current_time = datetime.now().strftime("%H:%M")
    print(f'🚀 MARKET OPEN SCANNER - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    print('=' * 80)
    
    if current_time < "09:00" or current_time > "10:00":
        print("⚠️  OPTIMAL TIME: This scanner works best between 9:00-10:00 AM")
    
    print("🎯 SCANNING FOR IMMEDIATE TRADING OPPORTUNITIES...")
    print()
    
    col = Column
    
    # Live market opportunities query
    query = (Query()
        .select('name', 'close', 'change', 'volume', 'gap', 'RSI', 'ADX',
                'relative_volume_10d_calc', 'ATR', 'Volatility.D',
                'price_52_week_high', 'price_52_week_low', 'market_cap_basic',
                'EMA20', 'EMA50', 'sector', 'beta_1_year')
        .set_markets('india')
        .where(
            col('market_cap_basic') > 300_000_000,  # 30 Cr+ (lower for more options)
            col('volume') > 50_000,                 # Minimum volume
            col('close') > 30,                      # Reasonable price
            col('relative_volume_10d_calc') > 1.2,  # Above average volume
            col('RSI').between(35, 80)              # Not extremely oversold/overbought
        )
        .order_by('relative_volume_10d_calc', ascending=False)
        .limit(limit))
    
    try:
        data = query.get_scanner_data()
        
        if not data or len(data) < 2 or len(data[1]) == 0:
            print("❌ No immediate opportunities found")
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
        
        return df
        
    except Exception as e:
        print(f'❌ Error: {e}')
        return None

def categorize_opportunities(df):
    """Categorize trading opportunities by type"""
    
    if df is None or len(df) == 0:
        return {}
    
    categories = {
        'gap_and_go': [],      # Gap up with continuation
        'gap_fill': [],        # Gap reversal plays
        'volume_surge': [],    # Unusual volume without gap
        'breakout': [],        # Technical breakouts
        'momentum': []         # Pure momentum plays
    }
    
    for _, stock in df.iterrows():
        gap = stock.get('gap', 0)
        volume_ratio = stock.get('relative_volume_10d_calc', 0)
        change = stock.get('change', 0)
        rsi = stock.get('RSI', 50)
        adx = stock.get('ADX', 20)
        
        # Gap and Go (gap up with continuation)
        if gap > 2 and change > gap:
            categories['gap_and_go'].append(stock)
        
        # Gap Fill (gap reversal)
        elif abs(gap) > 2 and (gap * change) < 0:  # Opposite directions
            categories['gap_fill'].append(stock)
        
        # Volume Surge (high volume, small gap)
        elif volume_ratio > 3 and abs(gap) < 2:
            categories['volume_surge'].append(stock)
        
        # Breakout (strong trend + volume)
        elif adx > 25 and volume_ratio > 2 and abs(change) > 1:
            categories['breakout'].append(stock)
        
        # Momentum (strong move with volume)
        elif abs(change) > 3 and volume_ratio > 1.5:
            categories['momentum'].append(stock)
    
    return categories

def display_gap_and_go(stocks):
    """Display gap and go opportunities"""
    
    if not stocks:
        return
    
    print("🚀 GAP AND GO OPPORTUNITIES:")
    print("=" * 50)
    print("💡 Strategy: Buy on pullback, ride the momentum")
    print()
    
    for i, stock in enumerate(stocks[:5], 1):
        price = stock['close']
        gap = stock['gap']
        change = stock['change']
        volume = stock['relative_volume_10d_calc']
        momentum = change - gap
        
        print(f"{i}. 📈 {stock['name']} - ₹{price:.2f}")
        print(f"   Gap: {gap:.1f}% → Change: {change:.1f}% (Momentum: +{momentum:.1f}%)")
        print(f"   Volume: {volume:.1f}x | Sector: {stock.get('sector', 'Unknown')}")
        
        # Trade setup
        entry = price * 0.99      # 1% pullback entry
        stop = price * 0.96       # 4% stop
        target1 = price * 1.05    # 5% target
        target2 = price * 1.08    # 8% target
        
        print(f"   🎯 Entry: ₹{entry:.2f} | Stop: ₹{stop:.2f}")
        print(f"   🏁 T1: ₹{target1:.2f} | T2: ₹{target2:.2f}")
        print()

def display_gap_fill(stocks):
    """Display gap fill opportunities"""
    
    if not stocks:
        return
    
    print("🔄 GAP FILL/REVERSAL OPPORTUNITIES:")
    print("=" * 50)
    print("💡 Strategy: Counter-trend trades, quick scalps")
    print()
    
    for i, stock in enumerate(stocks[:3], 1):
        price = stock['close']
        gap = stock['gap']
        change = stock['change']
        volume = stock['relative_volume_10d_calc']
        
        gap_dir = "UP" if gap > 0 else "DOWN"
        change_dir = "down" if change < 0 else "up"
        
        print(f"{i}. 🔄 {stock['name']} - ₹{price:.2f}")
        print(f"   Gapped {gap_dir} {gap:.1f}% but moving {change_dir} {change:.1f}%")
        print(f"   Volume: {volume:.1f}x | Sector: {stock.get('sector', 'Unknown')}")
        
        # Trade setup - conservative for reversal
        if gap > 0:  # Gap up but falling
            entry = price * 0.98      # Short on weakness
            stop = price * 1.03       # 3% stop
            target = price * 0.94     # 6% target down
            print(f"   📉 SHORT Entry: ₹{entry:.2f} | Stop: ₹{stop:.2f} | Target: ₹{target:.2f}")
        else:  # Gap down but recovering
            entry = price * 1.02      # Long on strength
            stop = price * 0.97       # 3% stop
            target = price * 1.06     # 6% target up
            print(f"   📈 LONG Entry: ₹{entry:.2f} | Stop: ₹{stop:.2f} | Target: ₹{target:.2f}")
        print()

def display_volume_surge(stocks):
    """Display unusual volume opportunities"""
    
    if not stocks:
        return
    
    print("⚡ UNUSUAL VOLUME SURGE:")
    print("=" * 40)
    print("💡 Strategy: News-based moves, momentum trades")
    print()
    
    for i, stock in enumerate(stocks[:4], 1):
        price = stock['close']
        change = stock['change']
        volume = stock['relative_volume_10d_calc']
        
        move_dir = "UP" if change > 0 else "DOWN"
        
        print(f"{i}. ⚡ {stock['name']} - ₹{price:.2f}")
        print(f"   Move: {move_dir} {change:.1f}% | Volume: 🔥 {volume:.1f}x")
        print(f"   Sector: {stock.get('sector', 'Unknown')}")
        
        # Trade setup
        if change > 0:
            entry = price * 1.01      # Buy strength
            stop = price * 0.96       # 4% stop
            target = price * 1.08     # 8% target
        else:
            entry = price * 0.99      # Short weakness
            stop = price * 1.04       # 4% stop
            target = price * 0.92     # 8% target
        
        print(f"   🎯 Entry: ₹{entry:.2f} | Stop: ₹{stop:.2f} | Target: ₹{target:.2f}")
        print()

def display_immediate_alerts(df):
    """Display immediate action alerts"""
    
    if df is None or len(df) == 0:
        return
    
    print("🚨 IMMEDIATE ACTION ALERTS:")
    print("=" * 45)
    
    # Explosive volume (>10x)
    explosive = df[df['relative_volume_10d_calc'] > 10]
    if len(explosive) > 0:
        print("🔥 EXPLOSIVE VOLUME (>10x):")
        for _, stock in explosive.head(3).iterrows():
            print(f"  • {stock['name']}: {stock['relative_volume_10d_calc']:.1f}x volume, {stock['change']:.1f}% move")
    
    # Large gaps (>5%)
    large_gaps = df[df['gap'].abs() > 5]
    if len(large_gaps) > 0:
        print("\n📊 LARGE GAPS (>5%):")
        for _, stock in large_gaps.head(3).iterrows():
            gap_dir = "UP" if stock['gap'] > 0 else "DOWN"
            print(f"  • {stock['name']}: Gap {gap_dir} {stock['gap']:.1f}%")
    
    # Strong momentum (>5% move)
    strong_moves = df[df['change'].abs() > 5]
    if len(strong_moves) > 0:
        print("\n🚀 STRONG MOMENTUM (>5%):")
        for _, stock in strong_moves.head(3).iterrows():
            move_dir = "UP" if stock['change'] > 0 else "DOWN"
            print(f"  • {stock['name']}: {move_dir} {stock['change']:.1f}%")
    
    print()

def print_market_open_strategy():
    """Print market opening strategy"""
    
    print("📋 MARKET OPEN TRADING STRATEGY:")
    print("=" * 50)
    print("⏰ 9:15-9:30 AM (GOLDEN 15 MINUTES):")
    print("  • Focus on gap and go opportunities")
    print("  • Wait for volume confirmation")
    print("  • Quick entries with tight stops")
    print()
    print("⏰ 9:30-10:00 AM (MOMENTUM PHASE):")
    print("  • Breakout and volume surge trades")
    print("  • Let winners run, cut losers quickly")
    print("  • Trail stops aggressively")
    print()
    print("🎯 ENTRY PRIORITIES:")
    print("  1. Gap and Go (highest probability)")
    print("  2. Volume Surge (news-based)")
    print("  3. Technical Breakouts")
    print("  4. Gap Fill (counter-trend, risky)")
    print()
    print("⚠️ MARKET OPEN RISKS:")
    print("  • High volatility and wide spreads")
    print("  • False breakouts common")
    print("  • Use smaller position sizes")
    print("  • Be ready to exit quickly")

def main():
    """Main execution function"""
    
    # Scan for opportunities
    opportunities = scan_market_open_opportunities()
    
    if opportunities is None:
        return
    
    print(f"✅ Found {len(opportunities)} potential opportunities")
    print()
    
    # Categorize opportunities
    categories = categorize_opportunities(opportunities)
    
    # Display by category
    display_gap_and_go(categories['gap_and_go'])
    display_volume_surge(categories['volume_surge'])
    display_gap_fill(categories['gap_fill'])
    
    # Immediate alerts
    display_immediate_alerts(opportunities)
    
    # Strategy guide
    print_market_open_strategy()
    
    # Save results
    filename = f"market_open_scan_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    opportunities.to_csv(filename, index=False)
    print(f"\n💾 Results saved to: {filename}")
    
    print("\n" + "=" * 80)
    print("🎯 MARKET OPEN SCAN COMPLETE!")
    print("💡 Best used at 9:15 AM IST for immediate trading opportunities")
    print("⚡ Quick execution required - market moves fast at open!")
    print("=" * 80)

if __name__ == "__main__":
    main()
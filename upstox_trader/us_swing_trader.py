#!/usr/bin/env python3
"""
US Market Swing Trading Screener
Finds high-probability swing trading opportunities in US markets
"""

from tradingview_screener import Query, Column
import pandas as pd
from datetime import datetime
import sys

def run_us_swing_screen(limit=20, min_adx=25, min_weekly_perf=2.0, min_market_cap=1_000_000_000):
    """
    Enhanced swing trading screen for US market
    
    Args:
        limit: Maximum number of results
        min_adx: Minimum ADX for trend strength
        min_weekly_perf: Minimum weekly performance %
        min_market_cap: Minimum market cap in USD
    """
    
    print(f'🇺🇸 US SWING TRADING SCREENER - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    print('=' * 70)
    print(f'Criteria: ADX > {min_adx}, Weekly > {min_weekly_perf}%, MarketCap > ${min_market_cap:,}')
    print()
    
    col = Column
    
    query = (Query()
        .select('name', 'close', 'change', 'volume', 'Perf.W', 'Perf.3M',
                'RSI', 'MACD.macd', 'MACD.signal', 'ADX', 'ADX+DI', 'ADX-DI',
                'EMA20', 'EMA50', 'EMA200', 'beta_1_year',
                'price_52_week_high', 'price_52_week_low', 
                'market_cap_basic', 'relative_volume_10d_calc')
        .set_markets('america')
        .where(
            col('market_cap_basic') > min_market_cap,
            col('ADX') > min_adx,
            col('RSI').between(40, 80),
            col('close') > col('EMA20'),
            col('EMA20') > col('EMA50'),
            col('Perf.W') > min_weekly_perf,
            col('beta_1_year') > 0.5,
            col('volume') > 500_000,
            col('close') > 20
        )
        .order_by('ADX', ascending=False)
        .limit(limit))
    
    try:
        data = query.get_scanner_data()
        
        if not data or len(data) < 2 or len(data[1]) == 0:
            print("❌ No swing trading opportunities found")
            print("   Try reducing ADX threshold or weekly performance requirements")
            return None
            
        df = data[1]
        
        # Convert numeric columns
        numeric_cols = ['close', 'change', 'volume', 'Perf.W', 'Perf.3M',
                       'RSI', 'MACD.macd', 'MACD.signal', 'ADX', 'ADX+DI', 'ADX-DI',
                       'EMA20', 'EMA50', 'EMA200', 'beta_1_year',
                       'price_52_week_high', 'price_52_week_low', 
                       'market_cap_basic', 'relative_volume_10d_calc']
        
        for col_name in numeric_cols:
            if col_name in df.columns:
                df[col_name] = pd.to_numeric(df[col_name], errors='coerce')
        
        return df
        
    except Exception as e:
        print(f'❌ Error: {e}')
        return None

def analyze_opportunities(df):
    """Analyze and display swing trading opportunities"""
    
    if df is None or len(df) == 0:
        return
    
    print(f'🎯 FOUND {len(df)} SWING TRADING OPPORTUNITIES')
    print()
    
    # Display summary table
    display_cols = ['name', 'close', 'ADX', 'Perf.W', 'Perf.3M', 'RSI', 'beta_1_year']
    available_cols = [col for col in display_cols if col in df.columns]
    
    if available_cols:
        display_df = df[available_cols].head(15)
        col_names = ['STOCK', 'PRICE', 'ADX', 'WEEK%', '3M%', 'RSI', 'BETA']
        display_df.columns = col_names[:len(available_cols)]
        
        print("📊 SWING TRADING CANDIDATES:")
        print("-" * 60)
        print(display_df.to_string(index=False, float_format='%.2f'))
        print()
    
    # Detailed analysis of top 5
    print("🏆 TOP 5 DETAILED ANALYSIS:")
    print("=" * 50)
    
    top_5 = df.head(5)
    for idx, (_, stock) in enumerate(top_5.iterrows(), 1):
        risk_level = get_risk_level(stock.get('beta_1_year', 1.0))
        
        print(f"{idx}. 📈 {stock['name']} - ${stock['close']:.2f}")
        print(f"   🎯 Trend Strength (ADX): {stock['ADX']:.1f}")
        print(f"   📅 Weekly Momentum: {stock.get('Perf.W', 0):.1f}%")
        print(f"   📈 3-Month Performance: {stock.get('Perf.3M', 0):.1f}%")
        print(f"   📊 RSI: {stock.get('RSI', 50):.1f}")
        print(f"   🔄 Beta: {stock.get('beta_1_year', 1.0):.2f} ({risk_level})")
        
        # Calculate position from 52-week range
        if all(col in stock for col in ['close', 'price_52_week_high', 'price_52_week_low']):
            high_dist = ((stock['close'] / stock['price_52_week_high']) - 1) * 100
            low_dist = ((stock['close'] / stock['price_52_week_low']) - 1) * 100
            print(f"   📍 Position: {high_dist:.1f}% from 52W high, {low_dist:.1f}% above 52W low")
        
        # Trading recommendation
        entry_price = stock['close'] * 0.97  # 3% pullback target
        stop_loss = stock['close'] * 0.95    # 5% stop
        target = stock['close'] * 1.12       # 12% target
        
        print(f"   💡 Entry Target: ${entry_price:.2f} | Stop: ${stop_loss:.2f} | Target: ${target:.2f}")
        print()

def get_risk_level(beta):
    """Categorize risk level based on beta"""
    if beta < 1.0:
        return "Low Risk"
    elif beta < 1.5:
        return "Medium Risk"
    elif beta < 2.0:
        return "High Risk"
    else:
        return "Very High Risk"

def print_trading_guide():
    """Print swing trading strategy guide"""
    
    print("📋 SWING TRADING STRATEGY GUIDE:")
    print("=" * 40)
    print("✅ ENTRY RULES:")
    print("  • Wait for 2-3% pullback to EMA20 support")
    print("  • Confirm with volume > average on entry day") 
    print("  • Only enter if ADX > 25 (trending market)")
    print()
    print("🛡️ RISK MANAGEMENT:")
    print("  • Stop Loss: 3-5% below entry (tighter for high beta)")
    print("  • Position Size: Smaller for beta > 2.0")
    print("  • Max 2-3% portfolio risk per trade")
    print()
    print("🎯 TARGETS:")
    print("  • Primary: 8-12% based on ADX strength")
    print("  • Secondary: Trail stop at EMA20 break")
    print("  • Time Stop: Exit if no progress in 3-4 weeks")
    print()
    print("⚠️ RISK CATEGORIES:")
    print("  • Low Risk (Beta < 1.0): Larger position size")
    print("  • Medium Risk (Beta 1.0-1.5): Normal size") 
    print("  • High Risk (Beta 1.5-2.0): Smaller size")
    print("  • Very High Risk (Beta > 2.0): Minimal size")

def main():
    """Main execution function"""
    
    # Default parameters
    limit = 20
    min_adx = 25
    min_weekly_perf = 2.0
    min_market_cap = 1_000_000_000
    
    # Handle command line arguments
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
        except:
            pass
    
    if len(sys.argv) > 2:
        try:
            min_adx = float(sys.argv[2])
        except:
            pass
    
    # Run the screen
    opportunities = run_us_swing_screen(
        limit=limit, 
        min_adx=min_adx, 
        min_weekly_perf=min_weekly_perf,
        min_market_cap=min_market_cap
    )
    
    # Analyze results
    analyze_opportunities(opportunities)
    
    # Print strategy guide
    print_trading_guide()
    
    # Save results to CSV if opportunities found
    if opportunities is not None and len(opportunities) > 0:
        filename = f"us_swing_opportunities_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
        opportunities.to_csv(filename, index=False)
        print(f"\n💾 Results saved to: {filename}")

if __name__ == "__main__":
    main()
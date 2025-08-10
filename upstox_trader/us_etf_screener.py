#!/usr/bin/env python3
"""
US ETF Swing Trading Screener
Finds high-probability ETF trading opportunities for diversified exposure
"""

from tradingview_screener import Query, Column
import pandas as pd
from datetime import datetime
import sys

def run_etf_swing_screen(limit=30, min_adx=20, min_weekly_perf=1.0, min_volume=1_000_000):
    """
    ETF swing trading screen for US market
    
    Args:
        limit: Maximum number of results
        min_adx: Minimum ADX for trend strength (lower for ETFs)
        min_weekly_perf: Minimum weekly performance %
        min_volume: Minimum daily volume
    """
    
    print(f'📊 US ETF SWING TRADING SCREENER - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    print('=' * 75)
    print(f'Criteria: ADX > {min_adx}, Weekly > {min_weekly_perf}%, Volume > {min_volume:,}')
    print()
    
    col = Column
    
    query = (Query()
        .select('name', 'close', 'change', 'volume', 'Perf.W', 'Perf.3M', 'Perf.Y',
                'RSI', 'MACD.macd', 'MACD.signal', 'ADX', 
                'EMA20', 'EMA50', 'EMA200', 'beta_1_year',
                'price_52_week_high', 'price_52_week_low', 
                'relative_volume_10d_calc', 'ATR', 'Volatility.D', 'type')
        .set_markets('america')
        .where(
            col('type') == 'fund',  # Focus on ETFs/funds
            col('ADX') > min_adx,
            col('RSI').between(30, 75),  # Slightly wider range for ETFs
            col('close') > col('EMA20'),  # Above short-term trend
            col('Perf.W') > min_weekly_perf,
            col('volume') > min_volume,
            col('close') > 10  # Reasonable price level
        )
        .order_by('ADX', ascending=False)
        .limit(limit))
    
    try:
        data = query.get_scanner_data()
        
        if not data or len(data) < 2 or len(data[1]) == 0:
            print("❌ No ETF opportunities found")
            print("   Try reducing ADX threshold or weekly performance requirements")
            return None
            
        df = data[1]
        
        # Convert numeric columns
        numeric_cols = ['close', 'change', 'volume', 'Perf.W', 'Perf.3M', 'Perf.Y',
                       'RSI', 'MACD.macd', 'MACD.signal', 'ADX',
                       'EMA20', 'EMA50', 'EMA200', 'beta_1_year',
                       'price_52_week_high', 'price_52_week_low', 
                       'relative_volume_10d_calc', 'ATR', 'Volatility.D']
        
        for col_name in numeric_cols:
            if col_name in df.columns:
                df[col_name] = pd.to_numeric(df[col_name], errors='coerce')
        
        return df
        
    except Exception as e:
        print(f'❌ Error: {e}')
        return None

def categorize_etf(name):
    """Categorize ETF by type based on name"""
    name_upper = name.upper()
    
    # Sector ETFs
    if any(sector in name_upper for sector in ['TECH', 'XLK', 'QQQ', 'ARKK', 'ARKQ', 'ARKG', 'ARKF']):
        return 'Technology'
    elif any(sector in name_upper for sector in ['XLE', 'OIL', 'USO', 'XOP']):
        return 'Energy'
    elif any(sector in name_upper for sector in ['XLF', 'KRE', 'KBE']):
        return 'Financial'
    elif any(sector in name_upper for sector in ['XLV', 'IBB', 'XBI']):
        return 'Healthcare'
    elif any(sector in name_upper for sector in ['XLI', 'IYT']):
        return 'Industrial'
    elif any(sector in name_upper for sector in ['XLU']):
        return 'Utilities'
    elif any(sector in name_upper for sector in ['XLRE', 'VNQ', 'IYR']):
        return 'Real Estate'
    elif any(sector in name_upper for sector in ['XLP', 'XLY']):
        return 'Consumer'
    elif any(sector in name_upper for sector in ['XLB', 'XME']):
        return 'Materials'
    
    # Geographic/Style ETFs
    elif any(geo in name_upper for geo in ['EEM', 'VWO', 'IEMG', 'CHINA', 'FXI', 'ASHR']):
        return 'Emerging Markets'
    elif any(geo in name_upper for geo in ['EFA', 'VEA', 'IEFA']):
        return 'Developed International'
    elif any(style in name_upper for style in ['IWM', 'RUSSELL', 'SMALL']):
        return 'Small Cap'
    elif any(ticker in name_upper for ticker in ['SPY', 'VOO', 'IVV', 'VTI']):
        return 'Large Cap/Broad Market'
    elif any(style in name_upper for style in ['GROWTH', 'IWF', 'VUG']):
        return 'Growth'
    elif any(style in name_upper for style in ['VALUE', 'IWD', 'VTV']):
        return 'Value'
    
    # Bond ETFs
    elif any(bond in name_upper for bond in ['TLT', 'IEF', 'SHY', 'BND', 'AGG', 'HYG', 'JNK']):
        return 'Fixed Income'
    
    # Commodity ETFs
    elif any(comm in name_upper for comm in ['GLD', 'SLV', 'DBA', 'DBC', 'PDBC']):
        return 'Commodities'
    
    # Crypto ETFs
    elif any(crypto in name_upper for crypto in ['BTC', 'ETH', 'BITCOIN', 'ETHEREUM']):
        return 'Cryptocurrency'
    
    else:
        return 'Other/Mixed'

def analyze_etf_opportunities(df):
    """Analyze and display ETF swing trading opportunities"""
    
    if df is None or len(df) == 0:
        return None
    
    # Add ETF categorization
    df['category'] = df['name'].apply(categorize_etf)
    
    # Filter out crypto ETFs
    df = df[df['category'] != 'Cryptocurrency'].copy()
    
    if len(df) == 0:
        print("❌ No non-crypto ETF opportunities found after filtering")
        return None
    
    print(f'📊 FOUND {len(df)} ETF SWING TRADING OPPORTUNITIES')
    print()
    
    # Display summary table
    display_cols = ['name', 'category', 'close', 'ADX', 'Perf.W', 'Perf.3M', 'RSI', 'volume']
    available_cols = [col for col in display_cols if col in df.columns]
    
    if available_cols:
        display_df = df[available_cols].head(20)
        col_names = ['ETF', 'CATEGORY', 'PRICE', 'ADX', 'WEEK%', '3M%', 'RSI', 'VOLUME']
        display_df.columns = col_names[:len(available_cols)]
        
        print("📊 ETF SWING TRADING CANDIDATES:")
        print("-" * 80)
        print(display_df.to_string(index=False, float_format='%.2f'))
        print()
    
    # Category analysis
    if 'category' in df.columns:
        print("📈 OPPORTUNITIES BY CATEGORY:")
        print("-" * 40)
        category_summary = df.groupby('category').agg({
            'name': 'count',
            'ADX': 'mean',
            'Perf.W': 'mean',
            'Perf.3M': 'mean'
        }).round(2)
        category_summary.columns = ['Count', 'Avg ADX', 'Avg Week%', 'Avg 3M%']
        category_summary = category_summary.sort_values('Avg ADX', ascending=False)
        print(category_summary.to_string())
        print()
    
    # Detailed analysis of top 8
    print("🏆 TOP 8 ETF DETAILED ANALYSIS:")
    print("=" * 60)
    
    top_8 = df.head(8)
    for idx, (_, etf) in enumerate(top_8.iterrows(), 1):
        volatility = get_volatility_level(etf.get('Volatility.D', 0.02))
        category = etf.get('category', 'Unknown')
        
        print(f"{idx}. 📊 {etf['name']} ({category}) - ${etf['close']:.2f}")
        print(f"   🎯 Trend Strength (ADX): {etf['ADX']:.1f}")
        print(f"   📅 Weekly Performance: {etf.get('Perf.W', 0):.1f}%")
        print(f"   📈 3-Month Performance: {etf.get('Perf.3M', 0):.1f}%")
        print(f"   📊 RSI: {etf.get('RSI', 50):.1f}")
        
        if 'Volatility.D' in etf:
            print(f"   📊 Daily Volatility: {etf['Volatility.D']:.3f} ({volatility})")
        
        if 'volume' in etf:
            volume_m = etf['volume'] / 1_000_000
            print(f"   📊 Volume: {volume_m:.1f}M shares")
        
        # Calculate position from 52-week range
        if all(col in etf for col in ['close', 'price_52_week_high', 'price_52_week_low']):
            high_dist = ((etf['close'] / etf['price_52_week_high']) - 1) * 100
            low_dist = ((etf['close'] / etf['price_52_week_low']) - 1) * 100
            print(f"   📍 Position: {high_dist:.1f}% from 52W high, {low_dist:.1f}% above 52W low")
        
        # Trading recommendation (more conservative for ETFs)
        entry_price = etf['close'] * 0.98   # 2% pullback target
        stop_loss = etf['close'] * 0.96     # 4% stop
        target = etf['close'] * 1.08        # 8% target (more conservative)
        
        print(f"   💡 Entry: ${entry_price:.2f} | Stop: ${stop_loss:.2f} | Target: ${target:.2f}")
        print()

def get_volatility_level(volatility):
    """Categorize volatility level"""
    if volatility < 0.015:
        return "Low Volatility"
    elif volatility < 0.025:
        return "Medium Volatility"
    elif volatility < 0.035:
        return "High Volatility"
    else:
        return "Very High Volatility"

def get_etf_trading_recommendations(df):
    """Provide specific ETF trading recommendations"""
    
    if df is None or len(df) == 0:
        return
        
    print("🎯 ETF TRADING RECOMMENDATIONS BY CATEGORY:")
    print("=" * 55)
    
    # Group recommendations by category
    if 'category' in df.columns:
        categories = df['category'].unique()
        
        for category in sorted(categories):
            category_etfs = df[df['category'] == category].head(3)
            
            if len(category_etfs) > 0:
                print(f"\n📊 {category.upper()}:")
                print("-" * 30)
                
                for _, etf in category_etfs.iterrows():
                    trend_strength = "Strong" if etf['ADX'] > 30 else "Moderate" if etf['ADX'] > 20 else "Weak"
                    momentum = "Bullish" if etf.get('Perf.W', 0) > 2 else "Neutral" if etf.get('Perf.W', 0) > 0 else "Bearish"
                    
                    print(f"  • {etf['name']}: ${etf['close']:.2f}")
                    print(f"    Trend: {trend_strength} (ADX: {etf['ADX']:.1f}) | Momentum: {momentum}")
                    
                    # Specific strategy based on category
                    if category == 'Technology':
                        print(f"    💡 Strategy: Growth momentum play, watch for tech earnings impact")
                    elif category == 'Energy':
                        print(f"    💡 Strategy: Commodity correlation, oil price sensitivity")
                    elif category == 'Financial':
                        print(f"    💡 Strategy: Interest rate play, economic cycle dependent")
                    elif category == 'Healthcare':
                        print(f"    💡 Strategy: Defensive growth, lower correlation to market")
                    elif category == 'Real Estate':
                        print(f"    💡 Strategy: REIT exposure, interest rate sensitive")
                    elif category == 'Emerging Markets':
                        print(f"    💡 Strategy: Higher risk/reward, dollar correlation")
                    elif category == 'Small Cap':
                        print(f"    💡 Strategy: Economic growth play, higher volatility")
                    elif category == 'Large Cap/Broad Market':
                        print(f"    💡 Strategy: Market beta play, core holding")
                    else:
                        print(f"    💡 Strategy: Sector rotation opportunity")

def print_etf_trading_guide():
    """Print ETF-specific trading strategy guide"""
    
    print("\n📋 ETF SWING TRADING STRATEGY GUIDE:")
    print("=" * 45)
    print("✅ ETF-SPECIFIC ENTRY RULES:")
    print("  • Wait for 1-2% pullback (less than stocks)")
    print("  • Confirm sector/theme momentum with news flow")
    print("  • Consider underlying asset performance (oil, rates, etc.)")
    print("  • Check expense ratio (<0.75% preferred)")
    print()
    print("🛡️ ETF RISK MANAGEMENT:")
    print("  • Stop Loss: 3-4% below entry (tighter than stocks)")
    print("  • Position Size: Can be larger due to diversification")
    print("  • Sector Concentration: Max 20% in single sector ETFs")
    print("  • Time Decay: Less concern than individual stocks")
    print()
    print("🎯 ETF TARGETS:")
    print("  • Primary: 6-10% (more conservative than stocks)")
    print("  • Secondary: Trail stop at EMA20 break")
    print("  • Long-term Hold: Consider for core positions")
    print()
    print("📊 ETF CATEGORY STRATEGIES:")
    print("  • Technology ETFs: Growth momentum, earnings sensitivity")
    print("  • Sector ETFs: Rotation plays, economic cycle timing")
    print("  • International ETFs: Currency and geopolitical risks")
    print("  • Bond ETFs: Interest rate and credit risk exposure")
    print("  • Commodity ETFs: Inflation hedge, supply/demand dynamics")
    print()
    print("⚠️ ETF-SPECIFIC RISKS:")
    print("  • Tracking Error: ETF vs underlying index performance")
    print("  • Liquidity: Check average daily volume")
    print("  • Premium/Discount: NAV vs market price")
    print("  • Sector Concentration: Single theme exposure")

def main():
    """Main execution function"""
    
    # Default parameters (more lenient for ETFs)
    limit = 30
    min_adx = 20        # Lower ADX for ETFs
    min_weekly_perf = 1.0  # Lower weekly performance requirement
    min_volume = 1_000_000  # Minimum daily volume
    
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
    
    if len(sys.argv) > 3:
        try:
            min_weekly_perf = float(sys.argv[3])
        except:
            pass
    
    # Run the screen
    opportunities = run_etf_swing_screen(
        limit=limit,
        min_adx=min_adx,
        min_weekly_perf=min_weekly_perf,
        min_volume=min_volume
    )
    
    # Analyze results and filter out crypto ETFs
    filtered_opportunities = analyze_etf_opportunities(opportunities)
    
    # Get trading recommendations from filtered results
    if filtered_opportunities is not None:
        get_etf_trading_recommendations(filtered_opportunities)
    
    # Print strategy guide
    print_etf_trading_guide()
    
    # Save results to CSV if filtered opportunities found
    if filtered_opportunities is not None and len(filtered_opportunities) > 0:
        filename = f"us_etf_opportunities_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
        filtered_opportunities.to_csv(filename, index=False)
        print(f"\n💾 Results saved to: {filename}")

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Portfolio Support & Resistance Monitor
Analyzes multiple stocks and saves S&R levels to a text file
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, MofNCompleteColumn

console = Console()

# Your portfolio stocks
PORTFOLIO_STOCKS = {
    # 'DMART': 'Avenue Supermarts Ltd',
    # 'BSE': 'BSE Ltd', 
    # 'BAJFINANCE': 'Bajaj Finance Ltd',
    # 'BAJAJHFL': 'Bajaj Housing Finance Ltd',
    # 'BHEL': 'Bharat Heavy Electricals Ltd',
    # 'COALINDIA': 'Coal India Ltd',
    'COCHINSHIP': 'Cochin Shipyard Ltd',
    'TATVA': 'Tatva Chintan Pharma Chem Ltd',
    'CUMMINSIND': 'Cummins India Ltd',
    # 'DRREDDY': 'Dr Reddys Laboratories Ltd',
    # 'EXICOM': 'Exicom Tele-Systems Ltd',
    # 'GRAVITA': 'Gravita India Ltd',
    # 'GPPL': 'Gujarat Pipavav Port Ltd',
    # 'HAL': 'Hindustan Aeronautics Ltd',
    # 'IRB': 'IRB Infrastructure Developers Ltd',
    # 'ITC': 'ITC Ltd',
    # 'IRFC': 'Indian Railway Finance Corporation Ltd',
    # 'INFIBEAM': 'Infibeam Avenues Ltd',
    # 'INOXWIND': 'Inox Wind Ltd',
    # 'KPIGREEN': 'KPI Green Energy Ltd',
    # 'LT': 'Larsen & Toubro Ltd',
    # 'MRPL': 'Mangalore Refinery And Petrochemicals Ltd',
    # 'MAZDOCK': 'Mazagon Dock Shipbuilders Ltd',  # Corrected symbol
    # 'NFL': 'National Fertilizer Ltd',
    # 'ONGC': 'Oil & Natural Gas Corpn Ltd',
    # 'PNCINFRA': 'PNC Infratech Ltd',
    # 'RELIANCE': 'Reliance Industries Ltd',
    # 'NIFTYBEES': 'SBI ETF Nifty 50',
    # 'TATAMOTORS': 'Tata Motors Ltd',
    # 'TITAN': 'Titan Company Ltd',
    # 'TRENT': 'Trent Ltd',
    # 'XCHANGING': 'Xchanging Solutions Ltd',
    # 'IXIGO': 'Le Travenues Technology Ltd'
}

def calculate_support_resistance(data: pd.DataFrame, lookback_periods: int = 20) -> dict:
    """Calculate support and resistance levels from price data"""
    
    if len(data) < lookback_periods:
        lookback_periods = len(data)
    
    recent_data = data.tail(lookback_periods)
    highs = recent_data['high'].values
    lows = recent_data['low'].values
    closes = recent_data['close'].values
    
    # Find local extremes
    resistance_levels = []
    support_levels = []
    
    for i in range(2, len(highs) - 2):
        if (highs[i] > highs[i-1] and highs[i] > highs[i-2] and 
            highs[i] > highs[i+1] and highs[i] > highs[i+2]):
            resistance_levels.append(highs[i])
        
        if (lows[i] < lows[i-1] and lows[i] < lows[i-2] and 
            lows[i] < lows[i+1] and lows[i] < lows[i+2]):
            support_levels.append(lows[i])
    
    current_price = closes[-1]
    high_level = highs.max()
    low_level = lows.min()
    mid_level = (high_level + low_level) / 2
    
    # Volume-weighted levels
    volume_weighted_levels = []
    if 'volume' in recent_data.columns and recent_data['volume'].sum() > 0:
        vwap = (recent_data['close'] * recent_data['volume']).sum() / recent_data['volume'].sum()
        volume_weighted_levels.append(vwap)
    
    # Clean and sort levels
    all_resistance = resistance_levels + [high_level]
    all_support = support_levels + [low_level, mid_level]
    
    all_resistance = sorted(list(set([round(r, 2) for r in all_resistance if r > current_price])))
    all_support = sorted(list(set([round(s, 2) for s in all_support if s < current_price])), reverse=True)
    
    resistance_levels = all_resistance[:3] if len(all_resistance) >= 3 else all_resistance
    support_levels = all_support[:3] if len(all_support) >= 3 else all_support
    
    return {
        'current_price': round(current_price, 2),
        'resistance_levels': resistance_levels,
        'support_levels': support_levels,
        'price_range': round(highs.max() - lows.min(), 2),
        'high_2day': round(highs.max(), 2),
        'low_2day': round(lows.min(), 2),
        'volume_weighted_levels': [round(v, 2) for v in volume_weighted_levels],
        'data_points': len(data),
        'analysis_period': f"{recent_data.index[0].strftime('%Y-%m-%d %H:%M')} to {recent_data.index[-1].strftime('%Y-%m-%d %H:%M')}"
    }

def fetch_stock_data(api, symbol, symbol_name, from_date, to_date):
    """Fetch data for a single stock"""
    try:
        # Try different symbol variations
        possible_symbols = [symbol, f"{symbol}-EQ", f"{symbol}.NSE"]
        df = None
        
        for test_symbol in possible_symbols:
            try:
                instrument_key = api.get_instrument_key(test_symbol, exchange='NSE_EQ', instrument_type='EQ')
                
                if instrument_key:
                    df = api.fetch_historical_data_v3(
                        symbol=test_symbol,
                        unit='minutes',
                        interval=5,
                        to_date=to_date,
                        from_date=from_date,
                        instrument_type='EQ',
                        exchange='NSE_EQ'
                    )
                    
                    if df is not None and len(df) > 0:
                        break
            except:
                continue
        
        # Fallback to V2 API
        if df is None or len(df) == 0:
            try:
                df = api.fetch_historical_data(
                    symbol=symbol,
                    interval='1minute',
                    from_date=from_date,
                    to_date=to_date,
                    instrument_type='EQ',
                    exchange='NSE_EQ'
                )
                
                if df is not None and len(df) > 0:
                    df = df.resample('5T').agg({
                        'open': 'first',
                        'high': 'max',
                        'low': 'min',
                        'close': 'last',
                        'volume': 'sum',
                        'oi': 'last'
                    }).dropna()
            except:
                pass
        
        if df is not None and len(df) > 0:
            levels = calculate_support_resistance(df)
            return {
                'symbol': symbol,
                'name': symbol_name,
                'data': df,
                'levels': levels,
                'status': 'success'
            }
        else:
            return {
                'symbol': symbol,
                'name': symbol_name,
                'data': None,
                'levels': None,
                'status': 'no_data'
            }
            
    except Exception as e:
        return {
            'symbol': symbol,
            'name': symbol_name,
            'data': None,
            'levels': None,
            'status': 'error',
            'error': str(e)
        }

def analyze_portfolio():
    """Analyze all portfolio stocks and generate report"""
    
    console.print("🔍 **Portfolio Support & Resistance Analysis**")
    console.print("=" * 60)
    
    # Initialize Upstox API
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    # Calculate date range (previous 3 days to ensure we get data)
    to_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')  # Yesterday
    from_date = (datetime.now() - timedelta(days=4)).strftime('%Y-%m-%d')  # 4 days ago
    
    console.print(f"📊 Analyzing {len(PORTFOLIO_STOCKS)} stocks from {from_date} to {to_date}")
    
    results = []
    
    # Progress bar
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task("Analyzing stocks...", total=len(PORTFOLIO_STOCKS))
        
        for symbol, name in PORTFOLIO_STOCKS.items():
            progress.update(task, description=f"Fetching {symbol}...")
            
            result = fetch_stock_data(api, symbol, name, from_date, to_date)
            results.append(result)
            
            progress.advance(task)
    
    # Generate report
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    report_file = f"portfolio_sr_analysis_{timestamp}.txt"
    
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("🔍 PORTFOLIO SUPPORT & RESISTANCE ANALYSIS\n")
        f.write("=" * 80 + "\n")
        f.write(f"📅 Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"📊 Analysis Period: {from_date} to {to_date}\n")
        f.write(f"📈 Total Stocks: {len(PORTFOLIO_STOCKS)}\n\n")
        
        # Summary
        successful = sum(1 for r in results if r['status'] == 'success')
        failed = len(results) - successful
        
        f.write("📋 SUMMARY\n")
        f.write("-" * 40 + "\n")
        f.write(f"✅ Successfully Analyzed: {successful}\n")
        f.write(f"❌ Failed/No Data: {failed}\n\n")
        
        # Detailed Analysis
        f.write("📊 DETAILED ANALYSIS\n")
        f.write("=" * 80 + "\n\n")
        
        for result in results:
            symbol = result['symbol']
            name = result['name']
            status = result['status']
            
            f.write(f"🏢 {symbol} - {name}\n")
            f.write("-" * 80 + "\n")
            
            if status == 'success':
                levels = result['levels']
                
                f.write(f"💰 Current Price: ₹{levels['current_price']}\n")
                f.write(f"📈 2-Day High: ₹{levels['high_2day']}\n")
                f.write(f"📉 2-Day Low: ₹{levels['low_2day']}\n")
                f.write(f"📊 Price Range: ₹{levels['price_range']}\n")
                f.write(f"📋 Data Points: {levels['data_points']}\n")
                f.write(f"⏰ Period: {levels['analysis_period']}\n\n")
                
                # Resistance Levels
                if levels['resistance_levels']:
                    f.write("🔴 RESISTANCE LEVELS:\n")
                    for i, level in enumerate(levels['resistance_levels'], 1):
                        distance = level - levels['current_price']
                        percent = (distance / levels['current_price']) * 100
                        f.write(f"   R{i}: ₹{level} (+₹{distance:.2f}, +{percent:.2f}%)\n")
                else:
                    f.write("🔴 RESISTANCE LEVELS: No clear resistance found\n")
                
                f.write("\n")
                
                # Support Levels
                if levels['support_levels']:
                    f.write("🟢 SUPPORT LEVELS:\n")
                    for i, level in enumerate(levels['support_levels'], 1):
                        distance = levels['current_price'] - level
                        percent = (distance / levels['current_price']) * 100
                        f.write(f"   S{i}: ₹{level} (-₹{distance:.2f}, -{percent:.2f}%)\n")
                else:
                    f.write("🟢 SUPPORT LEVELS: No clear support found\n")
                
                f.write("\n")
                
                # VWAP
                if levels['volume_weighted_levels']:
                    f.write("📊 VOLUME-WEIGHTED LEVELS:\n")
                    for i, vwap in enumerate(levels['volume_weighted_levels'], 1):
                        distance = abs(vwap - levels['current_price'])
                        direction = "above" if vwap > levels['current_price'] else "below"
                        f.write(f"   VWAP{i}: ₹{vwap} ({direction} by ₹{distance:.2f})\n")
                    f.write("\n")
                
                # Trading Insights
                f.write("🎯 TRADING INSIGHTS:\n")
                if levels['resistance_levels']:
                    nearest_r = levels['resistance_levels'][0]
                    r_percent = ((nearest_r - levels['current_price']) / levels['current_price']) * 100
                    f.write(f"   • Nearest Resistance: ₹{nearest_r} (+{r_percent:.2f}%)\n")
                
                if levels['support_levels']:
                    nearest_s = levels['support_levels'][0]
                    s_percent = ((levels['current_price'] - nearest_s) / levels['current_price']) * 100
                    f.write(f"   • Nearest Support: ₹{nearest_s} (-{s_percent:.2f}%)\n")
                
                if levels['resistance_levels'] and levels['support_levels']:
                    upside = ((levels['resistance_levels'][0] - levels['current_price']) / levels['current_price']) * 100
                    downside = ((levels['current_price'] - levels['support_levels'][0]) / levels['current_price']) * 100
                    risk_reward = upside / downside if downside > 0 else float('inf')
                    f.write(f"   • Upside Potential: +{upside:.2f}%\n")
                    f.write(f"   • Downside Risk: -{downside:.2f}%\n")
                    f.write(f"   • Risk/Reward Ratio: {risk_reward:.2f}:1\n")
                
            elif status == 'no_data':
                f.write("❌ No data available for this stock\n")
                f.write("💡 Possible reasons:\n")
                f.write("   • Stock might not be trading\n")
                f.write("   • Symbol format incorrect\n")
                f.write("   • Market closed during analysis period\n")
                
            elif status == 'error':
                f.write(f"❌ Error occurred: {result.get('error', 'Unknown error')}\n")
            
            f.write("\n" + "=" * 80 + "\n\n")
        
        # Footer
        f.write("📝 NOTES:\n")
        f.write("-" * 40 + "\n")
        f.write("• Support/Resistance levels are calculated using pivot point analysis\n")
        f.write("• VWAP = Volume-Weighted Average Price\n")
        f.write("• Risk/Reward ratio shows potential upside vs downside\n")
        f.write("• Analysis based on 5-minute candlestick data\n")
        f.write("• This is for informational purposes only, not financial advice\n\n")
        f.write("🔄 For real-time updates, run this script again\n")
    
    # Console summary
    console.print(f"\n✅ Analysis complete!")
    console.print(f"📁 Report saved to: {report_file}")
    console.print(f"📊 Successfully analyzed: {successful}/{len(PORTFOLIO_STOCKS)} stocks")
    
    if failed > 0:
        console.print(f"⚠️  Failed to analyze: {failed} stocks")
    
    return report_file

if __name__ == "__main__":
    report_file = analyze_portfolio()
    console.print(f"\n🔍 Open {report_file} to view detailed analysis")

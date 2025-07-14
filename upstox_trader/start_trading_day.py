#!/usr/bin/env python3
"""
Trading Day Startup Script
Run this every morning before market opens
"""

import sys
import os
from datetime import datetime
from news_sentiment_analyzer import NewsAnalyzer

def morning_news_scan():
    """Scan for overnight news that might impact today's trading"""
    print("☀️ GOOD MORNING! Starting Trading Day Setup...")
    print("=" * 60)
    print(f"📅 Date: {datetime.now().strftime('%A, %B %d, %Y')}")
    print(f"🕐 Time: {datetime.now().strftime('%H:%M:%S')}")
    print("=" * 60)
    
    analyzer = NewsAnalyzer()
    
    # Key stocks to monitor
    morning_watchlist = [
        'EIEL',       # Your target
        'RELIANCE',   # Market leader
        'TCS',        # IT bellwether
        'NIFTY',      # Market index
        'BANKNIFTY'   # Banking index
    ]
    
    print("\n📰 OVERNIGHT NEWS SCAN (Last 12 hours)")
    print("-" * 60)
    
    total_alerts = 0
    
    for symbol in morning_watchlist:
        try:
            print(f"\n🔍 Checking {symbol}...")
            
            # Look back 12 hours for overnight news
            news_items = analyzer.scan_stock_news(symbol, hours_back=12)
            
            if news_items:
                alert = analyzer.generate_alert(symbol, news_items)
                
                if alert:
                    total_alerts += 1
                    print(f"🚨 ALERT: {symbol}")
                    print(f"   📰 {alert['headline'][:60]}...")
                    print(f"   📊 Sentiment: {alert['sentiment_score']:.2f} ({alert['direction']})")
                    print(f"   📈 Impact: {alert['volume_prediction']} ({alert['probability']:.1%})")
                    print(f"   ⚡ Action: {alert['action']}")
                else:
                    print(f"   📝 News found but low impact")
            else:
                print(f"   ✅ No overnight news")
                
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    print("\n" + "=" * 60)
    print("📋 MORNING SUMMARY")
    print("=" * 60)
    
    if total_alerts > 0:
        print(f"🚨 {total_alerts} HIGH IMPACT alerts found!")
        print("💡 PREPARATION STEPS:")
        print("   1. Check current pre-market prices")
        print("   2. Review overnight global markets")
        print("   3. Set up alerts for mentioned stocks")
        print("   4. Prepare entry/exit strategies")
        print("   5. Start live monitoring at 9:00 AM")
    else:
        print("✅ No major overnight news")
        print("💡 NORMAL DAY PREPARATION:")
        print("   1. Review yesterday's signals")
        print("   2. Check global market sentiment")
        print("   3. Prepare watchlist")
        print("   4. Start live monitoring at 9:00 AM")
    
    print("\n🚀 NEXT STEPS:")
    print("   📊 Single scan: python live_news_monitor.py --single")
    print("   🔄 Live monitor: python live_news_monitor.py")
    print("   📈 Volatility scan: python enhanced_volatility_scanner.py")
    
    print("\n" + "=" * 60)
    print("🍀 GOOD LUCK TRADING TODAY!")
    print("=" * 60)

if __name__ == "__main__":
    morning_news_scan()
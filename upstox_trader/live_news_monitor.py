#!/usr/bin/env python3
"""
Live News Monitor - Run during market hours for real-time alerts
"""

import time
import sys
import os
from datetime import datetime, time as dt_time
from news_sentiment_analyzer import NewsAnalyzer

class LiveNewsMonitor:
    def __init__(self):
        self.analyzer = NewsAnalyzer()
        self.watchlist = [
            'EIEL',       # Your target stock
            'RELIANCE',   # Large cap
            'TCS',        # IT leader
            'INFY',       # IT
            'HDFCBANK',   # Banking
            'TATAMOTORS', # Auto
            'DRREDDY',    # Pharma
            'IREDA',      # Infra
            'ADANIPOWER', # Power
            'SBIN'        # Banking
        ]
        self.scan_interval = 15  # minutes
        self.processed_alerts = set()  # Avoid duplicate alerts
        
    def is_market_hours(self):
        """Check if it's during market hours (9:15 AM - 3:30 PM)"""
        now = datetime.now()
        
        # Check if it's a weekday (0=Monday, 6=Sunday)
        if now.weekday() > 4:  # Saturday=5, Sunday=6
            return False
            
        current_time = now.time()
        market_open = dt_time(9, 15)  # 9:15 AM
        market_close = dt_time(15, 30)  # 3:30 PM
        
        return market_open <= current_time <= market_close
    
    def scan_single_stock(self, symbol):
        """Scan a single stock for news"""
        try:
            print(f"🔍 Scanning {symbol}...")
            
            # Get recent news (last 2 hours)
            news_items = self.analyzer.scan_stock_news(symbol, hours_back=2)
            
            if not news_items:
                print(f"   📰 No recent news for {symbol}")
                return None
            
            # Generate alert
            alert = self.analyzer.generate_alert(symbol, news_items)
            
            if alert:
                # Create unique alert ID
                alert_id = f"{symbol}_{alert['headline'][:30]}"
                
                # Skip if we've already processed this alert
                if alert_id in self.processed_alerts:
                    return None
                
                self.processed_alerts.add(alert_id)
                return alert
            
            return None
            
        except Exception as e:
            print(f"❌ Error scanning {symbol}: {e}")
            return None
    
    def display_alert(self, alert):
        """Display a formatted alert"""
        symbol = alert['symbol']
        sentiment = alert['sentiment_score']
        direction = alert['direction']
        probability = alert['probability']
        action = alert['action']
        headline = alert['headline']
        
        print("\n" + "="*80)
        print(f"🚨 HIGH IMPACT NEWS ALERT")
        print("="*80)
        print(f"📊 SYMBOL: {symbol}")
        print(f"📰 NEWS: {headline}")
        print(f"📈 SENTIMENT: {sentiment:.2f} ({direction})")
        print(f"📊 VOLUME IMPACT: {probability:.1%} probability")
        print(f"⚡ RECOMMENDED ACTION: {action}")
        print(f"🕐 TIME: {datetime.now().strftime('%H:%M:%S')}")
        print("="*80)
        
        # Trading suggestions
        if action == "PREPARE_FOR_ENTRY":
            print("💡 TRADING SUGGESTIONS:")
            print("   1. Check current price and chart")
            print("   2. Set alerts for volume spike")
            print("   3. Prepare entry orders")
            print("   4. Watch for 10-15 minute volume confirmation")
            print("   5. Use small position size initially")
        elif action == "AVOID_OR_SHORT":
            print("⚠️  CAUTION SUGGESTIONS:")
            print("   1. Avoid new long positions")
            print("   2. Consider profit booking if holding")
            print("   3. Monitor for further negative news")
            print("   4. Wait for stabilization")
        
        print("="*80 + "\n")
    
    def run_continuous_monitoring(self):
        """Run continuous monitoring during market hours"""
        print("🚀 Starting Live News Monitor...")
        print(f"📊 Watching: {', '.join(self.watchlist)}")
        print(f"⏰ Scan interval: {self.scan_interval} minutes")
        print(f"🕐 Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        if not self.is_market_hours():
            print("⚠️  Market is currently closed")
            print("📅 Market hours: Monday-Friday 9:15 AM - 3:30 PM")
            print("🔄 Will start monitoring when market opens...")
        
        scan_count = 0
        
        while True:
            try:
                current_time = datetime.now()
                
                if self.is_market_hours():
                    scan_count += 1
                    print(f"\n🔄 Scan #{scan_count} - {current_time.strftime('%H:%M:%S')}")
                    print("-" * 60)
                    
                    alerts_found = 0
                    
                    # Scan each stock in watchlist
                    for symbol in self.watchlist:
                        alert = self.scan_single_stock(symbol)
                        
                        if alert:
                            alerts_found += 1
                            self.display_alert(alert)
                            
                            # Optional: Save to file for record keeping
                            self.save_alert_to_file(alert)
                    
                    if alerts_found == 0:
                        print("📝 No significant news alerts in this scan")
                    else:
                        print(f"🎯 Found {alerts_found} news alerts!")
                    
                    print(f"⏰ Next scan in {self.scan_interval} minutes...")
                    
                else:
                    # Market closed - check every hour
                    print(f"💤 Market closed - {current_time.strftime('%H:%M:%S')}")
                    time.sleep(3600)  # Sleep 1 hour
                    continue
                
                # Wait for next scan
                time.sleep(self.scan_interval * 60)
                
            except KeyboardInterrupt:
                print("\n🛑 Monitoring stopped by user")
                break
            except Exception as e:
                print(f"❌ Error in monitoring loop: {e}")
                print("⏰ Continuing in 30 seconds...")
                time.sleep(30)
    
    def save_alert_to_file(self, alert):
        """Save alert to file for record keeping"""
        try:
            filename = f"news_alerts_{datetime.now().strftime('%Y%m%d')}.txt"
            
            with open(filename, 'a') as f:
                f.write(f"{datetime.now().isoformat()},{alert['symbol']},{alert['sentiment_score']:.2f},{alert['direction']},{alert['probability']:.2f},{alert['headline']}\n")
                
        except Exception as e:
            print(f"⚠️ Could not save alert to file: {e}")
    
    def run_single_scan(self):
        """Run a single scan of all watchlist stocks"""
        print("🔍 Running single scan of watchlist...")
        print(f"📊 Scanning: {', '.join(self.watchlist)}")
        print("-" * 60)
        
        alerts_found = 0
        
        for symbol in self.watchlist:
            alert = self.scan_single_stock(symbol)
            
            if alert:
                alerts_found += 1
                self.display_alert(alert)
        
        if alerts_found == 0:
            print("📝 No significant news alerts found")
            print("💡 This is normal - most scans won't find major news")
        else:
            print(f"🎯 Found {alerts_found} news alerts!")
        
        print("\n✅ Single scan complete!")

def main():
    """Main function with user options"""
    monitor = LiveNewsMonitor()
    
    if len(sys.argv) > 1 and sys.argv[1] == '--single':
        # Single scan mode
        monitor.run_single_scan()
    else:
        # Continuous monitoring mode
        monitor.run_continuous_monitoring()

if __name__ == "__main__":
    main()
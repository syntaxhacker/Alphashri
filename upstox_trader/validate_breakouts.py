#!/usr/bin/env python3
"""
Heavy Breakout Validation Script
Direct Upstox API validation of breakout levels and timing
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config_and_utils.free_indian_apis import UpstoxAPI
from datetime import datetime, timedelta
import pandas as pd

# Load config
try:
    from config_and_utils.config import UPSTOX_CONFIG
except ImportError:
    print("❌ Config not found. Please ensure config is set up properly.")
    UPSTOX_CONFIG = {}

def validate_breakout(symbol, support_level=None, resistance_level=None):
    """Validate breakout levels with direct Upstox API call"""
    
    print(f"\n{'='*60}")
    print(f"🔍 VALIDATING BREAKOUT: {symbol}")
    print(f"{'='*60}")
    
    try:
        # Initialize Upstox API
        upstox_api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        # Authenticate if needed
        if not upstox_api.authenticate():
            print("❌ Failed to authenticate with Upstox API")
            return
        
        # Get current quote
        try:
            quote = upstox_api.get_market_quote([symbol])
            if symbol in quote:
                current_price = quote[symbol]['last_price']
                print(f"📈 Current Price: ₹{current_price:.2f}")
            else:
                current_price = None
                print("❌ Could not fetch current price")
        except Exception as e:
            print(f"❌ Quote fetch failed: {e}")
            current_price = None
        
        # Get recent 5-minute data
        print("\n📊 Fetching 5-minute candle data...")
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
        
        data_5min = upstox_api.fetch_historical_data_v3(
            symbol=symbol,
            unit='minutes',
            interval=5,
            to_date=to_date,
            from_date=from_date
        )
        
        if data_5min is not None and len(data_5min) > 0:
            # Handle columns
            if len(data_5min.columns) == 6:
                data_5min.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                data_5min = data_5min[['Open', 'High', 'Low', 'Close', 'Volume']]
            elif len(data_5min.columns) == 5:
                data_5min.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
            
            # Convert to numeric
            for col in ['Open', 'High', 'Low', 'Close', 'Volume']:
                data_5min[col] = pd.to_numeric(data_5min[col], errors='coerce')
            
            # Get recent data
            recent_data = data_5min.tail(12)  # Last hour (12 * 5min bars)
            
            print(f"✅ Retrieved {len(data_5min)} bars of 5-minute data")
            print(f"\n📋 RECENT PRICE ACTION (Last 12 bars):")
            print(f"   • Current Close: ₹{recent_data['Close'].iloc[-1]:.2f}")
            print(f"   • Session High: ₹{recent_data['High'].max():.2f}")
            print(f"   • Session Low: ₹{recent_data['Low'].min():.2f}")
            print(f"   • Average Volume: {recent_data['Volume'].mean():,.0f}")
            
            # Validate support/resistance if provided
            if support_level or resistance_level:
                print(f"\n🎯 LEVEL VALIDATION:")
                current_close = recent_data['Close'].iloc[-1]
                session_high = recent_data['High'].max()
                session_low = recent_data['Low'].min()
                
                if support_level:
                    print(f"   • Support Level: ₹{support_level:.2f}")
                    if current_close > support_level:
                        print(f"   • ✅ ABOVE SUPPORT: Current (₹{current_close:.2f}) > Support")
                    else:
                        print(f"   • ⚠️  BELOW SUPPORT: Current (₹{current_close:.2f}) < Support")
                
                if resistance_level:
                    print(f"   • Resistance Level: ₹{resistance_level:.2f}")
                    if current_close > resistance_level:
                        print(f"   • ✅ BREAKOUT CONFIRMED: Current (₹{current_close:.2f}) > Resistance")
                    else:
                        print(f"   • 🔶 BELOW RESISTANCE: Current (₹{current_close:.2f}) < Resistance")
                
                # Check for recent breakout activity
                breakout_bars = recent_data[
                    (recent_data['High'] > resistance_level) | 
                    (recent_data['Low'] < support_level)
                ] if support_level and resistance_level else pd.DataFrame()
                
                if len(breakout_bars) > 0:
                    print(f"   • 🚨 BREAKOUT ACTIVITY: {len(breakout_bars)} bars with level breaks")
                else:
                    print(f"   • 💤 NO RECENT BREAKOUTS: Price respecting levels")
            
            # Show last 5 bars for manual verification
            print(f"\n📊 LAST 5 BARS (5-minute):")
            print("Bar | Open    | High    | Low     | Close   | Volume")
            print("-" * 55)
            for i, (_, row) in enumerate(recent_data.tail(5).iterrows()):
                print(f"{i+1:3} | ₹{row['Open']:6.2f} | ₹{row['High']:6.2f} | ₹{row['Low']:6.2f} | ₹{row['Close']:6.2f} | {row['Volume']:6.0f}")
            
        else:
            print("❌ No historical data available")
        
        # Get 15-minute data for pattern context
        print(f"\n📊 Fetching 15-minute pattern data...")
        data_15min = upstox_api.fetch_historical_data_v3(
            symbol=symbol,
            unit='minutes',
            interval=15,
            to_date=to_date,
            from_date=(datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
        )
        
        if data_15min is not None and len(data_15min) > 0:
            # Handle columns
            if len(data_15min.columns) == 6:
                data_15min.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                data_15min = data_15min[['Open', 'High', 'Low', 'Close', 'Volume']]
            elif len(data_15min.columns) == 5:
                data_15min.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
            
            # Convert to numeric
            for col in ['Open', 'High', 'Low', 'Close', 'Volume']:
                data_15min[col] = pd.to_numeric(data_15min[col], errors='coerce')
            
            recent_15min = data_15min.tail(8)  # Last 2 hours
            
            print(f"✅ Retrieved {len(data_15min)} bars of 15-minute data")
            print(f"\n📈 15-MINUTE PATTERN CONTEXT:")
            print(f"   • Range High: ₹{recent_15min['High'].max():.2f}")
            print(f"   • Range Low: ₹{recent_15min['Low'].min():.2f}")
            print(f"   • Range Size: {((recent_15min['High'].max() - recent_15min['Low'].min()) / recent_15min['Low'].min() * 100):.2f}%")
            
    except Exception as e:
        print(f"❌ Validation failed: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Main validation function"""
    print("🔍 HEAVY BREAKOUT VALIDATION CONSOLE")
    print("=" * 50)
    
    if len(sys.argv) < 2:
        print("Usage: python validate_breakouts.py SYMBOL [SUPPORT] [RESISTANCE]")
        print("\nExample:")
        print("  python validate_breakouts.py KRBL")
        print("  python validate_breakouts.py KRBL 350.5 385.2")
        return
    
    symbol = sys.argv[1].upper()
    support = float(sys.argv[2]) if len(sys.argv) > 2 else None
    resistance = float(sys.argv[3]) if len(sys.argv) > 3 else None
    
    validate_breakout(symbol, support, resistance)
    
    print(f"\n{'='*60}")
    print("✅ VALIDATION COMPLETE")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
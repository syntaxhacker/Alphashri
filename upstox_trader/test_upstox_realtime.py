#!/usr/bin/env python3
"""
Test Upstox Real-time WebSocket Connection
Quick verification that real-time data streaming is working
"""

import time
from datetime import datetime
from config import UPSTOX_CONFIG

# Test if SDK is available
try:
    import upstox_client
    print("✅ Upstox SDK available")
    SDK_AVAILABLE = True
except ImportError:
    print("❌ Upstox SDK not found")
    print("📥 Install with: pip install upstox-python-sdk")
    SDK_AVAILABLE = False
    exit(1)

# Test authentication
from free_indian_apis import UpstoxAPI

def test_websocket_connection():
    """Test WebSocket connection for real-time data"""
    
    print(f"\n🔧 Testing Upstox Real-time WebSocket...")
    print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Initialize API
    api = UpstoxAPI(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret']
    )
    
    # Authenticate
    if not api.access_token:
        print("🔑 Authenticating...")
        if not api.authenticate():
            print("❌ Authentication failed")
            return False
    
    print("✅ Authentication successful")
    
    # Setup WebSocket
    configuration = upstox_client.Configuration()
    configuration.access_token = api.access_token
    
    # Test with TATAMOTORS (commonly available)
    instrument_key = "NSE_EQ|INE155A01022"  # TATAMOTORS
    
    print(f"📡 Testing WebSocket for {instrument_key}...")
    
    # Track updates
    updates_received = 0
    prices_seen = []
    
    def on_message(message):
        nonlocal updates_received, prices_seen
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']
                for key, data in feeds.items():
                    if 'ltp' in data:
                        price = float(data['ltp'])
                        updates_received += 1
                        prices_seen.append(price)
                        
                        print(f"📈 Update #{updates_received}: ₹{price:.2f} at {datetime.now().strftime('%H:%M:%S')}")
                        
                        # Stop after 10 updates
                        if updates_received >= 10:
                            streamer.disconnect()
                            
        except Exception as e:
            print(f"❌ Error processing message: {e}")
    
    def on_open():
        print("🔗 WebSocket connected!")
    
    def on_error(error):
        print(f"❌ WebSocket error: {error}")
    
    # Create streamer
    api_client = upstox_client.ApiClient(configuration)
    streamer = upstox_client.MarketDataStreamerV3(
        api_client,
        [instrument_key],
        "ltpc"
    )
    
    # Set up handlers
    streamer.on("message", on_message)
    streamer.on("open", on_open) 
    streamer.on("error", on_error)
    
    # Connect and wait
    print("🔌 Connecting to WebSocket...")
    streamer.connect()
    
    # Wait for updates
    start_time = time.time()
    timeout = 30  # 30 second timeout
    
    while updates_received < 10 and (time.time() - start_time) < timeout:
        time.sleep(0.5)
    
    # Results
    print(f"\n📊 Test Results:")
    print(f"✅ Updates received: {updates_received}")
    print(f"📈 Price range: ₹{min(prices_seen):.2f} - ₹{max(prices_seen):.2f}" if prices_seen else "No prices received")
    print(f"⏱️  Test duration: {time.time() - start_time:.1f} seconds")
    
    if updates_received > 0:
        print(f"🎉 SUCCESS: Real-time WebSocket is working!")
        print(f"💡 Your bot will now show live P&L changes instead of 0.00%")
        return True
    else:
        print(f"❌ FAILED: No real-time updates received")
        print(f"💡 Check market hours or symbol availability")
        return False

if __name__ == "__main__":
    test_websocket_connection() 
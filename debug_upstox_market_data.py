#!/usr/bin/env python3
"""
Debug Upstox Market Data Access
Test REST API vs WebSocket to find the root cause
"""

import time
import json
from datetime import datetime
from config import UPSTOX_CONFIG
from free_indian_apis import UpstoxAPI

try:
    import upstox_client
    print("✅ Upstox SDK available")
except ImportError:
    print("❌ SDK not available")
    exit(1)

def test_rest_api_quotes():
    """Test if we can get current market quotes via REST API"""
    print("\n🔧 Testing REST API Market Quotes...")
    
    api = UpstoxAPI(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret']
    )
    
    if not api.access_token:
        print("🔑 Authenticating...")
        if not api.authenticate():
            print("❌ Authentication failed")
            return False
    
    print("✅ Authentication successful")
    
    # Test symbols
    test_symbols = ['TATAMOTORS', 'RELIANCE', 'INFY', 'SBIN']
    
    for symbol in test_symbols:
        try:
            print(f"\n📊 Testing {symbol}...")
            
            # Try to get instrument key
            instrument_key = api.get_instrument_key(symbol)
            print(f"🔑 Instrument key: {instrument_key}")
            
            if instrument_key:
                # Test REST API quote
                headers = api._get_headers()
                import requests
                
                quote_url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={instrument_key}"
                response = requests.get(quote_url, headers=headers)
                
                print(f"📡 REST API Response ({response.status_code}):")
                if response.status_code == 200:
                    data = response.json()
                    print(f"✅ Success: {json.dumps(data, indent=2)}")
                else:
                    print(f"❌ Error: {response.text}")
            else:
                print(f"❌ No instrument key found for {symbol}")
                
        except Exception as e:
            print(f"❌ Error testing {symbol}: {str(e)}")
    
    return True

def test_websocket_detailed():
    """Test WebSocket with detailed debugging"""
    print("\n🔧 Testing WebSocket with Detailed Debugging...")
    
    api = UpstoxAPI(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret']
    )
    
    if not api.access_token:
        api.authenticate()
    
    # Setup configuration
    configuration = upstox_client.Configuration()
    configuration.access_token = api.access_token
    
    print(f"🔑 Access Token: {api.access_token[:20]}...")
    
    # Test different instrument keys
    test_instruments = [
        "NSE_EQ|INE155A01022",  # TATAMOTORS
        "NSE_EQ|INE002A01018",  # RELIANCE
        "NSE_EQ|INE009A01021",  # INFY
    ]
    
    for instrument_key in test_instruments:
        print(f"\n📡 Testing WebSocket for: {instrument_key}")
        
        # Global variables for this test
        messages_received = 0
        connection_opened = False
        errors_received = []
        
        def on_message(message):
            nonlocal messages_received
            messages_received += 1
            print(f"📨 Message #{messages_received}: {str(message)[:200]}...")
            
            # Stop after 3 messages or 15 seconds
            if messages_received >= 3:
                streamer.disconnect()
        
        def on_open():
            nonlocal connection_opened
            connection_opened = True
            print("🔗 WebSocket OPENED successfully!")
        
        def on_error(error):
            nonlocal errors_received
            errors_received.append(str(error))
            print(f"❌ WebSocket ERROR: {error}")
        
        def on_close():
            print("🔌 WebSocket CLOSED")
        
        try:
            # Create streamer
            api_client = upstox_client.ApiClient(configuration)
            streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                [instrument_key],
                "ltpc"  # Last Traded Price
            )
            
            # Set handlers
            streamer.on("message", on_message)
            streamer.on("open", on_open)
            streamer.on("error", on_error)
            streamer.on("close", on_close)
            
            # Connect
            print("🔌 Connecting...")
            streamer.connect()
            
            # Wait for data
            start_time = time.time()
            timeout = 15
            
            while messages_received == 0 and (time.time() - start_time) < timeout and not errors_received:
                time.sleep(0.5)
            
            # Results
            print(f"\n📊 Results for {instrument_key}:")
            print(f"🔗 Connection opened: {connection_opened}")
            print(f"📨 Messages received: {messages_received}")
            print(f"❌ Errors: {len(errors_received)}")
            if errors_received:
                for error in errors_received:
                    print(f"  - {error}")
            
            # Cleanup
            try:
                streamer.disconnect()
            except:
                pass
                
            time.sleep(2)  # Wait between tests
            
        except Exception as e:
            print(f"❌ WebSocket test failed for {instrument_key}: {str(e)}")

def test_websocket_auth():
    """Test WebSocket authorization endpoint"""
    print("\n🔧 Testing WebSocket Authorization...")
    
    api = UpstoxAPI(
        api_key=UPSTOX_CONFIG['api_key'],
        api_secret=UPSTOX_CONFIG['api_secret']
    )
    
    if not api.access_token:
        api.authenticate()
    
    try:
        import requests
        headers = api._get_headers()
        
        # Test WebSocket authorization endpoint
        auth_url = "https://api.upstox.com/v2/feed/market-data-feed/authorize"
        response = requests.get(auth_url, headers=headers)
        
        print(f"📡 WebSocket Auth Response ({response.status_code}):")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Success: {json.dumps(data, indent=2)}")
        else:
            print(f"❌ Error: {response.text}")
            
    except Exception as e:
        print(f"❌ WebSocket auth test failed: {str(e)}")

if __name__ == "__main__":
    print(f"🕐 Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("🇮🇳 Debugging Upstox Market Data Access...")
    
    # Run all tests
    test_rest_api_quotes()
    test_websocket_auth()
    test_websocket_detailed()
    
    print("\n✅ Debug tests completed!") 
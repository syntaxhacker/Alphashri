#!/usr/bin/env python3
"""
🔐 Upstox Daily Authentication Refresher

A simple script to refresh your Upstox access token at the beginning of each trading day.
Run this script once per day to ensure your token is valid for trading operations.

Usage:
    python upstox_auth_refresh.py

Features:
- Checks if existing token is still valid (within 23 hours)
- Only prompts for re-authentication if token is expired or missing
- Saves token to .upstox_token.json for use by other scripts
- Simple, clean output with status indicators
"""

import sys
import os
from datetime import datetime, timedelta
from pathlib import Path
import json

# Add the current directory to Python path to import our modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
except ImportError as e:
    print("❌ Import Error:")
    print("   Make sure you have:")
    print("   1. config.py file with UPSTOX_CONFIG containing your api_key and api_secret")
    print("   2. config_and_utils/free_indian_apis.py file")
    print(f"   Error details: {e}")
    sys.exit(1)

def check_token_status():
    """Check if we have a valid token already (DB -> file)"""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'stock-screener-ui'))
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token("upstox")
        if token_data and token_data.get("access_token"):
            return True, "Token found in DB (broker_connections)"
    except Exception:
        pass

    token_file = Path.home() / ".upstox_token.json"
    
    if not token_file.exists():
        return False, "No token found in DB or file"
    
    try:
        with open(token_file, 'r') as f:
            token_data = json.load(f)
        
        token_time = datetime.fromisoformat(token_data.get('timestamp', '1970-01-01'))
        time_diff = datetime.now() - token_time
        
        if time_diff < timedelta(hours=23):
            hours_remaining = 23 - time_diff.total_seconds() / 3600
            return True, f"File token valid for {hours_remaining:.1f} more hours"
        else:
            return False, "File token expired"
            
    except (json.JSONDecodeError, KeyError) as e:
        return False, f"Token file corrupted: {e}"

def main():
    """Main authentication flow"""
    print("🔐 Upstox Daily Authentication Refresher")
    print("=" * 50)
    
    # Check configuration
    if not (UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret')):
        print("❌ Configuration Error:")
        print("   Please ensure your config.py file has valid UPSTOX_CONFIG with:")
        print("   - api_key: Your Upstox API key")
        print("   - api_secret: Your Upstox API secret")
        return False
    
    # Check current token status
    print("\n🔍 Checking current token status...")
    is_valid, status_msg = check_token_status()
    print(f"   {status_msg}")
    
    if is_valid:
        print("\n✅ Token is still valid! No authentication needed.")
        print("   You can proceed with your trading operations.")
        return True
    
    # Token needs refresh
    print("\n🔄 Token refresh required. Starting authentication...")
    
    # Initialize API
    try:
        api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    except Exception as e:
        print(f"❌ Failed to initialize Upstox API: {e}")
        return False
    
    # Authenticate
    print("\n🚀 Starting authentication process...")
    print("   This will open your browser for Upstox login.")
    print("   Please complete the login and return here.")

    try:
        if api.auth_handler.authenticate():
            print("\n✅ Authentication successful!")
            print("   Token saved and ready for use.")
            print("   You can now run your trading scripts.")
            return True
        else:
            print("\n❌ Authentication failed!")
            print("   Please check your credentials and try again.")
            return False
            
    except KeyboardInterrupt:
        print("\n\n⚠️ Authentication cancelled by user.")
        return False
    except Exception as e:
        print(f"\n❌ Authentication error: {e}")
        return False

def quick_test():
    """Quick test to verify the token works"""
    print("\n🧪 Quick token test...")
    
    try:
        api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])

        if api.auth_handler.access_token:
            print("✅ Token loaded successfully!")

            # Try to get instrument key for a common stock as a test
            test_key = api.get_instrument_key("RELIANCE")
            if test_key:
                print("✅ API connection test passed!")
                print(f"   Sample instrument key: {test_key[:20]}...")
                return True
            else:
                print("⚠️ Token valid but API test failed (instrument lookup)")
                return False
        else:
            print("❌ No valid token available")
            return False
            
    except Exception as e:
        print(f"❌ Token test failed: {e}")
        return False

if __name__ == "__main__":
    print(f"🕐 Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    success = main()
    
    if success:
        # Run a quick test
        quick_test()
        print("\n🎉 All done! Your Upstox authentication is ready.")
        print("   Token will be valid until tomorrow.")
    else:
        print("\n💡 Troubleshooting tips:")
        print("   1. Check your internet connection")
        print("   2. Verify your API credentials in config.py")
        print("   3. Make sure your Upstox account is active")
        print("   4. Try running the script again")
    
    print(f"\n🕐 Finished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
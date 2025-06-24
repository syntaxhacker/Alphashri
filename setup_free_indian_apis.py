#!/usr/bin/env python3
"""
🇮🇳 SETUP GUIDE: FREE INDIAN STOCK MARKET APIs

Complete setup instructions for:
1. Upstox API (FREE)
2. ICICI Breeze API (FREE) 
3. TrueData API (FREE Trial)
4. NSEPy Library (FREE)
"""

import subprocess
import sys
import os
from pathlib import Path

class FreeAPISetup:
    def __init__(self):
        print("🇮🇳 FREE INDIAN STOCK MARKET APIs SETUP GUIDE")
        print("="*60)
        
    def install_nsepy(self):
        """Install NSEPy library"""
        print("\n📦 INSTALLING NSEPy (Completely FREE)")
        print("-"*40)
        
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "nsepy"])
            print("✅ NSEPy installed successfully!")
            
            # Test installation
            try:
                from nsepy import get_history
                print("✅ NSEPy import test successful")
                return True
            except ImportError as e:
                print(f"❌ NSEPy import failed: {e}")
                return False
                
        except subprocess.CalledProcessError as e:
            print(f"❌ NSEPy installation failed: {e}")
            return False
    
    def setup_upstox_guide(self):
        """Guide for Upstox API setup"""
        print("\n🏆 UPSTOX API SETUP (COMPLETELY FREE)")
        print("="*50)
        
        print("📋 Step-by-step instructions:")
        print("1. Visit: https://upstox.com/trading-api/")
        print("2. Click 'Open Demat Account' (FREE)")
        print("3. Complete KYC process")
        print("4. Login to Upstox dashboard")
        print("5. Go to 'API' section")
        print("6. Create new app (FREE)")
        print("7. Get API credentials:")
        print("   • API Key")
        print("   • API Secret")
        print("   • Access Token")
        
        print("\n📊 Features:")
        print("• ✅ Real-time data")
        print("• ✅ Historical data")
        print("• ✅ Option chain")
        print("• ✅ 50 requests/second")
        print("• ✅ NSE/BSE/MCX support")
        print("• ✅ Python SDK available")
        
        print("\n💻 Sample Python Code:")
        print("""
from upstox_client import Configuration, ApiClient, LoginApi, MarketDataApi

# Configuration
config = Configuration()
config.host = 'https://api.upstox.com/v2'
config.access_token = 'YOUR_ACCESS_TOKEN'

# Get market data
api_client = ApiClient(config)
market_api = MarketDataApi(api_client)

# Fetch TATAMOTORS data
response = market_api.get_historical_candle_data(
    'NSE_EQ|INE155A01022',  # TATAMOTORS NSE code
    '1day',
    '2024-01-01',
    '2024-12-31'
)
""")
    
    def setup_breeze_guide(self):
        """Guide for ICICI Breeze API setup"""
        print("\n🏆 ICICI BREEZE API SETUP (COMPLETELY FREE)")
        print("="*50)
        
        print("📋 Step-by-step instructions:")
        print("1. Visit: https://www.icicidirect.com/futures-and-options/api/breeze")
        print("2. Open ICICI Direct account")
        print("3. Login to ICICI Direct")
        print("4. Visit: https://api.icicidirect.com/apiuser/home")
        print("5. Create API app (FREE)")
        print("6. Get credentials:")
        print("   • API Key")
        print("   • Secret Key")
        print("   • Session Token (generated daily)")
        
        print("\n📊 Features:")
        print("• ✅ 3 years historical data")
        print("• ✅ Real-time streaming")
        print("• ✅ Option chain data")
        print("• ✅ 100 calls/minute")
        print("• ✅ Futures & Options")
        print("• ✅ Multiple SDKs")
        
        print("\n💻 Sample Python Code:")
        print("""
from breeze_connect import BreezeConnect

# Initialize
breeze = BreezeConnect(api_key="YOUR_API_KEY")
breeze.generate_session(
    api_secret="YOUR_SECRET_KEY", 
    session_token="YOUR_SESSION_TOKEN"
)

# Get historical data
data = breeze.get_historical_data_v2(
    interval="1day",
    from_date="2024-01-01T07:00:00.000Z",
    to_date="2024-12-31T07:00:00.000Z",
    stock_code="TATAMOTORS",
    exchange_code="NSE",
    product_type="cash"
)
""")
    
    def setup_truedata_guide(self):
        """Guide for TrueData API setup"""
        print("\n🟡 TRUEDATA API SETUP (FREE TRIAL)")
        print("="*45)
        
        print("📋 Step-by-step instructions:")
        print("1. Visit: https://www.truedata.in/products/marketdataapi")
        print("2. Fill free trial form")
        print("3. Receive API credentials via email")
        print("4. Test with limited access")
        print("5. Consider paid plans if needed")
        
        print("\n📊 Features:")
        print("• 🟡 Free trial available")
        print("• ✅ WebSocket streaming")
        print("• ✅ REST API")
        print("• ✅ Option Greeks")
        print("• ✅ Multiple languages")
        
    def create_integration_template(self):
        """Create integration template"""
        print("\n📄 CREATING INTEGRATION TEMPLATE")
        print("-"*40)
        
        template_code = '''"""
🇮🇳 FREE INDIAN APIS INTEGRATION TEMPLATE

Choose your preferred FREE API provider and update credentials below
"""

import pandas as pd
from datetime import datetime, timedelta

class IndianStockAPI:
    def __init__(self, provider='upstox'):
        self.provider = provider
        
        if provider == 'upstox':
            self.setup_upstox()
        elif provider == 'breeze':
            self.setup_breeze()
        elif provider == 'nsepy':
            self.setup_nsepy()
    
    def setup_upstox(self):
        """Setup Upstox API"""
        # TODO: Add your Upstox credentials
        self.api_key = "YOUR_UPSTOX_API_KEY"
        self.api_secret = "YOUR_UPSTOX_SECRET"
        self.access_token = "YOUR_UPSTOX_TOKEN"
        
        # Initialize Upstox client
        try:
            from upstox_client import Configuration, ApiClient
            config = Configuration()
            config.host = 'https://api.upstox.com/v2'
            config.access_token = self.access_token
            self.client = ApiClient(config)
            print("✅ Upstox API initialized")
        except ImportError:
            print("⚠️ Install: pip install upstox-client")
    
    def setup_breeze(self):
        """Setup ICICI Breeze API"""
        # TODO: Add your Breeze credentials  
        self.api_key = "YOUR_BREEZE_API_KEY"
        self.api_secret = "YOUR_BREEZE_SECRET"
        self.session_token = "YOUR_BREEZE_SESSION_TOKEN"
        
        try:
            from breeze_connect import BreezeConnect
            self.breeze = BreezeConnect(api_key=self.api_key)
            self.breeze.generate_session(
                api_secret=self.api_secret,
                session_token=self.session_token
            )
            print("✅ Breeze API initialized")
        except ImportError:
            print("⚠️ Install: pip install breeze-connect")
    
    def setup_nsepy(self):
        """Setup NSEPy (no credentials needed)"""
        try:
            from nsepy import get_history
            print("✅ NSEPy ready (no credentials needed)")
        except ImportError:
            print("⚠️ Install: pip install nsepy")
    
    def fetch_data(self, symbol, days_back=30):
        """Fetch stock data"""
        if self.provider == 'nsepy':
            return self.fetch_nsepy_data(symbol, days_back)
        elif self.provider == 'upstox':
            return self.fetch_upstox_data(symbol, days_back)
        elif self.provider == 'breeze':
            return self.fetch_breeze_data(symbol, days_back)
    
    def fetch_nsepy_data(self, symbol, days_back):
        """Fetch via NSEPy"""
        from nsepy import get_history
        from datetime import date
        
        end_date = date.today()
        start_date = end_date - timedelta(days=days_back)
        
        clean_symbol = symbol.replace('.NS', '').replace('.BO', '')
        data = get_history(symbol=clean_symbol, start=start_date, end=end_date)
        
        return data

# Usage example:
# api = IndianStockAPI(provider='nsepy')  # Start with NSEPy (no signup)
# data = api.fetch_data('TATAMOTORS')
# print(data.head())
'''
        
        # Save template
        with open('indian_api_template.py', 'w') as f:
            f.write(template_code)
        
        print("✅ Template created: indian_api_template.py")
        
    def show_next_steps(self):
        """Show next steps"""
        print("\n🎯 NEXT STEPS")
        print("="*30)
        
        print("IMMEDIATE (No signup required):")
        print("1. ✅ Use NSEPy library (already available)")
        print("2. ✅ Test with synthetic data (working)")
        
        print("\nRECOMMENDED (Sign up for FREE APIs):")
        print("1. 🏆 Upstox API - Best features, completely free")
        print("2. 🏆 ICICI Breeze - 3 years history, very reliable")
        
        print("\nTEST YOUR SETUP:")
        print("1. Run: python indian_api_template.py")
        print("2. Update credentials in template")
        print("3. Test with TATAMOTORS data")
        print("4. Integrate with walk forward analysis")
        
    def run_setup(self):
        """Run complete setup"""
        print("🚀 Starting FREE API setup process...")
        
        # Install NSEPy first
        nsepy_ok = self.install_nsepy()
        
        # Show all setup guides
        self.setup_upstox_guide()
        self.setup_breeze_guide() 
        self.setup_truedata_guide()
        
        # Create integration template
        self.create_integration_template()
        
        # Show next steps
        self.show_next_steps()
        
        print("\n🎉 SETUP COMPLETE!")
        print("You now have multiple FREE options for Indian stock data!")

if __name__ == "__main__":
    setup = FreeAPISetup()
    setup.run_setup() 
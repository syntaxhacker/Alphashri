"""
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
if __name__ == "__main__":
    print("🇮🇳 Testing Indian Stock API Template")
    print("="*50)
    
    # Test NSEPy (no credentials needed)
    try:
        api = IndianStockAPI(provider='nsepy')
        data = api.fetch_data('TATAMOTORS')
        
        if data is not None and not data.empty:
            print(f"✅ Successfully fetched {len(data)} days of TATAMOTORS data")
            print(f"Latest close: ₹{data['Close'].iloc[-1]:.2f}")
            print("\nFirst 5 rows:")
            print(data.head())
        else:
            print("❌ No data returned")
            
    except Exception as e:
        print(f"❌ Error: {e}")
        print("💡 NSEPy might be temporarily unavailable")
        print("   Consider signing up for Upstox or Breeze API instead")

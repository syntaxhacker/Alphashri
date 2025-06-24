#!/usr/bin/env python3
"""
🇮🇳 FREE INDIAN STOCK MARKET APIs INTEGRATION

Supports multiple FREE API providers:
1. Upstox API (FREE)
2. ICICI Breeze API (FREE) 
3. TrueData API (FREE Trial)
4. Alternative free sources
"""

import pandas as pd
import numpy as np
import requests
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import json
import warnings
warnings.filterwarnings('ignore')

class FreeIndianMarketAPI:
    """
    Unified interface for FREE Indian stock market APIs
    """
    
    def __init__(self):
        self.api_providers = {
            'upstox': {
                'name': 'Upstox Trading API',
                'free': True,
                'rate_limit': '50 req/sec',
                'website': 'https://upstox.com/trading-api/',
                'requires_account': True
            },
            'breeze': {
                'name': 'ICICI Breeze API',
                'free': True,
                'rate_limit': '100 req/min',
                'website': 'https://www.icicidirect.com/futures-and-options/api/breeze',
                'requires_account': True
            },
            'truedata': {
                'name': 'TrueData API',
                'free': 'Trial',
                'rate_limit': 'Trial limited',
                'website': 'https://www.truedata.in/products/marketdataapi',
                'requires_account': True
            },
            'nsepy': {
                'name': 'NSEPy Library',
                'free': True,
                'rate_limit': 'Reasonable use',
                'website': 'https://github.com/swapniljariwala/nsepy',
                'requires_account': False
            }
        }
        
        print("🇮🇳 FREE INDIAN STOCK MARKET API CONNECTOR")
        print("="*60)
        
        # List available free APIs
        for key, api in self.api_providers.items():
            status = "✅ FREE" if api['free'] == True else f"🟡 {api['free']}"
            account = "📋 Account Required" if api['requires_account'] else "🎯 Direct Access"
            print(f"{status} {api['name']}")
            print(f"   Rate Limit: {api['rate_limit']}")
            print(f"   {account}")
            print(f"   Website: {api['website']}")
            print()
    
    def test_nsepy_access(self) -> bool:
        """Test NSEPy library access (completely free)"""
        try:
            from nsepy import get_history
            from datetime import date
            
            print("🔍 Testing NSEPy (FREE - No account required)...")
            
            # Test with a small date range
            end_date = date.today()
            start_date = end_date - timedelta(days=5)
            
            # Test RELIANCE first (most liquid)
            data = get_history(symbol="RELIANCE", start=start_date, end=end_date)
            
            if data is not None and not data.empty:
                print(f"✅ NSEPy working! Got {len(data)} days of RELIANCE data")
                print(f"   Latest price: ₹{data['Close'].iloc[-1]:.2f}")
                print(f"   Date range: {data.index[0].date()} to {data.index[-1].date()}")
                return True
            else:
                print("❌ NSEPy returned empty data")
                return False
                
        except ImportError:
            print("⚠️ NSEPy not installed. Installing...")
            import subprocess
            subprocess.check_call(["pip", "install", "nsepy"])
            return self.test_nsepy_access()
        except Exception as e:
            print(f"❌ NSEPy error: {e}")
            return False
    
    def fetch_nsepy_data(self, symbol: str, days_back: int = 30) -> Optional[pd.DataFrame]:
        """Fetch data using NSEPy (completely free)"""
        try:
            from nsepy import get_history
            from datetime import date
            
            end_date = date.today()
            start_date = end_date - timedelta(days=days_back)
            
            print(f"📊 Fetching {symbol} data via NSEPy (FREE)...")
            
            # Clean symbol name (remove .NS or .BO suffixes)
            clean_symbol = symbol.replace('.NS', '').replace('.BO', '')
            
            data = get_history(symbol=clean_symbol, start=start_date, end=end_date)
            
            if data is not None and not data.empty:
                # Standardize column names to match our system
                data = data.rename(columns={
                    'Open': 'open',
                    'High': 'high', 
                    'Low': 'low',
                    'Close': 'close',
                    'Volume': 'volume'
                })
                
                print(f"✅ Retrieved {len(data)} days of {symbol} data")
                return data
            else:
                print(f"❌ No data found for {symbol}")
                return None
                
        except Exception as e:
            print(f"❌ Error fetching {symbol}: {e}")
            return None
    
    def test_yfinance_backup(self, symbol: str) -> Optional[pd.DataFrame]:
        """Test yfinance as backup for Indian stocks"""
        try:
            import yfinance as yf
            
            print(f"🔄 Testing yfinance backup for {symbol}...")
            
            # Add .NS suffix if not present
            if not symbol.endswith(('.NS', '.BO')):
                test_symbols = [f"{symbol}.NS", f"{symbol}.BO"]
            else:
                test_symbols = [symbol]
            
            for test_symbol in test_symbols:
                try:
                    ticker = yf.Ticker(test_symbol)
                    data = ticker.history(period="1mo")
                    
                    if not data.empty:
                        # Standardize column names
                        data.columns = [col.lower() for col in data.columns]
                        print(f"✅ yfinance working for {test_symbol}!")
                        print(f"   Got {len(data)} days of data")
                        return data
                        
                except Exception as e:
                    print(f"   ❌ {test_symbol}: {e}")
                    continue
            
            return None
            
        except Exception as e:
            print(f"❌ yfinance error: {e}")
            return None
    
    def get_api_signup_instructions(self):
        """Provide instructions for signing up to free APIs"""
        print("\n📋 HOW TO GET FREE API ACCESS:")
        print("="*50)
        
        print("\n1. 🏆 UPSTOX API (BEST - Completely FREE)")
        print("   • Visit: https://upstox.com/trading-api/")
        print("   • Create FREE trading account")
        print("   • Enable API access (no cost)")
        print("   • Get API credentials")
        print("   • Rate limit: 50 requests/second")
        
        print("\n2. 🏆 ICICI BREEZE API (Excellent)")
        print("   • Visit: https://www.icicidirect.com/futures-and-options/api/breeze")
        print("   • Open ICICI account") 
        print("   • Register for Breeze API (FREE)")
        print("   • Get 3 years historical data")
        print("   • Rate limit: 100 calls/minute")
        
        print("\n3. 🟡 TrueData API (Free Trial)")
        print("   • Visit: https://www.truedata.in/products/marketdataapi")
        print("   • Sign up for free trial")
        print("   • Test with limited access")
        print("   • Consider paid plans later")
        
        print("\n4. ✅ NSEPy (Already Available - FREE)")
        print("   • No signup required!")
        print("   • Direct NSE data access")
        print("   • pip install nsepy")
        print("   • Open source library")
    
    def comprehensive_test(self):
        """Test all available free options"""
        print("\n🧪 COMPREHENSIVE FREE API TEST")
        print("="*40)
        
        results = {}
        
        # Test 1: NSEPy (no account required)
        print("\n1. Testing NSEPy (FREE - No account)...")
        nsepy_works = self.test_nsepy_access()
        results['nsepy'] = nsepy_works
        
        if nsepy_works:
            # Test fetching different stocks
            test_symbols = ['RELIANCE', 'TCS', 'TATAMOTORS', 'INFY']
            print(f"\n   Testing multiple symbols via NSEPy...")
            
            for symbol in test_symbols:
                data = self.fetch_nsepy_data(symbol, days_back=10)
                if data is not None:
                    print(f"   ✅ {symbol}: {len(data)} days, Latest: ₹{data['close'].iloc[-1]:.2f}")
                else:
                    print(f"   ❌ {symbol}: Failed")
        
        # Test 2: yfinance backup
        print(f"\n2. Testing yfinance backup...")
        yf_data = self.test_yfinance_backup('RELIANCE.NS')
        results['yfinance'] = yf_data is not None
        
        # Summary
        print(f"\n📊 RESULTS SUMMARY:")
        print(f"   NSEPy (FREE): {'✅ Working' if results['nsepy'] else '❌ Failed'}")
        print(f"   yfinance: {'✅ Working' if results['yfinance'] else '❌ Failed'}")
        
        if results['nsepy']:
            print(f"\n🎉 SUCCESS! You can use NSEPy for FREE Indian stock data!")
            print(f"   No account signup required!")
        elif results['yfinance']:
            print(f"\n🟡 yfinance working as backup")
        else:
            print(f"\n⚠️ Both free options failed. Consider API signups.")
            self.get_api_signup_instructions()
        
        return results

def main():
    """Demo the free Indian market APIs"""
    api = FreeIndianMarketAPI()
    
    # Run comprehensive test
    results = api.comprehensive_test()
    
    # If NSEPy works, demonstrate usage
    if results.get('nsepy'):
        print(f"\n🚀 DEMONSTRATION: Real Indian Stock Data")
        print("="*50)
        
        # Fetch TATAMOTORS data
        tatamotors_data = api.fetch_nsepy_data('TATAMOTORS', days_back=20)
        
        if tatamotors_data is not None:
            print(f"\n📈 TATAMOTORS Analysis (Last 20 days):")
            print(f"   Current Price: ₹{tatamotors_data['close'].iloc[-1]:.2f}")
            print(f"   High: ₹{tatamotors_data['close'].max():.2f}")
            print(f"   Low: ₹{tatamotors_data['close'].min():.2f}")
            print(f"   Average Volume: {tatamotors_data['volume'].mean():,.0f}")
            
            # Calculate simple returns
            daily_returns = tatamotors_data['close'].pct_change().dropna()
            print(f"   Daily Return (avg): {daily_returns.mean()*100:.2f}%")
            print(f"   Volatility: {daily_returns.std()*100:.2f}%")
            
            print(f"\n💡 This is REAL Indian stock market data - for FREE!")
    
    print(f"\n🎯 RECOMMENDATION:")
    if results.get('nsepy'):
        print(f"   Use NSEPy for immediate FREE access")
        print(f"   Consider Upstox/Breeze APIs for advanced features")
    else:
        print(f"   Sign up for Upstox or Breeze API (both FREE)")
        api.get_api_signup_instructions()

if __name__ == "__main__":
    main() 
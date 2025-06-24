#!/usr/bin/env python3
"""
Test alternative data sources for Indian stocks
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import requests
import time

print('🔍 Testing Alternative Data Sources for Indian Stocks')

def test_alpha_vantage():
    """Test Alpha Vantage API (free tier available)"""
    print('\n1. Testing Alpha Vantage API:')
    # Note: You need a free API key from https://www.alphavantage.co/support/#api-key
    api_key = "demo"  # Replace with actual key
    symbol = "RELIANCE.BSE"  # Try BSE format
    
    try:
        url = f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={api_key}"
        response = requests.get(url, timeout=10)
        data = response.json()
        
        if "Time Series (Daily)" in data:
            print(f"✅ Alpha Vantage: {symbol} data available")
            return True
        else:
            print(f"❌ Alpha Vantage: {data.get('Note', 'No data')}")
    except Exception as e:
        print(f"❌ Alpha Vantage error: {e}")
    
    return False

def test_quandl():
    """Test Quandl API (now part of Nasdaq)"""
    print('\n2. Testing Quandl/Nasdaq API:')
    try:
        # Try NSE data
        url = "https://www.quandl.com/api/v3/datasets/NSE/RELIANCE.csv?limit=5"
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            print("✅ Quandl: NSE data accessible")
            return True
        else:
            print(f"❌ Quandl: HTTP {response.status_code}")
    except Exception as e:
        print(f"❌ Quandl error: {e}")
    
    return False

def test_yahoo_direct():
    """Test Yahoo Finance direct API endpoints"""
    print('\n3. Testing Yahoo Direct API:')
    
    symbols = ['RELIANCE.NS', 'TCS.NS', 'TATAMOTORS.NS']
    
    for symbol in symbols:
        try:
            # Try direct Yahoo Finance API endpoint
            end_time = int(time.time())
            start_time = end_time - (30 * 24 * 60 * 60)  # 30 days ago
            
            url = f"https://query1.finance.yahoo.com/v7/finance/download/{symbol}"
            params = {
                'period1': start_time,
                'period2': end_time,
                'interval': '1d',
                'events': 'history'
            }
            
            response = requests.get(url, params=params, timeout=10)
            
            if response.status_code == 200 and len(response.content) > 100:
                lines = response.text.split('\n')
                if len(lines) > 2:  # Header + at least 1 data row
                    print(f"✅ Yahoo Direct: {symbol} - {len(lines)-2} days of data")
                    return True
            
            print(f"❌ Yahoo Direct: {symbol} - HTTP {response.status_code}")
            
        except Exception as e:
            print(f"❌ Yahoo Direct {symbol}: {e}")
    
    return False

def test_investing_com():
    """Test investing.com data scraping"""
    print('\n4. Testing Investing.com scraping:')
    try:
        # This would require web scraping - just check if site is accessible
        url = "https://in.investing.com/equities/reliance-industries"
        response = requests.get(url, timeout=10, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        if response.status_code == 200:
            print("✅ Investing.com: Site accessible (scraping possible)")
            return True
        else:
            print(f"❌ Investing.com: HTTP {response.status_code}")
    except Exception as e:
        print(f"❌ Investing.com error: {e}")
    
    return False

def test_nsepy():
    """Test nsepy library for NSE data"""
    print('\n5. Testing nsepy library:')
    try:
        # Try to import nsepy
        from nsepy import get_history
        from datetime import date
        
        # Get last 5 days of RELIANCE data
        end_date = date.today()
        start_date = end_date - timedelta(days=5)
        
        data = get_history(symbol="RELIANCE", start=start_date, end=end_date)
        
        if not data.empty:
            print(f"✅ nsepy: RELIANCE - {len(data)} days of data")
            print(f"   Latest close: ₹{data['Close'].iloc[-1]:.2f}")
            return True
        else:
            print("❌ nsepy: No data returned")
    except ImportError:
        print("❌ nsepy: Library not installed (pip install nsepy)")
    except Exception as e:
        print(f"❌ nsepy error: {e}")
    
    return False

# Run all tests
print("="*60)
working_sources = []

if test_alpha_vantage():
    working_sources.append("Alpha Vantage")

if test_quandl():
    working_sources.append("Quandl")

if test_yahoo_direct():
    working_sources.append("Yahoo Direct")

if test_investing_com():
    working_sources.append("Investing.com")

if test_nsepy():
    working_sources.append("nsepy")

print(f"\n{'='*60}")
print(f"📊 SUMMARY:")
if working_sources:
    print(f"✅ Working data sources: {', '.join(working_sources)}")
else:
    print("❌ No working data sources found")
    print("💡 Recommendations:")
    print("   1. Install nsepy: pip install nsepy")
    print("   2. Get Alpha Vantage API key (free): https://www.alphavantage.co/support/#api-key")
    print("   3. Wait for Yahoo Finance API to recover") 
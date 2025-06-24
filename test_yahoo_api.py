#!/usr/bin/env python3
"""
Test Yahoo Finance API directly with different symbol formats
"""

import yfinance as yf
import sys

print('🔍 Testing Yahoo Finance API directly...')

# Test US stock first
print('\n1. Testing US stock (AAPL):')
try:
    ticker = yf.Ticker('AAPL')
    data = ticker.history(period='5d')
    if not data.empty:
        print(f'✅ AAPL: {len(data)} bars fetched')
        print(f'   Latest price: ${data["Close"].iloc[-1]:.2f}')
    else:
        print('❌ AAPL: No data')
except Exception as e:
    print(f'❌ AAPL error: {e}')

# Test different Indian stock symbol formats
indian_symbols = [
    'TATAMOTORS.NS',
    'TATAMOTORS.BO', 
    'RELIANCE.NS',
    'TCS.NS',
    'INFY.NS',
    # Try without suffix
    'TATAMOTORS',
    'RELIANCE'
]

print('\n2. Testing Indian stock symbols:')
for symbol in indian_symbols:
    try:
        print(f'\nTesting {symbol}...')
        ticker = yf.Ticker(symbol)
        data = ticker.history(period='5d')
        if not data.empty:
            print(f'✅ {symbol}: {len(data)} bars fetched')
            print(f'   Latest price: ₹{data["Close"].iloc[-1]:.2f}')
            print('   SUCCESS! Found working symbol')
            break
        else:
            print(f'❌ {symbol}: No data returned')
    except Exception as e:
        print(f'❌ {symbol} error: {str(e)[:100]}')

print('\n3. Testing crypto (should work):')
try:
    ticker = yf.Ticker('BTC-USD')
    data = ticker.history(period='5d')
    if not data.empty:
        print(f'✅ BTC-USD: {len(data)} bars fetched')
        print(f'   Latest price: ${data["Close"].iloc[-1]:.2f}')
    else:
        print('❌ BTC-USD: No data')
except Exception as e:
    print(f'❌ BTC-USD error: {e}') 
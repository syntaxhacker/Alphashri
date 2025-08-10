import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os
import sys
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

@pytest.fixture
def mock_tv_screener_usage():
    """Mock TVScreenerUsage instance for testing"""
    mock_instance = Mock()
    mock_instance.market = 'india'
    mock_instance.cookies = {'session': 'test_session'}
    mock_instance.display_table = Mock()
    return mock_instance

@pytest.fixture
def sample_stock_data():
    """Sample stock data for testing"""
    dates = pd.date_range(start='2024-01-01', end='2024-01-31', freq='D')
    data = []
    
    for i, date in enumerate(dates):
        base_price = 100 + (i * 0.5) + np.random.normal(0, 2)
        high = base_price + np.random.uniform(1, 3)
        low = base_price - np.random.uniform(1, 3)
        volume = np.random.randint(100000, 1000000)
        
        data.append({
            'timestamp': date,
            'open': base_price + np.random.normal(0, 0.5),
            'high': high,
            'low': low,
            'close': base_price,
            'volume': volume
        })
    
    return pd.DataFrame(data)

@pytest.fixture
def sample_1min_data():
    """Sample 1-minute data for intraday testing"""
    start_time = datetime.now().replace(hour=9, minute=15, second=0, microsecond=0)
    times = []
    for i in range(375):  # 6.25 hours * 60 minutes
        times.append(start_time + timedelta(minutes=i))
    
    data = []
    base_price = 100
    
    for i, timestamp in enumerate(times):
        # Simulate intraday price movement
        price_change = np.random.normal(0, 0.1)
        base_price += price_change
        high = base_price + abs(np.random.normal(0, 0.2))
        low = base_price - abs(np.random.normal(0, 0.2))
        volume = np.random.randint(1000, 50000)
        
        data.append({
            'timestamp': timestamp,
            'open': base_price - price_change,
            'high': high,
            'low': low,
            'close': base_price,
            'volume': volume
        })
    
    return pd.DataFrame(data)

@pytest.fixture
def historical_data_cache():
    """Historical data cache for testing with realistic NSE stock data"""
    cache = {}
    
    # Common NSE stocks for testing
    stocks = ['RELIANCE', 'HDFCBANK', 'INFY', 'TCS', 'ICICIBANK']
    
    for stock in stocks:
        # Generate daily data
        dates = pd.date_range(start='2023-01-01', end='2024-12-31', freq='B')  # Business days
        daily_data = []
        
        base_price = np.random.uniform(500, 3000)  # Realistic price range
        
        for i, date in enumerate(dates):
            # Simulate realistic stock movement
            daily_change = np.random.normal(0, 0.02)  # 2% daily volatility
            base_price *= (1 + daily_change)
            
            high = base_price * (1 + abs(np.random.normal(0, 0.01)))
            low = base_price * (1 - abs(np.random.normal(0, 0.01)))
            volume = np.random.randint(1000000, 10000000)
            
            daily_data.append({
                'timestamp': date,
                'open': base_price / (1 + daily_change),
                'high': high,
                'low': low,
                'close': base_price,
                'volume': volume,
                'name': stock
            })
        
        cache[f'{stock}_daily'] = pd.DataFrame(daily_data)
        
        # Generate 1-minute data for recent dates
        recent_date = dates[-1]
        start_time = recent_date.replace(hour=9, minute=15)
        minute_data = []
        
        for i in range(375):  # Market hours
            timestamp = start_time + timedelta(minutes=i)
            minute_change = np.random.normal(0, 0.001)  # 0.1% minute volatility
            base_price *= (1 + minute_change)
            
            minute_data.append({
                'timestamp': timestamp,
                'open': base_price / (1 + minute_change),
                'high': base_price * (1 + abs(np.random.normal(0, 0.0005))),
                'low': base_price * (1 - abs(np.random.normal(0, 0.0005))),
                'close': base_price,
                'volume': np.random.randint(1000, 100000),
                'name': stock
            })
        
        cache[f'{stock}_1min'] = pd.DataFrame(minute_data)
    
    return cache

@pytest.fixture
def mock_tradingview_query():
    """Mock TradingView Query responses"""
    def mock_query_response(select_cols=None, market=None, where_conditions=None, 
                          order_by=None, limit=None):
        # Generate realistic mock data based on query parameters
        n_results = limit if limit else 15
        
        mock_data = []
        for i in range(n_results):
            stock_name = f"STOCK{i+1}"
            base_price = np.random.uniform(50, 2000)
            
            row = {
                'name': stock_name,
                'close': base_price,
                'volume': np.random.randint(100000, 5000000),
                'change': np.random.uniform(-5, 5),
                'relative_volume_10d_calc': np.random.uniform(0.5, 3.0),
                'RSI': np.random.uniform(20, 80),
                'RSI[1]': np.random.uniform(20, 80),
                'price_52_week_high': base_price * np.random.uniform(1.0, 1.5),
                'EMA20': base_price * np.random.uniform(0.95, 1.05),
                'EMA50': base_price * np.random.uniform(0.9, 1.1),
                'market_cap_basic': np.random.uniform(1e9, 1e12),
                'MACD.macd': np.random.uniform(-10, 10),
                'MACD.signal': np.random.uniform(-10, 10),
                'update_mode': 'streaming',
                'sector': np.random.choice(['Technology', 'Banking', 'Healthcare', 
                                         'Energy', 'Consumer', 'Industrial'])
            }
            mock_data.append(row)
        
        df = pd.DataFrame(mock_data)
        return n_results, df
    
    return mock_query_response

@pytest.fixture
def real_nifty50_data():
    """Real Nifty 50 stock symbols for integration tests"""
    return [
        'RELIANCE', 'HDFCBANK', 'INFY', 'ICICIBANK', 'TCS', 'KOTAKBANK', 
        'HINDUNILVR', 'LT', 'AXISBANK', 'ITC', 'MARUTI', 'BAJAJFINSV',
        'ASIANPAINT', 'NESTLEIND', 'DMART', 'HCLTECH', 'BAJFINANCE',
        'TITAN', 'ULTRACEMCO', 'ONGC', 'SUNPHARMA', 'NTPC', 'TECHM',
        'POWERGRID', 'M&M', 'TATAMOTORS', 'WIPRO', 'GRASIM', 'LTIM',
        'COALINDIA', 'BAJAJ-AUTO', 'BRITANNIA', 'EICHERMOT', 'SBIN',
        'BPCL', 'CIPLA', 'HINDALCO', 'HEROMOTOCO', 'DIVISLAB', 'DRREDDY',
        'APOLLOHOSP', 'INDUSINDBK', 'ADANIENT', 'ADANIPORTS', 'BHARTIARTL',
        'HDFCLIFE', 'JSWSTEEL', 'TATACONSUM', 'SBILIFE'
    ]

@pytest.fixture(autouse=True)
def setup_test_environment():
    """Setup test environment variables and configurations"""
    os.environ['TESTING'] = '1'
    yield
    # Cleanup
    if 'TESTING' in os.environ:
        del os.environ['TESTING']
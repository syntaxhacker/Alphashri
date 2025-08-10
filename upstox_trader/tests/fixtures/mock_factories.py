import factory
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import random


class StockDataFactory(factory.Factory):
    """Factory for generating realistic stock data"""
    
    class Meta:
        model = dict
    
    name = factory.Sequence(lambda n: f"STOCK{n:03d}")
    close = factory.LazyAttribute(lambda obj: round(np.random.uniform(50, 5000), 2))
    volume = factory.LazyAttribute(lambda obj: np.random.randint(100000, 10000000))
    change = factory.LazyAttribute(lambda obj: round(np.random.uniform(-10, 10), 2))
    RSI = factory.LazyAttribute(lambda obj: round(np.random.uniform(0, 100), 1))
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(0.1, 5.0), 2))
    market_cap_basic = factory.LazyAttribute(lambda obj: np.random.uniform(1e9, 1e12))
    sector = factory.LazyAttribute(lambda obj: np.random.choice([
        'Technology', 'Banking', 'Healthcare', 'Energy', 'Consumer', 
        'Industrial', 'Materials', 'Utilities', 'Telecom', 'Real Estate'
    ]))


class BreakoutStockFactory(StockDataFactory):
    """Factory for stocks in breakout pattern"""
    
    change = factory.LazyAttribute(lambda obj: round(np.random.uniform(5, 15), 2))  # Strong positive change
    RSI = factory.LazyAttribute(lambda obj: round(np.random.uniform(60, 85), 1))  # Strong RSI
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(2.0, 5.0), 2))  # High volume
    volume = factory.LazyAttribute(lambda obj: np.random.randint(2000000, 20000000))  # High volume


class AccumulationStockFactory(StockDataFactory):
    """Factory for stocks in accumulation pattern"""
    
    change = factory.LazyAttribute(lambda obj: round(np.random.uniform(-1, 3), 2))  # Modest change
    RSI = factory.LazyAttribute(lambda obj: round(np.random.uniform(45, 65), 1))  # Neutral RSI
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(1.2, 2.5), 2))  # Increasing volume


class OversoldStockFactory(StockDataFactory):
    """Factory for oversold stocks ready to bounce"""
    
    change = factory.LazyAttribute(lambda obj: round(np.random.uniform(-8, -2), 2))  # Recent decline
    RSI = factory.LazyAttribute(lambda obj: round(np.random.uniform(20, 40), 1))  # Oversold RSI
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(1.5, 3.0), 2))


class GapUpStockFactory(StockDataFactory):
    """Factory for gap up stocks"""
    
    change = factory.LazyAttribute(lambda obj: round(np.random.uniform(3, 12), 2))  # Gap up change
    RSI = factory.LazyAttribute(lambda obj: round(np.random.uniform(55, 80), 1))  # Strong RSI
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(3.0, 10.0), 2))  # Very high volume
    volume = factory.LazyAttribute(lambda obj: np.random.randint(5000000, 50000000))  # Very high volume


class HighVolumeStockFactory(StockDataFactory):
    """Factory for high volume stocks"""
    
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(5.0, 20.0), 2))
    volume = factory.LazyAttribute(lambda obj: np.random.randint(10000000, 100000000))


class LowLiquidityStockFactory(StockDataFactory):
    """Factory for low liquidity stocks"""
    
    volume = factory.LazyAttribute(lambda obj: np.random.randint(1000, 100000))  # Very low volume
    relative_volume_10d_calc = factory.LazyAttribute(lambda obj: round(np.random.uniform(0.1, 0.8), 2))
    close = factory.LazyAttribute(lambda obj: round(np.random.uniform(1, 50), 2))  # Lower priced
    market_cap_basic = factory.LazyAttribute(lambda obj: np.random.uniform(1e8, 1e10))  # Smaller cap


class HistoricalDataFactory:
    """Factory for generating historical OHLCV data"""
    
    @staticmethod
    def create_daily_data(symbol: str, 
                         days: int = 365,
                         base_price: float = 1000,
                         volatility: float = 0.02) -> pd.DataFrame:
        """Create realistic daily OHLCV data"""
        
        dates = pd.date_range(
            start=datetime.now() - timedelta(days=days),
            end=datetime.now(),
            freq='B'  # Business days only
        )
        
        data = []
        current_price = base_price
        
        for date in dates:
            # Daily return with trend and mean reversion
            daily_return = np.random.normal(0, volatility)
            
            # Add some trending behavior
            trend_component = np.sin(len(data) / 50) * 0.001
            daily_return += trend_component
            
            # Calculate OHLC
            open_price = current_price
            close_price = current_price * (1 + daily_return)
            
            # High and low based on intraday volatility
            intraday_range = abs(daily_return) + np.random.uniform(0.005, 0.02)
            high_price = max(open_price, close_price) * (1 + intraday_range/2)
            low_price = min(open_price, close_price) * (1 - intraday_range/2)
            
            # Volume with realistic patterns
            base_volume = np.random.randint(500000, 5000000)
            volume_multiplier = 1 + abs(daily_return) * 3  # Higher volume on big moves
            volume = int(base_volume * volume_multiplier)
            
            data.append({
                'timestamp': pd.Timestamp(date),
                'open': round(open_price, 2),
                'high': round(high_price, 2),
                'low': round(low_price, 2),
                'close': round(close_price, 2),
                'volume': volume,
                'symbol': symbol
            })
            
            current_price = close_price
        
        return pd.DataFrame(data)
    
    @staticmethod
    def create_intraday_data(symbol: str,
                           date: datetime,
                           base_price: float = 1000,
                           volatility: float = 0.001) -> pd.DataFrame:
        """Create realistic intraday 1-minute data"""
        
        # Market hours: 9:15 AM to 3:30 PM
        start_time = date.replace(hour=9, minute=15, second=0, microsecond=0)
        
        data = []
        current_price = base_price
        
        for minute in range(375):  # 6 hours 15 minutes = 375 minutes
            timestamp = start_time + timedelta(minutes=minute)
            
            # Minute-level return
            minute_return = np.random.normal(0, volatility)
            
            # Add intraday patterns
            hour = timestamp.hour
            if hour == 9:  # Opening volatility
                minute_return *= 2
            elif hour == 15:  # Closing volatility
                minute_return *= 1.5
            
            # Calculate OHLC for the minute
            open_price = current_price
            close_price = current_price * (1 + minute_return)
            
            minute_range = abs(minute_return) + np.random.uniform(0.0001, 0.001)
            high_price = max(open_price, close_price) * (1 + minute_range/2)
            low_price = min(open_price, close_price) * (1 - minute_range/2)
            
            # Volume patterns
            base_volume = np.random.randint(1000, 10000)
            if hour == 9:  # Higher volume at open
                base_volume *= 3
            elif hour == 15:  # Higher volume at close
                base_volume *= 2
            
            data.append({
                'timestamp': timestamp,
                'open': round(open_price, 2),
                'high': round(high_price, 2),
                'low': round(low_price, 2),
                'close': round(close_price, 2),
                'volume': base_volume,
                'symbol': symbol
            })
            
            current_price = close_price
        
        return pd.DataFrame(data)


class TradingViewResponseFactory:
    """Factory for mocking TradingView API responses"""
    
    @staticmethod
    def create_scanner_response(n_stocks: int = 15,
                              pattern_type: str = 'mixed') -> tuple:
        """Create mock TradingView scanner response"""
        
        if pattern_type == 'breakout':
            factory_class = BreakoutStockFactory
        elif pattern_type == 'accumulation':
            factory_class = AccumulationStockFactory
        elif pattern_type == 'oversold':
            factory_class = OversoldStockFactory
        elif pattern_type == 'gap_up':
            factory_class = GapUpStockFactory
        elif pattern_type == 'high_volume':
            factory_class = HighVolumeStockFactory
        else:
            factory_class = StockDataFactory
        
        stocks = factory_class.create_batch(n_stocks)
        df = pd.DataFrame(stocks)
        
        # Add additional columns that might be in real responses
        df['EMA20'] = df['close'] * np.random.uniform(0.95, 1.05, n_stocks)
        df['EMA50'] = df['close'] * np.random.uniform(0.90, 1.10, n_stocks)
        df['price_52_week_high'] = df['close'] * np.random.uniform(1.0, 1.5, n_stocks)
        df['MACD.macd'] = np.random.uniform(-5, 5, n_stocks)
        df['MACD.signal'] = np.random.uniform(-5, 5, n_stocks)
        df['update_mode'] = 'streaming'
        
        return len(df), df
    
    @staticmethod
    def create_empty_response() -> tuple:
        """Create empty scanner response"""
        return 0, pd.DataFrame()
    
    @staticmethod
    def create_error_response() -> tuple:
        """Create error response for testing exception handling"""
        raise Exception("TradingView API Error")


class MockTVScreenerUsage:
    """Mock TVScreenerUsage class for testing"""
    
    def __init__(self, market: str = 'india'):
        self.market = market
        self.cookies = {'session': 'test_session'}
        self.display_table_calls = []
        self.historical_trend_calls = []
    
    def display_table(self, df: pd.DataFrame, title: str = ""):
        """Mock display_table method"""
        self.display_table_calls.append({'df': df, 'title': title})
    
    def _check_historical_trend(self, symbol: str, timeframe: str = 'daily', lookback_days: int = 15) -> str:
        """Mock historical trend check"""
        self.historical_trend_calls.append({
            'symbol': symbol,
            'timeframe': timeframe,
            'lookback_days': lookback_days
        })
        
        # Return different trends based on symbol for predictable testing
        if 'STRONG' in symbol or 'BREAKOUT' in symbol:
            return 'Strong Bullish'
        elif 'WEAK' in symbol or 'OVERSOLD' in symbol:
            return 'Bearish'
        elif 'ACCUMULATION' in symbol:
            return 'Accumulating'
        else:
            return 'Neutral'


class TestScenarioFactory:
    """Factory for creating specific test scenarios"""
    
    @staticmethod
    def create_market_crash_scenario() -> pd.DataFrame:
        """Create data simulating market crash conditions"""
        stocks = []
        for i in range(20):
            stock = {
                'name': f'CRASH_STOCK_{i}',
                'close': np.random.uniform(20, 100),
                'volume': np.random.randint(5000000, 50000000),  # Very high volume
                'change': np.random.uniform(-20, -5),  # Heavy losses
                'RSI': np.random.uniform(10, 30),  # Extremely oversold
                'relative_volume_10d_calc': np.random.uniform(5, 20),  # Panic selling volume
                'sector': np.random.choice(['Banking', 'Technology', 'Energy'])
            }
            stocks.append(stock)
        
        return pd.DataFrame(stocks)
    
    @staticmethod
    def create_bull_market_scenario() -> pd.DataFrame:
        """Create data simulating strong bull market"""
        stocks = []
        for i in range(20):
            stock = {
                'name': f'BULL_STOCK_{i}',
                'close': np.random.uniform(500, 5000),
                'volume': np.random.randint(1000000, 10000000),
                'change': np.random.uniform(3, 15),  # Strong gains
                'RSI': np.random.uniform(60, 85),  # Strong momentum
                'relative_volume_10d_calc': np.random.uniform(1.5, 4.0),
                'sector': np.random.choice(['Technology', 'Healthcare', 'Consumer'])
            }
            stocks.append(stock)
        
        return pd.DataFrame(stocks)
    
    @staticmethod
    def create_sideways_market_scenario() -> pd.DataFrame:
        """Create data simulating sideways/choppy market"""
        stocks = []
        for i in range(20):
            stock = {
                'name': f'SIDEWAYS_STOCK_{i}',
                'close': np.random.uniform(100, 1000),
                'volume': np.random.randint(500000, 3000000),
                'change': np.random.uniform(-2, 2),  # Small moves
                'RSI': np.random.uniform(40, 60),  # Neutral RSI
                'relative_volume_10d_calc': np.random.uniform(0.8, 1.5),  # Normal volume
                'sector': np.random.choice(['Banking', 'Industrial', 'Materials'])
            }
            stocks.append(stock)
        
        return pd.DataFrame(stocks)
    
    @staticmethod
    def create_sector_rotation_scenario() -> pd.DataFrame:
        """Create data showing sector rotation"""
        sectors_performance = {
            'Technology': {'change_range': (5, 12), 'volume_mult': 2.5},  # Outperforming
            'Healthcare': {'change_range': (2, 8), 'volume_mult': 1.8},   # Moderate
            'Energy': {'change_range': (-3, 1), 'volume_mult': 1.2},      # Lagging
            'Banking': {'change_range': (-1, 4), 'volume_mult': 1.5}      # Mixed
        }
        
        stocks = []
        for sector, perf in sectors_performance.items():
            for i in range(5):  # 5 stocks per sector
                change_range = perf['change_range']
                volume_mult = perf['volume_mult']
                
                stock = {
                    'name': f'{sector.upper()}_{i}',
                    'close': np.random.uniform(200, 2000),
                    'volume': int(np.random.randint(1000000, 5000000) * volume_mult),
                    'change': np.random.uniform(change_range[0], change_range[1]),
                    'RSI': np.random.uniform(35, 75),
                    'relative_volume_10d_calc': volume_mult,
                    'sector': sector
                }
                stocks.append(stock)
        
        return pd.DataFrame(stocks)


# Utility functions for test data generation
def generate_test_portfolio(n_stocks: int = 10, 
                          patterns: List[str] = None) -> pd.DataFrame:
    """Generate a test portfolio with mixed patterns"""
    
    if patterns is None:
        patterns = ['mixed'] * n_stocks
    
    all_stocks = []
    for pattern in patterns:
        response = TradingViewResponseFactory.create_scanner_response(1, pattern)
        all_stocks.extend(response[1].to_dict('records'))
    
    return pd.DataFrame(all_stocks)


def create_time_series_with_pattern(pattern_type: str, 
                                   length: int = 100) -> pd.DataFrame:
    """Create time series data with specific pattern"""
    
    dates = pd.date_range(start='2024-01-01', periods=length, freq='D')
    
    if pattern_type == 'trending_up':
        prices = np.cumsum(np.random.normal(0.001, 0.02, length)) + 100
    elif pattern_type == 'trending_down':
        prices = np.cumsum(np.random.normal(-0.001, 0.02, length)) + 100
    elif pattern_type == 'volatile':
        prices = np.cumsum(np.random.normal(0, 0.05, length)) + 100
    elif pattern_type == 'stable':
        prices = np.cumsum(np.random.normal(0, 0.005, length)) + 100
    else:  # random walk
        prices = np.cumsum(np.random.normal(0, 0.02, length)) + 100
    
    # Ensure prices stay positive
    prices = np.maximum(prices, 1)
    
    return pd.DataFrame({
        'timestamp': dates,
        'close': prices,
        'volume': np.random.randint(100000, 5000000, length)
    })
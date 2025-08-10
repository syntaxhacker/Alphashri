import pandas as pd
import numpy as np
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import json
import pickle


class HistoricalDataFetcher:
    """Fetch and cache historical data for testing purposes"""
    
    def __init__(self, cache_dir: str = "tests/fixtures/data_cache"):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
    
    def fetch_nifty50_historical_data(self, 
                                    days_back: int = 365,
                                    include_1min: bool = True) -> Dict[str, pd.DataFrame]:
        """Fetch historical data for Nifty 50 stocks"""
        
        nifty50_symbols = [
            'RELIANCE', 'HDFCBANK', 'INFY', 'ICICIBANK', 'TCS', 'KOTAKBANK',
            'HINDUNILVR', 'LT', 'AXISBANK', 'ITC', 'MARUTI', 'BAJAJFINSV',
            'ASIANPAINT', 'NESTLEIND', 'HCLTECH', 'BAJFINANCE', 'ULTRACEMCO',
            'ONGC', 'SUNPHARMA', 'NTPC', 'TECHM', 'POWERGRID', 'M&M',
            'TATAMOTORS', 'WIPRO', 'GRASIM', 'LTIM', 'COALINDIA',
            'BAJAJ-AUTO', 'BRITANNIA', 'EICHERMOT', 'SBIN', 'BPCL',
            'CIPLA', 'HINDALCO', 'HEROMOTOCO', 'DIVISLAB', 'DRREDDY',
            'APOLLOHOSP', 'INDUSINDBK', 'ADANIENT', 'ADANIPORTS',
            'BHARTIARTL', 'HDFCLIFE', 'JSWSTEEL', 'TATACONSUM', 'SBILIFE'
        ]
        
        historical_data = {}
        
        for symbol in nifty50_symbols:
            # Generate daily data
            daily_data = self._generate_realistic_daily_data(
                symbol, days_back
            )
            historical_data[f"{symbol}_daily"] = daily_data
            
            if include_1min:
                # Generate 1-minute data for last 5 trading days
                minute_data = self._generate_realistic_1min_data(
                    symbol, base_price=daily_data['close'].iloc[-1]
                )
                historical_data[f"{symbol}_1min"] = minute_data
        
        # Cache the data
        self._cache_data(historical_data, "nifty50_historical.pkl")
        return historical_data
    
    def _generate_realistic_daily_data(self, 
                                     symbol: str, 
                                     days_back: int) -> pd.DataFrame:
        """Generate realistic daily stock data"""
        
        # Set realistic base prices for different sectors
        sector_prices = {
            'RELIANCE': 2500, 'HDFCBANK': 1600, 'INFY': 1400, 'ICICIBANK': 1000,
            'TCS': 3500, 'KOTAKBANK': 1800, 'HINDUNILVR': 2400, 'LT': 3000,
            'AXISBANK': 1100, 'ITC': 450, 'MARUTI': 9000, 'BAJAJFINSV': 1500,
            'ASIANPAINT': 3200, 'NESTLEIND': 22000, 'HCLTECH': 1200, 
            'BAJFINANCE': 7000, 'ULTRACEMCO': 8500, 'ONGC': 180, 'SUNPHARMA': 1100,
            'NTPC': 280, 'TECHM': 1100, 'POWERGRID': 240, 'M&M': 1400,
            'TATAMOTORS': 450, 'WIPRO': 400, 'GRASIM': 2000, 'LTIM': 4500,
            'COALINDIA': 350, 'BAJAJ-AUTO': 7500, 'BRITANNIA': 4800, 
            'EICHERMOT': 3200, 'SBIN': 750, 'BPCL': 320, 'CIPLA': 1200,
            'HINDALCO': 500, 'HEROMOTOCO': 4500, 'DIVISLAB': 4200, 'DRREDDY': 5500,
            'APOLLOHOSP': 5800, 'INDUSINDBK': 1300, 'ADANIENT': 2200, 
            'ADANIPORTS': 1100, 'BHARTIARTL': 900, 'HDFCLIFE': 650,
            'JSWSTEEL': 850, 'TATACONSUM': 900, 'SBILIFE': 1400
        }
        
        base_price = sector_prices.get(symbol, 1000)
        
        # Generate date range (exclude weekends)
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        dates = pd.date_range(start=start_date, end=end_date, freq='B')  # Business days
        
        data = []
        current_price = base_price
        
        for i, date in enumerate(dates):
            # Simulate realistic daily volatility (0.5% to 3% daily moves)
            daily_volatility = np.random.uniform(0.005, 0.03)
            daily_return = np.random.normal(0, daily_volatility)
            
            # Add some trending behavior
            trend_factor = np.sin(i / 50) * 0.001  # Subtle trending
            daily_return += trend_factor
            
            # Calculate OHLC
            open_price = current_price
            close_price = current_price * (1 + daily_return)
            
            # High and low with realistic spreads
            daily_range = abs(daily_return) + np.random.uniform(0.002, 0.01)
            high_price = max(open_price, close_price) * (1 + daily_range/2)
            low_price = min(open_price, close_price) * (1 - daily_range/2)
            
            # Volume with realistic patterns
            base_volume = np.random.randint(1000000, 10000000)
            volume_multiplier = 1 + abs(daily_return) * 5  # Higher volume on big moves
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
    
    def _generate_realistic_1min_data(self, 
                                    symbol: str, 
                                    base_price: float,
                                    days: int = 5) -> pd.DataFrame:
        """Generate realistic 1-minute intraday data"""
        
        data = []
        
        for day in range(days):
            date = datetime.now().date() - timedelta(days=day)
            
            # Skip weekends
            if date.weekday() >= 5:
                continue
            
            # Market hours: 9:15 AM to 3:30 PM (375 minutes)
            start_time = datetime.combine(date, datetime.min.time().replace(hour=9, minute=15))
            
            current_price = base_price * (1 + np.random.normal(0, 0.01))  # Daily gap
            
            for minute in range(375):
                timestamp = start_time + timedelta(minutes=minute)
                
                # Intraday volatility (much lower than daily)
                minute_return = np.random.normal(0, 0.001)  # 0.1% per minute volatility
                
                # Add intraday patterns
                hour = timestamp.hour
                minute_of_hour = timestamp.minute
                
                # Higher volatility at market open and close
                if hour == 9 or hour == 15:
                    minute_return *= 2
                
                # Calculate OHLC for the minute
                open_price = current_price
                close_price = current_price * (1 + minute_return)
                
                minute_range = abs(minute_return) + np.random.uniform(0.0001, 0.002)
                high_price = max(open_price, close_price) * (1 + minute_range/2)
                low_price = min(open_price, close_price) * (1 - minute_range/2)
                
                # Volume patterns
                base_volume = np.random.randint(1000, 50000)
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
                    'symbol': symbol,
                    'date': date
                })
                
                current_price = close_price
        
        return pd.DataFrame(data)
    
    def generate_test_scenarios(self) -> Dict[str, pd.DataFrame]:
        """Generate specific test scenarios for different trading patterns"""
        
        scenarios = {}
        
        # Scenario 1: Breakout pattern
        scenarios['breakout_pattern'] = self._create_breakout_scenario()
        
        # Scenario 2: Gap up scenario
        scenarios['gap_up_pattern'] = self._create_gap_up_scenario()
        
        # Scenario 3: Accumulation pattern
        scenarios['accumulation_pattern'] = self._create_accumulation_scenario()
        
        # Scenario 4: High volume breakout
        scenarios['high_volume_breakout'] = self._create_high_volume_breakout()
        
        # Scenario 5: Oversold bounce
        scenarios['oversold_bounce'] = self._create_oversold_bounce()
        
        return scenarios
    
    def _create_breakout_scenario(self) -> pd.DataFrame:
        """Create a stock breaking out of consolidation"""
        dates = pd.date_range(start='2024-01-01', end='2024-02-29', freq='B')
        data = []
        
        base_price = 1000
        consolidation_days = 30
        
        for i, date in enumerate(dates):
            if i < consolidation_days:
                # Consolidation phase - tight range
                price_change = np.random.uniform(-0.005, 0.005)  # 0.5% range
            else:
                # Breakout phase - strong upward movement
                price_change = np.random.uniform(0.01, 0.03)  # 1-3% daily gains
            
            base_price *= (1 + price_change)
            
            volume = 2000000 if i >= consolidation_days else 500000  # Higher volume on breakout
            
            data.append({
                'timestamp': pd.Timestamp(date),
                'open': base_price / (1 + price_change),
                'high': base_price * 1.02,
                'low': base_price * 0.98,
                'close': base_price,
                'volume': volume,
                'symbol': 'BREAKOUT_STOCK'
            })
        
        return pd.DataFrame(data)
    
    def _create_gap_up_scenario(self) -> pd.DataFrame:
        """Create a gap up scenario with follow-through"""
        dates = pd.date_range(start='2024-01-01', end='2024-01-31', freq='B')
        data = []
        
        base_price = 500
        gap_day = len(dates) // 2
        
        for i, date in enumerate(dates):
            if i == gap_day:
                # Gap up day - 5% gap
                open_price = base_price * 1.05
                close_price = open_price * 1.02  # Follow through
                volume = 5000000  # High volume
            else:
                # Normal days
                daily_change = np.random.normal(0, 0.01)
                open_price = base_price
                close_price = base_price * (1 + daily_change)
                volume = np.random.randint(500000, 1500000)
            
            data.append({
                'timestamp': pd.Timestamp(date),
                'open': round(open_price, 2),
                'high': round(max(open_price, close_price) * 1.01, 2),
                'low': round(min(open_price, close_price) * 0.99, 2),
                'close': round(close_price, 2),
                'volume': volume,
                'symbol': 'GAP_UP_STOCK'
            })
            
            base_price = close_price
        
        return pd.DataFrame(data)
    
    def _create_accumulation_scenario(self) -> pd.DataFrame:
        """Create accumulation pattern with increasing volume"""
        dates = pd.date_range(start='2024-01-01', end='2024-03-31', freq='B')
        data = []
        
        base_price = 800
        base_volume = 1000000
        
        for i, date in enumerate(dates):
            # Slow price appreciation with increasing volume
            price_change = np.random.uniform(-0.005, 0.01)  # Slight upward bias
            volume = base_volume * (1 + i * 0.01)  # Gradually increasing volume
            
            base_price *= (1 + price_change)
            
            data.append({
                'timestamp': pd.Timestamp(date),
                'open': base_price / (1 + price_change),
                'high': base_price * 1.015,
                'low': base_price * 0.985,
                'close': base_price,
                'volume': int(volume),
                'symbol': 'ACCUMULATION_STOCK'
            })
        
        return pd.DataFrame(data)
    
    def _create_high_volume_breakout(self) -> pd.DataFrame:
        """Create high volume breakout scenario"""
        dates = pd.date_range(start='2024-01-01', end='2024-02-15', freq='B')
        data = []
        
        base_price = 1200
        breakout_day = len(dates) - 5
        
        for i, date in enumerate(dates):
            if i == breakout_day:
                # High volume breakout
                price_change = 0.08  # 8% breakout
                volume = 10000000  # 10x normal volume
            elif i > breakout_day:
                # Follow through days
                price_change = np.random.uniform(0.01, 0.03)
                volume = np.random.randint(3000000, 6000000)
            else:
                # Normal days
                price_change = np.random.uniform(-0.01, 0.01)
                volume = np.random.randint(800000, 1200000)
            
            base_price *= (1 + price_change)
            
            data.append({
                'timestamp': pd.Timestamp(date),
                'open': base_price / (1 + price_change),
                'high': base_price * 1.02,
                'low': base_price * 0.98,
                'close': base_price,
                'volume': volume,
                'symbol': 'HIGH_VOLUME_STOCK'
            })
        
        return pd.DataFrame(data)
    
    def _create_oversold_bounce(self) -> pd.DataFrame:
        """Create oversold bounce scenario"""
        dates = pd.date_range(start='2024-01-01', end='2024-02-29', freq='B')
        data = []
        
        base_price = 600
        oversold_period = 20
        bounce_start = oversold_period + 5
        
        for i, date in enumerate(dates):
            if i < oversold_period:
                # Declining phase
                price_change = np.random.uniform(-0.03, -0.01)
            elif i >= bounce_start:
                # Bounce phase
                price_change = np.random.uniform(0.02, 0.05)
            else:
                # Bottom formation
                price_change = np.random.uniform(-0.005, 0.005)
            
            base_price *= (1 + price_change)
            volume = 2000000 if i >= bounce_start else 1000000
            
            data.append({
                'timestamp': pd.Timestamp(date),
                'open': base_price / (1 + price_change),
                'high': base_price * 1.02,
                'low': base_price * 0.98,
                'close': base_price,
                'volume': volume,
                'symbol': 'OVERSOLD_STOCK'
            })
        
        return pd.DataFrame(data)
    
    def _cache_data(self, data: Dict, filename: str):
        """Cache data to disk"""
        filepath = os.path.join(self.cache_dir, filename)
        with open(filepath, 'wb') as f:
            pickle.dump(data, f)
        print(f"Cached data to {filepath}")
    
    def load_cached_data(self, filename: str) -> Optional[Dict]:
        """Load cached data from disk"""
        filepath = os.path.join(self.cache_dir, filename)
        if os.path.exists(filepath):
            with open(filepath, 'rb') as f:
                return pickle.load(f)
        return None
    
    def get_sample_stocks_for_testing(self) -> List[str]:
        """Get a subset of stocks for faster testing"""
        return ['RELIANCE', 'HDFCBANK', 'INFY', 'ICICIBANK', 'TCS']


if __name__ == "__main__":
    # Generate test data
    fetcher = HistoricalDataFetcher()
    
    print("Generating historical data for testing...")
    historical_data = fetcher.fetch_nifty50_historical_data(days_back=365)
    print(f"Generated data for {len(historical_data)} datasets")
    
    print("Generating test scenarios...")
    scenarios = fetcher.generate_test_scenarios()
    fetcher._cache_data(scenarios, "test_scenarios.pkl")
    print(f"Generated {len(scenarios)} test scenarios")
    
    print("Historical data generation complete!")
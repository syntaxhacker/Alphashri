"""
Synthetic market data generator

This module generates realistic synthetic market data when real market data
cannot be retrieved or for testing purposes.
"""

import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging

logger = logging.getLogger('data_generator')

class SyntheticDataGenerator:
    """Generates synthetic OHLCV data with realistic properties"""

    def __init__(self, base_price=None, volatility=None, trend=None, seed=None):
        """
        Initialize the synthetic data generator
        
        Args:
            base_price (float): Starting price for the synthetic data
            volatility (float): Daily volatility as decimal (e.g., 0.015 for 1.5%)
            trend (float): Daily trend as decimal (e.g., 0.001 for 0.1% uptrend)
            seed (int): Random seed for reproducibility
        """
        self.base_price = base_price or 20000.0  # Default base price for Nifty
        self.volatility = volatility or 0.015    # Default 1.5% daily volatility
        self.trend = trend or 0.0005             # Default 0.05% daily uptrend
        
        # Set random seed if provided
        if seed is not None:
            np.random.seed(seed)
            
        logger.info(f"Initialized synthetic data generator with base_price={self.base_price}, "
                   f"volatility={self.volatility}, trend={self.trend}")

    def generate_daily_data(self, days=90, return_df=True):
        """
        Generate daily OHLCV data
        
        Args:
            days (int): Number of days to generate
            return_df (bool): Whether to return as DataFrame (True) or dict (False)
            
        Returns:
            pd.DataFrame or dict: Synthetic daily OHLCV data
        """
        # Generate dates
        end_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        start_date = end_date - timedelta(days=days)
        
        # Generate only business days (Monday to Friday)
        dates = pd.date_range(start=start_date, end=end_date, freq='B')
        
        # Generate price series with trend and volatility
        daily_returns = np.random.normal(self.trend, self.volatility, len(dates))
        
        # Simulate some auto-correlation in returns
        for i in range(1, len(daily_returns)):
            daily_returns[i] = 0.7 * daily_returns[i] + 0.3 * daily_returns[i-1]
            
        # Calculate price path
        prices = self.base_price * np.cumprod(1 + daily_returns)
        
        # Generate OHLC data based on daily close prices
        intraday_vol = self.volatility / 2
        
        opens = prices * (1 + np.random.normal(0, intraday_vol/2, len(dates)))
        highs = np.maximum(prices * (1 + np.abs(np.random.normal(0, intraday_vol, len(dates)))), 
                           np.maximum(opens, prices))
        lows = np.minimum(prices * (1 - np.abs(np.random.normal(0, intraday_vol, len(dates)))),
                          np.minimum(opens, prices))
        
        # Generate volume data with some relation to price changes
        volume_base = 10000000  # Base volume
        volume_var = 5000000    # Volume variation
        volumes = volume_base + np.random.normal(0, volume_var, len(dates))
        
        # Make volume higher on high volatility days
        volumes = volumes * (1 + 2 * np.abs(daily_returns))
        
        # Create DataFrame
        df = pd.DataFrame({
            'open': opens,
            'high': highs,
            'low': lows,
            'close': prices,
            'volume': volumes.astype(int)
        }, index=dates)
        
        # Make sure high is the highest and low is the lowest
        for i in range(len(df)):
            df.loc[df.index[i], 'high'] = max(df.loc[df.index[i], ['open', 'high', 'close']])
            df.loc[df.index[i], 'low'] = min(df.loc[df.index[i], ['open', 'low', 'close']])
        
        logger.info(f"Generated {len(df)} days of synthetic data from {df.index.min()} to {df.index.max()}")
        
        if return_df:
            return df
        else:
            return df.to_dict('list')

    def generate_intraday_data(self, interval='5m', days=90, return_df=True):
        """
        Generate intraday OHLCV data
        
        Args:
            interval (str): Intraday interval ('1m', '5m', '15m', '30m', '1h')
            days (int): Number of days to generate
            return_df (bool): Whether to return as DataFrame (True) or dict (False)
            
        Returns:
            pd.DataFrame or dict: Synthetic intraday OHLCV data
        """
        # Convert interval to minutes
        interval_minutes = {
            '1m': 1,
            '5m': 5,
            '15m': 15,
            '30m': 30,
            '1h': 60,
            '4h': 240
        }.get(interval, 5)
        
        # Generate daily data first
        daily_df = self.generate_daily_data(days=days)
        
        # Define trading hours (9:15 AM to 3:30 PM IST for NSE)
        market_open = 9 * 60 + 15  # 9:15 AM in minutes
        market_close = 15 * 60 + 30  # 3:30 PM in minutes
        
        # Calculate number of intervals per day
        intervals_per_day = (market_close - market_open) // interval_minutes
        
        # Create empty list for intraday data
        all_data = []
        
        # For each day in daily data
        for day_idx, day in enumerate(daily_df.index):
            # Get daily OHLC
            day_open = daily_df.loc[day, 'open']
            day_high = daily_df.loc[day, 'high']
            day_low = daily_df.loc[day, 'low']
            day_close = daily_df.loc[day, 'close']
            day_volume = daily_df.loc[day, 'volume']
            
            # Generate intraday price path using random walk around daily values
            intraday_volatility = self.volatility / np.sqrt(intervals_per_day)
            
            # Start with open price
            intraday_prices = [day_open]
            
            # Generate remaining prices for the day
            for i in range(1, intervals_per_day):
                # Add more weight to move toward close price as day progresses
                progress = i / intervals_per_day
                pull_to_close = (day_close - intraday_prices[-1]) * progress * 0.2
                
                # Random component with intraday volatility
                random_change = np.random.normal(0, intraday_volatility * day_open)
                
                # Calculate next price
                next_price = intraday_prices[-1] + pull_to_close + random_change
                intraday_prices.append(next_price)
            
            # Ensure the last price is close to the daily close
            intraday_prices[-1] = day_close
            
            # Calculate OHLC for each interval
            for i in range(intervals_per_day):
                candle_start_idx = i
                
                # Use single price for the candle if it's the first one
                if i == 0:
                    candle_prices = [intraday_prices[0]]
                else:
                    # Get the price for this candle
                    candle_prices = [intraday_prices[i]]
                
                # Calculate interval OHLC
                interval_open = candle_prices[0]
                
                # Add some random variations for high and low
                price = candle_prices[0]
                high_var = np.abs(np.random.normal(0, price * intraday_volatility))
                low_var = np.abs(np.random.normal(0, price * intraday_volatility))
                
                interval_high = price + high_var
                interval_low = price - low_var
                interval_close = price
                
                # Make sure high and low are consistent
                interval_high = max(interval_high, interval_open, interval_close)
                interval_low = min(interval_low, interval_open, interval_close)
                
                # Calculate interval volume (distributed throughout the day with a U-shape pattern)
                time_of_day = i / intervals_per_day
                # U-shaped volume - higher at open and close
                volume_factor = 1.5 - 2 * (time_of_day - 0.5) ** 2
                interval_volume = int(day_volume / intervals_per_day * volume_factor * 
                                     np.random.uniform(0.8, 1.2))
                
                # Calculate timestamp
                minutes_from_open = i * interval_minutes
                hour = (market_open + minutes_from_open) // 60
                minute = (market_open + minutes_from_open) % 60
                
                timestamp = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
                
                # Add to result
                all_data.append({
                    'timestamp': timestamp,
                    'open': interval_open,
                    'high': interval_high,
                    'low': interval_low,
                    'close': interval_close,
                    'volume': interval_volume
                })
        
        # Create DataFrame
        df = pd.DataFrame(all_data)
        
        # Set timestamp as index
        df.set_index('timestamp', inplace=True)
        
        # Sort by timestamp
        df.sort_index(inplace=True)
        
        logger.info(f"Generated {len(df)} {interval} candles of synthetic intraday data "
                   f"from {df.index.min()} to {df.index.max()}")
        
        if return_df:
            return df
        else:
            return df.reset_index().to_dict('list')

# Usage example
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create generator
    generator = SyntheticDataGenerator(base_price=21500, volatility=0.015, trend=0.0005)
    
    # Generate intraday data
    intraday_data = generator.generate_intraday_data(interval='5m', days=30)
    
    # Print statistics
    print(f"Generated {len(intraday_data)} candles from {intraday_data.index.min()} to {intraday_data.index.max()}")
    print(f"Price range: {intraday_data['low'].min():.2f} - {intraday_data['high'].max():.2f}")
    
    # Save to CSV
    output_dir = 'nifty_intraday_bot/data'
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, f"NIFTY_synthetic_5m_{datetime.now().strftime('%Y%m%d')}.csv")
    intraday_data.to_csv(output_file)
    print(f"Saved to {output_file}") 
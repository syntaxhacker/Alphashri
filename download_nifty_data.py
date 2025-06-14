#!/usr/bin/env python
"""
Download and save historical Nifty 50 data to local files.

This script downloads historical Nifty 50 data from Yahoo Finance and
saves it to the 'historical_data' directory for offline use.
"""

import os
import yfinance as yf
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import argparse

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Download and save historical Nifty 50 data')
    parser.add_argument('--days', type=int, default=365, help='Number of days of historical data to download')
    parser.add_argument('--interval', type=str, default='1d', choices=['1d', '1h', '1wk', '1mo'], 
                      help='Data interval (1d, 1h, 1wk, 1mo)')
    parser.add_argument('--synthetic', action='store_true', help='Generate synthetic data instead of downloading')
    return parser.parse_args()

def generate_synthetic_data(days=365, interval='1d'):
    """Generate synthetic Nifty 50 data that resembles real data"""
    print(f"Generating {days} days of synthetic Nifty 50 data with {interval} interval...")
    
    # Set the random seed for reproducibility
    np.random.seed(42)
    
    # Determine the number of data points based on interval
    if interval == '1d':
        # Trading days only (approx. 252 trading days per year)
        periods = max(60, int(days * 252 / 365))  # Ensure at least 60 data points
        freq = 'B'  # Business days
    elif interval == '1h':
        # Trading hours (approx. 6.5 hours per day, 252 trading days per year)
        periods = max(120, int(days * 252 / 365 * 6.5))  # Ensure at least 120 data points
        freq = 'H'
    elif interval == '1wk':
        periods = max(52, int(days / 7))  # Ensure at least 52 data points
        freq = 'W'
    elif interval == '1mo':
        periods = max(24, int(days / 30))  # Ensure at least 24 data points
        freq = 'M'
    else:
        periods = max(60, days)  # Ensure at least 60 data points
        freq = 'D'
    
    print(f"Generating {periods} data points...")
    
    # Generate timestamps
    end_date = datetime.now()
    timestamps = pd.date_range(end=end_date, periods=periods, freq=freq)
    
    # Base parameters for Nifty 50
    base_price = 22000  # Starting price
    annual_drift = 0.10  # 10% annual return
    annual_volatility = 0.18  # 18% annual volatility
    
    # Scale for different intervals
    interval_scale = 1.0
    if interval == '1d':
        interval_scale = 1/252
    elif interval == '1h':
        interval_scale = 1/(252*6.5)
    elif interval == '1wk':
        interval_scale = 1/52
    elif interval == '1mo':
        interval_scale = 1/12
    
    # Drift and volatility per period
    drift = annual_drift * interval_scale
    volatility = annual_volatility * np.sqrt(interval_scale)
    
    # Generate returns
    returns = np.random.normal(drift, volatility, periods)
    
    # Generate price series
    prices = base_price * np.cumprod(1 + returns)
    
    # Generate OHLC data
    open_prices = prices / (1 + np.random.normal(0, volatility/3, periods))
    high_prices = np.maximum(prices, open_prices) * (1 + np.abs(np.random.normal(0, volatility/2, periods)))
    low_prices = np.minimum(prices, open_prices) * (1 - np.abs(np.random.normal(0, volatility/2, periods)))
    close_prices = prices
    
    # Generate volume data
    base_volume = 10000000  # Base volume
    volume = np.random.normal(base_volume, base_volume/4, periods).astype(int)
    volume = np.maximum(100000, volume)  # Ensure no negative volumes
    
    # Create DataFrame
    data = pd.DataFrame({
        'timestamp': timestamps,
        'open': open_prices,
        'high': high_prices,
        'low': low_prices,
        'close': close_prices,
        'volume': volume
    })
    
    # Make sure high and low are always the highest and lowest prices
    for i in range(len(data)):
        prices = [data.loc[i, 'open'], data.loc[i, 'close']]
        data.loc[i, 'high'] = max(data.loc[i, 'high'], max(prices))
        data.loc[i, 'low'] = min(data.loc[i, 'low'], min(prices))
    
    # Create directory if it doesn't exist
    os.makedirs('historical_data', exist_ok=True)
    
    # Save to CSV
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"historical_data/NIFTY50_data_{interval}_{timestamp}_synthetic.csv"
    data.to_csv(filename, index=False)
    
    print(f"Successfully generated {len(data)} records of synthetic data.")
    print(f"Date range: {data['timestamp'].min()} to {data['timestamp'].max()}")
    print(f"Data saved to {filename}")
    
    return filename

def download_nifty_data(days=365, interval='1d'):
    """Download Nifty 50 data from Yahoo Finance and save to local file"""
    print(f"Downloading {days} days of Nifty 50 data with {interval} interval...")
    
    # Create directory if it doesn't exist
    os.makedirs('historical_data', exist_ok=True)
    
    # Calculate start and end dates
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    try:
        # Download data from Yahoo Finance
        nifty_data = yf.download(
            "^NSEI",  # Yahoo Finance symbol for Nifty 50
            start=start_date,
            end=end_date,
            interval=interval
        )
        
        if len(nifty_data) == 0:
            print("No data found. Trying different symbol...")
            nifty_data = yf.download(
                "NSEI.NS",  # Alternative symbol
                start=start_date,
                end=end_date,
                interval=interval
            )
        
        if len(nifty_data) == 0:
            print("Failed to download data with both symbols.")
            return None
        
        # Rename columns to lowercase
        nifty_data.columns = [col.lower() for col in nifty_data.columns]
        
        # Add timestamp column
        nifty_data.reset_index(inplace=True)
        nifty_data.rename(columns={'date': 'timestamp'}, inplace=True)
        
        # Save to CSV
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"historical_data/NIFTY50_data_{interval}_{timestamp}.csv"
        nifty_data.to_csv(filename, index=False)
        
        print(f"Successfully downloaded {len(nifty_data)} records.")
        print(f"Date range: {nifty_data['timestamp'].min()} to {nifty_data['timestamp'].max()}")
        print(f"Data saved to {filename}")
        
        return filename
    except Exception as e:
        print(f"Error downloading data: {e}")
        return None

if __name__ == "__main__":
    args = parse_args()
    
    if args.synthetic:
        generate_synthetic_data(days=args.days, interval=args.interval)
    else:
        # Try to download real data first
        result = download_nifty_data(days=args.days, interval=args.interval)
        
        # If download fails, generate synthetic data as fallback
        if result is None:
            print("\nFalling back to synthetic data generation...")
            generate_synthetic_data(days=args.days, interval=args.interval) 
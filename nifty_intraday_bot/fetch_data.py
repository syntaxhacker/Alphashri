#!/usr/bin/env python
"""
Nifty Intraday Data Fetcher

This script fetches 3 months of intraday data for Nifty 50 at multiple timeframes
and saves it to the data directory.
"""

import os
import sys
import argparse
from datetime import datetime

# Add project directory to path
project_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(project_dir)

# Import our data fetcher
from utils.data_fetcher import NiftyDataFetcher

def parse_args():
    """Parse command-line arguments"""
    parser = argparse.ArgumentParser(description='Fetch Nifty intraday data')
    
    parser.add_argument('--symbol', type=str, default='^NSEI',
                        help='Symbol to fetch data for (default: ^NSEI for Nifty 50)')
    
    parser.add_argument('--intervals', type=str, nargs='+', 
                        default=['5m', '15m', '30m', '1h'],
                        help='Data intervals to fetch (default: 5m 15m 30m 1h)')
    
    parser.add_argument('--period', type=str, default='3mo',
                        help='Period to fetch (default: 3mo)')
    
    parser.add_argument('--cache-dir', type=str, 
                        default=os.path.join(project_dir, 'data', 'cache'),
                        help='Directory to cache data')
    
    parser.add_argument('--visualize', action='store_true',
                        help='Generate visualizations of the data')
    
    parser.add_argument('--output-dir', type=str,
                        default=os.path.join(project_dir, 'data'),
                        help='Directory to save processed data')
    
    return parser.parse_args()

def main():
    """Main function to fetch and save data"""
    args = parse_args()
    
    # Print startup message
    print(f"Nifty Intraday Bot - Data Fetcher")
    print(f"================================")
    print(f"Fetching {args.period} of {args.symbol} data")
    print(f"Intervals: {', '.join(args.intervals)}")
    print(f"Cache directory: {args.cache_dir}")
    print(f"Output directory: {args.output_dir}")
    print(f"Visualize: {args.visualize}")
    print(f"================================")
    
    # Create data fetcher
    fetcher = NiftyDataFetcher(cache_dir=args.cache_dir)
    
    # Create output directory if it doesn't exist
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Fetch data for all intervals
    print(f"\nFetching data for {args.symbol}...")
    
    data_dict = fetcher.fetch_multi_timeframe_data(
        symbol=args.symbol,
        intervals=args.intervals,
        period=args.period
    )
    
    # Display summary and save data
    for interval, df in data_dict.items():
        if df is not None and not df.empty:
            print(f"\n{interval} data summary:")
            print(f"- Date range: {df.index.min()} to {df.index.max()}")
            print(f"- Trading days: {len(df.index.strftime('%Y-%m-%d').unique())}")
            print(f"- Total candles: {len(df)}")
            print(f"- Price range: {df['low'].min():.2f} - {df['high'].max():.2f}")
            
            # Save to CSV
            output_file = os.path.join(
                args.output_dir, 
                f"{args.symbol.replace('^', '')}_intraday_{interval}_{datetime.now().strftime('%Y%m%d')}.csv"
            )
            df.to_csv(output_file)
            print(f"- Saved to: {output_file}")
            
            # Visualize if requested
            if args.visualize:
                fetcher.visualize_data(df, interval)
    
    print("\nData fetching complete!")
    if args.visualize:
        print("Visualizations saved to nifty_intraday_bot/results/visualizations/")

if __name__ == "__main__":
    main() 
#!/usr/bin/env python3
"""
Robust 5-minute data fetcher that works around Upstox API limitations
Uses intelligent chunking, gap detection, and data concatenation
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
import time

console = Console()

class Robust5MinFetcher:
    """
    Robust fetcher that can get maximum possible 5-minute data by:
    1. Trying multiple chunk sizes
    2. Detecting data gaps
    3. Working backwards from recent dates
    4. Concatenating successful chunks
    5. Filling gaps where possible
    """
    
    def __init__(self, api):
        self.api = api
        self.successful_chunks = []
        self.failed_ranges = []
        
    def fetch_maximum_5min_data(self, symbol, target_days=150, max_retries=3):
        """
        Fetch maximum possible 5-minute data using intelligent strategies
        """
        console.print(f"🚀 Robust 5-minute data fetcher for {symbol}")
        console.print(f"🎯 Target: {target_days} days of data")
        console.print("=" * 60)
        
        all_data_chunks = []
        current_date = datetime.now()
        
        # Strategy 1: Small chunks working backwards
        console.print("📈 Strategy 1: Small chunks (7-day) working backwards...")
        chunk_size = 7  # Start with 7-day chunks that we know work
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            chunks_needed = target_days // chunk_size
            task = progress.add_task("Fetching chunks...", total=chunks_needed)
            
            for chunk_num in range(chunks_needed):
                chunk_end = current_date - timedelta(days=chunk_num * chunk_size)
                chunk_start = current_date - timedelta(days=(chunk_num + 1) * chunk_size)
                
                progress.update(task, advance=1, 
                               description=f"Chunk {chunk_num + 1}: {chunk_start.strftime('%m-%d')} to {chunk_end.strftime('%m-%d')}")
                
                chunk_data = self._fetch_chunk_with_retry(
                    symbol, chunk_start, chunk_end, chunk_size, max_retries
                )
                
                if chunk_data is not None:
                    all_data_chunks.append(chunk_data)
                    self.successful_chunks.append((chunk_start, chunk_end, len(chunk_data)))
                else:
                    self.failed_ranges.append((chunk_start, chunk_end))
                
                # Small delay to be respectful to API
                time.sleep(0.1)
        
        # Strategy 2: Try to fill gaps with smaller chunks
        if self.failed_ranges:
            console.print("\n📊 Strategy 2: Filling gaps with micro-chunks (3-day)...")
            
            for gap_start, gap_end in self.failed_ranges[:5]:  # Try first 5 gaps
                micro_chunks = self._fill_gap_with_micro_chunks(symbol, gap_start, gap_end)
                if micro_chunks:
                    all_data_chunks.extend(micro_chunks)
        
        # Strategy 3: Try alternative date ranges
        if len(all_data_chunks) < (target_days // 10):  # If we have less than 10% success
            console.print("\n🔄 Strategy 3: Alternative date ranges...")
            alt_chunks = self._try_alternative_ranges(symbol, target_days)
            if alt_chunks:
                all_data_chunks.extend(alt_chunks)
        
        # Concatenate and clean all successful chunks
        if all_data_chunks:
            final_data = self._concatenate_and_clean(all_data_chunks)
            self._report_results(final_data, target_days)
            return final_data
        else:
            console.print("[red]❌ No data could be retrieved[/red]")
            return None
    
    def _fetch_chunk_with_retry(self, symbol, start_date, end_date, chunk_size, max_retries):
        """Fetch a single chunk with multiple retry strategies"""
        
        for attempt in range(max_retries):
            try:
                # Try progressively smaller chunks on retry
                actual_chunk_size = chunk_size // (attempt + 1) if attempt > 0 else chunk_size
                adjusted_start = end_date - timedelta(days=actual_chunk_size)
                
                df = self.api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=5,
                    to_date=end_date.strftime('%Y-%m-%d'),
                    from_date=adjusted_start.strftime('%Y-%m-%d')
                )
                
                if df is not None and not df.empty:
                    return df
                    
            except Exception as e:
                if attempt == max_retries - 1:
                    # Last attempt - try single day
                    try:
                        single_day = end_date - timedelta(days=1)
                        df = self.api.fetch_historical_data_v3(
                            symbol=symbol,
                            unit='minutes',
                            interval=5,
                            to_date=end_date.strftime('%Y-%m-%d'),
                            from_date=single_day.strftime('%Y-%m-%d')
                        )
                        if df is not None and not df.empty:
                            return df
                    except:
                        pass
                
                time.sleep(0.5)  # Brief pause between retries
        
        return None
    
    def _fill_gap_with_micro_chunks(self, symbol, gap_start, gap_end):
        """Try to fill gaps with very small 1-3 day chunks"""
        micro_chunks = []
        
        current = gap_start
        while current < gap_end:
            micro_end = min(current + timedelta(days=3), gap_end)
            
            try:
                df = self.api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=5,
                    to_date=micro_end.strftime('%Y-%m-%d'),
                    from_date=current.strftime('%Y-%m-%d')
                )
                
                if df is not None and not df.empty:
                    micro_chunks.append(df)
                    console.print(f"  ✅ Filled gap: {current.strftime('%m-%d')} to {micro_end.strftime('%m-%d')} ({len(df)} records)")
            
            except Exception:
                pass
            
            current = micro_end
            time.sleep(0.2)
        
        return micro_chunks
    
    def _try_alternative_ranges(self, symbol, target_days):
        """Try alternative date ranges that might have better data availability"""
        alt_chunks = []
        
        # Try going further back in time
        base_dates = [
            datetime.now() - timedelta(days=30),
            datetime.now() - timedelta(days=60),
            datetime.now() - timedelta(days=90),
        ]
        
        for base_date in base_dates:
            try:
                df = self.api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=5,
                    to_date=base_date.strftime('%Y-%m-%d'),
                    from_date=(base_date - timedelta(days=10)).strftime('%Y-%m-%d')
                )
                
                if df is not None and not df.empty:
                    alt_chunks.append(df)
                    console.print(f"  ✅ Alternative range: {len(df)} records from {base_date.strftime('%Y-%m-%d')}")
            
            except Exception:
                continue
            
            time.sleep(0.3)
        
        return alt_chunks
    
    def _concatenate_and_clean(self, data_chunks):
        """Concatenate all chunks and clean the data"""
        console.print(f"\n🔧 Concatenating {len(data_chunks)} data chunks...")
        
        # Combine all chunks
        combined_data = pd.concat(data_chunks, ignore_index=False)
        
        # Sort by time
        combined_data = combined_data.sort_index()
        
        # Remove duplicates (keep first occurrence)
        combined_data = combined_data[~combined_data.index.duplicated(keep='first')]
        
        # Basic data validation
        combined_data = combined_data.dropna()
        
        console.print(f"✅ Combined data: {len(combined_data)} records")
        console.print(f"📅 Date range: {combined_data.index[0]} to {combined_data.index[-1]}")
        
        return combined_data
    
    def _report_results(self, final_data, target_days):
        """Generate a comprehensive report of the fetching results"""
        
        actual_days = (final_data.index[-1] - final_data.index[0]).days
        success_rate = (len(self.successful_chunks) / (len(self.successful_chunks) + len(self.failed_ranges))) * 100
        
        console.print("\n📋 ROBUST FETCHER RESULTS:")
        console.print("=" * 60)
        console.print(f"🎯 Target days: {target_days}")
        console.print(f"📊 Records obtained: {len(final_data)}")
        console.print(f"📅 Actual span: {actual_days} days")
        console.print(f"📈 Success rate: {success_rate:.1f}%")
        console.print(f"✅ Successful chunks: {len(self.successful_chunks)}")
        console.print(f"❌ Failed ranges: {len(self.failed_ranges)}")
        
        if self.successful_chunks:
            console.print("\n🟢 Successful chunks:")
            for start, end, records in self.successful_chunks[-5:]:  # Show last 5
                console.print(f"   • {start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')}: {records} records")
        
        # Data quality metrics
        console.print(f"\n📊 Data Quality:")
        console.print(f"   • Records per day: {len(final_data) / max(actual_days, 1):.1f}")
        console.print(f"   • Expected 5-min records/day: ~78 (6.5h × 12)")
        console.print(f"   • Data completeness: {(len(final_data) / max(actual_days * 78, 1)) * 100:.1f}%")

def test_robust_fetcher():
    """Test the robust fetcher"""
    console.print("🧪 Testing Robust 5-Minute Data Fetcher")
    console.print("=" * 60)
    
    # Initialize API
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    # Create robust fetcher
    fetcher = Robust5MinFetcher(api)
    
    # Test with RELIANCE for 150 days
    data = fetcher.fetch_maximum_5min_data('RELIANCE', target_days=150)
    
    if data is not None:
        console.print("\n🎉 SUCCESS: Robust fetcher retrieved data!")
        
        # Save the data
        filename = f"robust_5min_RELIANCE_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        data.to_csv(filename)
        console.print(f"💾 Data saved to: {filename}")
        
        return data
    else:
        console.print("\n❌ FAILED: Could not retrieve any data")
        return None

if __name__ == "__main__":
    test_robust_fetcher()

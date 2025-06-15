#!/usr/bin/env python3
"""
Enhanced Data Cache System for Trading Strategies
Hierarchical structure: symbol -> timeframe -> date -> data
Future-proof for multiple strategies and backtesting scenarios
"""

import os
import pandas as pd
from datetime import datetime, timedelta
import json
import logging
from pathlib import Path
from typing import Optional, Dict, List, Tuple
import hashlib
from rich.console import Console

console = Console()

class EnhancedDataCache:
    """
    Enhanced data caching system with hierarchical structure:
    data_cache/
    ├── BTCUSDT/
    │   ├── 1m/
    │   │   ├── 2024-01-15_2024-01-16.csv
    │   │   ├── 2024-01-15_2024-01-16.json (metadata)
    │   │   └── ...
    │   ├── 5m/
    │   └── 1h/
    ├── ETHUSDT/
    └── ...
    """
    
    def __init__(self, base_cache_dir: str = 'data_cache'):
        """Initialize the enhanced data cache"""
        self.base_cache_dir = Path(base_cache_dir)
        self.base_cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Setup logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)
        
        console.print(f"[green]✓ Enhanced Data Cache initialized: {self.base_cache_dir}[/green]")
    
    def _get_cache_path(self, symbol: str, timeframe: str = '1m') -> Path:
        """Get the cache directory path for a symbol/timeframe combination"""
        return self.base_cache_dir / symbol.upper() / timeframe.lower()
    
    def _get_cache_key(self, start_date: datetime, end_date: datetime) -> str:
        """Generate a consistent cache key from date range"""
        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')
        return f"{start_str}_{end_str}"
    
    def _get_data_file(self, symbol: str, timeframe: str, start_date: datetime, end_date: datetime) -> Path:
        """Get the data file path"""
        cache_path = self._get_cache_path(symbol, timeframe)
        cache_key = self._get_cache_key(start_date, end_date)
        return cache_path / f"{cache_key}.csv"
    
    def _get_metadata_file(self, symbol: str, timeframe: str, start_date: datetime, end_date: datetime) -> Path:
        """Get the metadata file path"""
        cache_path = self._get_cache_path(symbol, timeframe)
        cache_key = self._get_cache_key(start_date, end_date)
        return cache_path / f"{cache_key}.json"
    
    def _create_metadata(self, symbol: str, timeframe: str, start_date: datetime, 
                        end_date: datetime, data_rows: int, data_hash: str) -> Dict:
        """Create metadata for cache entry"""
        return {
            'symbol': symbol.upper(),
            'timeframe': timeframe.lower(),
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'cached_at': datetime.now().isoformat(),
            'data_rows': data_rows,
            'data_hash': data_hash,
            'cache_version': '2.0',
            'columns': ['open', 'high', 'low', 'close', 'volume']
        }
    
    def _calculate_data_hash(self, df: pd.DataFrame) -> str:
        """Calculate hash of dataframe for integrity checking"""
        return hashlib.md5(pd.util.hash_pandas_object(df, index=True).values).hexdigest()
    
    def _is_cache_valid(self, metadata_file: Path, requested_end_date: datetime) -> bool:
        """Check if cached data is still valid for overlapping usage"""
        if not metadata_file.exists():
            return False
        
        try:
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            cached_end_date = datetime.fromisoformat(metadata['end_date'])
            cached_at = datetime.fromisoformat(metadata['cached_at'])
            
            # Normalize dates for comparison
            now = datetime.now()
            
            # Only invalidate if cached data includes today/future AND is stale
            # Historical data should never be invalidated
            if cached_end_date.date() >= now.date():
                # For current/future data, check if it's older than 1 hour
                if (now - cached_at).total_seconds() > 3600:
                    self.logger.debug("Cache invalid: recent data older than 1 hour")
                    return False
            
            # Historical data is always valid for overlapping usage
            self.logger.debug(f"Cache valid for overlapping use: {metadata_file.name}")
            return True
            
        except Exception as e:
            self.logger.warning(f"Error reading cache metadata: {str(e)}")
            return False
    
    def _find_overlapping_cache_files(self, symbol: str, timeframe: str, 
                                    start_date: datetime, end_date: datetime) -> List[Tuple[Path, Dict]]:
        """Find all cache files that overlap with the requested date range"""
        cache_path = self._get_cache_path(symbol, timeframe)
        
        if not cache_path.exists():
            return []
        
        overlapping_files = []
        
        # Get all metadata files
        for metadata_file in cache_path.glob("*.json"):
            try:
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)
                
                cached_start = datetime.fromisoformat(metadata['start_date'])
                cached_end = datetime.fromisoformat(metadata['end_date'])
                
                # Check if there's any overlap
                if (cached_start <= end_date and cached_end >= start_date):
                    # Check if the cache is still valid
                    if self._is_cache_valid(metadata_file, end_date):
                        overlapping_files.append((metadata_file, metadata))
                
            except Exception as e:
                self.logger.warning(f"Error reading metadata {metadata_file}: {str(e)}")
                continue
        
        return overlapping_files
    
    def _can_fulfill_from_cache(self, symbol: str, timeframe: str, 
                               start_date: datetime, end_date: datetime) -> Optional[pd.DataFrame]:
        """Check if we can fulfill the request from existing cache files"""
        
        overlapping_files = self._find_overlapping_cache_files(symbol, timeframe, start_date, end_date)
        
        if not overlapping_files:
            return None
        
        # Try to find files that cover our requested range
        for metadata_file, metadata in overlapping_files:
            cached_start = datetime.fromisoformat(metadata['start_date'])
            cached_end = datetime.fromisoformat(metadata['end_date'])
            
            # Check if this cache completely covers our requested range
            if cached_start <= start_date and cached_end >= end_date:
                # Perfect match - load and filter this data
                data_file = metadata_file.with_suffix('.csv')
                if data_file.exists():
                    try:
                        df = pd.read_csv(data_file, index_col=0, parse_dates=True)
                        
                        # Filter to requested date range
                        mask = (df.index >= start_date) & (df.index <= end_date)
                        filtered_df = df.loc[mask]
                        
                        if not filtered_df.empty:
                            console.print(f"[green]✓ Cache hit (filtered): {symbol} {timeframe} "
                                         f"({len(filtered_df):,} bars from {len(df):,} total)[/green]")
                            return filtered_df
                        
                    except Exception as e:
                        self.logger.error(f"Error loading cached data: {str(e)}")
                        continue
            
            # Check for partial overlap that covers significant portion
            elif cached_start <= start_date and cached_end > start_date:
                # We have partial data from the start - could be useful
                overlap_days = (cached_end - start_date).days
                total_requested_days = (end_date - start_date).days
                
                # If we have >50% of requested data, use it and log what's missing
                if overlap_days / total_requested_days > 0.5:
                    data_file = metadata_file.with_suffix('.csv')
                    if data_file.exists():
                        try:
                            df = pd.read_csv(data_file, index_col=0, parse_dates=True)
                            
                            # Filter to available overlap
                            mask = (df.index >= start_date) & (df.index <= cached_end)
                            filtered_df = df.loc[mask]
                            
                            if not filtered_df.empty:
                                missing_days = (end_date - cached_end).days
                                console.print(f"[yellow]⚠️  Partial cache hit: {symbol} {timeframe} "
                                             f"({len(filtered_df):,} bars, missing {missing_days} days)[/yellow]")
                                return filtered_df
                            
                        except Exception as e:
                            self.logger.error(f"Error loading cached data: {str(e)}")
                            continue
        
        return None

    def get_data(self, symbol: str, start_date: datetime, end_date: datetime, 
                 timeframe: str = '1m') -> Optional[pd.DataFrame]:
        """Get data from cache if available and valid"""
        
        # Normalize dates to day boundaries
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        
        # First try exact match
        data_file = self._get_data_file(symbol, timeframe, start_date, end_date)
        metadata_file = self._get_metadata_file(symbol, timeframe, start_date, end_date)
        
        if data_file.exists() and self._is_cache_valid(metadata_file, end_date):
            try:
                df = pd.read_csv(data_file, index_col=0, parse_dates=True)
                
                # Load and verify metadata
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)
                
                # Verify data integrity
                current_hash = self._calculate_data_hash(df)
                if current_hash == metadata.get('data_hash', ''):
                    console.print(f"[green]✓ Cache hit (exact): {symbol} {timeframe} ({len(df):,} bars)[/green]")
                    return df
                else:
                    self.logger.warning(f"Data integrity check failed for {symbol}")
                    
            except Exception as e:
                self.logger.error(f"Error loading cached data: {str(e)}")
        
        # Try to find overlapping cache files
        return self._can_fulfill_from_cache(symbol, timeframe, start_date, end_date)
    
    def save_data(self, symbol: str, df: pd.DataFrame, start_date: datetime, 
                  end_date: datetime, timeframe: str = '1m') -> bool:
        """Save data to cache with metadata"""
        
        if df is None or df.empty:
            self.logger.warning(f"Cannot cache empty data for {symbol}")
            return False
        
        try:
            # Normalize dates
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
            
            # Create directory structure
            cache_path = self._get_cache_path(symbol, timeframe)
            cache_path.mkdir(parents=True, exist_ok=True)
            
            # Get file paths
            data_file = self._get_data_file(symbol, timeframe, start_date, end_date)
            metadata_file = self._get_metadata_file(symbol, timeframe, start_date, end_date)
            
            # Calculate data hash
            data_hash = self._calculate_data_hash(df)
            
            # Save data
            df.to_csv(data_file)
            
            # Create and save metadata
            metadata = self._create_metadata(symbol, timeframe, start_date, end_date, len(df), data_hash)
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            console.print(f"[green]✓ Cached {symbol} {timeframe}: {len(df):,} bars[/green]")
            return True
            
        except Exception as e:
            self.logger.error(f"Error saving data to cache: {str(e)}")
            return False
    
    def get_cached_symbols(self) -> List[str]:
        """Get list of all cached symbols"""
        if not self.base_cache_dir.exists():
            return []
        
        symbols = []
        for symbol_dir in self.base_cache_dir.iterdir():
            if symbol_dir.is_dir():
                symbols.append(symbol_dir.name)
        
        return sorted(symbols)

    def get_cached_timeframes(self, symbol: str) -> List[str]:
        """Get list of all cached timeframes for a symbol"""
        symbol_path = self.base_cache_dir / symbol.upper()
        if not symbol_path.exists():
            return []
        
        timeframes = []
        for tf_dir in symbol_path.iterdir():
            if tf_dir.is_dir():
                timeframes.append(tf_dir.name)
        
        return sorted(timeframes)

    def get_cached_date_ranges(self, symbol: str, timeframe: str = '1m') -> List[Dict]:
        """Get list of all cached date ranges for a symbol/timeframe"""
        cache_path = self._get_cache_path(symbol, timeframe)
        if not cache_path.exists():
            return []
        
        date_ranges = []
        for metadata_file in cache_path.glob("*.json"):
            try:
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)
                
                date_ranges.append({
                    'start_date': metadata['start_date'],
                    'end_date': metadata['end_date'],
                    'cached_at': metadata['cached_at'],
                    'data_rows': metadata['data_rows'],
                    'file': metadata_file.stem
                })
                
            except Exception as e:
                self.logger.warning(f"Error reading metadata {metadata_file}: {str(e)}")
                continue
        
        # Sort by start date
        date_ranges.sort(key=lambda x: x['start_date'])
        return date_ranges

    def clear_expired(self, max_age_days: int = 7) -> int:
        """Clear expired cache files"""
        if not self.base_cache_dir.exists():
            return 0
        
        cutoff_date = datetime.now() - timedelta(days=max_age_days)
        deleted_count = 0
        
        for symbol_dir in self.base_cache_dir.iterdir():
            if not symbol_dir.is_dir():
                continue
                
            for tf_dir in symbol_dir.iterdir():
                if not tf_dir.is_dir():
                    continue
                
                for metadata_file in tf_dir.glob("*.json"):
                    try:
                        with open(metadata_file, 'r') as f:
                            metadata = json.load(f)
                        
                        cached_at = datetime.fromisoformat(metadata['cached_at'])
                        if cached_at < cutoff_date:
                            # Delete both metadata and data files
                            data_file = metadata_file.with_suffix('.csv')
                            
                            if metadata_file.exists():
                                metadata_file.unlink()
                            if data_file.exists():
                                data_file.unlink()
                            
                            deleted_count += 1
                            self.logger.info(f"Deleted expired cache: {metadata_file.name}")
                    
                    except Exception as e:
                        self.logger.warning(f"Error processing {metadata_file}: {str(e)}")
                        continue
        
        return deleted_count

    def get_cache_stats(self) -> Dict:
        """Get comprehensive cache statistics"""
        stats = {
            'total_symbols': 0,
            'total_files': 0,
            'total_size_mb': 0,
            'symbols': {},
            'timeframes': {},
            'date_coverage': {}
        }
        
        if not self.base_cache_dir.exists():
            return stats
        
        for symbol_dir in self.base_cache_dir.iterdir():
            if not symbol_dir.is_dir():
                continue
            
            symbol = symbol_dir.name
            stats['total_symbols'] += 1
            stats['symbols'][symbol] = {'timeframes': {}, 'total_files': 0, 'size_mb': 0}
            
            for tf_dir in symbol_dir.iterdir():
                if not tf_dir.is_dir():
                    continue
                
                timeframe = tf_dir.name
                if timeframe not in stats['timeframes']:
                    stats['timeframes'][timeframe] = 0
                
                file_count = 0
                tf_size = 0
                
                for file_path in tf_dir.glob("*.csv"):
                    file_count += 1
                    tf_size += file_path.stat().st_size
                
                stats['timeframes'][timeframe] += file_count
                stats['symbols'][symbol]['timeframes'][timeframe] = file_count
                stats['symbols'][symbol]['total_files'] += file_count
                stats['symbols'][symbol]['size_mb'] += tf_size / (1024 * 1024)
                
                stats['total_files'] += file_count
                stats['total_size_mb'] += tf_size / (1024 * 1024)
        
        return stats

    def print_cache_stats(self):
        """Print formatted cache statistics"""
        stats = self.get_cache_stats()
        
        console.print(f"\n[bold cyan]📊 Cache Statistics[/bold cyan]")
        console.print(f"Total symbols: {stats['total_symbols']}")
        console.print(f"Total files: {stats['total_files']}")
        console.print(f"Total size: {stats['total_size_mb']:.2f} MB")
        
        if stats['symbols']:
            console.print(f"\n[yellow]Symbols:[/yellow]")
            for symbol, data in stats['symbols'].items():
                console.print(f"  {symbol}: {data['total_files']} files, {data['size_mb']:.2f} MB")
        
        if stats['timeframes']:
            console.print(f"\n[yellow]Timeframes:[/yellow]")
            for tf, count in stats['timeframes'].items():
                console.print(f"  {tf}: {count} files")

    def get_cache_summary(self):
        """Print a summary of the cache for debugging"""
        console.print(f"[cyan]🔍 Cache Summary[/cyan]")
        stats = self.get_cache_stats()
        
        if stats['total_symbols'] == 0:
            console.print("[yellow]No cached data found[/yellow]")
            return
        
        for symbol in stats['symbols']:
            ranges = self.get_cached_date_ranges(symbol, '1m')
            if ranges:
                console.print(f"[green]{symbol}[/green]: {len(ranges)} cache files")
                for r in ranges:
                    console.print(f"  📅 {r['start_date']} to {r['end_date']} ({r['data_rows']:,} bars)")
            else:
                console.print(f"[yellow]{symbol}[/yellow]: No 1m data cached") 
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
        """Check if cached data is still valid"""
        if not metadata_file.exists():
            return False
        
        try:
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            cached_end_date = datetime.fromisoformat(metadata['end_date'])
            cached_at = datetime.fromisoformat(metadata['cached_at'])
            
            # Normalize all dates for comparison
            requested_end_date = requested_end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
            now = datetime.now()
            
            # If requesting data beyond what we have cached, invalid
            if requested_end_date > cached_end_date:
                self.logger.debug(f"Cache invalid: requested {requested_end_date} > cached {cached_end_date}")
                return False
            
            # If cached data is for today or future and is older than 1 hour, refresh
            if cached_end_date.date() >= now.date() and (now - cached_at).total_seconds() > 3600:
                self.logger.debug("Cache invalid: recent data older than 1 hour")
                return False
            
            self.logger.debug(f"Cache valid for {metadata_file.name}")
            return True
            
        except Exception as e:
            self.logger.warning(f"Error reading cache metadata: {str(e)}")
            return False
    
    def get_data(self, symbol: str, start_date: datetime, end_date: datetime, 
                 timeframe: str = '1m') -> Optional[pd.DataFrame]:
        """Get data from cache if available and valid"""
        
        # Normalize dates to day boundaries
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        
        data_file = self._get_data_file(symbol, timeframe, start_date, end_date)
        metadata_file = self._get_metadata_file(symbol, timeframe, start_date, end_date)
        
        if not data_file.exists() or not self._is_cache_valid(metadata_file, end_date):
            console.print(f"[yellow]⚠ No valid cache for {symbol} {timeframe} {start_date.date()} to {end_date.date()}[/yellow]")
            return None
        
        try:
            # Load data
            df = pd.read_csv(data_file, index_col=0, parse_dates=True)
            
            # Load and verify metadata
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            # Verify data integrity
            current_hash = self._calculate_data_hash(df)
            if current_hash != metadata.get('data_hash', ''):
                self.logger.warning(f"Data integrity check failed for {symbol}")
                return None
            
            console.print(f"[green]✓ Cache hit: {symbol} {timeframe} ({len(df):,} bars)[/green]")
            return df
            
        except Exception as e:
            self.logger.error(f"Error loading cached data: {str(e)}")
            return None
    
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
        for item in self.base_cache_dir.iterdir():
            if item.is_dir():
                symbols.append(item.name)
        
        return sorted(symbols)
    
    def get_cached_timeframes(self, symbol: str) -> List[str]:
        """Get list of cached timeframes for a symbol"""
        symbol_path = self.base_cache_dir / symbol.upper()
        if not symbol_path.exists():
            return []
        
        timeframes = []
        for item in symbol_path.iterdir():
            if item.is_dir():
                timeframes.append(item.name)
        
        return sorted(timeframes)
    
    def get_cached_date_ranges(self, symbol: str, timeframe: str = '1m') -> List[Dict]:
        """Get list of cached date ranges for a symbol/timeframe"""
        cache_path = self._get_cache_path(symbol, timeframe)
        if not cache_path.exists():
            return []
        
        ranges = []
        for item in cache_path.iterdir():
            if item.suffix == '.json':  # metadata files
                try:
                    with open(item, 'r') as f:
                        metadata = json.load(f)
                    
                    ranges.append({
                        'start_date': metadata['start_date'],
                        'end_date': metadata['end_date'],
                        'cached_at': metadata['cached_at'],
                        'rows': metadata['data_rows']
                    })
                except Exception as e:
                    self.logger.warning(f"Error reading metadata {item}: {str(e)}")
        
        return sorted(ranges, key=lambda x: x['start_date'])
    
    def clear_expired(self, max_age_days: int = 7) -> int:
        """Clear cache entries older than max_age_days"""
        if not self.base_cache_dir.exists():
            return 0
        
        cleared_count = 0
        cutoff_date = datetime.now() - timedelta(days=max_age_days)
        
        for symbol_dir in self.base_cache_dir.iterdir():
            if not symbol_dir.is_dir():
                continue
            
            for timeframe_dir in symbol_dir.iterdir():
                if not timeframe_dir.is_dir():
                    continue
                
                for metadata_file in timeframe_dir.glob('*.json'):
                    try:
                        with open(metadata_file, 'r') as f:
                            metadata = json.load(f)
                        
                        cached_at = datetime.fromisoformat(metadata['cached_at'])
                        if cached_at < cutoff_date:
                            # Remove both metadata and data files
                            data_file = metadata_file.with_suffix('.csv')
                            
                            metadata_file.unlink()
                            if data_file.exists():
                                data_file.unlink()
                            
                            cleared_count += 1
                            console.print(f"[yellow]Cleared expired cache: {metadata_file.name}[/yellow]")
                    
                    except Exception as e:
                        self.logger.warning(f"Error processing {metadata_file}: {str(e)}")
        
        console.print(f"[cyan]Cleared {cleared_count} expired cache entries[/cyan]")
        return cleared_count
    
    def get_cache_stats(self) -> Dict:
        """Get comprehensive cache statistics"""
        stats = {
            'total_symbols': 0,
            'total_files': 0,
            'total_size_mb': 0,
            'symbols': {}
        }
        
        if not self.base_cache_dir.exists():
            return stats
        
        for symbol_dir in self.base_cache_dir.iterdir():
            if not symbol_dir.is_dir():
                continue
            
            symbol = symbol_dir.name
            stats['total_symbols'] += 1
            stats['symbols'][symbol] = {
                'timeframes': {},
                'total_files': 0,
                'total_size_mb': 0
            }
            
            for timeframe_dir in symbol_dir.iterdir():
                if not timeframe_dir.is_dir():
                    continue
                
                timeframe = timeframe_dir.name
                timeframe_stats = {
                    'files': 0,
                    'size_mb': 0,
                    'date_ranges': []
                }
                
                for file in timeframe_dir.iterdir():
                    if file.is_file():
                        file_size = file.stat().st_size / (1024 * 1024)  # MB
                        timeframe_stats['files'] += 1
                        timeframe_stats['size_mb'] += file_size
                        stats['total_files'] += 1
                        stats['total_size_mb'] += file_size
                
                stats['symbols'][symbol]['timeframes'][timeframe] = timeframe_stats
                stats['symbols'][symbol]['total_files'] += timeframe_stats['files']
                stats['symbols'][symbol]['total_size_mb'] += timeframe_stats['size_mb']
        
        return stats
    
    def print_cache_stats(self):
        """Print formatted cache statistics"""
        stats = self.get_cache_stats()
        
        console.print("\n[bold cyan]📊 Enhanced Data Cache Statistics[/bold cyan]")
        console.print(f"Total Symbols: {stats['total_symbols']}")
        console.print(f"Total Files: {stats['total_files']}")
        console.print(f"Total Size: {stats['total_size_mb']:.2f} MB")
        
        if stats['symbols']:
            console.print("\n[yellow]Symbol Breakdown:[/yellow]")
            for symbol, symbol_stats in stats['symbols'].items():
                console.print(f"  {symbol}: {symbol_stats['total_files']} files, {symbol_stats['total_size_mb']:.2f} MB")
                for timeframe, tf_stats in symbol_stats['timeframes'].items():
                    console.print(f"    └─ {timeframe}: {tf_stats['files']} files, {tf_stats['size_mb']:.2f} MB") 
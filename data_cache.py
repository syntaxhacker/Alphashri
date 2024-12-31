import os
import json
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
import logging
import torch
from typing import Dict, Any, Optional, Tuple

class DataCache:
    """Cache for historical market data"""
    
    def __init__(self, cache_dir: str = "cache", expiry_days: int = 1):
        """Initialize the cache with directory and expiry time"""
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)
        self.expiry_days = expiry_days
        self.use_gpu = torch.backends.mps.is_available()
        
    def _get_cache_path(self, symbol: str) -> Tuple[Path, Path]:
        """Get paths for data and metadata files"""
        data_path = self.cache_dir / f"{symbol}_data.csv"
        meta_path = self.cache_dir / f"{symbol}_metadata.json"
        return data_path, meta_path
        
    def save_data(self, symbol: str, data: pd.DataFrame) -> None:
        """Save market data and metadata to cache"""
        data_path, meta_path = self._get_cache_path(symbol)
        
        # Save data as CSV
        data.to_csv(data_path)
        
        # Save metadata
        metadata = {
            'symbol': symbol,
            'cached_at': datetime.now().isoformat(),
            'rows': len(data),
            'start_date': data.index[0].isoformat(),
            'end_date': data.index[-1].isoformat()
        }
        
        with open(meta_path, 'w') as f:
            json.dump(metadata, f)
            
        logging.info(f"Cached {len(data)} rows of {symbol} data")
        
    def get_data(self, symbol: str, start_date: datetime, end_date: datetime) -> Optional[pd.DataFrame]:
        """Retrieve market data from cache if available and not expired"""
        data_path, meta_path = self._get_cache_path(symbol)
        
        if not data_path.exists() or not meta_path.exists():
            return None
            
        # Check metadata and expiry
        try:
            with open(meta_path, 'r') as f:
                metadata = json.load(f)
                
            cached_at = datetime.fromisoformat(metadata['cached_at'])
            if datetime.now() - cached_at > timedelta(days=self.expiry_days):
                logging.info(f"Cache expired for {symbol}")
                return None
                
            # Load data
            df = pd.read_csv(data_path)
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df.set_index('timestamp', inplace=True)
            
            # Filter data for requested date range
            df = df[(df.index >= start_date) & (df.index <= end_date)]
            
            if len(df) > 0:
                logging.info(f"Retrieved {len(df)} rows of {symbol} data from cache")
                return df
                
        except Exception as e:
            logging.error(f"Error reading cache: {str(e)}")
            return None
            
        return None
        
    def clear_cache(self) -> None:
        """Clear all cached data"""
        for file in self.cache_dir.glob("*"):
            file.unlink()
        logging.info("Cache cleared")
        
    def get_cache_info(self) -> Dict[str, Any]:
        """Get information about cached data"""
        cache_info = {
            'total_size': 0,
            'num_files': 0,
            'symbols': []
        }
        
        for file in self.cache_dir.glob("*"):
            cache_info['total_size'] += file.stat().st_size
            cache_info['num_files'] += 1
            
            if file.suffix == '.json':
                try:
                    with open(file, 'r') as f:
                        metadata = json.load(f)
                        cache_info['symbols'].append({
                            'symbol': metadata['symbol'],
                            'cached_at': metadata['cached_at'],
                            'rows': metadata['rows']
                        })
                except:
                    continue
                    
        return cache_info 
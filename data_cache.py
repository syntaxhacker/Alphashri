import os
import pandas as pd
from datetime import datetime, timedelta
import json
from typing import Optional, Dict, Any
import logging
from pathlib import Path

class DataCache:
    def __init__(self, cache_dir: str = "cache"):
        """Initialize the data cache with a specified directory"""
        self.cache_dir = cache_dir
        self._ensure_cache_dir()
        
    def _ensure_cache_dir(self):
        """Ensure cache directory exists"""
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)
        
    def _get_cache_path(self, symbol: str, interval: str) -> str:
        """Get the cache file path for a symbol and interval"""
        return os.path.join(self.cache_dir, f"{symbol}_{interval}_data.csv")
        
    def _get_metadata_path(self, symbol: str, interval: str) -> str:
        """Get the metadata file path for a symbol and interval"""
        return os.path.join(self.cache_dir, f"{symbol}_{interval}_metadata.json")
    
    def save_data(self, symbol: str, interval: str, data: pd.DataFrame, metadata: Dict[str, Any] = None):
        """Save data and metadata to cache"""
        try:
            # Save the DataFrame
            cache_path = self._get_cache_path(symbol, interval)
            data.to_csv(cache_path)
            
            # Save metadata
            if metadata is None:
                metadata = {}
            metadata.update({
                'last_updated': datetime.now().isoformat(),
                'rows': len(data),
                'columns': list(data.columns)
            })
            
            with open(self._get_metadata_path(symbol, interval), 'w') as f:
                json.dump(metadata, f)
                
            logging.info(f"Cached data for {symbol} ({interval}) successfully")
            
        except Exception as e:
            logging.error(f"Error saving cache for {symbol}: {str(e)}")
    
    def get_data(self, symbol: str, interval: str, max_age: timedelta = timedelta(hours=1)) -> Optional[pd.DataFrame]:
        """Retrieve data from cache if it exists and is not expired"""
        try:
            cache_path = self._get_cache_path(symbol, interval)
            metadata_path = self._get_metadata_path(symbol, interval)
            
            # Check if cache exists
            if not (os.path.exists(cache_path) and os.path.exists(metadata_path)):
                return None
            
            # Check cache age
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
            
            last_updated = datetime.fromisoformat(metadata['last_updated'])
            if datetime.now() - last_updated > max_age:
                return None
            
            # Load and return data
            df = pd.read_csv(cache_path)
            # Convert timestamp column back to datetime index
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df.set_index('timestamp', inplace=True)
            return df
            
        except Exception as e:
            logging.error(f"Error reading cache for {symbol}: {str(e)}")
            return None
    
    def clear_cache(self, symbol: Optional[str] = None, interval: Optional[str] = None):
        """Clear cache for specific symbol/interval or all cache"""
        try:
            if symbol and interval:
                # Clear specific cache
                cache_path = self._get_cache_path(symbol, interval)
                metadata_path = self._get_metadata_path(symbol, interval)
                
                if os.path.exists(cache_path):
                    os.remove(cache_path)
                if os.path.exists(metadata_path):
                    os.remove(metadata_path)
                    
            else:
                # Clear all cache
                for file in os.listdir(self.cache_dir):
                    os.remove(os.path.join(self.cache_dir, file))
                    
            logging.info(f"Cleared cache for {symbol if symbol else 'all symbols'}")
            
        except Exception as e:
            logging.error(f"Error clearing cache: {str(e)}")
    
    def get_cache_info(self) -> Dict[str, Any]:
        """Get information about cached data"""
        try:
            info = {
                'total_size': 0,
                'symbols': {},
                'last_updated': None
            }
            
            for file in os.listdir(self.cache_dir):
                if file.endswith('_metadata.json'):
                    symbol, interval = file.replace('_metadata.json', '').split('_')
                    
                    with open(os.path.join(self.cache_dir, file), 'r') as f:
                        metadata = json.load(f)
                    
                    info['symbols'][symbol] = {
                        'interval': interval,
                        'last_updated': metadata['last_updated'],
                        'rows': metadata['rows']
                    }
                    
                    # Update last updated time
                    last_updated = datetime.fromisoformat(metadata['last_updated'])
                    if not info['last_updated'] or last_updated > datetime.fromisoformat(info['last_updated']):
                        info['last_updated'] = metadata['last_updated']
                
                # Calculate total cache size
                file_path = os.path.join(self.cache_dir, file)
                info['total_size'] += os.path.getsize(file_path)
            
            return info
            
        except Exception as e:
            logging.error(f"Error getting cache info: {str(e)}")
            return {} 
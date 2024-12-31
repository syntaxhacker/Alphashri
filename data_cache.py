import os
import pandas as pd
from datetime import datetime, timedelta
import json
import logging

class DataCache:
    def __init__(self, cache_dir: str = 'cache'):
        """Initialize the data cache"""
        self.cache_dir = cache_dir
        if not os.path.exists(cache_dir):
            os.makedirs(cache_dir)

    def _get_cache_filename(self, symbol: str, start_date: datetime, end_date: datetime) -> str:
        """Generate a unique cache filename based on symbol and date range"""
        start_str = start_date.strftime('%Y%m%d')
        end_str = end_date.strftime('%Y%m%d')
        return os.path.join(self.cache_dir, f"{symbol}_{start_str}_{end_str}.csv")

    def _get_metadata_filename(self, symbol: str, start_date: datetime, end_date: datetime) -> str:
        """Generate metadata filename for cache entry"""
        start_str = start_date.strftime('%Y%m%d')
        end_str = end_date.strftime('%Y%m%d')
        return os.path.join(self.cache_dir, f"{symbol}_{start_str}_{end_str}_metadata.json")

    def _save_metadata(self, filename: str, rows: int):
        """Save metadata for cache entry"""
        metadata = {
            'created_at': datetime.now().isoformat(),
            'rows': rows
        }
        with open(filename, 'w') as f:
            json.dump(metadata, f)

    def _is_cache_valid(self, metadata_file: str) -> bool:
        """Check if cache entry is still valid (not older than 24 hours)"""
        if not os.path.exists(metadata_file):
            return False
            
        try:
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            created_at = datetime.fromisoformat(metadata['created_at'])
            return (datetime.now() - created_at) < timedelta(hours=24)
        except Exception as e:
            logging.warning(f"Error reading cache metadata: {str(e)}")
            return False

    def get_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """Get data from cache if available and valid"""
        cache_file = self._get_cache_filename(symbol, start_date, end_date)
        metadata_file = self._get_metadata_filename(symbol, start_date, end_date)
        
        if os.path.exists(cache_file) and self._is_cache_valid(metadata_file):
            try:
                df = pd.read_csv(cache_file)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df.set_index('timestamp', inplace=True)
                logging.info(f"Retrieved {len(df)} rows of {symbol} data from cache")
                return df
            except Exception as e:
                logging.error(f"Error reading cache file: {str(e)}")
                return None
        return None

    def save_data(self, symbol: str, df: pd.DataFrame):
        """Save data to cache with metadata"""
        if df is None or df.empty:
            return
            
        start_date = df.index.min()
        end_date = df.index.max()
        
        cache_file = self._get_cache_filename(symbol, start_date, end_date)
        metadata_file = self._get_metadata_filename(symbol, start_date, end_date)
        
        try:
            # Save the data
            df.to_csv(cache_file)
            # Save metadata
            self._save_metadata(metadata_file, len(df))
            logging.info(f"Cached {len(df)} rows of {symbol} data")
        except Exception as e:
            logging.error(f"Error saving to cache: {str(e)}")

    def clear(self):
        """Clear all cached data"""
        try:
            for file in os.listdir(self.cache_dir):
                file_path = os.path.join(self.cache_dir, file)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            logging.info("Cache cleared successfully")
        except Exception as e:
            logging.error(f"Error clearing cache: {str(e)}")

    def clear_expired(self):
        """Clear only expired cache entries"""
        try:
            for file in os.listdir(self.cache_dir):
                if file.endswith('_metadata.json'):
                    metadata_file = os.path.join(self.cache_dir, file)
                    if not self._is_cache_valid(metadata_file):
                        # Remove metadata file
                        os.remove(metadata_file)
                        # Remove corresponding data file
                        data_file = metadata_file.replace('_metadata.json', '.csv')
                        if os.path.exists(data_file):
                            os.remove(data_file)
            logging.info("Expired cache entries cleared")
        except Exception as e:
            logging.error(f"Error clearing expired cache: {str(e)}") 
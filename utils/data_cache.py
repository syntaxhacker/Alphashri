import os
import pandas as pd
from datetime import datetime, timedelta
import json
import logging

class DataCache:
    def __init__(self, cache_dir: str = 'cache/historical'):
        """Initialize the data cache"""
        self.cache_dir = cache_dir
        if not os.path.exists(cache_dir):
            os.makedirs(cache_dir)
            logging.info(f"Created cache directory: {cache_dir}")

    def _get_cache_filename(self, symbol: str, start_date: datetime, end_date: datetime) -> str:
        """Generate a unique cache filename based on symbol and date range"""
        # Normalize dates to start of day for consistent caching
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Format dates for filename
        start_str = start_date.strftime('%Y%m%d')
        end_str = end_date.strftime('%Y%m%d')
        
        filename = os.path.join(self.cache_dir, f"{symbol}_{start_str}_{end_str}.csv")
        logging.debug(f"Cache filename: {filename}")
        return filename

    def _get_metadata_filename(self, symbol: str, start_date: datetime, end_date: datetime) -> str:
        """Generate metadata filename for cache entry"""
        # Normalize dates to start of day for consistent caching
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Format dates for filename
        start_str = start_date.strftime('%Y%m%d')
        end_str = end_date.strftime('%Y%m%d')
        
        filename = os.path.join(self.cache_dir, f"{symbol}_{start_str}_{end_str}_metadata.json")
        logging.debug(f"Metadata filename: {filename}")
        return filename

    def _save_metadata(self, filename: str, rows: int, start_date: datetime, end_date: datetime):
        """Save metadata for cache entry"""
        metadata = {
            'created_at': datetime.now().isoformat(),
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'rows': rows,
            'version': '1.0'
        }
        with open(filename, 'w') as f:
            json.dump(metadata, f)
        logging.info(f"Saved metadata to {filename} with {rows} rows")

    def _is_cache_valid(self, metadata_file: str, current_end_date: datetime) -> bool:
        """
        Check if cache entry is still valid based on the end date of the data.
        Cache is invalid if:
        1. The current requested end date is beyond the cached end date
        2. The cached end date is in the future (meaning we need fresh data)
        3. The cached data is from a different day than requested
        """
        if not os.path.exists(metadata_file):
            logging.debug(f"Metadata file not found: {metadata_file}")
            return False
            
        try:
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            cached_end_date = datetime.fromisoformat(metadata['end_date'])
            current_end_date = current_end_date.replace(hour=0, minute=0, second=0, microsecond=0)
            cached_end_date = cached_end_date.replace(hour=0, minute=0, second=0, microsecond=0)
            
            # If cached end date is in the future, we need fresh data
            if cached_end_date > datetime.now():
                logging.debug(f"Cache invalid: end date {cached_end_date} is in future")
                return False
                
            # If current request needs data beyond what we have cached
            if current_end_date > cached_end_date:
                logging.debug(f"Cache invalid: requested end date {current_end_date} beyond cached end date {cached_end_date}")
                return False
                
            # If the dates don't match exactly (different day), invalidate cache
            if current_end_date.date() != cached_end_date.date():
                logging.debug(f"Cache invalid: requested date {current_end_date.date()} different from cached date {cached_end_date.date()}")
                return False
                
            logging.debug(f"Cache valid for {metadata_file}")
            return True
            
        except Exception as e:
            logging.warning(f"Error reading cache metadata {metadata_file}: {str(e)}")
            return False

    def get_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """Get data from cache if available and valid"""
        cache_file = self._get_cache_filename(symbol, start_date, end_date)
        metadata_file = self._get_metadata_filename(symbol, start_date, end_date)
        
        if os.path.exists(cache_file) and self._is_cache_valid(metadata_file, end_date):
            try:
                df = pd.read_csv(cache_file)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df.set_index('timestamp', inplace=True)
                logging.info(f"Successfully retrieved {len(df)} rows for {symbol} from cache: {cache_file}")
                return df
            except Exception as e:
                logging.error(f"Error reading cache file {cache_file}: {str(e)}")
                return None
        else:
            logging.info(f"No valid cache found for {symbol} from {start_date} to {end_date}")
        return None

    def save_data(self, symbol: str, df: pd.DataFrame, request_start_date: datetime, request_end_date: datetime):
        """Save data to cache with metadata"""
        if df is None or df.empty:
            logging.warning(f"Attempted to cache empty data for {symbol}")
            return
            
        # Use requested dates for cache filenames instead of data timestamps
        cache_file = self._get_cache_filename(symbol, request_start_date, request_end_date)
        metadata_file = self._get_metadata_filename(symbol, request_start_date, request_end_date)
        
        try:
            # Create cache directory if it doesn't exist
            os.makedirs(os.path.dirname(cache_file), exist_ok=True)
            
            # Save the data
            df.to_csv(cache_file)
            logging.info(f"Saved {len(df)} rows of {symbol} data to {cache_file}")
            
            # Save metadata with requested dates
            self._save_metadata(metadata_file, len(df), request_start_date, request_end_date)
            
            # Verify the save was successful
            if os.path.exists(cache_file) and os.path.exists(metadata_file):
                logging.info(f"Successfully cached {symbol} data from {request_start_date} to {request_end_date}")
            else:
                logging.error(f"Failed to verify cache files for {symbol}")
                
        except Exception as e:
            logging.error(f"Error saving {symbol} data to cache: {str(e)}")
            # Try to clean up any partial files
            for file in [cache_file, metadata_file]:
                if os.path.exists(file):
                    try:
                        os.remove(file)
                        logging.info(f"Cleaned up partial cache file: {file}")
                    except:
                        pass

    def clear_expired(self):
        """Clear cache entries that are no longer valid"""
        try:
            if not os.path.exists(self.cache_dir):
                logging.info("Cache directory does not exist, nothing to clear")
                return
                
            cleared_count = 0
            now = datetime.now()
            
            for file in os.listdir(self.cache_dir):
                if file.endswith('_metadata.json'):
                    metadata_file = os.path.join(self.cache_dir, file)
                    if not self._is_cache_valid(metadata_file, now):
                        # Remove metadata file
                        os.remove(metadata_file)
                        # Remove corresponding data file
                        data_file = metadata_file.replace('_metadata.json', '.csv')
                        if os.path.exists(data_file):
                            os.remove(data_file)
                        cleared_count += 1
                        logging.info(f"Cleared expired cache entry: {file}")
                        
            logging.info(f"Cleared {cleared_count} expired cache entries")
        except Exception as e:
            logging.error(f"Error clearing expired cache: {str(e)}") 
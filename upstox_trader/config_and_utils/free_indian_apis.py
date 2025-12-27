#!/usr/bin/env python3
"""
🇮🇳 Enhanced Upstox API Connector with Real-Time Streaming

A comprehensive Upstox API connector that combines:
- OAuth2 authentication with persistent tokens
- Historical data fetching (V2 & V3 APIs)
- Real-time WebSocket streaming for tick-by-tick data
- Seamless integration with old_tv_screen.py and other trading applications
"""

import pandas as pd
import requests
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Callable, Any
import json
import warnings
import os
from pathlib import Path
import urllib.parse
import gzip
from abc import ABC, abstractmethod
import threading
import asyncio

# Try to import Upstox SDK for WebSocket streaming (optional)
try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False

# WebSocket libraries
try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

try:
    import websocket
    WEBSOCKET_CLIENT_AVAILABLE = True
except ImportError:
    WEBSOCKET_CLIENT_AVAILABLE = False
    upstox_client = None

# Import symbol validator for proper symbol cleaning
try:
    from ..screeners.symbol_validator import get_valid_symbol
except ImportError:
    def get_valid_symbol(symbol):
        """Fallback symbol cleaning if validator not available"""
        if not symbol:
            return None
        # Remove exchange prefixes
        cleaned = symbol.upper()
        if ':' in cleaned:
            cleaned = cleaned.split(':', 1)[1]
        # Remove common suffixes
        suffixes_to_remove = ['.E1', '.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
        for suffix in suffixes_to_remove:
            if cleaned.endswith(suffix):
                cleaned = cleaned[:-len(suffix)]
                break
        return cleaned.strip()

# Import Upstox authentication module with flexible path handling
def _import_upstox_auth():
    """Import upstox_auth module with fallback strategies for different import contexts."""
    try:
        # Try relative import first (when imported as part of package)
        from .upstox_auth import create_upstox_auth
        return create_upstox_auth
    except ImportError:
        try:
            # Try absolute import (when run directly or from different context)
            from upstox_trader.config_and_utils.upstox_auth import create_upstox_auth
            return create_upstox_auth
        except ImportError:
            try:
                # Try importing from current directory (when run as standalone)
                import upstox_auth
                return upstox_auth.create_upstox_auth
            except ImportError:
                print("⚠️ upstox_auth module not found. Please ensure it's in the same directory.")
                return None

create_upstox_auth = _import_upstox_auth()

warnings.filterwarnings('ignore')

# --- Token Management ---

class TokenManager:
    """
    Unified token management for trading APIs.

    Handles token storage, expiration tracking, and validation
    for both Upstox and INDMONEY APIs.
    """

    def __init__(self, token_file: Path, expiry_hours: float, quiet: bool = False):
        """
        Initialize token manager.

        Args:
            token_file: Path to token cache file
            expiry_hours: Token validity period in hours
            quiet: Suppress console output
        """
        self.token_file = token_file
        self.expiry_hours = expiry_hours
        self.quiet = quiet
        self.token_timestamp = datetime.now()

        # Load existing token metadata if available
        self._load_token_metadata()

    def _load_token_metadata(self):
        """Load token timestamp from cache file."""
        if self.token_file.exists():
            try:
                with open(self.token_file, 'r') as f:
                    token_data = json.load(f)
                    self.token_timestamp = datetime.fromisoformat(
                        token_data.get('timestamp', datetime.now().isoformat())
                    )
            except Exception:
                pass  # Use default timestamp

    def _save_token_metadata(self, partial_token: str = None):
        """
        Save token metadata to cache file.

        Args:
            partial_token: Optional partial token (first 20 chars) for reference
        """
        try:
            with open(self.token_file, 'w') as f:
                json.dump({
                    'timestamp': self.token_timestamp.isoformat(),
                    'partial_token': partial_token or 'unknown',
                    'expiry_hours': self.expiry_hours
                }, f)
        except Exception:
            pass

    def is_token_expired(self) -> bool:
        """
        Check if token has expired.

        Returns:
            bool: True if token is expired
        """
        if self.token_timestamp is None:
            return False

        token_age = datetime.now() - self.token_timestamp
        return token_age.total_seconds() > (self.expiry_hours * 3600)

    def get_token_age_hours(self) -> float:
        """
        Get token age in hours.

        Returns:
            float: Token age in hours
        """
        if self.token_timestamp is None:
            return 0.0

        token_age = datetime.now() - self.token_timestamp
        return token_age.total_seconds() / 3600

    def check_token_validity(self, provider_name: str, token_url: str):
        """
        Check token validity and raise error if expired.

        Args:
            provider_name: Name of the provider (for error messages)
            token_url: URL to get new token (for error messages)

        Raises:
            ValueError: If token is expired
        """
        if self.is_token_expired():
            age = self.get_token_age_hours()
            self._log_error(f"❌ {provider_name} token expired ({age:.1f} hours old)")
            self._log_error(f"🔑 Get new token at: {token_url}")
            raise ValueError(
                f"{provider_name} access token has expired ({self.expiry_hours:.0f}-hour validity). "
                f"Please generate a new token from {token_url} "
                f"and update your config.py"
            )

        # Warn if token is close to expiration (>80% of validity)
        token_age = self.get_token_age_hours()
        warning_threshold = self.expiry_hours * 0.8

        if token_age > warning_threshold and not self.quiet:
            remaining = self.expiry_hours - token_age
            self._log(f"⚠️  {provider_name} token is {token_age:.1f}h old "
                     f"(expires in {remaining:.1f}h)")

    def refresh_token_timestamp(self, partial_token: str = None):
        """
        Update token timestamp (call when token is refreshed).

        Args:
            partial_token: Optional partial token for reference
        """
        self.token_timestamp = datetime.now()
        self._save_token_metadata(partial_token)

    def _log_error(self, message: str):
        """Log error message (always shown)."""
        print(message)

    def _log(self, message: str):
        """Log message if not in quiet mode."""
        if not self.quiet:
            print(message)


# --- Constants ---
API_VERSION = "2.0"  # Still used for authentication
BASE_URL_V2 = "https://api.upstox.com/v2"
BASE_URL_V3 = "https://api.upstox.com/v3"
ORDER_URL = "https://api.upstox.com/v2/order/place"
INSTRUMENT_LIST_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
INSTRUMENT_CACHE_FILE = Path(__file__).parent / "nse_instruments.json"


class BaseAPIClient(ABC):
    """
    Abstract base class for trading API clients.

    Provides common functionality for all API clients including:
    - Quiet mode for console output suppression
    - Common error handling patterns
    - Unified interface for easy provider switching
    """

    def __init__(self, quiet: bool = False):
        """
        Initialize the base API client.

        Args:
            quiet (bool): If True, suppresses console output. Default is False.
        """
        self.quiet = quiet
        self.instruments = None

    @abstractmethod
    def _get_headers(self) -> Dict[str, str]:
        """
        Construct headers for API calls.

        Returns:
            Dict[str, str]: Headers dictionary
        """
        pass

    @abstractmethod
    def get_instrument_key(self, symbol: str, **kwargs) -> Optional[str]:
        """
        Fetch the instrument key for a given symbol.

        Args:
            symbol: Stock symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            Instrument key or None if not found
        """
        pass

    # ==================== UNIFIED INTERFACE METHODS ====================
    # These methods provide a consistent API across all providers

    @abstractmethod
    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        """
        Get current/last traded price for a symbol.

        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS')
            **kwargs: Provider-specific parameters

        Returns:
            Current price as float or None if unavailable
        """
        pass

    @abstractmethod
    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        """
        Get full market quote for a symbol (OHLC, volume, etc.).

        Args:
            symbol: Stock symbol
            **kwargs: Provider-specific parameters

        Returns:
            Dictionary with quote data or None if unavailable
        """
        pass

    def get_historical_data(self, symbol: str, interval: str,
                           from_date: str, to_date: str, **kwargs) -> Optional[pd.DataFrame]:
        """
        Get historical OHLCV data for a symbol.

        Args:
            symbol: Stock symbol
            interval: Time interval (e.g., 'day', '1minute', '5minute')
            from_date: Start date (YYYY-MM-DD)
            to_date: End date (YYYY-MM-DD)
            **kwargs: Provider-specific parameters

        Returns:
            DataFrame with OHLCV data or None if unavailable
        """
        # Default implementation - subclasses should override
        raise NotImplementedError(f"{self.__class__.__name__} does not support historical data")

    # ==================== LOGGING HELPERS ====================

    def _log(self, message: str):
        """
        Log a message if quiet mode is disabled.

        Args:
            message: Message to log
        """
        if not self.quiet:
            print(message)

    def _log_error(self, message: str):
        """
        Log an error message (always shown regardless of quiet mode).

        Args:
            message: Error message to log
        """
        print(message)


class UpstoxAPI(BaseAPIClient):
    """
    Enhanced Upstox API client with real-time streaming capabilities.

    Features:
    - OAuth2 authentication with persistent tokens
    - Historical data fetching (V2 & V3 APIs)
    - Real-time WebSocket streaming for tick-by-tick data
    - Automatic instrument key management and caching
    - Seamless integration with old_tv_screen.py and other trading applications
    - Supports quiet mode to suppress console output when quiet=True
    """

    def __init__(self, api_key: str, api_secret: str, quiet: bool = False):
        """
        Initialize the Upstox API client.

        Args:
            api_key (str): Your Upstox API key
            api_secret (str): Your Upstox API secret
            quiet (bool): If True, suppresses console output. Default is False.
        """
        super().__init__(quiet=quiet)
        self.api_key = api_key
        self.api_secret = api_secret
        self.instruments = []

        self._log("🇮🇳 Upstox API Connector Initialized")
        self._log("="*40)

        # Initialize authentication handler
        if create_upstox_auth is None:
            raise ImportError("Authentication module not available")

        self.auth_handler = create_upstox_auth(api_key, api_secret, quiet)


    def _get_headers(self) -> Dict[str, str]:
        """Constructs the required headers for API calls."""
        return self.auth_handler.get_headers()

    def _download_and_cache_instruments(self):
        """Downloads, decompresses, and caches the NSE instruments list."""
        self._log(f"⬇️ Downloading instrument list from {INSTRUMENT_LIST_URL}...")
        try:
            response = requests.get(INSTRUMENT_LIST_URL, stream=True)
            response.raise_for_status()

            with gzip.open(response.raw, 'rt', encoding='utf-8') as gz_file:
                instrument_data = json.load(gz_file)

            with open(INSTRUMENT_CACHE_FILE, 'w') as f:
                json.dump(instrument_data, f)

            self.instruments = instrument_data
            self._log(f"✅ Instrument list downloaded and cached at {INSTRUMENT_CACHE_FILE}.")
        except requests.RequestException as e:
            self._log(f"❌ Failed to download instrument list: {e}")
        except (gzip.BadGzipFile, json.JSONDecodeError) as e:
            self._log(f"❌ Failed to process instrument list: {e}")

    def get_instrument_key(self, symbol: str, exchange: str = "NSE_EQ", instrument_type: str = 'EQ', expiry_date: Optional[str] = None, strike_price: Optional[float] = None, option_type: Optional[str] = None) -> Optional[str]:
        """Fetches the instrument key from a cached or newly downloaded instrument list."""
        # Clean symbol to remove exchange prefixes like BSE:, NSE: etc.
        clean_symbol = get_valid_symbol(symbol)
        if not clean_symbol:
            self._log(f"❌ Invalid symbol after cleaning: {symbol}")
            return None

        if not self.instruments:
            if INSTRUMENT_CACHE_FILE.exists():
                self._log("✅ Loading instruments from local cache...")
                with open(INSTRUMENT_CACHE_FILE, 'r') as f:
                    self.instruments = json.load(f)
            else:
                self._download_and_cache_instruments()

        if not self.instruments:
            self._log("❌ Instrument list is empty. Cannot find key.")
            return None

        for instrument in self.instruments:
            # Equity or Index
            if instrument_type in ['EQ', 'INDEX']:
                segment = 'NSE_INDEX' if instrument_type == 'INDEX' else exchange
                if (instrument.get('trading_symbol') == clean_symbol and
                    instrument.get('segment') == segment and
                    instrument.get('instrument_type') == instrument_type):
                    return instrument.get('instrument_key')
            # Options
            elif instrument_type in ['CE', 'PE']:
                if (instrument.get('name') == symbol and
                    instrument.get('instrument_type') == option_type and
                    instrument.get('strike_price') == strike_price and
                    datetime.fromtimestamp(instrument.get('expiry') / 1000).strftime('%Y-%m-%d') == expiry_date):
                    return instrument.get('instrument_key')

        self._log(f"❌ Instrument key for '{clean_symbol}' (original: '{symbol}') not found with the specified criteria.")
        return None

    # ==================== UNIFIED INTERFACE IMPLEMENTATION ====================

    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        """
        Get current price for a symbol (unified interface).

        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS')
            **kwargs: Additional parameters (instrument_type, exchange)

        Returns:
            Current price as float or None if unavailable
        """
        # Try to get from real-time streaming first if available
        price = self.get_realtime_price(symbol)
        if price is not None:
            return price

        # Fallback: fetch today's intraday data and get latest close
        instrument_type = kwargs.get('instrument_type', 'EQ')
        exchange = kwargs.get('exchange', 'NSE_EQ')

        df = self.fetch_intraday_data_v3(symbol, interval='1',
                                        instrument_type=instrument_type,
                                        exchange=exchange)
        if df is not None and not df.empty:
            return float(df['close'].iloc[-1])

        return None

    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        """
        Get full market quote for a symbol (unified interface).

        Args:
            symbol: Stock symbol
            **kwargs: Additional parameters (instrument_type, exchange)

        Returns:
            Dictionary with quote data or None if unavailable
        """
        instrument_type = kwargs.get('instrument_type', 'EQ')
        exchange = kwargs.get('exchange', 'NSE_EQ')

        df = self.fetch_intraday_data_v3(symbol, interval='1',
                                        instrument_type=instrument_type,
                                        exchange=exchange)

        if df is not None and not df.empty:
            latest = df.iloc[-1]
            return {
                'symbol': symbol,
                'price': float(latest['close']),
                'open': float(latest['open']),
                'high': float(latest['high']),
                'low': float(latest['low']),
                'volume': float(latest['volume']),
                'timestamp': latest.name.strftime('%Y-%m-%d %H:%M:%S') if hasattr(latest.name, 'strftime') else str(latest.name)
            }

        return None

    def get_historical_data(self, symbol: str, interval: str,
                           from_date: str, to_date: str, **kwargs) -> Optional[pd.DataFrame]:
        """
        Get historical OHLCV data (unified interface).

        Args:
            symbol: Stock symbol
            interval: Time interval ('day', '1minute', '5minute', '30minute', etc.)
            from_date: Start date (YYYY-MM-DD)
            to_date: End date (YYYY-MM-DD)
            **kwargs: Additional parameters (instrument_type, exchange, etc.)

        Returns:
            DataFrame with OHLCV data or None if unavailable
        """
        instrument_type = kwargs.get('instrument_type', 'EQ')
        exchange = kwargs.get('exchange', 'NSE_EQ')
        expiry_date = kwargs.get('expiry_date')
        strike_price = kwargs.get('strike_price')
        option_type = kwargs.get('option_type')

        # Use V2 API for historical data
        return self.fetch_historical_data(
            symbol=symbol,
            interval=interval,
            from_date=from_date,
            to_date=to_date,
            instrument_type=instrument_type,
            exchange=exchange,
            expiry_date=expiry_date,
            strike_price=strike_price,
            option_type=option_type
        )

    def fetch_intraday_data_v3(self, symbol: str, interval: str, instrument_type: str = 'EQ', exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches today's intraday OHLCV data using the Upstox V3 Intraday API.
        
        Args:
            symbol: Stock symbol (e.g., 'TATAMOTORS', 'RELIANCE')
            interval: Timeframe interval: 
                     - minutes: 1, 3, 5, 10, 15, 30, 60
            instrument_type: 'EQ', 'INDEX', 'CE', 'PE'
            exchange: Exchange segment (default: 'NSE_EQ')
            
        Returns:
            pandas.DataFrame with OHLCV data for today indexed by datetime
            
        Note:
            V3 Intraday API only returns data for the current trading session.
            No authentication (access token) is required for the V3 endpoint according to documentation,
            but headers are included here for consistency.
        """
        instrument_key = self.get_instrument_key(symbol, instrument_type=instrument_type, exchange=exchange)
        if not instrument_key:
            return None
            
        if not self.quiet:
            console_msg = f"📊 Fetching V3 intraday {interval} data for {symbol}..."
            # Check if rich console is available (via tv_technical_utils or direct import)
            try:
                from rich.console import Console
                Console().print(f"[dim]{console_msg}[/dim]")
            except:
                print(console_msg)

        # URL encode the instrument key to handle characters like |
        encoded_key = urllib.parse.quote(instrument_key, safe='')
        
        # Determine interval unit for V3 URL format if needed
        # V3 URL format: /historical-candle/intraday/{instrument_key}/{unit}/{interval}
        # In this implementation, we assume 'minutes' as the unit for the requested interval.
        url = f"{BASE_URL_V3}/historical-candle/intraday/{encoded_key}/minutes/{interval.replace('minute', '')}"
        
        headers = {
            'Accept': 'application/json',
            'Authorization': f"Bearer {self.auth_handler.access_token}" if self.auth_handler.access_token else ""
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            if data.get('status') == 'success' and 'data' in data and 'candles' in data['data']:
                candles = data['data']['candles']
                if not candles:
                    if not self.quiet:
                        print(f"⚠️ No intraday candles available for {symbol} today.")
                    return None
                    
                df = pd.DataFrame(candles, columns=['datetime', 'open', 'high', 'low', 'close', 'volume', 'oi'])
                df['datetime'] = pd.to_datetime(df['datetime'])
                df.set_index('datetime', inplace=True)
                df = df.astype({'open': 'float', 'high': 'float', 'low': 'float', 'close': 'float', 'volume': 'float'})
                
                # Sort by index to ensure chronological order
                df.sort_index(inplace=True)
                
                if not self.quiet:
                    print(f"✅ Successfully fetched {len(df)} V3 intraday records for {symbol}.")
                return df
            else:
                if not self.quiet:
                    print(f"❌ V3 Intraday API error for {symbol}: {data}")
                return None
        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ V3 Intraday request failed for {symbol}: {e}")
            return None
        except Exception as e:
            if not self.quiet:
                print(f"❌ Error processing V3 intraday data for {symbol}: {e}")
            return None


    def fetch_historical_data(self, symbol: str, interval: str, from_date: str, to_date: str, instrument_type: str = 'EQ', expiry_date: Optional[str] = None, strike_price: Optional[float] = None, option_type: Optional[str] = None, exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches historical OHLCV data for a given symbol using the V2 API.
        
        Note: The V2 API supports '1minute', '30minute', 'day', 'week', 'month'.
        For other intervals, consider using the V3 API or resampling the data.
        """
        # Authentication is guaranteed to be complete at script startup
        if not self.auth_handler.access_token:
            return None
        
        instrument_key = self.get_instrument_key(symbol, instrument_type=instrument_type, expiry_date=expiry_date, strike_price=strike_price, option_type=option_type, exchange=exchange)
        if not instrument_key:
            return None
            
        if not self.quiet:
            print(f"📊 Fetching {interval} historical data for {symbol}...")
        
        # Historical API endpoint - includes from_date in URL path
        url = f"{BASE_URL_V2}/historical-candle/{instrument_key}/{interval}/{to_date}/{from_date}"
        
        try:
            response = requests.get(url, headers=self._get_headers())
            response.raise_for_status()
            
            data = response.json().get('data', {}).get('candles', [])
            if not data:
                if not self.quiet:
                    print(f"⚠️ No data returned for {symbol} in the given date range.")
                return pd.DataFrame()
            
            df = pd.DataFrame(data, columns=['datetime', 'open', 'high', 'low', 'close', 'volume', 'oi'])
            df['datetime'] = pd.to_datetime(df['datetime'])
            df.set_index('datetime', inplace=True)
            
            if not self.quiet:
                print(f"✅ Successfully fetched {len(df)} records for {symbol}.")
            return df

        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ API Error fetching historical data for {symbol}: {e.response.text if e.response else e}")
            return None

  
    def fetch_historical_data_v3(self, symbol: str, unit: str, interval: int, to_date: str, from_date: Optional[str] = None, instrument_type: str = 'EQ', expiry_date: Optional[str] = None, strike_price: Optional[float] = None, option_type: Optional[str] = None, exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches historical OHLCV data using the V3 Historical Candle Data API with automatic chunking.
        
        Args:
            symbol: Stock symbol (e.g., 'TATAMOTORS', 'RELIANCE')
            unit: Time unit - 'minutes', 'hours', 'days', 'weeks', 'months'
            interval: Interval value:
                - minutes: 1-300 (1 month limit for 1-15min, 1 quarter for >15min)
                - hours: 1-5 (1 quarter limit)
                - days: 1 (1 decade limit)
                - weeks: 1 (no limit)
                - months: 1 (no limit)
            to_date: End date in 'YYYY-MM-DD' format
            from_date: Start date in 'YYYY-MM-DD' format (optional)
            instrument_type: 'EQ', 'INDEX', 'CE', 'PE'
            expiry_date: For options (YYYY-MM-DD format)
            strike_price: For options
            option_type: 'CE' or 'PE' for options
            exchange: Exchange segment (default: 'NSE_EQ')
            
        Returns:
            pandas.DataFrame with OHLCV data indexed by datetime
            
        Note:
            No authentication required for V3 API.
            Automatically handles chunking based on API limits.
            Historical data available from Jan 2022 for minutes/hours, Jan 2000 for days/weeks/months.
        """
        # V3 API doesn't require authentication, but we need instrument key
        instrument_key = self.get_instrument_key(symbol, instrument_type=instrument_type, expiry_date=expiry_date, strike_price=strike_price, option_type=option_type, exchange=exchange)
        if not instrument_key:
            return None
            
        # Validate unit and interval combinations
        valid_intervals = {
            'minutes': list(range(1, 301)),  # 1-300 minutes
            'hours': list(range(1, 6)),      # 1-5 hours
            'days': [1],                     # Only 1 day
            'weeks': [1],                    # Only 1 week
            'months': [1]                    # Only 1 month
        }
        
        if unit not in valid_intervals:
            if not self.quiet:
                print(f"❌ Invalid unit '{unit}'. Valid units: {list(valid_intervals.keys())}")
            return None
            
        if interval not in valid_intervals[unit]:
            if not self.quiet:
                print(f"❌ Invalid interval '{interval}' for unit '{unit}'. Valid intervals: {valid_intervals[unit]}")
            return None

        # Determine chunk size based on API limits
        if unit == 'minutes':
            if interval <= 15:
                chunk_days = 30  # 1 month limit for 1-15 minute intervals
            else:
                chunk_days = 90  # 1 quarter limit for >15 minute intervals
        elif unit == 'hours':
            chunk_days = 90  # 1 quarter limit
        elif unit == 'days':
            chunk_days = 3650  # 1 decade limit
        else:  # weeks, months
            chunk_days = None  # No limit
        
        # If no from_date or chunking not needed, make single API call
        if not from_date or not chunk_days:
            return self._fetch_single_chunk_v3(symbol, unit, interval, to_date, from_date, instrument_key)
        
        # Parse dates for chunking
        from datetime import datetime
        to_dt = datetime.strptime(to_date, '%Y-%m-%d')
        from_dt = datetime.strptime(from_date, '%Y-%m-%d')
        total_days = (to_dt - from_dt).days
        
        # If within limits, make single call
        if total_days <= chunk_days:
            return self._fetch_single_chunk_v3(symbol, unit, interval, to_date, from_date, instrument_key)
        
        # Chunking required
        if not self.quiet:
            print(f"📊 Fetching V3 historical data for {symbol} ({interval} {unit}) from {from_date} to {to_date}...")
            print(f"🔄 Large date range detected ({total_days} days). Using chunking with {chunk_days}-day chunks...")
        
        all_data = []
        current_to = to_dt
        
        while current_to > from_dt:
            current_from = max(current_to - timedelta(days=chunk_days), from_dt)
            
            chunk_from = current_from.strftime('%Y-%m-%d')
            chunk_to = current_to.strftime('%Y-%m-%d')
            
            if not self.quiet:
                print(f"  📥 Fetching chunk: {chunk_from} to {chunk_to}")
            
            chunk_df = self._fetch_single_chunk_v3(symbol, unit, interval, chunk_to, chunk_from, instrument_key)
            
            if chunk_df is not None and not chunk_df.empty:
                all_data.append(chunk_df)
            
            current_to = current_from - timedelta(days=1)
            time.sleep(0.5)  # Be nice to the API
        
        if not all_data:
            if not self.quiet:
                print(f"⚠️ No data retrieved for {symbol}")
            return pd.DataFrame()
        
        # Combine all chunks
        full_df = pd.concat(all_data).sort_index()
        full_df = full_df[~full_df.index.duplicated(keep='first')]
        
        if not self.quiet:
            print(f"✅ Successfully fetched {len(full_df)} historical records for {symbol} using V3 API (chunked).")
            print(f"📅 Data range: {full_df.index[0]} to {full_df.index[-1]}")
        return full_df

    def _fetch_single_chunk_v3(self, symbol: str, unit: str, interval: int, to_date: str, from_date: Optional[str], instrument_key: str) -> Optional[pd.DataFrame]:
        """Helper method to fetch a single chunk of V3 historical data."""
        # URL encode the instrument key to handle special characters like |
        encoded_instrument_key = urllib.parse.quote(instrument_key, safe='')
        
        # Build URL - from_date is optional
        if from_date:
            url = f"{BASE_URL_V3}/historical-candle/{encoded_instrument_key}/{unit}/{interval}/{to_date}/{from_date}"
        else:
            url = f"{BASE_URL_V3}/historical-candle/{encoded_instrument_key}/{unit}/{interval}/{to_date}"
        
        # V3 API doesn't require authorization - just Accept header
        headers = {
            'Accept': 'application/json'
        }
        
        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            
            json_data = response.json()
            
            if json_data.get('status') != 'success':
                if not self.quiet:
                    print(f"❌ API returned non-success status: {json_data}")
                return pd.DataFrame()
            
            candles = json_data.get('data', {}).get('candles', [])
            if not candles:
                return pd.DataFrame()
            
            # V3 API returns data as: [timestamp, open, high, low, close, volume, open_interest]
            df = pd.DataFrame(candles, columns=['datetime', 'open', 'high', 'low', 'close', 'volume', 'oi'])
            df['datetime'] = pd.to_datetime(df['datetime'])
            df.set_index('datetime', inplace=True)
            
            # Sort by datetime to ensure chronological order
            df.sort_index(inplace=True)
            
            return df

        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ V3 Historical API Error for {symbol}: {e.response.text if e.response else e}")
            return None

    def place_order(self, symbol: str, transaction_type: str, quantity: int, order_type: str = "MARKET", product: str = "D", price: float = 0, trigger_price: float = 0) -> Optional[Dict]:
        """
        Places an order using the Upstox API V3.
        """
        # Authentication is guaranteed to be complete at script startup
        if not self.auth_handler.access_token:
            return None

        instrument_key = self.get_instrument_key(symbol)
        if not instrument_key:
            return None

        headers = self._get_headers()
        headers['Content-Type'] = 'application/json'

        data = {
            "quantity": quantity,
            "product": product,
            "validity": "DAY",
            "price": price,
            "instrument_token": instrument_key,
            "order_type": order_type,
            "transaction_type": transaction_type,
            "disclosed_quantity": 0,
            "trigger_price": trigger_price,
            "is_amo": False
        }

        try:
            response = requests.post(ORDER_URL, headers=headers, json=data)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ API Error placing order for {symbol}: {e.response.text if e.response else e}")
            return None

    # ==================== REAL-TIME STREAMING METHODS ====================

    def setup_realtime_streaming(self, symbols: List[str], callback: Optional[Callable] = None) -> bool:
        """
        Setup real-time WebSocket streaming for tick-by-tick data.

        Args:
            symbols: List of stock symbols to stream
            callback: Optional callback function for processing tick data

        Returns:
            bool: True if streaming setup was successful
        """
        if not UPSTOX_SDK_AVAILABLE:
            if not self.quiet:
                print("❌ WebSocket streaming not available - install upstox-python-sdk")
            return False

        # Authentication is guaranteed to be complete at script startup
        # No additional validation needed for fast streaming setup
        
        # Check if market is open
        if not self._is_market_open():
            if not self.quiet:
                print("⚠️ Market is closed - WebSocket streaming may not work")
                print("💡 NSE trading hours: 9:15 AM - 3:30 PM IST")

        try:
            # Setup SDK configuration
            configuration = upstox_client.Configuration()
            configuration.access_token = self.auth_handler.access_token

            # Get instrument keys for symbols and create mapping
            instrument_keys_list = []
            if not hasattr(self, 'instrument_to_symbol_map'):
                self.instrument_to_symbol_map = {}
                
            for symbol in symbols:
                instrument_key = self.get_instrument_key(symbol)
                if instrument_key:
                    instrument_keys_list.append(instrument_key)
                    # Create mapping for reverse lookup
                    self.instrument_to_symbol_map[instrument_key] = symbol
                else:
                    if not self.quiet:
                        print(f"⚠️ Could not get instrument key for {symbol}")

            if not instrument_keys_list:
                if not self.quiet:
                    print("❌ No valid instrument keys found")
                return False

            # Initialize Market Data Streamer
            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"  # Last Traded Price mode for fastest updates
            )

            # Setup event handlers
            if callback:
                self.market_streamer.on("message", callback)
            else:
                self.market_streamer.on("message", self._default_tick_handler)

            self.market_streamer.on("open", self._on_websocket_open)
            self.market_streamer.on("error", self._on_websocket_error)
            self.market_streamer.on("close", self._on_websocket_close)

            if not self.quiet:
                print(f"✅ Real-time streaming setup complete for {len(instrument_keys_list)} symbols")
            return True

        except Exception as e:
            if not self.quiet:
                print(f"❌ WebSocket setup failed: {e}")
            return False

    def _refresh_and_retry_streaming(self, symbols: List[str], callback: Optional[Callable] = None) -> bool:
        """Token refresh is not needed - authentication is guaranteed at startup."""
        if not self.quiet:
            print("❌ Unexpected token validation failure - this should not happen")
        return False

    def _setup_streaming_with_validated_token(self, symbols: List[str], callback: Optional[Callable] = None) -> bool:
        """Setup streaming with a validated token."""
        try:
            # Get instrument keys for symbols
            instrument_keys_list = []
            for symbol in symbols:
                instrument_key = self.get_instrument_key(symbol)
                if instrument_key:
                    instrument_keys_list.append(instrument_key)
                else:
                    if not self.quiet:
                        print(f"⚠️ Could not get instrument key for {symbol}")

            if not instrument_keys_list:
                if not self.quiet:
                    print("❌ No valid instrument keys found")
                return False

            # Initialize Market Data Streamer
            api_client = upstox_client.ApiClient(self._get_sdk_configuration())
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"  # Last Traded Price mode for fastest updates
            )

            # Setup event handlers
            if callback:
                self.market_streamer.on("message", callback)
            else:
                self.market_streamer.on("message", self._default_tick_handler)

            self.market_streamer.on("open", self._on_websocket_open)
            self.market_streamer.on("error", self._on_websocket_error)
            self.market_streamer.on("close", self._on_websocket_close)

            if not self.quiet:
                print(f"✅ Real-time streaming setup complete for {len(instrument_keys_list)} symbols")
            return True

        except Exception as e:
            if not self.quiet:
                print(f"❌ Streaming setup with validated token failed: {e}")
            return False

    def _get_sdk_configuration(self):
        """Get SDK configuration with current access token."""
        configuration = upstox_client.Configuration()
        configuration.access_token = self.auth_handler.access_token
        return configuration

    def _default_tick_handler(self, message):
        """Default tick handler that stores latest prices with proper symbol mapping."""
        try:
            if isinstance(message, dict) and 'feeds' in message:
                feeds = message['feeds']

                # Initialize storage if needed
                if not hasattr(self, 'realtime_prices'):
                    self.realtime_prices = {}
                if not hasattr(self, 'instrument_to_symbol_map'):
                    self.instrument_to_symbol_map = {}

                for instrument_key, data in feeds.items():
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        price = float(data['ltpc']['ltp'])

                        # Store price by instrument key
                        self.realtime_prices[instrument_key] = price
                        
                        # Also try to map to symbol if we have the mapping
                        symbol = self.instrument_to_symbol_map.get(instrument_key)
                        if symbol:
                            self.realtime_prices[symbol] = price

        except Exception as e:
            if not self.quiet:
                print(f"❌ Error in tick handler: {e}")

    def _on_websocket_open(self):
        """Called when WebSocket connection opens."""
        if not self.quiet:
            print("🔗 Real-time WebSocket connection established!")

    def _on_websocket_error(self, error):
        """Called when WebSocket encounters an error."""
        if not self.quiet:
            print(f"❌ WebSocket error: {error}")

        # Authentication errors are not expected since auth is guaranteed at startup
        if hasattr(error, 'status_code') and error.status_code == 401:
            if not self.quiet:
                print("🔑 Unexpected authentication error - please restart script")
        elif "401" in str(error):
            if not self.quiet:
                print("🔑 Unexpected authentication error - please restart script")

    def _handle_websocket_token_refresh(self):
        """Handle token refresh when WebSocket authentication fails."""
        try:
            if not self.quiet:
                print("🔐 Re-authenticating with Upstox...")

            if self.auth_handler.handle_websocket_token_refresh():
                if not self.quiet:
                    print("✅ Re-authentication successful!")

                # Update the WebSocket configuration with new token
                if hasattr(self, 'market_streamer') and self.market_streamer:
                    # The streamer will need to be recreated with the new token
                    # This is handled by the calling code
                    pass
            else:
                if not self.quiet:
                    print("❌ Re-authentication failed")

        except Exception as e:
            if not self.quiet:
                print(f"❌ Token refresh failed: {e}")

    def _is_market_open(self) -> bool:
        """Check if Indian stock market is currently open."""
        from datetime import datetime, time

        now = datetime.now().time()
        market_open = time(9, 15)   # 9:15 AM
        market_close = time(15, 30) # 3:30 PM

        # Check if it's a weekday (Monday-Friday)
        current_weekday = datetime.now().weekday()
        if current_weekday >= 5:  # Saturday or Sunday
            return False

        return market_open <= now <= market_close

    def _on_websocket_close(self, close_status_code, close_msg):
        """Called when WebSocket connection closes."""
        if not self.quiet:
            print(f"🔌 WebSocket connection closed (Code: {close_status_code})")

    def start_realtime_streaming(self) -> bool:
        """Start the real-time streaming."""
        if not hasattr(self, 'market_streamer') or not self.market_streamer:
            if not self.quiet:
                print("❌ WebSocket not initialized. Call setup_realtime_streaming first.")
            return False

        try:
            self.market_streamer.connect()
            return True
        except Exception as e:
            if not self.quiet:
                print(f"❌ Failed to start streaming: {e}")
            return False

    def stop_realtime_streaming(self):
        """Stop the real-time streaming."""
        if hasattr(self, 'market_streamer') and self.market_streamer:
            try:
                self.market_streamer.disconnect()
                if not self.quiet:
                    print("🔌 Real-time streaming stopped")
            except Exception as e:
                if not self.quiet:
                    print(f"⚠️ Error stopping streaming: {e}")

    def get_realtime_price(self, symbol: str) -> Optional[float]:
        """Get the latest real-time price for a symbol."""
        if not hasattr(self, 'realtime_prices') or not self.realtime_prices:
            return None

        # Get instrument key for symbol
        instrument_key = self.get_instrument_key(symbol)
        if not instrument_key:
            return None

        return self.realtime_prices.get(instrument_key)

    def get_current_price_with_streaming(self, symbol: str, instrument_type: str = 'EQ', exchange: str = 'NSE_EQ') -> Optional[float]:
        """
        Get current price using real-time streaming. Sets up streaming if not already active.
        
        Args:
            symbol: Stock symbol (e.g., 'TATAMOTORS', 'RELIANCE')
            instrument_type: 'EQ', 'INDEX', 'CE', 'PE'
            exchange: Exchange segment (default: 'NSE_EQ')
            
        Returns:
            float: Current price or None if unavailable
        """
        # Authentication is guaranteed at script startup - no checks needed for fast processing
            
        # First check if we already have real-time price
        price = self.get_realtime_price(symbol)
        if price is not None:
            return price
            
        # Setup real-time streaming for this symbol if not already active
        if not self.is_streaming_active():
            if not self.quiet:
                print(f"🔗 Setting up real-time streaming for {symbol}...")
                
            # Setup streaming with default handler
            if self.setup_realtime_streaming([symbol]):
                # Start streaming
                if self.start_realtime_streaming():
                    # Wait a moment for data to arrive
                    import time
                    time.sleep(2)
                    
                    # Try to get the price again
                    price = self.get_realtime_price(symbol)
                    if price is not None:
                        return price
                        
        return None

    def get_batch_current_prices_with_streaming(self, symbols: List[str], instrument_type: str = 'EQ', exchange: str = 'NSE_EQ') -> Dict[str, float]:
        """
        Get current prices for multiple symbols using real-time streaming.
        Sets up streaming for all symbols at once if not already active.
        
        Args:
            symbols: List of stock symbols (e.g., ['TATAMOTORS', 'RELIANCE'])
            instrument_type: 'EQ', 'INDEX', 'CE', 'PE'
            exchange: Exchange segment (default: 'NSE_EQ')
            
        Returns:
            Dict[str, float]: Symbol to price mapping
        """
        results = {}
        
        # First check if we already have real-time prices for some symbols
        for symbol in symbols:
            price = self.get_realtime_price(symbol)
            if price is not None:
                results[symbol] = price
        
        # If we have prices for all symbols, return them
        if len(results) == len(symbols):
            return results
            
        # Find symbols that need streaming setup
        symbols_needing_streaming = [s for s in symbols if s not in results]
        
        # Setup real-time streaming for all needed symbols at once
        if not self.is_streaming_active() and symbols_needing_streaming:
            if not self.quiet:
                print(f"🔗 Setting up real-time streaming for {len(symbols_needing_streaming)} symbols...")
                
            # Setup streaming for all symbols at once
            if self.setup_realtime_streaming(symbols_needing_streaming):
                # Start streaming
                if self.start_realtime_streaming():
                    # Wait a moment for data to arrive
                    import time
                    time.sleep(3)
                    
                    # Try to get prices again
                    for symbol in symbols_needing_streaming:
                        price = self.get_realtime_price(symbol)
                        if price is not None:
                            results[symbol] = price
                            
        return results

    def is_streaming_active(self) -> bool:
        """Check if real-time streaming is active."""
        return (hasattr(self, 'market_streamer') and
                self.market_streamer and
                hasattr(self.market_streamer, 'connected') and
                self.market_streamer.connected)

    def retry_websocket_connection(self, symbols: List[str]) -> bool:
        """Retry WebSocket connection after token refresh."""
        try:
            # Stop existing streamer
            if hasattr(self, 'market_streamer') and self.market_streamer:
                try:
                    self.market_streamer.disconnect()
                except:
                    pass

            # Retry setup with fresh token (skip validation since we just refreshed)
            return self._setup_streaming_with_validated_token(symbols)

        except Exception as e:
            if not self.quiet:
                print(f"❌ WebSocket retry failed: {e}")
            return False

def main():
    """Example usage of the UpstoxAPI class."""
    # Import config for the example
    try:
        from upstox_trader.config import UPSTOX_CONFIG
    except ImportError:
        print("❌ config.py not found. Please create it with your Upstox API credentials.")
        return

    if not (UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret')):
        print("❌ Please set your UPSTOX_CONFIG in config.py")
        return

    # Example of using quiet mode - set quiet=True to suppress output
    # api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'], quiet=True)
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    if not api.auth_handler.access_token:
        print("\n🚀 Starting authentication process...")
        if not api.auth_handler.authenticate():
            print("\nAuthentication failed. Exiting.")
            return
    
    print("\n--- Example 1: Fetching Daily Data for TATAMOTORS ---")
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    
    tatamotors_df = api.fetch_historical_data(
        symbol="TATAMOTORS",
        interval="day",
        from_date=from_date,
        to_date=to_date
    )
    
    if tatamotors_df is not None and not tatamotors_df.empty:
        print("\n📈 TATAMOTORS Last 5 Days:")
        print(tatamotors_df.tail())
        print(f"\nAverage volume over 90 days: {tatamotors_df['volume'].mean():,.0f}")

    print("\n--- Example 2: Fetching Today's 1-Minute Intraday Data for RELIANCE ---")

    # Use V3 Intraday API for true today-only data
    reliance_df = api.fetch_intraday_data_v3(
        symbol="RELIANCE",
        interval='1'
    )

    if reliance_df is not None and not reliance_df.empty:
        print("\n📊 RELIANCE Today's Data:")
        print(f"Records: {len(reliance_df)}")
        print("Last 5 records:")
        print(reliance_df.tail())
    else:
        print("\n⚠️ No intraday data available for RELIANCE today.")

  
    print("\n--- Example 4: Enhanced Features Demo ---")

    # Test token validation
    print("🔑 Testing token validation...")
    is_token_valid = api.auth_handler.validate_token()
    print(f"   Token valid: {is_token_valid}")

    # Test market hours
    print("🕐 Checking market hours...")
    is_market_open = api._is_market_open()
    print(f"   Market open: {is_market_open}")

    # Demonstrate real-time streaming capability
    if UPSTOX_SDK_AVAILABLE:
        print("\n🔗 Setting up real-time streaming for RELIANCE and TCS...")

        def sample_tick_handler(message):
            """Sample tick handler for demonstration"""
            if isinstance(message, dict) and 'feeds' in message:
                for instrument_key, data in message['feeds'].items():
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        price = float(data['ltpc']['ltp'])
                        print(f"📈 Real-time tick: {instrument_key} -> ₹{price}")

        # Setup streaming with enhanced error handling
        streaming_success = api.setup_realtime_streaming(
            symbols=["RELIANCE", "TCS"],
            callback=sample_tick_handler
        )

        if streaming_success:
            print("✅ Real-time streaming setup successful!")
            print("🚀 Starting streaming for 10 seconds...")

            # Start streaming for demonstration
            api.start_realtime_streaming()

            # Let it run for 10 seconds
            import time
            time.sleep(10)

            # Stop streaming
            api.stop_realtime_streaming()
            print("⏹️ Real-time streaming stopped")

            # Show streaming status
            print(f"📊 Streaming active: {api.is_streaming_active()}")

        else:
            print("⚠️ Real-time streaming setup failed - check token and market hours")
            print("💡 Make sure your access token is valid and market is open")
    else:
        print("⚠️ Real-time streaming not available (install upstox-python-sdk)")
        print("💡 Run: pip install upstox-python-sdk")

if __name__ == "__main__":
    main()

class INDMONEYApi(BaseAPIClient):
    """
    API client for INDMoney (INDstocks) integration.

    Provides methods for user profile, funds, and market data.
    Tokens expire within 24 hours and must be regenerated manually.
    """

    BASE_URL = "https://api.indstocks.com"
    WS_BASE_URL = "wss://api.indstocks.com"
    INSTRUMENT_CACHE_FILE = Path(__file__).parent / "ind_instruments.json"
    TOKEN_FILE = Path(__file__).parent / "indmoney_token.json"
    TOKEN_URL = "https://www.indstocks.com/app/api-trading"
    TOKEN_EXPIRY_HOURS = 24

    def __init__(self, access_token: str, quiet: bool = False):
        """
        Initialize the INDMoney API client.

        Args:
            access_token (str): Your INDMoney access token
            quiet (bool): If True, suppresses console output.
        """
        super().__init__(quiet=quiet)
        self.access_token = access_token
        self.instruments_df = None

        # Initialize unified token manager
        self.token_manager = TokenManager(
            token_file=self.TOKEN_FILE,
            expiry_hours=self.TOKEN_EXPIRY_HOURS,
            quiet=quiet
        )

        # Save token metadata for new tokens
        self.token_manager._save_token_metadata(
            partial_token=access_token[:20] + '...' if access_token else None
        )

        # WebSocket connections
        self._ws_market_data = None
        self._ws_order_updates = None
        self._ws_portfolio = None
        self._ws_threads = {}

        # Callback handlers
        self._on_market_data = None
        self._on_order_update = None
        self._on_portfolio_update = None

        # Subscription tracking
        self._market_subscriptions = set()
        self._order_subscriptions = False
        self._portfolio_subscriptions = False

        self._log("💰 INDMoney API Connector Initialized")

    def _get_headers(self) -> Dict[str, str]:
        """Construct headers for API calls."""
        # Check token validity using unified token manager
        self.token_manager.check_token_validity(
            provider_name="INDMoney",
            token_url=self.TOKEN_URL
        )

        return {
            'Authorization': self.access_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

    def _download_and_cache_instruments(self):
        """Downloads and caches the INDMoney instruments list."""
        self._log(f"⬇️ Downloading INDMoney instrument list...")
        try:
            url = f"{self.BASE_URL}/market/instruments?source=equity"
            response = requests.get(url, headers=self._get_headers(), timeout=30)
            response.raise_for_status()

            with open(self.INSTRUMENT_CACHE_FILE, 'wb') as f:
                f.write(response.content)

            self.instruments_df = pd.read_csv(self.INSTRUMENT_CACHE_FILE)
            self._log(f"✅ INDMoney instrument list cached at {self.INSTRUMENT_CACHE_FILE}.")
        except Exception as e:
            self._log(f"❌ Failed to download INDMoney instruments: {e}")

    def get_instrument_key(self, symbol: str, exchange: str = "NSE") -> Optional[str]:
        """Finds the instrument key (SEGMENT_ID) for a given symbol."""
        if self.instruments_df is None:
            if self.INSTRUMENT_CACHE_FILE.exists():
                try:
                    self.instruments_df = pd.read_csv(self.INSTRUMENT_CACHE_FILE)
                except:
                    self._download_and_cache_instruments()
            else:
                self._download_and_cache_instruments()
        
        if self.instruments_df is None or self.instruments_df.empty:
            return None

        # Standardize exchange
        exch = "NSE" if "NSE" in exchange.upper() else "BSE"
        
        # Filter for matching symbol and exchange
        match = self.instruments_df[
            (self.instruments_df['TRADING_SYMBOL'] == symbol.upper()) & 
            (self.instruments_df['EXCH'] == exch)
        ]
        
        if not match.empty:
            security_id = match.iloc[0]['SECURITY_ID']
            return f"{exch}_{security_id}"

        return None

    # ==================== UNIFIED INTERFACE IMPLEMENTATION ====================

    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        """
        Get current price for a symbol (unified interface).

        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS')
            **kwargs: Additional parameters (exchange)

        Returns:
            Current price as float or None if unavailable
        """
        return self.fetch_ltp(symbol)

    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        """
        Get full market quote for a symbol (unified interface).

        Args:
            symbol: Stock symbol
            **kwargs: Additional parameters (exchange)

        Returns:
            Dictionary with quote data or None if unavailable
        """
        return self.fetch_full_quotes(symbol)

    def _handle_api_error(self, response, symbol: str = None):
        """
        Handle API errors, including token expiration.

        Args:
            response: Response object from requests
            symbol: Optional symbol for context
        """
        if response.status_code == 401:
            self._log_error("❌ INDMoney authentication failed (401)")
            self._log_error(f"🔑 Your token may have expired or is invalid")
            self._log_error(f"⏰ Token age: {self.token_manager.get_token_age_hours():.1f} hours (24h validity)")
            self._log_error(f"🔑 Get new token at: {self.TOKEN_URL}")
            raise ValueError(
                "INDMoney authentication failed. Your access token may be invalid or expired. "
                f"Please generate a new token from {self.TOKEN_URL} "
                "and update your config.py"
            )
        elif response.status_code == 403:
            self._log_error("❌ INDMoney access forbidden (403)")
            self._log_error("🌐 Your IP may not be whitelisted. Configure static IP in INDMoney settings.")
            raise ValueError(
                "INDMoney access forbidden. Please ensure your IP is whitelisted at "
                f"{self.TOKEN_URL} (click hexagon icon next to 'New Token')"
            )

    def fetch_user_profile(self) -> Optional[Dict]:
        """Fetch user profile details."""
        url = f"{self.BASE_URL}/user/profile"
        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            # Check for auth errors
            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            return response.json()
        except ValueError:
            raise  # Re-raise our custom errors
        except Exception as e:
            self._log(f"❌ INDMoney Profile Error: {e}")
            return None

    def fetch_funds(self) -> Optional[Dict]:
        """Fetch available and utilized funds."""
        url = f"{self.BASE_URL}/funds"
        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            # Check for auth errors
            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            return response.json()
        except ValueError:
            raise  # Re-raise our custom errors
        except Exception as e:
            self._log(f"❌ INDMoney Funds Error: {e}")
            return None

    def fetch_ltp(self, symbol: str) -> Optional[float]:
        """
        Fetch Last Traded Price (LTP) for a symbol.
        Automatically handles symbol to scrip-code mapping.
        """
        # 1. Try to get scrip code
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"⚠️ Could not find INDMoney scrip code for {symbol}")
            return None

        url = f"{self.BASE_URL}/market/quotes/ltp"
        params = {'scrip-codes': scrip_code}

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            # Check for auth errors
            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            data = response.json()

            # Structure: {"status":"success","data":{"NSE_2885":{"live_price":1575.4}}}
            if data.get('status') == 'success' and 'data' in data:
                token_data = data['data'].get(scrip_code)
                if token_data and 'live_price' in token_data:
                    return float(token_data['live_price'])
            return None
        except ValueError:
            raise  # Re-raise our custom errors
        except Exception as e:
            self._log(f"❌ INDMoney LTP Error for {symbol} ({scrip_code}): {e}")
            return None

    def fetch_full_quotes(self, symbols) -> Optional[Dict]:
        """
        Fetch full market quotes for symbol(s) (OHLC, Depth, Bid/Ask).
        Automatically handles symbol to scrip-code mapping.

        Args:
            symbols: Single symbol (str) or list of symbols

        Returns:
            Dict of quotes if single symbol, or dict of all quotes if list
        """
        # Handle both single symbol and list of symbols
        single_symbol = isinstance(symbols, str)
        if single_symbol:
            symbols = [symbols]

        # Convert all symbols to scrip codes
        scrip_codes = []
        for symbol in symbols:
            scrip_code = self.get_instrument_key(symbol)
            if scrip_code:
                scrip_codes.append(scrip_code)

        if not scrip_codes:
            return None

        url = f"{self.BASE_URL}/market/quotes/full"
        params = {'scrip-codes': ','.join(scrip_codes)}

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            # Check for auth errors
            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbols[0] if single_symbol else ','.join(symbols))

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                all_quotes = data['data']
                # Return single quote if single symbol requested
                if single_symbol and len(scrip_codes) == 1:
                    return all_quotes.get(scrip_codes[0])
                return all_quotes
            return None
        except ValueError:
            raise  # Re-raise our custom errors
        except Exception as e:
            self._log(f"❌ INDMoney Full Quote Error for {symbols}: {e}")
            return None

    # ==================== ORDER MANAGEMENT METHODS ====================

    def place_order(self, symbol: str, transaction_type: str, quantity: int,
                   order_type: str = "MARKET", price: float = 0,
                   product: str = "CNC", validity: str = "DAY",
                   exchange: str = "NSE", segment: str = "EQUITY") -> Optional[Dict]:
        """
        Place a new order with INDMoney.

        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS')
            transaction_type: 'BUY' or 'SELL'
            quantity: Number of shares
            order_type: 'MARKET' or 'LIMIT'
            price: Limit price (required for LIMIT orders, ignored for MARKET)
            product: 'CNC' (Delivery) or 'MIS' (Intraday)
            validity: 'DAY' or 'IOC' (Immediate or Cancel)
            exchange: 'NSE' or 'BSE'
            segment: 'EQUITY', 'DERIVATIVE', etc.

        Returns:
            Order confirmation dict with order_id

        Raises:
            ValueError: If token expired or authentication fails
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

        # Extract security ID from scrip_code (format: NSE_2885)
        security_id = scrip_code.split('_')[1] if '_' in scrip_code else scrip_code

        url = f"{self.BASE_URL}/order"

        data = {
            'txn_type': transaction_type.upper(),
            'exchange': exchange.upper(),
            'segment': segment.upper(),
            'security_id': security_id,
            'qty': quantity,
            'order_type': order_type.upper(),
            'limit_price': price if order_type.upper() == 'LIMIT' else 0,
            'validity': validity.upper(),
            'product': product.upper(),
            'is_amo': False
        }

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            # Check for auth errors
            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Order placed: {transaction_type} {quantity} {symbol} @ {order_type}")
            return result

        except ValueError:
            raise  # Re-raise our custom errors
        except Exception as e:
            self._log(f"❌ Order placement failed for {symbol}: {e}")
            return None

    def modify_order(self, order_id: str, new_price: float = None,
                     new_quantity: int = None) -> Optional[Dict]:
        """
        Modify a pending order.

        Args:
            order_id: Order ID to modify
            new_price: New limit price (optional)
            new_quantity: New quantity (optional)

        Returns:
            Modified order confirmation
        """
        url = f"{self.BASE_URL}/order/modify"

        data = {'order_id': order_id}
        if new_price is not None:
            data['limit_price'] = new_price
        if new_quantity is not None:
            data['qty'] = new_quantity

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Order modified: {order_id}")
            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Order modification failed: {e}")
            return None

    def cancel_order(self, order_id: str) -> Optional[Dict]:
        """
        Cancel a pending order.

        Args:
            order_id: Order ID to cancel

        Returns:
            Cancellation confirmation
        """
        url = f"{self.BASE_URL}/order/cancel"

        data = {'order_id': order_id}

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Order cancelled: {order_id}")
            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Order cancellation failed: {e}")
            return None

    def fetch_order_book(self, from_date: str = None, to_date: str = None) -> Optional[pd.DataFrame]:
        """
        Get order book (order history).

        Args:
            from_date: Start date (YYYY-MM-DD format)
            to_date: End date (YYYY-MM-DD format)

        Returns:
            DataFrame with order history
        """
        url = f"{self.BASE_URL}/order-book"

        params = {}
        if from_date:
            params['from_date'] = from_date
        if to_date:
            params['to_date'] = to_date

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                orders = data['data']
                if isinstance(orders, list) and len(orders) > 0:
                    df = pd.DataFrame(orders)
                    self._log(f"✅ Fetched {len(df)} order records")
                    return df

            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch order book: {e}")
            return pd.DataFrame()

    # ==================== PORTFOLIO MANAGEMENT METHODS ====================

    def fetch_holdings(self) -> Optional[pd.DataFrame]:
        """
        Get equity holdings in Demat account.

        Returns:
            DataFrame with holdings data including symbol, quantity, average price, etc.
        """
        url = f"{self.BASE_URL}/portfolio/holdings"

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                holdings = data['data']
                if isinstance(holdings, list) and len(holdings) > 0:
                    df = pd.DataFrame(holdings)
                    self._log(f"✅ Fetched {len(df)} holdings")
                    return df

            self._log("ℹ️  No holdings found")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch holdings: {e}")
            return pd.DataFrame()

    def fetch_positions(self) -> Optional[pd.DataFrame]:
        """
        Get open derivative positions.

        Returns:
            DataFrame with positions data
        """
        url = f"{self.BASE_URL}/portfolio/positions"

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                positions = data['data']
                if isinstance(positions, list) and len(positions) > 0:
                    df = pd.DataFrame(positions)
                    self._log(f"✅ Fetched {len(df)} positions")
                    return df

            self._log("ℹ️  No open positions found")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch positions: {e}")
            return pd.DataFrame()

    # ==================== MARKET DATA EXTENSIONS ====================

    def fetch_market_depth(self, symbol: str) -> Optional[Dict]:
        """
        Get market depth (order book) for a symbol.

        Args:
            symbol: Stock symbol

        Returns:
            Dictionary with bid/ask levels
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"⚠️ Could not find scrip code for {symbol}")
            return None

        url = f"{self.BASE_URL}/market/quotes/mkt"
        params = {'scrip-codes': scrip_code}

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                return data['data'].get(scrip_code)
            return None

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Market Depth Error for {symbol}: {e}")
            return None

    # ==================== TRADE CONFIRMATION METHODS ====================

    def fetch_trade_details(self, order_id: str) -> Optional[Dict]:
        """
        Get trade execution details for an order.

        Args:
            order_id: Order ID

        Returns:
            Trade details dict with execution information
        """
        url = f"{self.BASE_URL}/trades/{order_id}"

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            return response.json()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch trade details: {e}")
            return None

    def fetch_trade_book(self, segment: str = "NSE") -> Optional[pd.DataFrame]:
        """
        Get trade book for segment.

        Args:
            segment: 'NSE' or 'BSE'

        Returns:
            DataFrame with trade book data
        """
        url = f"{self.BASE_URL}/trade-book"

        params = {'segment': segment.upper()}

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                trades = data['data']
                if isinstance(trades, list) and len(trades) > 0:
                    df = pd.DataFrame(trades)
                    self._log(f"✅ Fetched {len(df)} trade records")
                    return df

            self._log("ℹ️  No trades found")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch trade book: {e}")
            return pd.DataFrame()

    # ==================== SMART ORDERS (GTT) METHODS ====================

    def place_smart_order(self, symbol: str, order_type: str, quantity: int,
                         trigger_price: float, price: float = 0,
                         exchange: str = "NSE", segment: str = "EQUITY",
                         validity: str = "DAY", product: str = "CNC") -> Optional[Dict]:
        """
        Place a GTT (Good Till Triggered) smart order.

        A GTT order allows you to set trigger conditions. When the trigger price
        is hit, a regular order is placed automatically.

        Args:
            symbol: Stock symbol
            order_type: 'BUY' or 'SELL'
            quantity: Number of shares
            trigger_price: Price at which order gets triggered
            price: Limit price (0 for MARKET after trigger)
            exchange: 'NSE' or 'BSE'
            segment: 'EQUITY', 'DERIVATIVE', etc.
            validity: 'DAY' or 'IOC'
            product: 'CNC' (Delivery) or 'MIS' (Intraday)

        Returns:
            Smart order confirmation dict with smart_order_id
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

        # Extract security ID from scrip_code (format: NSE_2885)
        security_id = scrip_code.split('_')[1] if '_' in scrip_code else scrip_code

        url = f"{self.BASE_URL}/smart/order"

        data = {
            'txn_type': order_type.upper(),
            'exchange': exchange.upper(),
            'segment': segment.upper(),
            'security_id': security_id,
            'qty': quantity,
            'trigger_price': trigger_price,
            'limit_price': price if price > 0 else 0,
            'validity': validity.upper(),
            'product': product.upper(),
            'is_amo': False
        }

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Smart order placed: {order_type} {quantity} {symbol} @ trigger {trigger_price}")
            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Smart order placement failed for {symbol}: {e}")
            return None

    def modify_smart_order(self, smart_order_id: str, new_trigger_price: float = None,
                          new_price: float = None, new_quantity: int = None) -> Optional[Dict]:
        """
        Modify a pending GTT (smart order).

        Args:
            smart_order_id: Smart order ID to modify
            new_trigger_price: New trigger price (optional)
            new_price: New limit price (optional)
            new_quantity: New quantity (optional)

        Returns:
            Modified smart order confirmation
        """
        url = f"{self.BASE_URL}/smart/order/modify"

        data = {'smart_order_id': smart_order_id}
        if new_trigger_price is not None:
            data['trigger_price'] = new_trigger_price
        if new_price is not None:
            data['limit_price'] = new_price
        if new_quantity is not None:
            data['qty'] = new_quantity

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Smart order modified: {smart_order_id}")
            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Smart order modification failed: {e}")
            return None

    def cancel_smart_order(self, smart_order_id: str) -> Optional[Dict]:
        """
        Cancel a pending GTT (smart order).

        Args:
            smart_order_id: Smart order ID to cancel

        Returns:
            Cancellation confirmation
        """
        url = f"{self.BASE_URL}/smart/order/cancel"

        data = {'smart_order_id': smart_order_id}

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Smart order cancelled: {smart_order_id}")
            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Smart order cancellation failed: {e}")
            return None

    # ==================== OPTIONS TRADING METHODS ====================

    def fetch_option_chain(self, symbol: str, expiry_date: str = None) -> Optional[pd.DataFrame]:
        """
        Get option chain for a symbol.

        Args:
            symbol: Stock symbol (e.g., 'NIFTY', 'BANKNIFTY')
            expiry_date: Expiry date (YYYY-MM-DD format), optional

        Returns:
            DataFrame with option chain data (calls and puts)
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

        url = f"{self.BASE_URL}/option-chain"

        params = {'scrip-code': scrip_code}
        if expiry_date:
            params['expiry_date'] = expiry_date

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                options = data['data']
                if isinstance(options, dict) and 'options' in options:
                    df = pd.DataFrame(options['options'])
                    self._log(f"✅ Fetched option chain for {symbol} ({len(df)} strikes)")
                    return df
                elif isinstance(options, list) and len(options) > 0:
                    df = pd.DataFrame(options)
                    self._log(f"✅ Fetched option chain for {symbol} ({len(df)} strikes)")
                    return df

            self._log(f"ℹ️  No option chain data found for {symbol}")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch option chain for {symbol}: {e}")
            return None

    def fetch_option_symbols(self) -> Optional[pd.DataFrame]:
        """
        Get list of symbols available for options trading along with expiry dates.

        Returns:
            DataFrame with option symbols and their expiry dates
        """
        url = f"{self.BASE_URL}/option-chain-symbols"

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                symbols = data['data']
                if isinstance(symbols, list) and len(symbols) > 0:
                    df = pd.DataFrame(symbols)
                    self._log(f"✅ Fetched {len(df)} option symbols")
                    return df

            self._log("ℹ️  No option symbols found")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch option symbols: {e}")
            return None

    def calculate_greeks(self, symbol: str, strike_price: float,
                        option_type: str, expiry_date: str,
                        spot_price: float = None, volatility: float = None,
                        interest_rate: float = None) -> Optional[Dict]:
        """
        Calculate option Greeks (Delta, Gamma, Theta, Vega, Rho).

        Args:
            symbol: Underlying symbol (e.g., 'NIFTY')
            strike_price: Strike price
            option_type: 'CE' (Call) or 'PE' (Put)
            expiry_date: Expiry date (YYYY-MM-DD)
            spot_price: Current spot price (optional, will fetch if not provided)
            volatility: Implied volatility (optional)
            interest_rate: Risk-free rate (optional)

        Returns:
            Dictionary with Greeks values
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

        # Extract security ID
        security_id = scrip_code.split('_')[1] if '_' in scrip_code else scrip_code

        url = f"{self.BASE_URL}/greeks"

        data = {
            'security_id': security_id,
            'strike_price': strike_price,
            'option_type': option_type.upper(),
            'expiry_date': expiry_date
        }

        # Optional parameters
        if spot_price is not None:
            data['spot_price'] = spot_price
        if volatility is not None:
            data['volatility'] = volatility
        if interest_rate is not None:
            data['interest_rate'] = interest_rate

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            result = response.json()

            if result.get('status') == 'success' and 'data' in result:
                self._log(f"✅ Greeks calculated for {symbol} {strike_price} {option_type}")
                return result['data']

            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Greeks calculation failed for {symbol}: {e}")
            return None

    def fetch_margin(self, symbol: str, transaction_type: str, quantity: int,
                    order_type: str = "MARKET", price: float = 0,
                    exchange: str = "NSE", segment: str = "EQUITY") -> Optional[Dict]:
        """
        Calculate margin requirements for an order before placing it.

        Args:
            symbol: Stock symbol
            transaction_type: 'BUY' or 'SELL'
            quantity: Number of shares
            order_type: 'MARKET' or 'LIMIT'
            price: Limit price (for LIMIT orders)
            exchange: 'NSE' or 'BSE'
            segment: 'EQUITY', 'DERIVATIVE', etc.

        Returns:
            Dictionary with margin details (required margin, available margin, etc.)
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

        # Extract security ID
        security_id = scrip_code.split('_')[1] if '_' in scrip_code else scrip_code

        url = f"{self.BASE_URL}/margin"

        data = {
            'txn_type': transaction_type.upper(),
            'exchange': exchange.upper(),
            'segment': segment.upper(),
            'security_id': security_id,
            'qty': quantity,
            'order_type': order_type.upper(),
            'limit_price': price if order_type.upper() == 'LIMIT' else 0
        }

        try:
            headers = self._get_headers()
            response = requests.post(url, headers=headers, json=data, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            result = response.json()

            if result.get('status') == 'success' and 'data' in result:
                self._log(f"✅ Margin calculated for {transaction_type} {quantity} {symbol}")
                return result['data']

            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Margin calculation failed for {symbol}: {e}")
            return None

    # ==================== WEBSOCKET STREAMING METHODS ====================

    def connect_market_data_websocket(self, on_message: Callable[[Dict], None],
                                     symbols: List[str] = None) -> bool:
        """
        Connect to market data WebSocket for real-time price updates.

        Args:
            on_message: Callback function to handle incoming market data
                       Function signature: on_message(data: Dict)
            symbols: List of symbols to subscribe (optional, can subscribe later)

        Returns:
            True if connection successful, False otherwise
        """
        if not WEBSOCKETS_AVAILABLE and not WEBSOCKET_CLIENT_AVAILABLE:
            self._log("❌ WebSocket library not available. Install: pip install websocket-client")
            return False

        self._on_market_data = on_message

        try:
            # Use websocket-client library (synchronous)
            if WEBSOCKET_CLIENT_AVAILABLE:
                ws_url = f"{self.WS_BASE_URL}/market-data"
                self._ws_market_data = websocket.WebSocketApp(
                    ws_url,
                    on_open=self._on_market_ws_open,
                    on_message=self._on_market_ws_message,
                    on_error=self._on_market_ws_error,
                    on_close=self._on_market_ws_close
                )

                # Run WebSocket in background thread
                ws_thread = threading.Thread(
                    target=self._ws_market_data.run_forever,
                    daemon=True
                )
                ws_thread.start()
                self._ws_threads['market_data'] = ws_thread

                self._log("✅ Market data WebSocket connecting...")
                return True

            return False

        except Exception as e:
            self._log(f"❌ Failed to connect market data WebSocket: {e}")
            return False

    def _on_market_ws_open(self, ws):
        """Market data WebSocket connection opened."""
        self._log("✅ Market data WebSocket connected")

        # Subscribe to initial symbols if provided
        if self._market_subscriptions:
            self.subscribe_market_data(list(self._market_subscriptions))

    def _on_market_ws_message(self, ws, message):
        """Handle incoming market data WebSocket message."""
        try:
            data = json.loads(message)

            # Call user callback if registered
            if self._on_market_data:
                self._on_market_data(data)

        except Exception as e:
            self._log(f"❌ Error parsing market data message: {e}")

    def _on_market_ws_error(self, ws, error):
        """Market data WebSocket error."""
        self._log(f"❌ Market data WebSocket error: {error}")

    def _on_market_ws_close(self, ws, close_status_code, close_msg):
        """Market data WebSocket connection closed."""
        self._log("ℹ️  Market data WebSocket connection closed")

    def subscribe_market_data(self, symbols: List[str]) -> bool:
        """
        Subscribe to real-time market data for symbols.

        Args:
            symbols: List of stock symbols to subscribe

        Returns:
            True if subscription successful
        """
        if not self._ws_market_data:
            self._log("❌ Market data WebSocket not connected. Call connect_market_data_websocket() first")
            return False

        try:
            # Track subscriptions
            self._market_subscriptions.update(symbols)

            # Send subscription message
            subscription_data = {
                "action": "subscribe",
                "symbols": symbols,
                "token": self.access_token
            }

            self._ws_market_data.send(json.dumps(subscription_data))
            self._log(f"✅ Subscribed to market data: {', '.join(symbols)}")
            return True

        except Exception as e:
            self._log(f"❌ Failed to subscribe to market data: {e}")
            return False

    def unsubscribe_market_data(self, symbols: List[str]) -> bool:
        """
        Unsubscribe from real-time market data.

        Args:
            symbols: List of stock symbols to unsubscribe

        Returns:
            True if unsubscription successful
        """
        if not self._ws_market_data:
            return False

        try:
            # Remove from tracking
            self._market_subscriptions.difference_update(symbols)

            # Send unsubscription message
            subscription_data = {
                "action": "unsubscribe",
                "symbols": symbols
            }

            self._ws_market_data.send(json.dumps(subscription_data))
            self._log(f"✅ Unsubscribed from market data: {', '.join(symbols)}")
            return True

        except Exception as e:
            self._log(f"❌ Failed to unsubscribe from market data: {e}")
            return False

    def disconnect_market_data_websocket(self):
        """Disconnect market data WebSocket."""
        if self._ws_market_data:
            self._ws_market_data.close()
            self._ws_market_data = None
            self._market_subscriptions.clear()
            self._log("✅ Market data WebSocket disconnected")

    def connect_order_updates_websocket(self, on_message: Callable[[Dict], None]) -> bool:
        """
        Connect to order updates WebSocket for real-time order status.

        Args:
            on_message: Callback function to handle order update messages
                       Function signature: on_message(data: Dict)

        Returns:
            True if connection successful, False otherwise
        """
        if not WEBSOCKETS_AVAILABLE and not WEBSOCKET_CLIENT_AVAILABLE:
            self._log("❌ WebSocket library not available. Install: pip install websocket-client")
            return False

        self._on_order_update = on_message
        self._order_subscriptions = True

        try:
            if WEBSOCKET_CLIENT_AVAILABLE:
                ws_url = f"{self.WS_BASE_URL}/order-updates"
                self._ws_order_updates = websocket.WebSocketApp(
                    ws_url,
                    header={"Authorization": self.access_token},
                    on_open=lambda ws: self._log("✅ Order updates WebSocket connected"),
                    on_message=self._on_order_ws_message,
                    on_error=lambda ws, err: self._log(f"❌ Order updates WebSocket error: {err}"),
                    on_close=lambda ws, *args: self._log("ℹ️  Order updates WebSocket closed")
                )

                # Run in background thread
                ws_thread = threading.Thread(
                    target=self._ws_order_updates.run_forever,
                    daemon=True
                )
                ws_thread.start()
                self._ws_threads['order_updates'] = ws_thread

                self._log("✅ Order updates WebSocket connecting...")
                return True

            return False

        except Exception as e:
            self._log(f"❌ Failed to connect order updates WebSocket: {e}")
            return False

    def _on_order_ws_message(self, ws, message):
        """Handle incoming order update message."""
        try:
            data = json.loads(message)

            if self._on_order_update:
                self._on_order_update(data)

        except Exception as e:
            self._log(f"❌ Error parsing order update message: {e}")

    def disconnect_order_updates_websocket(self):
        """Disconnect order updates WebSocket."""
        if self._ws_order_updates:
            self._ws_order_updates.close()
            self._ws_order_updates = None
            self._order_subscriptions = False
            self._log("✅ Order updates WebSocket disconnected")

    def connect_portfolio_websocket(self, on_message: Callable[[Dict], None]) -> bool:
        """
        Connect to portfolio WebSocket for real-time position/holding updates.

        Args:
            on_message: Callback function to handle portfolio update messages
                       Function signature: on_message(data: Dict)

        Returns:
            True if connection successful, False otherwise
        """
        if not WEBSOCKETS_AVAILABLE and not WEBSOCKET_CLIENT_AVAILABLE:
            self._log("❌ WebSocket library not available. Install: pip install websocket-client")
            return False

        self._on_portfolio_update = on_message
        self._portfolio_subscriptions = True

        try:
            if WEBSOCKET_CLIENT_AVAILABLE:
                ws_url = f"{self.WS_BASE_URL}/portfolio-updates"
                self._ws_portfolio = websocket.WebSocketApp(
                    ws_url,
                    header={"Authorization": self.access_token},
                    on_open=lambda ws: self._log("✅ Portfolio WebSocket connected"),
                    on_message=self._on_portfolio_ws_message,
                    on_error=lambda ws, err: self._log(f"❌ Portfolio WebSocket error: {err}"),
                    on_close=lambda ws, *args: self._log("ℹ️  Portfolio WebSocket closed")
                )

                # Run in background thread
                ws_thread = threading.Thread(
                    target=self._ws_portfolio.run_forever,
                    daemon=True
                )
                ws_thread.start()
                self._ws_threads['portfolio'] = ws_thread

                self._log("✅ Portfolio WebSocket connecting...")
                return True

            return False

        except Exception as e:
            self._log(f"❌ Failed to connect portfolio WebSocket: {e}")
            return False

    def _on_portfolio_ws_message(self, ws, message):
        """Handle incoming portfolio update message."""
        try:
            data = json.loads(message)

            if self._on_portfolio_update:
                self._on_portfolio_update(data)

        except Exception as e:
            self._log(f"❌ Error parsing portfolio update message: {e}")

    def disconnect_portfolio_websocket(self):
        """Disconnect portfolio WebSocket."""
        if self._ws_portfolio:
            self._ws_portfolio.close()
            self._ws_portfolio = None
            self._portfolio_subscriptions = False
            self._log("✅ Portfolio WebSocket disconnected")

    def disconnect_all_websockets(self):
        """Disconnect all active WebSocket connections."""
        self.disconnect_market_data_websocket()
        self.disconnect_order_updates_websocket()
        self.disconnect_portfolio_websocket()
        self._log("✅ All WebSocket connections disconnected")


class TradingAPIFactory:
    """
    Factory class for creating trading API client instances.

    Implements the Factory Pattern to provide a unified interface for creating
    different API client instances (Upstox, INDMoney, etc.) based on configuration.

    Usage:
        # Create Upstox API client
        upstox_api = TradingAPIFactory.create_client('upstox',
            api_key='your_key', api_secret='your_secret')

        # Create INDMoney API client
        indmoney_api = TradingAPIFactory.create_client('indmoney',
            access_token='your_token')

        # Create with quiet mode
        api = TradingAPIFactory.create_client('upstox',
            api_key='key', api_secret='secret', quiet=True)
    """

    SUPPORTED_PROVIDERS = ['upstox', 'indmoney']

    @classmethod
    def create_client(cls, provider: str, **kwargs) -> BaseAPIClient:
        """
        Create an API client instance for the specified provider.

        Args:
            provider (str): The API provider name ('upstox' or 'indmoney')
            **kwargs: Provider-specific credentials:
                - For 'upstox': api_key (str), api_secret (str), quiet (bool, optional)
                - For 'indmoney': access_token (str), quiet (bool, optional)

        Returns:
            BaseAPIClient: An instance of the appropriate API client

        Raises:
            ValueError: If provider is not supported or required credentials are missing

        Examples:
            >>> # Upstox client
            >>> upstox = TradingAPIFactory.create_client('upstox',
            ...     api_key='key', api_secret='secret')
            >>> # INDMoney client
            >>> indmoney = TradingAPIFactory.create_client('indmoney',
            ...     access_token='token')
        """
        provider_lower = provider.lower()

        if provider_lower not in cls.SUPPORTED_PROVIDERS:
            raise ValueError(
                f"Unsupported provider '{provider}'. "
                f"Supported providers: {', '.join(cls.SUPPORTED_PROVIDERS)}"
            )

        # Extract common parameters
        quiet = kwargs.get('quiet', False)

        # Create Upstox client
        if provider_lower == 'upstox':
            api_key = kwargs.get('api_key')
            api_secret = kwargs.get('api_secret')

            if not api_key or not api_secret:
                raise ValueError(
                    "Upstox client requires 'api_key' and 'api_secret' parameters"
                )

            return UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=quiet)

        # Create INDMoney client
        elif provider_lower == 'indmoney':
            access_token = kwargs.get('access_token')

            if not access_token:
                raise ValueError(
                    "INDMoney client requires 'access_token' parameter"
                )

            return INDMONEYApi(access_token=access_token, quiet=quiet)

    @classmethod
    def create_from_config(cls, provider: str, quiet: bool = False) -> BaseAPIClient:
        """
        Create an API client using credentials from the global config.

        This is a convenience method that reads credentials from UPSTOX_CONFIG
        and INDMONEY_CONFIG defined in config.py.

        Args:
            provider (str): The API provider name ('upstox' or 'indmoney')
            quiet (bool): If True, suppresses console output. Default is False.

        Returns:
            BaseAPIClient: An instance of the appropriate API client

        Raises:
            ValueError: If provider is not supported or config is missing

        Examples:
            >>> # Load from config.py
            >>> upstox = TradingAPIFactory.create_from_config('upstox')
            >>> indmoney = TradingAPIFactory.create_from_config('indmoney', quiet=True)
        """
        # Import config here to avoid module-level import issues
        try:
            from upstox_trader.config import UPSTOX_CONFIG, INDMONEY_CONFIG
        except ImportError:
            raise ValueError(
                "config.py not found in upstox_trader module. "
                "Please create it with your API credentials."
            )

        provider_lower = provider.lower()

        if provider_lower == 'upstox':
            if not UPSTOX_CONFIG.get('api_key') or not UPSTOX_CONFIG.get('api_secret'):
                raise ValueError(
                    "UPSTOX_CONFIG not properly configured. "
                    "Please set 'api_key' and 'api_secret' in config.py"
                )

            return UpstoxAPI(
                api_key=UPSTOX_CONFIG['api_key'],
                api_secret=UPSTOX_CONFIG['api_secret'],
                quiet=quiet
            )

        elif provider_lower == 'indmoney':
            if not INDMONEY_CONFIG.get('access_token'):
                raise ValueError(
                    "INDMONEY_CONFIG not properly configured. "
                    "Please set 'access_token' in config.py"
                )

            return INDMONEYApi(
                access_token=INDMONEY_CONFIG['access_token'],
                quiet=quiet
            )

        else:
            raise ValueError(
                f"Unsupported provider '{provider}'. "
                f"Supported providers: {', '.join(cls.SUPPORTED_PROVIDERS)}"
            )

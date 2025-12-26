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
from typing import Optional, Dict, List, Callable
import json
import warnings
import os
from pathlib import Path
import urllib.parse
import gzip

# Try to import Upstox SDK for WebSocket streaming (optional)
try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False
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

# Configuration - Ensure you have a config.py file
try:
    from config import UPSTOX_CONFIG, INDMONEY_CONFIG
except ImportError:
    print("⚠️ config.py not found. Please create it from config_template.py with your Upstox API credentials.")
    UPSTOX_CONFIG = {'api_key': None, 'api_secret': None}
    INDMONEY_CONFIG = {'access_token': None}

# --- Constants ---
API_VERSION = "2.0"  # Still used for authentication
BASE_URL_V2 = "https://api.upstox.com/v2"
BASE_URL_V3 = "https://api.upstox.com/v3"
ORDER_URL = "https://api.upstox.com/v2/order/place"
INSTRUMENT_LIST_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
INSTRUMENT_CACHE_FILE = Path(__file__).parent / "nse_instruments.json"


class UpstoxAPI:
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
        self.api_key = api_key
        self.api_secret = api_secret
        self.instruments = []
        self.quiet = quiet

        if not self.quiet:
            print("🇮🇳 Upstox API Connector Initialized")
            print("="*40)

        # Initialize authentication handler
        if create_upstox_auth is None:
            raise ImportError("Authentication module not available")

        self.auth_handler = create_upstox_auth(api_key, api_secret, quiet)


    def _get_headers(self) -> Dict[str, str]:
        """Constructs the required headers for API calls."""
        return self.auth_handler.get_headers()

    def _download_and_cache_instruments(self):
        """Downloads, decompresses, and caches the NSE instruments list."""
        if not self.quiet:
            print(f"⬇️ Downloading instrument list from {INSTRUMENT_LIST_URL}...")
        try:
            response = requests.get(INSTRUMENT_LIST_URL, stream=True)
            response.raise_for_status()
            
            with gzip.open(response.raw, 'rt', encoding='utf-8') as gz_file:
                instrument_data = json.load(gz_file)
            
            with open(INSTRUMENT_CACHE_FILE, 'w') as f:
                json.dump(instrument_data, f)
            
            self.instruments = instrument_data
            if not self.quiet:
                print(f"✅ Instrument list downloaded and cached at {INSTRUMENT_CACHE_FILE}.")
        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ Failed to download instrument list: {e}")
        except (gzip.BadGzipFile, json.JSONDecodeError) as e:
            if not self.quiet:
                print(f"❌ Failed to process instrument list: {e}")

    def get_instrument_key(self, symbol: str, exchange: str = "NSE_EQ", instrument_type: str = 'EQ', expiry_date: Optional[str] = None, strike_price: Optional[float] = None, option_type: Optional[str] = None) -> Optional[str]:
        """Fetches the instrument key from a cached or newly downloaded instrument list."""
        # Clean symbol to remove exchange prefixes like BSE:, NSE: etc.
        clean_symbol = get_valid_symbol(symbol)
        if not clean_symbol:
            if not self.quiet:
                print(f"❌ Invalid symbol after cleaning: {symbol}")
            return None
            
        if not self.instruments:
            if INSTRUMENT_CACHE_FILE.exists():
                if not self.quiet:
                    print("✅ Loading instruments from local cache...")
                with open(INSTRUMENT_CACHE_FILE, 'r') as f:
                    self.instruments = json.load(f)
            else:
                self._download_and_cache_instruments()

        if not self.instruments:
            if not self.quiet:
                print("❌ Instrument list is empty. Cannot find key.")
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

        if not self.quiet:
            print(f"❌ Instrument key for '{clean_symbol}' (original: '{symbol}') not found with the specified criteria.")
        return None

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

class INDMONEYApi:
    """
    API client for INDMoney (INDstocks) integration.
    
    Provides methods for user profile, funds, and market data.
    """
    
    BASE_URL = "https://api.indstocks.com"
    INSTRUMENT_CACHE_FILE = Path(__file__).parent / "ind_instruments.csv"

    def __init__(self, access_token: str, quiet: bool = False):
        """
        Initialize the INDMoney API client.
        
        Args:
            access_token (str): Your INDMoney access token
            quiet (bool): If True, suppresses console output.
        """
        self.access_token = access_token
        self.quiet = quiet
        self.instruments_df = None
        
        if not self.quiet:
            print("💰 INDMoney API Connector Initialized")

    def _get_headers(self) -> Dict[str, str]:
        """Construct headers for API calls."""
        # Note: Research suggests INDstocks might use the token directly without 'Bearer ' prefix
        return {
            'Authorization': self.access_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

    def _download_and_cache_instruments(self):
        """Downloads and caches the INDMoney instruments list."""
        if not self.quiet:
            print(f"⬇️ Downloading INDMoney instrument list...")
        try:
            url = f"{self.BASE_URL}/market/instruments?source=equity"
            response = requests.get(url, headers=self._get_headers(), timeout=30)
            response.raise_for_status()
            
            with open(self.INSTRUMENT_CACHE_FILE, 'wb') as f:
                f.write(response.content)
            
            self.instruments_df = pd.read_csv(self.INSTRUMENT_CACHE_FILE)
            if not self.quiet:
                print(f"✅ INDMoney instrument list cached at {self.INSTRUMENT_CACHE_FILE}.")
        except Exception as e:
            if not self.quiet:
                print(f"❌ Failed to download INDMoney instruments: {e}")

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

    def fetch_user_profile(self) -> Optional[Dict]:
        """Fetch user profile details."""
        url = f"{self.BASE_URL}/user/profile"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=15)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            if not self.quiet:
                print(f"❌ INDMoney Profile Error: {e}")
            return None

    def fetch_funds(self) -> Optional[Dict]:
        """Fetch available and utilized funds."""
        url = f"{self.BASE_URL}/funds"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=15)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            if not self.quiet:
                print(f"❌ INDMoney Funds Error: {e}")
            return None

    def fetch_ltp(self, symbol: str) -> Optional[float]:
        """
        Fetch Last Traded Price (LTP) for a symbol.
        Automatically handles symbol to scrip-code mapping.
        """
        # 1. Try to get scrip code
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            if not self.quiet:
                print(f"⚠️ Could not find INDMoney scrip code for {symbol}")
            return None
            
        url = f"{self.BASE_URL}/market/quotes/ltp"
        params = {'scrip-codes': scrip_code}
        
        try:
            response = requests.get(url, headers=self._get_headers(), params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            # Structure: {"status":"success","data":{"NSE_2885":{"live_price":1575.4}}}
            if data.get('status') == 'success' and 'data' in data:
                token_data = data['data'].get(scrip_code)
                if token_data and 'live_price' in token_data:
                    return float(token_data['live_price'])
            return None
        except Exception as e:
            if not self.quiet:
                print(f"❌ INDMoney LTP Error for {symbol} ({scrip_code}): {e}")
            return None

    def fetch_full_quotes(self, symbol: str) -> Optional[Dict]:
        """
        Fetch full market quotes for a symbol (OHLC, Depth, Bid/Ask).
        Automatically handles symbol to scrip-code mapping.
        """
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            return None
            
        url = f"{self.BASE_URL}/market/quotes/full"
        params = {'scrip-codes': scrip_code}
        
        try:
            response = requests.get(url, headers=self._get_headers(), params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            if data.get('status') == 'success' and 'data' in data:
                return data['data'].get(scrip_code)
            return None
        except Exception as e:
            if not self.quiet:
                print(f"❌ INDMoney Full Quote Error for {symbol} ({scrip_code}): {e}")
            return None

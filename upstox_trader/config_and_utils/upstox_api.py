"""
Enhanced Upstox API client with real-time streaming capabilities.
"""

import gzip
import json
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional

import pandas as pd
import requests

from .api_helpers import (
    BASE_URL,
    INSTRUMENT_CACHE_FILE,
    INSTRUMENT_LIST_URL,
    create_upstox_auth,
    get_valid_symbol,
)
from .base_api_client import BaseAPIClient
from upstox_trader.queued_rate_limiter import QueuedRateLimiter

try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False


class RateLimitExceeded(Exception):
    """Legacy exception — no longer raised by _request (queued rate limiter).
    Kept for backwards-compat with callers that catch it in except clauses."""
    response = None


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
        self._last_v3_error_status: Optional[int] = None
        self._last_v3_error_text: str = ""

        self._log("🇮🇳 Upstox API Connector Initialized")
        self._log("=" * 40)

        if create_upstox_auth is None:
            raise ImportError("Authentication module not available")

        self.auth_handler = create_upstox_auth(api_key, api_secret, quiet)
        self.queued_rl: QueuedRateLimiter | None = None

    def _init_queued_rl(self):
        if self.queued_rl is None:
            self.queued_rl = QueuedRateLimiter()

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        """Make an HTTP request with distributed rate limiting.

        If the rate-limit window is full the request is queued and
        processed in FIFO order when capacity opens up — no more
        RateLimitExceeded errors from this method.
        """
        self._init_queued_rl()
        return self.queued_rl.execute(method, url, **kwargs)

    def _get_headers(self) -> Dict[str, str]:
        """Constructs the required headers for API calls."""
        return self.auth_handler.get_headers()

    def _candles_to_dataframe(self, candles: list) -> pd.DataFrame:
        """Convert raw candle list to a DataFrame with datetime index."""
        df = pd.DataFrame(candles, columns=['datetime', 'open', 'high', 'low', 'close', 'volume', 'oi'])
        df['datetime'] = pd.to_datetime(df['datetime'])
        df.set_index('datetime', inplace=True)
        df = df.astype({'open': 'float', 'high': 'float', 'low': 'float', 'close': 'float', 'volume': 'float'})
        df.sort_index(inplace=True)
        return df

    def _get_json_headers(self) -> dict:
        headers = self._get_headers()
        headers['Content-Type'] = 'application/json'
        headers['Accept'] = 'application/json'
        return headers

    def _call_api(self, url: str, label: str = "", params: dict | None = None) -> dict | list | None:
        """Make an authed GET request and unwrap the Upstox API response envelope.

        Args:
            url: Full API URL
            label: Human-readable label for error messages (e.g., "order book")
            params: Optional query parameters

        Returns:
            data dict/list on success, None on failure
        """
        if not self.auth_handler.access_token:
            return None
        headers = self._get_json_headers()
        try:
            response = self._request("GET", url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict) and data.get('status') == 'success':
                return data.get('data')
            return None
        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ API Error {label}: {e.response.text if e.response else e}")
            return None

    def _handle_request_error(self, e: Exception, symbol: str, context: str = "") -> None:
        """Log API error. Always returns None for the caller."""
        prefix = f" {context}" if context else ""
        if isinstance(e, RateLimitExceeded):
            if not self.quiet:
                print(f"⏳ Rate limited — skipped {symbol}{prefix}")
            return
        if isinstance(e, requests.RequestException):
            status_code = e.response.status_code if e.response is not None else None
            if not self.quiet:
                if status_code == 429:
                    print(f"⏳ Upstox rate limited (429) {symbol}{prefix}")
                elif status_code is not None:
                    print(f"❌ HTTP {status_code} for {symbol}{prefix}: {e}")
                else:
                    print(f"❌ Request failed for {symbol}{prefix}: {e}")
            return
        raise

    def _download_and_cache_instruments(self):
        """Downloads, decompresses, and caches the NSE instruments list."""
        self._log(f"⬇️ Downloading instrument list from {INSTRUMENT_LIST_URL}...")
        try:
            response = self._request("GET", INSTRUMENT_LIST_URL, stream=True)
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

    def get_instrument_key(self, symbol: str, exchange: str = "NSE_EQ",
                          instrument_type: str = 'EQ', expiry_date: Optional[str] = None,
                          strike_price: Optional[float] = None,
                          option_type: Optional[str] = None,
                          force_refresh: bool = False) -> Optional[str]:
        """Fetches the instrument key from a cached or newly downloaded instrument list."""
        clean_symbol = get_valid_symbol(symbol)
        if not clean_symbol:
            self._log(f"❌ Invalid symbol after cleaning: {symbol}")
            return None

        if force_refresh:
            self.instruments = []
            self._download_and_cache_instruments()
        elif not self.instruments:
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
            if instrument_type in ['EQ', 'INDEX']:
                segment = 'NSE_INDEX' if instrument_type == 'INDEX' else exchange
                if (instrument.get('trading_symbol') == clean_symbol and
                        instrument.get('segment') == segment and
                        instrument.get('instrument_type') == instrument_type):
                    return instrument.get('instrument_key')
            elif instrument_type in ['CE', 'PE']:
                expiry_ts = instrument.get('expiry')
                if (instrument.get('name') == symbol and
                        instrument.get('instrument_type') == option_type and
                        instrument.get('strike_price') == strike_price and
                        expiry_ts and
                        datetime.fromtimestamp(expiry_ts / 1000).strftime('%Y-%m-%d') == expiry_date):
                    return instrument.get('instrument_key')

        self._log(f"❌ Instrument key for '{clean_symbol}' (original: '{symbol}') not found with the specified criteria.")
        return None

    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        """Get current price for a symbol (unified interface)."""
        price = self.get_realtime_price(symbol)
        if price is not None:
            return price

        instrument_type = kwargs.get('instrument_type', 'EQ')
        exchange = kwargs.get('exchange', 'NSE_EQ')

        df = self.fetch_intraday_data_v3(symbol, interval='1',
                                         instrument_type=instrument_type,
                                         exchange=exchange)
        if df is not None and not df.empty:
            return float(df['close'].iloc[-1])

        return None

    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        """Get full market quote for a symbol (unified interface)."""
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
        """Get historical OHLCV data (unified interface)."""
        instrument_type = kwargs.get('instrument_type', 'EQ')
        exchange = kwargs.get('exchange', 'NSE_EQ')
        expiry_date = kwargs.get('expiry_date')
        strike_price = kwargs.get('strike_price')
        option_type = kwargs.get('option_type')

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

    def fetch_intraday_data_v3(self, symbol: str, interval: str,
                               instrument_type: str = 'EQ',
                               exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches today's intraday OHLCV data using the Upstox V3 Intraday API.
        """
        instrument_key = self.get_instrument_key(symbol, instrument_type=instrument_type, exchange=exchange)
        if not instrument_key:
            return None

        if not self.quiet:
            console_msg = f"📊 Fetching V3 intraday {interval} data for {symbol}..."
            try:
                from rich.console import Console
                Console().print(f"[dim]{console_msg}[/dim]")
            except:
                print(console_msg)

        encoded_key = urllib.parse.quote(instrument_key, safe='')
        url = f"{BASE_URL}/historical-candle/intraday/{encoded_key}/minutes/{interval.replace('minute', '')}"

        headers = self._get_headers()

        try:
            response = self._request("GET", url, headers=headers, timeout=30)
            response.raise_for_status()

            data = response.json()
            if data.get('status') == 'success' and 'data' in data and 'candles' in data['data']:
                candles = data['data']['candles']
                if not candles:
                    if not self.quiet:
                        print(f"⚠️ No intraday candles available for {symbol} today.")
                    return None

                df = self._candles_to_dataframe(candles)

                if not self.quiet:
                    print(f"✅ Successfully fetched {len(df)} V3 intraday records for {symbol}.")
                return df
            else:
                if not self.quiet:
                    print(f"❌ V3 Intraday API error for {symbol}: {data}")
                return None
        except (RateLimitExceeded, requests.RequestException) as e:
            self._handle_request_error(e, symbol)
            return None
        except Exception as e:
            if not self.quiet:
                print(f"❌ Error processing V3 intraday data for {symbol}: {e}")
            return None

    def fetch_historical_data(self, symbol: str, interval: str, from_date: str, to_date: str,
                              instrument_type: str = 'EQ', expiry_date: Optional[str] = None,
                              strike_price: Optional[float] = None,
                              option_type: Optional[str] = None,
                              exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches historical OHLCV data for a given symbol using the V2 API.
        """
        if not self.auth_handler.access_token:
            return None

        instrument_key = self.get_instrument_key(
            symbol, instrument_type=instrument_type, expiry_date=expiry_date,
            strike_price=strike_price, option_type=option_type, exchange=exchange
        )
        if not instrument_key:
            return None

        if not self.quiet:
            print(f"📊 Fetching {interval} historical data for {symbol}...")

        url = f"{BASE_URL}/historical-candle/{instrument_key}/{interval}/{to_date}/{from_date}"

        try:
            response = self._request("GET", url, headers=self._get_headers())
            response.raise_for_status()

            data = response.json().get('data', {}).get('candles', [])
            if not data:
                if not self.quiet:
                    print(f"⚠️ No data returned for {symbol} in the given date range.")
                return pd.DataFrame()

            df = self._candles_to_dataframe(data)

            if not self.quiet:
                print(f"✅ Successfully fetched {len(df)} records for {symbol}.")
            return df

        except (RateLimitExceeded, requests.RequestException) as e:
            self._handle_request_error(e, symbol)
            return None

    def fetch_historical_data_v3(self, symbol: str, unit: str, interval: int, to_date: str,
                                  from_date: Optional[str] = None,
                                  instrument_type: str = 'EQ',
                                  expiry_date: Optional[str] = None,
                                  strike_price: Optional[float] = None,
                                  option_type: Optional[str] = None,
                                  exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches historical OHLCV data using the V3 Historical Candle Data API with automatic chunking.
        """
        instrument_key = self.get_instrument_key(
            symbol,
            instrument_type=instrument_type,
            expiry_date=expiry_date,
            strike_price=strike_price,
            option_type=option_type,
            exchange=exchange,
        )
        if not instrument_key:
            return None

        valid_intervals = {
            'minutes': list(range(1, 301)),
            'hours': list(range(1, 6)),
            'days': [1],
            'weeks': [1],
            'months': [1]
        }

        if unit not in valid_intervals:
            if not self.quiet:
                print(f"❌ Invalid unit '{unit}'. Valid units: {list(valid_intervals.keys())}")
            return None

        if interval not in valid_intervals[unit]:
            if not self.quiet:
                print(f"❌ Invalid interval '{interval}' for unit '{unit}'. Valid intervals: {valid_intervals[unit]}")
            return None

        if unit == 'minutes':
            if interval <= 15:
                chunk_days = 30
            else:
                chunk_days = 90
        elif unit == 'hours':
            chunk_days = 90
        elif unit == 'days':
            chunk_days = 3650
        else:
            chunk_days = None

        def fetch_single_with_retry(chunk_to: str, chunk_from: Optional[str]) -> Optional[pd.DataFrame]:
            df = self._fetch_single_chunk_v3(symbol, unit, interval, chunk_to, chunk_from, instrument_key)
            if (
                    df is None
                    and self._last_v3_error_status == 400
                    and instrument_type in ['EQ', 'INDEX']
            ):
                stale_key = instrument_key
                if not self.quiet:
                    print(
                        f"🔄 V3 returned 400 for {symbol} ({stale_key}). "
                        "Refreshing instrument cache and retrying once..."
                    )
                refreshed_key = self.get_instrument_key(
                    symbol,
                    instrument_type=instrument_type,
                    expiry_date=expiry_date,
                    strike_price=strike_price,
                    option_type=option_type,
                    exchange=exchange,
                    force_refresh=True,
                )
                if refreshed_key and refreshed_key != stale_key:
                    if not self.quiet:
                        print(f"✅ Refreshed instrument key for {symbol}: {stale_key} -> {refreshed_key}")
                    return self._fetch_single_chunk_v3(symbol, unit, interval, chunk_to, chunk_from, refreshed_key)
            return df

        if not from_date or not chunk_days:
            return fetch_single_with_retry(to_date, from_date)

        to_dt = datetime.strptime(to_date, '%Y-%m-%d')
        from_dt = datetime.strptime(from_date, '%Y-%m-%d')
        total_days = (to_dt - from_dt).days

        if total_days <= chunk_days:
            return fetch_single_with_retry(to_date, from_date)

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

            chunk_df = fetch_single_with_retry(chunk_to, chunk_from)

            if chunk_df is not None and not chunk_df.empty:
                all_data.append(chunk_df)

            current_to = current_from - timedelta(days=1)
            time.sleep(0.5)

        if not all_data:
            if not self.quiet:
                print(f"⚠️ No data retrieved for {symbol}")
            return pd.DataFrame()

        full_df = pd.concat(all_data).sort_index()
        full_df = full_df[~full_df.index.duplicated(keep='first')]

        if not self.quiet:
            print(f"✅ Successfully fetched {len(full_df)} historical records for {symbol} using V3 API (chunked).")
            print(f"📅 Data range: {full_df.index[0]} to {full_df.index[-1]}")
        return full_df

    def _fetch_single_chunk_v3(self, symbol: str, unit: str, interval: int,
                               to_date: str, from_date: Optional[str],
                               instrument_key: str) -> Optional[pd.DataFrame]:
        """Helper method to fetch a single chunk of V3 historical data."""
        self._last_v3_error_status = None
        self._last_v3_error_text = ""

        encoded_instrument_key = urllib.parse.quote(instrument_key, safe='')

        if from_date:
            url = f"{BASE_URL}/historical-candle/{encoded_instrument_key}/{unit}/{interval}/{to_date}/{from_date}"
        else:
            url = f"{BASE_URL}/historical-candle/{encoded_instrument_key}/{unit}/{interval}/{to_date}"

        headers = self._get_headers()

        try:
            response = self._request("GET", url, headers=headers)
            response.raise_for_status()

            json_data = response.json()

            if json_data.get('status') != 'success':
                if not self.quiet:
                    print(f"❌ API returned non-success status: {json_data}")
                return pd.DataFrame()

            candles = json_data.get('data', {}).get('candles', [])
            if not candles:
                return pd.DataFrame()

            df = self._candles_to_dataframe(candles)

            return df

        except (RateLimitExceeded, requests.RequestException) as e:
            self._last_v3_error_status = e.response.status_code if e.response is not None else None
            self._last_v3_error_text = e.response.text if e.response is not None else str(e)
            self._handle_request_error(e, symbol)
            return None

    def place_order(self, symbol: str, transaction_type: str, quantity: int,
                    order_type: str = "MARKET", product: str = "D", price: float = 0,
                    trigger_price: float = 0, slice: bool = True,
                    market_protection: int = -1, tag: str = "") -> Optional[Dict]:
        """Places an order using the Upstox HFT API V3."""
        if not self.auth_handler.access_token:
            return None

        instrument_key = self.get_instrument_key(symbol)
        if not instrument_key:
            return None

        headers = self._get_json_headers()

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
            "is_amo": False,
            "slice": slice,
            "market_protection": market_protection,
        }
        if tag:
            data["tag"] = tag

        try:
            from .api_helpers import ORDER_URL
            response = self._request("POST", ORDER_URL, headers=headers, json=data)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if not self.quiet:
                print(f"❌ API Error placing order for {symbol}: {e.response.text if e.response else e}")
            return None

    def get_order_book(self) -> Optional[List[Dict]]:
        """Fetch all orders placed today using V2 API."""
        from .api_helpers import ORDER_BOOK_URL
        return self._call_api(ORDER_BOOK_URL, "order book")

    def get_order_details(self, order_id: str) -> Optional[Dict]:
        """Fetch details for a specific order."""
        url = "https://api.upstox.com/v2/order/details"
        return self._call_api(url, "order details", {"order_id": order_id})

    def get_funds(self) -> Optional[Dict]:
        """Fetch user fund balance and margin details."""
        return self._call_api("https://api.upstox.com/v3/user/get-funds-and-margin", "funds")

    def get_positions(self) -> Optional[List[Dict]]:
        """Fetch current day trading positions."""
        return self._call_api("https://api.upstox.com/v3/positions", "positions")

    def setup_realtime_streaming(self, symbols: List[str],
                                 callback: Optional[Callable] = None) -> bool:
        """Setup real-time WebSocket streaming for tick-by-tick data."""
        if not UPSTOX_SDK_AVAILABLE:
            if not self.quiet:
                print("❌ WebSocket streaming not available - install upstox-python-sdk")
            return False

        if not self._is_market_open():
            if not self.quiet:
                print("⚠️ Market is closed - WebSocket streaming may not work")
                print("💡 NSE trading hours: 9:15 AM - 3:30 PM IST")

        try:
            configuration = upstox_client.Configuration()
            configuration.access_token = self.auth_handler.access_token

            instrument_keys_list = []
            if not hasattr(self, 'instrument_to_symbol_map'):
                self.instrument_to_symbol_map = {}

            for symbol in symbols:
                instrument_key = self.get_instrument_key(symbol)
                if instrument_key:
                    instrument_keys_list.append(instrument_key)
                    self.instrument_to_symbol_map[instrument_key] = symbol
                else:
                    if not self.quiet:
                        print(f"⚠️ Could not get instrument key for {symbol}")

            if not instrument_keys_list:
                if not self.quiet:
                    print("❌ No valid instrument keys found")
                return False

            api_client = upstox_client.ApiClient(configuration)
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

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

    def _refresh_and_retry_streaming(self, symbols: List[str],
                                     callback: Optional[Callable] = None) -> bool:
        """Token refresh is not needed - authentication is guaranteed at startup."""
        if not self.quiet:
            print("❌ Unexpected token validation failure - this should not happen")
        return False

    def _setup_streaming_with_validated_token(self, symbols: List[str],
                                              callback: Optional[Callable] = None) -> bool:
        """Setup streaming with a validated token."""
        try:
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

            api_client = upstox_client.ApiClient(self._get_sdk_configuration())
            self.market_streamer = upstox_client.MarketDataStreamerV3(
                api_client,
                instrument_keys_list,
                "ltpc"
            )

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

                if not hasattr(self, 'realtime_prices'):
                    self.realtime_prices = {}
                if not hasattr(self, 'instrument_to_symbol_map'):
                    self.instrument_to_symbol_map = {}

                for instrument_key, data in feeds.items():
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        price = float(data['ltpc']['ltp'])

                        self.realtime_prices[instrument_key] = price

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

                if hasattr(self, 'market_streamer') and self.market_streamer:
                    pass
            else:
                if not self.quiet:
                    print("❌ Re-authentication failed")

        except Exception as e:
            if not self.quiet:
                print(f"❌ Token refresh failed: {e}")

    def _is_market_open(self) -> bool:
        """Check if Indian stock market is currently open."""
        now = datetime.now().time()
        market_open = datetime.time(9, 15)
        market_close = datetime.time(15, 30)

        current_weekday = datetime.now().weekday()
        if current_weekday >= 5:
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

        instrument_key = self.get_instrument_key(symbol)
        if not instrument_key:
            return None

        return self.realtime_prices.get(instrument_key)

    def get_current_price_with_streaming(self, symbol: str,
                                         instrument_type: str = 'EQ',
                                         exchange: str = 'NSE_EQ') -> Optional[float]:
        """Get current price using real-time streaming."""
        price = self.get_realtime_price(symbol)
        if price is not None:
            return price

        if not self.is_streaming_active():
            if not self.quiet:
                print(f"🔗 Setting up real-time streaming for {symbol}...")

            if self.setup_realtime_streaming([symbol]):
                if self.start_realtime_streaming():
                    import time
                    time.sleep(2)

                    price = self.get_realtime_price(symbol)
                    if price is not None:
                        return price

        return None

    def get_batch_current_prices_with_streaming(self, symbols: List[str],
                                                 instrument_type: str = 'EQ',
                                                 exchange: str = 'NSE_EQ') -> Dict[str, float]:
        """Get current prices for multiple symbols using real-time streaming."""
        results = {}

        for symbol in symbols:
            price = self.get_realtime_price(symbol)
            if price is not None:
                results[symbol] = price

        if len(results) == len(symbols):
            return results

        symbols_needing_streaming = [s for s in symbols if s not in results]

        if not self.is_streaming_active() and symbols_needing_streaming:
            if not self.quiet:
                print(f"🔗 Setting up real-time streaming for {len(symbols_needing_streaming)} symbols...")

            if self.setup_realtime_streaming(symbols_needing_streaming):
                if self.start_realtime_streaming():
                    import time
                    time.sleep(3)

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
            if hasattr(self, 'market_streamer') and self.market_streamer:
                try:
                    self.market_streamer.disconnect()
                except:
                    pass

            return self._setup_streaming_with_validated_token(symbols)

        except Exception as e:
            if not self.quiet:
                print(f"❌ WebSocket retry failed: {e}")
            return False

#!/usr/bin/env python3
"""
🇮🇳 Upstox API Connector

A streamlined class to connect to the Upstox API (V2),
with a focus on simplicity, persistent authentication, and robust data fetching.
"""

import pandas as pd
import requests
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import json
import warnings
import os
from pathlib import Path
import webbrowser
import http.server
import socketserver
import threading
import urllib.parse
import gzip

warnings.filterwarnings('ignore')

# Configuration - Ensure you have a config.py file
try:
    from config import UPSTOX_CONFIG
except ImportError:
    print("⚠️ config.py not found. Please create it from config_template.py with your Upstox API credentials.")
    UPSTOX_CONFIG = {'api_key': None, 'api_secret': None}

# --- Constants ---
TOKEN_FILE = Path(".upstox_token.json")
REDIRECT_URI = "http://localhost:5000/callback"
API_VERSION = "2.0"
BASE_URL = "https://api.upstox.com/v2"
ORDER_URL = "https://api.upstox.com/v2/order/place"
INSTRUMENT_LIST_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
INSTRUMENT_CACHE_FILE = Path("nse_instruments.json")


class UpstoxAPI:
    """
    A simplified and robust client for the Upstox API (V2).
    - Handles OAuth2 authentication automatically.
    - Persists and reuses the access token to minimize logins.
    - Downloads and caches the official instrument list for reliable lookups.
    """

    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self.access_token = None
        self.redirect_uri = REDIRECT_URI
        self._auth_code = None
        self._httpd = None
        self.instruments = []

        print("🇮🇳 Upstox API Connector Initialized")
        print("="*40)
        self.load_token()

    def load_token(self):
        """Load access token from the local file if it exists and is valid."""
        if TOKEN_FILE.exists():
            try:
                with open(TOKEN_FILE, 'r') as f:
                    token_data = json.load(f)
                
                token_time = datetime.fromisoformat(token_data.get('timestamp', '1970-01-01'))
                if datetime.now() - token_time < timedelta(hours=23):
                    self.access_token = token_data.get('access_token')
                    print("✅ Access token loaded successfully from file.")
                else:
                    print("🟡 Access token found but has expired. Re-authentication is required.")
                    TOKEN_FILE.unlink()
            except (json.JSONDecodeError, KeyError) as e:
                print(f"⚠️ Could not read token file: {e}. Re-authentication needed.")
        else:
            print("🔑 No local access token found.")

    def save_token(self):
        """Save the access token and current timestamp to a local file."""
        if self.access_token:
            token_data = {
                'access_token': self.access_token,
                'timestamp': datetime.now().isoformat()
            }
            with open(TOKEN_FILE, 'w') as f:
                json.dump(token_data, f)
            print(f"✅ Access token saved to {TOKEN_FILE}")

    def _start_auth_server(self):
        """Starts a temporary local server to catch the OAuth2 callback."""
        self._auth_code = None

        class AuthHandler(http.server.SimpleHTTPRequestHandler):
            def do_GET(self_handler):
                if '/callback' in self_handler.path:
                    query = urllib.parse.urlparse(self_handler.path).query
                    params = urllib.parse.parse_qs(query)
                    if 'code' in params:
                        self._auth_code = params['code'][0]
                        self_handler.send_response(200)
                        self_handler.send_header('Content-type', 'text/html')
                        self_handler.end_headers()
                        self_handler.wfile.write(b"<html><body><h1>Authentication successful!</h1><p>You can close this window now.</p></body></html>")
                        threading.Thread(target=self._httpd.shutdown).start()
                    else:
                        self_handler.send_response(400)
                else:
                    self_handler.send_response(404)
            
            def log_message(self, format, *args):
                pass

        try:
            self._httpd = socketserver.TCPServer(('localhost', 5000), AuthHandler)
            print("🔐 Waiting for authentication... Please log in to Upstox in your browser.")
            self._httpd.serve_forever()
        except Exception as e:
            print(f"❌ Failed to start auth server: {e}")
        finally:
            if self._httpd:
                self._httpd.server_close()

    def _get_access_token(self, auth_code: str) -> Optional[str]:
        """Exchange the authorization code for an access token."""
        headers = {'Accept': 'application/json'}
        data = {
            'code': auth_code,
            'client_id': self.api_key,
            'client_secret': self.api_secret,
            'redirect_uri': self.redirect_uri,
            'grant_type': 'authorization_code'
        }
        try:
            response = requests.post(f"{BASE_URL}/login/authorization/token", headers=headers, data=data)
            response.raise_for_status()
            return response.json().get('access_token')
        except requests.RequestException as e:
            print(f"❌ Token generation failed: {e.response.text if e.response else e}")
            return None

    def authenticate(self):
        """Initiates the full OAuth2 authentication flow."""
        if self.access_token:
            print("✅ Already authenticated.")
            return True

        server_thread = threading.Thread(target=self._start_auth_server)
        server_thread.daemon = True
        server_thread.start()
        time.sleep(1)

        login_url = f"{BASE_URL}/login/authorization/dialog?response_type=code&client_id={self.api_key}&redirect_uri={self.redirect_uri}"
        print(f"🔐 Opening browser for authentication: {login_url}")
        webbrowser.open(login_url)

        server_thread.join(timeout=120)

        if not self._auth_code:
            print("❌ Authentication timed out or failed.")
            return False
        
        print("✅ Authentication code received.")
        self.access_token = self._get_access_token(self._auth_code)
        if self.access_token:
            print("✅ Access token obtained successfully!")
            self.save_token()
            return True
        else:
            print("❌ Failed to obtain access token.")
            return False

    def _get_headers(self) -> Dict[str, str]:
        """Constructs the required headers for API calls."""
        return {
            'Accept': 'application/json',
            'Api-Version': API_VERSION,
            'Authorization': f'Bearer {self.access_token}'
        }

    def _download_and_cache_instruments(self):
        """Downloads, decompresses, and caches the NSE instruments list."""
        print(f"⬇️ Downloading instrument list from {INSTRUMENT_LIST_URL}...")
        try:
            response = requests.get(INSTRUMENT_LIST_URL, stream=True)
            response.raise_for_status()
            
            with gzip.open(response.raw, 'rt', encoding='utf-8') as gz_file:
                instrument_data = json.load(gz_file)
            
            with open(INSTRUMENT_CACHE_FILE, 'w') as f:
                json.dump(instrument_data, f)
            
            self.instruments = instrument_data
            print(f"✅ Instrument list downloaded and cached at {INSTRUMENT_CACHE_FILE}.")
        except requests.RequestException as e:
            print(f"❌ Failed to download instrument list: {e}")
        except (gzip.BadGzipFile, json.JSONDecodeError) as e:
            print(f"❌ Failed to process instrument list: {e}")

    def get_instrument_key(self, symbol: str, exchange: str = "NSE_EQ", instrument_type: str = 'EQ', expiry_date: Optional[str] = None, strike_price: Optional[float] = None, option_type: Optional[str] = None) -> Optional[str]:
        """Fetches the instrument key from a cached or newly downloaded instrument list."""
        if not self.instruments:
            if INSTRUMENT_CACHE_FILE.exists():
                print("✅ Loading instruments from local cache...")
                with open(INSTRUMENT_CACHE_FILE, 'r') as f:
                    self.instruments = json.load(f)
            else:
                self._download_and_cache_instruments()

        if not self.instruments:
            print("❌ Instrument list is empty. Cannot find key.")
            return None

        for instrument in self.instruments:
            # Equity or Index
            if instrument_type in ['EQ', 'INDEX']:
                segment = 'NSE_INDEX' if instrument_type == 'INDEX' else exchange
                if (instrument.get('trading_symbol') == symbol and
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

        print(f"❌ Instrument key for '{symbol}' not found with the specified criteria.")
        return None

    def fetch_historical_data(self, symbol: str, interval: str, from_date: str, to_date: str, instrument_type: str = 'EQ', expiry_date: Optional[str] = None, strike_price: Optional[float] = None, option_type: Optional[str] = None, exchange: str = 'NSE_EQ') -> Optional[pd.DataFrame]:
        """
        Fetches historical OHLCV data for a given symbol using the V2 API.
        
        Note: The V2 API supports '1minute', '30minute', 'day', 'week', 'month'.
        For other intervals, consider using the V3 API or resampling the data.
        """
        if not self.access_token and not self.authenticate():
            return None
        
        instrument_key = self.get_instrument_key(symbol, instrument_type=instrument_type, expiry_date=expiry_date, strike_price=strike_price, option_type=option_type, exchange=exchange)
        if not instrument_key:
            return None
            
        print(f"📊 Fetching {interval} historical data for {symbol}...")
        
        url = f"{BASE_URL}/historical-candle/{instrument_key}/{interval}/{to_date}"
        params = {'from_date': from_date}
        
        try:
            response = requests.get(url, headers=self._get_headers(), params=params)
            response.raise_for_status()
            
            data = response.json().get('data', {}).get('candles', [])
            if not data:
                print(f"⚠️ No data returned for {symbol} in the given date range.")
                return pd.DataFrame()
            
            df = pd.DataFrame(data, columns=['datetime', 'open', 'high', 'low', 'close', 'volume', 'oi'])
            df['datetime'] = pd.to_datetime(df['datetime'])
            df.set_index('datetime', inplace=True)
            
            print(f"✅ Successfully fetched {len(df)} records for {symbol}.")
            return df

        except requests.RequestException as e:
            if e.response and e.response.status_code in [401, 403]:
                print("🟡 Token might be invalid. Re-authenticating...")
                self.access_token = None
                TOKEN_FILE.unlink(missing_ok=True)
                return self.fetch_historical_data(symbol, interval, from_date, to_date)
            print(f"❌ API Error fetching historical data for {symbol}: {e.response.text if e.response else e}")
            return None

    def place_order(self, symbol: str, transaction_type: str, quantity: int, order_type: str = "MARKET", product: str = "D", price: float = 0, trigger_price: float = 0) -> Optional[Dict]:
        """
        Places an order using the Upstox API V3.
        """
        if not self.access_token and not self.authenticate():
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
            print(f"❌ API Error placing order for {symbol}: {e.response.text if e.response else e}")
            return None

def main():
    """Example usage of the UpstoxAPI class."""
    if not (UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret')):
        print("❌ Please set your UPSTOX_CONFIG in config.py")
        return

    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    if not api.access_token:
        print("\n🚀 Starting authentication process...")
        if not api.authenticate():
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

    print("\n--- Example 2: Fetching 1-Minute Intraday Data for RELIANCE ---")
    today = datetime.now().strftime("%Y-%m-%d")
    
    # Note: 1-minute data for a full day might be large.
    # For V2, the from_date and to_date range is limited for intraday data.
    reliance_df = api.fetch_historical_data(
        symbol="RELIANCE",
        interval="1minute",
        from_date=today, # V2 might have limitations on intraday range
        to_date=today
    )
    
    if reliance_df is not None and not reliance_df.empty:
        print("\n📊 RELIANCE Last 5 Minutes:")
        print(reliance_df.tail())

if __name__ == "__main__":
    main()

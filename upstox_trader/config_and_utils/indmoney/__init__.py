"""
INDMoney (INDstocks) API client package.

Composed from mixins:
- AuthMixin        – authentication, token management, instrument resolution
- PortfolioMixin    – user profile, funds, positions
- HoldingsMixin     – equity holdings
- OrdersMixin       – order placement, modification, cancellation, smart orders
"""

import json
import threading
from typing import Callable, Dict, List, Optional

import pandas as pd
import requests

from ..base_api_client import BaseAPIClient
from ..websocket_utils import WEBSOCKET_CLIENT_AVAILABLE, WEBSOCKETS_AVAILABLE

from .auth import AuthMixin
from .portfolio import PortfolioMixin
from .holdings import HoldingsMixin
from .orders import OrdersMixin

try:
    import websocket
except ImportError:
    websocket = None


class MarketDataMixin:

    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        return self.fetch_ltp(symbol)

    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        return self.fetch_full_quotes(symbol)

    def fetch_ltp(self, symbol: str) -> Optional[float]:
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"⚠️ Could not find INDMoney scrip code for {symbol}")
            return None

        url = f"{self.BASE_URL}/market/quotes/ltp"
        params = {'scrip-codes': scrip_code}

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, params=params, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                token_data = data['data'].get(scrip_code)
                if token_data and 'live_price' in token_data:
                    return float(token_data['live_price'])
            return None
        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ INDMoney LTP Error for {symbol} ({scrip_code}): {e}")
            return None

    def fetch_full_quotes(self, symbols) -> Optional[Dict]:
        single_symbol = isinstance(symbols, str)
        if single_symbol:
            symbols = [symbols]

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

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbols[0] if single_symbol else ','.join(symbols))

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                all_quotes = data['data']
                if single_symbol and len(scrip_codes) == 1:
                    return all_quotes.get(scrip_codes[0])
                return all_quotes
            return None
        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ INDMoney Full Quote Error for {symbols}: {e}")
            return None

    def fetch_market_depth(self, symbol: str) -> Optional[Dict]:
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

    def fetch_option_chain(self, symbol: str, expiry_date: str = None) -> Optional[pd.DataFrame]:
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
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

        security_id = scrip_code.split('_')[1] if '_' in scrip_code else scrip_code

        url = f"{self.BASE_URL}/greeks"

        data = {
            'security_id': security_id,
            'strike_price': strike_price,
            'option_type': option_type.upper(),
            'expiry_date': expiry_date
        }

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
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

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


class WebSocketMixin:

    def _init_websockets(self):
        self._ws_market_data = None
        self._ws_order_updates = None
        self._ws_portfolio = None
        self._ws_threads = {}

        self._on_market_data = None
        self._on_order_update = None
        self._on_portfolio_update = None

        self._market_subscriptions = set()
        self._order_subscriptions = False
        self._portfolio_subscriptions = False

    def connect_market_data_websocket(self, on_message: Callable[[Dict], None],
                                     symbols: List[str] = None) -> bool:
        if not WEBSOCKETS_AVAILABLE and not WEBSOCKET_CLIENT_AVAILABLE:
            self._log("❌ WebSocket library not available. Install: pip install websocket-client")
            return False

        self._on_market_data = on_message

        try:
            if WEBSOCKET_CLIENT_AVAILABLE:
                ws_url = f"{self.WS_BASE_URL}/market-data"
                self._ws_market_data = websocket.WebSocketApp(
                    ws_url,
                    on_open=self._on_market_ws_open,
                    on_message=self._on_market_ws_message,
                    on_error=self._on_market_ws_error,
                    on_close=self._on_market_ws_close
                )

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
        self._log("✅ Market data WebSocket connected")

        if self._market_subscriptions:
            self.subscribe_market_data(list(self._market_subscriptions))

    def _on_market_ws_message(self, ws, message):
        try:
            data = json.loads(message)

            if self._on_market_data:
                self._on_market_data(data)

        except Exception as e:
            self._log(f"❌ Error parsing market data message: {e}")

    def _on_market_ws_error(self, ws, error):
        self._log(f"❌ Market data WebSocket error: {error}")

    def _on_market_ws_close(self, ws, close_status_code, close_msg):
        self._log("ℹ️  Market data WebSocket connection closed")

    def subscribe_market_data(self, symbols: List[str]) -> bool:
        if not self._ws_market_data:
            self._log("❌ Market data WebSocket not connected. Call connect_market_data_websocket() first")
            return False

        try:
            self._market_subscriptions.update(symbols)

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
        if not self._ws_market_data:
            return False

        try:
            self._market_subscriptions.difference_update(symbols)

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
        if self._ws_market_data:
            self._ws_market_data.close()
            self._ws_market_data = None
            self._market_subscriptions.clear()
            self._log("✅ Market data WebSocket disconnected")

    def connect_order_updates_websocket(self, on_message: Callable[[Dict], None]) -> bool:
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
        try:
            data = json.loads(message)

            if self._on_order_update:
                self._on_order_update(data)

        except Exception as e:
            self._log(f"❌ Error parsing order update message: {e}")

    def disconnect_order_updates_websocket(self):
        if self._ws_order_updates:
            self._ws_order_updates.close()
            self._ws_order_updates = None
            self._order_subscriptions = False
            self._log("✅ Order updates WebSocket disconnected")

    def connect_portfolio_websocket(self, on_message: Callable[[Dict], None]) -> bool:
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
        try:
            data = json.loads(message)

            if self._on_portfolio_update:
                self._on_portfolio_update(data)

        except Exception as e:
            self._log(f"❌ Error parsing portfolio update message: {e}")

    def disconnect_portfolio_websocket(self):
        if self._ws_portfolio:
            self._ws_portfolio.close()
            self._ws_portfolio = None
            self._portfolio_subscriptions = False
            self._log("✅ Portfolio WebSocket disconnected")

    def disconnect_all_websockets(self):
        self.disconnect_market_data_websocket()
        self.disconnect_order_updates_websocket()
        self.disconnect_portfolio_websocket()
        self._log("✅ All WebSocket connections disconnected")


class INDMONEYApi(AuthMixin, PortfolioMixin, HoldingsMixin, OrdersMixin,
                  MarketDataMixin, WebSocketMixin, BaseAPIClient):
    """
    API client for INDMoney (INDstocks) integration.

    Provides methods for user profile, funds, and market data.
    Tokens expire within 24 hours and must be regenerated manually.
    """

    def __init__(self, access_token: str, quiet: bool = False):
        super().__init__(quiet=quiet)
        self._quiet = quiet
        self._init_auth(access_token)
        self._init_websockets()
        self._log("💰 INDMoney API Connector Initialized")

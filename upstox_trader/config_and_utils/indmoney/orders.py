"""
Order placement and management for INDMoney: place, modify, cancel, smart orders,
order book, trade book, trade details.
"""

from typing import Dict, List, Optional

import pandas as pd
import requests


class OrdersMixin:

    def place_order(self, symbol: str, transaction_type: str, quantity: int,
                    order_type: str = "MARKET", price: float = 0,
                    product: str = "CNC", validity: str = "DAY",
                    exchange: str = "NSE", segment: str = "EQUITY") -> Optional[Dict]:
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

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

            if response.status_code in [401, 403]:
                self._handle_api_error(response, symbol)

            response.raise_for_status()
            result = response.json()

            self._log(f"✅ Order placed: {transaction_type} {quantity} {symbol} @ {order_type}")
            return result

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Order placement failed for {symbol}: {e}")
            return None

    def modify_order(self, order_id: str, new_price: float = None,
                     new_quantity: int = None) -> Optional[Dict]:
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

    def fetch_trade_details(self, order_id: str) -> Optional[Dict]:
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

    def place_smart_order(self, symbol: str, order_type: str, quantity: int,
                          trigger_price: float, price: float = 0,
                          exchange: str = "NSE", segment: str = "EQUITY",
                          validity: str = "DAY", product: str = "CNC") -> Optional[Dict]:
        scrip_code = self.get_instrument_key(symbol)
        if not scrip_code:
            self._log(f"❌ Could not find scrip code for {symbol}")
            return None

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

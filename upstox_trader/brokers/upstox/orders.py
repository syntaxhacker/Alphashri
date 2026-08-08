from typing import Any, Dict, List, Optional

import requests

from ..base import BrokerAuth, BrokerOrders, BrokerSymbolMap

ORDER_URL = "https://api-hft.upstox.com/v3/order/place"
ORDER_BOOK_URL = "https://api.upstox.com/v2/order/retrieve-all"
ORDER_DETAILS_URL = "https://api.upstox.com/v2/order/details"
ORDER_CANCEL_URL = "https://api.upstox.com/v2/order/cancel"
ORDER_MODIFY_URL = "https://api-hft.upstox.com/v3/order/modify"
HOLDINGS_URL = "https://api.upstox.com/v3/user/holdings"
POSITIONS_URL = "https://api.upstox.com/v3/positions"
FUNDS_URL = "https://api.upstox.com/v3/user/get-funds-and-margin"
TRADE_BOOK_URL = "https://api.upstox.com/v2/order/trades"


class UpstoxOrders(BrokerOrders):
    """Upstox order & portfolio management via direct REST calls."""

    def __init__(self, auth: BrokerAuth, symbol_map: BrokerSymbolMap):
        self._auth = auth
        self._symbol_map = symbol_map

    def _headers(self) -> Dict[str, str]:
        h = self._auth.get_headers()
        h["Content-Type"] = "application/json"
        h["Accept"] = "application/json"
        return h

    def _get(self, url: str, params: dict | None = None) -> dict | list | None:
        token = self._auth.get_access_token()
        if not token:
            return None
        try:
            r = requests.get(url, headers=self._headers(), params=params, timeout=30)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and data.get("status") == "success":
                return data.get("data")
            return None
        except requests.RequestException:
            return None

    def place_order(
        self,
        symbol: str,
        transaction_type: str,
        quantity: int,
        **kwargs,
    ) -> Optional[Dict[str, Any]]:
        token = self._auth.get_access_token()
        if not token:
            return None

        instrument_key = self._symbol_map.resolve_token(symbol)
        if not instrument_key:
            return None

        payload = {
            "quantity": quantity,
            "product": kwargs.get("product", "D"),
            "validity": kwargs.get("validity", "DAY"),
            "price": kwargs.get("price", 0),
            "instrument_token": instrument_key,
            "order_type": kwargs.get("order_type", "MARKET"),
            "transaction_type": transaction_type,
            "disclosed_quantity": kwargs.get("disclosed_quantity", 0),
            "trigger_price": kwargs.get("trigger_price", 0),
            "is_amo": kwargs.get("is_amo", False),
            "slice": kwargs.get("slice", True),
            "market_protection": kwargs.get("market_protection", -1),
        }
        tag = kwargs.get("tag")
        if tag:
            payload["tag"] = tag

        try:
            r = requests.post(
                ORDER_URL, headers=self._headers(), json=payload, timeout=30
            )
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            return None

    def modify_order(
        self,
        order_id: str,
        **kwargs,
    ) -> Optional[Dict[str, Any]]:
        token = self._auth.get_access_token()
        if not token:
            return None

        payload = {"order_id": order_id}
        if "quantity" in kwargs:
            payload["quantity"] = kwargs["quantity"]
        if "price" in kwargs:
            payload["price"] = kwargs["price"]
        if "trigger_price" in kwargs:
            payload["trigger_price"] = kwargs["trigger_price"]
        if "order_type" in kwargs:
            payload["order_type"] = kwargs["order_type"]
        if "validity" in kwargs:
            payload["validity"] = kwargs["validity"]

        try:
            r = requests.put(
                ORDER_MODIFY_URL, headers=self._headers(), json=payload, timeout=30
            )
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            return None

    def cancel_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        token = self._auth.get_access_token()
        if not token:
            return None

        try:
            r = requests.delete(
                ORDER_CANCEL_URL,
                headers=self._headers(),
                params={"order_id": order_id},
                timeout=30,
            )
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            return None

    def get_order_book(self) -> Optional[List[Dict[str, Any]]]:
        return self._get(ORDER_BOOK_URL)

    def get_trade_book(self) -> Optional[List[Dict[str, Any]]]:
        return self._get(TRADE_BOOK_URL)

    def get_positions(self) -> Optional[List[Dict[str, Any]]]:
        return self._get(POSITIONS_URL)

    def get_holdings(self) -> Optional[List[Dict[str, Any]]]:
        return self._get(HOLDINGS_URL)

    def get_funds(self) -> Optional[Dict[str, Any]]:
        return self._get(FUNDS_URL)

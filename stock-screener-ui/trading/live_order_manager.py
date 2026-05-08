"""
Live order manager for placing real orders via Upstox API.
Handles entry/exit orders and fill confirmation polling.
"""

import time
from typing import Dict, List, Optional


class LiveOrderManager:
    """Manages live order placement via Upstox API.

    Handles entry and exit order placement, fill confirmation polling,
    and order status tracking.
    """

    def __init__(self, upstox_api):
        self.api = upstox_api
        self._poll_retries = 10
        self._poll_interval = 0.5

    def place_entry_order(
        self,
        symbol: str,
        side: str,
        quantity: int,
        price: float,
        tag: str = "",
    ) -> Optional[Dict]:
        """Place a live entry order (MARKET).

        Checks available funds before placing. Rejects if insufficient.

        Args:
            symbol: Trading symbol (e.g. 'RELIANCE')
            side: 'LONG' for buy, 'SHORT' for sell
            quantity: Number of shares
            price: Reference price (used if order book poll fails)
            tag: Optional identifier (max 40 chars)

        Returns:
            Dict with 'order_id' and 'filled_price', or None on failure
        """
        if not self._check_funds(symbol, side, quantity, price):
            return None

        transaction_type = "BUY" if side == "LONG" else "SELL"
        result = self.api.place_order(
            symbol=symbol,
            transaction_type=transaction_type,
            quantity=quantity,
            order_type="MARKET",
            product="D",
            slice=True,
            tag=tag[:40] if tag else "",
        )
        if not result or result.get("status") != "success":
            return None

        order_ids = result.get("data", {}).get("order_ids", [])
        if not order_ids:
            return None

        order_id = order_ids[0]
        filled_price = self._poll_for_fill(order_id) or price

        return {"order_id": order_id, "filled_price": filled_price}

    def place_exit_order(
        self,
        symbol: str,
        side: str,
        quantity: int,
        tag: str = "",
    ) -> Optional[Dict]:
        """Place a live exit order (MARKET, opposite side of entry).

        Args:
            symbol: Trading symbol
            side: Current position side ('LONG' → SELL, 'SHORT' → BUY)
            quantity: Number of shares to exit
            tag: Optional identifier

        Returns:
            Dict with 'order_id' and 'filled_price', or None on failure
        """
        transaction_type = "SELL" if side == "LONG" else "BUY"
        result = self.api.place_order(
            symbol=symbol,
            transaction_type=transaction_type,
            quantity=quantity,
            order_type="MARKET",
            product="D",
            slice=True,
            tag=tag[:40] if tag else "",
        )
        if not result or result.get("status") != "success":
            return None

        order_ids = result.get("data", {}).get("order_ids", [])
        if not order_ids:
            return None

        order_id = order_ids[0]
        filled_price = self._poll_for_fill(order_id)
        return {"order_id": order_id, "filled_price": filled_price}

    def cancel_order(self, order_id: str) -> bool:
        """Cancel an open/pending order."""
        result = self.api.cancel_order(order_id) if hasattr(self.api, 'cancel_order') else None
        return result is not None and result.get("status") == "success"

    def _poll_for_fill(self, order_id: str) -> Optional[float]:
        """Poll order details to get the average price of a filled order.

        Uses get_order_details (single order by ID) instead of fetching
        the entire order book. Falls back to get_order_book if unavailable.

        Returns average_price or None if not filled within retry limit.
        """
        has_details = hasattr(self.api, 'get_order_details')

        for _ in range(self._poll_retries):
            try:
                if has_details:
                    order = self.api.get_order_details(order_id)
                    if order:
                        status = order.get("status", "")
                        if status == "complete":
                            avg_price = order.get("average_price")
                            if avg_price and float(avg_price) > 0:
                                return float(avg_price)
                        elif status in ("rejected", "cancelled"):
                            return None
                elif hasattr(self.api, 'get_order_book'):
                    orders = self.api.get_order_book()
                    if orders:
                        for order in orders:
                            if order.get("order_id") == order_id:
                                status = order.get("status", "")
                                if status == "complete":
                                    avg_price = order.get("average_price")
                                    if avg_price and float(avg_price) > 0:
                                        return float(avg_price)
                                elif status in ("rejected", "cancelled"):
                                    return None
            except Exception:
                pass
            time.sleep(self._poll_interval)
        return None

    def _check_funds(self, symbol: str, side: str, quantity: int, price: float) -> bool:
        """Check if there are sufficient funds for a trade.

        Uses get_funds() API if available. Returns True if funds check
        passes or if the API is unavailable (graceful degradation).
        """
        if not hasattr(self.api, 'get_funds'):
            return True

        try:
            funds = self.api.get_funds()
            if not funds:
                return True

            equity = None
            if isinstance(funds, dict):
                equity = funds.get('equity')
                if equity and isinstance(equity, dict):
                    available_margin = float(equity.get('available_margin', 0) or 0)
                else:
                    available_margin = float(funds.get('available_margin', 0) or 0)
            else:
                return True

            estimated_cost = quantity * price
            if estimated_cost > available_margin:
                return False
            return True
        except Exception:
            return True

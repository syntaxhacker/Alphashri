from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional

import pandas as pd


class BrokerAuth(ABC):
    """Authentication & token management interface."""

    @abstractmethod
    def authenticate(self) -> bool:
        """Run full OAuth2 flow (browser redirect + code exchange)."""

    @abstractmethod
    def get_access_token(self) -> Optional[str]:
        """Return current access token or None."""

    @abstractmethod
    def validate_token(self) -> bool:
        """Check if the current token is still valid (makes API call)."""

    @abstractmethod
    def refresh_token(self) -> bool:
        """Force re-authentication to get a fresh token."""

    @abstractmethod
    def get_headers(self) -> Dict[str, str]:
        """Return auth headers dict (e.g. {'Authorization': 'Bearer <token>'}).

        Must be safe to call even when access_token is None (returns headers
        without Authorization key or raises a clear error).
        """

    @abstractmethod
    def load_token(self) -> bool:
        """Load persisted token: DB -> file -> env (provider-specific order)."""

    @abstractmethod
    def save_token(self) -> bool:
        """Persist the current access token (file + DB)."""


class BrokerMarketData(ABC):
    """Market data retrieval interface (quotes, OHLCV, option chains)."""

    @abstractmethod
    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict[str, Any]]:
        """Get full market quote for a symbol (OHLC, volume, etc.)."""

    @abstractmethod
    def get_historical_data(
        self,
        symbol: str,
        interval: str,
        from_date: str,
        to_date: str,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        """Get historical OHLCV data for a symbol/date range."""

    @abstractmethod
    def get_intraday_data(
        self,
        symbol: str,
        interval: str,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        """Get today's intraday OHLCV data."""

    @abstractmethod
    def get_instrument_key(
        self,
        symbol: str,
        exchange: str = "NSE_EQ",
        **kwargs,
    ) -> Optional[str]:
        """Resolve symbol/token to broker instrument key."""

    @abstractmethod
    def get_option_chain(
        self,
        underlying: str,
        expiry: str,
    ) -> Optional[Dict[str, Any]]:
        """Get option chain with market data + greeks for an underlying/expiry."""

    @abstractmethod
    def get_spot_price(self, underlying: str) -> Optional[float]:
        """Get current spot price for an index underlying."""


class BrokerOrders(ABC):
    """Order & portfolio management interface."""

    @abstractmethod
    def place_order(
        self,
        symbol: str,
        transaction_type: str,
        quantity: int,
        **kwargs,
    ) -> Optional[Dict[str, Any]]:
        """Place an order and return broker response."""

    @abstractmethod
    def modify_order(
        self,
        order_id: str,
        **kwargs,
    ) -> Optional[Dict[str, Any]]:
        """Modify an existing order."""

    @abstractmethod
    def cancel_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Cancel an order by ID."""

    @abstractmethod
    def get_order_book(self) -> Optional[List[Dict[str, Any]]]:
        """Fetch all orders placed today."""

    @abstractmethod
    def get_trade_book(self) -> Optional[List[Dict[str, Any]]]:
        """Fetch today's trade executions."""

    @abstractmethod
    def get_positions(self) -> Optional[List[Dict[str, Any]]]:
        """Fetch current day trading positions."""

    @abstractmethod
    def get_holdings(self) -> Optional[List[Dict[str, Any]]]:
        """Fetch delivered holdings."""

    @abstractmethod
    def get_funds(self) -> Optional[Dict[str, Any]]:
        """Fetch user fund balance and margin details."""


class BrokerStreaming(ABC):
    """Real-time WebSocket streaming interface."""

    @abstractmethod
    def connect(
        self,
        symbols: List[str],
        callback: Optional[Callable] = None,
    ) -> bool:
        """Connect to market data stream and subscribe to symbols.
        callback receives parsed tick dicts.
        """

    @abstractmethod
    def subscribe(self, symbols: List[str]) -> bool:
        """Add symbols to an active streaming connection."""

    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from market data stream."""

    @abstractmethod
    def is_connected(self) -> bool:
        """Check if streaming connection is active."""

    @abstractmethod
    def get_realtime_price(self, symbol: str) -> Optional[float]:
        """Get latest cached real-time price for a symbol."""


class BrokerSymbolMap(ABC):
    """Symbol/instrument key mapping interface."""

    @abstractmethod
    def to_canonical(self, broker_symbol: str) -> str:
        """Convert broker-specific format to standard format."""

    @abstractmethod
    def to_broker(self, canonical_symbol: str) -> str:
        """Convert standard symbol to broker-specific format."""

    @abstractmethod
    def resolve_token(self, symbol: str, exchange: str = "NSE_EQ") -> Optional[str]:
        """Resolve symbol to numeric/broker token ID."""


class BrokerClient:
    """Composite that bundles all broker interfaces.

    Usage:
        client = BrokerRegistry.get("upstox")
        price = client.market_data.get_quote("RELIANCE")
        client.orders.place_order("RELIANCE", "BUY", 10)
    """

    def __init__(
        self,
        name: str,
        auth: BrokerAuth,
        market_data: BrokerMarketData,
        orders: BrokerOrders,
        streaming: BrokerStreaming,
        symbol_map: BrokerSymbolMap,
    ):
        self.name = name
        self.auth = auth
        self.market_data = market_data
        self.orders = orders
        self.streaming = streaming
        self.symbol_map = symbol_map

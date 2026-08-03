from typing import Callable, Dict, List, Optional

from ..base import BrokerAuth, BrokerStreaming, BrokerSymbolMap


class UpstoxStreaming(BrokerStreaming):
    """Upstox WebSocket streaming via MarketDataStreamerV3."""

    def __init__(self, auth: BrokerAuth, symbol_map: BrokerSymbolMap):
        self._auth = auth
        self._symbol_map = symbol_map
        self._streamer: Optional["MarketDataStreamerV3"] = None
        self._api_client: Optional["ApiClient"] = None
        self._realtime_prices: Dict[str, float] = {}
        self._instrument_to_symbol: Dict[str, str] = {}

    def connect(
        self,
        symbols: List[str],
        callback: Optional[Callable] = None,
    ) -> bool:
        try:
            import upstox_client
        except ImportError:
            return False

        token = self._auth.get_access_token()
        if not token:
            return False

        configuration = upstox_client.Configuration()
        configuration.access_token = token

        instrument_keys = []
        for symbol in symbols:
            key = self._symbol_map.resolve_token(symbol)
            if key:
                instrument_keys.append(key)
                self._instrument_to_symbol[key] = symbol

        if not instrument_keys:
            return False

        self._api_client = upstox_client.ApiClient(configuration)
        self._streamer = upstox_client.MarketDataStreamerV3(
            self._api_client,
            instrument_keys,
            "ltpc",
        )

        if callback:
            self._streamer.on("message", callback)
        else:
            self._streamer.on("message", self._default_tick_handler)

        self._streamer.connect()
        return True

    def subscribe(self, symbols: List[str]) -> bool:
        if not self._streamer:
            return False
        try:
            import upstox_client
            for symbol in symbols:
                key = self._symbol_map.resolve_token(symbol)
                if key:
                    self._instrument_to_symbol[key] = symbol
            return True
        except ImportError:
            return False

    def disconnect(self) -> None:
        if self._streamer:
            try:
                self._streamer.disconnect()
            except Exception:
                pass
            self._streamer = None
            self._api_client = None

    def is_connected(self) -> bool:
        return (
            self._streamer is not None
            and hasattr(self._streamer, "connected")
            and self._streamer.connected
        )

    def get_realtime_price(self, symbol: str) -> Optional[float]:
        key = self._symbol_map.resolve_token(symbol)
        if key and key in self._realtime_prices:
            return self._realtime_prices[key]
        return self._realtime_prices.get(symbol)

    def _default_tick_handler(self, message):
        try:
            if isinstance(message, dict) and "feeds" in message:
                for instrument_key, data in message["feeds"].items():
                    if "ltpc" in data and "ltp" in data["ltpc"]:
                        price = float(data["ltpc"]["ltp"])
                        self._realtime_prices[instrument_key] = price
                        symbol = self._instrument_to_symbol.get(instrument_key)
                        if symbol:
                            self._realtime_prices[symbol] = price
        except Exception:
            pass

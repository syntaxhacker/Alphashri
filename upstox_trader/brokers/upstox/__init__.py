from ..base import BrokerClient
from ..registry import BrokerRegistry
from .auth import UpstoxAuth
from .market_data import UpstoxMarketData
from .orders import UpstoxOrders
from .streaming import UpstoxStreaming
from .mapping import UpstoxSymbolMap


class UpstoxBrokerClient(BrokerClient):
    """Pre-configured Upstox broker client."""

    def __init__(self, name: str = "upstox"):
        auth = UpstoxAuth()
        symbol_map = UpstoxSymbolMap()
        market_data = UpstoxMarketData(auth, symbol_map)
        orders = UpstoxOrders(auth, symbol_map)
        streaming = UpstoxStreaming(auth, symbol_map)

        super().__init__(
            name=name,
            auth=auth,
            market_data=market_data,
            orders=orders,
            streaming=streaming,
            symbol_map=symbol_map,
        )


BrokerRegistry.register("upstox", UpstoxBrokerClient)

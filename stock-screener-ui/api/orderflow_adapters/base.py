"""
Broker-agnostic order-flow feed adapters.

Each adapter turns a broker's raw WebSocket messages into the SAME normalized
tick shape the rest of the pipeline already consumes (journal, signal engine,
recorder, UI). Adding a broker means adding one subclass and registering it.

Normalized tick ``data`` shape:
    {
      "ltp": float, "volume": float, "vwap": float, "ltt": int(ms),
      "ltq": float, "cp": float, "tbq": float, "tsq": float,
      "oi": float, "iv": float, "greeks": dict | None,
      "day": {"open","high","low","close","volume"} | None,
      "depth": {"buy": [{"price","quantity","orders"}], "sell": [...]},
    }
"""

from abc import ABC, abstractmethod
from typing import Callable, Optional

TickCallback = Callable[[str, dict], None]

_REGISTRY: dict[str, type] = {}


def register_adapter(cls: type) -> type:
    """Class decorator adding an adapter to the registry by its ``name``."""
    _REGISTRY[cls.name] = cls
    return cls


def get_adapter(name: str) -> Optional[type]:
    return _REGISTRY.get(name)


def available_adapters() -> list[str]:
    return sorted(_REGISTRY)


def make_depth(levels: list[dict]) -> list[dict]:
    """Normalize one side's levels to ``[{price, quantity, orders}]``."""
    out: list[dict] = []
    for level in levels or []:
        price = float(level.get("price") or 0.0)
        qty = float(level.get("quantity") or 0.0)
        if price > 0 and qty > 0:
            out.append(
                {
                    "price": price,
                    "quantity": qty,
                    "orders": int(level.get("orders") or 0),
                }
            )
    return out


class OrderFlowAdapter(ABC):
    """Base class for a broker's live order-flow feed.

    Subclasses declare the connection/depth capabilities and implement
    :meth:`normalize`. Connection lifecycle (``connect``/``disconnect``) is
    broker-specific and may be overridden; the default raises so subclasses are
    explicit about it.
    """

    name: str = "base"
    depth_levels: int = 5
    max_symbols_per_connection: int = 2000
    max_connections: int = 5
    #: whether per-level resting order counts are available
    has_order_counts: bool = False

    @abstractmethod
    def normalize(self, raw: dict) -> list[tuple[str, dict]]:
        """Map one raw broker message to ``[(broker_symbol, tick_data), ...]``.

        Unknown / non-market messages return an empty list.
        """
        raise NotImplementedError

    def connect(self, symbols, on_tick: TickCallback, on_error=None) -> None:
        """Open the feed and stream normalized ticks (broker-specific)."""
        raise NotImplementedError(f"{self.name} adapter does not implement connect()")

    def disconnect(self) -> None:
        """Tear down the feed (broker-specific)."""
        raise NotImplementedError(f"{self.name} adapter does not implement disconnect()")

    def broker_symbol(self, symbol: str) -> str:
        """Map an app symbol to this broker's symbol format (default: identity)."""
        return symbol

    def subscribe_symbol(self, symbol: str) -> bool:
        """Add one symbol to an already-connected feed.

        Returns ``True`` when the symbol now streams on the existing connection.
        The default refuses, which tells callers to open a new connection; feeds
        that share process-global socket state (Fyers) must override this rather
        than let a second connection exist.
        """
        raise NotImplementedError(f"{self.name} adapter cannot add symbols in place")

    def capabilities(self) -> dict:
        return {
            "name": self.name,
            "depth_levels": self.depth_levels,
            "max_symbols_per_connection": self.max_symbols_per_connection,
            "max_connections": self.max_connections,
            "has_order_counts": self.has_order_counts,
        }

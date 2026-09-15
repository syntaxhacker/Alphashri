"""
Order-flow broker adapters.

Importing this package registers every built-in adapter:

    from api.orderflow_adapters import available_adapters, get_adapter
    available_adapters()          # -> ["fyers", "upstox", ...]
    get_adapter("fyers").depth_levels

See ``base.py`` for the normalized tick contract.
"""

from api.orderflow_adapters.base import (  # noqa: F401
    OrderFlowAdapter,
    available_adapters,
    get_adapter,
    make_depth,
    register_adapter,
)
from api.orderflow_adapters import upstox  # noqa: F401  (registers "upstox")

try:  # Fyers SDK is optional; the adapter module itself has no hard dependency
    from api.orderflow_adapters import fyers  # noqa: F401  (registers "fyers")
except Exception:  # pragma: no cover - defensive
    pass

__all__ = [
    "OrderFlowAdapter",
    "available_adapters",
    "get_adapter",
    "make_depth",
    "register_adapter",
]

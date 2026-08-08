from typing import Dict, Optional, Type

from .base import BrokerClient


class BrokerRegistry:
    """Central registry for broker implementations.

    Brokers register their client classes at import time.
    Application code retrieves broker instances by name.

    Usage:
        # Registration (in broker package __init__.py)
        BrokerRegistry.register("upstox", UpstoxBrokerClient)

        # Retrieval (anywhere in app)
        client = BrokerRegistry.get("upstox")
        client.market_data.get_quote("RELIANCE")
    """

    _client_classes: Dict[str, Type[BrokerClient]] = {}
    _instances: Dict[str, BrokerClient] = {}

    @classmethod
    def register(cls, name: str, client_cls: Type[BrokerClient]) -> None:
        """Register a broker client class by name."""
        cls._client_classes[name] = client_cls

    @classmethod
    def get(cls, name: str) -> BrokerClient:
        """Get a broker client instance (lazy-initialized)."""
        if name not in cls._instances:
            if name not in cls._client_classes:
                raise ValueError(
                    f"Unknown broker '{name}'. "
                    f"Available: {', '.join(cls.available())}"
                )
            cls._instances[name] = cls._client_classes[name](name)
        return cls._instances[name]

    @classmethod
    def available(cls) -> list[str]:
        """Return list of registered broker names."""
        return list(cls._client_classes.keys())

    @classmethod
    def reset(cls, name: Optional[str] = None) -> None:
        """Clear cached instance(s). Useful for testing or re-auth."""
        if name:
            cls._instances.pop(name, None)
        else:
            cls._instances.clear()

    @classmethod
    def create_client(
        cls,
        provider: str,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        quiet: bool = False,
    ) -> BrokerClient:
        """Factory wrapper: create/get broker client with credentials.

        Mirrors the old TradingAPIFactory.create_from_config interface
        for backward compatibility.
        """
        client = cls.get(provider)
        if api_key and api_secret:
            client.auth.api_key = api_key
            client.auth.api_secret = api_secret
        client.auth.quiet = quiet
        return client

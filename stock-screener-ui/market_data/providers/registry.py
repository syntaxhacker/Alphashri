"""Market -> provider selection. Unknown/None markets keep the India path."""

from __future__ import annotations

import inspect
from typing import Callable

import pandas as pd

from .base import MarketDataProvider, ProviderNoData

DEFAULT_MARKET = "india"

ProviderOrFactory = MarketDataProvider | Callable[[], MarketDataProvider]


class _IndiaProvider:
    """Lazy bridge to the unchanged Upstox/NSE chart path."""

    market = "india"
    feed = "upstox"
    delay_label = "live (NSE)"

    def candles(self, symbol: str, timeframe: str) -> pd.DataFrame:
        from market_data import market_data as legacy

        df = legacy.fetch_candles_for_timeframe(symbol, timeframe)
        if df is None or df.empty:
            raise ProviderNoData(f"no India candles for {symbol}/{timeframe}")
        return df

    def quote(self, symbol: str) -> dict | None:
        return None


def _build_usa() -> MarketDataProvider:
    """Alpaca when explicitly configured, otherwise the zero-key Yahoo feed."""
    try:
        from .alpaca import AlpacaProvider

        if AlpacaProvider.configured():
            return AlpacaProvider()
    except Exception:
        pass
    from .yahoo import YahooProvider

    return YahooProvider()


def _default_factories() -> dict[str, Callable[[], MarketDataProvider]]:
    return {"india": _IndiaProvider, "usa": _build_usa}


_factories: dict[str, Callable[[], MarketDataProvider]] = _default_factories()
_instances: dict[str, MarketDataProvider] = {}


def _key(market: str | None) -> str:
    return str(market or DEFAULT_MARKET).strip().lower()


def register_provider(market: str, provider: ProviderOrFactory) -> None:
    """Register an instance or zero-arg factory; replaces any prior entry."""
    key = _key(market)
    _instances.pop(key, None)
    if inspect.isclass(provider) or inspect.isfunction(provider):
        _factories[key] = provider
    else:
        _instances[key] = provider  # type: ignore[assignment]


def provider_for(market: str | None) -> MarketDataProvider:
    """Resolve a provider, falling back to India for None/unknown markets."""
    key = _key(market)
    if key not in _instances and key in _factories:
        _instances[key] = _factories[key]()
    if key in _instances:
        return _instances[key]

    default = _key(DEFAULT_MARKET)
    if default not in _instances and default in _factories:
        _instances[default] = _factories[default]()
    return _instances[default]


def reset_providers() -> None:
    """Restore built-in registrations (test helper)."""
    global _factories, _instances
    _factories = _default_factories()
    _instances = {}

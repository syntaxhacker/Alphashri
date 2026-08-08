"""Legacy UpstoxAPI-compatible adapter that delegates to the broker abstraction.

Allows existing TradingAPIFactory.create_from_config('upstox') users to
automatically use the new broker layer without code changes.
"""
from typing import Any, Callable, Dict, List, Optional

import pandas as pd

from ...config_and_utils.base_api_client import BaseAPIClient
from ..base import BrokerClient


def _to_broker_interval(unit: str, interval: int) -> str:
    """Convert UpstoxAPI (unit, interval) to broker interval string."""
    if unit == "minutes":
        return f"{interval}minute"
    elif unit == "hours":
        return f"{interval * 60}minute"
    elif unit == "days":
        return f"{interval}day"
    elif unit == "weeks":
        return f"{interval}week"
    elif unit == "months":
        return f"{interval}month"
    return "1day"


class UpstoxClientAdapter(BaseAPIClient):
    """Wraps BrokerClient with the legacy UpstoxAPI interface so existing
    code can migrate incrementally.

    Usage (via factory):
        api = TradingAPIFactory.create_from_config("upstox")
        df = api.fetch_historical_data_v3("RELIANCE", "days", 1, "2026-07-15")
    """

    _IS_BROKER_BACKED = True  # replaces isinstance(api, UpstoxAPI) checks

    def __init__(self, client: BrokerClient, quiet: bool = False):
        self.quiet = quiet
        self._client = client
        self.auth_handler = client.auth
        self._instruments_cache: list | None = None

    @property
    def instruments(self) -> list:
        """Lazy-loaded NSE instrument list (mirrors UpstoxAPI.instruments)."""
        if self._instruments_cache is None:
            self._instruments_cache = self._client.symbol_map._load_instruments()
        return self._instruments_cache

    def _download_and_cache_instruments(self):
        """Pre-cache the NSE instrument list."""
        self._client.symbol_map._load_instruments()

    # --- BaseAPIClient abstract methods ---

    def _get_headers(self) -> Dict[str, str]:
        return self._client.auth.get_headers()

    def get_instrument_key(
        self,
        symbol: str,
        exchange: str = "NSE_EQ",
        **kwargs,
    ) -> Optional[str]:
        return self._client.symbol_map.resolve_token(
            symbol=symbol,
            exchange=exchange,
        )

    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        quote = self._client.market_data.get_quote(symbol, **kwargs)
        if quote:
            return quote.get("price") or quote.get("ltp")
        return None

    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict[str, Any]]:
        return self._client.market_data.get_quote(symbol, **kwargs)

    def get_historical_data(
        self,
        symbol: str,
        interval: str,
        from_date: str,
        to_date: str,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        return self._client.market_data.get_historical_data(
            symbol=symbol,
            interval=interval,
            from_date=from_date,
            to_date=to_date,
            **kwargs,
        )

    # --- Legacy UpstoxAPI methods ---

    def fetch_historical_data_v3(
        self,
        symbol: str,
        unit: str,
        interval: int,
        to_date: str,
        from_date: Optional[str] = None,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        broker_interval = _to_broker_interval(unit, interval)
        return self._client.market_data.get_historical_data(
            symbol=symbol,
            interval=broker_interval,
            from_date=from_date or "2000-01-01",
            to_date=to_date,
            **kwargs,
        )

    def fetch_intraday_data_v3(
        self,
        symbol: str,
        interval: str,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        return self._client.market_data.get_intraday_data(
            symbol=symbol,
            interval=interval,
            **kwargs,
        )

    # --- Auth helpers (for token injection) ---

    def load_token(self) -> bool:
        return self._client.auth.load_token()

    def validate_token(self) -> bool:
        return self._client.auth.validate_token()

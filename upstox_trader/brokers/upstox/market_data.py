from typing import Any, Dict, Optional

import httpx
import pandas as pd
import requests

from ..base import BrokerAuth, BrokerMarketData, BrokerSymbolMap
from ...config_and_utils.upstox_api import UpstoxAPI

INSTRUMENT_KEY_MAP = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
}

UPSTOX_BASE_V2 = "https://api.upstox.com/v2"
UPSTOX_BASE_V3 = "https://api.upstox.com/v3"


class UpstoxMarketData(BrokerMarketData):
    """Upstox market data via REST.

    Shares auth state with the parent UpstoxAuth instance so that
    tokens obtained through any flow (OAuth, file, env) are available.
    """

    def __init__(self, auth: BrokerAuth, symbol_map: BrokerSymbolMap):
        self._auth = auth
        self._symbol_map = symbol_map
        self._api: Optional[UpstoxAPI] = None

    def _get_api(self) -> UpstoxAPI:
        if self._api is None:
            key = self._auth.api_key or ""
            secret = self._auth.api_secret or ""
            self._api = UpstoxAPI(
                api_key=key,
                api_secret=secret,
                quiet=self._auth.quiet,
            )
            token = self._auth.get_access_token()
            if token:
                self._api.auth_handler.access_token = token
        return self._api

    def _headers(self) -> Dict[str, str]:
        h = self._auth.get_headers()
        h["Accept"] = "application/json"
        return h

    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict[str, Any]]:
        return self._get_api().get_quote(symbol, **kwargs)

    def get_historical_data(
        self,
        symbol: str,
        interval: str,
        from_date: str,
        to_date: str,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        return self._get_api().fetch_historical_data(
            symbol=symbol,
            interval=interval,
            from_date=from_date,
            to_date=to_date,
            **kwargs,
        )

    def get_intraday_data(
        self,
        symbol: str,
        interval: str,
        **kwargs,
    ) -> Optional[pd.DataFrame]:
        return self._get_api().fetch_intraday_data_v3(
            symbol=symbol,
            interval=interval,
            **kwargs,
        )

    def get_instrument_key(
        self,
        symbol: str,
        exchange: str = "NSE_EQ",
        **kwargs,
    ) -> Optional[str]:
        return self._get_api().get_instrument_key(
            symbol=symbol,
            exchange=exchange,
            **kwargs,
        )

    def get_option_chain(
        self,
        underlying: str,
        expiry: str,
    ) -> Optional[Dict[str, Any]]:
        token = self._auth.get_access_token()
        if not token:
            return None

        instrument_key = INSTRUMENT_KEY_MAP.get(
            underlying, f"NSE_INDEX|{underlying}"
        )

        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(
                    f"{UPSTOX_BASE_V2}/option/chain",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                    params={
                        "instrument_key": instrument_key,
                        "expiry_date": expiry,
                    },
                )
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return None

    def get_spot_price(self, underlying: str) -> Optional[float]:
        token = self._auth.get_access_token()
        if not token:
            return None

        instrument_key = INSTRUMENT_KEY_MAP.get(
            underlying, f"NSE_INDEX|{underlying}"
        )

        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(
                    f"{UPSTOX_BASE_V2}/market-quote/ohlc",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json",
                    },
                    params={
                        "instrument_key": instrument_key,
                        "interval": "1d",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                if data.get("status") == "success" and data.get("data"):
                    key = list(data["data"].keys())[0]
                    return float(data["data"][key].get("last_price", 0))
                return None
        except Exception:
            return None

"""
Authentication, token management, and instrument resolution for INDMoney.
"""

from pathlib import Path
from typing import Dict, Optional

import pandas as pd
import requests

from ..base_api_client import BaseAPIClient
from ..token_manager import TokenManager


class AuthMixin:
    """
    Mixin providing authentication, token management, instrument caching,
    and error handling for INDMoney API.
    """

    BASE_URL = "https://api.indstocks.com"
    WS_BASE_URL = "wss://api.indstocks.com"
    INSTRUMENT_CACHE_FILE = Path(__file__).resolve().parent.parent / "ind_instruments.json"
    TOKEN_FILE = Path(__file__).resolve().parent.parent / "indmoney_token.json"
    TOKEN_URL = "https://www.indstocks.com/app/api-trading"
    TOKEN_EXPIRY_HOURS = 24

    def _init_auth(self, access_token: str):
        self.access_token = access_token
        self.instruments_df = None

        self.token_manager = TokenManager(
            token_file=self.TOKEN_FILE,
            expiry_hours=self.TOKEN_EXPIRY_HOURS,
            quiet=self._quiet
        )

        self.token_manager._save_token_metadata(
            partial_token=access_token[:20] + '...' if access_token else None
        )

    def _get_headers(self) -> Dict[str, str]:
        self.token_manager.check_token_validity(
            provider_name="INDMoney",
            token_url=self.TOKEN_URL
        )

        return {
            'Authorization': self.access_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

    def _handle_api_error(self, response, symbol: str = None):
        if response.status_code == 401:
            self._log_error("❌ INDMoney authentication failed (401)")
            self._log_error(f"🔑 Your token may have expired or is invalid")
            self._log_error(f"⏰ Token age: {self.token_manager.get_token_age_hours():.1f} hours (24h validity)")
            self._log_error(f"🔑 Get new token at: {self.TOKEN_URL}")
            raise ValueError(
                "INDMoney authentication failed. Your access token may be invalid or expired. "
                f"Please generate a new token from {self.TOKEN_URL} "
                "and update your config.py"
            )
        elif response.status_code == 403:
            self._log_error("❌ INDMoney access forbidden (403)")
            self._log_error("🌐 Your IP may not be whitelisted. Configure static IP in INDMoney settings.")
            raise ValueError(
                "INDMoney access forbidden. Please ensure your IP is whitelisted at "
                f"{self.TOKEN_URL} (click hexagon icon next to 'New Token')"
            )

    def _download_and_cache_instruments(self):
        self._log(f"⬇️ Downloading INDMoney instrument list...")
        try:
            url = f"{self.BASE_URL}/market/instruments?source=equity"
            response = requests.get(url, headers=self._get_headers(), timeout=30)
            response.raise_for_status()

            with open(self.INSTRUMENT_CACHE_FILE, 'wb') as f:
                f.write(response.content)

            self.instruments_df = pd.read_csv(self.INSTRUMENT_CACHE_FILE)
            self._log(f"✅ INDMoney instrument list cached at {self.INSTRUMENT_CACHE_FILE}.")
        except Exception as e:
            self._log(f"❌ Failed to download INDMoney instruments: {e}")

    def get_instrument_key(self, symbol: str, exchange: str = "NSE") -> Optional[str]:
        if self.instruments_df is None:
            if self.INSTRUMENT_CACHE_FILE.exists():
                try:
                    self.instruments_df = pd.read_csv(self.INSTRUMENT_CACHE_FILE)
                except:
                    self._download_and_cache_instruments()
            else:
                self._download_and_cache_instruments()

        if self.instruments_df is None or self.instruments_df.empty:
            return None

        exch = "NSE" if "NSE" in exchange.upper() else "BSE"

        match = self.instruments_df[
            (self.instruments_df['TRADING_SYMBOL'] == symbol.upper()) &
            (self.instruments_df['EXCH'] == exch)
        ]

        if not match.empty:
            security_id = match.iloc[0]['SECURITY_ID']
            return f"{exch}_{security_id}"

        return None

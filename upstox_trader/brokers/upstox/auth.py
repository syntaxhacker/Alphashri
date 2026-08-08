from typing import Dict, Optional

from ..base import BrokerAuth
from ...config_and_utils.upstox_auth import UpstoxAuthHandler


class UpstoxAuth(BrokerAuth):
    """Upstox OAuth2 authentication.
    Delegates to the existing UpstoxAuthHandler.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        quiet: bool = False,
    ):
        self.api_key = api_key
        self.api_secret = api_secret
        self.quiet = quiet
        self._handler: Optional[UpstoxAuthHandler] = None
        self.load_token()

    @staticmethod
    def _load_config():
        try:
            from config import UPSTOX_CONFIG
            return UPSTOX_CONFIG
        except ImportError:
            try:
                from upstox_trader.config import UPSTOX_CONFIG
                return UPSTOX_CONFIG
            except ImportError:
                return {}

    def _get_handler(self) -> UpstoxAuthHandler:
        if self._handler is None:
            cfg = self._load_config()
            key = self.api_key or cfg.get("api_key") or ""
            secret = self.api_secret or cfg.get("api_secret") or ""
            self._handler = UpstoxAuthHandler(key, secret, quiet=self.quiet)
        return self._handler

    @property
    def access_token(self) -> Optional[str]:
        return self._get_handler().access_token

    @access_token.setter
    def access_token(self, value: Optional[str]) -> None:
        self._get_handler().access_token = value

    def authenticate(self) -> bool:
        return self._get_handler().authenticate()

    def get_access_token(self) -> Optional[str]:
        return self._get_handler().access_token

    def validate_token(self) -> bool:
        return self._get_handler().validate_token()

    def refresh_token(self) -> bool:
        return self._get_handler().refresh_token()

    def get_headers(self) -> Dict[str, str]:
        return self._get_handler().get_headers()

    def load_token(self) -> bool:
        return self._get_handler().load_token()

    def save_token(self) -> bool:
        return self._get_handler().save_token()

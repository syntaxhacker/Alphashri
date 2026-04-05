"""
Utilities for backtest strategies.
"""
import os
from typing import Optional, Tuple


def _get_api_credentials() -> Tuple[Optional[str], Optional[str]]:
    key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
    secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not key or not secret:
        return None, "UPSTOX_API_KEY and UPSTOX_API_SECRET environment variables are not set"
    return key, secret


def get_upstox_client_from_db(quiet: bool = True):
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI

    _api_key, _error = _get_api_credentials()
    if not _api_key:
        return None, _error

    _api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not _api_secret:
        return None, "UPSTOX_API_SECRET environment variable is not set"

    try:
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token('upstox')

        if not token_data or not token_data.get('access_token'):
            return None, "No active Upstox broker connection. Please connect your broker in Settings."

        client = UpstoxAPI(api_key=_api_key, api_secret=_api_secret, quiet=quiet)
        client.auth_handler.access_token = token_data['access_token']

        return client, None

    except Exception as e:
        return None, f"Failed to initialize Upstox client: {str(e)}"


def get_upstox_client_with_token(access_token: str, quiet: bool = True):
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI

    _api_key, _error = _get_api_credentials()
    if not _api_key:
        return None, _error

    _api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not _api_secret:
        return None, "UPSTOX_API_SECRET environment variable is not set"

    if not access_token:
        return None, "No access token provided and no broker connection found"

    try:
        client = UpstoxAPI(api_key=_api_key, api_secret=_api_secret, quiet=quiet)
        client.auth_handler.access_token = access_token

        return client, None

    except Exception as e:
        return None, f"Failed to initialize Upstox client: {str(e)}"

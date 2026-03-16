"""
Utilities for backtest strategies.
"""
import os
from typing import Optional, Tuple

_api_key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
_api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")


def get_upstox_client_from_db(quiet: bool = True):
    """
    Get an authenticated UpstoxAPI client using token from database.
    
    This is the preferred way to get an Upstox client in production,
    as it uses tokens stored via OAuth flow rather than file-based tokens.
    
    Args:
        quiet: If True, suppress console output
        
    Returns:
        Tuple of (UpstoxAPI client, error message or None)
    """
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    
    if not _api_key or not _api_secret:
        return None, "UPSTOX_API_KEY and UPSTOX_API_SECRET must be set"
    
    try:
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token('upstox')
        
        if not token_data or not token_data.get('access_token'):
            return None, "Upstox not connected. Please connect your broker."
        
        client = UpstoxAPI(api_key=_api_key, api_secret=_api_secret, quiet=quiet)
        client.auth_handler.access_token = token_data['access_token']
        
        return client, None
        
    except Exception as e:
        return None, f"Failed to initialize Upstox client: {str(e)}"


def get_upstox_client_with_token(access_token: str, quiet: bool = True):
    """
    Get an authenticated UpstoxAPI client with a provided access token.
    
    Args:
        access_token: The Upstox access token
        quiet: If True, suppress console output
        
    Returns:
        Tuple of (UpstoxAPI client, error message or None)
    """
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    
    if not _api_key or not _api_secret:
        return None, "UPSTOX_API_KEY and UPSTOX_API_SECRET must be set"
    
    try:
        client = UpstoxAPI(api_key=_api_key, api_secret=_api_secret, quiet=quiet)
        client.auth_handler.access_token = access_token
        
        return client, None
        
    except Exception as e:
        return None, f"Failed to initialize Upstox client: {str(e)}"

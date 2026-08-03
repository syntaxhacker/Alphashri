#!/usr/bin/env python3
"""
🇮🇳 Enhanced Upstox API Connector with Real-Time Streaming

A comprehensive Upstox API connector that combines:
- OAuth2 authentication with persistent tokens
- Historical data fetching (V2 & V3 APIs)
- Real-time WebSocket streaming for tick-by-tick data
- Seamless integration with old_tv_screen.py and other trading applications

This module is provided for backward compatibility.
All classes and functions have been moved to modular components:
- token_manager.py: TokenManager class
- base_api_client.py: BaseAPIClient abstract class
- upstox_api.py: UpstoxAPI class
- indmoney_api.py: INDMONEYApi class
- websocket_utils.py: WebSocket utilities and helpers
- api_helpers.py: Helper functions and constants
"""

import warnings
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import pandas as pd
import requests

from ..brokers import BrokerClient, BrokerRegistry
from ..brokers.upstox.adapter import UpstoxClientAdapter

from .api_helpers import (
    API_VERSION,
    BASE_URL,
    INSTRUMENT_CACHE_FILE,
    INSTRUMENT_LIST_URL,
    ORDER_URL,
    create_upstox_auth,
    get_valid_symbol,
)
from .base_api_client import BaseAPIClient
from .indmoney_api import INDMONEYApi
from .token_manager import TokenManager
from .upstox_api import UpstoxAPI as _UpstoxAPIDirect
from .websocket_utils import (
    WEBSOCKET_CLIENT_AVAILABLE,
    WEBSOCKETS_AVAILABLE,
    MarketHoursChecker,
    WebSocketConnectionManager,
    is_market_open,
)

try:
    import upstox_client
    UPSTOX_SDK_AVAILABLE = True
except ImportError:
    UPSTOX_SDK_AVAILABLE = False

warnings.filterwarnings('ignore')


def UpstoxAPI(
    api_key: str,
    api_secret: str,
    quiet: bool = False,
) -> "UpstoxClientAdapter":
    """Broker-backed replacement for the old UpstoxAPI constructor.

    All argument signatures match the original UpstoxAPI.__init__.
    Returns an UpstoxClientAdapter that delegates to the broker layer.
    """
    client = BrokerRegistry.get("upstox")
    client.auth.api_key = api_key
    client.auth.api_secret = api_secret
    client.auth.quiet = quiet
    client.auth.load_token()
    return UpstoxClientAdapter(client, quiet=quiet)


class TradingAPIFactory:
    """
    Factory class for creating trading API client instances.

    Implements the Factory Pattern to provide a unified interface for creating
    different API client instances (Upstox, INDMoney, etc.) based on configuration.
    """

    SUPPORTED_PROVIDERS = ['upstox', 'indmoney']

    @classmethod
    def create_client(cls, provider: str, **kwargs) -> BaseAPIClient:
        """
        Create an API client instance for the specified provider.

        Args:
            provider (str): The API provider name ('upstox' or 'indmoney')
            **kwargs: Provider-specific credentials

        Returns:
            BaseAPIClient: An instance of the appropriate API client
        """
        provider_lower = provider.lower()

        if provider_lower not in cls.SUPPORTED_PROVIDERS:
            raise ValueError(
                f"Unsupported provider '{provider}'. "
                f"Supported providers: {', '.join(cls.SUPPORTED_PROVIDERS)}"
            )

        quiet = kwargs.get('quiet', False)

        if provider_lower == 'upstox':
            api_key = kwargs.get('api_key')
            api_secret = kwargs.get('api_secret')

            if not api_key or not api_secret:
                raise ValueError(
                    "Upstox client requires 'api_key' and 'api_secret' parameters"
                )

            return UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=quiet)

        elif provider_lower == 'indmoney':
            access_token = kwargs.get('access_token')

            if not access_token:
                raise ValueError(
                    "INDMoney client requires 'access_token' parameter"
                )

            return INDMONEYApi(access_token=access_token, quiet=quiet)

    @classmethod
    def create_broker(cls, provider: str, quiet: bool = False) -> BrokerClient:
        """Create a broker client using the new abstraction layer.

        Preferred over create_client/create_from_config for new code.
        Returns a BrokerClient composite with .auth, .market_data, .orders, .streaming.
        """
        client = BrokerRegistry.get(provider)
        client.auth.quiet = quiet
        return client

    @classmethod
    def create_from_config(cls, provider: str, quiet: bool = False) -> BaseAPIClient:
        """Create an API client using credentials from the global config."""
        try:
            from upstox_trader.config import UPSTOX_CONFIG, INDMONEY_CONFIG
        except ImportError:
            raise ValueError(
                "config.py not found in upstox_trader module. "
                "Please create it with your API credentials."
            )

        provider_lower = provider.lower()

        if provider_lower == 'upstox':
            if not UPSTOX_CONFIG.get('api_key') or not UPSTOX_CONFIG.get('api_secret'):
                raise ValueError(
                    "UPSTOX_CONFIG not properly configured. "
                    "Please set 'api_key' and 'api_secret' in config.py"
                )

            client = BrokerRegistry.get('upstox')
            client.auth.api_key = UPSTOX_CONFIG['api_key']
            client.auth.api_secret = UPSTOX_CONFIG['api_secret']
            client.auth.quiet = quiet
            client.auth.load_token()
            return UpstoxClientAdapter(client, quiet=quiet)

        elif provider_lower == 'indmoney':
            if not INDMONEY_CONFIG.get('access_token'):
                raise ValueError(
                    "INDMONEY_CONFIG not properly configured. "
                    "Please set 'access_token' in config.py"
                )

            return INDMONEYApi(
                access_token=INDMONEY_CONFIG['access_token'],
                quiet=quiet
            )

        else:
            raise ValueError(
                f"Unsupported provider '{provider}'. "
                f"Supported providers: {', '.join(cls.SUPPORTED_PROVIDERS)}"
            )


def main():
    """Example usage of the UpstoxAPI class."""
    try:
        from upstox_trader.config import UPSTOX_CONFIG
    except ImportError:
        print("❌ config.py not found. Please create it with your Upstox API credentials.")
        return

    if not (UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret')):
        print("❌ Please set your UPSTOX_CONFIG in config.py")
        return

    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])

    if not api.auth_handler.access_token:
        print("\n🚀 Starting authentication process...")
        if not api.auth_handler.authenticate():
            print("\nAuthentication failed. Exiting.")
            return

    print("\n--- Example 1: Fetching Daily Data for TATAMOTORS ---")
    to_date = datetime.now().strftime("%Y-%m-%d")
    from_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    tatamotors_df = api.fetch_historical_data(
        symbol="TATAMOTORS",
        interval="day",
        from_date=from_date,
        to_date=to_date
    )

    if tatamotors_df is not None and not tatamotors_df.empty:
        print("\n📈 TATAMOTORS Last 5 Days:")
        print(tatamotors_df.tail())
        print(f"\nAverage volume over 90 days: {tatamotors_df['volume'].mean():,.0f}")

    print("\n--- Example 2: Fetching Today's 1-Minute Intraday Data for RELIANCE ---")

    reliance_df = api.fetch_intraday_data_v3(
        symbol="RELIANCE",
        interval='1'
    )

    if reliance_df is not None and not reliance_df.empty:
        print("\n📊 RELIANCE Today's Data:")
        print(f"Records: {len(reliance_df)}")
        print("Last 5 records:")
        print(reliance_df.tail())
    else:
        print("\n⚠️ No intraday data available for RELIANCE today.")

    print("\n--- Example 4: Enhanced Features Demo ---")

    print("🔑 Testing token validation...")
    is_token_valid = api.auth_handler.validate_token()
    print(f"   Token valid: {is_token_valid}")

    print("🕐 Checking market hours...")
    is_market_open_result = api._is_market_open()
    print(f"   Market open: {is_market_open_result}")

    if UPSTOX_SDK_AVAILABLE:
        print("\n🔗 Setting up real-time streaming for RELIANCE and TCS...")

        def sample_tick_handler(message):
            """Sample tick handler for demonstration"""
            if isinstance(message, dict) and 'feeds' in message:
                for instrument_key, data in message['feeds'].items():
                    if 'ltpc' in data and 'ltp' in data['ltpc']:
                        price = float(data['ltpc']['ltp'])
                        print(f"📈 Real-time tick: {instrument_key} -> ₹{price}")

        streaming_success = api.setup_realtime_streaming(
            symbols=["RELIANCE", "TCS"],
            callback=sample_tick_handler
        )

        if streaming_success:
            print("✅ Real-time streaming setup successful!")
            print("🚀 Starting streaming for 10 seconds...")

            api.start_realtime_streaming()

            import time
            time.sleep(10)

            api.stop_realtime_streaming()
            print("⏹️ Real-time streaming stopped")

            print(f"📊 Streaming active: {api.is_streaming_active()}")

        else:
            print("⚠️ Real-time streaming setup failed - check token and market hours")
            print("💡 Make sure your access token is valid and market is open")
    else:
        print("⚠️ Real-time streaming not available (install upstox-python-sdk)")
        print("💡 Run: pip install upstox-python-sdk")


if __name__ == "__main__":
    main()

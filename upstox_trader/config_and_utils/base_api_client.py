"""
Abstract base class for trading API clients.
"""

from abc import ABC, abstractmethod
from typing import Dict, Optional

import pandas as pd


class BaseAPIClient(ABC):
    """
    Abstract base class for trading API clients.

    Provides common functionality for all API clients including:
    - Quiet mode for console output suppression
    - Common error handling patterns
    - Unified interface for easy provider switching
    """

    def __init__(self, quiet: bool = False):
        """
        Initialize the base API client.

        Args:
            quiet (bool): If True, suppresses console output. Default is False.
        """
        self.quiet = quiet
        self.instruments = None

    @abstractmethod
    def _get_headers(self) -> Dict[str, str]:
        """
        Construct headers for API calls.

        Returns:
            Dict[str, str]: Headers dictionary
        """
        pass

    @abstractmethod
    def get_instrument_key(self, symbol: str, **kwargs) -> Optional[str]:
        """
        Fetch the instrument key for a given symbol.

        Args:
            symbol: Stock symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            Instrument key or None if not found
        """
        pass

    @abstractmethod
    def get_price(self, symbol: str, **kwargs) -> Optional[float]:
        """
        Get current/last traded price for a symbol.

        Args:
            symbol: Stock symbol (e.g., 'RELIANCE', 'TCS')
            **kwargs: Provider-specific parameters

        Returns:
            Current price as float or None if unavailable
        """
        pass

    @abstractmethod
    def get_quote(self, symbol: str, **kwargs) -> Optional[Dict]:
        """
        Get full market quote for a symbol (OHLC, volume, etc.).

        Args:
            symbol: Stock symbol
            **kwargs: Provider-specific parameters

        Returns:
            Dictionary with quote data or None if unavailable
        """
        pass

    def get_historical_data(self, symbol: str, interval: str,
                           from_date: str, to_date: str, **kwargs) -> Optional[pd.DataFrame]:
        """
        Get historical OHLCV data for a symbol.

        Args:
            symbol: Stock symbol
            interval: Time interval (e.g., 'day', '1minute', '5minute')
            from_date: Start date (YYYY-MM-DD)
            to_date: End date (YYYY-MM-DD)
            **kwargs: Provider-specific parameters

        Returns:
            DataFrame with OHLCV data or None if unavailable
        """
        raise NotImplementedError(f"{self.__class__.__name__} does not support historical data")

    def _log(self, message: str):
        """
        Log a message if quiet mode is disabled.

        Args:
            message: Message to log
        """
        if not self.quiet:
            print(message)

    def _log_error(self, message: str):
        """
        Log an error message (always shown regardless of quiet mode).

        Args:
            message: Error message to log
        """
        print(message)

"""
Base Strategy Class

Abstract interface for all trading strategies.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class StrategyParam:
    """Configuration parameter for a strategy."""
    key: str
    label: str
    type: str  # 'number', 'select', 'boolean'
    default: Any
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[List[str]] = None

    def to_dict(self):
        return asdict(self)


class BaseStrategy(ABC):
    """Abstract base class for all trading strategies."""

    @classmethod
    @abstractmethod
    def get_name(cls) -> str:
        """Return strategy display name."""
        pass

    @classmethod
    @abstractmethod
    def get_description(cls) -> str:
        """Return strategy description."""
        pass

    @classmethod
    @abstractmethod
    def get_params(cls) -> List[StrategyParam]:
        """Return list of configurable parameters."""
        pass

    @abstractmethod
    def validate_params(self, params: Dict) -> List[str]:
        """
        Validate strategy parameters.

        Returns:
            List of error messages (empty if valid)
        """
        pass

    @abstractmethod
    def run(self, symbols: List[str], days: int, params: Dict,
            progress_callback=None) -> Dict:
        """
        Run backtest for given symbols and parameters.

        Args:
            symbols: List of stock symbols to backtest
            days: Number of days of historical data
            params: Strategy-specific parameters
            progress_callback: Optional callback for progress updates

        Returns:
            Dict with results, chart_data, and metadata
        """
        pass

    def get_default_params(self) -> Dict:
        """Get default parameter values."""
        return {p.key: p.default for p in self.get_params()}

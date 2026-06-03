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

    def get_visuals(self, trades: List[Dict], params: Dict) -> List[Dict]:
        """
        Return a list of chart visuals (overlays) for the given trades.
        Each overlay is a dict with type, id, label, color, levels, etc.
        """
        return []

    def get_default_params(self) -> Dict:
        """Get default parameter values."""
        return {p.key: p.default for p in self.get_params()}


# =============================================================================
# 52W Nautilus strategy shared support (DRY between week52_chaser.py and week52_target.py)
# Added here (edit of existing base.py) per guidelines to avoid creating new files.
# =============================================================================

import sys
from typing import Optional, List, Dict, Any
from datetime import datetime

# Soft import nautilus bits so base.py remains importable without nautilus (e.g. for registry)
try:
    from nautilus_trader.trading.strategy import Strategy
    from nautilus_trader.config import StrategyConfig
    from nautilus_trader.model.enums import OrderSide
    from nautilus_trader.model.objects import Quantity
    _NAUTILUS_AVAILABLE = True
except ImportError:
    Strategy = object  # type: ignore
    StrategyConfig = object  # type: ignore
    OrderSide = None  # type: ignore
    Quantity = None  # type: ignore
    _NAUTILUS_AVAILABLE = False

# We also soft-import pandas only when needed inside methods (to keep top level light)
# from trading.week52_utils import ... will be done inside methods to avoid cycles / dep order


class Week52NautilusMixin:
    """
    Mixin with common 52W boilerplate for Nautilus-based strategies.

    - Uses Week52HighTracker for 52W state/calc (shared with live utils).
    - Common _enter_long / _exit_long (with params to handle slight reset diffs).
    - Cooldown / bar counting helpers.
    - State reset helpers.

    Subclasses are responsible for:
      * Declaring their specific state attributes (to preserve test pokes on _in_position, _52w_high vs _current_52w_high, _price_history, _trailing_stop_active etc.)
      * Implementing strategy-specific on_bar entry/exit *conditions*
      * Calling the mixin's update_ helpers and enter/exit helpers from their on_bar

    This removes ~20-50 line duplicated blocks without changing public API or behavior.
    """

    # --- 52W tracking (delegates to shared tracker, syncs legacy names for test compat) ---

    def _init_52w_tracker(self, min_periods: int = 20) -> None:
        from trading.week52_utils import Week52HighTracker
        self._52w_tracker = Week52HighTracker(period=252, min_periods=min_periods)
        # Initialize legacy containers so direct access in tests and on_reset work
        if not hasattr(self, '_high_prices') or self._high_prices is None:
            self._high_prices: List[float] = []
        if not hasattr(self, '_price_history') or self._price_history is None:
            self._price_history: List[float] = []
        if not hasattr(self, '_current_52w_high'):
            self._current_52w_high: Optional[float] = None
        if not hasattr(self, '_52w_high'):
            self._52w_high: Optional[float] = None

    def _update_52w_high(self, high_price: float) -> Optional[float]:
        """Update shared tracker and sync to whatever legacy names the subclass declared."""
        if not hasattr(self, '_52w_tracker') or self._52w_tracker is None:
            self._init_52w_tracker()
        tracker = self._52w_tracker
        # Support tests that manually poke _price_history/_high_prices (and _52w_high) before on_bar
        # Seed tracker from the poked history if tracker is empty (common in exit unit tests).
        if len(getattr(tracker, '_high_prices', [])) == 0:
            hist = None
            if hasattr(self, '_price_history') and self._price_history:
                hist = self._price_history
            elif hasattr(self, '_high_prices') and self._high_prices:
                hist = self._high_prices
            if hist:
                for h in hist:
                    tracker._high_prices.append(float(h))
                if len(tracker._high_prices) > tracker.period:
                    tracker._high_prices[:] = tracker._high_prices[-tracker.period:]
        val = tracker.update(high_price)
        # sync lists (use same list object for efficiency where possible)
        if hasattr(self, '_high_prices'):
            self._high_prices = tracker._high_prices
        if hasattr(self, '_price_history'):
            self._price_history = tracker._high_prices
        # sync current value to both common names
        if hasattr(self, '_current_52w_high'):
            self._current_52w_high = val
        if hasattr(self, '_52w_high'):
            self._52w_high = val
        return val

    # --- Cooldown / bar counting (common pattern) ---
    # Note: original chaser and target had slightly different inc/check ordering;
    # we provide primitives so each can preserve its exact prior behavior.

    def _is_in_cooldown(self) -> bool:
        """Pure check (no mutation)."""
        cooldown_bars = getattr(self, '_cooldown_bars', getattr(self, '_cooldown_days', 30))
        return getattr(self, '_bars_since_exit', 0) < cooldown_bars

    def _increment_cooldown_if_not_in_position(self) -> None:
        if not getattr(self, '_in_position', False):
            self._bars_since_exit = getattr(self, '_bars_since_exit', 0) + 1

    # --- Common enter / exit with configurability for per-strategy diffs ---

    def _common_enter_long(self, price: float, high_52w: Optional[float], bar_time: datetime) -> None:
        """Shared order submit + state setup. Subclasses call this then tweak specifics if needed."""
        if not _NAUTILUS_AVAILABLE:
            raise RuntimeError("Nautilus not available")

        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=OrderSide.BUY,
            quantity=Quantity.from_str(str(self._trade_size)),
        )
        self.submit_order(order)

        price_f = float(price)
        high_f = float(high_52w) if high_52w is not None else None

        self._entry_price = price_f
        self._entry_52w_high = high_f
        self._highest_price_since_entry = price_f
        self._bars_in_trade = 0
        self._in_position = True
        self._current_entry_time = bar_time
        if hasattr(self, '_entry_time'):
            self._entry_time = bar_time
        self._bars_since_exit = 0

        # chaser specific
        if hasattr(self, '_trailing_stop_active'):
            self._trailing_stop_active = False

    def _common_exit_long(self, price: float, reason: str, bar_time: datetime, *, reset_cooldown_to: int = 0) -> None:
        """
        Shared P&L calc, trade recording, close, state reset.
        reset_cooldown_to allows target (1) vs chaser (0) slight timing diff to be preserved.
        """
        if not getattr(self, '_in_position', False):
            return

        price_f = float(price)
        entry_price = float(self._entry_price) if self._entry_price is not None else 0.0
        trade_size = getattr(self, '_trade_size', 100)

        # Close first (matches both impls order)
        self.close_all_positions(self._instrument_id)

        gross_pnl = (price_f - entry_price) * trade_size
        pnl_pct = ((price_f - entry_price) / entry_price) * 100 if entry_price > 0 else 0.0

        # Local import to avoid top-level backtest dep issues
        from ..costs import calculate_trading_costs
        costs = calculate_trading_costs(entry_price, price_f, trade_size)

        net_pnl = gross_pnl - costs['total_costs']
        net_pnl_pct = (net_pnl / (entry_price * trade_size)) * 100 if entry_price > 0 else 0.0

        hold_days = getattr(self, '_bars_in_trade', 0)

        entry_time = getattr(self, '_current_entry_time', None) or getattr(self, '_entry_time', None)
        entry_date_str = entry_time.strftime('%Y-%m-%dT%H:%M') if entry_time else bar_time.strftime('%Y-%m-%dT%H:%M')
        entry_date_only = entry_time.strftime('%Y-%m-%d') if entry_time else bar_time.strftime('%Y-%m-%d')

        trade_record: Dict[str, Any] = {
            'entry_price': round(entry_price, 2),
            'exit_price': round(price_f, 2),
            'entry_time': entry_date_str,
            'exit_time': bar_time.strftime('%Y-%m-%dT%H:%M'),
            'quantity': trade_size,
            'gross_pnl': round(gross_pnl, 2),
            'gross_pnl_pct': round(pnl_pct, 2),
            'trading_costs': round(costs['total_costs'], 2),
            'net_pnl': round(net_pnl, 2),
            'net_pnl_pct': round(net_pnl_pct, 2),
            'exit_reason': reason,
            'hold_duration_minutes': hold_days * 24 * 60,
            'date': entry_date_only,
            'side': 'LONG',
        }

        # Strategy-specific extra fields (preserve exact output shape and key names)
        # Chaser declares _trailing_stop_active -> gets '52w_high' + 'trailing_active'
        # Target does not -> gets '52w_high_entry' (exact prior shape)
        entry_52w = getattr(self, '_entry_52w_high', None)
        val = round(entry_52w, 2) if entry_52w is not None else None
        if hasattr(self, '_trailing_stop_active'):
            trade_record['52w_high'] = val
            trade_record['trailing_active'] = bool(getattr(self, '_trailing_stop_active', False))
        else:
            trade_record['52w_high_entry'] = val

        if not hasattr(self, 'trades') or self.trades is None:
            self.trades = []
        self.trades.append(trade_record)

        # Reset common state
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._in_position = False
        self._current_entry_time = None
        if hasattr(self, '_entry_time'):
            self._entry_time = None
        self._bars_since_exit = reset_cooldown_to
        if hasattr(self, '_trailing_stop_active'):
            self._trailing_stop_active = False

    # --- Reset helpers (called from on_reset) ---

    def _reset_52w_common(self) -> None:
        if hasattr(self, '_52w_tracker') and self._52w_tracker is not None:
            self._52w_tracker.reset()
        if hasattr(self, '_high_prices'):
            self._high_prices = []
        if hasattr(self, '_price_history'):
            self._price_history = []
        if hasattr(self, '_current_52w_high'):
            self._current_52w_high = None
        if hasattr(self, '_52w_high'):
            self._52w_high = None

    def _reset_common_state(self) -> None:
        """Reset fields that both strategies share. Safe to call from on_reset."""
        self._in_position = False
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._bars_since_exit = 0
        self._current_entry_time = None
        if hasattr(self, '_entry_time'):
            self._entry_time = None
        if hasattr(self, '_trailing_stop_active'):
            self._trailing_stop_active = False
        self._reset_52w_common()
        if hasattr(self, 'trades'):
            # do not clear trades on reset typically; on_stop etc handle
            pass

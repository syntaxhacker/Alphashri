"""
Paper Trading Engine - Simulated trading with virtual money.

This module provides a paper trading environment for testing strategies
before risking real capital.
"""

import sys
from pathlib import Path
from typing import Dict, Optional

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from trading.paper import (
    PaperTrader,
    PaperOrder,
    PaperPosition,
    PaperTrade,
    OrderSide,
    OrderStatus,
    ExitReason,
)

try:
    from trading.config_loader import get_strategy_config
    _config_available = True
except ImportError:
    _config_available = False

_paper_traders: Dict[int, PaperTrader] = {}
_default_paper_trader: Optional[PaperTrader] = None


def get_paper_trader(
    user_id: Optional[int] = None,
    initial_capital: Optional[float] = None,
    strategy_id: int = 0,
    strategy_name: str = "",
    config_name: str = None,
) -> PaperTrader:
    """
    Get paper trader instance for a specific user.

    Args:
        user_id: User ID. If None, returns the default (legacy) instance.
        initial_capital: Initial capital for new traders.
        strategy_id: ID of the strategy to use for tracking trades.
        strategy_name: Name of the strategy for quick reference.
        config_name: Name of config to load from database.

    Returns:
        PaperTrader instance for the user.
    """
    global _default_paper_trader

    if user_id is None:
        if _default_paper_trader is None:
            _default_paper_trader = PaperTrader(
                initial_capital=initial_capital or 1_000_000,
                strategy_id=strategy_id,
                strategy_name=strategy_name,
                config_name=config_name,
            )
        return _default_paper_trader

    if user_id not in _paper_traders:
        if initial_capital is None:
            try:
                from db.database import SessionLocal
                from db.models import User
                with SessionLocal() as db:
                    user = db.query(User).filter(User.id == user_id).first()
                    initial_capital = user.initial_capital if user else 1_000_000
            except Exception:
                initial_capital = 1_000_000

        _paper_traders[user_id] = PaperTrader(
            initial_capital=initial_capital,
            user_id=user_id,
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            config_name=config_name,
        )

    return _paper_traders[user_id]


def reset_paper_trader(user_id: Optional[int] = None, capital: float = 1_000_000):
    """
    Reset paper trader with new capital.

    Args:
        user_id: User ID. If None, resets the default instance.
        capital: New initial capital.
    """
    global _default_paper_trader

    if user_id is None:
        _default_paper_trader = PaperTrader(initial_capital=capital)
        return _default_paper_trader

    _paper_traders[user_id] = PaperTrader(initial_capital=capital, user_id=user_id)
    return _paper_traders[user_id]


def clear_paper_trader(user_id: int):
    """Clear a user's paper trader instance (e.g., on logout)."""
    if user_id in _paper_traders:
        del _paper_traders[user_id]


if __name__ == '__main__':
    trader = PaperTrader(initial_capital=1_000_000)
    trader.display_status()

    order = trader.place_order(
        symbol="NETWEB",
        side=OrderSide.BUY,
        quantity=100,
        price=3500.0,
        stop_loss=3360.0,
        take_profit=3920.0,
    )

    trader.display_status()

    trader.update_prices({"NETWEB": 3925.0})

    trader.display_status()

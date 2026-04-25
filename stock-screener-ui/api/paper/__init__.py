"""
Paper Trading API - Modular package.
"""

from .paper_api import router, _get_user_id, _get_bot_status

from .requests import (
    OrderRequest,
    ClosePositionRequest,
    ResetRequest,
    UpdatePricesRequest,
)

from .portfolio import get_portfolio, get_positions, update_prices
from .orders import place_order, close_position, close_all_positions
from .bot_control import (
    get_paper_bot_status,
    get_paper_bot_snapshot,
    start_paper_bot,
    stop_paper_bot,
)
from .history import get_trades, delete_trade, get_journal_summary

__all__ = [
    "router",
    "OrderRequest",
    "ClosePositionRequest",
    "ResetRequest",
    "UpdatePricesRequest",
]

"""
Paper Trading API - Endpoints for paper trading operations.

This module provides REST API endpoints for:
- Portfolio management
- Order placement
- Signal generation
- Trade history

Backward compatibility: This module re-exports from the modular paper/ package.
"""

import subprocess
from pathlib import Path
from typing import Optional

from trading.paper_trader import get_paper_trader, reset_paper_trader
from trading.risk_manager import get_risk_manager
from trading.journal import get_journal
from api.paper.paper_api import (
    router,
    _paper_bot_process,
    _paper_bot_log_file,
    _paper_bot_pid_file,
    _write_runner_pid_file,
    _clear_runner_pid_file,
    _is_pid_alive,
    _read_runner_pid_file,
)
from api.paper.portfolio import get_portfolio, get_positions, update_prices
from api.paper.orders import place_order, close_position, close_all_positions
from api.paper.bot_control import (
    get_paper_bot_status,
    start_paper_bot,
    stop_paper_bot,
)
from api.paper.history import (
    get_trades,
    delete_trade,
    get_journal_summary,
    get_symbol_performance,
    get_daily_report,
    export_journal,
)
from api.paper.endpoints import (
    get_signals,
    create_signal,
    get_risk_config,
    validate_trade,
    health_check,
    get_paper_chart,
    get_strategy_config_endpoint,
    update_strategy_config_endpoint,
    reset_strategy_config_endpoint,
)
from api.paper.analytics import get_analytics
from api.paper.activity import get_activity_feed, push_event
from api.paper.aggregated import get_aggregated_dashboard
from api.paper.requests import (
    OrderRequest,
    ClosePositionRequest,
    ResetRequest,
    UpdatePricesRequest,
    StrategyConfigUpdate,
)
from api.paper.paper_api import _get_user_id, _get_symbol_trades_from_db

__all__ = [
    "router",
    "OrderRequest",
    "ClosePositionRequest",
    "ResetRequest",
    "UpdatePricesRequest",
    "StrategyConfigUpdate",
    "get_portfolio",
    "get_positions",
    "update_prices",
    "place_order",
    "close_position",
    "close_all_positions",
    "get_paper_bot_status",
    "start_paper_bot",
    "stop_paper_bot",
    "get_trades",
    "delete_trade",
    "get_journal_summary",
    "get_symbol_performance",
    "get_daily_report",
    "export_journal",
    "get_signals",
    "create_signal",
    "get_risk_config",
    "validate_trade",
    "health_check",
    "get_paper_chart",
    "get_strategy_config_endpoint",
    "update_strategy_config_endpoint",
    "reset_strategy_config_endpoint",
    "_get_user_id",
    "get_paper_trader",
    "reset_paper_trader",
    "get_risk_manager",
    "get_journal",
    "_paper_bot_process",
    "_paper_bot_log_file",
    "_paper_bot_pid_file",
    "_write_runner_pid_file",
    "_clear_runner_pid_file",
    "_is_pid_alive",
    "_read_runner_pid_file",
    "_get_symbol_trades_from_db",
]

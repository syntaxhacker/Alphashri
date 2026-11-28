"""Behavior-neutral boilerplate shared by the 52W backtest strategies.

Only module bootstrap, trade-stat aggregation and the empty-result payload live
here. Entry/exit math and the per-strategy result shapes stay in the strategy
modules: chaser and target intentionally differ there.
"""

import os
import sys
from typing import Any, Dict, List, Optional


def add_project_root_to_path(module_file: str) -> str:
    """Make the project root importable for ``config`` / ``trading`` from a strategy file."""
    current_file_dir = os.path.dirname(os.path.abspath(module_file))
    backtest_dir = os.path.dirname(current_file_dir)
    ui_dir = os.path.dirname(backtest_dir)
    project_root_dir = os.path.dirname(ui_dir)
    if project_root_dir not in sys.path:
        sys.path.insert(0, project_root_dir)
    return project_root_dir


# The strategy modules call this too, but config must be importable before they
# finish evaluating their own imports.
add_project_root_to_path(__file__)

import config

IST = config.IST

# Both strategies bind their Nautilus base classes at import time; the sim shim
# installs the nautilus_trader modules before either strategy is imported.
try:
    from nautilus_trader.model import BarType, InstrumentId
    from nautilus_trader.trading.strategy import Strategy
    from nautilus_trader.config import StrategyConfig
    _NAUTILUS_AVAILABLE = True
except ImportError:
    Strategy = object  # type: ignore
    StrategyConfig = object  # type: ignore
    BarType = None  # type: ignore
    InstrumentId = None  # type: ignore
    _NAUTILUS_AVAILABLE = False

if not _NAUTILUS_AVAILABLE:
    class _SafeNautilusBase: pass
    Strategy = _SafeNautilusBase


def get_broker_access_token() -> Optional[str]:
    """Resolve the shared Upstox token; the import stays here so patches still apply."""
    from db.models import get_shared_broker_token

    token_data = get_shared_broker_token('upstox')
    return token_data.get('access_token') if token_data else None


def summarize_trades(trades: List[Dict], include_costs: bool) -> Dict[str, Any]:
    """Raw per-run trade stats; each strategy applies its own rounding and key set."""
    gross_pnl = sum(t['gross_pnl'] for t in trades)
    total_costs = sum(t['trading_costs'] for t in trades) if include_costs else 0
    net_pnl = gross_pnl - total_costs

    wins = sum(1 for t in trades if t['net_pnl'] > 0)
    losses = sum(1 for t in trades if t['net_pnl'] < 0)
    total_trades = wins + losses
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    gross_profits = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
    gross_losses = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] < 0))
    profit_factor = gross_profits / gross_losses if gross_losses > 0 else float('inf') if gross_profits > 0 else 0

    return {
        'gross_pnl': gross_pnl,
        'total_costs': total_costs,
        'net_pnl': net_pnl,
        'wins': wins,
        'losses': losses,
        'total_trades': total_trades,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
    }


def empty_backtest_result(symbol: str, df_for_backtest) -> Dict[str, Any]:
    """Shared success/no-trade payload used before and after the cutoff filter."""
    from backtest.utils import build_candle_data

    return {
        'symbol': symbol,
        'success': True,
        'trades': 0,
        'result': None,
        'candles': build_candle_data(df_for_backtest),
    }

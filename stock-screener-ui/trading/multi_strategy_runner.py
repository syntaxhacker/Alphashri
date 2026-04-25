"""
Multi-Strategy Runner - Orchestrates multiple trading strategies in parallel.

This module provides:
- Parallel execution of multiple strategies
- Shared portfolio management
- Cross-strategy risk coordination
- Unified signal generation and execution

Backward-compatibility module that re-exports from modular components.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scanners'))

import trading.runner_core
import trading.strategy_runner
import trading.orb_signals
import trading.shared_portfolio
import trading.journal

MultiStrategyRunner = trading.runner_core.MultiStrategyRunner
create_multi_strategy_runner = trading.runner_core.create_multi_strategy_runner
StrategyRunner = trading.strategy_runner.StrategyRunner
INTRADAY_STRATEGY_TYPES = trading.strategy_runner.INTRADAY_STRATEGY_TYPES
SWING_STRATEGY_TYPES = trading.strategy_runner.SWING_STRATEGY_TYPES
ORBSignal = trading.orb_signals.ORBSignal
SignalType = trading.orb_signals.SignalType
OrderSide = trading.shared_portfolio.OrderSide
SharedPortfolioManager = trading.shared_portfolio.SharedPortfolioManager
get_journal = trading.journal.get_journal

_db_available = False
SessionLocal = None
BotConfig = None
StrategyConfig = None
bot_strategies = None
try:
    import db.database
    import db.models
    SessionLocal = db.database.SessionLocal
    BotConfig = db.models.BotConfig
    StrategyConfig = db.models.StrategyConfig
    bot_strategies = db.models.bot_strategies
    _db_available = True
except ImportError:
    pass

__all__ = [
    'StrategyRunner',
    'MultiStrategyRunner',
    'create_multi_strategy_runner',
    'INTRADAY_STRATEGY_TYPES',
    'SWING_STRATEGY_TYPES',
    'ORBSignal',
    'SignalType',
    'OrderSide',
    'SharedPortfolioManager',
    'get_journal',
    'SessionLocal',
    'BotConfig',
    'StrategyConfig',
    'bot_strategies',
]
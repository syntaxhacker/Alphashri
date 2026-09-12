"""
Trading Strategies for Backtesting

Available strategies:
- ORB: Opening Range Breakout
- SR Breakout: Support & Resistance Breakout using Pivot Points
- 52W Chaser: 52-Week High Breakout (Swing Trading)
- 52W Target: Hold until 52W High reached
- EMA Cross: Exponential Moving Average Crossover
"""

from .base import BaseStrategy, StrategyParam


class _LazyStrategy:
    """Lazily import a strategy class on first access."""

    def __init__(self, module: str, cls: str):
        self._module = module
        self._cls = cls
        self._resolved = None

    def _resolve(self):
        if self._resolved is None:
            import importlib
            mod = importlib.import_module(f'.{self._module}', package=__package__)
            self._resolved = getattr(mod, self._cls)
        return self._resolved

    def __getattr__(self, name):
        return getattr(self._resolve(), name)

    def __call__(self, *args, **kwargs):
        return self._resolve()(*args, **kwargs)


# Strategy registry — lazy-loaded to avoid importing nautilus_trader at import time
STRATEGIES = {
    'orb': _LazyStrategy('orb', 'ORBStrategy'),
    'sr_breakout': _LazyStrategy('sr_breakout', 'SRBreakoutStrategy'),
    '52w_chaser': _LazyStrategy('week52_chaser', 'Week52ChaserStrategy'),
    '52w_target': _LazyStrategy('week52_target', 'Week52TargetStrategy'),
    'ema_cross': _LazyStrategy('ema_cross', 'EMACrossStrategy'),
    'smc': _LazyStrategy('smc', 'SMCStrategy'),
}


def get_strategy(strategy_id: str):
    """Get strategy class by ID."""
    return STRATEGIES.get(strategy_id)


def list_strategies():
    """List all available strategies with their metadata.

    A single strategy whose module fails to import (e.g. optional Nautilus deps
    missing, or a test stubbing ``nautilus_trader``) is skipped instead of taking
    down the whole listing endpoint.
    """
    out = []
    for strategy_id, strategy_class in STRATEGIES.items():
        try:
            out.append({
                'id': strategy_id,
                'name': strategy_class.get_name(),
                'description': strategy_class.get_description(),
                'params': [p.__dict__ for p in strategy_class.get_params()],
            })
        except Exception as e:  # noqa: BLE001 — one bad strategy must not break the listing
            print(f"⚠️ Skipping backtest strategy {strategy_id!r}: {e}")
    return out


__all__ = [
    'BaseStrategy',
    'StrategyParam',
    'STRATEGIES',
    'get_strategy',
    'list_strategies',
]

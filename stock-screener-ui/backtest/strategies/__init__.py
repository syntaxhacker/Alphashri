"""
Trading Strategies for Backtesting

Available strategies:
- ORB: Opening Range Breakout
- SR Breakout: Support & Resistance Breakout using Pivot Points
- 52W Chaser: 52-Week High Breakout (Swing Trading)
- 52W Target: Hold until 52W High reached
- EMA Cross: Exponential Moving Average Crossover
"""

import importlib.util
import os

# The engine must be chosen before any strategy module is imported: the sim shim
# injects nautilus_trader stand-ins into sys.modules, and each strategy binds its
# base classes at import time. sim is the default and needs no external package;
# nautilus is kept as an opt-in for A/B against the real engine.
_ENGINE = os.environ.get("BACKTEST_ENGINE", "sim")
if _ENGINE not in ("nautilus", "sim"):
    raise RuntimeError(
        f"BACKTEST_ENGINE must be 'nautilus' or 'sim', got {_ENGINE!r}"
    )
if _ENGINE == "sim":
    from backtest.sim import install as _install_sim

    _install_sim()
elif importlib.util.find_spec("nautilus_trader") is None:
    raise RuntimeError(
        "BACKTEST_ENGINE=nautilus requires nautilus_trader, which is not installed. "
        "Use the default sim engine, or reinstall the package to A/B against it."
    )

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
    # Week-42 new-pattern research variants (pure-pandas daily, no nautilus).
    'accum_breakout': _LazyStrategy('new_patterns_week42', 'AccumBreakoutStrategy'),
    'accum_adx_gated': _LazyStrategy('new_patterns_week42', 'AccumAdxGatedStrategy'),
    'gap_and_go': _LazyStrategy('new_patterns_week42', 'GapAndGoStrategy'),
    'high52w_vol': _LazyStrategy('new_patterns_week42', 'High52WVolStrategy'),
    'failed_breakdown': _LazyStrategy('new_patterns_week42', 'FailedBreakdownStrategy'),
    'ema_stack': _LazyStrategy('new_patterns_week42', 'EmaStackBreakoutStrategy'),
    'ema_stack_nogate': _LazyStrategy('new_patterns_week42', 'EmaStackNoGateStrategy'),
    'adx_breakout': _LazyStrategy('new_patterns_week42', 'AdxBreakoutStrategy'),
    'adx_breakout_nogate': _LazyStrategy('new_patterns_week42', 'AdxBreakoutNoGateStrategy'),
    'rsi_thrust': _LazyStrategy('new_patterns_week42', 'RsiThrustStrategy'),
    'base_20d': _LazyStrategy('new_patterns_week42', 'Base20dBreakoutStrategy'),
    'base_52w': _LazyStrategy('new_patterns_week42', 'Base52wProximityStrategy'),
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

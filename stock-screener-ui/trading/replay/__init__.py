"""Tick-replay strategy plugin registry.

Importing this package populates the global registry with the built-in engines.
Adding a future strategy only requires a new engine module here plus one import
line below.
"""
from trading.replay.contract import ParamSpec, ReplayContext, ReplayStrategy, StrategyResult
from trading.replay.engines import (
    INTRADAY_ENGINES,
    SWING_ENGINES,
    SmcChopReplay,
    SmcIfvgReplay,
    VwapOrbReplay,
    Week52ChaserReplay,
)
from trading.replay.registry import STRATEGIES, get, list_strategies, register

# Data-source-specific engines (each owns or shares its loader).
register(VwapOrbReplay())
register(SmcIfvgReplay())
register(Week52ChaserReplay())
register(SmcChopReplay())

# Generic engines driven by configuration (composition over inheritance).
for _engine in INTRADAY_ENGINES:
    register(_engine)
for _engine in SWING_ENGINES:
    register(_engine)

__all__ = [
    "STRATEGIES",
    "ParamSpec",
    "ReplayContext",
    "ReplayStrategy",
    "SmcChopReplay",
    "SmcIfvgReplay",
    "StrategyResult",
    "VwapOrbReplay",
    "Week52ChaserReplay",
    "get",
    "list_strategies",
    "register",
]

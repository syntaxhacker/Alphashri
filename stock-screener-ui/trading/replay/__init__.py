"""Tick-replay strategy plugin registry.

Importing this package populates the global registry with the built-in engines.
Adding a future strategy only requires a new engine module here plus one import
line below.
"""
from trading.replay.contract import ParamSpec, ReplayContext, ReplayStrategy, StrategyResult
from trading.replay.engines import SmcIfvgReplay, VwapOrbReplay
from trading.replay.registry import STRATEGIES, get, list_strategies, register

register(VwapOrbReplay())
register(SmcIfvgReplay())

__all__ = [
    "STRATEGIES",
    "ParamSpec",
    "ReplayContext",
    "ReplayStrategy",
    "SmcIfvgReplay",
    "StrategyResult",
    "VwapOrbReplay",
    "get",
    "list_strategies",
    "register",
]

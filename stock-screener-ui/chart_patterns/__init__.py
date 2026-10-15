"""Chart-pattern detection package.

Public surface:
    timeframes.TIMEFRAMES / get_timeframe
    engine.detect_patterns
    universes.get_universe / list_universes
    detectors.common.PatternHit / DETECTORS
"""

from .timeframes import TIMEFRAMES, TIMEFRAME_IDS, TFSpec, get_timeframe
from .engine import detect_patterns
from .universes import get_universe, list_universes

__all__ = [
    "TIMEFRAMES",
    "TIMEFRAME_IDS",
    "TFSpec",
    "get_timeframe",
    "detect_patterns",
    "get_universe",
    "list_universes",
]

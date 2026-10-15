"""Detector package.

Importing this package imports every family module, which self-registers each
detector into :data:`chart_patterns.detectors.common.DETECTORS`.
"""

from . import common, consolidation, continuation, curve_cup, reversal  # noqa: F401
from .common import DETECTORS, PatternHit, PATTERN_CATALOG, register

__all__ = ["DETECTORS", "PatternHit", "PATTERN_CATALOG", "register"]

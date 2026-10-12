"""Replay-facing indicator facade.

No indicator math lives here — everything delegates to ``trading.indicators``
(the single source of truth). Kept as the stable import surface for replay engines.
"""
from __future__ import annotations

from trading.indicators import adx, atr_pct, rsi  # noqa: F401  (re-exported for engines)

__all__ = ["mean", "rsi", "adx", "atr_pct"]


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0

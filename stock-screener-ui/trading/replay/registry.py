"""In-process registry of replay strategy engines.

Engines register themselves on import (see ``trading/replay/__init__.py``).
"""
from __future__ import annotations

from trading.replay.contract import ReplayStrategy

STRATEGIES: dict[str, ReplayStrategy] = {}


def register(strategy: ReplayStrategy) -> ReplayStrategy:
    """Register a strategy instance. Raises ``ValueError`` on duplicate id."""
    strategy_id = getattr(strategy, "id", None)
    if not strategy_id:
        raise ValueError("strategy must define a non-empty 'id'")
    if strategy_id in STRATEGIES:
        raise ValueError(f"duplicate strategy id: {strategy_id}")
    STRATEGIES[strategy_id] = strategy
    return strategy


def get(strategy_id: str) -> ReplayStrategy | None:
    return STRATEGIES.get(strategy_id)


def list_strategies() -> list[dict]:
    return [
        {"id": s.id, "label": s.label, "params": [p.to_dict() for p in s.params]}
        for s in STRATEGIES.values()
    ]

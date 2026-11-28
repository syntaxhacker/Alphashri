"""Fibonacci retracement levels from LuxAlgo's ``ict.pine`` (CC BY-NC-SA 4.0).

Pine lines 957-1119 draw the 0/0.236/0.382/0.5/0.618/0.786/1 levels along the
line joining two anchors (zigzag, OB or liquidity). The arithmetic is
``_0 + (_1 - _0) * ratio``; for a swing low-to-high pair that is
``low + (high - low) * ratio``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

FIB_RATIOS: tuple[tuple[str, float], ...] = (
    ("0", 0.0),
    ("0.236", 0.236),
    ("0.382", 0.382),
    ("0.5", 0.5),
    ("0.618", 0.618),
    ("0.786", 0.786),
    ("1", 1.0),
)

_IDX_KEYS = ("idx", "x", "bar_index", "index", "i", "swing_low_idx", "swing_high_idx")
_PRICE_KEYS = ("price", "y", "value", "level", "low", "high")
_HIGH_WORDS = {1, "1", "high", "ph", "pivothigh", "swing_high", "buyside"}
_LOW_WORDS = {-1, "-1", "low", "pl", "pivotlow", "swing_low", "sellside"}


def _field(obj: Any, names: Sequence[str], default: Any = None) -> Any:
    for name in names:
        if isinstance(obj, Mapping) and name in obj:
            return obj[name]
        if hasattr(obj, name):
            return getattr(obj, name)
    return default


def _direction(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if value in _HIGH_WORDS:
        return 1
    if value in _LOW_WORDS:
        return -1
    return None


def _pivot(obj: Any) -> tuple[int, float, int] | None:
    if isinstance(obj, (tuple, list)) and len(obj) >= 3:
        first, second, third = obj[0], obj[1], obj[2]
        if _direction(first) is not None and isinstance(second, (int, float)):
            direction = _direction(first)
            idx, price = int(second), float(third)
        else:
            idx, price, direction = int(first), float(second), _direction(third)
        return (idx, price, direction) if direction is not None else None
    idx = _field(obj, _IDX_KEYS)
    price = _field(obj, _PRICE_KEYS)
    direction = _direction(_field(obj, ("direction", "d", "side", "type")))
    if idx is None or price is None or direction is None:
        return None
    return int(idx), float(price), direction


def fib_levels(low: float, high: float) -> dict[str, float]:
    """Seven retracement prices between ``low`` and ``high``."""
    spread = float(high) - float(low)
    return {name: round(float(low) + spread * ratio, 10) for name, ratio in FIB_RATIOS}


def fib_from_swings(swings: Sequence[Any]) -> list[dict[str, Any]]:
    """Pair adjacent opposite-direction swings and attach their fib levels.

    Accepts zigzag pivots (``idx``/``price``/``direction`` or
    ``(idx, price, direction)``) as well as already-paired dicts carrying
    ``swing_low_idx``, ``swing_high_idx``, ``low`` and ``high``.
    """
    points = [p for p in (_pivot(item) for item in swings) if p is not None]
    by_idx = {idx: price for idx, price, _ in points}

    explicit: list[dict[str, Any]] = []
    for item in swings:
        if not isinstance(item, Mapping):
            continue
        low_idx = item.get("swing_low_idx")
        high_idx = item.get("swing_high_idx")
        if low_idx is None or high_idx is None:
            continue
        low_price = item.get("low", item.get("swing_low", by_idx.get(int(low_idx))))
        high_price = item.get("high", item.get("swing_high", by_idx.get(int(high_idx))))
        if low_price is None or high_price is None:
            continue
        explicit.append({
            "swing_low_idx": int(low_idx),
            "swing_high_idx": int(high_idx),
            "levels": fib_levels(float(low_price), float(high_price)),
        })
    if explicit:
        return explicit

    points.sort(key=lambda p: p[0])
    result: list[dict[str, Any]] = []
    for (a_idx, a_price, a_dir), (b_idx, b_price, b_dir) in zip(points, points[1:]):
        if a_dir == b_dir:
            continue
        low_idx, low_price, high_idx, high_price = (
            (a_idx, a_price, b_idx, b_price) if a_price <= b_price
            else (b_idx, b_price, a_idx, a_price)
        )
        result.append({
            "swing_low_idx": low_idx,
            "swing_high_idx": high_idx,
            "levels": fib_levels(low_price, high_price),
        })
    return result

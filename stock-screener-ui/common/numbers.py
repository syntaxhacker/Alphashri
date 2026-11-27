"""Stdlib-only numeric coercion shared by api, trading and scripts.

This module deliberately imports neither api, db nor trading: DB-free leaf
packages (``trading.week52``) and standalone scripts must be able to use the
same coercion rules without pulling those layers in.
"""
import math
from typing import Any, Optional


def to_float(value: Any, default: float = 0.0) -> float:
    """Finite float or ``default`` (None/invalid/NaN/Inf/exception -> default)."""
    try:
        if value is None:
            return default
        out = float(value)
        if not math.isfinite(out):
            return default
        return out
    except Exception:
        return default


def optional_float(value: Any, *, reject_bool: bool = False) -> Optional[float]:
    """Finite float or ``None``; ``reject_bool`` guards TV boolean placeholders."""
    if value is None or (reject_bool and isinstance(value, bool)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


# finite_or_none has always had optional_float's semantics (nullable fields, no
# default substitution, no bool guard), so both names share one function object.
finite_or_none = optional_float

__all__ = ["to_float", "optional_float", "finite_or_none"]

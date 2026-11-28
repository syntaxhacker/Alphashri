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


# Callers historically disagreed on bool/NaN/inf: some rejected bool outright,
# some kept inf, some kept every non-finite value. Those rules stay here as
# named variants so each caller keeps its own contract without owning a body.
def strict_float(value: Any, default: float = 0.0) -> float:
    """Finite float or ``default``; bool is invalid (TV true/false placeholders)."""
    if isinstance(value, bool):
        return default
    return to_float(value, default)


def float_or_default(value: Any, default: float = 0.0) -> float:
    """``float(value)`` or ``default``; NaN/inf are kept as-is."""
    try:
        return float(value)
    except Exception:
        return default


def nan_guarded_float(value: Any, default: float = 0.0) -> float:
    """``float(value)`` or ``default``; NaN falls back, inf is kept as-is."""
    try:
        out = float(value)
    except Exception:
        return default
    return default if math.isnan(out) else out


def strict_optional_float(value: Any) -> Optional[float]:
    """Nullable finite float; bool is invalid (TV true/false placeholders)."""
    return optional_float(value, reject_bool=True)


__all__ = [
    "to_float", "optional_float", "finite_or_none",
    "strict_float", "float_or_default", "nan_guarded_float", "strict_optional_float",
]

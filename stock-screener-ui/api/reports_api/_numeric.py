"""One home for the reporting backend's safe numeric parsing.

``api/reports_api`` grew a private ``_f`` / ``_safe_float`` / ``_safe_int`` in
almost every module, each with slightly different semantics (some defaulted
to ``0.0`` and rejected non-finite values, some defaulted to ``None`` and
kept ``inf``). The helpers below are the canonical definitions; modules
import them instead of re-implementing the casts.

Contract:

* :func:`safe_float` — ``float(value)``; unparseable **or non-finite** ->
  ``default``. Use for money/counts where a NaN would poison every aggregate
  it touches (and Starlette serialises with ``allow_nan=False``, so one NaN
  turns a whole response into a 500).
* :func:`safe_int` — ``int(float(value))``; unparseable -> ``default``.
* :func:`safe_opt_float` — ``float(value)``; unparseable -> ``default``
  (``None`` by default). Non-finite values are **kept** — use it for metrics
  where ``inf`` is meaningful.
"""

from __future__ import annotations

import math
from typing import Any, Optional

__all__ = ["safe_float", "safe_int", "safe_opt_float"]


def safe_float(value: Any, default: float = 0.0) -> float:
    """``float(value)`` or ``default``; NaN/inf fall back to ``default``."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def safe_int(value: Any, default: int = 0) -> int:
    """``int(float(value))`` or ``default``."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def safe_opt_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    """``float(value)`` or ``default``; non-finite values are kept as-is."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

"""One home for the reporting backend's safe numeric parsing.

``api/reports_api`` grew a private ``_f`` / ``_safe_float`` / ``_safe_int`` in
almost every module, each with slightly different semantics. ``safe_float``
now delegates to the canonical finite-or-default rule in ``common.numbers``;
only the int and nullable-keep-inf casts still live here because no canonical
helper covers their contract.

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

from typing import Any, Optional

from common.numbers import to_float

__all__ = ["safe_float", "safe_int", "safe_opt_float"]


safe_float = to_float


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

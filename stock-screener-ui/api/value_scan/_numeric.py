"""One home for the Deep Value scanner's numeric parsing.

``scoring.py``, ``filters.py`` and ``router.py`` each carried their own
``_num``; two of them were byte-identical and the third differed only in
accepting numeric strings. The canonical helpers live here:

* :func:`num` — strict: ``int``/``float`` only, non-finite -> ``None``.
  Booleans are rejected (a bool is not a number).
* :func:`num_or_none` — permissive: numeric strings are accepted too.
"""

from __future__ import annotations

import math
from typing import Any, Optional

__all__ = ["num", "num_or_none"]


def num(value: object) -> Optional[float]:
    """Finite float, or ``None`` when the value is unknown."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        result = float(value)
        if math.isnan(result) or math.isinf(result):
            return None
        return result
    return None


def num_or_none(value: Any) -> Optional[float]:
    """Finite float (numeric strings allowed), or ``None``."""
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result

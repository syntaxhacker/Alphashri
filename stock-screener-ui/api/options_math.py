"""Shared put/call ratio maths for the options analytics and report routes.

One definition of the desk-standard PCR (``pe / ce``) so the chain, dashboard
and report payloads cannot drift on the sentinel or the precision. The helper
returns the **raw, unrounded** ratio (or ``None`` when there is no usable call
base); each caller rounds / maps the sentinel at its own presentation layer so
its published payload shape stays unchanged.
"""

from __future__ import annotations

import math
from typing import Optional

__all__ = ["put_call"]


def put_call(ce: Optional[float], pe: Optional[float]) -> Optional[float]:
    """Desk-standard put/call ratio ``pe / ce``; ``None`` when CE is absent/0.

    A missing CE is unknown data and a zero CE is a real but unusable
    denominator — neither may be rendered as a ratio. The result is left
    unrounded: rounding belongs to each caller's presentation layer.
    """
    if ce is None or pe is None:
        return None
    try:
        ce_f, pe_f = float(ce), float(pe)
    except (TypeError, ValueError, OverflowError):
        return None
    if not (math.isfinite(ce_f) and math.isfinite(pe_f)) or ce_f <= 0:
        return None
    ratio = pe_f / ce_f
    return ratio if math.isfinite(ratio) else None

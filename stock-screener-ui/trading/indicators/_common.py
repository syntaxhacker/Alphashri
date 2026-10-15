"""Input/output shaping for the indicator package (single responsibility).

Callers pass either a ``pandas.Series`` (they want a Series back, index-aligned)
or a plain ``Sequence[float]`` (they want a ``float`` latest value, or a list when
``full=True``). This module owns that contract so the family modules stay thin.
"""
from __future__ import annotations

from typing import Optional, Sequence, Union

import pandas as pd

SeriesLike = Union[pd.Series, Sequence[float]]


def as_series(values: SeriesLike) -> tuple[pd.Series, bool]:
    """Return ``(series, was_series)``; a Series keeps its index, a list gets a RangeIndex."""
    if isinstance(values, pd.Series):
        return values.astype("float64"), True
    return pd.Series(list(values), dtype="float64"), False


def shape(out: Optional[pd.Series], was_series: bool, full: bool, n: Optional[int] = None):
    """Shape a computed Series to what the caller asked for.

    - Series input  -> Series (same index)
    - full=True     -> list aligned to input, NaN warm-up converted to None
    - otherwise     -> float latest value (0.0 when undefined)

    ``out`` is ``None`` when the underlying library rejects short input; in that
    case a full list is padded with ``None`` so the length still matches the input.
    """
    if out is None:
        if was_series:
            return pd.Series(dtype="float64")
        return [None] * (n or 0) if full else 0.0
    if was_series:
        return out
    if full:
        return [None if pd.isna(v) else float(v) for v in out.tolist()]
    if out.empty or pd.isna(out.iloc[-1]):
        return 0.0
    return float(out.iloc[-1])

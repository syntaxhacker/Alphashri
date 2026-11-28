"""Pure helpers mirroring the price math in the read-only root ``ict.pine``.

All line references in this module point to that file.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class SwingPoint:
    """A confirmed pivot (ict.pine:327-331).

    ``idx`` is the pivot bar; ``confirmed_idx`` is the bar on which Pine could
    first see it, always ``idx + lookback`` for ``swings()``.
    """

    idx: int
    price: float
    kind: str
    confirmed_idx: int


def true_range(df: pd.DataFrame) -> pd.Series:
    """True range feeding ``ta.atr(10)`` (ict.pine:121).

    Pine's ``ta.tr`` has no previous close on bar 0, where it equals high-low.
    """
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.rename("true_range")


def body(df: pd.DataFrame) -> pd.Series:
    """``body = math.abs(close - open)`` (ict.pine:129)."""
    return (df["close"] - df["open"]).abs().rename("body")


def atr(df: pd.DataFrame, length: int = 10) -> pd.Series:
    """``ta.atr(length)`` (ict.pine:121): RMA of true range, SMA-seeded.

    TradingView's RMA uses the SMA of the first ``length`` TR values as its
    seed, then ``prev + (tr - prev) / length``. Earlier bars are ``na`` in Pine
    and NaN here.
    """
    if length < 1:
        raise ValueError("length must be >= 1")
    tr = true_range(df).to_numpy(dtype=float)
    out = np.full(tr.shape, np.nan)
    if len(tr) < length:
        return pd.Series(out, index=df.index, name="atr")
    out[length - 1] = tr[:length].mean()
    for i in range(length, len(tr)):
        out[i] = out[i - 1] + (tr[i] - out[i - 1]) / length
    return pd.Series(out, index=df.index, name="atr")


def swings(df: pd.DataFrame, length: int = 5) -> list[SwingPoint]:
    """Port of ``swings(len)`` (ict.pine:316-334).

    At bar ``i`` Pine tests ``high[i - length]`` against ``ta.highest(length)``
    over ``i - length + 1 .. i`` (and the low equivalent), so a pivot becomes
    known exactly ``length`` bars after its bar. ``os`` starts at 0
    (ict.pine:317), so the first recorded pivot is a low; a high needs a prior
    low flip.

    Pine's function compares with its ``len`` argument but records at the
    global ``length`` (ict.pine:324-331): the call sites pass the Order Blocks
    lookback (ict.pine:47,859) and the Market Structures ``len``
    (ict.pine:25,527). This port uses one lookback for both, as required for a
    faithful, future-leak-free pivot.
    """
    if length < 1:
        raise ValueError("length must be >= 1")
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    os = 0
    found: list[SwingPoint] = []
    for i in range(length, len(df)):
        pivot = i - length
        upper = high[pivot + 1 : i + 1].max()
        lower = low[pivot + 1 : i + 1].min()
        next_os = os
        if high[pivot] > upper:
            next_os = 0
        elif low[pivot] < lower:
            next_os = 1
        if next_os == 0 and os != 0:
            found.append(SwingPoint(pivot, float(high[pivot]), "high", i))
        elif next_os == 1 and os != 1:
            found.append(SwingPoint(pivot, float(low[pivot]), "low", i))
        os = next_os
    return found


def pivots(
    df: pd.DataFrame, left: int, right: int = 1
) -> tuple[list[SwingPoint], list[SwingPoint]]:
    """``ta.pivothigh(hi, left, 1)`` / ``ta.pivotlow(lo, left, 1)``.

    Used by ``draw()`` (ict.pine:351-352) with ``left = len`` (ict.pine:527).
    Pine emits the pivot price on the confirmation bar and ``na`` elsewhere;
    only confirmed points are returned here, with their pivot and confirmation
    bar indexes carried in ``SwingPoint``. Comparisons are strict, so equal
    highs/lows do not form pivots.
    """
    if left < 0 or right < 0:
        raise ValueError("left and right must be >= 0")
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    highs: list[SwingPoint] = []
    lows: list[SwingPoint] = []
    for i in range(left + right, len(df)):
        pivot = i - right
        before_h = high[pivot - left : pivot]
        after_h = high[pivot + 1 : i + 1]
        before_l = low[pivot - left : pivot]
        after_l = low[pivot + 1 : i + 1]
        if np.all(high[pivot] > before_h) and np.all(high[pivot] > after_h):
            highs.append(SwingPoint(pivot, float(high[pivot]), "high", i))
        if np.all(low[pivot] < before_l) and np.all(low[pivot] < after_l):
            lows.append(SwingPoint(pivot, float(low[pivot]), "low", i))
    return highs, lows


PRESENT_WINDOW = 500  # ict.pine:122
SECONDARY_WINDOW = 1000  # ict.pine:123


def mode_filter(df: pd.DataFrame, mode: str = "Present") -> pd.DataFrame:
    """Document ``per`` / ``perB`` (ict.pine:122-123) without dropping bars.

    Both are *drawing* gates: in Present mode ``per`` paints only the last
    ``PRESENT_WINDOW`` bars, Historical paints all, and ``perB`` bounds drawing
    at ``SECONDARY_WINDOW`` bars. Neither truncates the data consumed by the
    calculations, so the frame is returned unchanged.
    """
    return df

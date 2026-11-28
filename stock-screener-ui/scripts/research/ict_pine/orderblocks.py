"""Order blocks from LuxAlgo's ``ict.pine`` (CC BY-NC-SA 4.0).

Pine lines 858-930 create a block when price closes through a confirmed swing,
then pick the opposing candle inside the displacement leg. Swings come from
``swings(length)`` (ict.pine:316-334), whose ``os`` state machine records a
pivot only on a direction flip. Mitigation is the update on lines 875-922.
Nothing is published before the confirming bar.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import pandas as pd

from .core import swings as pine_swings

DEFAULT_LENGTH = 10


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping) and name in obj:
        return obj[name]
    return getattr(obj, name, default)


def _normalise_bars(bars: Sequence[Any]) -> list[dict[str, float]]:
    if isinstance(bars, pd.DataFrame):
        bars = bars.to_dict("records")
    out = []
    for bar in bars:
        out.append({
            "open": float(_field(bar, "open", _field(bar, "o", 0.0))),
            "high": float(_field(bar, "high", _field(bar, "h", 0.0))),
            "low": float(_field(bar, "low", _field(bar, "l", 0.0))),
            "close": float(_field(bar, "close", _field(bar, "c", 0.0))),
        })
    return out


def detect_swings(bars: Sequence[Any], *, length: int = DEFAULT_LENGTH) -> list[dict[str, Any]]:
    """Confirmed ``swings(length)`` pivots; the latest of each kind wins."""
    frame = pd.DataFrame(_normalise_bars(bars))
    return [
        {"idx": p.idx, "price": p.price, "kind": p.kind}
        for p in pine_swings(frame, length=length)
    ]


def order_blocks(
    bars: Sequence[Any],
    *,
    length: int = DEFAULT_LENGTH,
    use_body: bool = True,
) -> dict[str, list[dict[str, Any]]]:
    """Return ``{"bullish": [...], "bearish": [...]}`` order blocks.

    Each entry is ``{idx, top, bottom, breaker, break_idx}``. ``idx`` is the
    candle chosen from the leg (the Pine's ``loc``), ``breaker`` records a
    polarity flip, and ``break_idx`` is the bar it happened on.
    """
    rows = _normalise_bars(bars)
    high = [r["high"] for r in rows]
    low = [r["low"] for r in rows]
    if use_body:
        mx = [max(r["open"], r["close"]) for r in rows]
        mn = [min(r["open"], r["close"]) for r in rows]
    else:
        mx, mn = high, low

    points = detect_swings(rows, length=length)
    highs = [p for p in points if p["kind"] == "high"]
    lows = [p for p in points if p["kind"] == "low"]
    hi_ptr = lo_ptr = 0

    top: dict[str, Any] | None = None
    bottom: dict[str, Any] | None = None
    bullish: list[dict[str, Any]] = []
    bearish: list[dict[str, Any]] = []

    for n, row in enumerate(rows):
        # Pine overwrites top/btm only on an os flip; a later qualifying bar
        # in the same state does not replace the existing swing.
        while hi_ptr < len(highs) and highs[hi_ptr]["idx"] + length <= n:
            point = highs[hi_ptr]
            top = {"idx": point["idx"], "price": point["price"], "crossed": False}
            hi_ptr += 1
        while lo_ptr < len(lows) and lows[lo_ptr]["idx"] + length <= n:
            point = lows[lo_ptr]
            bottom = {"idx": point["idx"], "price": point["price"], "crossed": False}
            lo_ptr += 1

        if top is not None and row["close"] > top["price"] and not top["crossed"]:
            top["crossed"] = True
            minima, maxima, loc = mn[n - 1], mx[n - 1], n - 1
            for j in range(n - 1, top["idx"], -1):
                if mn[j] <= minima:
                    minima, maxima, loc = mn[j], mx[j], j
            bullish.append({"idx": loc, "top": maxima, "bottom": minima,
                            "breaker": False, "break_idx": None})

        if bottom is not None and row["close"] < bottom["price"] and not bottom["crossed"]:
            bottom["crossed"] = True
            maxima, minima, loc = mx[n - 1], mn[n - 1], n - 1
            for j in range(n - 1, bottom["idx"], -1):
                if mx[j] >= maxima:
                    maxima, minima, loc = mx[j], mn[j], j
            bearish.append({"idx": loc, "top": maxima, "bottom": minima,
                            "breaker": False, "break_idx": None})

        for block in bullish:
            if not block["breaker"] and min(row["close"], row["open"]) < block["bottom"]:
                block["breaker"] = True
                block["break_idx"] = n
        for block in bearish:
            if not block["breaker"] and max(row["close"], row["open"]) > block["top"]:
                block["breaker"] = True
                block["break_idx"] = n

    return {"bullish": bullish, "bearish": bearish}


detect_order_blocks = order_blocks
compute_order_blocks = order_blocks

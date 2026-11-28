"""Displacement, zigzag and market-structure events from LuxAlgo's ``ict.pine``.

Pine references:
    * lines 129-130 / 547-554 - ``body``, ``meanBody``, ``L_body`` and its
      up/down variants (plotted at lines 1121-1136)
    * lines 344-420 - the ``aZZ`` zigzag built by ``draw()``
    * lines 465-517 - MSS/BOS state machine

Only information observable at the close of a bar is used: pivots enter the
zigzag on their confirmation bar, never at their pivot bar.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import pandas as pd

from .core import body as body_of
from .core import pivots

__all__ = ["ZigPoint", "displacement", "market_structure", "zigzag"]


@dataclass(frozen=True)
class ZigPoint:
    """One ``aZZ`` node: ``d`` is +1 high / -1 low, ``x`` the pivot bar."""

    d: int
    x: int
    y: float


def _event(idx: int, dir: int, level: float, swing_idx: int) -> dict[str, int | float]:
    return {"idx": idx, "dir": dir, "level": level, "swing_idx": swing_idx}


def displacement(
    df: pd.DataFrame, body_pct: float = 0.36, mean_length: int = 5, strict: bool = True
) -> pd.DataFrame:
    """Pine ``L_bodyUP`` / ``L_bodyDN`` plus their inputs, bar by bar.

    ``body = |close - open|`` and ``mean_body = sma(body, mean_length)``.
    ``l_body`` is the small-wick test. ``disp_up``/``disp_dn`` additionally
    require ``body > mean_body`` and the candle direction.

    ``strict=True`` (default) uses Pine's strict inequalities. ``strict=False``
    makes them inclusive (``<=`` for wicks, ``>=`` for the mean) for callers
    that want boundary bars counted.
    """
    if mean_length < 1:
        raise ValueError("mean_length must be >= 1")

    body_vals = body_of(df)
    mean_body = body_vals.rolling(mean_length).mean()
    mx = df[["open", "close"]].max(axis=1)
    mn = df[["open", "close"]].min(axis=1)
    threshold = body_vals * body_pct

    if strict:
        l_body = ((df["high"] - mx) < threshold) & ((mn - df["low"]) < threshold)
        strong = body_vals > mean_body
    else:
        l_body = ((df["high"] - mx) <= threshold) & ((mn - df["low"]) <= threshold)
        strong = body_vals >= mean_body

    return pd.DataFrame(
        {
            "body": body_vals,
            "mean_body": mean_body,
            "l_body": l_body,
            "disp_up": strong & l_body & (df["close"] > df["open"]),
            "disp_dn": strong & l_body & (df["close"] < df["open"]),
        },
        index=df.index,
    )


def _zigzag_timeline(df: pd.DataFrame, left: int) -> Iterator[list[ZigPoint]]:
    """Yield the ``aZZ`` list (newest first) after each bar's pivot update.

    Pine (ict.pine:351-420) reads ``ta.pivothigh(hi, left, 1)`` on bar ``n`` as
    the pivot at ``n-1``. ``d=0`` is the array's initial fill, so the first
    pivot of either kind is accepted; afterwards a same-direction pivot only
    replaces node 0 when it is more extreme, and an opposite pivot is unshifted.
    When both confirm on one bar, the high is applied first (``if ph`` at
    ict.pine:353 precedes ``if pl`` at 409); reversing that order changes which
    node is at index 2 and therefore the iH/iL level used for MSS/BOS.
    """
    highs, lows = pivots(df, left=left, right=1)
    by_bar: dict[int, list[tuple[int, object]]] = {}
    for point in highs:
        by_bar.setdefault(point.confirmed_idx, []).append((1, point))
    for point in lows:
        by_bar.setdefault(point.confirmed_idx, []).append((-1, point))

    nodes: list[ZigPoint] = []
    for bar in range(len(df)):
        for direction, point in sorted(
            by_bar.get(bar, ()),
            key=lambda item: (0 if item[0] == 1 else 1, item[1].idx),
        ):
            candidate = ZigPoint(direction, point.idx, float(point.price))
            if not nodes:
                nodes.insert(0, candidate)
            elif direction == 1:
                if nodes[0].d < 1:
                    nodes.insert(0, candidate)
                elif candidate.y > nodes[0].y:
                    nodes[0] = candidate
            else:
                if nodes[0].d > -1:
                    nodes.insert(0, candidate)
                elif candidate.y < nodes[0].y:
                    nodes[0] = candidate
        yield nodes


def zigzag(df: pd.DataFrame, left: int = 5) -> list[ZigPoint]:
    """Final ``aZZ`` state, newest first.

    ``left`` is the ``draw()`` argument (ict.pine:527 passes the Market
    Structures ``len``, default 5). The separate ``ta.pivothigh(3, 1)`` at
    ict.pine:544 only feeds liquidity boxes and is not the ``aZZ`` source.
    """
    nodes: list[ZigPoint] = []
    for snapshot in _zigzag_timeline(df, left):
        nodes = snapshot
    return list(nodes)


def market_structure(
    df: pd.DataFrame, swing_length: int = 5
) -> dict[str, list[dict[str, int | float]]]:
    """Walk the ``aZZ`` zigzag and emit MSS/BOS breaks from closing prices.

    ``iH = aZZ.d.get(2) == 1 ? 2 : 1`` and ``iL = aZZ.d.get(2) == -1 ? 2 : 1``
    (ict.pine:468-469) deliberately skip the just-added pivot at index 0.
    A close past the opposite-side level flips direction (MSS); once flipped,
    a close past a *different* same-side level is a continuation (BOS). Levels
    equal to the last MSS or last BOS are suppressed, mirroring Pine's checks
    against ``MSS.l_mssBl.get(0)`` / ``MSS.l_bosBl.get(0)``.

    Drawing/label state is omitted and the ``iBOS`` toggle is assumed enabled
    (its Pine default).
    """
    mss: list[dict[str, int | float]] = []
    bos: list[dict[str, int | float]] = []
    direction = 0
    last_mss_level: float | None = None
    last_bos_level: float | None = None
    closes = df["close"].to_numpy(dtype=float)

    for bar, nodes in enumerate(_zigzag_timeline(df, left=swing_length)):
        d2 = nodes[2].d if len(nodes) > 2 else 0
        i_h = 2 if d2 == 1 else 1
        i_l = 2 if d2 == -1 else 1

        high_point = nodes[i_h] if len(nodes) > i_h and nodes[i_h].d == 1 else None
        low_point = nodes[i_l] if len(nodes) > i_l and nodes[i_l].d == -1 else None
        close = closes[bar]

        if high_point is not None and close > high_point.y and direction != 1:
            mss.append(_event(bar, 1, high_point.y, high_point.x))
            direction = 1
            last_mss_level = high_point.y
            last_bos_level = None
        elif low_point is not None and close < low_point.y and direction != -1:
            mss.append(_event(bar, -1, low_point.y, low_point.x))
            direction = -1
            last_mss_level = low_point.y
            last_bos_level = None
        elif (
            direction == 1
            and high_point is not None
            and close > high_point.y
            and high_point.y != last_mss_level
            and high_point.y != last_bos_level
        ):
            bos.append(_event(bar, 1, high_point.y, high_point.x))
            last_bos_level = high_point.y
        elif (
            direction == -1
            and low_point is not None
            and close < low_point.y
            and low_point.y != last_mss_level
            and low_point.y != last_bos_level
        ):
            bos.append(_event(bar, -1, low_point.y, low_point.x))
            last_bos_level = low_point.y

    return {"mss": mss, "bos": bos}

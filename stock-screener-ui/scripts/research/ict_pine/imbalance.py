"""Imbalance geometry from LuxAlgo's ``ict.pine`` (FVG, VI, BPR, NWOG/NDOG).

The source is a charting script: boxes and lines are replaced by plain dicts with
the same prices and bar positions. Every rule reads only the current and earlier
bars, so feeding a partial frame yields the same result as its prefix.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

_OHLC = ("open", "high", "low", "close")
_BARS = dict[str, Any]


def _bars(df: pd.DataFrame) -> _BARS:
    by_lower = {str(column).lower(): column for column in df.columns}
    missing = [name for name in _OHLC if name not in by_lower]
    if missing:
        raise ValueError(f"OHLC frame is missing columns: {', '.join(missing)}")
    return {name: df[by_lower[name]].to_numpy(dtype=float) for name in _OHLC}


def _expansion_flags(
    bars: _BARS, period: int, wick_ratio: float
) -> tuple[list[bool], list[bool]]:
    """L_bodyUP / L_bodyDN from lines 548-553, with ta.sma(body, len) at line 130."""
    count = len(bars["open"])
    up = [False] * count
    down = [False] * count
    # ta.sma is na until `period` bodies exist, so no gate can pass before then.
    for bar in range(period - 1, count):
        first = bar - period + 1
        mean_body = sum(
            abs(bars["close"][i] - bars["open"][i]) for i in range(first, bar + 1)
        ) / period
        body = abs(bars["close"][bar] - bars["open"][bar])
        mx, mn = max(bars["close"][bar], bars["open"][bar]), min(
            bars["close"][bar], bars["open"][bar]
        )
        tight_wicks = (
            bars["high"][bar] - mx < body * wick_ratio
            and mn - bars["low"][bar] < body * wick_ratio
        )
        if body > mean_body and tight_wicks:
            if bars["close"][bar] > bars["open"][bar]:
                up[bar] = True
            elif bars["close"][bar] < bars["open"][bar]:
                down[bar] = True
    return up, down


def _breaks(bars: _BARS, zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for zone in zones:
        first = zone["idx"]
        for bar in range(first + 1, len(bars["open"])):
            # Pine marks a zone dead on the wick: low < bottom (line 706) for
            # bulls, high > top (line 719) for bears. The close is not used.
            if zone["dir"] == "bull":
                broken = bars["low"][bar] < zone["bottom"]
            else:
                broken = bars["high"][bar] > zone["top"]
            if broken:
                events.append({"fvg_idx": first, "break_idx": bar, "dir": zone["dir"]})
                break
    return sorted(events, key=lambda event: (event["break_idx"], event["fvg_idx"]))


def fvg(
    df: pd.DataFrame,
    strict: bool = True,
    body_period: int = 5,
    wick_ratio: float = 0.36,
) -> list[dict[str, Any]]:
    """Three-bar fair value gaps from lines 564-566 and 597-645.

    Strict (default) follows Pine: the middle bar of the pattern must be a local
    expansion body -- ``body > ta.sma(body, len)`` with both wicks shorter than
    ``body * perc_Body`` -- in the direction of the gap. ``len`` is the Market
    Structures input (default 5) and ``perc_Body`` is 0.36. ``strict=False``
    opts out of that displacement gate and uses only the bare 3-bar imbalance.

    Bull zones span high[2]..low (top = low, bottom = high[2]); bear zones span
    low[2]..high (top = low[2], bottom = high), both starting at n-2 and created
    on the third bar. ``active`` is the state at the end of the frame.
    """
    bars = _bars(df)
    up, down = _expansion_flags(bars, body_period, wick_ratio)
    zones: list[dict[str, Any]] = []
    for bar in range(2, len(bars["open"])):
        low, high = bars["low"][bar], bars["high"][bar]
        if low > bars["high"][bar - 2]:
            if strict and not up[bar - 1]:
                continue
            zones.append(
                {
                    "idx": bar,
                    "dir": "bull",
                    "top": float(low),
                    "bottom": float(bars["high"][bar - 2]),
                    "start_idx": bar - 2,
                    "active": True,
                }
            )
        elif high < bars["low"][bar - 2]:
            if strict and not down[bar - 1]:
                continue
            zones.append(
                {
                    "idx": bar,
                    "dir": "bear",
                    "top": float(bars["low"][bar - 2]),
                    "bottom": float(high),
                    "start_idx": bar - 2,
                    "active": True,
                }
            )

    broken = {event["fvg_idx"] for event in _breaks(bars, zones)}
    for zone in zones:
        zone["active"] = zone["idx"] not in broken
    return zones


def volume_imbalance(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Wick-versus-body gap between the prior body edge and the current body edge."""
    bars = _bars(df)
    zones: list[dict[str, Any]] = []
    for bar in range(1, len(bars["open"])):
        op, high, low, close = (
            bars["open"][bar],
            bars["high"][bar],
            bars["low"][bar],
            bars["close"][bar],
        )
        prev_op, prev_high, prev_low, prev_close = (
            bars["open"][bar - 1],
            bars["high"][bar - 1],
            bars["low"][bar - 1],
            bars["close"][bar - 1],
        )
        prev_mx, prev_mn = max(prev_close, prev_op), min(prev_close, prev_op)
        mx, mn = max(close, op), min(close, op)

        # vImb_Bl: the prior high sits below the current bullish body.
        if (
            op > prev_close
            and prev_high > low
            and close > prev_close
            and op > prev_op
            and prev_high < mn
        ):
            zones.append(
                {
                    "idx": bar,
                    "dir": "bull",
                    "top": float(mn),
                    "bottom": float(prev_mx),
                    "start_idx": bar - 1,
                }
            )
        # vImb_Br: the prior low sits above the current bearish body.
        elif (
            op < prev_close
            and prev_low < high
            and close < prev_close
            and op < prev_op
            and prev_low > mx
        ):
            zones.append(
                {
                    "idx": bar,
                    "dir": "bear",
                    "top": float(prev_mn),
                    "bottom": float(mx),
                    "start_idx": bar - 1,
                }
            )
    return zones


def bpr(fvgs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Balance price range: overlap band of the latest bull and bear FVGs (646-698)."""
    bulls = [zone for zone in fvgs if zone["dir"] == "bull"]
    bears = [zone for zone in fvgs if zone["dir"] == "bear"]
    if not bulls or not bears:
        return []

    up = max(bulls, key=lambda zone: zone["idx"])
    down = max(bears, key=lambda zone: zone["idx"])
    idx = max(up["idx"], down["idx"])
    ranges: list[dict[str, Any]] = []
    if down["bottom"] < up["bottom"] < down["top"]:
        ranges.append(
            {
                "idx": idx,
                "dir": "bull",
                "top": down["top"],
                "bottom": up["bottom"],
                "bull_idx": up["idx"],
                "bear_idx": down["idx"],
            }
        )
    if down["bottom"] < up["top"] and up["bottom"] < down["bottom"]:
        ranges.append(
            {
                "idx": idx,
                "dir": "bear",
                "top": up["top"],
                "bottom": down["bottom"],
                "bull_idx": up["idx"],
                "bear_idx": down["idx"],
            }
        )
    return sorted(ranges, key=lambda zone: zone["idx"])


def fvg_breaks(df: pd.DataFrame, fvgs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """First wick through each zone, in bar order; a zone is reported once."""
    return _breaks(_bars(df), fvgs)


def opening_gaps(
    df: pd.DataFrame, include_ndog: bool = False
) -> list[dict[str, Any]]:
    """New-week and optional new-day opening gaps from lines 771-820.

    A signal needs a change of day-of-week (Pine's ``ta.change(dayofweek)``),
    not merely a new calendar date. ``NWOG`` uses the last Friday close against
    the Monday open; ``NDOG`` uses the previous bar's close against the current
    session's open (Pine leaves NDOG off by default).
    """
    bars = _bars(df)
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("opening_gaps requires a DatetimeIndex")
    index = df.index

    gaps: list[dict[str, Any]] = []
    friday_close, friday_idx = None, None
    previous_day = None
    for bar in range(len(bars["open"])):
        day = index[bar].dayofweek

        if day == 4:
            friday_close, friday_idx = float(bars["close"][bar]), bar

        if previous_day is not None and day != previous_day:
            op = float(bars["open"][bar])
            if day == 0 and friday_close is not None:
                gaps.append(
                    {
                        "kind": "NWOG",
                        "idx": bar,
                        "start_idx": friday_idx,
                        "top": max(friday_close, op),
                        "bottom": min(friday_close, op),
                        "mid": (friday_close + op) / 2.0,
                    }
                )
            if include_ndog:
                prior_close = float(bars["close"][bar - 1])
                gaps.append(
                    {
                        "kind": "NDOG",
                        "idx": bar,
                        "start_idx": bar - 1,
                        "top": max(prior_close, op),
                        "bottom": min(prior_close, op),
                        "mid": (prior_close + op) / 2.0,
                    }
                )

        previous_day = day

    return sorted(
        gaps, key=lambda gap: (gap["idx"], 0 if gap["kind"] == "NWOG" else 1)
    )

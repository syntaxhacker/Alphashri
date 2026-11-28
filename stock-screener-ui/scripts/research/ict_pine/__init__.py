"""Assemble the pure-Python port of LuxAlgo's ``ict.pine`` into one call.

All line numbers refer to the read-only root ``ict.pine`` (CC BY-NC-SA 4.0).
The submodules own the price math; this module only normalises the input frame,
calls them in dependency order and turns their objects into plain, JSON-friendly
dicts/lists. Nothing is published before the bar that confirms it.

:func:`compute_ict` returns a dict with these keys:

``meta``
    ``rows``, ``start``/``end`` (ISO strings, ``None`` without a DatetimeIndex)
    and the three call ``params``.
``swings``
    Confirmed ``swings()`` pivots (ict.pine:316-334) as
    ``{idx, confirmed_idx, price, kind}``; ``confirmed_idx == idx + swing_length``.
``displacement``
    ``{counts, disp_up_idx, disp_dn_idx, per_bar}`` from ``L_bodyUP`` /
    ``L_bodyDN`` (ict.pine:129-130, 547-554). ``per_bar`` keeps the per-bar
    ``body``, ``mean_body``, ``l_body``, ``disp_up`` and ``disp_dn`` truth;
    non-finite values (the SMA seed) are ``None``. ``strict_fvg`` does not
    relax these Pine-strict inequalities.
``structure``
    ``{mss, bos}`` close-based breaks of the ``aZZ`` zigzag (ict.pine:465-517).
    The zigzag itself is a mutable last-bar summary and is not exposed.
``fvg``
    Three-bar fair value gaps (ict.pine:564-566, 597-645), ordered by creation
    bar. The forward-looking ``active`` flag is omitted: ``fvg_breaks`` carries
    the actual first-wick events.
``fvg_breaks``
    First wick through each FVG (ict.pine:706, 719), ``{fvg_idx, break_idx, dir}``.
``volume_imbalance``
    Wick/body gaps between neighbouring candles (ict.pine:568-569).
``bpr``
    Balance price range: overlap of the latest bull and bear FVG (ict.pine:646-698).
    This is a last-bar summary, not a stream of events.
``opening_gaps``
    New-week (and Pine's optional new-day) gaps from ict.pine:771-820. Empty
    without a DatetimeIndex.
``liquidity``
    ``{buyside, sellside}`` equal-price bands from ict.pine:365-463, 821-857.
    Each band is a *snapshot emitted when its cluster grows*, keyed by the
    confirming pivot bar, so an older snapshot never changes in a longer frame.
    The mutable ``count`` state of Pine's box is a property of that snapshot.
``order_blocks``
    ``{bullish, bearish}`` blocks from ict.pine:858-930,
    ``{idx, confirmed_idx, top, bottom}``. ``idx`` is Pine's leg candle and
    ``confirmed_idx`` is the bar of the closing swing cross that created it.
    Pine's ``breaker``/``break_idx`` are omitted because they are later-bar
    state.
``killzones``
    ``{windows, mask, counts}`` for the four sessions at ict.pine:538-541,
    evaluated in each session's own IANA zone. Naive timestamps are treated as
    UTC; without a DatetimeIndex the windows and mask are empty.
``fibonacci``
    Retracement levels for adjacent opposite swings (ict.pine:957-1119),
    ``{idx, confirmed_idx, swing_low_idx, swing_high_idx, levels}``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from . import core, fibonacci, imbalance, killzones, liquidity, orderblocks, structure

__all__ = ["RESULT_KEYS", "compute_ict"]

RESULT_KEYS: tuple[str, ...] = (
    "meta",
    "swings",
    "displacement",
    "structure",
    "fvg",
    "fvg_breaks",
    "volume_imbalance",
    "bpr",
    "opening_gaps",
    "liquidity",
    "order_blocks",
    "killzones",
    "fibonacci",
)

_OHLC: tuple[str, ...] = ("open", "high", "low", "close")
_ALIASES: dict[str, tuple[str, ...]] = {
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "c"),
}


def _jsonable(value: Any) -> Any:
    """Convert numpy/pandas scalars to stable, equality-comparable Python values."""
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        result = float(value)
        return result if np.isfinite(result) else None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return value


def _ohlc_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Return a float OHLC copy, accepting lower/capitalised or ``o/h/l/c`` names."""
    if not isinstance(df, pd.DataFrame):
        raise TypeError("compute_ict expects a pandas DataFrame")
    by_lower = {str(column).lower(): column for column in df.columns}
    columns: list[Any] = []
    for name in _OHLC:
        column = next(
            (by_lower[alias] for alias in _ALIASES[name] if alias in by_lower), None
        )
        if column is None:
            raise ValueError(f"OHLC frame is missing column: {name}")
        columns.append(column)
    frame = df.loc[:, columns].copy()
    frame.columns = list(_OHLC)
    return frame.astype(float)


def _by_idx(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(events, key=lambda event: (event["idx"], event.get("start_idx", -1)))


def _displacement(frame: pd.DataFrame) -> dict[str, Any]:
    bars = structure.displacement(frame)
    up = [index for index, flag in enumerate(bars["disp_up"].to_numpy(dtype=bool)) if flag]
    down = [index for index, flag in enumerate(bars["disp_dn"].to_numpy(dtype=bool)) if flag]
    return {
        "counts": {"disp_up": len(up), "disp_dn": len(down)},
        "disp_up_idx": up,
        "disp_dn_idx": down,
        "per_bar": {
            name: _jsonable(bars[name].tolist())
            for name in ("body", "mean_body", "l_body", "disp_up", "disp_dn")
        },
    }


def _liquidity_snapshots(
    bars: list[dict[str, float]],
    points: list[tuple[int, float, int]],
    *,
    margin: float = liquidity.DEFAULT_MARGIN,
    atr_period: int = liquidity.DEFAULT_ATR_PERIOD,
    pivot_limit: int = liquidity.PIVOT_LIMIT,
) -> list[dict[str, Any]]:
    """Emit a band each time an equal-price cluster grows (a pivot confirms).

    ``liquidity_zones`` keeps only the latest bands; freezing the same band
    arithmetic at each growth step makes earlier snapshots survive a longer
    frame unchanged. The band formula (margin divisor, tolerance, midpoint and
    rounding) is the one used by ``liquidity.liquidity_zones``.
    """
    atrs = liquidity.atr_values(bars, atr_period)
    last_count: dict[tuple[int, int], int] = {}
    events: list[dict[str, Any]] = []
    for position, (idx, price, direction) in enumerate(points):
        tolerance = atrs[min(max(idx + 1, 0), len(atrs) - 1)] * margin / 10.0
        matches: list[tuple[int, float]] = []
        for other_idx, other_price, other_dir in list(
            reversed(points[: position + 1])
        )[:pivot_limit]:
            if other_dir != direction:
                continue
            if direction == 1 and other_price > price + tolerance:
                break
            if direction == -1 and other_price < price - tolerance:
                break
            if price - tolerance < other_price < price + tolerance:
                matches.append((other_idx, other_price))
        if len(matches) <= 2:
            continue
        start_idx = matches[-1][0]
        key = (direction, start_idx)
        if last_count.get(key) == len(matches):
            continue
        last_count[key] = len(matches)
        side = "buyside" if direction == 1 else "sellside"
        levels = [price for _, price in matches]
        mid = (max(levels) + min(levels)) / 2.0
        events.append(
            {
                "idx": idx,
                "confirmed_idx": idx + 1,
                "start_idx": start_idx,
                "side": side,
                "price": matches[-1][1],
                "top": round(mid + tolerance, 10),
                "bottom": round(mid - tolerance, 10),
                "count": len(matches),
            }
        )
    return _by_idx(events)


def _order_block_events(
    bars: list[dict[str, float]],
    blocks: dict[str, list[dict[str, Any]]],
    side: str,
    swing_points: list[core.SwingPoint],
    ob_length: int,
) -> list[dict[str, Any]]:
    """Keep only block geometry and attach the bar that created it.

    ``order_blocks()`` stores neither the swing-cross bar nor a causal index for
    its ``idx`` (the earlier leg candle), so the cross is replayed here from the
    same confirmed swings. Pine's breaker state (ict.pine:875-922) is later-bar
    state and is deliberately not part of the event.
    """
    highs = [point for point in swing_points if point.kind == "high"]
    lows = [point for point in swing_points if point.kind == "low"]
    hi_ptr = lo_ptr = 0
    top: dict[str, Any] | None = None
    bottom: dict[str, Any] | None = None
    created: dict[tuple[int, float, float], int] = {}
    mx = [max(row["open"], row["close"]) for row in bars]
    mn = [min(row["open"], row["close"]) for row in bars]

    for n, row in enumerate(bars):
        while hi_ptr < len(highs) and highs[hi_ptr].idx + ob_length <= n:
            point = highs[hi_ptr]
            top = {"price": point.price, "idx": point.idx, "crossed": False}
            hi_ptr += 1
        while lo_ptr < len(lows) and lows[lo_ptr].idx + ob_length <= n:
            point = lows[lo_ptr]
            bottom = {"price": point.price, "idx": point.idx, "crossed": False}
            lo_ptr += 1

        if top is not None and row["close"] > top["price"] and not top["crossed"]:
            top["crossed"] = True
            minima, maxima, loc = mn[n - 1], mx[n - 1], n - 1
            for j in range(n - 1, top["idx"], -1):
                if mn[j] <= minima:
                    minima, maxima, loc = mn[j], mx[j], j
            created.setdefault((loc, maxima, minima), n)
        if bottom is not None and row["close"] < bottom["price"] and not bottom["crossed"]:
            bottom["crossed"] = True
            maxima, minima, loc = mx[n - 1], mn[n - 1], n - 1
            for j in range(n - 1, bottom["idx"], -1):
                if mx[j] >= maxima:
                    maxima, minima, loc = mx[j], mn[j], j
            created.setdefault((loc, maxima, minima), n)

    return _by_idx(
        [
            {
                "idx": block["idx"],
                "confirmed_idx": created.get(
                    (block["idx"], block["top"], block["bottom"]), len(bars) - 1
                ),
                "top": block["top"],
                "bottom": block["bottom"],
            }
            for block in blocks[side]
        ]
    )


def _killzones(frame: pd.DataFrame) -> dict[str, Any]:
    names = [zone.name for zone in killzones.KILLZONES]
    if not isinstance(frame.index, pd.DatetimeIndex) or len(frame) == 0:
        return {
            "windows": {name: [] for name in names},
            "mask": [],
            "counts": {name: 0 for name in names},
        }
    index = (
        frame.index
        if frame.index.tz is not None
        else frame.index.tz_localize("UTC")
    )
    windows = killzones.killzone_windows(pd.DataFrame(index=index))
    mask = killzones.session_mask(index)
    return {
        "windows": {
            name: [[start.isoformat(), end.isoformat()] for start, end in runs]
            for name, runs in windows.items()
        },
        "mask": mask.tolist(),
        "counts": {name: len(windows.get(name, [])) for name in names},
    }


def compute_ict(
    df: pd.DataFrame,
    *,
    swing_length: int = 5,
    ob_length: int = 10,
    strict_fvg: bool = True,
) -> dict[str, Any]:
    """Run every ``ict.pine`` submodule over ``df`` without mutating it.

    Args:
        df: OHLC frame with lowercase, capitalised or ``o/h/l/c`` column names.
        swing_length: Pine's Market Structures ``len`` (ict.pine:25) and the
            Order Blocks swing lookback used for pivots/liquidity.
        ob_length: Pine's Order Blocks ``length`` input (ict.pine:47).
        strict_fvg: require the middle FVG candle to be a displacement body
            (ict.pine:564-566). ``False`` keeps only the bare 3-bar imbalance.

    Returns:
        A fresh dict with the keys documented in this module's docstring.
    """
    for name, value in (("swing_length", swing_length), ("ob_length", ob_length)):
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise ValueError(f"{name} must be a positive integer")

    frame = _ohlc_frame(df)
    bars = frame.to_dict("records")
    swing_points = core.swings(frame, length=swing_length)
    highs, lows = core.pivots(frame, left=swing_length, right=1)
    pivots = sorted(
        [
            (point.idx, point.price, 1 if point.kind == "high" else -1)
            for point in (*highs, *lows)
        ],
        key=lambda point: point[0],
    )

    fvg = [
        {key: value for key, value in zone.items() if key != "active"}
        for zone in imbalance.fvg(frame, strict=strict_fvg)
    ]
    structures = structure.market_structure(frame, swing_length=swing_length)
    order_blocks = orderblocks.order_blocks(bars, length=ob_length, use_body=True)
    liquidity_events = _liquidity_snapshots(bars, pivots)
    fibs = fibonacci.fib_from_swings(
        [
            {
                "idx": point.idx,
                "price": point.price,
                "direction": 1 if point.kind == "high" else -1,
            }
            for point in swing_points
        ]
    )
    confirmed = {point.idx: point.confirmed_idx for point in swing_points}
    fib_events = []
    for item in fibs:
        confirmed_idx = max(
            confirmed[item["swing_low_idx"]], confirmed[item["swing_high_idx"]]
        )
        fib_events.append(
            {
                "idx": confirmed_idx,
                "confirmed_idx": confirmed_idx,
                "swing_low_idx": item["swing_low_idx"],
                "swing_high_idx": item["swing_high_idx"],
                "levels": item["levels"],
            }
        )

    result: dict[str, Any] = {
        "meta": {
            "rows": len(frame),
            "start": (
                frame.index[0].isoformat()
                if isinstance(frame.index, pd.DatetimeIndex) and len(frame)
                else None
            ),
            "end": (
                frame.index[-1].isoformat()
                if isinstance(frame.index, pd.DatetimeIndex) and len(frame)
                else None
            ),
            "params": {
                "swing_length": swing_length,
                "ob_length": ob_length,
                "strict_fvg": strict_fvg,
            },
        },
        "swings": _by_idx(
            [
                {
                    "idx": point.idx,
                    "confirmed_idx": point.confirmed_idx,
                    "price": point.price,
                    "kind": point.kind,
                }
                for point in swing_points
            ]
        ),
        "displacement": _displacement(frame),
        "structure": {
            "mss": _by_idx(structures["mss"]),
            "bos": _by_idx(structures["bos"]),
        },
        "fvg": _by_idx(fvg),
        "fvg_breaks": sorted(
            imbalance.fvg_breaks(frame, fvg),
            key=lambda event: (event["break_idx"], event["fvg_idx"]),
        ),
        "volume_imbalance": _by_idx(imbalance.volume_imbalance(frame)),
        "bpr": _by_idx(imbalance.bpr(fvg)),
        "opening_gaps": (
            _by_idx(imbalance.opening_gaps(frame))
            if isinstance(frame.index, pd.DatetimeIndex)
            else []
        ),
        "liquidity": {
            side: _by_idx(
                [event for event in liquidity_events if event["side"] == side]
            )
            for side in ("buyside", "sellside")
        },
        "order_blocks": {
            side: _order_block_events(bars, order_blocks, side, swing_points, ob_length)
            for side in ("bullish", "bearish")
        },
        "killzones": _killzones(frame),
        "fibonacci": _by_idx(fib_events),
    }
    return _jsonable(result)

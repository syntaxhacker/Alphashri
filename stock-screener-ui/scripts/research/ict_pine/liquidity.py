"""Liquidity clusters from LuxAlgo's ``ict.pine`` (CC BY-NC-SA 4.0).

Pine builds equal-price bands from confirmed zigzag pivots (``draw()`` lines
365-463) and ages them on later bars (lines 821-857). A band is only emitted
once a pivot is confirmed, so a scan truncated before that bar never sees it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

DEFAULT_MARGIN = 4.0
DEFAULT_LENGTH = 5  # Market Structures len (ict.pine:25), passed to draw() at line 527
DEFAULT_ATR_PERIOD = 10
DEFAULT_VIS_LIQ = 2
PIVOT_LIMIT = 50

_HIGH_KEYS = ("direction", "d", "side", "type")
_IDX_KEYS = ("idx", "x", "bar_index", "index", "i")
_PRICE_KEYS = ("price", "y", "value", "level")
_HIGH_WORDS = {1, "1", "high", "ph", "pivothigh", "buyside", "sellside high"}
_LOW_WORDS = {-1, "-1", "low", "pl", "pivotlow", "sellside", "buyside low"}


def _field(obj: Any, names: Sequence[str], default: Any = None) -> Any:
    for name in names:
        if isinstance(obj, Mapping) and name in obj:
            return obj[name]
        if hasattr(obj, name):
            return getattr(obj, name)
    return default


def _bar_field(bar: Any, name: str, default: float = 0.0) -> float:
    value = _field(bar, ({"o": "open", "h": "high", "l": "low", "c": "close"}.get(name, name), name), default)
    return float(value)


def _normalise_bars(bars: Sequence[Any]) -> list[dict[str, float]]:
    out = []
    for bar in bars:
        out.append({
            "open": _bar_field(bar, "o"),
            "high": _bar_field(bar, "h"),
            "low": _bar_field(bar, "l"),
            "close": _bar_field(bar, "c"),
        })
    return out


def atr_values(bars: Sequence[Any], period: int = DEFAULT_ATR_PERIOD) -> list[float]:
    """Wilder ATR with an SMA seed, matching ``ta.atr(period)``."""
    rows = _normalise_bars(bars)
    if not rows:
        return []
    trs: list[float] = []
    for i, row in enumerate(rows):
        if i == 0:
            trs.append(row["high"] - row["low"])
        else:
            prev_close = rows[i - 1]["close"]
            trs.append(max(
                row["high"] - row["low"],
                abs(row["high"] - prev_close),
                abs(row["low"] - prev_close),
            ))
    out: list[float] = []
    running = 0.0
    for i, tr in enumerate(trs):
        if i < period:
            running += tr
            out.append(running / (i + 1))
        else:
            running = (running * (period - 1) / period) + tr
            out.append(running)
    return out


def _direction(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if value in _HIGH_WORDS:
        return 1
    if value in _LOW_WORDS:
        return -1
    return None


def _pivot(obj: Any) -> tuple[int, float, int] | None:
    """Accept dicts, objects and ``(idx, price, direction)`` tuples."""
    if isinstance(obj, (tuple, list)) and len(obj) >= 3:
        first, second, third = obj[0], obj[1], obj[2]
        if _direction(first) is not None and isinstance(second, (int, float)):
            direction = _direction(first)
            idx, price = int(second), float(third)
        else:
            idx, price, direction = int(first), float(second), _direction(third)
        return (idx, price, direction) if direction is not None else None
    idx = _field(obj, _IDX_KEYS)
    price = _field(obj, _PRICE_KEYS)
    direction = _direction(_field(obj, _HIGH_KEYS))
    if idx is None or price is None or direction is None:
        return None
    return int(idx), float(price), direction


def pivots_from_bars(bars: Sequence[Any], left: int = DEFAULT_LENGTH) -> list[dict[str, Any]]:
    """Zigzag pivots at ``pivothigh(high, left, 1)`` / ``pivotlow(low, left, 1)``.

    Newest first, alternating direction; a new extreme replaces the last point
    of the same direction. This is the array ``aZZ`` used by ``draw()``.
    """
    rows = _normalise_bars(bars)
    points: list[dict[str, Any]] = []
    direction = 0  # Pine seeds aZZ.d with zeros, so the first pivot is kept.
    for n in range(1, len(rows)):
        centre = n - 1
        if centre < left:
            continue
        window = rows[centre - left:centre]
        found = 0
        price = 0.0
        if rows[centre]["high"] > max(r["high"] for r in window) and rows[centre]["high"] > rows[n]["high"]:
            found, price = 1, rows[centre]["high"]
        elif rows[centre]["low"] < min(r["low"] for r in window) and rows[centre]["low"] < rows[n]["low"]:
            found, price = -1, rows[centre]["low"]
        if not found:
            continue
        point = {"idx": centre, "price": price, "direction": found}
        if found != direction:
            points.insert(0, point)
            direction = found
        elif (price > points[0]["price"] if found == 1 else price < points[0]["price"]):
            points[0] = point
    return points


def liquidity_zones(
    bars: Sequence[Any],
    pivots: Sequence[Any] | None = None,
    *,
    margin: float = DEFAULT_MARGIN,
    left: int = DEFAULT_LENGTH,
    atr_period: int = DEFAULT_ATR_PERIOD,
    vis_liq: int = DEFAULT_VIS_LIQ,
    atr: float | Sequence[float] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Return ``{"buyside": [...], "sellside": [...]}`` liquidity bands.

    ``margin`` is the Pine input; its divisor is ``a = 10 / margin``. Each band
    spans ``avg(minP, maxP) +/- atr / a`` and carries ``start_idx`` (the first
    swing in the cluster), ``price`` (that swing's price), and ``count``.
    ``pivots`` may be supplied to bypass zigzag derivation.
    """
    rows = _normalise_bars(bars)
    atrs = atr_values(rows, atr_period)
    fixed_atr = float(atr) if isinstance(atr, (int, float)) else None

    def tolerance(idx: int) -> float:
        if fixed_atr is not None:
            value = fixed_atr
        elif atr is not None:
            series = list(atr)
            value = series[min(max(idx + 1, 0), len(series) - 1)] if series else 0.0
        else:
            value = atrs[min(max(idx + 1, 0), len(atrs) - 1)] if atrs else 0.0
        return value * margin / 10.0

    raw = pivots if pivots is not None else pivots_from_bars(rows, left)
    points = [p for p in (_pivot(item) for item in raw) if p is not None]
    points.sort(key=lambda p: p[0])

    bands: dict[str, list[dict[str, Any]]] = {"buyside": [], "sellside": []}
    for k, (anchor_idx, anchor_price, anchor_dir) in enumerate(points):
        tol = tolerance(anchor_idx)
        matches: list[tuple[int, float]] = []
        for idx, price, direction in list(reversed(points[:k + 1]))[:PIVOT_LIMIT]:
            if direction != anchor_dir:
                continue
            if anchor_dir == 1 and price > anchor_price + tol:
                break
            if anchor_dir == -1 and price < anchor_price - tol:
                break
            if anchor_price - tol < price < anchor_price + tol:
                matches.append((idx, price))
        if len(matches) <= 2:
            continue
        start_idx, price = matches[-1]
        mid = (max(p for _, p in matches) + min(p for _, p in matches)) / 2.0
        band = {
            "start_idx": start_idx,
            "price": price,
            "top": round(mid + tol, 10),
            "bottom": round(mid - tol, 10),
            "count": len(matches),
        }
        side = "buyside" if anchor_dir == 1 else "sellside"
        current = bands[side]
        if current and current[0]["start_idx"] == start_idx:
            current[0] = band
        else:
            current.insert(0, band)
            del current[vis_liq:]
    return bands


liquidity = liquidity_zones
compute_liquidity = liquidity_zones
detect_liquidity = liquidity_zones

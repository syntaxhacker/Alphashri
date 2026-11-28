"""Support/resistance zones for the chart overlay.

The API passes the exact displayed candle window; this module never extends a
zone to the right of the last candle and never uses a pivot that is not yet
confirmed by its right window.

Algorithm (backend contract):

* Work on the most recent 400 bars (the frame may be longer).
* ATR14 = TR EMA with ``alpha = 1/14`` and ``min_periods=1``.
* Pivot order is 6 on frames of 500+ bars, else 2 (confirmed both sides).
* Cluster highs and lows separately with
  ``mergeTol = clamp(0.6 * ATR, 0.003 * price, 0.02 * price)``.
* A cluster needs >= 2 touches; zones are padded by
  ``max(0.1 * ATR, 0.001 * price)``.
* Overlapping support/resistance zones (> 50% of the smaller zone) merge into
  one ``sr`` zone with summed touches.
* Role follows the last close: a zone below it is support, above is
  resistance, inside is ``sr``.
* A zone breaks after two consecutive closes beyond it by ``0.5 * ATR``, and
  goes stale after 120 bars without a touch.
* At most two supports + two resistances and four zones total, ranked by a
  deterministic score.
"""

from __future__ import annotations

from operator import itemgetter
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from chart_patterns import features
from trading.indicators import DEFAULT_ATR_PERIOD

LOOKBACK_BARS = 400
ATR_PERIOD = DEFAULT_ATR_PERIOD
LARGE_FRAME_BARS = 500
PIVOT_ORDER_LARGE = 6
PIVOT_ORDER_SMALL = 2
MIN_TOUCHES = 2
MAX_ZONES = 4
MAX_PER_SIDE = 2
STALE_BARS = 120
BREAK_CLOSES = 2
BREAK_ATR_MULT = 0.5
PAD_ATR_MULT = 0.1
PAD_PRICE_MIN = 0.001
MERGE_ATR_MULT = 0.6
MERGE_PRICE_MIN = 0.003
MERGE_PRICE_MAX = 0.02
OVERLAP_RATIO = 0.5

_OHLC = ("open", "high", "low", "close")
_WIRE_FIELDS = itemgetter("t", "o", "h", "l", "c")


def _to_frame(candles) -> Optional[pd.DataFrame]:
    """Coerce wire candles (``t/o/h/l/c/v``) or a DataFrame to OHLC columns."""
    if candles is None:
        return None
    if isinstance(candles, pd.DataFrame):
        frame = candles.copy()
        if "t" in frame.columns and not isinstance(frame.index, pd.DatetimeIndex):
            frame = frame.set_index("t")
        rename = {str(col).lower(): col for col in frame.columns}
        try:
            frame = frame.rename(columns={orig: low for low, orig in rename.items()})
        except Exception:
            return None
        if not all(col in frame.columns for col in _OHLC):
            return None
        return frame
    try:
        rows = list(candles)
    except TypeError:
        return None
    if not rows:
        return None
    records: list[dict] = []
    index: list = []
    for i, candle in enumerate(rows):
        if not isinstance(candle, dict):
            return None
        records.append(
            {
                "open": candle.get("o"),
                "high": candle.get("h"),
                "low": candle.get("l"),
                "close": candle.get("c"),
                "volume": candle.get("v"),
            }
        )
        index.append(candle.get("t", i))
    try:
        frame = pd.DataFrame.from_records(records, index=index)
    except Exception:
        return None
    return frame


def _coerce_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _numeric_column(rows: Sequence, key: str) -> np.ndarray:
    try:
        return np.array([row.get(key) for row in rows], dtype=float)
    except (TypeError, ValueError):
        return np.fromiter(
            (_coerce_float(row.get(key)) for row in rows),
            dtype=float,
            count=len(rows),
        )


def _prepare_frame(candles) -> Optional[pd.DataFrame]:
    """Sanitised numeric OHLC frame from wire candles or a DataFrame.

    The wire fast path extracts all five fields in one C-level pass per row,
    avoiding five Python-level dict scans on the chart hot path. Values, index
    and invalid-bar rules are unchanged; odd inputs take the original path.
    """
    if isinstance(candles, pd.DataFrame):
        frame = _to_frame(candles)
        if frame is None:
            return None
        return _sanitize(frame)
    if candles is None:
        return None
    try:
        rows = candles if isinstance(candles, (list, tuple)) else list(candles)
    except TypeError:
        return None
    n = len(rows)
    if n == 0:
        return None
    try:
        try:
            # One C-level pass per row replaces five Python-level dict lookups
            # and keeps the wire index in the same order as the OHLC columns.
            extracted = list(map(_WIRE_FIELDS, rows))
            index = [row[0] for row in extracted]
            columns = zip(*extracted)
            next(columns)  # timestamps are the index, not a numeric column
            opens, highs, lows, closes = (
                np.fromiter(column, dtype=float, count=n) for column in columns
            )
        except (TypeError, ValueError, KeyError):
            # Missing keys, non-dict rows or uncoercible values: the original
            # per-column path defines their NaN/default semantics.
            index: list = []
            for i in range(n):
                candle = rows[i]
                if not isinstance(candle, dict):
                    return None
                index.append(candle.get("t", i))
            opens = _numeric_column(rows, "o")
            highs = _numeric_column(rows, "h")
            lows = _numeric_column(rows, "l")
            closes = _numeric_column(rows, "c")
        finite = (
            np.isfinite(opens)
            & np.isfinite(highs)
            & np.isfinite(lows)
            & np.isfinite(closes)
        )
        positive = (opens > 0.0) & (highs > 0.0) & (lows > 0.0) & (closes > 0.0)
        ordered = highs >= lows
        good = finite & positive & ordered
        values = np.column_stack(
            (
                np.where(good, opens, np.nan),
                np.where(good, highs, np.nan),
                np.where(good, lows, np.nan),
                np.where(good, closes, np.nan),
            )
        )
        return pd.DataFrame(values, index=index, columns=list(_OHLC))
    except Exception:
        return None


def _sanitize(frame: pd.DataFrame) -> pd.DataFrame:
    """Numeric OHLC with invalid bars replaced by NaN (never emitted as data)."""
    out = pd.DataFrame(index=frame.index)
    for column in _OHLC:
        out[column] = pd.to_numeric(frame[column], errors="coerce").astype(float)
    values = out[list(_OHLC)].to_numpy(dtype=float)
    finite = np.isfinite(values).all(axis=1)
    positive = (values > 0.0).all(axis=1)
    ordered = values[:, 1] >= values[:, 2]  # high >= low
    good = finite & positive & ordered
    values[~good] = np.nan
    out.loc[:, list(_OHLC)] = values
    return out


def _last_close(frame: pd.DataFrame) -> Optional[float]:
    for value in reversed(frame["close"].to_numpy(dtype=float)):
        if np.isfinite(value) and value > 0.0:
            return float(value)
    return None


def _atr_value(frame: pd.DataFrame) -> float:
    """ATR14 from the shared helper, with a finite positive fallback."""
    try:
        series = features.atr(frame, ATR_PERIOD)
        value = float(series.iloc[-1]) if len(series) else float("nan")
    except Exception:
        value = float("nan")
    if not np.isfinite(value) or value <= 0.0:
        values = frame[list(_OHLC)].to_numpy(dtype=float)
        highs = values[:, 1]
        lows = values[:, 2]
        ranges = highs - lows
        ranges = ranges[np.isfinite(ranges) & (ranges >= 0.0)]
        value = float(np.median(ranges)) if ranges.size else 0.0
    if not np.isfinite(value) or value < 0.0:
        return 0.0
    return float(value)


def _merge_tolerance(atr: float, price: float) -> float:
    return max(
        MERGE_PRICE_MIN * price,
        min(MERGE_ATR_MULT * atr, MERGE_PRICE_MAX * price),
    )


def _pad(atr: float, price: float) -> float:
    return max(PAD_ATR_MULT * atr, PAD_PRICE_MIN * price)


def _cluster_touches(
    points: Sequence[tuple[int, float]], tolerance: float
) -> list[dict]:
    """Deterministic time-ordered clustering by price proximity.

    A point joins the closest cluster whose running mean is within
    ``tolerance`` (ties favour the lower mean); otherwise it opens a new
    cluster. ``<=`` makes the tolerance boundary inclusive.
    """
    ordered = sorted(points, key=lambda item: (item[0], item[1]))
    clusters: list[dict] = []
    # np.add.reduce on a reusable buffer is the same reduction np.mean uses on
    # the price list, without rebuilding an array on every touch.
    buffer = np.empty(len(ordered), dtype=float)
    for index, price in ordered:
        if not np.isfinite(price):
            continue
        best = None
        best_distance = None
        for cluster in clusters:
            distance = abs(price - cluster["mean"])
            if distance <= tolerance and (
                best_distance is None
                or distance < best_distance
                or (distance == best_distance and cluster["mean"] < best["mean"])
            ):
                best = cluster
                best_distance = distance
        if best is None:
            clusters.append(
                {"prices": [float(price)], "indices": [int(index)], "mean": float(price)}
            )
            continue
        prices = best["prices"]
        prices.append(float(price))
        best["indices"].append(int(index))
        count = len(prices)
        buffer[:count] = prices
        best["mean"] = float(np.add.reduce(buffer[:count]) / count)
    return clusters


def _has_consecutive(flags: np.ndarray, count: int) -> bool:
    run = 0
    for flag in flags:
        run = run + 1 if bool(flag) else 0
        if run >= count:
            return True
    return False


def _is_broken(closes: np.ndarray, last_touch: int, atr: float, kind: str,
               top: float, bottom: float) -> bool:
    if atr <= 0.0 or last_touch + 1 >= closes.size:
        return False
    after = closes[last_touch + 1:]
    finite = np.isfinite(after)
    if not finite.any():
        return False
    threshold = BREAK_ATR_MULT * atr
    below = finite & (after < bottom - threshold)
    above = finite & (after > top + threshold)
    if kind == "support":
        return _has_consecutive(below, BREAK_CLOSES)
    if kind == "resistance":
        return _has_consecutive(above, BREAK_CLOSES)
    return _has_consecutive(below, BREAK_CLOSES) or _has_consecutive(
        above, BREAK_CLOSES
    )


def _date_at(frame: pd.DataFrame, index: int, session: Optional[str]) -> str:
    try:
        value = frame.index[index]
        ts = value if isinstance(value, pd.Timestamp) else pd.Timestamp(value)
        if session and ts.tzinfo is not None:
            ts = ts.tz_convert(session)
        return ts.date().isoformat()
    except Exception:
        return ""


def _time_at(frame: pd.DataFrame, index: int) -> str:
    """Exact bar timestamp (ISO 8601) for intraday zone edges."""
    try:
        value = frame.index[index]
        ts = value if isinstance(value, pd.Timestamp) else pd.Timestamp(value)
        if pd.isna(ts):
            return ""
        return ts.isoformat()
    except Exception:
        return ""


def _is_intraday(timeframe: Optional[str]) -> bool:
    """True for minute/hour frames; date-only zones are enough elsewhere."""
    try:
        from chart_patterns.indicators import is_intraday_timeframe

        return is_intraday_timeframe(timeframe)
    except Exception:
        return False


def _overlap_ratio(left: dict, right: dict) -> float:
    overlap = min(left["top"], right["top"]) - max(left["bottom"], right["bottom"])
    if overlap <= 0.0:
        return 0.0
    height = min(left["top"] - left["bottom"], right["top"] - right["bottom"])
    if height <= 0.0:
        return 0.0
    return overlap / height


def _zone_score(touches: int, bars_since_touch: int, n: int, top: float,
                bottom: float, price: float) -> float:
    """Deterministic strength score: touches, then recency, then tightness."""
    recency = 1.0 - (bars_since_touch / float(max(n, 1)))
    width_ratio = (top - bottom) / max(price, 1e-12)
    tightness = 1.0 - min(max(width_ratio, 0.0), 1.0)
    return round(touches * 1000.0 + recency * 100.0 + tightness * 10.0, 2)


def _role_from_close(zone: dict, last_close: float) -> str:
    """Zone below price -> support; above -> resistance; containing it -> sr."""
    if zone["top"] < last_close:
        return "support"
    if zone["bottom"] > last_close:
        return "resistance"
    return "sr"


def _merge_overlaps(zones: list[dict]) -> list[dict]:
    """Merge support/resistance zones whose overlap is > 50% into ``sr``."""
    if not zones:
        return []
    parent = list(range(len(zones)))

    def _find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def _union(i: int, j: int) -> None:
        root_i, root_j = _find(i), _find(j)
        if root_i != root_j:
            parent[max(root_i, root_j)] = min(root_i, root_j)

    for i, left in enumerate(zones):
        for j in range(i + 1, len(zones)):
            right = zones[j]
            if left["raw_kind"] == right["raw_kind"]:
                continue
            if _overlap_ratio(left, right) > OVERLAP_RATIO:
                _union(i, j)

    groups: dict[int, list[dict]] = {}
    for i, zone in enumerate(zones):
        groups.setdefault(_find(i), []).append(zone)

    merged: list[dict] = []
    for members in groups.values():
        if len(members) == 1:
            merged.append(members[0])
            continue
        kinds = {member["raw_kind"] for member in members}
        entry = {
            "raw_kind": "sr" if len(kinds) > 1 else members[0]["raw_kind"],
            "top": max(member["top"] for member in members),
            "bottom": min(member["bottom"] for member in members),
            "start_date": min(member["start_date"] for member in members),
            "end_date": max(member["end_date"] for member in members),
            "touches": sum(member["touches"] for member in members),
            "last_touch": max(member["last_touch"] for member in members),
        }
        if all("start_time" in member for member in members):
            entry["start_time"] = min(member["start_time"] for member in members)
            entry["end_time"] = max(member["end_time"] for member in members)
        merged.append(entry)
    return merged


def _select_zones(zones: list[dict]) -> list[dict]:
    """Deterministically rank and cap: <=2 per side, <=4 total."""
    ranked = [dict(zone) for zone in zones]
    ranked.sort(
        key=lambda zone: (
            -zone["score"],
            zone.get("_bars_since", 0),
            zone["kind"],
            -zone["top"],
            -zone["bottom"],
        )
    )
    selected: list[dict] = []
    counts = {"support": 0, "resistance": 0}
    remaining: list[dict] = []
    for zone in ranked:
        if zone["kind"] in counts and counts[zone["kind"]] >= MAX_PER_SIDE:
            remaining.append(zone)
            continue
        selected.append(zone)
        if zone["kind"] in counts:
            counts[zone["kind"]] += 1
        if len(selected) >= MAX_ZONES:
            break
    if len(selected) < MAX_ZONES:
        for zone in remaining:
            if zone["kind"] in counts and counts[zone["kind"]] >= MAX_PER_SIDE:
                continue
            selected.append(zone)
            if zone["kind"] in counts:
                counts[zone["kind"]] += 1
            if len(selected) >= MAX_ZONES:
                break
    selected.sort(
        key=lambda zone: (-zone["score"], zone["kind"], -zone["top"], -zone["bottom"])
    )
    for zone in selected:
        # Keep the ranking key internal, but expose the age so labels can admit
        # how old a level is instead of implying a recent touch.
        zone["bars_since_touch"] = int(zone.pop("_bars_since", 0))
    return selected


def _window_pivots(
    values: np.ndarray, order: int, window_start: int, kind: str
) -> list[tuple[int, float]]:
    """Pivot points at/after ``window_start``, scanning only the used slice.

    A pivot at ``i >= window_start`` only reads ``[i - order, i + order]``, so
    starting the scan ``order`` bars before ``window_start`` preserves every
    kept pivot exactly while skipping the unused leading bars of a long frame.
    """
    start = max(0, window_start - order)
    indices = features.pivot_indices(
        values[start:], order, order, kind, nan_tolerant=False
    )
    points: list[tuple[int, float]] = []
    for local_index in indices:
        i = local_index + start
        if i < window_start:
            continue
        value = float(values[i])
        if np.isfinite(value) and value > 0.0:
            points.append((i, value))
    return points


def compute_sr_zones(
    candles,
    *,
    session: Optional[str] = None,
    timeframe: Optional[str] = None,
    market: Optional[str] = None,
) -> list[dict]:
    """Return at most four support/resistance zones for the displayed frame."""
    if session is None and market is not None:
        from chart_patterns.indicators import session_for_market

        session = session_for_market(market)
    frame = _prepare_frame(candles)
    if frame is None or len(frame) < 5:
        return []
    n = len(frame)
    last_close = _last_close(frame)
    if last_close is None:
        return []

    atr = _atr_value(frame.tail(LOOKBACK_BARS))
    tolerance = _merge_tolerance(atr, last_close)
    pad = _pad(atr, last_close)
    order = PIVOT_ORDER_LARGE if n >= LARGE_FRAME_BARS else PIVOT_ORDER_SMALL
    window_start = max(0, n - LOOKBACK_BARS)

    high_values = frame["high"].to_numpy(dtype=float)
    low_values = frame["low"].to_numpy(dtype=float)
    try:
        high_points = _window_pivots(high_values, order, window_start, "high")
        low_points = _window_pivots(low_values, order, window_start, "low")
    except Exception:
        return []

    closes = frame["close"].to_numpy(dtype=float)
    intraday = _is_intraday(timeframe)
    zones: list[dict] = []
    for raw_kind, points in (("resistance", high_points), ("support", low_points)):
        for cluster in _cluster_touches(points, tolerance):
            if len(cluster["prices"]) < MIN_TOUCHES:
                continue
            touches = len(cluster["prices"])
            last_touch = max(cluster["indices"])
            if n - 1 - last_touch > STALE_BARS:
                continue
            top = max(cluster["prices"]) + pad
            bottom = min(cluster["prices"]) - pad
            if not (np.isfinite(top) and np.isfinite(bottom)) or top <= bottom:
                continue
            if _is_broken(closes, last_touch, atr, raw_kind, top, bottom):
                continue
            first_touch = min(cluster["indices"])
            zone = {
                "raw_kind": raw_kind,
                "top": float(top),
                "bottom": float(bottom),
                "start_date": _date_at(frame, first_touch, session),
                "end_date": _date_at(frame, last_touch, session),
                "touches": int(touches),
                "last_touch": int(last_touch),
            }
            if intraday:
                start_time = _time_at(frame, first_touch)
                end_time = _time_at(frame, last_touch)
                if start_time and end_time:
                    zone["start_time"] = start_time
                    zone["end_time"] = end_time
            zones.append(zone)

    zones = _merge_overlaps(zones)
    if not zones:
        return []

    final: list[dict] = []
    for zone in zones:
        kind = zone["raw_kind"]
        if kind != "sr":
            kind = _role_from_close(zone, last_close)
        bars_since = n - 1 - int(zone["last_touch"])
        entry = {
            "kind": kind,
            "top": round(float(zone["top"]), 6),
            "bottom": round(float(zone["bottom"]), 6),
            "start_date": zone["start_date"],
            "end_date": zone["end_date"],
            "touches": int(zone["touches"]),
            "score": _zone_score(
                int(zone["touches"]),
                bars_since,
                n,
                float(zone["top"]),
                float(zone["bottom"]),
                last_close,
            ),
            "_bars_since": bars_since,
        }
        if "start_time" in zone:
            entry["start_time"] = zone["start_time"]
            entry["end_time"] = zone["end_time"]
        final.append(entry)

    # Rank deterministically, cap each side, then fill the remaining slots.
    return _select_zones(final)


__all__ = [
    "ATR_PERIOD",
    "LOOKBACK_BARS",
    "MAX_ZONES",
    "compute_sr_zones",
]

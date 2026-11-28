"""Trendline levels as segment geometry, built from the shared swing/ATR math.

The detector only projects the existing ``chart_patterns`` pivot fit into the
additive ``Level`` contract; it never draws a line of its own and never snaps a
sloping segment into a horizontal level.
"""

from __future__ import annotations

import math
from typing import Any

from chart_patterns import features
from chart_patterns.levels import _date_at, _prepare_frame
from market_levels import (
    RESISTANCE,
    SUPPORT,
    TRENDLINE,
    DetectorSpec,
    Level,
    level_id,
    register,
)

SPEC = DetectorSpec(
    id="trendline",
    version="1",
    kind=TRENDLINE,
    min_bars=30,
    required_inputs=("candles",),
    params_schema={
        "pivots": "3-5 (default 4)",
        "min_touches": ">= 3 (default 3)",
        "tol_atr": "positive ATR multiple (default 0.75)",
        "atr_period": "positive integer (default 14)",
        "lookback_bars": "positive integer (default 400)",
    },
)

LOOKBACK_BARS = 400
ATR_PERIOD = 14
PIVOT_LEFT = 2
PIVOT_RIGHT = 2
DEFAULT_PIVOTS = 4
MIN_PIVOTS = 3
MAX_PIVOTS = 5
MIN_TOUCHES = 3
TOL_ATR = 0.75
MIN_R2 = 0.5
MIN_RELATIVE_SLOPE = 0.005

_SIDES = (("L", SUPPORT, "low"), ("H", RESISTANCE, "high"))


def _int_param(params: dict, name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(params.get(name, default))
    except (TypeError, ValueError, OverflowError):
        return default
    return min(high, max(low, value))


def _float_param(params: dict, name: str, default: float, low: float) -> float:
    try:
        value = float(params.get(name, default))
    except (TypeError, ValueError, OverflowError):
        return default
    return value if math.isfinite(value) and value >= low else default


def _params(ctx: dict[str, Any]) -> dict:
    raw = ctx.get("trendline_params", ctx.get("params"))
    return raw if isinstance(raw, dict) else {}


def _point_records(points, frame, session) -> list[dict]:
    return [
        {
            "index": index,
            "price": price,
            "as_of": _date_at(frame, index, session),
        }
        for index, price in points
    ]


def _fit_side(
    side_points: list[tuple[int, float]],
    frame,
    *,
    pivots: int,
    min_touches: int,
    atr: float,
    tol_atr: float,
    tolerance: float,
    session: Any,
) -> dict | None:
    if len(side_points) < min_touches:
        return None
    fit_points = features.last_n(side_points, pivots)
    fit = features.fit_pivot_line(fit_points)
    if fit is None:
        return None
    slope, intercept, r2 = fit
    span = int(fit_points[-1][0]) - int(fit_points[0][0])
    mean_price = sum(price for _, price in fit_points) / len(fit_points)
    if span <= 0 or not all(
        math.isfinite(value) for value in (slope, intercept, r2, mean_price)
    ):
        return None
    relative_slope = features.relative_slope(slope, span, mean_price)
    if r2 < MIN_R2 or abs(relative_slope) < MIN_RELATIVE_SLOPE:
        return None
    touches_count = features.count_touches(
        side_points, slope, intercept, atr, tol_atr=tol_atr
    )
    touches = [
        (index, price)
        for index, price in side_points
        if abs(price - features.line_value(slope, intercept, index)) <= tolerance
    ]
    if touches_count < min_touches or len(touches) < touches_count:
        return None
    start_index, start_price = touches[0]
    end_index, end_price = touches[-1]
    start_as_of = _date_at(frame, start_index, session)
    end_as_of = _date_at(frame, end_index, session)
    if end_index <= start_index or not start_as_of or not end_as_of:
        return None
    return {
        "start_index": start_index,
        "start_price": start_price,
        "end_index": end_index,
        "end_price": end_price,
        "start_as_of": start_as_of,
        "end_as_of": end_as_of,
        "slope": slope,
        "intercept": intercept,
        "r2": r2,
        "relative_slope": relative_slope,
        "fit_points": fit_points,
        "touches": touches,
        "touches_count": touches_count,
    }


def detect(ctx: dict[str, Any]) -> list[Level]:
    params = _params(ctx)
    pivots = _int_param(params, "pivots", DEFAULT_PIVOTS, MIN_PIVOTS, MAX_PIVOTS)
    min_touches = _int_param(params, "min_touches", MIN_TOUCHES, MIN_TOUCHES, MAX_PIVOTS)
    atr_period = _int_param(params, "atr_period", ATR_PERIOD, 1, 250)
    lookback = _int_param(params, "lookback_bars", LOOKBACK_BARS, 1, 100_000)
    tol_atr = _float_param(params, "tol_atr", TOL_ATR, 0.0)
    if tol_atr <= 0.0:
        return []

    candles = ctx.get("candles")
    frame = _prepare_frame(candles)
    if frame is None or len(frame) < SPEC.min_bars:
        return []
    atr = features.atr_value(frame, atr_period)
    if not math.isfinite(atr) or atr <= 0.0:
        return []
    tolerance = tol_atr * atr

    session = ctx.get("session")
    window_start = max(0, len(frame) - lookback)
    swing_points = features.swing_points(frame, PIVOT_LEFT, PIVOT_RIGHT)
    by_side: dict[str, list[tuple[int, float]]] = {tag: [] for tag, _, _ in _SIDES}
    for index, tag, price in swing_points:
        if index < window_start or not math.isfinite(price) or price <= 0.0:
            continue
        by_side.setdefault(tag, []).append((int(index), float(price)))

    symbol = ctx["symbol"]
    timeframe = ctx["timeframe"]
    as_of = ctx["as_of"]
    levels: list[Level] = []
    for tag, kind, pivot_side in _SIDES:
        fitted = _fit_side(
            by_side.get(tag, []),
            frame,
            pivots=pivots,
            min_touches=min_touches,
            atr=atr,
            tol_atr=tol_atr,
            tolerance=tolerance,
            session=session,
        )
        if fitted is None:
            continue
        strength = min(
            1.0,
            0.6 * min(1.0, fitted["touches_count"] / max(min_touches, pivots))
            + 0.4 * fitted["r2"],
        )
        evidence: dict[str, Any] = {
            "pivot_side": pivot_side,
            "fit_points": _point_records(fitted["fit_points"], frame, session),
            "touch_points": _point_records(fitted["touches"], frame, session),
            "touches": fitted["touches_count"],
            "slope": fitted["slope"],
            "intercept": fitted["intercept"],
            "r2": fitted["r2"],
            "relative_slope": fitted["relative_slope"],
            "atr": atr,
            "atr_period": atr_period,
            "tol_atr": tol_atr,
            "tol_price": tolerance,
            "pivots_used": pivots,
            "lookback_bars": lookback,
            "window_start": window_start,
        }
        levels.append(
            Level(
                id=level_id(
                    TRENDLINE,
                    kind,
                    as_of,
                    start_price=fitted["start_price"],
                    end_price=fitted["end_price"],
                    start_as_of=fitted["start_as_of"],
                    end_as_of=fitted["end_as_of"],
                    extra=pivot_side,
                ),
                symbol=symbol,
                timeframe=timeframe,
                as_of=as_of,
                kind=kind,
                source=TRENDLINE,
                geometry="segment",
                start_price=fitted["start_price"],
                end_price=fitted["end_price"],
                start_as_of=fitted["start_as_of"],
                end_as_of=fitted["end_as_of"],
                strength=strength,
                touches=fitted["touches_count"],
                evidence=evidence,
                detector_version=SPEC.version,
            )
        )
    return levels


register(SPEC, detect)

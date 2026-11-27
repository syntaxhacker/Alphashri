"""Replay / 3D chart family — recorded chains and the futures path, replayed.

Seven builders share one rule: a value that was not recorded is ``None`` and
stays a gap. Nothing is forward-filled, interpolated or zero-substituted here —
the payload carries the hole and the browser leaves it blank.

The three surfaces are Plotly (``positioning_terrain_3d``, ``iv_surface_3d``,
``futures_path_3d``); the replay views are D3. Every label, unit, currency and
strike ladder arrives in the payload or the ``InstrumentSpec`` — no module
constant knows an index level, a strike step or a session clock.
"""

from __future__ import annotations

import math
import re
import statistics
from typing import Any, Iterable, Mapping, Optional, Sequence

from ..contracts import InstrumentSpec
from ..page import panel

__all__ = [
    "positioning_terrain_3d",
    "iv_surface_3d",
    "futures_path_3d",
    "replay_heatmap",
    "replay_pe_focus",
    "top_volume_strikes",
    "event_annotations",
]

_CLOCK_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_TONES = ("pos", "neg", "info", "warn", "muted")
_Z_TRANSFORMS = ("linear", "signed_sqrt")

#: Metric ids the recorded books actually used. Labels are generic option
#: vocabulary, never an instrument literal; a payload can override either the
#: label or the unit per metric.
_TERRAIN_DEFAULTS: dict[str, dict[str, Any]] = {
    "pe_vol": {"label": "PE volume", "side": "pe", "signed": False},
    "pe_oi": {"label": "PE OI change", "side": "pe", "signed": True},
    "ce_vol": {"label": "CE volume", "side": "ce", "signed": False},
    "ce_oi": {"label": "CE OI change", "side": "ce", "signed": True},
}

_HEATMAP_DEFAULTS: dict[str, dict[str, Any]] = {
    "oi": {"label": "OI", "unit_kind": "oi"},
    "vol": {"label": "Volume", "unit_kind": "volume"},
    "volume": {"label": "Volume", "unit_kind": "volume"},
    "prem": {"label": "Premium", "unit_kind": "value"},
    "premium": {"label": "Premium", "unit_kind": "value"},
}

_FUTURES_REGIME_LABELS = {
    "long_buildup": "long buildup",
    "short_buildup": "short buildup",
    "long_unwind": "long unwinding",
    "short_cover": "short covering",
    "flat": "flat",
}

_FUTURES_REGIME_COLORS = {
    "long_buildup": "var(--rv-green)",
    "short_buildup": "var(--rv-red)",
    "long_unwind": "var(--rv-amber)",
    "short_cover": "var(--rv-blue)",
    "flat": "var(--rv-muted)",
}

#: Minimum honest IV surface: at least four clocks, half the cells present and
#: no frame with fewer than two strikes. Below this the builder suppresses the
#: surface rather than interpolating values the recorder never saw.
_IV_MIN_FRAMES = 4
_IV_MIN_CELL_FILL = 0.5
_IV_MIN_STRIKES_PER_FRAME = 2


def _number(value: Any, *, field: str, digits: int = 2) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{field}: expected a number, got {value!r}")
    try:
        num = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field}: expected a number, got {value!r}") from exc
    if not math.isfinite(num):
        raise ValueError(f"{field}: expected a finite number, got {value!r}")
    num = round(num, digits)
    return 0.0 if num == 0 else num


def _series(
    values: Optional[Iterable[Any]],
    *,
    field: str,
    digits: int = 2,
    allow_none: bool = True,
) -> list[Optional[float]]:
    if values is None:
        return []
    out: list[Optional[float]] = []
    for raw in values:
        if raw is None:
            if not allow_none:
                raise ValueError(f"{field}: null is not allowed in this series")
            out.append(None)
        else:
            out.append(_number(raw, field=field, digits=digits))
    return out


def _matrix(rows: Iterable[Iterable[Any]], *, field: str) -> list[list[Optional[float]]]:
    out: list[list[Optional[float]]] = []
    for index, row in enumerate(rows):
        try:
            values = list(row)
        except TypeError as exc:
            raise ValueError(f"{field}[{index}]: expected a row of numbers") from exc
        out.append(_series(values, field=f"{field}[{index}]"))
    return out


def _require_same_length(**series: Sequence[Any]) -> int:
    lengths = {name: len(values) for name, values in series.items()}
    distinct = set(lengths.values())
    if len(distinct) > 1:
        detail = ", ".join(f"{name}={length}" for name, length in lengths.items())
        raise ValueError(f"series lengths must match ({detail})")
    return distinct.pop() if distinct else 0


def _labels(values: Optional[Iterable[Any]], *, field: str) -> list[str]:
    out: list[str] = []
    for value in values or ():
        text = "" if value is None else str(value).strip()
        if not text:
            raise ValueError(f"{field}: labels must be non-empty")
        out.append(text)
    if not out:
        raise ValueError(f"{field}: at least one label is required")
    return out


def _minutes(values: Optional[Iterable[Any]], *, times: Sequence[str]) -> list[int]:
    minutes = [int(_number(value, field="minutes", digits=0)) for value in values or ()]
    if minutes:
        _require_same_length(minutes=minutes, times=times)
        if any(later <= earlier for earlier, later in zip(minutes, minutes[1:])):
            raise ValueError("minutes: must be strictly increasing")
    return minutes


def _strikes(values: Optional[Iterable[Any]], *, spec: InstrumentSpec) -> list[float]:
    strikes = _series(values, field="strikes", digits=spec.price_decimals, allow_none=False)
    if not strikes:
        raise ValueError("strikes: at least one strike is required")
    if len(set(strikes)) != len(strikes):
        raise ValueError("strikes: duplicate strike levels are not allowed")
    if any(strike is None for strike in strikes):  # pragma: no cover - guarded above
        raise ValueError("strikes: null strikes are not allowed")
    return strikes


def _grid(
    rows: Any,
    *,
    field: str,
    strikes: int,
    times: int,
) -> list[list[Optional[float]]]:
    matrix = _matrix(rows or (), field=field)
    if not matrix:
        raise ValueError(f"{field}: at least one row is required")
    if len(matrix) != strikes:
        raise ValueError(f"{field} must have one row per strike ({strikes}), got {len(matrix)}")
    for index, row in enumerate(matrix):
        if len(row) != times:
            raise ValueError(f"{field}[{index}] must have one cell per time ({times}), got {len(row)}")
    return matrix


def _range(matrix: Sequence[Sequence[Optional[float]]]) -> Optional[list[float]]:
    finite = [value for row in matrix for value in row if value is not None]
    if not finite:
        return None
    return [round(min(finite), 3), round(max(finite), 3)]


def _null_count(matrix: Sequence[Sequence[Optional[float]]]) -> int:
    return sum(1 for row in matrix for value in row if value is None)


def _clock(session_open: str, minutes: int) -> str:
    match = _CLOCK_RE.match(str(session_open))
    base = (int(match.group(1)) * 60 + int(match.group(2))) if match else 0
    total = (base + int(minutes)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def _clock_minutes(value: Any, *, field: str) -> int:
    text = str(value or "").strip()
    if not _CLOCK_RE.match(text):
        raise ValueError(f"{field}: expected a HH:MM clock, got {value!r}")
    return int(text[:2]) * 60 + int(text[3:])


def _humanize(metric_id: str) -> str:
    return metric_id.replace("_", " ").strip().capitalize() or "metric"


def _side_color(side: str) -> str:
    if side == "pe":
        return "var(--rv-amber)"
    if side == "ce":
        return "var(--rv-blue)"
    return "var(--rv-muted)"


def _terrain_unit(override: Any, *, signed: bool, spec: InstrumentSpec, interval: str) -> str:
    if override:
        return str(override)
    if signed:
        return f"{spec.oi_unit} change"
    return f"{spec.oi_unit} / {interval}"


def _terrain_options(data: Mapping[str, Any], spec: InstrumentSpec) -> list[dict[str, Any]]:
    raw_metrics = data.get("metrics")
    if not isinstance(raw_metrics, Mapping) or not raw_metrics:
        raise ValueError("metrics: at least one metric matrix is required")
    metrics = {str(metric_id): rows for metric_id, rows in raw_metrics.items()}

    overrides: dict[str, Mapping[str, Any]] = {}
    for raw in data.get("metric_options") or ():
        if not isinstance(raw, Mapping):
            raise ValueError("metric_options: every entry must be a mapping")
        metric_id = str(raw.get("id") or "").strip()
        if not metric_id:
            raise ValueError("metric_options: every entry needs an id")
        if metric_id in overrides:
            raise ValueError(f"metric_options: duplicate id {metric_id!r}")
        if metric_id not in metrics:
            raise ValueError(f"metric_options: {metric_id!r} is not in this payload")
        overrides[metric_id] = raw

    order = list(overrides) + [metric_id for metric_id in metrics if metric_id not in overrides]
    interval = str(data.get("interval_label") or "bucket")
    options: list[dict[str, Any]] = []
    for metric_id in order:
        default = _TERRAIN_DEFAULTS.get(metric_id, {})
        override = overrides.get(metric_id, {})
        label = str(override.get("label") or default.get("label") or _humanize(metric_id))
        side = str(override.get("side") or default.get("side") or "").strip().lower()
        side = {"call": "ce", "put": "pe"}.get(side, side)
        if side not in ("", "ce", "pe"):
            raise ValueError(f"metric_options: unsupported side {side!r} for {metric_id!r}")
        signed = override.get("signed")
        if signed is None:
            signed = bool(default.get("signed", False))
        elif not isinstance(signed, bool):
            raise ValueError(f"metric_options: signed must be a boolean for {metric_id!r}")
        option = {
            "id": metric_id,
            "label": label,
            "side": side,
            "signed": bool(signed),
            "unit": _terrain_unit(
                override.get("unit"), signed=bool(signed), spec=spec, interval=interval
            ),
        }
        options.append(option)
    return options


def positioning_terrain_3d(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 480,
    css_class: str = "",
) -> str:
    times = _labels(data.get("times"), field="times")
    strikes = _strikes(data.get("strikes"), spec=spec)
    minutes = _minutes(data.get("minutes"), times=times)

    options = _terrain_options(data, spec)
    matrices: dict[str, list[list[Optional[float]]]] = {}
    for option in options:
        metric_id = option["id"]
        matrices[metric_id] = _grid(
            data["metrics"][metric_id],
            field=f"metrics[{metric_id}]",
            strikes=len(strikes),
            times=len(times),
        )

    chosen = str(data.get("metric") or options[0]["id"])
    by_id = {option["id"]: option for option in options}
    if chosen not in by_id:
        raise ValueError(f"metric: {chosen!r} is not in this payload")
    selected = by_id[chosen]

    transform = data.get("z_transform")
    if transform is not None and str(transform) not in _Z_TRANSFORMS:
        raise ValueError(f"z_transform: expected one of {_Z_TRANSFORMS}, got {transform!r}")

    focus_raw = data.get("focus_strike")
    focus_strike = (
        None if focus_raw is None else _number(focus_raw, field="focus_strike", digits=spec.price_decimals)
    )
    spot = _series(data.get("spot"), field="spot", digits=spec.price_decimals)
    if spot:
        _require_same_length(spot=spot, times=times)

    x = minutes or list(range(len(times)))
    payload: dict[str, Any] = {
        "times": times,
        "x": x,
        "minutes": minutes,
        "strikes": strikes,
        "metric": chosen,
        "label": selected["label"],
        "unit": selected["unit"],
        "metric_options": options,
        "metrics": matrices,
        "ranges": {metric_id: _range(matrix) for metric_id, matrix in matrices.items()},
        "null_counts": {metric_id: _null_count(matrix) for metric_id, matrix in matrices.items()},
        "shape": {"strikes": len(strikes), "times": len(times)},
        "focus_strike": focus_strike,
        "spot": spot,
        "strike_step": float(spec.strike_step),
        "price_digits": int(spec.price_decimals),
        "currency_symbol": spec.currency_symbol,
        "interval_label": str(data.get("interval_label") or "bucket"),
    }
    if transform is not None:
        payload["z_transform"] = str(transform)

    legend = [
        {
            "color": _side_color(option["side"]),
            "label": f"{option['label']} ({option['unit']})",
        }
        for option in options
    ]
    return panel(
        "positioning_terrain_3d",
        payload,
        spec=spec,
        title=title or "Positioning terrain — time × strike",
        subtitle=subtitle
        or f"Plotly 3D · {selected['label']} in {selected['unit']} · switch metric without rebuilding the grid",
        legend=legend,
        note=note
        or (
            "Each cell is a recorded bucket; a missing chain bucket stays blank and is never "
            f"zero-filled. Heights are in {selected['unit']}."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def iv_surface_3d(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 470,
    css_class: str = "",
) -> str:
    """Time × strike × OTM IV; suppressed when coverage is too thin to be honest."""
    times = _labels(data.get("times"), field="times")
    strikes = _strikes(data.get("strikes"), spec=spec)
    minutes = _minutes(data.get("minutes"), times=times)

    z = _grid(data.get("z"), field="z", strikes=len(strikes), times=len(times))
    for row_index, row in enumerate(z):
        for column, value in enumerate(row):
            if value is not None and value < 0:
                raise ValueError(f"z[{row_index}][{column}]: IV cannot be negative, got {value!r}")

    per_frame = [
        sum(1 for row in z if row[column] is not None) for column in range(len(times))
    ]
    cells = len(strikes) * len(times)
    filled = sum(per_frame)
    coverage = {
        "frames": len(times),
        "cells": cells,
        "filled": filled,
        "pct": round(100 * filled / cells, 1) if cells else 0.0,
        "min_per_frame": min(per_frame) if per_frame else 0,
        "median_per_frame": statistics.median(per_frame) if per_frame else 0,
        "strike_band": [strikes[0], strikes[-1]],
    }
    sufficient = (
        len(times) >= _IV_MIN_FRAMES
        and filled >= _IV_MIN_CELL_FILL * cells
        and coverage["min_per_frame"] >= _IV_MIN_STRIKES_PER_FRAME
    )

    spot = _series(data.get("spot"), field="spot", digits=spec.price_decimals)
    if spot:
        _require_same_length(spot=spot, times=times)

    unit = str(data.get("unit") or "%")
    label = str(data.get("label") or "OTM IV")
    insufficient_note = (
        "Insufficient IV coverage: the recorded clocks do not carry OTM IV across enough "
        "strikes and frames to build an honest surface. No surface is drawn rather than "
        "interpolating values that were never recorded."
    )

    payload: dict[str, Any] = {
        "times": times,
        "x": minutes or list(range(len(times))),
        "minutes": minutes,
        "strikes": strikes,
        "z": z,
        "label": label,
        "unit": unit,
        "coverage": coverage,
        "sufficient": sufficient,
        "insufficient_note": insufficient_note,
        "shape": {"strikes": len(strikes), "times": len(times)},
        "null_count": _null_count(z),
        "spot": spot,
        "strike_step": float(spec.strike_step),
        "price_digits": int(spec.price_decimals),
    }
    legend = (
        [{"color": "var(--rv-text)", "label": "spot path"}]
        if any(value is not None for value in spot)
        else []
    )
    return panel(
        "iv_surface_3d",
        payload,
        spec=spec,
        title=title or "OTM IV surface — time × strike",
        subtitle=subtitle
        or f"Plotly 3D · {label} in {unit} · {coverage['filled']}/{coverage['cells']} cells recorded",
        legend=legend,
        note=note
        or (
            "The payload supplies OTM IV (calls above spot, puts below, ATM averaged by the "
            "producer). A clock with no usable IV leaves a hole; a surface under the coverage "
            "gate is suppressed, never interpolated."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def _futures_points(data: Mapping[str, Any], spec: InstrumentSpec) -> list[dict[str, Any]]:
    raw_points = data.get("points")
    if raw_points is not None:
        if isinstance(raw_points, (str, bytes)) or not isinstance(raw_points, Sequence):
            raise ValueError("points: expected a list of point mappings")
        rows = list(raw_points)
    else:
        price_values = data.get("price", data.get("close"))
        parallel = {
            "t": list(data.get("t") or ()),
            "min": list(data.get("minutes", data.get("min")) or ()),
            "price": list(price_values or ()),
            "oi": list(data.get("oi") or ()),
        }
        provided = {name: values for name, values in parallel.items() if values}
        if not provided:
            raise ValueError("futures_path_3d needs points or parallel arrays")
        lengths = {name: len(values) for name, values in provided.items()}
        if len(set(lengths.values())) > 1:
            detail = ", ".join(f"{name}={length}" for name, length in lengths.items())
            raise ValueError(f"series lengths must match ({detail})")
        count = next(iter(lengths.values()))
        rows = [
            {name: values[index] for name, values in provided.items()}
            for index in range(count)
        ]

    if not rows:
        raise ValueError("futures_path_3d needs at least one point")

    regime_labels = data.get("regime_labels") or {}
    if not isinstance(regime_labels, Mapping):
        raise ValueError("regime_labels: expected a mapping of id -> label")

    points: list[dict[str, Any]] = []
    for index, raw in enumerate(rows):
        if not isinstance(raw, Mapping):
            raise ValueError(f"points[{index}]: expected a mapping, got {raw!r}")
        minute_raw = raw.get("min", raw.get("minutes"))
        minute = (
            None if minute_raw is None else int(_number(minute_raw, field=f"points[{index}].min", digits=0))
        )
        label_raw = raw.get("t")
        if label_raw is None:
            if minute is None:
                raise ValueError(f"points[{index}]: needs a time label or a minute")
            label = _clock(spec.session_open, minute)
        else:
            label = str(label_raw).strip()
            if not label:
                raise ValueError(f"points[{index}]: empty time label")
            if minute is None and _CLOCK_RE.match(label):
                minute = _clock_minutes(label, field=f"points[{index}].t")

        price_raw = raw.get("price", raw.get("close"))
        price = (
            None
            if price_raw is None
            else _number(price_raw, field=f"points[{index}].price", digits=spec.price_decimals)
        )
        oi_raw = raw.get("oi")
        oi = None if oi_raw is None else _number(oi_raw, field=f"points[{index}].oi", digits=2)
        regime_raw = raw.get("regime")
        regime = None if regime_raw is None else str(regime_raw)
        regime_label = (
            str(regime_labels.get(regime) or _FUTURES_REGIME_LABELS.get(regime) or _humanize(regime))
            if regime
            else None
        )
        points.append(
            {
                "t": label,
                "min": minute,
                "price": price,
                "oi": oi,
                "regime": regime,
                "regime_label": regime_label,
            }
        )

    if not any(point["price"] is not None for point in points):
        raise ValueError("futures_path_3d: no recorded price in the payload")
    if not any(point["oi"] is not None for point in points):
        raise ValueError("futures_path_3d: no recorded open interest in the payload")
    known_minutes = [point["min"] for point in points if point["min"] is not None]
    if any(later <= earlier for earlier, later in zip(known_minutes, known_minutes[1:])):
        raise ValueError("points: minutes must be strictly increasing")
    return points


def futures_path_3d(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 460,
    css_class: str = "",
) -> str:
    points = _futures_points(data, spec)
    x: list[Optional[int]] = []
    for index, point in enumerate(points):
        if point["min"] is not None:
            x.append(int(point["min"]))
        elif x:
            x.append(int(x[-1]) + 1 if x[-1] is not None else index)
        else:
            x.append(index)

    price = [point["price"] for point in points]
    oi = [point["oi"] for point in points]
    finite_price = [value for value in price if value is not None]
    finite_oi = [value for value in oi if value is not None]
    regimes = [point["regime"] for point in points]
    legend: list[dict[str, str]] = []
    seen: set[str] = set()
    for point in points:
        regime = point["regime"]
        if not regime or regime in seen:
            continue
        seen.add(regime)
        legend.append(
            {
                "color": _FUTURES_REGIME_COLORS.get(regime, "var(--rv-muted)"),
                "label": point["regime_label"] or _humanize(regime),
            }
        )

    payload: dict[str, Any] = {
        "points": points,
        "x": x,
        "t": [point["t"] for point in points],
        "price": price,
        "oi": oi,
        "regimes": regimes,
        "price_unit": str(data.get("price_unit") or spec.currency),
        "oi_unit": str(data.get("oi_unit") or spec.oi_unit),
        "price_digits": int(spec.price_decimals),
        "currency_symbol": spec.currency_symbol,
        "shape": {"points": len(points)},
        "range": {
            "price": [round(min(finite_price), 3), round(max(finite_price), 3)],
            "oi": [round(min(finite_oi), 3), round(max(finite_oi), 3)],
        },
    }
    return panel(
        "futures_path_3d",
        payload,
        spec=spec,
        title=title or "Futures path — time × OI × price",
        subtitle=subtitle
        or f"Plotly 3D · price on depth · open interest in {payload['oi_unit']}",
        legend=legend,
        note=note
        or (
            "A point without a recorded quote or OI keeps its gap; the path is never "
            "filled across a missing print. Values are in the payload units shown on the axes."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def _heatmap_unit(metric_id: str, override: Mapping[str, Any], data: Mapping[str, Any], spec: InstrumentSpec) -> str:
    if override.get("unit"):
        return str(override["unit"])
    default = _HEATMAP_DEFAULTS.get(metric_id, {})
    kind = default.get("unit_kind")
    if kind == "oi":
        return spec.oi_unit
    if kind == "volume":
        return f"{spec.oi_unit} / {data.get('interval_label') or 'bucket'}"
    if kind == "value":
        return spec.value_unit
    return str(data.get("unit") or "")


def _heatmap_options(data: Mapping[str, Any], spec: InstrumentSpec) -> list[dict[str, Any]]:
    raw_metrics = data.get("metrics")
    if not isinstance(raw_metrics, Mapping) or not raw_metrics:
        raise ValueError("metrics: at least one metric matrix is required")
    metrics = {str(metric_id): rows for metric_id, rows in raw_metrics.items()}

    overrides: dict[str, Mapping[str, Any]] = {}
    for raw in data.get("metric_options") or ():
        if not isinstance(raw, Mapping):
            raise ValueError("metric_options: every entry must be a mapping")
        metric_id = str(raw.get("id") or "").strip()
        if not metric_id:
            raise ValueError("metric_options: every entry needs an id")
        if metric_id in overrides:
            raise ValueError(f"metric_options: duplicate id {metric_id!r}")
        if metric_id not in metrics:
            raise ValueError(f"metric_options: {metric_id!r} is not in this payload")
        overrides[metric_id] = raw

    order = list(overrides) + [metric_id for metric_id in metrics if metric_id not in overrides]
    options: list[dict[str, Any]] = []
    for metric_id in order:
        default = _HEATMAP_DEFAULTS.get(metric_id, {})
        override = overrides.get(metric_id, {})
        signed = override.get("signed", False)
        if not isinstance(signed, bool):
            raise ValueError(f"metric_options: signed must be a boolean for {metric_id!r}")
        option = {
            "id": metric_id,
            "label": str(override.get("label") or default.get("label") or _humanize(metric_id)),
            "signed": signed,
        }
        option["unit"] = _heatmap_unit(metric_id, override, data, spec)
        options.append(option)
    return options


def _spot_path(raw: Any, times: Sequence[str], *, spec: InstrumentSpec) -> dict[str, list[Any]]:
    if raw is None:
        return {"x": [], "price": []}
    index_of = {label: index for index, label in enumerate(times)}

    def index_for(value: Any, *, field: str) -> int:
        if isinstance(value, bool):
            raise ValueError(f"{field}: expected a time label or index, got {value!r}")
        if isinstance(value, (int, float)) and int(value) == value and 0 <= int(value) < len(times):
            return int(value)
        text = str(value)
        if text in index_of:
            return index_of[text]
        raise ValueError(f"{field}: {value!r} is not a recorded time label")

    if isinstance(raw, Mapping):
        price = _series(raw.get("price"), field="spot.price", digits=spec.price_decimals)
        labels = raw.get("t", raw.get("labels"))
        if labels is None:
            x = list(range(len(times)))
        else:
            x = [index_for(value, field="spot.t") for value in labels]
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        rows = list(raw)
        if rows and isinstance(rows[0], (list, tuple)):
            x, prices = [], []
            for row_index, pair in enumerate(rows):
                if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                    raise ValueError(f"spot[{row_index}]: expected [time, price]")
                x.append(index_for(pair[0], field=f"spot[{row_index}].t"))
                prices.append(pair[1])
            price = _series(prices, field="spot.price", digits=spec.price_decimals)
        else:
            price = _series(rows, field="spot.price", digits=spec.price_decimals)
            x = list(range(len(times)))
    else:
        raise ValueError("spot: expected a mapping, a price list or [time, price] pairs")

    _require_same_length(spot_x=x, spot_price=price)
    if x and any(later <= earlier for earlier, later in zip(x, x[1:])):
        raise ValueError("spot.t: time indices must be strictly increasing")
    return {"x": x, "price": price}


def replay_heatmap(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 480,
    css_class: str = "",
) -> str:
    times = _labels(data.get("times"), field="times")
    strikes = _strikes(data.get("strikes"), spec=spec)
    minutes = _minutes(data.get("minutes"), times=times)

    options = _heatmap_options(data, spec)
    matrices: dict[str, list[list[Optional[float]]]] = {}
    for option in options:
        metric_id = option["id"]
        matrices[metric_id] = _grid(
            data["metrics"][metric_id],
            field=f"metrics[{metric_id}]",
            strikes=len(strikes),
            times=len(times),
        )

    chosen = str(data.get("metric") or options[0]["id"])
    by_id = {option["id"]: option for option in options}
    if chosen not in by_id:
        raise ValueError(f"metric: {chosen!r} is not in this payload")
    selected = by_id[chosen]

    focus_raw = data.get("focus_strike")
    focus_strike = (
        None if focus_raw is None else _number(focus_raw, field="focus_strike", digits=spec.price_decimals)
    )
    spot = _spot_path(data.get("spot"), times, spec=spec)

    payload: dict[str, Any] = {
        "times": times,
        "x": minutes or list(range(len(times))),
        "strikes": strikes,
        "metric": chosen,
        "label": selected["label"],
        "unit": selected["unit"],
        "metric_options": options,
        "metrics": matrices,
        "ranges": {metric_id: _range(matrix) for metric_id, matrix in matrices.items()},
        "null_counts": {metric_id: _null_count(matrix) for metric_id, matrix in matrices.items()},
        "shape": {"strikes": len(strikes), "times": len(times)},
        "focus_strike": focus_strike,
        "spot": spot,
        "strike_step": float(spec.strike_step),
        "price_digits": int(spec.price_decimals),
        "currency_symbol": spec.currency_symbol,
        "interval_label": str(data.get("interval_label") or "bucket"),
    }
    legend: list[dict[str, str]] = []
    if focus_strike is not None:
        legend.append({"color": "var(--rv-amber)", "label": "focus strike"})
    if any(value is not None for value in spot["price"]):
        legend.append({"color": "var(--rv-text)", "label": "spot path"})
    return panel(
        "replay_heatmap",
        payload,
        spec=spec,
        title=title or "Replay heatmap — chain time × strike",
        subtitle=subtitle
        or f"{selected['label']} in {selected['unit']} · one column per recorded bucket",
        legend=legend,
        note=note
        or (
            "A cell is drawn only when the bucket recorded it; missing chain minutes and "
            "strikes stay blank rather than falling back to zero."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def replay_pe_focus(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 400,
    css_class: str = "",
) -> str:
    strike = _number(data.get("strike"), field="strike", digits=spec.price_decimals)
    side_raw = data.get("side")
    if side_raw is None and "pe" in data:
        side_raw = "PE"
    side = str(side_raw or "").strip().upper()
    if side not in ("", "PE", "CE"):
        raise ValueError(f"side: expected PE, CE or empty, got {side!r}")

    t = _series(data.get("t"), field="t", digits=0, allow_none=False)
    if len(t) < 2:
        raise ValueError("replay_pe_focus needs at least two timestamps")
    times = [float(value) for value in t]
    if any(later <= earlier for earlier, later in zip(times, times[1:])):
        raise ValueError("t: timestamps must be strictly increasing")

    premium_raw = data.get("premium")
    if premium_raw is None:
        premium_raw = data.get("pe", data.get("ltp"))
    oi = _series(data.get("oi"), field="oi", digits=2)
    premium = _series(premium_raw, field="premium", digits=spec.price_decimals)
    if not premium or not oi:
        raise ValueError("replay_pe_focus needs premium and oi series")
    _require_same_length(t=t, premium=premium, oi=oi)
    if all(value is None for value in premium) and all(value is None for value in oi):
        raise ValueError("replay_pe_focus: premium and oi are both empty")

    volume_raw = data.get("volume", data.get("vol"))
    if (
        isinstance(volume_raw, Sequence)
        and not isinstance(volume_raw, (str, bytes))
        and volume_raw
        and isinstance(volume_raw[0], (list, tuple))
    ):
        by_time: dict[float, Optional[float]] = {}
        for index, pair in enumerate(volume_raw):
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                raise ValueError(f"volume[{index}]: expected [time, value]")
            moment = _number(pair[0], field=f"volume[{index}].t", digits=0)
            by_time[float(moment)] = (
                None if pair[1] is None else _number(pair[1], field=f"volume[{index}].value", digits=2)
            )
        volume = [by_time.get(float(seconds)) for seconds in times]
    else:
        volume = _series(volume_raw, field="volume", digits=2)
    if volume:
        _require_same_length(volume=volume, t=t)

    interval_seconds = data.get("interval_seconds")
    if interval_seconds is not None:
        interval_seconds = int(_number(interval_seconds, field="interval_seconds", digits=0))
        if interval_seconds <= 0:
            raise ValueError("interval_seconds: must be positive")

    payload: dict[str, Any] = {
        "strike": strike,
        "side": side,
        "label": (f"{side} focus" if side else "focus strike"),
        "t": times,
        "premium": premium,
        "oi": oi,
        "volume": volume,
        "premium_unit": str(data.get("premium_unit") or spec.currency),
        "oi_unit": str(data.get("oi_unit") or spec.oi_unit),
        "volume_unit": str(
            data.get("volume_unit")
            or f"{spec.oi_unit} / {data.get('interval_label') or 'bucket'}"
        ),
        "price_digits": int(spec.price_decimals),
        "currency_symbol": spec.currency_symbol,
        "interval_seconds": interval_seconds,
    }
    side_label = f"{side} " if side else ""
    default_title = f"{spec.money(strike, 0)} {side_label}focus".replace("  ", " ")
    legend: list[dict[str, str]] = [
        {"color": "var(--rv-amber)", "label": "premium"},
        {"color": "var(--rv-blue)", "label": "open interest"},
    ]
    if volume:
        legend.append({"color": "var(--rv-muted)", "label": "volume"})
    return panel(
        "replay_pe_focus",
        payload,
        spec=spec,
        title=title or default_title,
        subtitle=subtitle
        or (
            f"premium {spec.currency} · OI in {payload['oi_unit']} · "
            + ("volume below, shared clock" if volume else "shared clock")
        ),
        legend=legend,
        note=note
        or (
            "Premium, OI and volume come from the same recorded snapshots; a missing point "
            "leaves a gap in the line instead of being carried forward."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def top_volume_strikes(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    limit: Optional[int] = None,
    span: int = 1,
    height: int = 340,
    css_class: str = "",
) -> str:
    """Rank the strikes by recorded volume; never invent a missing print."""
    raw_rows = data.get("strikes")
    if raw_rows is None:
        strikes = list(data.get("strike") or ())
        volumes = list(data.get("volume", data.get("cum")) or ())
        if not strikes:
            raise ValueError("top_volume_strikes needs strikes or parallel strike/volume arrays")
        rows = [
            {"strike": strike, "volume": volumes[index] if index < len(volumes) else None}
            for index, strike in enumerate(strikes)
        ]
    else:
        if isinstance(raw_rows, (str, bytes)) or not isinstance(raw_rows, Sequence):
            raise ValueError("strikes: expected a list of mappings")
        rows = list(raw_rows)

    limit_value = limit if limit is not None else data.get("limit")
    if limit_value is not None:
        limit_value = int(_number(limit_value, field="limit", digits=0))
        if limit_value <= 0:
            raise ValueError("limit: must be a positive integer")

    normalised: list[dict[str, Any]] = []
    for index, raw in enumerate(rows):
        if not isinstance(raw, Mapping):
            raise ValueError(f"strikes[{index}]: expected a mapping, got {raw!r}")
        strike = _number(raw.get("strike"), field=f"strikes[{index}].strike", digits=spec.price_decimals)
        volume_raw = raw.get("volume", raw.get("cum"))
        volume = (
            None
            if volume_raw is None
            else _number(volume_raw, field=f"strikes[{index}].volume", digits=2)
        )
        if volume is not None and volume < 0:
            raise ValueError(f"strikes[{index}].volume: volume cannot be negative")
        row: dict[str, Any] = {
            "strike": strike,
            "volume": volume,
            "label": spec.money(strike, 0),
        }
        for key in ("ce", "pe"):
            if raw.get(key) is not None:
                row[key] = _number(raw.get(key), field=f"strikes[{index}].{key}", digits=2)
        normalised.append(row)
    if not normalised:
        raise ValueError("top_volume_strikes needs at least one strike")

    normalised.sort(key=lambda row: (row["volume"] is None, -(row["volume"] or 0.0)))
    if limit_value is not None:
        normalised = normalised[:limit_value]

    unit = str(data.get("unit") or spec.oi_unit)
    payload: dict[str, Any] = {
        "rows": normalised,
        "unit": unit,
        "limit": limit_value,
        "total": len(rows),
        "null_count": sum(1 for row in normalised if row["volume"] is None),
        "price_digits": int(spec.price_decimals),
        "currency_symbol": spec.currency_symbol,
    }
    return panel(
        "top_volume_strikes",
        payload,
        spec=spec,
        title=title or "Highest-volume strikes",
        subtitle=subtitle or f"ranked by recorded volume · {unit}",
        legend=[{"color": "var(--rv-amber)", "label": unit}],
        note=note
        or (
            "Bars are the recorded volume at each strike in the panel payload; a strike "
            "with no volume print is listed last and is not drawn as zero."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def event_annotations(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 220,
    css_class: str = "",
) -> str:
    window_raw = data.get("window") or {}
    if not isinstance(window_raw, Mapping):
        raise ValueError("window: expected a mapping with open/close")
    open_label = str(window_raw.get("open") or spec.session_open)
    close_label = str(window_raw.get("close") or spec.session_close)
    open_min = _clock_minutes(open_label, field="window.open")
    close_min = _clock_minutes(close_label, field="window.close")
    if close_min <= open_min:
        raise ValueError("window: close must be later than open")

    raw_events = data.get("events")
    if not raw_events:
        raise ValueError("event_annotations needs at least one event")
    if isinstance(raw_events, (str, bytes)) or not isinstance(raw_events, Sequence):
        raise ValueError("events: expected a list of mappings")

    events: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_events):
        if not isinstance(raw, Mapping):
            raise ValueError(f"events[{index}]: expected a mapping, got {raw!r}")
        label = str(raw.get("label") or raw.get("title") or "").strip()
        if not label:
            raise ValueError(f"events[{index}]: needs a label or title")
        time_label = str(raw.get("time") or "").strip()
        start_min = _clock_minutes(time_label, field=f"events[{index}].time")
        if not (open_min <= start_min <= close_min):
            raise ValueError(
                f"events[{index}].time: {time_label!r} sits outside the "
                f"{open_label}–{close_label} window"
            )
        end_raw = raw.get("end")
        end_label = None
        end_min = None
        if end_raw is not None:
            end_label = str(end_raw).strip()
            end_min = _clock_minutes(end_label, field=f"events[{index}].end")
            if not (start_min <= end_min <= close_min):
                raise ValueError(
                    f"events[{index}].end: {end_label!r} must sit inside the window and "
                    "not precede the start"
                )
        tone = str(raw.get("tone") or "muted").strip().lower()
        if tone not in _TONES:
            raise ValueError(f"events[{index}].tone: expected one of {_TONES}, got {tone!r}")
        event: dict[str, Any] = {
            "id": str(raw.get("id") if raw.get("id") is not None else index + 1),
            "time": time_label,
            "start_min": start_min,
            "end": end_label,
            "end_min": end_min,
            "label": label,
            "detail": str(raw.get("detail") or ""),
            "tone": tone,
        }
        events.append(event)

    payload: dict[str, Any] = {
        "events": events,
        "window": {
            "open": open_label,
            "close": close_label,
            "open_min": open_min,
            "close_min": close_min,
            "span_minutes": close_min - open_min,
        },
        "count": len(events),
    }
    return panel(
        "event_annotations",
        payload,
        spec=spec,
        title=title or "Event annotations",
        subtitle=subtitle or f"{open_label}–{close_label} · times and labels only",
        legend=[],
        note=note
        or (
            "Every mark is a recorded clock and its label; the ribbon carries no implied "
            "price, volume or P&L."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )

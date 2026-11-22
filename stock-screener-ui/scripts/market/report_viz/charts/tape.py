"""Tape-session charts, the 3D OI surface and the volatility extras.

The nine charts are ported from the 2026-11-18 tape review
(``nifty_tape_report.py``); ``rv_iv`` / ``straddle_1sigma`` come from the
2026-11-17 volatility book.  Every builder is a pure ``panel()`` wrapper: it
takes the series a caller already aligned and never re-samples, re-scales or
substitutes one clock for another.  In particular a tape-LTP spot series and
a snapshot-bar futures series are drawn exactly as supplied — mixing them is a
caller decision, not a chart default.

Missing values stay ``None`` (JSON ``null``) so a chart shows a gap instead of
inventing a zero.  The 3D surface only forward-fills when the caller sets
``forward_fill=True`` and the data says the gap is a carry-forward, never by
default.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any, Iterable, Mapping, Optional, Sequence

from ..contracts import InstrumentSpec
from ..page import panel
from ..theme import palette

__all__ = [
    "tape_spot_futures",
    "tape_basis",
    "tape_oi_pcr",
    "tape_volume",
    "tape_walls",
    "tape_surface",
    "tape_strikes",
    "tape_oi_change",
    "tape_timeline",
    "rv_iv",
    "straddle_1sigma",
]

#: A one-sigma normal move has expected absolute value ``σ·√(2/π) ≈ 0.7979σ``,
#: and that is what an at-the-money straddle prices.  Dividing the straddle by
#: this factor gives the market-implied 1σ move; it is a distribution constant,
#: not an instrument assumption, so it travels with the payload.
SIGMA_PER_STRADDLE = 0.7979

_METRIC_LABELS = {
    "pe_oi": "PE OI",
    "ce_oi": "CE OI",
    "pe_vol": "PE volume",
    "ce_vol": "CE volume",
    "pe_iv": "PE IV",
    "ce_iv": "CE IV",
    "oi": "open interest",
}


def _columnar(
    data: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    keys: Sequence[str],
    chart: str,
) -> dict[str, list[Any]]:
    """Columns from either ``{key: [...]}`` or ``[{key: value}, ...]``.

    The first key is the index (``t`` / ``labels`` / ``x`` / ``strike`` /
    ``label``).  Every other column must be the same length: silently shifting
    a shorter series would draw one clock against another.
    """
    if isinstance(data, Mapping):
        if keys[0] not in data:
            raise ValueError(f"{chart}: missing '{keys[0]}'")
        first = list(data[keys[0]])
        n = len(first)
        cols: dict[str, list[Any]] = {keys[0]: first}
        for key in keys[1:]:
            values = list(data.get(key, [None] * n))
            if len(values) != n:
                raise ValueError(
                    f"{chart}: '{key}' has {len(values)} values but "
                    f"'{keys[0]}' has {n}; align the series before charting"
                )
            cols[key] = values
        return cols
    rows = []
    for row in data:
        if not isinstance(row, Mapping):
            raise TypeError(f"{chart}: record rows must be mappings")
        rows.append(row)
    return {key: [row.get(key) for row in rows] for key in keys}


def _alias(
    data: Mapping[str, Any] | Sequence[Mapping[str, Any]], target: str, alias: str
) -> Mapping[str, Any] | list[Mapping[str, Any]]:
    if isinstance(data, Mapping):
        if target in data or alias not in data:
            return data
        patched = dict(data)
        patched[target] = data[alias]
        return patched
    out = []
    for row in data:
        if not isinstance(row, Mapping) or target in row or alias not in row:
            out.append(row)
        else:
            patched = dict(row)
            patched[target] = row.get(alias)
            out.append(patched)
    return out


def _number(value: Any, chart: str, key: str) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise TypeError(f"{chart}: '{key}' contains a boolean")
    if isinstance(value, int):
        return value
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{chart}: '{key}' contains a non-numeric value {value!r}") from exc


def _numbers(values: Iterable[Any], chart: str, key: str) -> list[float | int | None]:
    return [_number(value, chart, key) for value in values]


def _label(value: Any, chart: str, key: str) -> str:
    if value is None:
        raise ValueError(f"{chart}: '{key}' has an empty label")
    if isinstance(value, str):
        return value
    if isinstance(value, (datetime, time)):
        return value.strftime("%H:%M")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _labels(values: Iterable[Any], chart: str, key: str) -> list[str]:
    return [_label(value, chart, key) for value in values]


def _extra(data: Any, key: str, default: Any = None) -> Any:
    return data.get(key, default) if isinstance(data, Mapping) else default


def _legend(
    default: Iterable[Iterable[str]], legend: Optional[Iterable[Iterable[str]]]
) -> list[tuple[str, str]]:
    return [tuple(item) for item in (legend if legend is not None else default)]


def _title(title: Optional[str], fallback: str) -> str:
    return title or fallback


def tape_spot_futures(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "tape_spot_futures"
    data = _alias(data, "futures", "fut")
    cols = _columnar(data, ("t", "spot", "futures"), chart)
    levels = []
    for level in _extra(data, "levels", ()) or ():
        if not isinstance(level, Mapping) or "value" not in level:
            raise ValueError(f"{chart}: each level needs a value")
        levels.append(
            {
                "label": str(level.get("label") or ""),
                "value": _number(level["value"], chart, "levels"),
                "dash": str(level.get("dash") or "4 4"),
            }
        )
    payload = {
        "t": _labels(cols["t"], chart, "t"),
        "spot": _numbers(cols["spot"], chart, "spot"),
        "futures": _numbers(cols["futures"], chart, "futures"),
        "high": _number(_extra(data, "high"), chart, "high"),
        "high_t": str(_extra(data, "high_t") or ""),
        "low": _number(_extra(data, "low"), chart, "low"),
        "low_t": str(_extra(data, "low_t") or ""),
        "levels": levels,
    }
    pal = palette()
    futures_label = str(spec.meta.get("futures_label") or "futures")
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, f"{spec.name} spot and futures"),
        subtitle=subtitle or f"session path · {spec.price_label}",
        legend=_legend(
            ((pal["text"], f"{spec.name} spot"), (pal["blue"], futures_label)), legend
        ),
        note=note,
        span=span,
        height=height,
    )


def tape_basis(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    """Futures minus spot, in price points (never percent)."""
    chart = "tape_basis"
    cols = _columnar(data, ("t", "basis"), chart)
    payload = {
        "t": _labels(cols["t"], chart, "t"),
        "basis": _numbers(cols["basis"], chart, "basis"),
        "unit": "pts",
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Futures basis"),
        subtitle=subtitle or f"futures − spot · {spec.currency_symbol} points",
        legend=_legend(((pal["amber"], "basis"),), None),
        note=note,
        span=span,
        height=height,
    )


def tape_oi_pcr(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "tape_oi_pcr"
    cols = _columnar(data, ("t", "ce_oi", "pe_oi", "pcr"), chart)
    payload = {
        "t": _labels(cols["t"], chart, "t"),
        "ce_oi": _numbers(cols["ce_oi"], chart, "ce_oi"),
        "pe_oi": _numbers(cols["pe_oi"], chart, "pe_oi"),
        "pcr": _numbers(cols["pcr"], chart, "pcr"),
        "unit": spec.oi_unit,
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Open interest and PCR"),
        subtitle=subtitle or f"{spec.oi_unit} · ratio on the right axis",
        legend=_legend(
            ((pal["red"], "CE OI"), (pal["green"], "PE OI"), (pal["text"], "PCR")),
            legend,
        ),
        note=note,
        span=span,
        height=height,
    )


def tape_volume(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "tape_volume"
    cols = _columnar(data, ("labels", "ce", "pe"), chart)
    payload = {
        "labels": _labels(cols["labels"], chart, "labels"),
        "ce": _numbers(cols["ce"], chart, "ce"),
        "pe": _numbers(cols["pe"], chart, "pe"),
        "unit": spec.oi_unit,
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Volume by bucket"),
        subtitle=subtitle or f"{spec.oi_unit} per bucket",
        legend=_legend(
            ((pal["red"], "CE volume"), (pal["green"], "PE volume")), legend
        ),
        note=note,
        span=span,
        height=height,
    )


def tape_walls(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "tape_walls"
    cols = _columnar(data, ("t", "spot", "max_pain", "call_wall", "put_wall"), chart)
    payload = {
        "t": _labels(cols["t"], chart, "t"),
        "spot": _numbers(cols["spot"], chart, "spot"),
        "max_pain": _numbers(cols["max_pain"], chart, "max_pain"),
        "call_wall": _numbers(cols["call_wall"], chart, "call_wall"),
        "put_wall": _numbers(cols["put_wall"], chart, "put_wall"),
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Max pain and walls"),
        subtitle=subtitle or f"strike ladder · {spec.strike_label}",
        legend=_legend(
            (
                (pal["text"], "spot"),
                (pal["amber"], "max pain"),
                (pal["red"], "call wall"),
                (pal["green"], "put wall"),
            ),
            legend,
        ),
        note=note,
        span=span,
        height=height,
    )


def _metric_label(metric: str) -> str:
    return _METRIC_LABELS.get(metric, metric.replace("_", " ").upper())


def _metric_unit(metric: str, spec: InstrumentSpec) -> str:
    return "%" if metric.endswith("_iv") else spec.oi_unit


def _forward_fill(row: Sequence[Any]) -> list[Any]:
    out: list[Any] = []
    previous: Any = None
    for value in row:
        if value is None:
            out.append(previous)
        else:
            previous = value
            out.append(value)
    return out


def tape_surface(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    metric: Optional[str] = None,
    label: Optional[str] = None,
    unit: Optional[str] = None,
    forward_fill: Optional[bool] = None,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    span: int = 1,
    height: Optional[int] = 380,
) -> str:
    """Time × strike × metric as a Plotly 3D surface.

    ``data`` is ``{x, xlabels, y, z}`` where ``z`` is one row per strike and
    one column per time.  ``None`` cells are preserved as holes; the surface is
    carried forward only when the caller sets ``forward_fill=True`` (or the
    payload itself carries ``"forward_fill": true``), never by default.
    """
    chart = "tape_surface"
    if not isinstance(data, Mapping):
        raise TypeError(f"{chart}: expected a mapping with 'x', 'xlabels', 'y' and 'z'")
    x = list(data.get("x", []))
    xlabels = list(data.get("xlabels", x))
    y = list(data.get("y", []))
    raw_z = data.get("z")
    if raw_z is None:
        raise ValueError(f"{chart}: missing 'z'")
    z = [list(row) for row in raw_z]

    if len(x) != len(xlabels):
        raise ValueError(
            f"{chart}: 'x' has {len(x)} values but 'xlabels' has {len(xlabels)}"
        )
    if len(z) != len(y):
        raise ValueError(f"{chart}: 'z' has {len(z)} rows but 'y' has {len(y)} strikes")
    for index, row in enumerate(z):
        if len(row) != len(x):
            raise ValueError(
                f"{chart}: z row {index} has {len(row)} cells but 'x' has {len(x)}"
            )

    metric = str(metric or data.get("metric") or "pe_oi")
    metric_label = str(label or data.get("label") or _metric_label(metric))
    metric_unit = str(
        unit if unit is not None else data.get("unit") or _metric_unit(metric, spec)
    )
    if forward_fill is None:
        forward_fill = bool(data.get("forward_fill", False))
    cells = [
        [_number(value, chart, "z") for value in row] for row in z
    ]
    if forward_fill:
        cells = [_forward_fill(row) for row in cells]

    payload = {
        "x": _numbers(x, chart, "x"),
        "xlabels": _labels(xlabels, chart, "xlabels"),
        "y": _numbers(y, chart, "y"),
        "z": cells,
        "metric": metric,
        "label": metric_label,
        "unit": metric_unit,
        "forward_fill": bool(forward_fill),
    }
    segments = [f"{spec.strike_label} · time × strike"]
    if metric_unit:
        segments.append(metric_unit)
    if forward_fill:
        segments.append("forward-filled where the source carries a level")
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, f"{metric_label} surface"),
        subtitle=subtitle or " · ".join(segments),
        legend=(),
        note=note,
        span=span,
        height=height,
    )


def tape_strikes(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "tape_strikes"
    cols = _columnar(data, ("strike", "ce_oi", "pe_oi"), chart)
    payload = {
        "strike": _numbers(cols["strike"], chart, "strike"),
        "ce_oi": _numbers(cols["ce_oi"], chart, "ce_oi"),
        "pe_oi": _numbers(cols["pe_oi"], chart, "pe_oi"),
        "unit": spec.oi_unit,
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Largest strikes"),
        subtitle=subtitle or f"total {spec.oi_unit} · {spec.strike_label}",
        legend=_legend(((pal["red"], "CE OI"), (pal["green"], "PE OI")), legend),
        note=note,
        span=span,
        height=height,
    )


def tape_oi_change(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "tape_oi_change"
    cols = _columnar(data, ("strike", "ce_change", "pe_change"), chart)
    payload = {
        "strike": _numbers(cols["strike"], chart, "strike"),
        "ce_change": _numbers(cols["ce_change"], chart, "ce_change"),
        "pe_change": _numbers(cols["pe_change"], chart, "pe_change"),
        "unit": spec.oi_unit,
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Open-interest change by strike"),
        subtitle=subtitle or f"first → last snapshot · {spec.oi_unit}",
        legend=_legend(((pal["red"], "CE ΔOI"), (pal["green"], "PE ΔOI")), legend),
        note=note,
        span=span,
        height=height,
    )


def tape_timeline(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 2,
    height: Optional[int] = None,
) -> str:
    """Session legs as a ribbon: ``start``/``duration`` in minutes from open.

    ``data`` may be ``[{label, start, duration, change}, ...]`` or the same
    columns as a mapping; ``dur`` is accepted for the legacy column name.
    """
    chart = "tape_timeline"
    data = _alias(data, "duration", "dur")
    cols = _columnar(data, ("label", "start", "duration", "change"), chart)
    payload = {
        "label": _labels(cols["label"], chart, "label"),
        "start": _numbers(cols["start"], chart, "start"),
        "duration": _numbers(cols["duration"], chart, "duration"),
        "change": _numbers(cols["change"], chart, "change"),
        "session_open": spec.session_open,
        "session_close": spec.session_close,
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Event timeline"),
        subtitle=subtitle
        or f"bar length = duration · label = net change · clock from {spec.session_open}",
        legend=_legend(((pal["green"], "up leg"), (pal["red"], "down leg")), legend),
        note=note,
        span=span,
        height=height,
    )


def rv_iv(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    """ATM implied vol against same-window realised vol, in vol points.

    Both series are accepted exactly as recorded: ``iv`` (ATM average) and
    ``rv`` (realised) must share the caller's window, and warm-up rows should
    already be dropped.  ``None`` stays blank.
    """
    chart = "rv_iv"
    cols = _columnar(data, ("t", "iv", "rv"), chart)
    payload = {
        "t": _labels(cols["t"], chart, "t"),
        "iv": _numbers(cols["iv"], chart, "iv"),
        "rv": _numbers(cols["rv"], chart, "rv"),
        "unit": "%",
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "IV vs realised vol"),
        subtitle=subtitle or "same window · shaded area = variance premium",
        legend=_legend(((pal["blue"], "IV"), (pal["amber"], "realised")), legend),
        note=note,
        span=span,
        height=height,
    )


def straddle_1sigma(
    data: Any,
    *,
    spec: InstrumentSpec,
    sigma_factor: float = SIGMA_PER_STRADDLE,
    title: Optional[str] = None,
    subtitle: str = "",
    note: str = "",
    legend: Optional[Iterable[Iterable[str]]] = None,
    span: int = 1,
    height: Optional[int] = None,
) -> str:
    chart = "straddle_1sigma"
    cols = _columnar(data, ("t", "straddle", "realised"), chart)
    if sigma_factor <= 0:
        raise ValueError(f"{chart}: sigma_factor must be positive")
    payload = {
        "t": _labels(cols["t"], chart, "t"),
        "straddle": _numbers(cols["straddle"], chart, "straddle"),
        "realised": _numbers(cols["realised"], chart, "realised"),
        "sigma_factor": float(sigma_factor),
        "unit": spec.currency_symbol,
    }
    pal = palette()
    return panel(
        chart,
        payload,
        spec=spec,
        title=_title(title, "Straddle 1σ vs realised move"),
        subtitle=subtitle or f"1σ = straddle ÷ {sigma_factor:g} · {spec.currency_symbol} points",
        legend=_legend(
            ((pal["amber"], "1σ implied"), (pal["blue"], "realised move")), legend
        ),
        note=note,
        span=span,
        height=height,
    )

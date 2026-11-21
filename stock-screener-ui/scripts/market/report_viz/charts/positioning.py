"""Positioning / participant-flow panels.

Net open-interest change is the subject of this family: which side was built,
where on the ladder, and who carried the move.  Every builder returns the panel
HTML from :func:`report_viz.page.panel`; the browser renderer is registered in
``assets/positioning.js`` under the same chart name.

Payload rules shared with the rest of the library:

* ``spec`` travels with the payload and is the only source of currency, strike
  step, OI unit and session clock.  No module-level instrument constants.
* ``None`` means *no print*.  It is never coerced to ``0`` and never drawn as a
  zero-length bar, a zero bubble or a zero cell.
* Net OI keeps its sign.  ``abs`` is used only where the chart's own subject is
  a magnitude (the class stream's ``Σ|ΔOI|`` and display-axis extents).
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

from ..contracts import InstrumentSpec
from ..page import panel
from ..theme import palette

#: Palette keys used to colour participant classes, in stack order.
_CLASS_TONES = ("green", "red", "blue", "violet", "amber", "muted")


# ---------------------------------------------------------------------------
# payload helpers
# ---------------------------------------------------------------------------


def _number(value: Any, field: str) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number, got {value!r}") from None
    if isinstance(value, bool) or not math.isfinite(out):
        raise ValueError(f"{field} must be a finite number, got {value!r}")
    return out


def _optional_number(value: Any, field: str) -> float | None:
    return None if value is None else _number(value, field)


def _text(value: Any, field: str, *, default: str | None = None) -> str:
    if value is None:
        if default is not None:
            return default
        raise ValueError(f"{field} is required")
    text = str(value).strip()
    if not text:
        if default is not None:
            return default
        raise ValueError(f"{field} is required")
    return text


def _positive(value: Any, field: str) -> float:
    out = _number(value, field)
    if out <= 0:
        raise ValueError(f"{field} must be > 0, got {out}")
    return out


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _scaled(value: Any, divisor: float, field: str, digits: int = 2) -> float | None:
    out = _optional_number(value, field)
    return None if out is None else round(out / divisor, digits)


def _magnitude(value: Any, divisor: float, field: str, digits: int = 2) -> float | None:
    """Magnitude for the class stream; the only signed-to-unsigned conversion."""
    out = _scaled(value, divisor, field, digits)
    return None if out is None else abs(out)


def _first_present(row: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if row.get(key) is not None:
            return row[key]
    return None


def _unique(values: Sequence[float], field: str) -> None:
    if len(set(values)) != len(values):
        raise ValueError(f"{field} must be unique")


def _rgba(hex_color: str, alpha: float) -> str:
    raw = hex_color.lstrip("#")
    r, g, b = int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    return f"rgba({r},{g},{b},{alpha:g})"


def _session(spec: InstrumentSpec) -> dict[str, str]:
    return {
        "open": spec.session_open,
        "close": spec.session_close,
        "timezone": spec.timezone,
    }


def _nearest_strike(value: float, step: float) -> float:
    step = _positive(step, "strike_step")
    return float(math.floor(value / step + 0.5) * step)


def _axis_abs(values: Iterable[float | None]) -> float | None:
    present = [abs(value) for value in values if value is not None]
    return max(present) if present else None


def _class_list(
    classes: Iterable[Any] | None,
    p: Mapping[str, Any],
    observed: Iterable[str] = (),
) -> list[dict[str, str]]:
    """Normalise class descriptors and attach palette-derived colours.

    A class may carry ``{"id", "label", "tone"}``; ``tone`` picks a palette
    anchor.  Without an explicit tone the stack order assigns one.
    """
    items = list(classes) if classes else [{"id": cid} for cid in observed]
    out: list[dict[str, str]] = []
    for index, item in enumerate(items):
        if isinstance(item, Mapping):
            cid = _text(item.get("id"), "class id")
            label = _text(item.get("label"), "class label", default=cid)
            short = _text(item.get("short"), "class short", default=label)
            tone = item.get("tone")
        else:
            cid = _text(item, "class id")
            label = cid
            short = cid
            tone = None
        color = p[tone] if tone in _CLASS_TONES else p[_CLASS_TONES[index % len(_CLASS_TONES)]]
        if len(short) > 12:
            short = short[:11] + "…"
        out.append({"id": cid, "label": label, "short": short, "color": color})
    if len({item["id"] for item in out}) != len(out):
        raise ValueError("class ids must be unique")
    return out


# ---------------------------------------------------------------------------
# 1. CE vs PE net positioning (the named missing chart)
# ---------------------------------------------------------------------------


def ce_pe_net_positioning(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    unit: str | None = None,
    scale: float = 1.0,
    title: str = "CE vs PE net positioning",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 300,
) -> str:
    """Signed net ΔOI per bucket, calls and puts on one shared signed axis.

    ``rows`` carry ``t``, ``ce`` and ``pe`` (net ΔOI) and an optional ``spot``.
    A bucket flagged ``gap`` — or one where both sides are missing — is kept as
    a gap: neither side is drawn as a zero bar.
    """
    source = list(rows)
    if not source:
        raise ValueError("ce_pe_net_positioning needs at least one bucket")

    divisor = _positive(scale, "scale")
    has_spot = any(row.get("spot") is not None for row in source)

    times: list[str] = []
    ce: list[float | None] = []
    pe: list[float | None] = []
    spot: list[float | None] = []
    gaps: list[bool] = []

    for row in source:
        times.append(_text(row.get("t"), "t"))
        if row.get("gap"):
            ce_value, pe_value = None, None
        else:
            ce_value = _scaled(_first_present(row, "ce", "d_ce_oi"), divisor, "ce")
            pe_value = _scaled(_first_present(row, "pe", "d_pe_oi"), divisor, "pe")
        ce.append(ce_value)
        pe.append(pe_value)
        gaps.append(bool(row.get("gap")) or (ce_value is None and pe_value is None))
        if has_spot:
            spot.append(_round(_optional_number(row.get("spot"), "spot"), 2))

    if _axis_abs(ce + pe) is None:
        raise ValueError("ce_pe_net_positioning needs at least one net OI value")

    data: dict[str, Any] = {
        "t": times,
        "ce": ce,
        "pe": pe,
        "gaps": gaps,
        "unit": unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
        "spot_label": spec.name,
        "session": _session(spec),
    }
    if has_spot:
        data["spot"] = spot

    if subtitle is None:
        subtitle = "net ΔOI per bucket · both sides on one signed scale"
        if has_spot:
            subtitle += f" · line = {spec.name} spot"

    p = palette()
    legend = [
        {"color": _rgba(p["green"], 0.9), "label": "CE net ΔOI"},
        {"color": _rgba(p["red"], 0.9), "label": "PE net ΔOI"},
    ]
    if has_spot:
        legend.append({"color": p["amber"], "label": f"{spec.name} spot"})

    return panel(
        "ce_pe_net_positioning",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=legend,
        note="Net ΔOI keeps its sign; a bucket with no prints is a gap, never a zero.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 2. CE vs PE divergence at one strike
# ---------------------------------------------------------------------------


def ce_pe_divergence(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    label: str = "",
    unit: str | None = None,
    scale: float = 1.0,
    limit: int | None = None,
    spot_start: float | None = None,
    spot_end: float | None = None,
    title: str = "CE vs PE divergence by strike",
    subtitle: str | None = None,
    span: int = 1,
    height: int | None = None,
) -> str:
    """Signed call vs put ΔOI at the same strikes, ranked by divergence.

    A missing side stays ``None``: the strike is still listed, but that side has
    no bar.  Ranking is ``|ΔPE − ΔCE|`` — pure magnitude for ordering only.
    """
    divisor = _positive(scale, "scale")
    if limit is not None and limit <= 0:
        raise ValueError("limit must be positive or None")

    parsed: list[dict[str, Any]] = []
    for row in rows:
        ce_value = _scaled(_first_present(row, "ce", "d_ce_oi"), divisor, "ce")
        pe_value = _scaled(_first_present(row, "pe", "d_pe_oi"), divisor, "pe")
        if ce_value is None and pe_value is None:
            continue
        parsed.append(
            {
                "strike": _number(row.get("strike"), "strike"),
                "ce": ce_value,
                "pe": pe_value,
                "ce_oi": _scaled(_first_present(row, "ce_oi"), divisor, "ce_oi"),
                "pe_oi": _scaled(_first_present(row, "pe_oi"), divisor, "pe_oi"),
            }
        )
    if not parsed:
        raise ValueError("ce_pe_divergence needs at least one strike with a value")

    def divergence_key(item: Mapping[str, Any]) -> float:
        if item["ce"] is None or item["pe"] is None:
            return -1.0
        return abs(float(item["pe"]) - float(item["ce"]))

    parsed.sort(key=divergence_key, reverse=True)
    if limit is not None:
        parsed = parsed[:limit]

    ext = _axis_abs(
        [item[key] for item in parsed for key in ("ce", "pe")]
    )
    if ext is None:
        raise ValueError("ce_pe_divergence needs at least one divergence value")

    data = {
        "label": _text(label, "label", default="selected window"),
        "strikes": [item["strike"] for item in parsed],
        "ce": [item["ce"] for item in parsed],
        "pe": [item["pe"] for item in parsed],
        "ce_oi": [item["ce_oi"] for item in parsed],
        "pe_oi": [item["pe_oi"] for item in parsed],
        "axis_abs": ext,
        "unit": unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
        "session": _session(spec),
    }
    if spot_start is not None:
        data["spot_start"] = _round(_number(spot_start, "spot_start"), 2)
    if spot_end is not None:
        data["spot_end"] = _round(_number(spot_end, "spot_end"), 2)

    if subtitle is None:
        subtitle = "ranked by |ΔPE − ΔCE| · one signed scale per side"

    if height is None:
        height = max(190, 30 * len(parsed) + 40)

    p = palette()
    return panel(
        "ce_pe_divergence",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": _rgba(p["green"], 0.88), "label": "CE ΔOI"},
            {"color": _rgba(p["red"], 0.88), "label": "PE ΔOI"},
        ],
        note="A strike with one missing side keeps that side blank; it is not a zero.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 3. PE OI change by strike × time
# ---------------------------------------------------------------------------


def pe_oi_heatmap(
    labels: Iterable[Any],
    strikes: Iterable[Any],
    matrix: Iterable[Iterable[Any]],
    *,
    spec: InstrumentSpec,
    unit: str | None = None,
    scale: float = 1.0,
    emphasis: float | None = None,
    title: str = "PE OI change by strike × time",
    subtitle: str | None = None,
    span: int = 2,
    height: int | None = None,
) -> str:
    """Signed put ΔOI grid.  ``None`` cells stay blank all the way to the DOM."""
    columns = [_text(item, "time label") for item in labels]
    if not columns:
        raise ValueError("pe_oi_heatmap needs at least one time label")

    strike_values = [_number(strike, "strike") for strike in strikes]
    if not strike_values:
        raise ValueError("pe_oi_heatmap needs at least one strike")
    _unique(strike_values, "strikes")

    rows = [list(row) for row in matrix]
    if len(rows) != len(strike_values):
        raise ValueError(
            f"pe_oi_heatmap matrix has {len(rows)} rows for {len(strike_values)} strikes"
        )

    divisor = _positive(scale, "scale")
    grid: list[list[float | None]] = []
    totals: list[float | None] = []
    for row in rows:
        if len(row) != len(columns):
            raise ValueError(
                f"pe_oi_heatmap row has {len(row)} cells for {len(columns)} columns"
            )
        cells = [_scaled(value, divisor, "cell") for value in row]
        grid.append(cells)
        present = [value for value in cells if value is not None]
        totals.append(_round(sum(present), 2) if present else None)

    emphasis_value = _optional_number(emphasis, "emphasis")
    if emphasis_value is not None and emphasis_value not in strike_values:
        raise ValueError(f"emphasis strike {emphasis_value:g} is not in the grid")

    ext = _axis_abs(value for row in grid for value in row)
    if ext is None:
        raise ValueError("pe_oi_heatmap needs at least one printed cell")

    if subtitle is None:
        subtitle = f"{spec.strike_label} · blank = no print · colour = signed ΔOI"

    data = {
        "labels": columns,
        "strikes": strike_values,
        "matrix": grid,
        "row_totals": totals,
        "axis_abs": ext,
        "unit": unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
        "emphasis": emphasis_value,
    }

    if height is None:
        height = max(280, 52 + 23 * len(strike_values))

    p = palette()
    return panel(
        "pe_oi_heatmap",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["blue"], "label": "puts squared (−)"},
            {"color": p["surface"], "label": "no print (blank cell)"},
            {"color": p["amber"], "label": "puts added (+)"},
        ],
        note=(
            "Blank cells are missing prints and are not zero-filled; a printed 0 "
            "is a real zero and sits on the neutral midpoint."
        ),
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 4. Window bars: strike-by-strike ΔPE / ΔCE
# ---------------------------------------------------------------------------


def positioning_window_bars(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    label: str = "",
    start: str = "",
    end: str = "",
    unit: str | None = None,
    scale: float = 1.0,
    spot_start: float | None = None,
    spot_end: float | None = None,
    title: str = "Window ΔOI by strike",
    subtitle: str | None = None,
    span: int = 2,
    height: int | None = None,
) -> str:
    """Puts and calls at every strike over one window, on a shared ± scale."""
    divisor = _positive(scale, "scale")
    parsed: list[dict[str, Any]] = []
    for row in rows:
        strike = _number(row.get("strike"), "strike")
        d_pe = _scaled(_first_present(row, "d_pe_oi", "pe"), divisor, "d_pe_oi")
        d_ce = _scaled(_first_present(row, "d_ce_oi", "ce"), divisor, "d_ce_oi")
        if d_pe is None and d_ce is None:
            continue
        parsed.append(
            {
                "strike": strike,
                "d_pe_oi": d_pe,
                "d_ce_oi": d_ce,
                "pe_oi": _scaled(_first_present(row, "pe_oi"), divisor, "pe_oi"),
                "ce_oi": _scaled(_first_present(row, "ce_oi"), divisor, "ce_oi"),
            }
        )
    if not parsed:
        raise ValueError("positioning_window_bars needs at least one strike")

    parsed.sort(key=lambda item: item["strike"], reverse=True)
    ext = _axis_abs(
        [item[key] for item in parsed for key in ("d_pe_oi", "d_ce_oi")]
    )
    if ext is None:
        raise ValueError("positioning_window_bars needs at least one ΔOI value")

    window = _text(label, "label", default="selected window")
    data = {
        "label": window,
        "start": _text(start, "start", default=""),
        "end": _text(end, "end", default=""),
        "rows": parsed,
        "axis_abs": ext,
        "unit": unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
        "session": _session(spec),
    }
    if spot_start is not None:
        data["spot_start"] = _round(_number(spot_start, "spot_start"), 2)
    if spot_end is not None:
        data["spot_end"] = _round(_number(spot_end, "spot_end"), 2)

    if subtitle is None:
        subtitle = f"{window} · puts and calls share one ± scale"

    if height is None:
        height = max(240, 24 * len(parsed) + 92)

    p = palette()
    return panel(
        "positioning_window_bars",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": _rgba(p["red"], 0.9), "label": "PE ΔOI"},
            {"color": _rgba(p["green"], 0.9), "label": "CE ΔOI"},
        ],
        note="A side with no print in the window is blank, not a zero bar.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 5. Incremental PE volume vs ΔPE OI
# ---------------------------------------------------------------------------


def volume_vs_net_oi(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    unit: str | None = None,
    volume_unit: str | None = None,
    scale: float = 1.0,
    title: str = "Volume vs net OI",
    subtitle: str | None = None,
    span: int = 1,
    height: int = 320,
) -> str:
    """Put volume on x, Δput OI on y, bubble area proportional to put OI."""
    divisor = _positive(scale, "scale")
    parsed: list[dict[str, Any]] = []
    for row in rows:
        parsed.append(
            {
                "strike": _number(row.get("strike"), "strike"),
                "volume": _scaled(
                    _first_present(row, "volume", "d_pe_vol"), divisor, "volume"
                ),
                "d_oi": _scaled(
                    _first_present(row, "d_oi", "d_pe_oi"), divisor, "d_oi"
                ),
                "oi": _scaled(_first_present(row, "oi", "pe_oi"), divisor, "oi"),
            }
        )
    if not parsed:
        raise ValueError("volume_vs_net_oi needs at least one strike")
    if not any(row["volume"] is not None and row["d_oi"] is not None for row in parsed):
        raise ValueError("volume_vs_net_oi needs volume and ΔOI on at least one strike")

    if subtitle is None:
        subtitle = "bubble = PE OI · right of the pack + on the zero line = traded, not held"

    data = {
        "rows": parsed,
        "unit": unit or spec.oi_unit,
        "volume_unit": volume_unit or unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
    }

    return panel(
        "volume_vs_net_oi",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": palette()["red"], "label": "PE strike"},
            {"color": palette()["muted"], "label": "no net OI change"},
        ],
        note="Bubble size is PE OI, not volume; a missing volume or ΔOI is not plotted.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 6. Σ|ΔOI| by participant class per bucket
# ---------------------------------------------------------------------------


def participant_class_stream(
    buckets: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    classes: Iterable[Any] | None = None,
    unit: str | None = None,
    scale: float = 1.0,
    title: str = "Participant class stream",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 300,
) -> str:
    """Stacked bands of ``Σ|ΔOI|`` per class and bucket.

    ``buckets`` carry ``t`` and either ``values`` (a mapping class→magnitude or
    a list aligned with ``classes``).  This is the one chart whose subject *is*
    a magnitude, so signed inputs are converted with ``abs``.  A gap bucket
    stays entirely blank.
    """
    source = list(buckets)
    if not source:
        raise ValueError("participant_class_stream needs at least one bucket")

    observed: list[str] = []
    for bucket in source:
        values = bucket.get("values")
        if isinstance(values, Mapping):
            for key in values:
                key_text = str(key)
                if key_text not in observed:
                    observed.append(key_text)

    p = palette()
    class_list = _class_list(classes, p, observed)
    if not class_list:
        raise ValueError("participant_class_stream needs at least one class")
    keys = [item["id"] for item in class_list]

    divisor = _positive(scale, "scale")
    times: list[str] = []
    gaps: list[bool] = []
    matrix: dict[str, list[float | None]] = {key: [] for key in keys}

    for bucket in source:
        times.append(_text(bucket.get("t"), "t"))
        gap = bool(bucket.get("gap"))
        gaps.append(gap)
        values = bucket.get("values")
        if gap:
            for key in keys:
                matrix[key].append(None)
            continue
        if isinstance(values, Mapping):
            lookup = values
        elif isinstance(values, Sequence) and not isinstance(values, (str, bytes)):
            if len(values) != len(keys):
                raise ValueError(
                    f"bucket values has {len(values)} cells for {len(keys)} classes"
                )
            lookup = dict(zip(keys, values))
        else:
            lookup = {}
        for key in keys:
            matrix[key].append(_magnitude(lookup.get(key), divisor, key))

    if not any(value is not None for series in matrix.values() for value in series):
        raise ValueError("participant_class_stream needs at least one class value")

    data = {
        "t": times,
        "gaps": gaps,
        "classes": class_list,
        "series": [{"id": key, "values": matrix[key]} for key in keys],
        "unit": unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
        "session": _session(spec),
    }

    if subtitle is None:
        subtitle = "Σ|ΔOI| by class per bucket · band thickness = magnitude"

    return panel(
        "participant_class_stream",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": _rgba(item["color"], 0.78), "label": item["label"]}
            for item in class_list
        ],
        note="This is the only magnitude chart: Σ|ΔOI| discards direction by design.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 7. Class × bucket state map
# ---------------------------------------------------------------------------


def participant_class_heatmap(
    buckets: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    classes: Iterable[Any] | None = None,
    title: str = "Participant class state map",
    subtitle: str | None = None,
    span: int = 2,
    height: int | None = None,
) -> str:
    """One cell per bucket, coloured by the bucket's participant class."""
    source = list(buckets)
    if not source:
        raise ValueError("participant_class_heatmap needs at least one bucket")

    observed: list[str] = []
    for bucket in source:
        state = _first_present(bucket, "state", "class")
        if state is not None:
            state_text = str(state)
            if state_text not in observed:
                observed.append(state_text)

    p = palette()
    class_list = _class_list(classes, p, observed)
    if not class_list:
        raise ValueError("participant_class_heatmap needs at least one class")
    known = {item["id"] for item in class_list}

    times: list[str] = []
    states: list[str | None] = []
    gaps: list[bool] = []
    for bucket in source:
        times.append(_text(bucket.get("t"), "t"))
        gap = bool(bucket.get("gap"))
        state = _first_present(bucket, "state", "class")
        if gap or state is None:
            gaps.append(gap)
            states.append(None)
            continue
        state_text = str(state).strip()
        if state_text not in known:
            raise ValueError(f"unknown participant class {state_text!r}")
        gaps.append(False)
        states.append(state_text)

    data = {
        "t": times,
        "states": states,
        "gaps": gaps,
        "classes": class_list,
        "session": _session(spec),
    }

    if subtitle is None:
        subtitle = "one cell per bucket · blank = no class / recorder gap"

    if height is None:
        height = max(120, 26 * len(class_list) + 58)

    return panel(
        "participant_class_heatmap",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[{"color": item["color"], "label": item["label"]} for item in class_list],
        note="The row label is the class; a bucket lights one row at most.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 8. Focus strike: premium + OI
# ---------------------------------------------------------------------------


def participant_focus(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    strike: float | None = None,
    side: str = "PE",
    spot: float | None = None,
    classes: Iterable[Any] | None = None,
    title: str | None = None,
    subtitle: str | None = None,
    span: int = 1,
    height: int = 300,
) -> str:
    """Premium line and OI area for one strike.

    When ``strike`` is omitted the focus is the strike nearest ``spot`` that is
    actually present in the rows (falling back to the nearest grid strike).  On
    any index or stock book that resolves to the ATM line, without this module
    knowing an instrument level.
    """
    source = list(rows)
    if not source:
        raise ValueError("participant_focus needs at least one bucket")

    side_name = _text(side, "side").upper()
    if side_name not in ("CE", "PE"):
        raise ValueError(f"side must be CE or PE, got {side!r}")

    step = _positive(spec.strike_step, "strike_step")
    present_strikes = sorted(
        {
            _number(row.get("strike"), "strike")
            for row in source
            if row.get("strike") is not None
        }
    )
    spot_value = _optional_number(spot, "spot")
    if spot_value is None:
        for row in source:
            if row.get("spot") is not None:
                spot_value = _number(row.get("spot"), "spot")

    if strike is None:
        if spot_value is not None:
            if present_strikes:
                strike_value = min(present_strikes, key=lambda item: (abs(item - spot_value), item))
            else:
                strike_value = _nearest_strike(spot_value, step)
        elif len(present_strikes) == 1:
            strike_value = present_strikes[0]
        else:
            raise ValueError("participant_focus needs strike or spot")
    else:
        strike_value = _number(strike, "strike")
        if present_strikes and strike_value not in present_strikes:
            raise ValueError(f"focus strike {strike_value:g} is not present in the rows")

    times: list[str] = []
    premium: list[float | None] = []
    oi: list[float | None] = []
    d_oi: list[float | None] = []
    spot_series: list[float | None] = []
    moneyness: list[float | None] = []
    class_ids: list[str | None] = []
    observed_classes: list[str] = []

    for row in source:
        if row.get("strike") is not None and _number(row.get("strike"), "strike") != strike_value:
            continue
        times.append(_text(row.get("t"), "t"))
        premium.append(_round(_optional_number(_first_present(row, "premium", "ltp"), "premium"), 2))
        oi.append(_optional_number(row.get("oi"), "oi"))
        d_oi.append(_optional_number(_first_present(row, "d_oi", "doi"), "d_oi"))
        row_spot = _optional_number(row.get("spot"), "spot")
        spot_series.append(None if row_spot is None else round(row_spot, 2))
        reference = spot_value if row_spot is None else row_spot
        if reference is None:
            moneyness.append(None)
        elif side_name == "CE":
            moneyness.append(round(reference - strike_value, 1))
        else:
            moneyness.append(round(strike_value - reference, 1))
        cls = _first_present(row, "cls", "class")
        cls_text = str(cls).strip() if cls is not None else None
        class_ids.append(cls_text)
        if cls_text and cls_text not in observed_classes:
            observed_classes.append(cls_text)

    if not times:
        raise ValueError(f"focus strike {strike_value:g} has no rows")
    if not any(value is not None for value in premium + oi):
        raise ValueError("participant_focus needs at least one premium or OI value")

    p = palette()
    class_list = _class_list(classes, p, observed_classes) if observed_classes or classes else []

    if title is None:
        title = f"{spec.money(strike_value)} {side_name} focus"
    if subtitle is None:
        subtitle = "line = premium · area = OI · strip = participant class"

    data: dict[str, Any] = {
        "strike": strike_value,
        "side": side_name,
        "label": f"{spec.money(strike_value)} {side_name}",
        "t": times,
        "premium": premium,
        "oi": oi,
        "d_oi": d_oi,
        "moneyness": moneyness,
        "unit": spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "session": _session(spec),
    }
    if any(value is not None for value in spot_series):
        data["spot"] = spot_series
    if class_list:
        data["classes"] = class_list
        data["class_ids"] = class_ids

    legend = [
        {"color": p["blue"], "label": "premium"},
        {"color": _rgba(p["blue"], 0.22), "label": "OI"},
    ]
    legend.extend(
        {"color": _rgba(item["color"], 0.8), "label": item["label"]}
        for item in class_list
    )

    return panel(
        "participant_focus",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=legend,
        note="Moneyness is side-aware: positive is in-the-money for that leg.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 9. Put − call OI terrain
# ---------------------------------------------------------------------------


def strike_terrain(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    unit: str | None = None,
    scale: float = 1.0,
    spot: float | None = None,
    title: str = "Put − call OI terrain",
    subtitle: str | None = None,
    span: int = 1,
    height: int = 280,
) -> str:
    """Signed ``PE OI − CE OI`` at every strike: the book's skew as a terrain."""
    divisor = _positive(scale, "scale")
    parsed: list[dict[str, Any]] = []
    for row in rows:
        strike = _number(row.get("strike"), "strike")
        ce_oi = _scaled(row.get("ce_oi"), divisor, "ce_oi")
        pe_oi = _scaled(row.get("pe_oi"), divisor, "pe_oi")
        net = None if ce_oi is None or pe_oi is None else round(pe_oi - ce_oi, 2)
        parsed.append({"strike": strike, "ce_oi": ce_oi, "pe_oi": pe_oi, "net": net})
    if not parsed:
        raise ValueError("strike_terrain needs at least one strike")
    _unique([row["strike"] for row in parsed], "strikes")
    parsed.sort(key=lambda item: item["strike"])
    if not any(row["net"] is not None for row in parsed):
        raise ValueError("strike_terrain needs CE and PE OI on at least one strike")

    spot_value = _optional_number(spot, "spot")
    atm = None
    if spot_value is not None:
        atm = min((row["strike"] for row in parsed), key=lambda item: (abs(item - spot_value), item))

    data = {
        "strikes": [row["strike"] for row in parsed],
        "net": [row["net"] for row in parsed],
        "ce_oi": [row["ce_oi"] for row in parsed],
        "pe_oi": [row["pe_oi"] for row in parsed],
        "unit": unit or spec.oi_unit,
        "oi_unit": spec.oi_unit,
        "scale": divisor,
        "strike_step": spec.strike_step,
        "session": _session(spec),
    }
    if spot_value is not None:
        data["spot"] = round(spot_value, 2)
        data["atm"] = atm

    if subtitle is None:
        subtitle = "PE OI minus CE OI · above zero = put-heavy strike"

    p = palette()
    return panel(
        "strike_terrain",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["red"], "label": "put-heavy (PE > CE)"},
            {"color": p["green"], "label": "call-heavy (CE > PE)"},
        ],
        note="Net OI is signed; a strike missing either side has no terrain value.",
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 10. Live wall distance ladder
# ---------------------------------------------------------------------------


def wall_ladder(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    title: str = "Live wall distance from spot",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 260,
) -> str:
    """Call / put / max-pain distance in price points, signed around live spot."""
    source = list(rows)
    if not source:
        raise ValueError("wall_ladder needs at least one bucket")

    times: list[str] = []
    spot: list[float | None] = []
    call: list[float | None] = []
    put: list[float | None] = []
    max_pain: list[float | None] = []

    for row in source:
        times.append(_text(row.get("t"), "t"))
        spot_value = _round(_optional_number(row.get("spot"), "spot"), 2)
        spot.append(spot_value)
        if spot_value is None:
            call.append(None)
            put.append(None)
            max_pain.append(None)
            continue
        for target, key in ((call, "call_wall"), (put, "put_wall"), (max_pain, "max_pain")):
            level = _optional_number(row.get(key), key)
            target.append(None if level is None else round(level - spot_value, 1))

    if not any(value is not None for value in call + put + max_pain):
        raise ValueError("wall_ladder needs at least one wall or max-pain level")

    if subtitle is None:
        subtitle = "points from live spot · zero is spot, positive is above"

    p = palette()
    return panel(
        "wall_ladder",
        {
            "t": times,
            "spot": spot,
            "call": call,
            "put": put,
            "max_pain": max_pain,
            "unit": "pts",
            "spot_label": spec.name,
            "session": _session(spec),
        },
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["red"], "label": "call wall gap"},
            {"color": p["green"], "label": "put wall gap"},
            {"color": p["amber"], "label": "max-pain gap"},
        ],
        note="Distances are price points, not percent; a missing level stays a gap.",
        span=span,
        height=height,
    )

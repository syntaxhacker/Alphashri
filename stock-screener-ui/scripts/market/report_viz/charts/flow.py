"""Flow panels: volume stream, ITM put share, strike heatmap, top ITM strikes.

Every builder returns the panel HTML from :func:`report_viz.page.panel`; the
browser renderer lives in ``assets/flow.js`` under the same chart name.
Payloads are plain JSON and use ``None`` for missing data — a blank cell or a
gap in a series is never turned into ``0``.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping

from ..contracts import InstrumentSpec
from ..page import panel
from ..theme import palette




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
        raise ValueError(f"{field} is required")
    return text


def _positive(value: Any, field: str) -> float:
    out = _number(value, field)
    if out <= 0:
        raise ValueError(f"{field} must be > 0, got {out}")
    return out


def _scaled(value: Any, divisor: float, field: str) -> float | None:
    out = _optional_number(value, field)
    return None if out is None else round(out / divisor, 1)


def _round(value: float | None, digits: int = 1) -> float | None:
    return None if value is None else round(value, digits)


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _rgba(hex_color: str, alpha: float) -> str:
    raw = hex_color.lstrip("#")
    r, g, b = int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    return f"rgba({r},{g},{b},{alpha:g})"


def _unique(values: list[float], field: str) -> None:
    if len(set(values)) != len(values):
        raise ValueError(f"{field} must be unique")




def flow_stream(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    unit: str = "units",
    scale: float = 1.0,
    marks: Iterable[Mapping[str, Any]] = (),
    title: str = "CE vs PE volume increments",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 320,
) -> str:
    """Stacked stream of call/put volume increments per bucket.

    ``rows`` carry ``t``, ``ce`` and ``pe``; ``ce_itm`` / ``pe_itm`` are
    optional and split each side into ITM/OTM bands. ``spot`` is optional and
    is drawn on a second, independent axis so the flow path is never rescaled
    by the price range.
    """
    source = list(rows)
    if not source:
        raise ValueError("flow_stream needs at least one bucket")

    divisor = _positive(scale, "scale")
    has_itm = any("ce_itm" in row or "pe_itm" in row for row in source)
    has_spot = any(row.get("spot") is not None for row in source)

    times: list[str] = []
    ce: list[float | None] = []
    pe: list[float | None] = []
    ce_itm: list[float | None] = []
    pe_itm: list[float | None] = []
    spot: list[float | None] = []

    for row in source:
        times.append(_text(row.get("t"), "t"))
        ce.append(_scaled(row.get("ce"), divisor, "ce"))
        pe.append(_scaled(row.get("pe"), divisor, "pe"))
        if has_itm:
            ce_itm.append(_scaled(row.get("ce_itm"), divisor, "ce_itm"))
            pe_itm.append(_scaled(row.get("pe_itm"), divisor, "pe_itm"))
        if has_spot:
            spot.append(_round(_optional_number(row.get("spot"), "spot"), 2))

    data: dict[str, Any] = {
        "t": times,
        "ce": ce,
        "pe": pe,
        "unit": _text(unit, "unit"),
        "spot_label": spec.name,
        "marks": [
            {"t": _text(m.get("t"), "mark t"), "label": _text(m.get("label"), "mark label")}
            for m in marks
        ],
    }
    if has_itm:
        data["ce_itm"] = ce_itm
        data["pe_itm"] = pe_itm
    if has_spot:
        data["spot"] = spot

    if subtitle is None:
        subtitle = "band thickness = volume"
        if has_spot:
            subtitle += f" · thin line = {spec.name} spot"

    p = palette()
    if has_itm:
        legend = [
            {"color": _rgba(p["red"], 0.92), "label": "PE ITM"},
            {"color": _rgba(p["red"], 0.30), "label": "PE OTM"},
            {"color": _rgba(p["green"], 0.80), "label": "CE ITM"},
            {"color": _rgba(p["green"], 0.26), "label": "CE OTM"},
        ]
    else:
        legend = [
            {"color": _rgba(p["red"], 0.55), "label": "PE"},
            {"color": _rgba(p["green"], 0.55), "label": "CE"},
        ]
    if has_spot:
        legend.append({"color": p["amber"], "label": f"{spec.name} spot"})

    return panel(
        "flow_stream",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=legend,
        note=f"Volume in {data['unit']}; a missing bucket is a gap, not a zero.",
        span=span,
        height=height,
    )




def flow_share(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    title: str = "ITM PE share of PE volume",
    subtitle: str = "itm_pe_vol ÷ total_pe_vol per bucket",
    span: int = 2,
    height: int = 240,
) -> str:
    """ITM put share of *put* volume, as a percentage, never of total volume."""
    source = list(rows)
    if not source:
        raise ValueError("flow_share needs at least one bucket")

    times: list[str] = []
    shares: list[float | None] = []
    has_spot = any(row.get("spot") is not None for row in source)
    spot: list[float | None] = []

    for row in source:
        times.append(_text(row.get("t"), "t"))
        share = _optional_number(row.get("share"), "share")
        if share is not None and not 0.0 <= share <= 100.0:
            raise ValueError(f"share must be 0–100%, got {share}")
        shares.append(_round(share, 1))
        if has_spot:
            spot.append(_round(_optional_number(row.get("spot"), "spot"), 2))

    observed = [value for value in shares if value is not None]
    if not observed:
        raise ValueError("flow_share needs at least one share value")

    data: dict[str, Any] = {
        "t": times,
        "share": shares,
        "median": _round(_median(observed), 1),
        "label": "ITM PE share of PE volume",
    }
    if has_spot:
        data["spot"] = spot

    p = palette()
    return panel(
        "flow_share",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["red"], "label": "ITM PE share"},
            {"color": p["muted"], "label": "median"},
        ],
        note=(
            "Share is in-the-money put volume ÷ total put volume for the bucket "
            "— not a share of total option volume."
        ),
        span=span,
        height=height,
    )




def flow_heatmap(
    labels: Iterable[Any],
    strikes: Iterable[Any],
    matrix: Iterable[Iterable[Any]],
    *,
    spec: InstrumentSpec,
    unit: str = "units",
    scale: float = 1.0,
    emphasis: float | None = None,
    title: str = "PE volume by strike × time",
    subtitle: str | None = None,
    span: int = 1,
    height: int | None = None,
) -> str:
    """Strike × time grid.

    ``None`` cells stay ``None`` all the way into the payload; only the
    renderer decides how to draw a blank. A printed ``0`` is data and is
    rendered as the low end of the colour ramp, which is deliberately a
    different visual state from "no print".
    """
    columns = [_text(label, "time label") for label in labels]
    if not columns:
        raise ValueError("flow_heatmap needs at least one time label")

    strike_values = [_number(strike, "strike") for strike in strikes]
    if not strike_values:
        raise ValueError("flow_heatmap needs at least one strike")
    _unique(strike_values, "strikes")

    rows = [list(row) for row in matrix]
    if len(rows) != len(strike_values):
        raise ValueError(
            f"flow_heatmap matrix has {len(rows)} rows for {len(strike_values)} strikes"
        )

    divisor = _positive(scale, "scale")
    grid: list[list[float | None]] = []
    totals: list[float | None] = []
    for row in rows:
        if len(row) != len(columns):
            raise ValueError(
                f"flow_heatmap row has {len(row)} cells for {len(columns)} columns"
            )
        cells = [_scaled(value, divisor, "cell") for value in row]
        grid.append(cells)
        present = [value for value in cells if value is not None]
        totals.append(_round(sum(present), 1) if present else None)

    emphasis_value = _optional_number(emphasis, "emphasis")
    if emphasis_value is not None and emphasis_value not in strike_values:
        raise ValueError(f"emphasis strike {emphasis_value:g} is not in the grid")

    if subtitle is None:
        subtitle = f"{spec.strike_label} · blank = no volume printed"

    data = {
        "labels": columns,
        "strikes": strike_values,
        "matrix": grid,
        "row_totals": totals,
        "unit": _text(unit, "unit"),
        "emphasis": emphasis_value,
    }

    if height is None:
        height = max(260, 46 + 23 * len(strike_values))

    p = palette()
    return panel(
        "flow_heatmap",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["border"], "label": "no print (blank cell)"},
            {"color": p["amber"], "label": "printed volume"},
        ],
        note=(
            "Blank cells are missing prints and are not zero-filled; a printed 0 "
            "is a real zero and renders at the low end of the ramp."
        ),
        span=span,
        height=height,
    )




def flow_top_itm(
    rows: Iterable[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    unit: str = "units",
    scale: float = 1.0,
    limit: int | None = 5,
    title: str = "Top ITM PE strikes",
    subtitle: str = "incremental volume, session",
    span: int = 1,
    height: int | None = None,
) -> str:
    divisor = _positive(scale, "scale")
    if limit is not None and limit <= 0:
        raise ValueError("limit must be positive or None")

    parsed: list[dict[str, Any]] = []
    for row in rows:
        pe_itm = _scaled(row.get("pe_itm"), divisor, "pe_itm")
        if pe_itm is None:
            raise ValueError("flow_top_itm needs pe_itm on every row")
        entry: dict[str, Any] = {
            "strike": _number(row.get("strike"), "strike"),
            "pe_itm": pe_itm,
            "pe": _scaled(row.get("pe"), divisor, "pe"),
            "share": _round(_optional_number(row.get("share"), "share"), 1),
            "itm_share": _round(_optional_number(row.get("itm_share"), "itm_share"), 1),
        }
        parsed.append(entry)

    if not parsed:
        raise ValueError("flow_top_itm needs at least one row")

    parsed.sort(key=lambda item: item["pe_itm"], reverse=True)
    if limit is not None:
        parsed = parsed[:limit]

    total = sum(item["pe_itm"] for item in parsed)
    for item in parsed:
        if item["share"] is None:
            item["share"] = _round(item["pe_itm"] / total * 100.0, 1) if total else 0.0

    if height is None:
        height = max(180, 34 * len(parsed) + 34)

    p = palette()
    return panel(
        "flow_top_itm",
        {
            "rows": parsed,
            "unit": _text(unit, "unit"),
            "share_label": "share of ITM PE",
        },
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[{"color": p["red"], "label": "ITM put volume"}],
        note="Bars are ranked on in-the-money put volume, not on total volume.",
        span=span,
        height=height,
    )

"""Volatility panels: IV smile and wall/max-pain distance from spot.

Both builders are pure: they normalise caller data into a JSON payload and
return the panel HTML. Missing IV quotes stay ``None`` so the renderer can
break the line instead of drawing a fake zero-vol point.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping

from ..contracts import InstrumentSpec
from ..page import panel
from ..theme import palette

_KINDS = {
    "call": "call",
    "put": "put",
    "maxpain": "maxpain",
    "max_pain": "maxpain",
    "level": "other",
    "other": "other",
}

_POINT_DIGITS = 1


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


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _positive(value: Any, field: str) -> float:
    out = _number(value, field)
    if out <= 0:
        raise ValueError(f"{field} must be > 0, got {out}")
    return out


# ---------------------------------------------------------------------------
# 1. IV smile / skew
# ---------------------------------------------------------------------------


def iv_smile(
    points: Iterable[Mapping[str, Any]],
    *,
    spot: float,
    spec: InstrumentSpec,
    title: str = "IV smile / skew around spot",
    subtitle: str | None = None,
    span: int = 1,
    height: int = 300,
) -> str:
    """Call and put implied vol against strike, with the spot marked.

    A strike without a quote keeps ``None``; the renderer draws a gap between
    the neighbouring quoted strikes rather than interpolating through it.
    """
    source = list(points)
    if len(source) < 2:
        raise ValueError("iv_smile needs at least two strikes")

    spot_value = _number(spot, "spot")
    rows: list[dict[str, Any]] = []
    has_delta = False
    for point in source:
        strike = _number(point.get("strike"), "strike")
        ce_iv = _optional_number(point.get("ce_iv"), "ce_iv")
        pe_iv = _optional_number(point.get("pe_iv"), "pe_iv")
        if ce_iv is not None and ce_iv <= 0:
            raise ValueError(f"ce_iv must be positive or None, got {ce_iv} at {strike:g}")
        if pe_iv is not None and pe_iv <= 0:
            raise ValueError(f"pe_iv must be positive or None, got {pe_iv} at {strike:g}")
        ce_delta = _optional_number(point.get("ce_delta"), "ce_delta")
        pe_delta = _optional_number(point.get("pe_delta"), "pe_delta")
        has_delta = has_delta or ce_delta is not None or pe_delta is not None
        rows.append(
            {
                "strike": strike,
                "ce_iv": _round(ce_iv),
                "pe_iv": _round(pe_iv),
                "ce_delta": _round(ce_delta, 4),
                "pe_delta": _round(pe_delta, 4),
            }
        )

    rows.sort(key=lambda row: row["strike"])
    strikes = [row["strike"] for row in rows]
    if len(set(strikes)) != len(strikes):
        raise ValueError("iv_smile strikes must be unique")
    if not any(row["ce_iv"] is not None or row["pe_iv"] is not None for row in rows):
        raise ValueError("iv_smile needs at least one IV quote")

    atm = min(strikes, key=lambda strike: (abs(strike - spot_value), strike))

    data: dict[str, Any] = {
        "strikes": strikes,
        "ce_iv": [row["ce_iv"] for row in rows],
        "pe_iv": [row["pe_iv"] for row in rows],
        "spot": _round(spot_value, spec.price_decimals),
        "atm": _round(atm, spec.price_decimals),
        "spot_label": spec.name,
        "strike_step": _positive(spec.strike_step, "strike_step"),
        "price_decimals": spec.price_decimals,
    }
    if has_delta:
        data["ce_delta"] = [row["ce_delta"] for row in rows]
        data["pe_delta"] = [row["pe_delta"] for row in rows]

    if subtitle is None:
        subtitle = f"{spec.name} · {spec.strike_label} · blank = no quote"

    p = palette()
    return panel(
        "iv_smile",
        data,
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["green"], "label": "CE IV"},
            {"color": p["red"], "label": "PE IV"},
            {"color": p["blue"], "label": "spot"},
        ],
        note=(
            "A strike with no quote is a gap in the smile; nothing is imputed "
            "between quoted strikes."
        ),
        span=span,
        height=height,
    )


# ---------------------------------------------------------------------------
# 2. Wall and max-pain distance from spot
# ---------------------------------------------------------------------------


def levels_distance(
    levels: Iterable[Mapping[str, Any]],
    *,
    spot: float,
    spec: InstrumentSpec,
    title: str = "Wall and max-pain distance from spot",
    subtitle: str | None = None,
    span: int = 1,
    height: int | None = None,
) -> str:
    """Horizontal bars measuring each level's distance from spot.

    ``distance`` is optional; when absent it is derived as ``strike - spot``
    so a caller cannot silently pass a level and a distance that disagree by
    giving neither.
    """
    spot_value = _number(spot, "spot")
    parsed: list[dict[str, Any]] = []
    for level in levels:
        strike = _number(level.get("strike"), "strike")
        kind = _KINDS.get(str(level.get("kind") or "other").strip().lower(), "other")
        distance = _optional_number(level.get("distance"), "distance")
        if distance is None:
            distance = strike - spot_value
        parsed.append(
            {
                "label": _text(
                    level.get("label"),
                    "level label",
                    default=f"{kind} {strike:g}",
                ),
                "kind": kind,
                "strike": strike,
                "distance": _round(distance, _POINT_DIGITS),
                "oi": _optional_number(level.get("oi"), "oi"),
            }
        )

    if not parsed:
        raise ValueError("levels_distance needs at least one level")

    if height is None:
        height = max(220, 34 * len(parsed) + 56)

    if subtitle is None:
        subtitle = "distance is strike − spot · zero line = spot"

    p = palette()
    return panel(
        "levels_distance",
        {
            "levels": parsed,
            "spot": _round(spot_value, spec.price_decimals),
            "unit": "pts",
            "spot_label": spec.name,
            "strike_step": _positive(spec.strike_step, "strike_step"),
            "price_label": spec.price_label,
        },
        spec=spec,
        title=title,
        subtitle=subtitle,
        legend=[
            {"color": p["red"], "label": "call wall"},
            {"color": p["green"], "label": "put wall"},
            {"color": p["amber"], "label": "max pain"},
        ],
        note="Bars run from the spot line; a level above spot is resistance, below is support.",
        span=span,
        height=height,
    )

"""Gamma / GEX chart family.

Four panels share one vocabulary and one rule: a missing value is ``None`` and
stays a gap.  In particular the flagship :func:`gamma_flip_gex` carries *both*
GEX definitions side by side — ``net_gex`` over every strike and ``regime_gex``
summed only over strikes at or below spot — and never substitutes one for the
other.  A flip level that does not exist is ``None`` ("no cross"), not zero.

Every unit, price precision and strike ladder comes from the ``InstrumentSpec``;
nothing here knows a particular index level, a fixed strike ladder or a
hardcoded currency sign.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Optional, Sequence

from ..contracts import InstrumentSpec
from ..page import panel

__all__ = [
    "gamma_flip_gex",
    "gex_profiles",
    "gex_surface",
    "gex_by_strike",
]

_NET_LABEL = "net GEX, all strikes"
_REGIME_LABEL = "cumulative GEX, strikes ≤ spot"
_FLIP_LABEL = "local gamma flip"
_NO_CROSS = "no cross"

# Legend swatches read the shared CSS custom properties, so the module owns no
# second colour source and needs no palette file access while building.
_SPOT_COLOR = "var(--rv-text)"
_FLIP_COLOR = "var(--rv-violet)"
_NET_COLOR = "var(--rv-blue)"
_REGIME_COLOR = "var(--rv-amber)"


def _number(value: Any, *, field: str, digits: int) -> float:
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
    digits: int = 1,
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


def _require_same_length(**series: Sequence[Any]) -> int:
    lengths = {name: len(values) for name, values in series.items()}
    distinct = set(lengths.values())
    if len(distinct) > 1:
        detail = ", ".join(f"{name}={length}" for name, length in lengths.items())
        raise ValueError(f"series lengths must match ({detail})")
    return distinct.pop() if distinct else 0


def _finite(values: Iterable[Optional[float]]) -> list[float]:
    return [float(v) for v in values if v is not None]


def _gex_span(*series: Iterable[Optional[float]]) -> list[float]:
    values = [value for one in series for value in _finite(one)]
    lo = min([0.0, *values])
    hi = max([0.0, *values])
    if lo == hi:
        hi = lo + 1.0
    pad = (hi - lo) * 0.08
    lo, hi = round(lo - pad, 1), round(hi + pad, 1)
    # Rounding a tiny book must not collapse the axis to a point.
    return [lo, hi] if lo != hi else [lo - 0.1, hi + 0.1]


def _scale_mode(*series: Iterable[Optional[float]]) -> str:
    """Symlog only when one print dwarfs the session, as gamma does at the pin."""
    magnitudes = sorted(abs(value) for one in series for value in _finite(one) if value)
    if not magnitudes:
        return "linear"
    median = magnitudes[len(magnitudes) // 2]
    return "symlog" if magnitudes[-1] > 25 * max(median, 1e-9) else "linear"


def _price_span(spot: Iterable[Optional[float]], flip: Iterable[Optional[float]], spec: InstrumentSpec) -> list[float]:
    values = _finite(spot) + _finite(flip)
    if not values:
        raise ValueError("spot series is empty; a price scale cannot be built")
    lo, hi = min(values), max(values)
    if lo == hi:
        hi = lo + max(float(spec.strike_step), 1.0)
    pad = max(float(spec.strike_step) * 0.6, (hi - lo) * 0.06)
    return [round(lo - pad, spec.price_decimals), round(hi + pad, spec.price_decimals)]


def _base_payload(spec: InstrumentSpec) -> dict[str, Any]:
    return {
        "unit": spec.value_unit,
        "strike_step": float(spec.strike_step),
        "price_digits": int(spec.price_decimals),
        "currency_symbol": spec.currency_symbol,
    }


def _define(spec: InstrumentSpec) -> dict[str, dict[str, str]]:
    return {
        "net_gex": {"label": _NET_LABEL, "scope": "all strikes", "unit": spec.value_unit},
        "regime_gex": {"label": _REGIME_LABEL, "scope": "strikes ≤ spot", "unit": spec.value_unit},
    }


def gamma_flip_gex(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 360,
    css_class: str = "",
) -> str:
    """Spot and flip on one price scale, both GEX definitions underneath."""
    t = [str(label) for label in data.get("t") or ()]
    spot = _series(data.get("spot"), field="spot", digits=spec.price_decimals)
    flip = _series(data.get("flip"), field="flip", digits=spec.price_decimals)
    net_gex = _series(data.get("net_gex"), field="net_gex")
    regime_gex = _series(data.get("regime_gex"), field="regime_gex")
    if not t:
        raise ValueError("gamma_flip_gex needs at least one timestamp")
    if not spot:
        raise ValueError("gamma_flip_gex needs a spot series")

    missing = [name for name, series in (("net_gex", net_gex), ("regime_gex", regime_gex)) if not series]
    if missing:
        raise ValueError(
            "gamma_flip_gex needs both GEX definitions explicitly; missing "
            + ", ".join(missing)
            + " (refusing to substitute one definition for the other)"
        )
    _require_same_length(t=t, spot=spot, flip=flip, net_gex=net_gex, regime_gex=regime_gex)

    max_pain = _series(data.get("max_pain"), field="max_pain", digits=spec.price_decimals)
    if max_pain:
        _require_same_length(max_pain=max_pain, spot=spot)

    null_indices = [index for index, value in enumerate(flip) if value is None]
    payload: dict[str, Any] = {
        **_base_payload(spec),
        "t": t,
        "spot": spot,
        "flip": flip,
        "net_gex": net_gex,
        "regime_gex": regime_gex,
        "max_pain": max_pain,
        "definitions": _define(spec),
        "flip_null": null_indices,
        "flip_null_note": _NO_CROSS,
        "domain": {
            "price": _price_span(spot, flip, spec),
            "gex": _gex_span(net_gex, regime_gex),
            "gex_scale": _scale_mode(net_gex, regime_gex),
        },
    }
    return panel(
        "gamma_flip_gex",
        payload,
        spec=spec,
        title=title or "Gamma flip vs spot, and the two GEX definitions",
        subtitle=subtitle
        or "spot and flip share one price scale · lower panel carries the chain-wide and the ≤spot definitions",
        legend=[
            {"color": _SPOT_COLOR, "label": "spot"},
            {"color": _FLIP_COLOR, "label": _FLIP_LABEL},
            {"color": _NET_COLOR, "label": _NET_LABEL},
            {"color": _REGIME_COLOR, "label": _REGIME_LABEL},
        ],
        note=note
        or (
            "The flip is the nearest strike where the local GEX profile turns positive; "
            "a missing flip is “no cross” and is drawn as a gap, never as zero. "
            f"Both GEX lines are in {spec.value_unit}."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def _cumulative(values: Sequence[Optional[float]]) -> list[Optional[float]]:
    total = 0.0
    out: list[Optional[float]] = []
    for value in values:
        if value is None:
            out.append(None)
            continue
        total += value
        out.append(round(total, 1))
    return out


def _profile(raw: Mapping[str, Any], index: int, spec: InstrumentSpec) -> dict[str, Any]:
    strikes = _series(raw.get("strikes"), field=f"profiles[{index}].strikes", digits=spec.price_decimals)
    if any(strike is None for strike in strikes):
        raise ValueError(f"profiles[{index}].strikes: null strikes are not allowed")
    net = _series(raw.get("net_gex"), field=f"profiles[{index}].net_gex")
    if not strikes or not net:
        raise ValueError(f"profiles[{index}] needs strikes and net_gex")
    _require_same_length(strikes=strikes, net_gex=net)
    cum = _series(raw.get("cum_gex"), field=f"profiles[{index}].cum_gex")
    if cum:
        _require_same_length(cum_gex=cum, net_gex=net)
    else:
        cum = _cumulative(net)
    spot = raw.get("spot")
    max_pain = raw.get("max_pain")
    flip = raw.get("flip")
    return {
        "label": str(raw.get("label") or f"profile {index + 1}"),
        "t": None if raw.get("t") is None else str(raw.get("t")),
        "strikes": strikes,
        "net_gex": net,
        "cum_gex": cum,
        "spot": None if spot is None else _number(spot, field=f"profiles[{index}].spot", digits=spec.price_decimals),
        "max_pain": None
        if max_pain is None
        else _number(max_pain, field=f"profiles[{index}].max_pain", digits=spec.price_decimals),
        "flip": None if flip is None else _number(flip, field=f"profiles[{index}].flip", digits=spec.price_decimals),
        "net_total": None
        if raw.get("net_total") is None
        else _number(raw.get("net_total"), field=f"profiles[{index}].net_total", digits=1),
    }


def gex_profiles(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 2,
    height: int = 430,
    css_class: str = "",
) -> str:
    """Dealer gamma at several clocks, one shared GEX x-scale."""
    raw_profiles = data.get("profiles") or ()
    if not raw_profiles:
        raise ValueError("gex_profiles needs at least one profile")
    profiles = [_profile(raw, index, spec) for index, raw in enumerate(raw_profiles)]

    all_net = [value for profile in profiles for value in profile["net_gex"]]
    all_strikes = [strike for profile in profiles for strike in profile["strikes"] if strike is not None]
    payload: dict[str, Any] = {
        **_base_payload(spec),
        "profiles": profiles,
        "domain": {
            "gex": _gex_span(all_net),
            "strike": [min(all_strikes), max(all_strikes)],
            "gex_scale": _scale_mode(all_net),
        },
    }
    return panel(
        "gex_profiles",
        payload,
        spec=spec,
        title=title or "Dealer gamma profile",
        subtitle=subtitle
        or f"horizontal bars from zero · shared x-scale across clocks · {spec.strike_label}",
        legend=[
            {"color": "var(--rv-green)", "label": "net long gamma"},
            {"color": "var(--rv-red)", "label": "net short gamma"},
            {"color": _SPOT_COLOR, "label": "spot"},
            {"color": _REGIME_COLOR, "label": "max pain"},
            {"color": _FLIP_COLOR, "label": _FLIP_LABEL},
        ],
        note=note or f"Bars are net GEX per strike in {spec.value_unit}; a missing bar is a gap, not zero.",
        span=span,
        height=height,
        css_class=css_class,
    )


def _matrix(rows: Iterable[Iterable[Any]], *, field: str) -> list[list[Optional[float]]]:
    out: list[list[Optional[float]]] = []
    for index, row in enumerate(rows):
        try:
            values = list(row)
        except TypeError as exc:
            raise ValueError(f"{field}[{index}]: expected a row of numbers") from exc
        out.append(_series(values, field=f"{field}[{index}]"))
    return out


def gex_surface(
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
    """Time × strike × net GEX; null cells stay null so holes are visible."""
    times = [str(label) for label in data.get("times") or ()]
    minutes_raw = data.get("minutes") or ()
    minutes = [int(_number(value, field="minutes", digits=0)) for value in minutes_raw]
    strikes = _series(data.get("strikes"), field="strikes", digits=spec.price_decimals)
    if any(strike is None for strike in strikes):
        raise ValueError("strikes: null strikes are not allowed")
    if not times or not strikes:
        raise ValueError("gex_surface needs times and strikes")

    z = _matrix(data.get("z") or (), field="z")
    if not z:
        raise ValueError("gex_surface needs a z matrix")
    if len(z) != len(strikes):
        raise ValueError(f"z must have one row per strike ({len(strikes)}), got {len(z)}")
    for index, row in enumerate(z):
        if len(row) != len(times):
            raise ValueError(f"z[{index}] must have one cell per time ({len(times)}), got {len(row)}")
    if minutes:
        _require_same_length(minutes=minutes, times=times)

    finite = [value for row in z for value in row if value is not None]
    cap = max([0.0, *(abs(value) for value in finite)])
    cap = round(cap, 2) or 1.0
    cmin, cmax = round(-cap, 2), round(cap, 2)
    if cmin == cmax:
        cmin, cmax = -1.0, 1.0

    spot_path = _series(data.get("spot_path"), field="spot_path", digits=spec.price_decimals)
    if spot_path:
        _require_same_length(spot_path=spot_path, times=times)

    payload: dict[str, Any] = {
        **_base_payload(spec),
        "times": times,
        "minutes": minutes,
        "strikes": strikes,
        "z": z,
        "shape": {"strikes": len(strikes), "times": len(times)},
        "null_count": sum(1 for row in z for value in row if value is None),
        "spot_path": spot_path,
        "domain": {"gex": [cmin, cmax], "cmid": 0.0},
    }
    return panel(
        "gex_surface",
        payload,
        spec=spec,
        title=title or "Net GEX surface — time × strike",
        subtitle=subtitle or f"Plotly 3D · {spec.value_unit} · null cells stay blank",
        legend=[{"color": _SPOT_COLOR, "label": "spot path"}],
        note=note
        or (
            "A missing chain snapshot leaves a hole in the surface; it is not filled with zero. "
            f"Height is net GEX in {spec.value_unit}."
        ),
        span=span,
        height=height,
        css_class=css_class,
    )


def _snapshot(raw: Mapping[str, Any], index: int, spec: InstrumentSpec, default_label: str) -> dict[str, Any]:
    strikes = _series(raw.get("strikes"), field=f"snapshots[{index}].strikes", digits=spec.price_decimals)
    net = _series(raw.get("net_gex"), field=f"snapshots[{index}].net_gex")
    if not strikes or not net:
        raise ValueError(f"snapshots[{index}] needs strikes and net_gex")
    _require_same_length(strikes=strikes, net_gex=net)
    if any(strike is None for strike in strikes):
        raise ValueError(f"snapshots[{index}].strikes: null strikes are not allowed")
    return {
        "label": str(raw.get("label") or default_label),
        "t": None if raw.get("t") is None else str(raw.get("t")),
        "strikes": strikes,
        "net_gex": net,
        "spot": None
        if raw.get("spot") is None
        else _number(raw.get("spot"), field=f"snapshots[{index}].spot", digits=spec.price_decimals),
        "max_pain": None
        if raw.get("max_pain") is None
        else _number(raw.get("max_pain"), field=f"snapshots[{index}].max_pain", digits=spec.price_decimals),
        "flip": None
        if raw.get("flip") is None
        else _number(raw.get("flip"), field=f"snapshots[{index}].flip", digits=spec.price_decimals),
    }


def _align_snapshots(snapshots: list[dict[str, Any]]) -> None:
    """Union the strike ladders; a strike a snapshot lacks is ``None`` there."""
    union = sorted({strike for snapshot in snapshots for strike in snapshot["strikes"] if strike is not None})
    for snapshot in snapshots:
        per = {strike: value for strike, value in zip(snapshot["strikes"], snapshot["net_gex"]) if strike is not None}
        snapshot["strikes"] = list(union)
        snapshot["net_gex"] = [per.get(strike) for strike in union]


def gex_by_strike(
    data: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    note: Optional[str] = None,
    span: int = 1,
    height: int = 320,
    css_class: str = "",
) -> str:
    """GEX by strike for one snapshot or several, bars drawn from zero."""
    if isinstance(data, Mapping):
        raw_snapshots = list(data.get("snapshots") or ())
        if not raw_snapshots:
            raw_snapshots = [data]
    elif isinstance(data, Sequence) and not isinstance(data, (str, bytes)):
        raw_snapshots = list(data)
    else:  # pragma: no cover - defensive for an unusable argument
        raise ValueError("gex_by_strike needs a snapshot or a list of snapshots")
    if not raw_snapshots:
        raise ValueError("gex_by_strike needs at least one snapshot")

    snapshots = [
        _snapshot(raw, index, spec, f"snapshot {index + 1}") for index, raw in enumerate(raw_snapshots)
    ]
    _align_snapshots(snapshots)

    all_net = [value for snapshot in snapshots for value in snapshot["net_gex"]]
    strikes = snapshots[0]["strikes"]
    payload: dict[str, Any] = {
        **_base_payload(spec),
        "snapshots": snapshots,
        "domain": {
            "gex": _gex_span(all_net),
            "strike": [min(strikes), max(strikes)],
            "gex_scale": _scale_mode(all_net),
        },
    }
    if len(snapshots) == 1:
        only = snapshots[0]
        payload.update(
            {
                "label": only["label"],
                "t": only["t"],
                "strikes": only["strikes"],
                "net_gex": only["net_gex"],
                "spot": only["spot"],
                "max_pain": only["max_pain"],
                "flip": only["flip"],
            }
        )
    if len(snapshots) > 1:
        snapshot_colors = ["var(--rv-blue)", "var(--rv-amber)", "var(--rv-violet)", "var(--rv-green)"]
        legend = [
            {"color": snapshot_colors[index % len(snapshot_colors)], "label": snapshot["label"]}
            for index, snapshot in enumerate(snapshots)
        ]
    else:
        legend = [
            {"color": "var(--rv-green)", "label": "net long gamma"},
            {"color": "var(--rv-red)", "label": "net short gamma"},
            {"color": _SPOT_COLOR, "label": "spot"},
            {"color": _REGIME_COLOR, "label": "max pain"},
        ]
    return panel(
        "gex_by_strike",
        payload,
        spec=spec,
        title=title or "GEX by strike",
        subtitle=subtitle or f"bars from zero · {spec.strike_label}",
        legend=legend,
        note=note or f"Net GEX in {spec.value_unit}; a missing strike is a gap, not zero.",
        span=span,
        height=height,
        css_class=css_class,
    )

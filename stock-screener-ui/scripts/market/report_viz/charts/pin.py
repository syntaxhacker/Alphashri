"""Spot / pin / wall panels.

Four views of one question: did spot sit on the option book's pin, and did the
walls move to meet it?

    spot_pin        spot, max pain, the two walls and the pin band
    pin_score       how close spot was to max pain, in 5-minute buckets
    pin_null        observed |spot - max pain| against a random-walk cone
    wall_migration  wall strikes and max pain as step lines through the session

Each builder is pure: a plain mapping in, panel HTML out.  The mapping may be
partial — an absent or non-finite value stays ``None`` (a gap), never ``0``.
Units come from :class:`InstrumentSpec`, so the same call renders a 50-point
index ladder and a 20-point stock ladder without a branch here.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any, Optional

from ..contracts import InstrumentSpec
from ..page import panel
from ..theme import palette

__all__ = ["spot_pin", "pin_score", "pin_null", "wall_migration"]

_PIN_FIELDS = ("t", "spot", "max_pain", "call_wall", "put_wall")
_SCORE_FIELDS = ("t", "pin_score", "dist_pin")
_NULL_FIELDS = ("t", "obs", "p05", "p50", "p95")
_WALL_FIELDS = ("t", "spot", "max_pain", "call_wall", "put_wall")


def _number(value: Any) -> Optional[float | int]:
    """Coerce to a JSON-safe number; anything unusable becomes ``None``."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        return [value]
    return list(value)


def _length(data: Mapping[str, Any], keys: Sequence[str]) -> int:
    return max((len(_as_list(data.get(key))) for key in keys), default=0)


def _numbers(data: Mapping[str, Any], key: str, length: int) -> list[Optional[float | int]]:
    values = [_number(value) for value in _as_list(data.get(key))]
    values.extend([None] * (length - len(values)))
    return values


def _labels(data: Mapping[str, Any], key: str, length: int) -> list[Optional[str]]:
    values = [None if value is None else str(value) for value in _as_list(data.get(key))]
    values.extend([None] * (length - len(values)))
    return values


def _band(data: Mapping[str, Any], spec: InstrumentSpec) -> float:
    """Half-width of the pin band, in price points.

    The source report used 25 points on a 50-point ladder; here the default is
    half a strike step so a 100-point index gets 50 and a 20-point stock gets
    10.  An explicit ``pin_band``/``band`` in the payload always wins.
    """
    for key in ("pin_band", "band"):
        value = _number(data.get(key))
        if value is not None and value > 0:
            return float(value)
    step = spec.strike_step if spec.strike_step > 0 else 1.0
    return float(step) / 2.0


def _mapping(data: Any) -> Mapping[str, Any]:
    if not isinstance(data, Mapping):
        raise TypeError("pin chart data must be a mapping of series name -> sequence")
    return data


def _payload(
    data: Mapping[str, Any],
    *,
    keys: Sequence[str],
    include_band: bool = False,
    band: Optional[float] = None,
) -> dict[str, Any]:
    length = _length(data, keys)
    payload: dict[str, Any] = {}
    for key in keys:
        payload[key] = _labels(data, key, length) if key == "t" else _numbers(data, key, length)
    if include_band:
        raw = data.get("pin_band")
        if raw is None:
            raw = data.get("band")
        if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
            values = [_number(value) for value in raw]
            values.extend([None] * (length - len(values)))
            payload["pin_band"] = values
        elif band is not None:
            payload["pin_band"] = band
    return payload


def _mean(values: Sequence[Optional[float | int]]) -> Optional[float]:
    finite = [float(value) for value in values if value is not None]
    return sum(finite) / len(finite) if finite else None


def _magnitude(spec: InstrumentSpec, value: Optional[float]) -> str:
    text = spec.points(value)
    return text[1:] if text.startswith("+") else text


def _chrome(
    chart: str,
    payload: dict[str, Any],
    spec: InstrumentSpec,
    *,
    title: str,
    subtitle: str,
    legend: Sequence[tuple[str, str]],
    note: str,
    span: int,
    height: int,
    overrides: Mapping[str, Any],
) -> str:
    options: dict[str, Any] = {
        "subtitle": subtitle,
        "legend": legend,
        "note": note,
        "span": span,
        "height": height,
    }
    options.update(overrides)
    return panel(chart, payload, spec=spec, title=title, **options)


def _session(spec: InstrumentSpec) -> str:
    return f"{spec.session_open}–{spec.session_close} {spec.timezone}"


def spot_pin(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    **kw: Any,
) -> str:
    """Spot against max pain, the call/put walls and the pin band.

    ``data``: ``t``, ``spot``, ``max_pain``, ``call_wall``, ``put_wall`` and an
    optional ``pin_band`` (half-width, price points).  Missing minutes are gaps.
    """
    data = _mapping(data)
    band = _band(data, spec)
    payload = _payload(data, keys=_PIN_FIELDS, include_band=True, band=band)
    colors = palette()
    return _chrome(
        "spot_pin",
        payload,
        spec,
        title=title or f"{spec.name} · spot vs max pain",
        subtitle=(
            f"band = max pain ± {band:g} pts · {spec.strike_label} · "
            f"step {spec.money(spec.strike_step, 0)} · {_session(spec)}"
        ),
        legend=[
            (colors["text"], "spot"),
            (colors["amber"], f"max pain (±{band:g} band)"),
            (colors["negative"], "call wall"),
            (colors["positive"], "put wall"),
        ],
        note=(
            "The walls are step lines because OI is recomputed every minute; a vertical jump is a "
            "wall overtaken by a neighbouring strike. Walls outside the visible band are clipped, "
            "not compressed, and a blank minute is a missing print, never zero."
        ),
        span=2,
        height=340,
        overrides=kw,
    )


def pin_score(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    **kw: Any,
) -> str:
    """Pin-score strip: 100 = spot exactly on max pain.

    ``data``: ``t``, ``pin_score``, ``dist_pin`` and an optional ``pin_band``
    (or ``band``).  ``dist_pin`` is spot minus max pain; either series may be
    omitted and the renderer derives what it can without filling gaps.
    """
    data = _mapping(data)
    band = _band(data, spec)
    payload = _payload(data, keys=_SCORE_FIELDS, include_band=True, band=band)
    colors = palette()
    return _chrome(
        "pin_score",
        payload,
        spec,
        title=title or f"{spec.name} · pin score",
        subtitle=(
            f"100 = on max pain · 0 = {2 * band:g} pts away · "
            f"{spec.session_open}–{spec.session_close}"
        ),
        legend=[(colors["amber"], f"pin score (band ±{band:g})")],
        note=(
            "A 100 print means spot sits on max pain; 50 means it is a full band away. "
            "The strip is the same distance series as the chart above, shown on a 0–100 scale."
        ),
        span=2,
        height=140,
        overrides=kw,
    )


def pin_null(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    **kw: Any,
) -> str:
    """Observed |spot − max pain| against a same-session random-walk cone.

    ``data``: ``t``, ``obs``, ``p05``, ``p50``, ``p95``.  The null holds max
    pain at its recorded value, so the cone bounds the path rather than proving
    the pin pulled it.
    """
    data = _mapping(data)
    payload = _payload(data, keys=_NULL_FIELDS)
    colors = palette()
    observed = _mean(payload["obs"])
    null_median = _mean(payload["p50"])
    detail = (
        f"observed mean {_magnitude(spec, observed)} pts vs null median {_magnitude(spec, null_median)} pts."
        if observed is not None and null_median is not None
        else "the null cone needs the bootstrap percentiles; missing ones stay blank."
    )
    return _chrome(
        "pin_null",
        payload,
        spec,
        title=title or f"{spec.name} · distance to pin vs a random-walk null",
        subtitle=f"|spot − max pain| in points · p05–p95 cone · {_session(spec)}",
        legend=[
            (colors["amber"], "observed |spot − max pain|"),
            (colors["muted"], "null median"),
            (colors["muted"], "null p05–p95"),
        ],
        note=(
            "A random walk built from this session's own 1-minute changes, replayed against the "
            "recorded max pain, is the baseline; max pain is held fixed, so a reading inside or "
            "below the cone bounds how unusual the path was, not why. " + detail
        ),
        span=1,
        height=246,
        overrides=kw,
    )


def wall_migration(
    data: Mapping[str, Any],
    *,
    spec: InstrumentSpec,
    title: Optional[str] = None,
    **kw: Any,
) -> str:
    """Call/put wall strikes and max pain as step lines through the session.

    ``data``: ``t``, ``spot``, ``max_pain``, ``call_wall``, ``put_wall``.  Wall
    values far outside the spot range are clipped so the spot path stays
    readable; clipped segments render as gaps, not as a flat line.
    """
    data = _mapping(data)
    payload = _payload(data, keys=_WALL_FIELDS)
    colors = palette()
    return _chrome(
        "wall_migration",
        payload,
        spec,
        title=title or f"{spec.name} · wall migration",
        subtitle=(
            f"call / put wall and max pain strikes · {spec.strike_label} · "
            f"{spec.session_open}–{spec.session_close}"
        ),
        legend=[
            (colors["text"], "spot"),
            (colors["amber"], "max pain"),
            (colors["negative"], "call wall"),
            (colors["positive"], "put wall"),
        ],
        note=(
            "Steps, not slopes: a wall level only changes when a different strike takes the top OI. "
            "Values outside the visible spot range are clipped and drawn as gaps so the session's "
            "own path is not flattened."
        ),
        span=2,
        height=320,
        overrides=kw,
    )

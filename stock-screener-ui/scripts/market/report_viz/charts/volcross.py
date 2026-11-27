"""Vol-decay, futures-cross and intraday-anatomy panels.

Eleven builders ported from the 2026-11-17 expiry book and the intraday
anatomy page.  They share one rule with the rest of ``report_viz``: a missing
number is ``None`` and stays a gap.  Premium, basis, OI and IV series never
substitute zero for a missing print.

Every unit, currency, price precision and strike ladder comes from the
:class:`InstrumentSpec` carried with the payload.  A strike is displayed with
the payload's own ladder; nothing here knows a particular index level, a
50-point step, a currency sign or a 09:15–15:30 session.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from ..contracts import InstrumentSpec
from ..page import panel

__all__ = [
    "pe_premium_ribbon",
    "smile_four_clocks",
    "premium_vs_intrinsic",
    "theta_decomposition",
    "skew_rotation",
    "basis_3d",
    "basis_regime_strip",
    "lead_lag",
    "nifty_vs_sensex",
    "futures_quadrants",
    "event_study",
]

_CLOCK_RE = re.compile(r"(\d{1,2}):(\d{2})")

_REGIME_LABELS = {
    "long_buildup": ("Long buildup", "green"),
    "short_buildup": ("Short buildup", "red"),
    "long_unwinding": ("Long unwinding", "amber"),
    "short_covering": ("Short covering", "blue"),
    "neutral": ("Neutral", "muted"),
    "basis_rising": ("Basis rising", "green"),
    "basis_falling": ("Basis falling", "red"),
    "basis_flat": ("Basis flat", "muted"),
}

_QUADRANT_IDS = ("long_buildup", "short_buildup", "long_unwinding", "short_covering", "neutral")


def _is_series(value: Any) -> bool:
    return (
        not isinstance(value, (str, bytes, Mapping))
        and hasattr(value, "__len__")
        and hasattr(value, "__getitem__")
    )


def _number(value: Any, where: str) -> float | None:
    """A finite float, or ``None`` for a missing/NaN print."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{where}: expected a number, got {value!r}")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{where}: expected a number, got {value!r}") from exc
    return number if math.isfinite(number) else None


def _required(value: Any, where: str) -> float:
    number = _number(value, where)
    if number is None:
        raise ValueError(f"{where} is required")
    return number


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _clock(value: Any, where: str) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minute = float(value)
        if 0 <= minute < 1440:
            return _hhmm(int(round(minute)))
    if isinstance(value, str):
        match = _CLOCK_RE.search(value)
        if match:
            hour, minute = int(match.group(1)), int(match.group(2))
            if 0 <= hour < 24 and 0 <= minute < 60:
                return f"{hour:02d}:{minute:02d}"
    raise ValueError(f"{where}: expected HH:MM, minutes or an ISO timestamp, got {value!r}")


def _minute(label: str) -> int:
    return int(label[:2]) * 60 + int(label[3:5])


def _hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _session(spec: InstrumentSpec) -> str:
    return f"{spec.session_open}–{spec.session_close} {spec.timezone}"


def _strike_text(strike: float) -> str:
    return f"{strike:,.0f}"


def _base_payload(spec: InstrumentSpec) -> dict[str, Any]:
    return {
        "instrument": spec.name,
        "currency_symbol": spec.currency_symbol,
        "price_digits": int(spec.price_decimals),
        "strike_step": float(spec.strike_step),
        "price_label": spec.price_label,
        "strike_label": spec.strike_label,
        "oi_unit": spec.oi_unit,
        "value_unit": spec.value_unit,
        "session": f"{spec.session_open}–{spec.session_close}",
        "session_open": spec.session_open,
        "session_close": spec.session_close,
    }


def _raw_rows(data: Any, key: str = "rows") -> tuple[list[Any], dict[str, Any]]:
    if isinstance(data, Mapping):
        meta: dict[str, Any] = dict(data)
        if key in meta:
            rows = meta.pop(key)
        elif "rows" in meta:
            rows = meta.pop("rows")
        elif "bands" in meta or "regimes" in meta:
            return [], meta
        elif "t" in meta:
            times = meta["t"]
            if isinstance(times, str):
                return [dict(data)], {}
            if not _is_series(times):
                raise ValueError("data['t'] must be a sequence of timestamps")
            length = len(times)
            columns: dict[str, Any] = {}
            for field, series in meta.items():
                if isinstance(series, (str, bytes)):
                    continue
                if _is_series(series):
                    if len(series) != length:
                        raise ValueError(
                            f"data[{field!r}] has {len(series)} values, data['t'] has {length}"
                        )
                    columns[field] = series
            rows = [
                {field: series[index] for field, series in columns.items()}
                for index in range(length)
            ]
            meta = {}
        else:
            raise ValueError(
                f"data must be a row list, a {{{key!r}: [...]}} mapping, or column series"
            )
        if not _is_series(rows):
            raise ValueError(f"data[{key!r}] must be a sequence of row mappings")
        return list(rows), meta
    if _is_series(data):
        return list(data), {}
    raise ValueError(f"data must be a mapping or a sequence, got {type(data).__name__}")


def _series_rows(
    raw: Sequence[Any],
    fields: Iterable[str],
    *,
    int_fields: Iterable[str] = (),
    text_fields: Iterable[str] = (),
    increasing: bool = True,
) -> list[dict[str, Any]]:
    wanted = tuple(fields)
    integers = set(int_fields)
    texts = tuple(text_fields)
    records: list[dict[str, Any]] = []
    previous: int | None = None
    for index, row in enumerate(raw):
        if not isinstance(row, Mapping):
            raise ValueError(f"row {index}: expected a mapping, got {type(row).__name__}")
        clock_value = row.get("clock")
        time_value = clock_value if clock_value is not None else row.get("t")
        label = _clock(time_value, f"row {index}.t")
        minute = _minute(label)
        if increasing and previous is not None and minute <= previous:
            raise ValueError(
                f"row {index}: timestamps must strictly increase "
                f"({label} after {_hhmm(previous)})"
            )
        previous = minute
        record: dict[str, Any] = {"t": label, "m": minute}
        for field in wanted:
            value = _number(row.get(field), f"row {index}.{field}")
            if value is not None and field in integers:
                value = int(round(value))
            record[field] = value
        for field in texts:
            value = row.get(field)
            record[field] = None if value is None or not str(value).strip() else str(value).strip()
        records.append(record)
    return records


def _source_rows(raw: Any, where: str) -> list[Any]:
    if isinstance(raw, Mapping):
        if "points" in raw:
            raw = raw["points"]
        elif "t" in raw and _is_series(raw["t"]):
            times = raw["t"]
            length = len(times)
            column = None
            for key in ("value", "close", "price"):
                candidate = raw.get(key)
                if _is_series(candidate):
                    if len(candidate) != length:
                        raise ValueError(f"{where}.{key} has {len(candidate)} values, t has {length}")
                    column = candidate
                    break
            if column is None:
                raise ValueError(f"{where}: add value, close or price column")
            return [
                {"t": times[index], "value": column[index]}
                for index in range(length)
            ]
        else:
            return [dict(raw)]
    if not _is_series(raw):
        raise ValueError(f"{where} must be a list of rows")
    return list(raw)


def _value_records(raw: Any, where: str) -> list[dict[str, Any]]:
    rows = _source_rows(raw, where)
    normalised: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, Mapping):
            raise ValueError(f"{where} row {index}: expected a mapping")
        value = row.get("value")
        if value is None:
            value = row.get("close", row.get("price"))
        normalised.append(
            {
                "t": row.get("clock") or row.get("t"),
                "value": value,
            }
        )
    return _series_rows(normalised, ("value",))


def _value_points(raw: Any, where: str) -> list[tuple[int, float]]:
    return [
        (record["m"], record["value"])
        for record in _value_records(raw, where)
        if record["value"] is not None
    ]


def _finite(values: Iterable[float | None]) -> list[float]:
    return [float(value) for value in values if value is not None]


def _span(values: Iterable[float | None], *, pad: float = 0.06, fallback: float = 1.0) -> list[float]:
    finite = _finite(values)
    if not finite:
        return [-fallback, fallback]
    low, high = min(finite), max(finite)
    if low == high:
        high = low + fallback
    room = (high - low) * pad
    return [low - room, high + room]


def _category(regime: str, labels: Mapping[str, Any] | None = None) -> dict[str, str]:
    label, tone = _REGIME_LABELS.get(regime, (regime.replace("_", " ").title(), "muted"))
    if labels:
        custom = labels.get(regime)
        if isinstance(custom, str) and custom.strip():
            label = custom.strip()
    return {"id": regime, "label": label, "tone": tone}


def pe_premium_ribbon(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "PE premium ribbon by strike",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 360,
) -> str:
    """Put premium for each strike over the session, aligned on one clock.

    A strike/time cell with no quote stays ``None``; the renderer breaks that
    strike's line there instead of drawing a zero-premium point.
    """
    if isinstance(data, Mapping) and "premium_surface" in data:
        data = data["premium_surface"]
    if isinstance(data, Mapping) and "z" in data:
        times_source = data.get("t") or data.get("clocks") or ()
        times = [_clock(value, f"t[{index}]") for index, value in enumerate(times_source)]
        if not times:
            raise ValueError("pe_premium_ribbon needs data['t'] or data['clocks']")
        minutes = [_minute(label) for label in times]
        if len(set(minutes)) != len(minutes):
            raise ValueError("pe_premium_ribbon times must be unique")
        strikes = [_required(value, f"strikes[{index}]") for index, value in enumerate(data.get("strikes") or ())]
        if not strikes:
            raise ValueError("pe_premium_ribbon needs data['strikes']")
        if len(set(strikes)) != len(strikes):
            raise ValueError("pe_premium_ribbon strikes must be unique")
        z = data.get("z") or []
        strike_major = len(z) == len(strikes) and all(_is_series(row) and len(row) == len(times) for row in z)
        time_major = len(z) == len(times) and all(_is_series(row) and len(row) == len(strikes) for row in z)
        prefer_time_major = "clocks" in data and "t" not in data
        if time_major and (prefer_time_major or not strike_major):
            blocks = [[row[column] for row in z] for column in range(len(strikes))]
        elif strike_major:
            blocks = z
        else:
            raise ValueError(
                f"z must be {len(strikes)} strike rows × {len(times)} times "
                "or the transpose"
            )
        rows: list[list[float | None]] = []
        for index, row in enumerate(blocks):
            rows.append([_number(value, f"z[{index}]") for value in row])
        spot_raw = data.get("spot")
        spot = (
            [_number(value, f"spot[{index}]") for index, value in enumerate(spot_raw)]
            if _is_series(spot_raw) and len(spot_raw) == len(times)
            else [None] * len(times)
        )
        time_order = sorted(range(len(minutes)), key=lambda index: minutes[index])
        if time_order != list(range(len(minutes))):
            times = [times[index] for index in time_order]
            minutes = [minutes[index] for index in time_order]
            rows = [[row[index] for index in time_order] for row in rows]
            spot = [spot[index] for index in time_order]
        meta: dict[str, Any] = {}
    else:
        raw, meta = _raw_rows(data, "rows")
        records = _series_rows(raw, ("strike", "premium", "spot"), increasing=False)
        for index, record in enumerate(records):
            if record["strike"] is None:
                raise ValueError(f"row {index}.strike is required")
        times = [_hhmm(minute) for minute in sorted({record["m"] for record in records})]
        minutes = sorted({record["m"] for record in records})
        strikes = sorted({record["strike"] for record in records})  # type: ignore[arg-type]
        if not strikes:
            strikes = []
        lookup: dict[tuple[float, int], float | None] = {
            (record["strike"], record["m"]): record["premium"] for record in records
        }
        rows = [[lookup.get((strike, minute)) for minute in minutes] for strike in strikes]
        spot_by_minute: dict[int, float] = {}
        for record in records:
            if record["m"] not in spot_by_minute and record["spot"] is not None:
                spot_by_minute[record["m"]] = record["spot"]
        spot = [spot_by_minute.get(minute) for minute in minutes]

    order = sorted(range(len(strikes)), key=lambda index: strikes[index])
    strikes = [strikes[index] for index in order]
    rows = [rows[index] for index in order]

    series: list[dict[str, Any]] = []
    for strike, values in zip(strikes, rows):
        pairs = [(times[index], values[index]) for index in range(len(times)) if values[index] is not None]
        series.append(
            {
                "strike": _round(strike, spec.price_decimals),
                "label": _strike_text(strike),
                "premium": [_round(value, 2) for value in values],
                "last": _round(pairs[-1][1], 2) if pairs else None,
                "last_t": pairs[-1][0] if pairs else None,
            }
        )

    cells = len(strikes) * len(times)
    points = sum(1 for values in rows for value in values if value is not None)
    active = [index for index, value in enumerate(spot) if value is not None]
    payload = {
        **_base_payload(spec),
        "t": times,
        "minutes": minutes,
        "strikes": [_round(strike, spec.price_decimals) for strike in strikes],
        "series": series,
        "spot": [_round(value, spec.price_decimals) for value in spot],
        "unit": f"{spec.currency_symbol} premium",
        "stats": {
            "strikes": len(strikes),
            "bars": len(times),
            "points": points,
            "nulls": cells - points,
            "spot_first": spot[active[0]] if active else None,
            "spot_last": spot[active[-1]] if active else None,
        },
    }
    return panel(
        "pe_premium_ribbon",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"{spec.name} · {spec.strike_label} · blank = no quote · {_session(spec)}",
        legend=[
            {"color": "var(--rv-amber)", "label": "PE premium"},
            {"color": "var(--rv-muted)", "label": "each line = one strike"},
        ],
        note=(
            "One line per strike on the same clock. A minute without a quote is a "
            "gap, never a zero premium."
        ),
        span=span,
        height=height,
    )


def _smile_panel(raw: Any, index: int, spec: InstrumentSpec) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise ValueError(f"smile {index}: expected a mapping")
    clock = _clock(raw.get("clock", raw.get("t")), f"smile {index}.clock")
    spot = _required(raw.get("spot"), f"smile {index}.spot")
    if "points" in raw:
        points = list(raw["points"])
    elif "otm" in raw:
        points = list(raw["otm"])
    elif "strikes" in raw:
        strikes = list(raw["strikes"])
        ce = list(raw.get("ce_iv") or raw.get("ce") or [])
        pe = list(raw.get("pe_iv") or raw.get("pe") or [])
        points = [
            {
                "strike": strikes[position],
                "ce_iv": ce[position] if position < len(ce) else None,
                "pe_iv": pe[position] if position < len(pe) else None,
            }
            for position in range(len(strikes))
        ]
    else:
        raise ValueError(f"smile {index}: add points or strikes/ce_iv/pe_iv")
    records: list[dict[str, Any]] = []
    for position, point in enumerate(points):
        if not isinstance(point, Mapping):
            raise ValueError(f"smile {index}.points[{position}]: expected a mapping")
        strike = _number(
            point.get("strike", point.get("k")),
            f"smile {index}.points[{position}].strike",
        )
        if strike is None:
            raise ValueError(f"smile {index}.points[{position}].strike is required")
        ce_iv = _number(point.get("ce_iv"), f"smile {index}.points[{position}].ce_iv")
        pe_iv = _number(point.get("pe_iv"), f"smile {index}.points[{position}].pe_iv")
        if ce_iv is None and point.get("side") == "ce":
            ce_iv = _number(point.get("iv"), f"smile {index}.points[{position}].iv")
        if pe_iv is None and point.get("side") == "pe":
            pe_iv = _number(point.get("iv"), f"smile {index}.points[{position}].iv")
        if ce_iv is not None and ce_iv <= 0:
            raise ValueError(f"smile {index}: CE IV must be positive or blank")
        if pe_iv is not None and pe_iv <= 0:
            raise ValueError(f"smile {index}: PE IV must be positive or blank")
        records.append({"strike": strike, "ce_iv": ce_iv, "pe_iv": pe_iv})
    records.sort(key=lambda record: record["strike"])
    strikes = [record["strike"] for record in records]
    if len(set(strikes)) != len(strikes):
        raise ValueError(f"smile {index}: strikes must be unique")
    if not any(record["ce_iv"] is not None or record["pe_iv"] is not None for record in records):
        raise ValueError(f"smile {index}: needs at least one IV quote")
    atm = min(strikes, key=lambda strike: (abs(strike - spot), strike))
    atm_row = next(record for record in records if record["strike"] == atm)
    quotes = [value for value in (atm_row["ce_iv"], atm_row["pe_iv"]) if value is not None]
    gap = _number(raw.get("gap_atm"), f"smile {index}.gap_atm")
    if gap is None and atm_row["ce_iv"] is not None and atm_row["pe_iv"] is not None:
        gap = atm_row["ce_iv"] - atm_row["pe_iv"]
    explicit_atm_iv = _number(raw.get("atm_iv"), f"smile {index}.atm_iv")
    return {
        "clock": clock,
        "minute": _minute(clock),
        "spot": _round(spot, spec.price_decimals),
        "strikes": [_round(strike, spec.price_decimals) for strike in strikes],
        "ce_iv": [_round(record["ce_iv"], 2) for record in records],
        "pe_iv": [_round(record["pe_iv"], 2) for record in records],
        "atm": _round(atm, spec.price_decimals),
        "atm_iv": _round(
            explicit_atm_iv
            if explicit_atm_iv is not None
            else (sum(quotes) / len(quotes) if quotes else None),
            2,
        ),
        "atm_gap": _round(gap, 2),
    }


def smile_four_clocks(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "IV smile at four clocks",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 420,
) -> str:
    if isinstance(data, Mapping) and "smiles" in data:
        smiles = data["smiles"]
    elif isinstance(data, Mapping) and "panels" in data:
        smiles = data["panels"]
    else:
        smiles = data
    if not _is_series(smiles):
        raise ValueError("smile_four_clocks needs a list of smiles")
    if not smiles:
        raise ValueError("smile_four_clocks needs at least one smile")
    panels = [_smile_panel(raw, index, spec) for index, raw in enumerate(smiles)]
    panels.sort(key=lambda item: item["minute"])
    quotes = [
        value
        for item in panels
        for value in (*item["ce_iv"], *item["pe_iv"])
        if value is not None
    ]
    payload = {
        **_base_payload(spec),
        "panels": panels,
        "unit": "vol pts",
        "stats": {
            "clocks": len(panels),
            "quotes": len(quotes),
            "nulls": sum(
                1
                for item in panels
                for value in (*item["ce_iv"], *item["pe_iv"])
                if value is None
            ),
            "iv_low": min(quotes) if quotes else None,
            "iv_high": max(quotes) if quotes else None,
            "first": panels[0]["clock"],
            "last": panels[-1]["clock"],
        },
    }
    return panel(
        "smile_four_clocks",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"{spec.name} · IV in vol points · CE above spot, PE below it · blank = no quote",
        legend=[
            {"color": "var(--rv-green)", "label": "CE IV"},
            {"color": "var(--rv-red)", "label": "PE IV"},
            {"color": "var(--rv-text)", "label": "spot"},
        ],
        note=(
            "One panel per clock on a shared strike and IV scale. A strike without "
            "a quote is a gap; nothing is interpolated through it."
        ),
        span=span,
        height=height,
    )


# 3. premium vs intrinsic vs frozen-spot model
def _contract_points(raw: Any, where: str) -> list[dict[str, Any]]:
    if not _is_series(raw):
        raise ValueError(f"{where} must be a list of points")
    points = []
    for index, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise ValueError(f"{where}[{index}]: expected a mapping")
        points.append(
            {
                "t": item.get("clock") or item.get("t"),
                "premium": item.get("premium", item.get("px")),
                "intrinsic": item.get("intrinsic", item.get("intr")),
            }
        )
    records = _series_rows(points, ("premium", "intrinsic"))
    for index, record in enumerate(records):
        if record["premium"] is None and record["intrinsic"] is None:
            continue
        if record["premium"] is not None and record["premium"] < 0:
            raise ValueError(f"{where}[{index}].premium must be >= 0 or blank")
        if record["intrinsic"] is not None and record["intrinsic"] < 0:
            raise ValueError(f"{where}[{index}].intrinsic must be >= 0 or blank")
    return [
        {
            "t": record["t"],
            "m": record["m"],
            "premium": _round(record["premium"], 2),
            "intrinsic": _round(record["intrinsic"], 2),
        }
        for record in records
    ]


def premium_vs_intrinsic(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Premium vs intrinsic vs a frozen-spot model",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 420,
) -> str:
    """Traded premium, intrinsic value and a theta-only counterfactual.

    ``frozen`` is the model path with spot and IV held at the anchor; it is
    optional and stays absent if the caller has no model.
    """
    if isinstance(data, Mapping) and "contracts" in data:
        contracts_raw = data["contracts"]
    else:
        contracts_raw = data
    if not _is_series(contracts_raw) or not contracts_raw:
        raise ValueError("premium_vs_intrinsic needs at least one contract")

    contracts: list[dict[str, Any]] = []
    for index, raw in enumerate(contracts_raw):
        if not isinstance(raw, Mapping):
            raise ValueError(f"contract {index}: expected a mapping")
        points = _contract_points(raw.get("points"), f"contract {index}.points")
        if not points:
            raise ValueError(f"contract {index}: needs at least one premium point")
        frozen_raw = raw.get("frozen") or []
        frozen = _contract_points(
            [
                {
                    "t": item.get("clock") or item.get("t"),
                    "premium": item.get("premium", item.get("px")),
                }
                for item in frozen_raw
            ],
            f"contract {index}.frozen",
        ) if frozen_raw else []
        side = str(raw.get("side") or "").lower()
        side = "ce" if side in ("ce", "call") else "pe" if side in ("pe", "put") else None
        strike = _number(raw.get("strike"), f"contract {index}.strike")
        label = raw.get("label")
        if not isinstance(label, str) or not label.strip():
            parts = []
            if strike is not None:
                parts.append(_strike_text(strike))
            if side:
                parts.append(side.upper())
            label = " ".join(parts) or f"Contract {index + 1}"
        else:
            label = label.strip()

        premium_pairs = [(item["t"], item["premium"]) for item in points if item["premium"] is not None]
        intrinsic_pairs = [
            (item["t"], item["intrinsic"]) for item in points if item["intrinsic"] is not None
        ]
        frozen_pairs = [(item["t"], item["premium"]) for item in frozen if item["premium"] is not None]
        both = [
            (item["premium"], item["intrinsic"])
            for item in points
            if item["premium"] is not None and item["intrinsic"] is not None
        ]
        contracts.append(
            {
                "label": label,
                "side": side,
                "strike": _round(strike, spec.price_decimals),
                "points": points,
                "frozen": frozen,
                "stats": {
                    "points": len(points),
                    "nulls": sum(1 for item in points if item["premium"] is None),
                    "first_t": premium_pairs[0][0] if premium_pairs else None,
                    "first": _round(premium_pairs[0][1], 2) if premium_pairs else None,
                    "last_t": premium_pairs[-1][0] if premium_pairs else None,
                    "last": _round(premium_pairs[-1][1], 2) if premium_pairs else None,
                    "change": _round(premium_pairs[-1][1] - premium_pairs[0][1], 2)
                    if premium_pairs
                    else None,
                    "intrinsic_change": _round(
                        intrinsic_pairs[-1][1] - intrinsic_pairs[0][1], 2
                    )
                    if intrinsic_pairs
                    else None,
                    "time_value_start": _round(both[0][0] - both[0][1], 2) if both else None,
                    "time_value_end": _round(both[-1][0] - both[-1][1], 2) if both else None,
                    "frozen_change": _round(frozen_pairs[-1][1] - frozen_pairs[0][1], 2)
                    if frozen_pairs
                    else None,
                },
            }
        )

    payload = {
        **_base_payload(spec),
        "contracts": contracts,
        "unit": f"{spec.currency_symbol} premium",
        "stats": {
            "contracts": len(contracts),
            "frozen_contracts": sum(1 for contract in contracts if contract["frozen"]),
        },
    }
    return panel(
        "premium_vs_intrinsic",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or (
            f"{spec.name} · solid = traded · dashed = intrinsic · dotted = spot and IV "
            "frozen at the anchor"
        ),
        legend=[
            {"color": "var(--rv-amber)", "label": "PE premium"},
            {"color": "var(--rv-blue)", "label": "CE premium"},
            {"color": "var(--rv-muted)", "label": "intrinsic"},
            {"color": "var(--rv-violet)", "label": "frozen-spot model"},
        ],
        note=(
            "The band between the solid and dashed line is time value. The frozen "
            "model moves only with time; a missing print breaks the traded line."
        ),
        span=span,
        height=height,
    )


def theta_decomposition(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Where the premium went",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 380,
) -> str:
    if isinstance(data, Mapping) and "attribution" in data:
        windows = data["attribution"]
        if _is_series(windows) and windows:
            first_window = windows[0]
            if isinstance(first_window, Mapping):
                data = {
                    "rows": first_window.get("rows") or [],
                    "window": first_window.get("label") or first_window.get("from"),
                }
    raw, meta = _raw_rows(data, "rows")
    records = _series_rows(
        raw,
        ("dp", "spot", "theta", "iv", "wedge", "naive_theta", "strike"),
        text_fields=("label", "side"),
    )
    rows: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        label = record["label"]
        if not label:
            parts = []
            if record["strike"] is not None:
                parts.append(_strike_text(record["strike"]))
            if record["side"]:
                parts.append(record["side"].lower())
            label = " ".join(parts) or f"Row {index + 1}"
        rows.append(
            {
                "label": label,
                "side": record["side"].lower() if record["side"] else None,
                "strike": _round(record["strike"], spec.price_decimals),
                "dp": _round(record["dp"], 2),
                "spot": _round(record["spot"], 2),
                "theta": _round(record["theta"], 2),
                "priced_theta": _round(record["theta"], 2),
                "iv": _round(record["iv"], 2),
                "wedge": _round(record["wedge"], 2),
                "naive_theta": _round(record["naive_theta"], 2),
            }
        )

    def total(field: str) -> float | None:
        values = [row[field] for row in rows if row[field] is not None]
        return _round(sum(values), 2) if values else None

    theta_sum = total("theta")
    naive_sum = total("naive_theta")
    overstatement = (
        round(naive_sum / theta_sum, 2)
        if theta_sum not in (None, 0) and naive_sum is not None
        else None
    )
    payload = {
        **_base_payload(spec),
        "rows": rows,
        "window": meta.get("window") or meta.get("label") or "",
        "unit": "premium points",
        "buckets": [
            {"id": "spot", "label": "spot", "tone": "blue"},
            {"id": "theta", "label": "time (priced)", "tone": "amber"},
            {"id": "iv", "label": "IV", "tone": "violet"},
            {"id": "wedge", "label": "print wedge", "tone": "muted"},
        ],
        "stats": {
            "contracts": len(rows),
            "dp": total("dp"),
            "spot": total("spot"),
            "theta": theta_sum,
            "priced_theta": theta_sum,
            "iv": total("iv"),
            "wedge": total("wedge"),
            "naive_theta": naive_sum,
            "overstatement": overstatement,
        },
    }
    return panel(
        "theta_decomposition",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle or "premium points · one bar per repricing bucket · white tick = actual change",
        legend=[
            {"color": "var(--rv-blue)", "label": "spot"},
            {"color": "var(--rv-amber)", "label": "time (priced)"},
            {"color": "var(--rv-violet)", "label": "IV"},
            {"color": "var(--rv-muted)", "label": "print wedge"},
            {"color": "var(--rv-text)", "label": "actual Δ premium"},
        ],
        note=(
            "The four buckets add up to the actual premium change up to the print "
            "wedge. The hollow bar is the vendor theta integrated over the window; "
            "the filled bar is what the chain actually charged."
        ),
        span=span,
        height=height,
    )


def skew_rotation(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Skew rotation",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 360,
) -> str:
    if isinstance(data, Mapping) and "skew" in data and "points" not in data:
        data = dict(data["skew"])
    if isinstance(data, Mapping) and "points" in data:
        points_raw = data["points"]
        fixed_raw = data.get("fixed") or []
    else:
        points_raw = data
        fixed_raw = []
    if not _is_series(points_raw):
        raise ValueError("skew_rotation needs a list of points")
    points = _series_rows(points_raw, ("atm_iv", "ce25", "pe25"))
    fixed: list[dict[str, Any]] = []
    for index, series in enumerate(fixed_raw):
        if not isinstance(series, Mapping):
            raise ValueError(f"fixed {index}: expected a mapping")
        strike = _required(series.get("strike"), f"fixed {index}.strike")
        series_points = _series_rows(
            [
                {"t": item.get("clock") or item.get("t"), "gap": item.get("gap")}
                for item in series.get("points") or []
            ],
            ("gap",),
        )
        pairs = [(item["t"], item["gap"]) for item in series_points if item["gap"] is not None]
        fixed.append(
            {
                "strike": _round(strike, spec.price_decimals),
                "label": _strike_text(strike),
                "points": [
                    {"t": item["t"], "m": item["m"], "gap": _round(item["gap"], 2)}
                    for item in series_points
                ],
                "stats": {
                    "start_t": pairs[0][0] if pairs else None,
                    "start": _round(pairs[0][1], 2) if pairs else None,
                    "end_t": pairs[-1][0] if pairs else None,
                    "end": _round(pairs[-1][1], 2) if pairs else None,
                    "change": _round(pairs[-1][1] - pairs[0][1], 2) if pairs else None,
                },
            }
        )
    fixed.sort(key=lambda item: item["strike"])

    atm = [(item["t"], item["atm_iv"]) for item in points if item["atm_iv"] is not None]
    payload = {
        **_base_payload(spec),
        "points": [
            {
                "t": item["t"],
                "m": item["m"],
                "atm_iv": _round(item["atm_iv"], 2),
                "ce25": _round(item["ce25"], 2),
                "pe25": _round(item["pe25"], 2),
            }
            for item in points
        ],
        "fixed": fixed,
        "unit": "vol pts",
        "stats": {
            "points": len(points),
            "fixed": len(fixed),
            "atm_start": _round(atm[0][1], 2) if atm else None,
            "atm_end": _round(atm[-1][1], 2) if atm else None,
            "first": points[0]["t"] if points else None,
            "last": points[-1]["t"] if points else None,
        },
    }
    return panel(
        "skew_rotation",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"{spec.name} · ATM IV and 25Δ wings above · CE−PE at fixed strikes below",
        legend=[
            {"color": "var(--rv-text)", "label": "ATM IV"},
            {"color": "var(--rv-green)", "label": "25Δ call"},
            {"color": "var(--rv-red)", "label": "25Δ put"},
            {"color": "var(--rv-violet)", "label": "CE−PE at strike"},
        ],
        note=(
            "The lower panel is the quantity that actually repriced: call IV minus "
            "put IV at the same strike. A missing quote stays blank."
        ),
        span=span,
        height=height,
    )


def basis_3d(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Time × basis × open interest",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 470,
) -> str:
    if isinstance(data, Mapping) and "basis" in data and "rows" not in data and "t" not in data:
        basis_block = data["basis"]
        if isinstance(basis_block, Mapping):
            data = basis_block
    raw, _ = _raw_rows(data, "rows")
    normalised: list[dict[str, Any]] = []
    for index, row in enumerate(raw):
        if not isinstance(row, Mapping):
            raise ValueError(f"row {index}: expected a mapping")
        price = row.get("price", row.get("f", row.get("futures", row.get("close"))))
        normalised.append(
            {
                "t": row.get("clock") or row.get("t") or row.get("m"),
                "basis": row.get("basis", row.get("b")),
                "oi": row.get("oi"),
                "doi": row.get("doi", row.get("oi_change")),
                "price": price,
                "spot": row.get("spot", row.get("s")),
                "volume": row.get("volume", row.get("v")),
            }
        )
    records = _series_rows(
        normalised,
        ("basis", "oi", "doi", "price", "spot", "volume"),
        int_fields=("oi", "volume"),
    )
    valid = [
        record
        for record in records
        if record["basis"] is not None and record["oi"] is not None
    ]
    payload = {
        **_base_payload(spec),
        "t": [record["t"] for record in records],
        "minutes": [record["m"] for record in records],
        "basis": [_round(record["basis"], spec.price_decimals) for record in records],
        "oi": [record["oi"] for record in records],
        "doi": [_round(record["doi"], 0) for record in records],
        "price": [_round(record["price"], spec.price_decimals) for record in records],
        "spot": [_round(record["spot"], spec.price_decimals) for record in records],
        "volume": [record["volume"] for record in records],
        "unit": "pts",
        "domain": {
            "basis": _span([*(record["basis"] for record in records), 0.0], pad=0.1),
            "oi": _span((record["oi"] for record in records), pad=0.1, fallback=1.0),
        },
        "stats": {
            "bars": len(records),
            "points": len(valid),
            "nulls": len(records) - len(valid),
            "first": records[0]["t"] if records else None,
            "last": records[-1]["t"] if records else None,
            "basis_last": _round(valid[-1]["basis"], spec.price_decimals) if valid else None,
            "oi_last": valid[-1]["oi"] if valid else None,
        },
    }
    return panel(
        "basis_3d",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"Plotly 3D · basis in price points · OI in {spec.oi_unit} · {_session(spec)}",
        legend=[
            {"color": "var(--rv-muted)", "label": "session path"},
            {"color": "var(--rv-green)", "label": "OI build"},
            {"color": "var(--rv-red)", "label": "OI unwind"},
        ],
        note=(
            "A minute without both a basis and an open-interest print is a gap in "
            "the path, not a point at zero."
        ),
        span=span,
        height=height,
    )


def basis_regime_strip(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Basis path and regime strip",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 300,
) -> str:
    if isinstance(data, Mapping) and "basis" in data and "rows" not in data and "t" not in data:
        block = data["basis"]
        if isinstance(block, Mapping):
            merged = dict(block)
            for key in ("bands", "regimes", "regime_labels", "bucket_minutes", "threshold"):
                if key in data:
                    merged[key] = data[key]
            data = merged
    raw, meta = _raw_rows(data, "rows")
    records = _series_rows(raw, ("basis", "spot"), text_fields=("regime",))
    bands_raw = meta.get("bands") or meta.get("regimes")
    labels = meta.get("regime_labels") if isinstance(meta.get("regime_labels"), Mapping) else {}
    bucket = meta.get("bucket_minutes")
    bucket = int(bucket) if bucket is not None else None
    threshold = _number(meta.get("threshold"), "threshold") or 0.0

    bands: list[dict[str, Any]] = []
    if bands_raw:
        if not _is_series(bands_raw):
            raise ValueError("data['bands'] must be a list")
        for index, entry in enumerate(bands_raw):
            if not isinstance(entry, Mapping):
                raise ValueError(f"band {index}: expected a mapping")
            regime = entry.get("regime") or entry.get("id") or entry.get("key")
            if not isinstance(regime, str) or not regime.strip():
                raise ValueError(f"band {index}: missing a regime id")
            start = _clock(
                entry.get("start", entry.get("s", entry.get("t"))), f"band {index}.start"
            )
            end_raw = entry.get("end", entry.get("e"))
            start_m = _minute(start)
            if end_raw is None and entry.get("end_m") is None:
                next_start = None
                if index + 1 < len(bands_raw) and isinstance(bands_raw[index + 1], Mapping):
                    following = bands_raw[index + 1]
                    following_value = following.get(
                        "start", following.get("s", following.get("t"))
                    )
                    next_start = _minute(_clock(following_value, f"band {index + 1}.start"))
                end_m = next_start if next_start is not None else start_m + (bucket or 1)
            elif entry.get("end_m") is not None:
                end_m = int(_required(entry.get("end_m"), f"band {index}.end_m"))
            else:
                end_m = _minute(_clock(end_raw, f"band {index}.end"))
            if end_m <= start_m:
                raise ValueError(f"band {index}: end must follow start")
            bands.append(
                {
                    "start": start,
                    "start_m": start_m,
                    "end": _hhmm(end_m),
                    "end_m": end_m,
                    "regime": regime.strip(),
                    "from_basis": _number(
                        entry.get("from_basis", entry.get("from", entry.get("from_b"))),
                        f"band {index}.from",
                    ),
                    "to_basis": _number(
                        entry.get("to_basis", entry.get("to", entry.get("to_b"))),
                        f"band {index}.to",
                    ),
                    "dp": _number(entry.get("dp", entry.get("change")), f"band {index}.dp"),
                }
            )
    else:
        step = bucket
        if step is None and len(records) > 1:
            gaps = sorted(
                records[index + 1]["m"] - records[index]["m"]
                for index in range(len(records) - 1)
                if records[index + 1]["m"] > records[index]["m"]
            )
            step = gaps[len(gaps) // 2] if gaps else 1
        step = max(1, int(step or 1))

        def classify(previous: float | None, current: float | None, explicit: str | None) -> str:
            if explicit:
                return explicit.strip()
            if previous is None or current is None:
                return "basis_flat"
            delta = current - previous
            if delta > threshold:
                return "basis_rising"
            if delta < -threshold:
                return "basis_falling"
            return "basis_flat"

        active: dict[str, Any] | None = None
        previous: dict[str, Any] | None = None
        for record in records:
            if previous is None:
                previous = record
                continue
            regime = classify(previous["basis"], record["basis"], record["regime"])
            adjacent = record["m"] - previous["m"] == step
            if active is not None and (active["regime"] != regime or not adjacent):
                bands.append(active)
                active = None
            if active is None:
                active = {
                    "start": previous["t"],
                    "start_m": previous["m"],
                    "regime": regime,
                    "from_basis": previous["basis"],
                }
            active["end"] = record["t"]
            active["end_m"] = record["m"]
            active["to_basis"] = record["basis"]
            previous = record
        if active is not None:
            bands.append(active)
        elif records:
            bands.append(
                {
                    "start": records[0]["t"],
                    "start_m": records[0]["m"],
                    "end": _hhmm(records[0]["m"] + step),
                    "end_m": records[0]["m"] + step,
                    "regime": "basis_flat",
                    "from_basis": records[0]["basis"],
                    "to_basis": records[0]["basis"],
                }
            )

    for band in bands:
        band["duration"] = band["end_m"] - band["start_m"]
        if (
            band.get("dp") is None
            and band.get("from_basis") is not None
            and band.get("to_basis") is not None
        ):
            band["dp"] = band["to_basis"] - band["from_basis"]
        band["dp"] = _round(band.get("dp"), spec.price_decimals)
        band["from_basis"] = _round(band.get("from_basis"), spec.price_decimals)
        band["to_basis"] = _round(band.get("to_basis"), spec.price_decimals)

    seen: list[str] = []
    for band in bands:
        if band["regime"] not in seen:
            seen.append(band["regime"])
    categories = [_category(regime, labels) for regime in seen]
    timeline = [(record["m"], record["t"], record["basis"], record["spot"]) for record in records]
    if not timeline and bands:
        boundary = sorted(
            {band["start_m"] for band in bands} | {band["end_m"] for band in bands}
        )
        timeline = [(minute, _hhmm(minute), None, None) for minute in boundary]
    values = [item[2] for item in timeline if item[2] is not None]
    payload = {
        **_base_payload(spec),
        "t": [item[1] for item in timeline],
        "minutes": [item[0] for item in timeline],
        "basis": [_round(item[2], spec.price_decimals) for item in timeline],
        "spot": [_round(item[3], spec.price_decimals) for item in timeline],
        "bands": bands,
        "categories": categories,
        "unit": "pts",
        "domain": {"basis": _span(values, pad=0.12)},
        "stats": {
            "bars": len(timeline),
            "bands": len(bands),
            "points": len(values),
            "nulls": len(timeline) - len(values),
            "mean": _round(sum(values) / len(values), spec.price_decimals) if values else None,
            "first": timeline[0][1] if timeline else None,
            "last": timeline[-1][1] if timeline else None,
        },
    }
    return panel(
        "basis_regime_strip",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"basis in price points · zero = parity · {_session(spec)} · hover a band",
        legend=[
            {"color": "var(--rv-amber)", "label": "basis"},
            {"color": "var(--rv-muted)", "label": "session mean"},
            *[
                {"color": f"var(--rv-{category['tone']})", "label": category["label"]}
                for category in categories
            ],
        ],
        note=(
            "The strip is categorical; its colour is the sign of the basis move, "
            "not a second price axis. Minutes without a basis print stay blank."
        ),
        span=span,
        height=height,
    )


# 8. lead/lag: naive row pairing vs clock alignment
def _pearson(xs: Sequence[float], ys: Sequence[float]) -> tuple[float | None, int]:
    n = min(len(xs), len(ys))
    if n < 3:
        return None, n
    xs, ys = xs[:n], ys[:n]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    var_x = sum((x - mean_x) ** 2 for x in xs)
    var_y = sum((y - mean_y) ** 2 for y in ys)
    if var_x <= 0 or var_y <= 0:
        return None, n
    return cov / math.sqrt(var_x * var_y), n


def _fisher_ci(r: float | None, n: int) -> list[float] | None:
    if r is None or n < 4 or abs(r) >= 1:
        return None
    z = math.atanh(r)
    se = 1 / math.sqrt(n - 3)
    return [round(math.tanh(z - 1.96 * se), 4), round(math.tanh(z + 1.96 * se), 4)]


def _lag_pairs(xs: Sequence[float], ys: Sequence[float], lag: int) -> tuple[list[float], list[float]]:
    pairs: list[tuple[float, float]] = []
    if lag >= 0:
        for index in range(len(xs) - lag):
            pairs.append((xs[index], ys[index + lag]))
    else:
        for index in range(-lag, len(xs)):
            pairs.append((xs[index], ys[index + lag]))
    return [pair[0] for pair in pairs], [pair[1] for pair in pairs]


def _diff(values: Sequence[float]) -> list[float]:
    return [values[index] - values[index - 1] for index in range(1, len(values))]


def _lead_lag_from_series(
    data: Mapping[str, Any], spec: InstrumentSpec
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    head = data.get("a")
    reference = data.get("b")
    if head is None or reference is None:
        series = data.get("series")
        if not isinstance(series, Mapping) or len(series) < 2:
            raise ValueError(
                "lead_lag needs either 'rows' of correlations or 'a'/'b' (or two 'series')"
            )
        keys = list(series)
        head, reference = series[keys[0]], series[keys[1]]
    head_points = _value_points(head or [], "a")
    reference_points = _value_points(reference or [], "b")
    if len(head_points) < 3 or len(reference_points) < 3:
        raise ValueError("lead_lag needs at least three prints in each series")

    lags_raw = data.get("lags")
    if lags_raw is None:
        lag_range = data.get("lag_range") or [-5, 5]
        if not _is_series(lag_range) or len(lag_range) != 2:
            raise ValueError("data['lag_range'] must be [low, high]")
        low = int(_required(lag_range[0], "lag_range[0]"))
        high = int(_required(lag_range[1], "lag_range[1]"))
        lags = list(range(min(low, high), max(low, high) + 1))
    else:
        if not _is_series(lags_raw):
            raise ValueError("data['lags'] must be a list of integers")
        lags = [int(_required(value, f"lags[{index}]")) for index, value in enumerate(lags_raw)]
    if 0 not in lags:
        lags = sorted({0, *lags})

    head_values = [value for _, value in head_points]
    reference_values = [value for _, value in reference_points]
    naive_x = _diff(head_values)
    naive_y = _diff(reference_values)

    head_map = dict(head_points)
    reference_map = dict(reference_points)
    common = sorted(set(head_map) & set(reference_map))
    aligned_x = _diff([head_map[minute] for minute in common])
    aligned_y = _diff([reference_map[minute] for minute in common])

    rows: list[dict[str, Any]] = []
    for lag in lags:
        nx, ny = _lag_pairs(naive_x, naive_y, lag)
        naive_r, naive_n = _pearson(nx, ny)
        ax, ay = _lag_pairs(aligned_x, aligned_y, lag)
        aligned_r, aligned_n = _pearson(ax, ay)
        rows.append(
            {
                "lag": lag,
                "naive": _round(naive_r, 4),
                "aligned": _round(aligned_r, 4),
                "naive_n": naive_n,
                "aligned_n": aligned_n,
                "naive_ci": _fisher_ci(naive_r, naive_n),
                "aligned_ci": _fisher_ci(aligned_r, aligned_n),
            }
        )

    def best(field: str) -> int | None:
        usable = [row for row in rows if row[field] is not None]
        if not usable:
            return None
        return max(usable, key=lambda row: abs(row[field]))["lag"]

    concurrent = next((row for row in rows if row["lag"] == 0), None)
    stats = {
        "head_rows": len(head_points),
        "reference_rows": len(reference_points),
        "common_clocks": len(common),
        "naive_n": len(naive_x),
        "aligned_n": len(aligned_x),
        "concurrent_naive": concurrent["naive"] if concurrent else None,
        "concurrent_aligned": concurrent["aligned"] if concurrent else None,
        "best_lag_naive": best("naive"),
        "best_lag_aligned": best("aligned"),
    }
    return rows, stats


def lead_lag(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Lead–lag, naive vs clock-aligned",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 300,
) -> str:
    """Correlation at each lag, computed twice.

    ``naive`` pairs the two streams by row order — the trap that silently
    compares 09:17 with 09:19 after one feed drops a minute.  ``aligned``
    pairs only minutes present in both streams, so the clock does the joining.
    Pre-computed rows are accepted as ``{'rows': [...]}``.
    """
    if isinstance(data, Mapping) and "leadlag" in data and "rows" not in data and "a" not in data:
        block = data["leadlag"]
        if isinstance(block, Mapping):
            merged = dict(block)
            for key in (
                "labels",
                "naive_label",
                "aligned_label",
                "head_label",
                "reference_label",
                "stats",
            ):
                if key in data:
                    merged[key] = data[key]
            data = merged
    if isinstance(data, Mapping) and "rows" in data:
        raw = data["rows"]
        meta = {key: value for key, value in data.items() if key != "rows"}
        if not _is_series(raw):
            raise ValueError("data['rows'] must be a list")
        rows: list[dict[str, Any]] = []
        previous: int | None = None
        for index, row in enumerate(raw):
            if not isinstance(row, Mapping):
                raise ValueError(f"row {index}: expected a mapping")
            lag = int(_required(row.get("lag"), f"row {index}.lag"))
            if previous is not None and lag <= previous:
                raise ValueError(f"row {index}: lags must strictly increase")
            previous = lag
            aligned = _number(row.get("aligned", row.get("sync")), f"row {index}.aligned")
            rows.append(
                {
                    "lag": lag,
                    "naive": _round(_number(row.get("naive"), f"row {index}.naive"), 4),
                    "aligned": _round(aligned, 4),
                    "naive_n": int(
                        _number(row.get("naive_n", row.get("n_naive")), f"row {index}.naive_n")
                        or 0
                    ),
                    "aligned_n": int(
                        _number(row.get("aligned_n", row.get("n_sync")), f"row {index}.aligned_n")
                        or 0
                    ),
                    "naive_ci": row.get("naive_ci"),
                    "aligned_ci": row.get("aligned_ci", row.get("sync_ci")),
                }
            )
        if not rows:
            raise ValueError("lead_lag needs at least one correlation row")
        stats = meta.get("stats") if isinstance(meta.get("stats"), Mapping) else {}
    elif isinstance(data, Mapping) and ("a" in data or "series" in data):
        rows, stats = _lead_lag_from_series(data, spec)
        meta = data
    elif _is_series(data):
        raise ValueError("lead_lag needs timestamps to align two series; pass {'a': [...], 'b': [...]}")
    else:
        raise ValueError(f"lead_lag: unsupported data type {type(data).__name__}")

    labels_meta = meta.get("labels") if isinstance(meta.get("labels"), Mapping) else {}
    labels = {
        "naive": str(meta.get("naive_label") or labels_meta.get("naive") or "naive row order"),
        "aligned": str(
            meta.get("aligned_label") or labels_meta.get("aligned") or "clock-aligned"
        ),
        "head": str(meta.get("head_label") or labels_meta.get("head") or spec.name),
        "reference": str(
            meta.get("reference_label") or labels_meta.get("reference") or "reference"
        ),
    }
    payload = {
        **_base_payload(spec),
        "rows": rows,
        "labels": labels,
        "stats": dict(stats),
    }
    return panel(
        "lead_lag",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or (
            f"1-minute change correlation · negative lag = {labels['head']} leads · "
            "aligned pairs only clocks present in both streams"
        ),
        legend=[
            {"color": "var(--rv-muted)", "label": labels["naive"]},
            {"color": "var(--rv-blue)", "label": labels["aligned"]},
        ],
        note=(
            "The naive bars pair rows by position; one missing minute shifts every "
            "later pair. The aligned bars join on the clock instead."
        ),
        span=span,
        height=height,
    )


def nifty_vs_sensex(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Normalised comparison and spread",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 340,
) -> str:
    """Two (or more) series normalised to % change, plus the pair's spread.

    The chart id is historical; every label in the payload comes from the
    caller.  ``spread`` is the first pair's relative performance in basis
    points, not a price difference between instruments at different levels.
    """
    if isinstance(data, Mapping) and "cross" in data and "series" not in data:
        block = data["cross"]
        if isinstance(block, Mapping):
            if "series" in block:
                data = dict(block)
            elif "rows" in block:
                rows = block.get("rows")
                labels = block.get("labels") or data.get("labels")
                fields = block.get("fields") or data.get("fields")
                if not _is_series(rows) or not _is_series(labels) or not _is_series(fields):
                    raise ValueError(
                        "cross rows need payload 'labels' and 'fields' so series names come from the caller"
                    )
                if len(labels) != len(fields):
                    raise ValueError("cross labels and fields must have the same length")
                data = {
                    "series": [
                        {
                            "label": labels[index],
                            "points": [
                                {
                                    "t": row.get("t", row.get("m")),
                                    "value": row.get(fields[index]),
                                }
                                for row in rows
                                if isinstance(row, Mapping)
                            ],
                        }
                        for index in range(len(labels))
                    ]
                }
            else:
                data = dict(block)
    if isinstance(data, Mapping) and "series" in data:
        series_raw = data["series"]
        meta = {key: value for key, value in data.items() if key != "series"}
        if isinstance(series_raw, Mapping):
            series_raw = [
                {"label": label, "points": points}
                for label, points in series_raw.items()
            ]
    else:
        series_raw = data
        meta = {}
    if not _is_series(series_raw) or len(series_raw) < 1:
        raise ValueError("nifty_vs_sensex needs at least one labelled series")

    series: list[dict[str, Any]] = []
    for index, raw in enumerate(series_raw):
        if not isinstance(raw, Mapping):
            raise ValueError(f"series {index}: expected a mapping")
        label = raw.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"series {index}: label is required")
        points = raw.get("points") if "points" in raw else None
        if points is None and "t" in raw:
            points = raw
        if points is None:
            raise ValueError(f"series {index}: add points")
        records = _value_records(points, f"series {index}")
        values = [(record["m"], record["value"]) for record in records]
        base_pairs = [(minute, value) for minute, value in values if value is not None]
        if not base_pairs:
            raise ValueError(f"series {index}: needs at least one value")
        base = base_pairs[0][1]
        if base == 0:
            raise ValueError(f"series {index}: first value must be non-zero")
        pct = [
            {
                "t": _hhmm(minute),
                "m": minute,
                "pct": None if value is None else round((value / base - 1) * 100, 4),
            }
            for minute, value in values
        ]
        finite = [item["pct"] for item in pct if item["pct"] is not None]
        last = next(item for item in reversed(pct) if item["pct"] is not None)
        series.append(
            {
                "label": label.strip(),
                "t": [item["t"] for item in pct],
                "minutes": [item["m"] for item in pct],
                "pct": [item["pct"] for item in pct],
                "base": round(base, spec.price_decimals),
                "points": len(pct),
                "last_t": last["t"],
                "last_pct": round(last["pct"], 4),
                "min_pct": min(finite),
                "max_pct": max(finite),
            }
        )

    pair = meta.get("spread_pair") or [0, 1]
    if not _is_series(pair) or len(pair) != 2:
        raise ValueError("data['spread_pair'] must be [index_a, index_b]")
    first, second = int(pair[0]), int(pair[1])
    if not (0 <= first < len(series)) or not (0 <= second < len(series)):
        raise ValueError("data['spread_pair'] indexes outside the series list")
    left = dict(zip(series[first]["minutes"], series[first]["pct"]))
    right = dict(zip(series[second]["minutes"], series[second]["pct"]))
    common = sorted(set(left) & set(right))
    spread = []
    for minute in common:
        a_value, b_value = left[minute], right[minute]
        if a_value is None or b_value is None:
            continue
        spread.append(
            {
                "t": _hhmm(minute),
                "m": minute,
                "bps": round((a_value - b_value) * 100, 2),
            }
        )
    payload = {
        **_base_payload(spec),
        "series": series,
        "spread": spread,
        "spread_pair": [series[first]["label"], series[second]["label"]],
        "spread_unit": "bps",
        "stats": {
            "series": len(series),
            "spread_points": len(spread),
            "spread_last": spread[-1]["bps"] if spread else None,
            "spread_min": min((item["bps"] for item in spread), default=None),
            "spread_max": max((item["bps"] for item in spread), default=None),
        },
    }
    return panel(
        "nifty_vs_sensex",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"% change from each series' first print · spread in bps · {_session(spec)}",
        legend=[
            {"color": "var(--rv-amber)", "label": series[0]["label"]},
            *(
                [{"color": "var(--rv-blue)", "label": series[1]["label"]}]
                if len(series) > 1
                else []
            ),
            {"color": "var(--rv-muted)", "label": "spread · bps"},
        ],
        note=(
            "Each series is rebased to its own first print, so levels never have to "
            "match. The spread is relative performance in basis points; a missing "
            "minute is left out of the spread rather than filled."
        ),
        span=span,
        height=height,
    )


def futures_quadrants(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Price / OI quadrants",
    subtitle: str | None = None,
    span: int = 1,
    height: int = 340,
) -> str:
    if isinstance(data, Mapping) and "regimes" in data and "rows" not in data and "t" not in data:
        data = {"rows": data["regimes"]}
    raw, _ = _raw_rows(data, "rows")
    normalised = []
    for index, row in enumerate(raw):
        if not isinstance(row, Mapping):
            raise ValueError(f"row {index}: expected a mapping")
        normalised.append(
            {
                "t": row.get("t", row.get("start", row.get("s", row.get("m")))),
                "dp": row.get("dp"),
                "doi": row.get("doi", row.get("oi_change")),
                "volume": row.get("volume", row.get("vol")),
                "label": row.get("label"),
                "start": row.get("start", row.get("s")),
                "end": row.get("end", row.get("e")),
                "regime": row.get("regime", row.get("key")),
            }
        )
    records = _series_rows(
        normalised,
        ("dp", "doi", "volume"),
        int_fields=("volume",),
        text_fields=("label", "start", "end", "regime"),
    )
    points: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for index, record in enumerate(records):
        regime = record["regime"]
        if regime not in _REGIME_LABELS:
            dp, doi = record["dp"], record["doi"]
            if dp is None or doi is None:
                regime = "neutral"
            elif dp > 0 and doi > 0:
                regime = "long_buildup"
            elif dp < 0 and doi > 0:
                regime = "short_buildup"
            elif dp < 0 and doi < 0:
                regime = "long_unwinding"
            elif dp > 0 and doi < 0:
                regime = "short_covering"
            else:
                regime = "neutral"
        counts[regime] = counts.get(regime, 0) + 1
        label = record["label"]
        if not label:
            if record["start"] and record["end"]:
                label = f"{record['start']}–{record['end']}"
            else:
                label = f"Bucket {index + 1}"
        points.append(
            {
                "label": label,
                "start": record["start"],
                "end": record["end"],
                "dp": _round(record["dp"], spec.price_decimals),
                "doi": _round(record["doi"], 0),
                "volume": record["volume"],
                "regime": regime,
            }
        )
    payload = {
        **_base_payload(spec),
        "points": points,
        "categories": [_category(regime) for regime in _QUADRANT_IDS],
        "unit": "pts",
        "domain": {
            "doi": _span([*(point["doi"] for point in points), 0.0], pad=0.2, fallback=1.0),
            "dp": _span([*(point["dp"] for point in points), 0.0], pad=0.2, fallback=1.0),
        },
        "stats": {
            "buckets": len(points),
            "counts": counts,
            "nulls": sum(1 for point in points if point["dp"] is None or point["doi"] is None),
        },
    }
    return panel(
        "futures_quadrants",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"bucket Δprice × ΔOI · bubble = volume ({spec.oi_unit}) · {_session(spec)}",
        legend=[
            {"color": "var(--rv-green)", "label": "Long buildup"},
            {"color": "var(--rv-red)", "label": "Short buildup"},
            {"color": "var(--rv-amber)", "label": "Long unwinding"},
            {"color": "var(--rv-blue)", "label": "Short covering"},
        ],
        note=(
            "Quadrants are the sign of Δprice and ΔOI. A bucket missing either "
            "change is kept in the payload but not plotted."
        ),
        span=span,
        height=height,
    )


def event_study(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Event study",
    subtitle: str | None = None,
    span: int = 2,
    height: int = 380,
) -> str:
    """Small multiples of each event's path around its anchor minute.

    Path offsets are minutes relative to the anchor; the shaded region is the
    event's own duration.  A missing path point breaks the line.
    """
    if isinstance(data, Mapping) and "smallmult" in data and "events" not in data:
        data = {"events": data["smallmult"], "window": data.get("window") or [-30, 30]}
    raw, meta = _raw_rows(data, "events")
    window = meta.get("window") or [-30, 30]
    if not _is_series(window) or len(window) != 2:
        raise ValueError("data['window'] must be [low, high]")
    low = int(_required(window[0], "window[0]"))
    high = int(_required(window[1], "window[1]"))
    if high <= low:
        raise ValueError("data['window'] must increase")

    events: list[dict[str, Any]] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, Mapping):
            raise ValueError(f"event {index}: expected a mapping")
        event_id = str(entry.get("id") or f"E{index + 1}")
        label = entry.get("label")
        label = label.strip() if isinstance(label, str) and label.strip() else event_id
        start_raw = entry.get("start") or entry.get("t0")
        end_raw = entry.get("end") or entry.get("t1")
        start = _clock(start_raw, f"event {index}.start") if start_raw is not None else None
        end = _clock(end_raw, f"event {index}.end") if end_raw is not None else None
        anchor_raw = entry.get("anchor") or start_raw
        anchor = _clock(anchor_raw, f"event {index}.anchor") if anchor_raw is not None else None
        anchor_minute = _minute(anchor) if anchor else None
        if start is not None and end is not None:
            duration = _minute(end) - _minute(start)
        elif entry.get("duration") is not None:
            duration = int(_required(entry.get("duration"), f"event {index}.duration"))
        else:
            duration = 0
        if duration < 0:
            raise ValueError(f"event {index}: end must not precede start")

        path_raw = entry.get("path", entry.get("points"))
        if not _is_series(path_raw) or not path_raw:
            raise ValueError(f"event {index}: add a path of offset/value points")
        path: list[dict[str, Any]] = []
        previous: int | None = None
        for position, item in enumerate(path_raw):
            if not isinstance(item, Mapping):
                raise ValueError(f"event {index}.path[{position}]: expected a mapping")
            if item.get("offset") is not None:
                offset = int(_required(item.get("offset"), f"event {index}.path[{position}].offset"))
            elif item.get("m") is not None:
                offset = int(_required(item.get("m"), f"event {index}.path[{position}].m"))
            elif item.get("t") is not None:
                if anchor_minute is None:
                    raise ValueError(
                        f"event {index}: clock offsets need an anchor clock"
                    )
                offset = _minute(_clock(item.get("t"), f"event {index}.path[{position}].t")) - anchor_minute
            else:
                raise ValueError(f"event {index}.path[{position}]: add offset or t")
            if previous is not None and offset <= previous:
                raise ValueError(f"event {index}: path offsets must strictly increase")
            previous = offset
            value = _number(
                item.get("value", item.get("p", item.get("change"))),
                f"event {index}.path[{position}].value",
            )
            path.append({"offset": offset, "value": _round(value, spec.price_decimals)})
        values = [point["value"] for point in path if point["value"] is not None]
        move = entry.get("move")
        move = _number(move, f"event {index}.move") if move is not None else (
            values[-1] - values[0] if len(values) >= 2 else None
        )
        events.append(
            {
                "id": event_id,
                "label": label,
                "start": start,
                "end": end,
                "anchor": anchor,
                "duration": duration,
                "path": path,
                "move": _round(move, spec.price_decimals),
            }
        )

    payload = {
        **_base_payload(spec),
        "events": events,
        "window": [low, high],
        "unit": "pts",
        "labels": {"x": "minutes from anchor", "y": "change from anchor"},
        "stats": {
            "events": len(events),
            "points": sum(len(event["path"]) for event in events),
            "nulls": sum(
                1 for event in events for point in event["path"] if point["value"] is None
            ),
        },
    }
    return panel(
        "event_study",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"one panel per event · {low} to {high} minutes around the anchor · shaded = event window",
        legend=[
            {"color": "var(--rv-green)", "label": "up move"},
            {"color": "var(--rv-red)", "label": "down move"},
            {"color": "var(--rv-raised)", "label": "event window"},
        ],
        note=(
            "Offsets are minutes relative to the anchor; a missing minute breaks "
            "the path instead of being drawn through."
        ),
        span=span,
        height=height,
    )

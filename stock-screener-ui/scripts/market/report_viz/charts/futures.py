"""Futures panels: price/open interest, basis, regimes and volume.

The four builders share one row contract.  A row carries ``t`` (``HH:MM`` or an
ISO timestamp), ``close``, ``oi``, ``basis``, ``spot`` and ``volume``, with an
optional ``regime`` id.  ``basis`` is futures minus spot in **price points**;
``None`` means "no same-minute spot print" and must stay a gap, never ``0``.

Everything instrument-specific (currency, price decimals, strike step, lot,
OI unit, session window) comes from :class:`InstrumentSpec`; nothing here
assumes an index level, a 50-point ladder, rupee units or one exchange's
session hours.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from ..contracts import InstrumentSpec
from ..page import panel

__all__ = [
    "futures_price_oi",
    "futures_basis",
    "futures_regimes",
    "futures_volume",
]

REGIME_LABELS = {
    "long_buildup": "Long buildup",
    "short_buildup": "Short buildup",
    "long_unwinding": "Long unwinding",
    "short_covering": "Short covering",
    "neutral": "Neutral",
}

#: CSS custom-property tone per regime, resolved by ``core.js`` (RV.colors).
REGIME_TONES = {
    "long_buildup": "green",
    "short_buildup": "red",
    "long_unwinding": "amber",
    "short_covering": "blue",
    "neutral": "muted",
}

_TIME_RE = re.compile(r"(\d{2}):(\d{2})")
_ROW_FIELDS = ("t", "close", "oi", "basis", "spot", "volume", "regime")


def _clock(value: Any, where: str) -> str:
    if isinstance(value, str):
        match = _TIME_RE.search(value)
        if match:
            hour, minute = int(match.group(1)), int(match.group(2))
            if 0 <= hour < 24 and 0 <= minute < 60:
                return f"{hour:02d}:{minute:02d}"
    raise ValueError(f"{where}: expected HH:MM or an ISO timestamp, got {value!r}")


def _minute(label: str) -> int:
    return int(label[:2]) * 60 + int(label[3:5])


def _hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _number(value: Any, where: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{where}: expected a number, got {value!r}")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{where}: expected a number, got {value!r}") from exc
    # NaN/inf are pandas' missing markers, not a measurable value.
    return number if math.isfinite(number) else None


def _count(value: Any, where: str) -> int | None:
    number = _number(value, where)
    return None if number is None else int(round(number))


def _is_series(value: Any) -> bool:
    return (
        not isinstance(value, (str, bytes, Mapping))
        and hasattr(value, "__len__")
        and hasattr(value, "__getitem__")
    )


def _column_rows(columns: Mapping[str, Any]) -> list[dict[str, Any]]:
    times = columns["t"]
    if not _is_series(times):
        raise ValueError("data['t'] must be a sequence of timestamps")
    length = len(times)
    for field in _ROW_FIELDS[1:]:
        series = columns.get(field)
        if isinstance(series, (str, bytes)):
            raise ValueError(f"data[{field!r}] must be a sequence, not a string")
        if _is_series(series) and len(series) != length:
            raise ValueError(
                f"data[{field!r}] has {len(series)} values, data['t'] has {length}"
            )
    return [
        {
            field: columns[field][index]
            for field in _ROW_FIELDS
            if field in columns and _is_series(columns[field])
        }
        for index in range(length)
    ]


def _split(data: Any) -> tuple[list[Any], dict[str, Any]]:
    if isinstance(data, Mapping):
        meta = dict(data)
        if "rows" in meta:
            rows = meta.pop("rows")
            if not _is_series(rows):
                raise ValueError("data['rows'] must be a sequence of row mappings")
            return list(rows), meta
        if "bands" in meta or "regimes" in meta:
            return [], meta
        if "t" in meta:
            if isinstance(meta["t"], (str, bytes)):
                return [meta], {}
            if _is_series(meta["t"]):
                return _column_rows(meta), meta
        raise ValueError(
            "data must be a row list, a {field: series} mapping, or a "
            "{'rows': [...]} / {'bands': [...]} mapping"
        )
    if _is_series(data):
        return list(data), {}
    raise ValueError(f"data must be a mapping or a sequence, got {type(data).__name__}")


def _records(
    data: Any, fields: Iterable[str]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw, meta = _split(data)
    return _records_from_raw(raw, fields), meta


def _records_from_raw(
    raw: Sequence[Any], fields: Iterable[str]
) -> list[dict[str, Any]]:
    wanted = tuple(fields)
    records: list[dict[str, Any]] = []
    previous: int | None = None
    for index, row in enumerate(raw):
        if not isinstance(row, Mapping):
            raise ValueError(f"row {index}: expected a mapping, got {type(row).__name__}")
        label = _clock(row.get("t"), f"row {index}.t")
        minute = _minute(label)
        if previous is not None and minute <= previous:
            raise ValueError(
                f"row {index}: timestamps must strictly increase "
                f"({label} after {_hhmm(previous)})"
            )
        previous = minute
        record: dict[str, Any] = {"t": label, "m": minute}
        for field in wanted:
            if field in ("oi", "volume"):
                record[field] = _count(row.get(field), f"row {index}.{field}")
            else:
                record[field] = _number(row.get(field), f"row {index}.{field}")
        regime = row.get("regime")
        if regime is not None and not isinstance(regime, str):
            raise ValueError(f"row {index}.regime: expected a string id, got {regime!r}")
        record["regime"] = regime
        records.append(record)
    return records


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def _pairs(records: Sequence[Mapping[str, Any]], field: str) -> list[tuple[str, Any]]:
    return [(row["t"], row[field]) for row in records if row[field] is not None]


def _stats_head(pairs: Sequence[tuple[str, Any]], digits: int) -> dict[str, Any]:
    if not pairs:
        return {
            "first": None,
            "first_t": None,
            "last": None,
            "last_t": None,
            "change": None,
        }
    first_t, first = pairs[0]
    last_t, last = pairs[-1]
    return {
        "first": _round(first, digits),
        "first_t": first_t,
        "last": _round(last, digits),
        "last_t": last_t,
        "change": _round(last - first, digits),
    }


def _session(spec: InstrumentSpec) -> str:
    return f"{spec.session_open}–{spec.session_close} {spec.timezone}"


def _point_legend(color: str, label: str) -> tuple[str, str]:
    return (f"var(--rv-{color})", label)


def futures_price_oi(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Futures close and open interest",
    subtitle: str | None = None,
    note: str | None = None,
    legend: Iterable[Any] | None = None,
    span: int = 2,
    height: int = 320,
) -> str:
    records, _ = _records(data, ("close", "oi", "volume"))
    digits = spec.price_decimals
    price_pairs = _pairs(records, "close")
    oi_pairs = _pairs(records, "oi")

    stats = _stats_head(price_pairs, digits)
    if price_pairs:
        high_t, high = max(price_pairs, key=lambda pair: pair[1])
        low_t, low = min(price_pairs, key=lambda pair: pair[1])
        stats.update(
            {
                "high": _round(high, digits),
                "high_t": high_t,
                "low": _round(low, digits),
                "low_t": low_t,
                "change_pct": (
                    round((price_pairs[-1][1] / price_pairs[0][1] - 1) * 100, 3)
                    if price_pairs[0][1]
                    else None
                ),
            }
        )
    else:
        stats.update({"high": None, "high_t": None, "low": None, "low_t": None, "change_pct": None})

    stats.update(
        {
            "oi_first": oi_pairs[0][1] if oi_pairs else None,
            "oi_first_t": oi_pairs[0][0] if oi_pairs else None,
            "oi_last": oi_pairs[-1][1] if oi_pairs else None,
            "oi_last_t": oi_pairs[-1][0] if oi_pairs else None,
            "oi_change": (oi_pairs[-1][1] - oi_pairs[0][1]) if oi_pairs else None,
            "bars": len(records),
            "price_nulls": len(records) - len(price_pairs),
            "oi_nulls": len(records) - len(oi_pairs),
        }
    )

    payload = {
        "t": [row["t"] for row in records],
        "close": [row["close"] for row in records],
        "oi": [row["oi"] for row in records],
        "volume": [row["volume"] for row in records],
        "stats": stats,
    }
    return panel(
        "futures_price_oi",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or (
            f"left axis {spec.currency_symbol} price · right axis {spec.oi_unit} · "
            f"{_session(spec)}"
        ),
        legend=legend
        if legend is not None
        else [
            _point_legend("amber", "Futures close"),
            _point_legend("blue", f"Open interest ({spec.oi_unit})"),
        ],
        note=note
        or "Price and open interest share a time axis but not a scale. "
        "Missing minutes stay gaps, never zero.",
        span=span,
        height=height,
    )


def futures_basis(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Basis: futures minus spot",
    subtitle: str | None = None,
    note: str | None = None,
    legend: Iterable[Any] | None = None,
    span: int = 1,
    height: int = 280,
) -> str:
    raw, _ = _split(data)
    records = _records_from_raw(raw, ("close", "spot", "basis"))
    if not any(isinstance(row, Mapping) and "basis" in row for row in raw):
        for row in records:
            if row["close"] is not None and row["spot"] is not None:
                row["basis"] = row["close"] - row["spot"]

    digits = spec.price_decimals
    pairs = _pairs(records, "basis")
    stats = _stats_head(pairs, digits)
    if pairs:
        min_t, minimum = min(pairs, key=lambda pair: pair[1])
        max_t, maximum = max(pairs, key=lambda pair: pair[1])
        stats.update(
            {
                "min": _round(minimum, digits),
                "min_t": min_t,
                "max": _round(maximum, digits),
                "max_t": max_t,
                "mean": round(sum(value for _, value in pairs) / len(pairs), digits),
                "positive_share": round(
                    sum(1 for _, value in pairs if value > 0) / len(pairs), 4
                ),
            }
        )
    else:
        stats.update(
            {
                "min": None,
                "min_t": None,
                "max": None,
                "max_t": None,
                "mean": None,
                "positive_share": None,
            }
        )
    stats.update(
        {
            "points": len(pairs),
            "nulls": len(records) - len(pairs),
            "coverage_end": records[-1]["t"] if records else None,
        }
    )

    payload = {
        "t": [row["t"] for row in records],
        "basis": [row["basis"] for row in records],
        "close": [row["close"] for row in records],
        "spot": [row["spot"] for row in records],
        "unit": "pts",
        "stats": stats,
    }
    mean_label = spec.points(stats["mean"], 1)
    return panel(
        "futures_basis",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle
        or f"futures − spot in price points · zero = parity · {_session(spec)}",
        legend=legend
        if legend is not None
        else [
            _point_legend("green", "Futures − spot"),
            _point_legend("muted", f"Session mean {mean_label}"),
            _point_legend("text", "Zero = parity"),
        ],
        note=note
        or "Basis is futures − spot in price points, not percent. A minute without a "
        "same-minute spot print is blank, not a zero basis.",
        span=span,
        height=height,
    )


def _labels(meta: Mapping[str, Any]) -> dict[str, str]:
    labels = dict(REGIME_LABELS)
    extra = meta.get("regime_labels") or meta.get("labels") or {}
    if isinstance(extra, Mapping):
        for key, value in extra.items():
            if isinstance(key, str) and isinstance(value, str) and value.strip():
                labels[key] = value.strip()
    return labels


def _band_from_entry(entry: Any, index: int) -> dict[str, Any]:
    if not isinstance(entry, Mapping):
        raise ValueError(f"band {index}: expected a mapping, got {type(entry).__name__}")
    regime = entry.get("regime") or entry.get("id") or entry.get("name")
    if not isinstance(regime, str) or not regime:
        raise ValueError(f"band {index}: missing a regime id")
    if entry.get("start_m") is not None:
        start_value = _number(entry["start_m"], f"band {index}.start_m")
        if start_value is None:
            raise ValueError(f"band {index}.start_m: expected minutes, got {entry['start_m']!r}")
        start_m = int(start_value)
        start = _hhmm(start_m)
    else:
        start = _clock(entry.get("start", entry.get("t")), f"band {index}.start")
        start_m = _minute(start)
    end_m: int | None = None
    if entry.get("end_m") is not None:
        end_value = _number(entry["end_m"], f"band {index}.end_m")
        if end_value is None:
            raise ValueError(f"band {index}.end_m: expected minutes, got {entry['end_m']!r}")
        end_m = int(end_value)
    elif entry.get("end") is not None:
        end_m = _minute(_clock(entry["end"], f"band {index}.end"))
    return {
        "start": start,
        "start_m": start_m,
        "end": _hhmm(end_m) if end_m is not None else None,
        "end_m": end_m,
        "regime": regime,
        "from_price": _number(
            entry.get("from_price", entry.get("from")), f"band {index}.from_price"
        ),
        "to_price": _number(
            entry.get("to_price", entry.get("to")), f"band {index}.to_price"
        ),
        "dp": _number(entry.get("dp", entry.get("change")), f"band {index}.dp"),
        "doi": _count(entry.get("doi", entry.get("oi_change")), f"band {index}.doi"),
        "volume": _count(entry.get("volume"), f"band {index}.volume"),
    }


def _bands_from_entries(
    entries: Sequence[Any], meta: Mapping[str, Any], digits: int
) -> list[dict[str, Any]]:
    bands = [_band_from_entry(entry, index) for index, entry in enumerate(entries)]
    for index in range(1, len(bands)):
        if bands[index]["start_m"] <= bands[index - 1]["start_m"]:
            raise ValueError(
                f"band {index}: bands must be ordered by start "
                f"({bands[index]['start']} after {bands[index - 1]['start']})"
            )
    bucket = meta.get("bucket_minutes")
    bucket = int(bucket) if bucket is not None else None
    for index, band in enumerate(bands):
        if band["end_m"] is None or band["end_m"] <= band["start_m"]:
            following = bands[index + 1]["start_m"] if index + 1 < len(bands) else None
            if following is not None:
                band["end_m"] = following
            elif bucket:
                band["end_m"] = band["start_m"] + bucket
            elif index:
                band["end_m"] = band["start_m"] + max(
                    1, band["start_m"] - bands[index - 1]["start_m"]
                )
            else:
                raise ValueError(
                    f"band {index}: add an end or a data['bucket_minutes'] value"
                )
            band["end"] = _hhmm(band["end_m"])
    for band in bands:
        band["duration"] = band["end_m"] - band["start_m"]
        if (
            band["dp"] is None
            and band["from_price"] is not None
            and band["to_price"] is not None
        ):
            band["dp"] = band["to_price"] - band["from_price"]
        band["dp"] = _round(band["dp"], digits)
        band["from_price"] = _round(band["from_price"], digits)
        band["to_price"] = _round(band["to_price"], digits)
    return bands


def _bands_from_rows(
    records: Sequence[Mapping[str, Any]], digits: int
) -> list[dict[str, Any]]:
    if not records:
        return []
    if not any(row["regime"] is not None for row in records):
        raise ValueError(
            "futures_regimes needs a 'regime' per row or a data['bands'] list"
        )
    step = 1
    if len(records) > 1:
        gaps = sorted(
            records[i + 1]["m"] - records[i]["m"] for i in range(len(records) - 1)
        )
        step = max(1, gaps[len(gaps) // 2])

    bands: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for index, row in enumerate(records):
        regime = row["regime"]
        if current is not None and regime != current["regime"]:
            current["end_m"] = row["m"]
            current["end"] = row["t"]
            bands.append(current)
            current = None
        if regime is None:
            continue
        if current is None:
            current = {
                "start": row["t"],
                "start_m": row["m"],
                "end": None,
                "end_m": None,
                "regime": regime,
                "rows": [],
            }
        current["rows"].append(index)
    if current is not None:
        current["end_m"] = records[-1]["m"] + step
        current["end"] = _hhmm(current["end_m"])
        bands.append(current)

    out: list[dict[str, Any]] = []
    for band in bands:
        first, last = band["rows"][0], band["rows"][-1]
        boundary = records[first - 1] if first else records[first]
        from_price = boundary["close"]
        to_price = records[last]["close"]
        from_oi = boundary["oi"]
        to_oi = records[last]["oi"]
        volume_values = [
            records[index]["volume"]
            for index in band["rows"]
            if records[index]["volume"] is not None
        ]
        out.append(
            {
                "start": band["start"],
                "start_m": band["start_m"],
                "end": band["end"],
                "end_m": band["end_m"],
                "duration": band["end_m"] - band["start_m"],
                "regime": band["regime"],
                "from_price": _round(from_price, digits),
                "to_price": _round(to_price, digits),
                "dp": _round(
                    None if from_price is None or to_price is None else to_price - from_price,
                    digits,
                ),
                "doi": (
                    None if from_oi is None or to_oi is None else to_oi - from_oi
                ),
                "volume": sum(volume_values) if volume_values else None,
            }
        )
    return out


def futures_regimes(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str | None = None,
    subtitle: str | None = None,
    note: str | None = None,
    legend: Iterable[Any] | None = None,
    span: int = 2,
    height: int = 150,
) -> str:
    records, meta = _records(data, ("close", "oi", "volume"))
    digits = spec.price_decimals
    entries = meta.get("bands") or meta.get("regimes")
    bands = (
        _bands_from_entries(entries, meta, digits)
        if entries
        else _bands_from_rows(records, digits)
    )

    labels = _labels(meta)
    seen: list[str] = []
    for band in bands:
        if band["regime"] not in seen:
            seen.append(band["regime"])
    ordered = list(REGIME_LABELS) + [regime for regime in seen if regime not in REGIME_LABELS]
    categories = [
        {
            "id": regime,
            "label": labels.get(regime, regime.replace("_", " ").title()),
            "tone": REGIME_TONES.get(regime, "muted"),
        }
        for regime in ordered
    ]

    counts: dict[str, int] = {}
    for band in bands:
        counts[band["regime"]] = counts.get(band["regime"], 0) + 1
    dominant = max(counts, key=counts.get) if counts else None
    durations = [band["duration"] for band in bands if band["duration"]]
    bucket = meta.get("bucket_minutes")
    if bucket is None and durations and len(set(durations)) == 1:
        bucket = durations[0]
    bucket = int(bucket) if bucket else None

    payload = {
        "bands": bands,
        "categories": categories,
        "stats": {
            "bands": len(bands),
            "counts": counts,
            "dominant": dominant,
            "bucket_minutes": bucket,
            "first": bands[0]["start"] if bands else None,
            "last": bands[-1]["end"] if bands else None,
        },
        "unit": "pts",
    }
    default_title = (
        f"{bucket}-minute OI/price regime timeline"
        if bucket
        else "OI/price regime timeline"
    )
    default_subtitle = (
        f"{bucket}-minute close-to-close price and OI · hover a band"
        if bucket
        else "close-to-close price and OI · hover a band"
    )
    return panel(
        "futures_regimes",
        payload,
        spec=spec,
        title=title or default_title,
        subtitle=subtitle or default_subtitle,
        legend=legend
        if legend is not None
        else [_point_legend(category["tone"], category["label"]) for category in categories],
        note=note
        or "Colour is the sign of Δprice and ΔOI: rise+OI up = long buildup, "
        "fall+OI up = short buildup, fall+OI down = long unwinding, rise+OI down = "
        "short covering. Minutes without a classification stay blank.",
        span=span,
        height=height,
    )


def futures_volume(
    data: Any,
    *,
    spec: InstrumentSpec,
    title: str = "Futures volume",
    subtitle: str | None = None,
    note: str | None = None,
    legend: Iterable[Any] | None = None,
    span: int = 1,
    height: int = 260,
) -> str:
    records, _ = _records(data, ("volume", "close", "oi"))
    pairs = _pairs(records, "volume")
    stats: dict[str, Any] = {
        "total": sum(value for _, value in pairs) if pairs else None,
        "bars": len(pairs),
        "nulls": len(records) - len(pairs),
        "mean": round(sum(value for _, value in pairs) / len(pairs), 1) if pairs else None,
        "peak": None,
        "peak_t": None,
    }
    if pairs:
        peak_t, peak = max(pairs, key=lambda pair: pair[1])
        stats.update({"peak": peak, "peak_t": peak_t})

    payload = {
        "t": [row["t"] for row in records],
        "volume": [row["volume"] for row in records],
        "close": [row["close"] for row in records],
        "oi": [row["oi"] for row in records],
        "stats": stats,
    }
    return panel(
        "futures_volume",
        payload,
        spec=spec,
        title=title,
        subtitle=subtitle or f"{spec.oi_unit} per bar · peak bar highlighted · {_session(spec)}",
        legend=legend
        if legend is not None
        else [
            _point_legend("amber", "Peak bar"),
            _point_legend("muted", "Other bars"),
        ],
        note=note
        or f"Volume in {spec.oi_unit}. Bars are drawn only where a volume print "
        "exists; missing bars are gaps, not zeros.",
        span=span,
        height=height,
    )

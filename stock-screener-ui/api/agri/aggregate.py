"""Pure aggregation for mandi prices. No I/O, no FastAPI, no wall-clock range.

Every price is ₹/quintal. Arrivals from ``Metric Tonnes`` are multiplied by 10
to quintals; the original unit is surfaced through :func:`collect_warnings`.
"""

from __future__ import annotations

import statistics
from datetime import date, datetime, timedelta
from itertools import chain
from typing import Any, Iterable, Mapping, Optional

import config
from common.numbers import optional_float

from . import canonical, registry

CHANGE_OFFSETS: tuple[int, ...] = (7, 30, 182)
# A nearest-date anchor may be a few days off (weekends/holidays), but crossing
# a collection gap would relabel a multi-month move as 1w/1m.
CHANGE_TOLERANCE_DAYS: dict[str, int] = {
    "chg_1w_pct": 3,
    "chg_1m_pct": 7,
    "chg_6m_pct": 14,
}
RANGE_DAYS: dict[str, Optional[int]] = {
    "1m": 30,
    "3m": 91,
    "6m": 182,
    "1y": 365,
    "max": None,
}
STALE_AFTER_DAYS: int = 7


def to_float(value: Any) -> Optional[float]:
    """Parse a price/count without letting NaN or inf poison an aggregate."""
    return optional_float(value)


def _round(value: Optional[float], digits: int = 2) -> Optional[float]:
    return round(value, digits) if value is not None else None


def parse_date(value: Any) -> Optional[str]:
    """Normalise a source date to ISO ``YYYY-MM-DD``; ``None`` if unparseable.

    The cache stores ISO dates, so parsing 20k+ rows with ``strptime`` was
    dominating the request (466k calls / ~6s for one 6-month query). Fast-path
    the two shapes that actually occur and keep ``strptime`` only as a fallback.
    """
    text = str(value or "").strip()
    if not text:
        return None
    head = text[:10]
    try:
        if len(head) == 10 and head[4] == "-" and head[7] == "-":
            return date.fromisoformat(head).isoformat()
        if len(head) == 10 and head[2] == "/" and head[5] == "/":
            return date(int(head[6:10]), int(head[3:5]), int(head[0:2])).isoformat()
        if len(head) == 10 and head[2] == "-" and head[5] == "-":
            return date(int(head[6:10]), int(head[3:5]), int(head[0:2])).isoformat()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(head, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _is_metric_tonnes(lowered: str) -> bool:
    return "metric ton" in lowered or "tonne" in lowered or lowered in {"mt", "m.t."}


def _is_quintal_unit(lowered: str) -> bool:
    return "quintal" in lowered or lowered in {"qtl", "q"}


def normalise_arrivals(quantity: Any, units: Any) -> tuple[Optional[float], str]:
    """Return ``(qtl, raw_unit)``; metric tonnes are ×10 into quintals."""
    amount = to_float(quantity)
    raw = str(units or "").strip()
    if amount is None:
        return None, raw
    lowered = raw.casefold()
    if _is_metric_tonnes(lowered):
        return amount * 10.0, raw
    if _is_quintal_unit(lowered):
        return amount, raw
    return amount, raw


def normalize_source_row(raw: dict[str, Any], *, source: str) -> Optional[dict[str, Any]]:
    """Map a CKAN CSV row or a data.gov.in record into the canonical DB shape."""
    day = parse_date(
        raw.get("date") or raw.get("arrival_date") or raw.get("Arrival_Date")
    )
    commodity = str(
        raw.get("commodity_name") or raw.get("commodity") or raw.get("Commodity") or ""
    ).strip()
    key = registry.commodity_key_for(commodity)
    if not day or not key:
        return None

    arrivals_qtl, arrival_units = normalise_arrivals(
        raw.get("arrival_quantity", raw.get("arrivals_qtl")),
        raw.get("arrival_units") or raw.get("Arrival_Units"),
    )
    return {
        "date": day,
        "state": str(raw.get("state_name") or raw.get("state") or raw.get("State") or "").strip(),
        "district": str(raw.get("district_name") or raw.get("district") or raw.get("District") or "").strip(),
        "market": str(raw.get("market_center_name") or raw.get("market") or raw.get("Market") or "").strip(),
        "commodity": commodity,
        "commodity_key": key,
        "variety": str(raw.get("variety") or raw.get("Variety") or "").strip(),
        "grade": str(raw.get("grade") or raw.get("Grade") or "").strip(),
        "min_price": to_float(raw.get("min_price", raw.get("Min_Price"))),
        "max_price": to_float(raw.get("max_price", raw.get("Max_Price"))),
        "modal_price": to_float(raw.get("modal_price", raw.get("Modal_Price"))),
        "arrivals_qtl": arrivals_qtl,
        "price_unit": str(raw.get("price_unit") or raw.get("Unit") or "Rs./Quintal").strip(),
        "source": source,
        "arrival_units": arrival_units,
    }


def _quantile(values: list[float], q: float) -> float:
    """Linear-interpolated quantile (small, dependency-free, deterministic)."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = (len(ordered) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    frac = pos - lo
    return ordered[lo] + (ordered[hi] - ordered[lo]) * frac


def aggregate_daily(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """One point per date: modal median, robust min/max, arrivals sum, market count.

    The source has occasional impossible prints (an onion max of ₹13,50,000/qtl
    on one day), which would flatten a real chart to a single 1,000,000 axis
    tick. Min/max are therefore the 2nd/98th percentiles across markets; a
    one-market day still returns that market's exact range.
    """
    by_date: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        raw_day = row.get("date")
        day = raw_day if isinstance(raw_day, str) and len(raw_day) == 10 and raw_day[4] == "-" else parse_date(raw_day)
        if day:
            by_date.setdefault(day, []).append(row)

    out: list[dict[str, Any]] = []
    for day in sorted(by_date):
        modals: list[float] = []
        mins: list[float] = []
        maxs: list[float] = []
        arrivals: list[float] = []
        markets: set[str] = set()
        # One pass per date instead of five (prices, bounds, arrivals, markets).
        for row in by_date[day]:
            value = to_float(row.get("modal_price"))
            if value is not None:
                modals.append(value)
            value = to_float(row.get("min_price"))
            if value is not None:
                mins.append(value)
            value = to_float(row.get("max_price"))
            if value is not None:
                maxs.append(value)
            value = to_float(row.get("arrivals_qtl"))
            if value is not None:
                arrivals.append(value)
            market = row.get("market")
            if market:
                markets.add(str(market))
        # Small samples are exact; only a real cross-market day gets clipped.
        # min/max_price are nullable, so a day can carry modals but no bounds.
        low = (_quantile(mins, 0.02) if len(mins) >= 5 else min(mins)) if mins else None
        high = (_quantile(maxs, 0.98) if len(maxs) >= 5 else max(maxs)) if maxs else None
        out.append({
            "date": day,
            "modal": _round(statistics.median(modals)) if modals else None,
            "min": _round(low) if mins else None,
            "max": _round(high) if maxs else None,
            "arrivals_qtl": _round(sum(arrivals)) if arrivals else None,
            "market_count": len(markets),
        })
    return out


def pct_change(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    if current is None or previous in (None, 0):
        return None
    return _round((current - previous) / previous * 100.0)


def _nearest_at_or_before(daily: list[dict[str, Any]], target: str) -> Optional[dict[str, Any]]:
    for point in reversed(daily):
        if point["date"] <= target:
            return point
    return None


def _shift(day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def changes_from_daily(
    daily: list[dict[str, Any]],
    as_of: str,
    offsets: tuple[int, ...] = CHANGE_OFFSETS,
) -> dict[str, Optional[float]]:
    """1w/1m/6m changes using the nearest available date <= each target.

    ``daily`` is the date-ascending output of :func:`aggregate_daily`. The
    targets decrease with the offset, so one backwards pointer finds every
    anchor instead of rescanning the whole series for each offset.
    """
    out: dict[str, Optional[float]] = {"chg_1w_pct": None, "chg_1m_pct": None, "chg_6m_pct": None}
    if not daily:
        return out
    idx = len(daily) - 1
    while idx >= 0 and daily[idx]["date"] > as_of:
        idx -= 1
    current = daily[idx] if idx >= 0 else None
    if not current or current.get("modal") is None:
        return out
    for days, field in sorted(zip(offsets, ("chg_1w_pct", "chg_1m_pct", "chg_6m_pct"))):
        target = _shift(as_of, -days)
        while idx >= 0 and daily[idx]["date"] > target:
            idx -= 1
        ref = daily[idx] if idx >= 0 else None
        if ref is None:
            continue
        ref_day = parse_date(ref.get("date"))
        if ref_day is None:
            continue
        tolerance = CHANGE_TOLERANCE_DAYS.get(field, 0)
        if abs((date.fromisoformat(ref_day) - date.fromisoformat(target)).days) > tolerance:
            continue
        out[field] = pct_change(current["modal"], ref.get("modal"))
    return out


def range_cutoff(as_of: str, range_name: str, from_date: Optional[str] = None) -> Optional[str]:
    """Lower bound of a range, anchored to ``as_of`` (never to today)."""
    if from_date:
        return from_date
    days = RANGE_DAYS.get(range_name)
    return _shift(as_of, -days) if days is not None else None


def filter_by_range(
    daily: list[dict[str, Any]],
    as_of: str,
    range_name: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[dict[str, Any]]:
    cutoff = range_cutoff(as_of, range_name, from_date)
    upper = to_date or as_of
    return [p for p in daily if (cutoff is None or p["date"] >= cutoff) and p["date"] <= upper]


def latest_snapshot(
    latest_rows: Iterable[dict[str, Any]],
    history_rows: Iterable[dict[str, Any]] = (),
    *,
    as_of: Optional[str] = None,
    keys: Optional[Iterable[str]] = None,
    as_of_by_key: Optional[Mapping[str, str]] = None,
) -> list[dict[str, Any]]:
    """Latest date row for every tracked commodity, with 1w/1m/6m changes.

    ``latest_rows`` only needs the most recent date per commodity;
    ``history_rows`` supplies the earlier anchor dates used for changes.
    ``as_of_by_key`` keeps a stale key on its own anchor instead of moving it
    to another commodity's newest date. Rows are bucketed once: a separate
    scan per key cost ~1M dict lookups per request on the real cache.
    """
    selected_keys = list(keys) if keys is not None else list(registry.valid_keys())
    wanted = set(selected_keys)
    by_key: dict[str, list[dict[str, Any]]] = {}
    for row in chain(latest_rows, history_rows):
        key = row.get("commodity_key")
        if key in wanted:
            by_key.setdefault(key, []).append(row)
    overrides = as_of_by_key or {}
    out: list[dict[str, Any]] = []

    for key in selected_keys:
        item = registry.commodity(key)
        daily = aggregate_daily(by_key.get(key, ()))
        if not daily:
            out.append({
                "key": key,
                "label": item.label if item else key,
                "group": item.group if item else "",
                "date": None, "modal": None, "min": None, "max": None,
                "markets": 0, "chg_1w_pct": None, "chg_1m_pct": None, "chg_6m_pct": None,
            })
            continue
        point = daily[-1]
        anchor = overrides.get(key) or as_of or point["date"]
        changes = changes_from_daily(daily, anchor)
        out.append({
            "key": key,
            "label": item.label if item else key,
            "group": item.group if item else "",
            "date": point["date"],
            "modal": point["modal"],
            "min": point["min"],
            "max": point["max"],
            "markets": point["market_count"],
            **changes,
        })
    return out


def selected_quotes(rows: Iterable[dict[str, Any]], *, limit: Optional[int] = None) -> list[dict[str, Any]]:
    """Latest-date rows, one per mandi/variety/grade."""
    data = [r for r in rows if r.get("date")]
    if not data:
        return []
    latest = max(str(r["date"]) for r in data)
    by_mandi: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for row in data:
        if str(row["date"]) != latest:
            continue
        ident = (
            str(row.get("state") or ""), str(row.get("district") or ""),
            str(row.get("market") or ""), str(row.get("variety") or ""),
            str(row.get("grade") or ""),
        )
        by_mandi.setdefault(ident, row)
    out = [{
        "date": latest,
        "state": ident[0], "district": ident[1], "market": ident[2],
        "variety": ident[3], "grade": ident[4],
        "min": to_float(row.get("min_price")),
        "max": to_float(row.get("max_price")),
        "modal": to_float(row.get("modal_price")),
        "arrivals_qtl": to_float(row.get("arrivals_qtl")),
    } for ident, row in sorted(by_mandi.items())]
    return out[:limit] if limit is not None else out


def kpis_for(
    daily: list[dict[str, Any]],
    as_of: str,
    key: Optional[str],
) -> dict[str, Any]:
    msp = registry.msp_for(key) if key else None
    point = _nearest_at_or_before(daily, as_of)
    modal = point.get("modal") if point else None
    distance = pct_change(modal, msp) if msp is not None else None
    return {
        "modal": modal,
        "min": point.get("min") if point else None,
        "max": point.get("max") if point else None,
        "unit": registry.PRICE_UNIT,
        "chg_1w_pct": None,
        "chg_1m_pct": None,
        "chg_6m_pct": None,
        "market_count": point.get("market_count", 0) if point else 0,
        "arrivals_qtl": point.get("arrivals_qtl") if point else None,
        "arrivals_unit": registry.ARRIVALS_UNIT,
        "msp": msp,
        "distance_to_msp_pct": distance,
        **(changes_from_daily(daily, as_of) if point else {}),
    }


def comparison_series(
    rows_by_key: dict[str, Iterable[dict[str, Any]]],
    as_of: str,
    range_name: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    *,
    as_of_by_key: Optional[Mapping[str, str]] = None,
) -> list[dict[str, Any]]:
    """One series per key, windowed on ``as_of`` unless a per-key anchor is given.

    ``as_of_by_key`` lets callers with per-key freshness pass each anchor; keys
    absent from it fall back to ``as_of``. Without it, a stale key's rows are
    filtered against a newer anchor and its series silently disappears.
    """
    out: list[dict[str, Any]] = []
    overrides = as_of_by_key or {}
    for key, rows in rows_by_key.items():
        key_as_of = overrides.get(key, as_of)
        daily = filter_by_range(aggregate_daily(rows), key_as_of, range_name, from_date, to_date)
        out.append({
            "key": key,
            "label": registry.label_for(key),
            "points": [{"date": p["date"], "modal": p["modal"]} for p in daily],
        })
    return out


def freshness_days(as_of: Optional[str], *, today: Optional[date] = None) -> Optional[int]:
    if not as_of:
        return None
    try:
        day = date.fromisoformat(as_of)
    except ValueError:
        return None
    current = today or datetime.now(config.IST).date()
    return (current - day).days


def collect_warnings(
    rows: Iterable[dict[str, Any]],
    as_of: Optional[str],
    *,
    selected_key: Optional[str] = None,
    today: Optional[date] = None,
) -> list[str]:
    data = list(rows)
    warnings: list[str] = []
    if not data:
        warnings.append("no rows matched the current filters")
    freshness = freshness_days(as_of, today=today)
    if freshness is not None and freshness > STALE_AFTER_DAYS:
        warnings.append(f"data is {freshness} days old (as_of {as_of}); prices may be stale")

    # One pass collects every signal; the four separate comprehensions below
    # used to scan a 40k-row selection four times.
    dated: set[str] = set()
    missing_arrivals = 0
    seen_price_units: set[str] = set()
    arrival_units: set[str] = set()
    for row in data:
        day = parse_date(row.get("date"))
        if day:
            dated.add(day)
        if to_float(row.get("arrivals_qtl")) is None:
            missing_arrivals += 1
        price_unit = str(row.get("price_unit") or "").strip()
        if price_unit:
            seen_price_units.add(price_unit)
        arrival_unit = str(row.get("arrival_units") or "").strip()
        if arrival_unit:
            arrival_units.add(arrival_unit)

    ordered_dates = sorted(dated)
    largest_gap = (0, "", "")
    for earlier, later in zip(ordered_dates, ordered_dates[1:]):
        gap = (date.fromisoformat(later) - date.fromisoformat(earlier)).days
        if gap > largest_gap[0]:
            largest_gap = (gap, earlier, later)
    if largest_gap[0] > 7:
        gap, earlier, later = largest_gap
        warnings.append(
            f"data has a {gap}-day gap ({earlier} → {later}); short-window changes and rolling metrics skip it"
        )

    if missing_arrivals:
        warnings.append(f"arrivals are missing for {missing_arrivals} rows")

    price_units = sorted(seen_price_units)
    non_quintal = [u for u in price_units if not canonical.is_quintal_unit(u)]
    if non_quintal:
        warnings.append(f"non-quintal price units left as published: {', '.join(non_quintal)}")
    # Use the same predicates as normalise_arrivals: a unit that was multiplied
    # by 10 must not also be reported as unrecognised, and vice versa.
    if any(_is_metric_tonnes(u.casefold()) for u in arrival_units):
        warnings.append("arrivals from Metric Tonnes were multiplied by 10 to INR/quintal equivalent (qtl)")
    unknown = sorted(
        u for u in arrival_units
        if u and not _is_metric_tonnes(u.casefold()) and not _is_quintal_unit(u.casefold())
    )
    if unknown:
        warnings.append(f"unrecognised arrival units left as published: {', '.join(unknown)}")

    if selected_key and registry.msp_for(selected_key) is None:
        warnings.append(f"MSP not verified for {registry.label_for(selected_key)}; distance_to_msp_pct is null")
    return warnings


__all__ = [
    "CHANGE_OFFSETS",
    "CHANGE_TOLERANCE_DAYS",
    "RANGE_DAYS",
    "STALE_AFTER_DAYS",
    "aggregate_daily",
    "changes_from_daily",
    "collect_warnings",
    "comparison_series",
    "filter_by_range",
    "freshness_days",
    "kpis_for",
    "latest_snapshot",
    "normalise_arrivals",
    "normalize_source_row",
    "parse_date",
    "pct_change",
    "range_cutoff",
    "selected_quotes",
    "to_float",
]

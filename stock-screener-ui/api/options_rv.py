"""Realized-volatility cone and IV-vs-RV reads for the options dashboard.

Two entry points, deliberately split by where data comes from:

* :func:`rv_cone_from_closes` is pure — a daily close series in, a cone out.
* :func:`realized_vol_cone` adds the one provider fetch (cached, overridable in
  tests) and never raises: a missing/short series produces ``warnings`` and
  ``None`` fields, never an exception or a NaN.
* :func:`iv_vs_rv` is a pure read of an expiry ladder against a built cone.

Conventions (kept here, not restated in callers):

* RV is annualized ``std(log returns) * sqrt(252)`` with sample std (``ddof=1``),
  expressed in **vol points** (x100) to match the IV convention — a 25% vol is
  ``25.0`` here, as it is in :mod:`api.options_iv`. Without the x100 the cone
  and ATM IV would be on different scales and ``iv_minus_rv`` would be noise.
  Sample std is the vol convention; it is undefined for a one-return window.
* A tenor is a count of *trading sessions*, so a 30-day tenor is a 30-return
  rolling window. Percentiles come from that rolling distribution; ``current``
  is its last value and ``rank_pct`` is where that last value sits in it.
* Insufficient history for a tenor yields ``None`` fields plus a warning — no
  zero-fill and no "partial window" estimate, which would bend the cone.
* IV and RV are both in vol points (percent); the comparisons do no further
  rescaling of their own.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Callable, Mapping, Optional, Sequence

import numpy as np
import pandas as pd

from api._bounded_cache import BoundedTTLCache, TrackedLock, prune_locks
from api.options_conventions import DTE_FLOOR_DAYS

__all__ = [
    "DEFAULT_TENORS",
    "DEFAULT_LOOKBACK_DAYS",
    "TRADING_DAYS_PER_YEAR",
    "clear_rv_cache",
    "rv_cone_from_closes",
    "realized_vol_cone",
    "iv_vs_rv",
]

#: Tenor grid of a default cone, in trading sessions.
DEFAULT_TENORS: tuple[int, ...] = (7, 30, 60, 90, 180, 365)
#: Calendar-day history window for the daily-close fetch. ~750 calendar days
#: is ~535 sessions — enough returns for a 365-session rolling window plus a
#: percentile distribution.
DEFAULT_LOOKBACK_DAYS = 750
#: Annualization factor for daily log returns.
TRADING_DAYS_PER_YEAR = 252

#: Percentile levels carried per tenor (wire keys ``p10``..``p90``).
_PERCENTILES: tuple[int, ...] = (10, 25, 50, 75, 90)

#: Daily closes are stable intraday; a short TTL keeps repeated dashboard
#: polls off the provider without freezing the current session's close.
_RV_CACHE_TTL_SEC = 900.0
#: Keyed by caller-supplied symbol, so bound the entry count and sweep expired
#: series. Values stay the ``{"ts", "closes", "as_of"}`` dicts already used here.
_RV_CACHE_MAX = 512
_rv_cache = BoundedTTLCache(_RV_CACHE_MAX, ttl_getter=_RV_CACHE_TTL_SEC)
#: One single-flight guard per cache key. ``TrackedLock`` exposes ``locked()``
#: so pruning spares a guard a worker thread is still holding.
_rv_locks: dict[tuple[str, int], TrackedLock] = {}
_rv_locks_guard = threading.Lock()


def _rv_lock_for(key: tuple[str, int]) -> TrackedLock:
    """Return the key's guard; creation and pruning are one atomic step."""
    with _rv_locks_guard:
        lock = _rv_locks.setdefault(key, TrackedLock())
        prune_locks(_rv_locks, _RV_CACHE_MAX, keep=(key,))
        return lock


def clear_rv_cache() -> None:
    """Drop cached daily-close series (tests / after a broker reconnect)."""
    _rv_cache.clear()
    with _rv_locks_guard:
        _rv_locks.clear()


def _finite(value: Any) -> Optional[float]:
    """Finite float or ``None``. NaN/inf and unparseable values are not data."""
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Read a key from a mapping or an object attribute, never raising."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _first(obj: Any, keys: Sequence[str]) -> Any:
    for key in keys:
        value = _get(obj, key)
        if value is not None:
            return value
    return None


def _as_of_from_index(index: Any) -> Optional[str]:
    """IST session date of the last close from a datetime-like index, else ``None``.

    A plain list/RangeIndex carries integer labels: ``pd.Timestamp(99)`` would
    silently become 1970-01-01. Require a genuinely datetime-like label first.
    """
    try:
        if index is None or len(index) == 0:
            return None
        from datetime import date as _date, datetime as _datetime

        last = index[-1]
        if not (
            isinstance(last, (pd.Timestamp, _datetime, _date, np.datetime64))
            or pd.api.types.is_datetime64_any_dtype(index)
        ):
            return None
        import config

        ts = pd.Timestamp(last)
        if pd.isna(ts):
            return None
        if ts.tz is None:
            ts = ts.tz_localize(config.IST)
        else:
            ts = ts.tz_convert(config.IST)
        return ts.date().isoformat()
    except Exception:
        return None


def _coerce_closes(closes: Any) -> pd.Series:
    """Clean a close input into a positive, finite, sorted float Series."""
    if isinstance(closes, pd.Series):
        series = closes.copy()
    else:
        series = pd.Series(list(closes or ()), dtype="float64")
    series = pd.to_numeric(series, errors="coerce")
    series = series.replace([np.inf, -np.inf], np.nan).dropna()
    series = series[series > 0.0]
    try:
        series = series.sort_index()
    except Exception:
        pass
    return series.astype(float)


def rv_cone_from_closes(
    closes: Any,
    tenors: Sequence[int] = DEFAULT_TENORS,
    *,
    symbol: str = "",
    as_of: Optional[str] = None,
    warnings: Optional[Sequence[str]] = None,
) -> dict:
    """Pure cone build from a daily close series (no I/O, no clock reads).

    ``closes`` may be a pandas Series (its index supplies ``as_of`` when the
    caller does not) or any sequence of daily closes. Every numeric field is a
    finite float or ``None``; the payload never carries NaN/inf.
    """
    out_warnings: list[str] = list(warnings or ())
    series = _coerce_closes(closes)
    if as_of is None:
        as_of = _as_of_from_index(series.index)

    bucket_list: list[dict] = []
    grid = [int(t) for t in (tenors or DEFAULT_TENORS) if _finite(t) and int(t) > 0]

    if series.empty:
        if "empty_series" not in out_warnings:
            out_warnings.append("empty_series")
        for days in grid:
            bucket_list.append(_empty_bucket(days))
        return {
            "symbol": str(symbol or "").strip().upper(),
            "as_of": as_of,
            "tenors": bucket_list,
            "warnings": out_warnings,
        }

    log_returns = np.log(series / series.shift(1))
    returns = log_returns.replace([np.inf, -np.inf], np.nan).dropna()
    n = len(returns)
    if n < 2:
        out_warnings.append("no_returns" if n == 0 else "insufficient_history")
    if n == 0:
        for days in grid:
            bucket_list.append(_empty_bucket(days))
        return {
            "symbol": str(symbol or "").strip().upper(),
            "as_of": as_of,
            "tenors": bucket_list,
            "warnings": out_warnings,
        }

    # sqrt(252) annualizes daily log returns; x100 converts the decimal vol to
    # vol points so the cone shares the IV module's unit (25% -> 25.0).
    scale = math.sqrt(TRADING_DAYS_PER_YEAR) * 100.0
    for days in grid:
        if n < days:
            out_warnings.append(f"short_history_for_tenor_{days}")
            bucket_list.append(_empty_bucket(days))
            continue
        rolling = (returns.rolling(days).std(ddof=1) * scale).dropna()
        if rolling.empty:
            out_warnings.append(f"short_history_for_tenor_{days}")
            bucket_list.append(_empty_bucket(days))
            continue
        values = rolling.to_numpy(dtype=float)
        current = _finite(values[-1])
        bucket: dict[str, Any] = {"days": days, "current": current}
        for pct in _PERCENTILES:
            bucket[f"p{pct}"] = _finite(np.percentile(values, pct))
        bucket["rank_pct"] = (
            _finite(float((values <= values[-1]).mean() * 100.0))
            if current is not None
            else None
        )
        bucket_list.append(bucket)

    return {
        "symbol": str(symbol or "").strip().upper(),
        "as_of": as_of,
        "tenors": bucket_list,
        "warnings": out_warnings,
    }


def _empty_bucket(days: int) -> dict:
    bucket: dict[str, Any] = {"days": int(days), "current": None}
    for pct in _PERCENTILES:
        bucket[f"p{pct}"] = None
    bucket["rank_pct"] = None
    return bucket


def _fetch_daily_closes(symbol: str, lookback_days: int) -> tuple[pd.Series, Optional[str]]:
    """One provider call for daily closes: ``(series, as_of)``.

    Uses the historical daily endpoint directly (``days/1``) so the request is
    exactly one call — the general 1D candle path can also fetch a backfill tape
    on its live edge. Never called by tests (they inject ``closes``/``fetcher``).
    """
    from datetime import datetime, timedelta

    import config
    from market_data.market_data import get_api_client

    api = get_api_client()
    if api is None:
        return pd.Series(dtype=float), None
    today = datetime.now(config.IST).date()
    start = today - timedelta(days=int(lookback_days))
    df = api.fetch_historical_data_v3(
        symbol=str(symbol or "").strip().upper(),
        unit="days",
        interval=1,
        from_date=start.isoformat(),
        to_date=today.isoformat(),
    )
    if df is None or getattr(df, "empty", True) or "close" not in df.columns:
        return pd.Series(dtype=float), None
    closes = _coerce_closes(df["close"])
    return closes, _as_of_from_index(closes.index)


def realized_vol_cone(
    symbol: str,
    tenors: Sequence[int] = DEFAULT_TENORS,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    *,
    closes: Any = None,
    fetcher: Optional[Callable[[str, int], tuple[Any, Optional[str]]]] = None,
    use_cache: bool = True,
) -> dict:
    """Build a realized-vol cone for ``symbol``.

    ``closes`` (a prepared series) or ``fetcher(symbol, lookback_days)`` can be
    injected to keep this function off the network — tests use one of the two.
    Otherwise daily closes come from :func:`_fetch_daily_closes`, cached per
    ``(symbol, lookback_days)`` for ``_RV_CACHE_TTL_SEC``. Provider failures
    degrade to a warning, never a 500.
    """
    sym = str(symbol or "").strip().upper()
    warnings: list[str] = []
    as_of: Optional[str] = None

    if closes is not None:
        source_closes, as_of = closes, None
    else:
        key = (sym, int(lookback_days))
        source_closes, as_of = _cached_closes(key, use_cache, fetcher, warnings)

    return rv_cone_from_closes(
        source_closes, tenors, symbol=sym, as_of=as_of, warnings=warnings
    )


def _cached_closes(
    key: tuple[str, int],
    use_cache: bool,
    fetcher: Optional[Callable[[str, int], tuple[Any, Optional[str]]]],
    warnings: list[str],
) -> tuple[Any, Optional[str]]:
    """Read a cached daily-close series, fetching once per key on a cold miss."""
    hit = _rv_cache.get(key) if use_cache else None
    if hit and time.monotonic() - hit["ts"] < _RV_CACHE_TTL_SEC:
        return hit["closes"], hit["as_of"]

    with _rv_lock_for(key):
        hit = _rv_cache.get(key) if use_cache else None
        if hit and time.monotonic() - hit["ts"] < _RV_CACHE_TTL_SEC:
            return hit["closes"], hit["as_of"]
        try:
            if fetcher is not None:
                source_closes, as_of = fetcher(key[0], key[1])
            else:
                source_closes, as_of = _fetch_daily_closes(key[0], key[1])
        except Exception as exc:  # provider/auth/network — never a 500
            source_closes, as_of = (), None
            warnings.append(f"provider_unavailable: {type(exc).__name__}")
        if use_cache and not warnings:
            _rv_cache[key] = {
                "ts": time.monotonic(),
                "closes": source_closes,
                "as_of": as_of,
            }
        return source_closes, as_of


_DTE_KEYS = ("dte_days", "dteDays", "dte", "tenor_days", "tenorDays",
             "days_to_expiry", "tenor", "days")
_IV_KEYS = ("atmIv", "atm_iv", "atmIV", "atm_iv_pct", "iv")
_DATE_KEYS = ("date", "expiry", "expiry_date")


def _expiry_dte(expiry: Any, as_of: Optional[str]) -> Optional[int]:
    raw = _first(expiry, _DTE_KEYS)
    dte = _finite(raw)
    if dte is None:
        raw_date = _first(expiry, _DATE_KEYS)
        if raw_date is not None and as_of:
            try:
                from datetime import date, datetime

                if isinstance(raw_date, datetime):
                    exp_date = raw_date.date()
                elif isinstance(raw_date, date):
                    exp_date = raw_date
                else:
                    exp_date = date.fromisoformat(str(raw_date)[:10])
                ref = date.fromisoformat(str(as_of)[:10])
                dte = float((exp_date - ref).days)
            except (ValueError, TypeError):
                dte = None
    return int(round(dte)) if dte is not None else None


def _cone_buckets(cone: Any) -> list[dict]:
    if not isinstance(cone, Mapping):
        return []
    return [b for b in (cone.get("tenors") or []) if isinstance(b, Mapping)]


def _rank_in_cone(iv: float, bucket: Mapping) -> Optional[float]:
    """Piecewise-linear CDF read over the cone's p10..p90 grid (clamped 10..90).

    IV rank here means "where does IV sit in this tenor's RV distribution",
    interpolated between the five stored percentile anchors. It is a read of
    the cone summary, not a recomputation over the raw return series.
    """
    anchors = [
        (_finite(bucket.get(f"p{pct}")), float(pct)) for pct in _PERCENTILES
    ]
    points = [(value, rank) for value, rank in anchors if value is not None]
    if not points:
        return None
    points.sort()
    if len(points) == 1:
        return points[0][1]
    if all(abs(value - points[0][0]) < 1e-12 for value, _ in points):
        return 50.0  # degenerate (zero-vol) cone — no ordering to rank against
    if iv <= points[0][0]:
        return points[0][1]
    if iv >= points[-1][0]:
        return points[-1][1]
    for (v0, r0), (v1, r1) in zip(points, points[1:]):
        if v0 <= iv <= v1:
            if v1 == v0:
                return r0
            return float(r0 + (iv - v0) / (v1 - v0) * (r1 - r0))
    return None


def iv_vs_rv(expiries: Any, cone: Any) -> dict:
    """Read each expiry's ATM IV against the nearest RV cone tenor.

    ``expiries`` is the analytics ladder (dicts or models carrying ``dteDays``
    / ``dte_days`` and ``atmIv`` / ``atm_iv``; a ``date`` is used when no DTE is
    present, measured from the cone's ``as_of``). Pure: no I/O and no clock
    read. Returns ``{"rows": [...], "warnings": [...]}`` with one row per input
    expiry, in input order; comparison fields are ``None`` when unreadable.
    """
    warnings: list[str] = []
    buckets = _cone_buckets(cone)
    if not buckets:
        warnings.append("cone_unavailable")

    as_of = cone.get("as_of") if isinstance(cone, Mapping) else None
    # Prefer buckets that actually carry an RV median when choosing a tenor;
    # a short-history bucket exists in the cone but has nothing to compare to.
    ranked = [b for b in buckets if _finite(b.get("p50")) is not None]
    candidates = ranked or buckets
    if buckets and not ranked:
        warnings.append("cone_no_rv")

    rows: list[dict] = []
    inputs = list(expiries or ())
    if not inputs:
        warnings.append("no_expiries")

    for expiry in inputs:
        date = _first(expiry, _DATE_KEYS)
        dte = _expiry_dte(expiry, as_of)
        iv = _finite(_first(expiry, _IV_KEYS))
        row: dict[str, Any] = {
            "date": str(date) if date is not None else None,
            "dte": dte,
            "atm_iv": iv,
            "tenor_days": None,
            "rv_p50": None,
            "iv_minus_rv": None,
            "iv_rank_in_cone": None,
        }

        if iv is None:
            warnings.append("missing_atm_iv")
        if dte is not None and 0 <= dte < DTE_FLOOR_DAYS:
            warnings.append("dte_below_floor")
        if dte is None:
            warnings.append("missing_dte")

        if iv is not None and dte is not None and candidates:
            days_list = [
                _finite(b.get("days")) for b in candidates
            ]
            days_list = [int(d) for d in days_list if d is not None]
            if days_list:
                nearest = min(days_list, key=lambda d: (abs(d - dte), d))
                bucket = next(
                    b for b in candidates if _finite(b.get("days")) == nearest
                )
                rv = _finite(bucket.get("p50"))
                row["tenor_days"] = nearest
                row["rv_p50"] = rv
                if rv is not None:
                    row["iv_minus_rv"] = float(iv - rv)
                    row["iv_rank_in_cone"] = _rank_in_cone(iv, bucket)

        rows.append(row)

    return {"rows": rows, "warnings": warnings}

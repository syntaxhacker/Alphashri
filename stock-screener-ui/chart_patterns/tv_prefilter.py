"""TradingView volume / relative-volume pre-filter for chart-pattern scans.

Upstox has no relative-volume field; TradingView does (``relative_volume_10d_calc``).
This module bulk-fetches ``volume`` + ``relative_volume_10d_calc`` for a symbol
list with ``Query().set_tickers("NSE:SYMBOL", ...)`` (batched) — the only
reliable way to resolve specific NSE names — and filters the universe *before*
any candle fetch, so low-energy symbols never cost an Upstox call.

Fail-open: when TradingView is unreachable (or returns nothing) the full symbol
list passes through unchanged with a ``{"fail_open": True}`` marker.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

TV_COLUMNS = (
    "name",
    "volume",
    "relative_volume_10d_calc",
    "average_volume_10d_calc",
    "close",
    "change",
    "market_cap_basic",
)

#: ``set_tickers`` batch size (matches api/screener_api/screener_52w.py).
_TV_BATCH_SIZE = 80


def _to_float(value) -> float | None:
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    if number in (float("inf"), float("-inf")):
        return None
    return number


def fetch_tv_volume_metrics(symbols: list[str], *, limit: int | None = None) -> dict[str, dict]:
    """Bulk-fetch volume metrics keyed by upper-cased symbol.

    One ``Query().select(...).where(Column('name').isin(symbols)).limit(...)``
    call. Symbols missing from the TV response are absent from the result.
    Never raises — returns ``{}`` on any error (caller fails open).
    """
    try:
        from tradingview_screener import Query
        from api.symbols import normalize_tv_symbol, to_tv_ticker
    except Exception as exc:
        log.warning("TV prefilter: tradingview_screener unavailable (%s)", exc)
        return {}
    syms: list[str] = []
    seen: set[str] = set()
    for raw in symbols or []:
        sym = str(raw or "").strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            syms.append(sym)
    if not syms:
        return {}
    out: dict[str, dict] = {}
    for start in range(0, len(syms), _TV_BATCH_SIZE):
        batch = syms[start : start + _TV_BATCH_SIZE]
        tickers = [t for t in (to_tv_ticker(s) for s in batch) if t]
        if not tickers:
            continue
        # ``set_tickers`` (exchange-qualified, e.g. "NSE:RELIANCE") is the only
        # reliable way to resolve specific NSE names — a ``name isin`` query
        # mixes in other markets' tickers and drops valid symbols.
        try:
            query = Query().set_tickers(*tickers).select(*TV_COLUMNS)
            _, df = query.get_scanner_data()
        except Exception as exc:
            log.warning("TV prefilter: scanner batch failed (%s)", exc)
            continue
        if df is None or getattr(df, "empty", True):
            continue
        for _, row in df.iterrows():
            # ``set_tickers`` frames lead with ticker/name (iloc[0]/iloc[1]).
            try:
                ticker = str(row.iloc[0]).strip() if len(row) > 0 else ""
                name = str(row.iloc[1]).strip() if len(row) > 1 else ""
            except Exception:
                ticker = str(row.get("ticker", "") or "")
                name = str(row.get("name", "") or "")
            bare = normalize_tv_symbol(ticker or name)
            if not bare:
                continue
            out[bare] = {
                "volume": _to_float(row.get("volume")),
                "rel_volume": _to_float(row.get("relative_volume_10d_calc")),
                "avg_volume_10d": _to_float(row.get("average_volume_10d_calc")),
                "close": _to_float(row.get("close")),
                "change": _to_float(row.get("change")),
                "market_cap": _to_float(row.get("market_cap_basic")),
            }
    return out


def prefilter_by_volume(
    symbols: list[str],
    *,
    min_rel_volume: float | None = None,
    min_volume_m: float | None = None,
) -> tuple[list[str], dict]:
    """Keep symbols passing the volume gates. Fail-open when TV is unavailable.

    - ``min_rel_volume``: keep ``rel_volume >= min_rel_volume`` (when set).
    - ``min_volume_m``: keep ``volume >= min_volume_m * 1e6`` (when set).
    - Symbols absent from the TV response are excluded (no data ≠ liquid).
    - When the TV fetch returns ``{}``, all symbols pass with
      ``{"fail_open": True}``.
    """
    ordered: list[str] = []
    seen: set[str] = set()
    for raw in symbols or []:
        sym = str(raw or "").strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            ordered.append(sym)
    if min_rel_volume is None and min_volume_m is None:
        return ordered, {}
    try:
        metrics = fetch_tv_volume_metrics(ordered)
    except Exception as exc:  # pragma: no cover - fetch_tv_volume_metrics never raises
        log.warning("TV prefilter: fetch raised, failing open (%s)", exc)
        return ordered, {"fail_open": True}
    if not metrics:
        log.warning("TV prefilter: no metrics, failing open for %d symbols", len(ordered))
        return ordered, {"fail_open": True}
    volume_floor = float(min_volume_m) * 1e6 if min_volume_m is not None else None
    kept: list[str] = []
    dropped: list[str] = []
    for sym in ordered:
        metric = metrics.get(sym)
        if metric is None:
            dropped.append(sym)
            continue
        rel = metric.get("rel_volume")
        if min_rel_volume is not None and (rel is None or rel < float(min_rel_volume)):
            dropped.append(sym)
            continue
        vol = metric.get("volume")
        if volume_floor is not None and (vol is None or vol < volume_floor):
            dropped.append(sym)
            continue
        kept.append(sym)
    info = {
        "before": len(ordered),
        "after": len(kept),
        "dropped": dropped,
        "message": f"TV prefilter: {len(ordered)} → {len(kept)}",
    }
    log.info("TV prefilter: %d → %d (min_rel_volume=%s min_volume_m=%s)",
             len(ordered), len(kept), min_rel_volume, min_volume_m)
    return kept, info

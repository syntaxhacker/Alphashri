"""Deep Value scan endpoint: GET /api/value/scan."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from ._numeric import num_or_none as _num
from .cache import get_scored_frame
from .tv_source import MARKET_CURRENCY, MARKETS, TvSourceError

logger = logging.getLogger("value_scan.router")

router = APIRouter(prefix="/api/value", tags=["value"])

ALLOWED_SORTS = ("score", "pe", "fcf_yield", "roe", "dist_52w")


def _root_name(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    text = str(raw)
    return text.split(":")[-1].strip().upper() or None


def _fcf_yield(row: dict[str, Any]) -> Optional[float]:
    fcf = _num(row.get("free_cash_flow_ttm"))
    mcap = _num(row.get("market_cap_basic"))
    if fcf is None or not mcap:
        return None
    return fcf / mcap * 100.0


def _vs_200dma(row: dict[str, Any]) -> Optional[float]:
    price = _num(row.get("close"))
    sma = _num(row.get("SMA200"))
    if price is None or not sma:
        return None
    return (price - sma) / sma * 100.0


def _off_52w_high(row: dict[str, Any]) -> Optional[float]:
    price = _num(row.get("close"))
    high = _num(row.get("price_52_week_high"))
    if price is None or not high:
        return None
    return (price - high) / high * 100.0


def _shape_row(row: dict[str, Any]) -> dict[str, Any]:
    """Project a scored frame row onto the public response shape."""
    mcap = _num(row.get("market_cap_basic"))
    rev = _num(row.get("total_revenue"))
    shaped: dict[str, Any] = {
        "symbol": _root_name(row.get("name")),
        "name": row.get("description"),
        "exchange": row.get("exchange"),
        "currency": row.get("currency"),
        "price": _num(row.get("close")),
        "change": _num(row.get("change")),
        "mcap_bn": (mcap / 1e9) if mcap is not None else None,
        "rev_bn": (rev / 1e9) if rev is not None else None,
        "pe": _num(row.get("price_earnings_ttm")),
        "ps": _num(row.get("price_sales_ratio")),
        "pb": _num(row.get("price_book_fq")),
        "fcf_yield": _fcf_yield(row),
        "div_yield": _num(row.get("dividends_yield_current")),
        "roe": _num(row.get("return_on_equity_fq")),
        "gross_margin": _num(row.get("gross_margin_ttm")),
        "op_margin": _num(row.get("operating_margin_ttm")),
        "rev_yoy": _num(row.get("total_revenue_yoy_growth_ttm")),
        "eps_yoy": _num(row.get("earnings_per_share_diluted_yoy_growth_ttm")),
        "debt_to_equity": _num(row.get("debt_to_equity_fq")),
        "current_ratio": _num(row.get("current_ratio")),
        "rsi": _num(row.get("RSI")),
        "vs_200dma": _vs_200dma(row),
        "off_52w_high": _off_52w_high(row),
        "score": _num(row.get("score")),
        "subscores": row.get("subscores"),
        "peer": row.get("peer"),
        "flags": row.get("flags"),
        "derived": row.get("derived"),
    }
    return shaped


def _load_filter_engine() -> tuple[Any, Any, dict[str, Any]]:
    """Import the peer filter engine, degrading gracefully.

    Returns (apply_filters, describe_filters, presets). Fallbacks keep
    the endpoint working when filters.py is missing or broken.
    """
    try:
        from .filters import PRESETS, apply_filters, describe_filters
        return apply_filters, describe_filters, dict(PRESETS)
    except Exception as exc:
        logger.warning("filter engine unavailable, using fallback: %s", exc)
        return _fallback_apply_filters, _fallback_describe_filters, {}


def _fallback_apply_filters(rows: list[dict[str, Any]],
                            spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Minimal in-memory filtering over raw TV fields."""
    out = []
    sectors = spec.get("sectors")
    sector_set = (
        {s.strip().lower() for s in str(sectors).split(",") if s.strip()}
        if sectors else None
    )
    try:
        from .scoring import sector_bucket as _bucket_fn
    except Exception:
        _bucket_fn = None  # type: ignore[assignment]
    for row in rows:
        if not _passes_fallback(row, spec, sector_set, _bucket_fn):
            continue
        out.append(row)
    return out


def _passes_fallback(row: dict[str, Any], spec: dict[str, Any],
                     sector_set: Optional[set[str]],
                     bucket_fn: Any = None) -> bool:
    get = _num
    checks = [
        (spec.get("max_pe"), lambda v: get(row.get("price_earnings_ttm")) is not None
         and get(row.get("price_earnings_ttm")) <= v),
        (spec.get("min_pe"), lambda v: get(row.get("price_earnings_ttm")) is not None
         and get(row.get("price_earnings_ttm")) >= v),
        (spec.get("max_ps"), lambda v: get(row.get("price_sales_ratio")) is not None
         and get(row.get("price_sales_ratio")) <= v),
        (spec.get("max_pb"), lambda v: get(row.get("price_book_fq")) is not None
         and get(row.get("price_book_fq")) <= v),
        (spec.get("min_roe"), lambda v: get(row.get("return_on_equity_fq")) is not None
         and get(row.get("return_on_equity_fq")) >= v),
        (spec.get("min_fcf_yield"), lambda v: _fcf_yield(row) is not None
         and _fcf_yield(row) >= v),
        (spec.get("min_rev_yoy"), lambda v: get(
            row.get("total_revenue_yoy_growth_ttm")) is not None
         and get(row.get("total_revenue_yoy_growth_ttm")) >= v),
        (spec.get("min_eps_yoy"), lambda v: get(
            row.get("earnings_per_share_diluted_yoy_growth_ttm")) is not None
         and get(row.get("earnings_per_share_diluted_yoy_growth_ttm")) >= v),
        (spec.get("min_div_yield"), lambda v: get(
            row.get("dividends_yield_current")) is not None
         and get(row.get("dividends_yield_current")) >= v),
        (spec.get("max_de"), lambda v: get(row.get("debt_to_equity_fq")) is not None
         and get(row.get("debt_to_equity_fq")) <= v),
        (spec.get("min_mcap_bn"), lambda v: get(row.get("market_cap_basic")) is not None
         and get(row.get("market_cap_basic")) / 1e9 >= v),
        (spec.get("max_mcap_bn"), lambda v: get(row.get("market_cap_basic")) is not None
         and get(row.get("market_cap_basic")) / 1e9 <= v),
        (spec.get("min_price"), lambda v: get(row.get("close")) is not None
         and get(row.get("close")) >= v),
        (spec.get("min_volume"), lambda v: get(row.get("volume")) is not None
         and get(row.get("volume")) >= v),
        (spec.get("max_rsi"), lambda v: get(row.get("RSI")) is not None
         and get(row.get("RSI")) <= v),
    ]
    for threshold, predicate in checks:
        if threshold is not None and not predicate(threshold):
            return False
    if spec.get("require_low_de"):
        de = get(row.get("debt_to_equity_fq"))
        if de is None or de >= 1.0:
            return False
    if spec.get("exclude_negative_fcf"):
        fcf = get(row.get("free_cash_flow_ttm"))
        if fcf is None or fcf < 0:
            return False
    if spec.get("exclude_negative_eps"):
        eps = get(row.get("earnings_per_share_diluted_ttm"))
        if eps is None or eps < 0:
            return False
    if spec.get("exclude_loss_making"):
        net = get(row.get("net_income"))
        if net is None or net <= 0:
            return False
    if spec.get("above_200dma"):
        vs = _vs_200dma(row)
        if vs is None or vs <= 0:
            return False
    if sector_set:
        if bucket_fn is not None:
            try:
                bucket = str(bucket_fn(row.get("sector")) or "").lower()
            except Exception:
                bucket = str(row.get("sector") or "").lower()
        else:
            bucket = str(row.get("sector") or "").lower()
        if bucket not in sector_set:
            return False
    return True


def _fallback_describe_filters(spec: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in spec.items() if v is not None}


def _sort_key(row: dict[str, Any], sort: str):
    """Sort key for one RAW row.

    The values are the same ones :func:`_shape_row` copies out, so the whole
    frame does not have to be shaped (25 field conversions per row, thousands
    of rows) just to be sorted.
    """
    if sort == "pe":
        v = _num(row.get("price_earnings_ttm"))
        return (v is None, v if v is not None else 0.0)
    if sort == "fcf_yield":
        v = _fcf_yield(row)
        return (v is None, -(v if v is not None else 0.0))
    if sort == "roe":
        v = _num(row.get("return_on_equity_fq"))
        return (v is None, -(v if v is not None else 0.0))
    if sort == "dist_52w":
        v = _off_52w_high(row)
        return (v is None, v if v is not None else 0.0)
    v = _num(row.get("score"))
    return (v is None, -(v if v is not None else 0.0))


def _apply_sort(rows: list[dict[str, Any]], sort: str) -> list[dict[str, Any]]:
    """Order raw rows by the response's sort key (stable, no shaping)."""
    return sorted(rows, key=lambda r: _sort_key(r, sort))


def _bucket_of(row: dict[str, Any]) -> str:
    """Peer bucket for sector counts; falls back to the raw TV sector."""
    peer = row.get("peer")
    if isinstance(peer, dict) and peer.get("bucket"):
        return str(peer["bucket"])
    return str(row.get("sector") or "Unknown")


def _sector_breakdown(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        bucket = _bucket_of(row)
        entry = buckets.setdefault(bucket, {"count": 0, "total": 0.0, "n": 0})
        entry["count"] += 1
        score = _num(row.get("score"))
        if score is not None:
            entry["total"] += score
            entry["n"] += 1
    result = [
        {"name": name,
         "count": entry["count"],
         "avg_score": round(entry["total"] / entry["n"], 2) if entry["n"] else 0.0}
        for name, entry in buckets.items()
    ]
    result.sort(key=lambda b: b["count"], reverse=True)
    return result


@router.get("/scan")
def scan(
    market: str = Query(default="india"),
    limit: int = Query(default=100),
    preset: Optional[str] = Query(default=None),
    max_pe: Optional[float] = Query(default=None),
    min_pe: Optional[float] = Query(default=None),
    max_ps: Optional[float] = Query(default=None),
    max_pb: Optional[float] = Query(default=None),
    min_roe: Optional[float] = Query(default=None),
    min_fcf_yield: Optional[float] = Query(default=None),
    min_rev_yoy: Optional[float] = Query(default=None),
    min_eps_yoy: Optional[float] = Query(default=None),
    min_div_yield: Optional[float] = Query(default=None),
    max_de: Optional[float] = Query(default=None),
    min_mcap_bn: Optional[float] = Query(default=None),
    max_mcap_bn: Optional[float] = Query(default=None),
    require_low_de: Optional[bool] = Query(default=None),
    exclude_negative_fcf: Optional[bool] = Query(default=None),
    exclude_negative_eps: Optional[bool] = Query(default=None),
    above_200dma: Optional[bool] = Query(default=None),
    sectors: Optional[str] = Query(default=None),
    min_price: Optional[float] = Query(default=None),
    min_volume: Optional[float] = Query(default=None),
    max_rsi: Optional[float] = Query(default=None),
    exclude_loss_making: Optional[bool] = Query(default=None),
    sort: str = Query(default="score"),
    include_flags: bool = Query(default=True),
) -> dict[str, Any]:
    """Return the ranked deep-value scan for ``market``."""
    if market not in MARKETS:
        raise HTTPException(status_code=400,
                            detail=f"unknown market '{market}'")
    if limit is None or not 1 <= limit <= 500:
        raise HTTPException(status_code=400,
                            detail="limit must be between 1 and 500")
    if sort not in ALLOWED_SORTS:
        raise HTTPException(status_code=400,
                            detail=f"unknown sort '{sort}'")

    apply_filters, describe_filters, presets = _load_filter_engine()
    warnings: list[str] = []
    if apply_filters is _fallback_apply_filters:
        warnings.append("scoring_engine_unavailable")

    effective: dict[str, Any] = {}
    if preset is not None:
        if preset not in presets:
            warnings.append(f"unknown_preset '{preset}' ignored")
        else:
            predefined = presets.get(preset) or {}
            if isinstance(predefined, dict):
                effective.update(predefined)
    explicit = {
        "max_pe": max_pe, "min_pe": min_pe, "max_ps": max_ps,
        "max_pb": max_pb, "min_roe": min_roe,
        "min_fcf_yield": min_fcf_yield, "min_rev_yoy": min_rev_yoy,
        "min_eps_yoy": min_eps_yoy, "min_div_yield": min_div_yield,
        "max_de": max_de, "min_mcap_bn": min_mcap_bn,
        "max_mcap_bn": max_mcap_bn, "require_low_de": require_low_de,
        "exclude_negative_fcf": exclude_negative_fcf,
        "exclude_negative_eps": exclude_negative_eps,
        "above_200dma": above_200dma, "sectors": sectors,
        "min_price": min_price, "min_volume": min_volume,
        "max_rsi": max_rsi, "exclude_loss_making": exclude_loss_making,
    }
    for key, value in explicit.items():
        if value is not None:
            effective[key] = value

    try:
        rows, meta = get_scored_frame(market)
    except TvSourceError as exc:
        raise HTTPException(status_code=502,
                            detail="value_source_unavailable") from exc
    except Exception as exc:
        logger.warning("value scan upstream failure: %s", exc)
        raise HTTPException(status_code=502,
                            detail="value_source_unavailable") from exc

    warnings.extend(meta.get("warnings") or [])

    try:
        try:
            filtered = apply_filters(rows, effective)
        except TypeError:
            filtered = apply_filters(rows, **effective)
    except Exception as exc:
        logger.warning("apply_filters failed, using fallback: %s", exc)
        filtered = _fallback_apply_filters(rows, effective)
        if "scoring_engine_unavailable" not in warnings:
            warnings.append("scoring_engine_unavailable")

    try:
        filters_applied = describe_filters(effective)
    except Exception:
        filters_applied = _fallback_describe_filters(effective)

    ordered = _apply_sort(list(filtered), sort)
    page = ordered[:limit]
    shaped_rows = [_shape_row(r) for r in page]
    if not include_flags:
        for shaped in shaped_rows:
            shaped.pop("flags", None)

    # Sector buckets come from the scored peer bucket when present,
    # otherwise from the raw TV sector of the matched rows.
    for shaped, raw in zip(shaped_rows, page):
        if not _bucket_of(shaped) or _bucket_of(shaped) == "Unknown":
            sector = raw.get("sector") or "Unknown"
            peer = shaped.get("peer")
            shaped["peer"] = {**(peer if isinstance(peer, dict) else {}),
                              "bucket": sector}
    # Also bucket the full matched set for stable counts.
    bucket_rows = []
    for raw in filtered:
        score = _num(raw.get("score"))
        bucket_rows.append({"peer": {"bucket": _bucket_of(raw)},
                            "score": score})

    return {
        "market": market,
        "currency": MARKET_CURRENCY[market],
        "as_of": meta.get("as_of"),
        "scanned": meta.get("scanned", len(rows)),
        "matched": len(filtered),
        "fields_complete": bool(meta.get("fields_complete", False)),
        "filters_applied": filters_applied,
        "rows": shaped_rows,
        "sectors": _sector_breakdown(bucket_rows),
        "warnings": warnings,
    }

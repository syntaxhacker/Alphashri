"""Nifty desk intel — official Upstox market-information block.

Read-only companion to the Nifty report: FII/DII cash flows, official
change-in-OI totals plus the strongest strikes per side, max pain, PCR and
the latest NIFTY-constituent headlines. Parsing/transport is shared with
``scripts/upstox_intel.py`` so the CLI and the desk cannot drift.

Design rules:
  - one 5-minute in-memory cache (Upstox publishes these once a day / per
    interval, so polling every 5s would be pure waste). A payload where
    EVERY source failed is cached for 30 s only — a transient upstream
    failure must not freeze the strip for five minutes;
  - single-flight on a cold cache: only one request builds a payload per
    key, the others wait and then read the cache (the old code released the
    lock before ``build_payload``, so N concurrent callers all hit Upstox);
  - a missing/failed source degrades to ``null`` (or ``[]``) and is named in
    ``unavailable`` — this endpoint never raises, so the desk strip can always
    render something;
  - read-only by construction: HTTP GETs only (through the shared Upstox
    rate limiter), and the news instrument key lookup uses a ``mode=ro``
    SQLite handle inside the shared script helper.
"""

from __future__ import annotations

import datetime as dt
import threading
import time
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException, Query

import config
from scripts.upstox_intel import (
    NIFTY_KEY,
    _as_float,
    _current_week_tuesday,
    _data,
    _expiry_param,
    parse_change_oi_payload,
    parse_fii_dii_payload,
    parse_max_pain_payload,
    parse_news_items,
    parse_pcr_payload,
    resolve_news_keys,
)
from scripts.upstox_intel import _get as _upstox_get

router = APIRouter(tags=["reports-nifty-intel"])

#: Official series change slowly; 5 minutes is plenty and keeps the strip cheap.
CACHE_TTL_SEC = 300

#: A payload where EVERY source failed describes a transient upstream
#: failure, not a fact. It is cached for 30 s so a token expiry or a
#: Cloudflare block heals quickly instead of freezing the strip for 5 min.
UNAVAILABLE_TTL_SEC = 30

#: Every source this payload can draw on.
ALL_SOURCES = ("fii", "dii", "change-oi", "max-pain", "pcr", "news")

#: How many strikes each side of the change-in-OI drawer shows.
TOP_STRIKES = 5

_cache: dict[tuple[str, str, int], tuple[float, dict, float]] = {}
_cache_lock = threading.Lock()
#: Per-key build locks — the single-flight guard.
_flight_locks: dict[tuple[str, str, int], threading.Lock] = {}
_flight_guard = threading.Lock()

#: The cache key carries the requested date and expiry, so every distinct
#: request added an entry that was never evicted. Bound both dicts.
_CACHE_MAX = 64


def _cache_put(key: tuple[str, str, int], payload: dict, ttl: float) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), payload, ttl)
        while len(_cache) > _CACHE_MAX:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            _cache.pop(oldest, None)


def _get(path: str, params: dict, timeout: float):
    """Upstox GET through the shared rate limiter (50/s + 500/min + 2000/30min)."""
    from scripts.upstox_rate import get_limiter

    get_limiter().acquire()
    return _upstox_get(path, params, timeout)


def _today_ist() -> str:
    return dt.datetime.now(config.IST).date().isoformat()


def _validate_date(date_str: str) -> str:
    """``YYYY-MM-DD`` or a 400 — a bad date must not reach the upstream API."""
    try:
        dt.datetime.strptime(str(date_str), "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400,
                            detail=f"bad date: {date_str!r}, want YYYY-MM-DD")
    return str(date_str)


def _validate_expiry(expiry_str: str) -> str:
    """``current_week`` or ``YYYY-MM-DD`` or a 400."""
    text = str(expiry_str or "").strip()
    if text == "current_week":
        return text
    try:
        dt.datetime.strptime(text, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=f"bad expiry: {expiry_str!r}, want YYYY-MM-DD or current_week")
    return text


def _is_all_unavailable(payload: dict) -> bool:
    """True when every source of the payload failed."""
    unavailable = set(payload.get("unavailable") or []) if isinstance(payload, dict) else set()
    return set(ALL_SOURCES).issubset(unavailable)


def _cache_get(key) -> Optional[dict]:
    """The cached payload for ``key`` when it is still fresh, else None."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < hit[2]:
            return hit[1]
    return None


def _flight_lock(key) -> threading.Lock:
    """The build lock for ``key`` (created on first use)."""
    with _flight_guard:
        lock = _flight_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _flight_locks[key] = lock
        while len(_flight_locks) > _CACHE_MAX:
            oldest = next(iter(_flight_locks))
            if oldest == key:
                break
            _flight_locks.pop(oldest, None)
        return lock


def top_side(rows: list[dict], side: str, n: int = TOP_STRIKES) -> list[dict]:
    """Top-``n`` strikes by absolute ``side`` change in OI, strongest first.

    ``side`` is ``"call"`` or ``"put"`` as produced by
    :func:`parse_change_oi_payload`. Rows with a missing strike or a zero
    change are dropped so an all-zero upstream payload renders as "no data"
    rather than five fake strikes at 0.
    """
    ranked = sorted(
        (
            r
            for r in rows or []
            if isinstance(r, dict) and r.get("strike") is not None
        ),
        key=lambda r: abs(_as_float(r.get(side)) or 0.0),
        reverse=True,
    )
    out: list[dict] = []
    for row in ranked[: max(n, 0)]:
        doi = _as_float(row.get(side)) or 0.0
        if doi == 0:
            continue
        out.append({"strike": row["strike"], "doi": doi})
    return out


def build_payload(
    date: Optional[str] = None,
    expiry: Optional[str] = None,
    news_limit: int = 5,
    timeout: float = 10.0,
) -> dict:
    """Assemble the desk-intel payload, degrading per source.

    Every upstream call is isolated: a token expiry, Cloudflare block or a
    shape change only nulls that one field and appends its name to
    ``unavailable``.
    """
    date_str = date or _today_ist()
    expiry_str = expiry or "current_week"
    unavailable: list[str] = []

    def fail(source: str) -> None:
        if source not in unavailable:
            unavailable.append(source)

    def attempt(source: str, fn: Callable[[], Any], default: Any) -> Any:
        try:
            return fn()
        except Exception:  # noqa: BLE001 - upstream failures are expected
            fail(source)
            return default

    expiry_params = _expiry_param(expiry_str)
    base_params = {"instrument_key": NIFTY_KEY, **expiry_params}
    retry_expiry = (
        _current_week_tuesday(date_str) if expiry_str == "current_week" else None
    )

    def oi_get(path: str, params: dict) -> dict:
        raw = _get(path, params, timeout)
        if (
            retry_expiry is not None
            and _data(raw) is None
            and params.get("expiry") != retry_expiry
        ):
            raw = _get(path, {**params, "expiry": retry_expiry}, timeout)
        return raw

    change: dict = {}

    def fetch_change_oi() -> dict:
        nonlocal change
        change = parse_change_oi_payload(
            oi_get(
                "/market/change-oi",
                {**base_params, "date": date_str, "interval": 1},
            )
        )
        return change

    fii = attempt(
        "fii",
        lambda: parse_fii_dii_payload(
            _get("/market/fii", {"data_type": "NSE_EQ|CASH", "interval": "1D"}, timeout)
        ),
        {"buy": None, "sell": None, "net": None},
    )
    dii = attempt(
        "dii",
        lambda: parse_fii_dii_payload(
            _get("/market/dii", {"data_type": "NSE_EQ|CASH", "interval": "1D"}, timeout)
        ),
        {"buy": None, "sell": None, "net": None},
    )
    attempt("change-oi", fetch_change_oi, {})
    max_pain_block = attempt(
        "max-pain",
        lambda: parse_max_pain_payload(
            oi_get(
                "/market/max-pain",
                {**base_params, "date": date_str, "bucket_interval": 60},
            )
        ),
        {"max_pain": None, "spot": None},
    )
    pcr = attempt(
        "pcr",
        lambda: parse_pcr_payload(
            oi_get(
                "/market/pcr",
                {**base_params, "date": date_str, "bucket_interval": 60},
            )
        ),
        None,
    )

    def fetch_news() -> list[dict]:
        raw = _get(
            "/news",
            {
                "category": "instrument_keys",
                "instrument_keys": ",".join(resolve_news_keys()),
            },
            timeout,
        )
        return parse_news_items(raw, news_limit)

    news_rows = attempt("news", fetch_news, [])

    # Upstox returns the same article under every constituent key it mentions.
    # Collapse to one row per link so "3 news" means three headlines.
    seen_news: set[str] = set()
    news_unique: list[dict] = []
    for item in news_rows or []:
        dedupe_key = (item.get("link") or "").strip() or (item.get("heading") or "").strip()
        if not dedupe_key or dedupe_key in seen_news:
            continue
        seen_news.add(dedupe_key)
        news_unique.append(item)

    rows = change.get("rows") or []
    if not rows:
        # Parsed payload with no usable rows is still "no intel" for the strip.
        fail("change-oi")
    if fii.get("net") is None and fii.get("buy") is None:
        fail("fii")
    if dii.get("net") is None and dii.get("buy") is None:
        fail("dii")
    if max_pain_block.get("max_pain") is None:
        fail("max-pain")
    if pcr is None:
        fail("pcr")

    payload = {
        "date": date_str,
        "expiry": expiry_str,
        "fii_net": fii.get("net"),
        "dii_net": dii.get("net"),
        "dce_oi": change.get("total_call_change_oi"),
        "dpe_oi": change.get("total_put_change_oi"),
        "top_dce": top_side(rows, "call"),
        "top_dpe": top_side(rows, "put"),
        "max_pain": max_pain_block.get("max_pain"),
        "pcr": pcr,
        "news": [
            {
                "heading": item.get("heading", ""),
                "link": item.get("link", ""),
                "published": item.get("published_ist", "—"),
            }
            for item in news_unique
        ],
        "unavailable": unavailable,
        "as_of": dt.datetime.now(config.IST).isoformat(timespec="seconds"),
    }
    return payload


def _all_unavailable(date_str: str, expiry_str: str) -> dict:
    """Last-resort envelope used when even payload assembly fails."""
    return {
        "date": date_str,
        "expiry": expiry_str,
        "fii_net": None,
        "dii_net": None,
        "dce_oi": None,
        "dpe_oi": None,
        "top_dce": [],
        "top_dpe": [],
        "max_pain": None,
        "pcr": None,
        "news": [],
        "unavailable": ["fii", "dii", "change-oi", "max-pain", "pcr", "news"],
        "as_of": dt.datetime.now(config.IST).isoformat(timespec="seconds"),
    }


@router.get("/nifty/intel")
def get_nifty_intel(
    date: Optional[str] = Query(default=None, description="Session date YYYY-MM-DD (default: today IST)"),
    expiry: Optional[str] = Query(default=None, description="Expiry YYYY-MM-DD or current_week"),
    news_limit: int = Query(default=5, ge=0, le=20, description="Max headlines"),
) -> dict:
    """Official FII/DII, ΔOI, max-pain, PCR and headlines for the desk strip.

    5-minute in-memory cache keyed by ``(date, expiry, limit)``; a payload
    where every source failed is cached for 30 s only. A cold key is built
    by ONE request (single-flight) — the others wait for it. Never 500s:
    anything that goes wrong is reported through ``unavailable``.
    """
    date_str = _validate_date(date or _today_ist())
    expiry_str = _validate_expiry(expiry or "current_week")
    key = (date_str, expiry_str, news_limit)

    cached = _cache_get(key)
    if cached is not None:
        return cached

    # Single-flight: the lock is HELD across build_payload, so concurrent
    # callers for a cold key share one upstream fan-out instead of each
    # firing their own.
    with _flight_lock(key):
        cached = _cache_get(key)
        if cached is not None:
            return cached
        try:
            payload = build_payload(date_str, expiry_str, news_limit)
        except Exception:  # noqa: BLE001 - the endpoint contract is "never 500"
            payload = _all_unavailable(date_str, expiry_str)
        ttl = UNAVAILABLE_TTL_SEC if _is_all_unavailable(payload) else CACHE_TTL_SEC
        _cache_put(key, payload, ttl)
        return payload

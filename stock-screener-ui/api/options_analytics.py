"""Multi-expiry option-chain analytics — ``GET /api/options/analytics/{underlying}``.

One request answers "what does the whole expiry ladder say", not just the front
month: ATM IV, the 25-delta skew, smile fit quality and the OI/dealer levels for
the nearest N expiries, plus a single warnings list for the whole ladder.

Design invariants:

* **Zero extra upstream calls.** The expiry list comes from the underlying
  cache and every chain comes from the chain cache (``option-chain:`` keys).
  This module only reads/recomputes analytics on frames those caches already
  own; it never calls ``fetch_upstox`` itself.
* **Nullable, never zero.** A missing IV/delta/OI stays ``None`` end to end.
  Zero is a price, not a sentinel — a UI cannot render "no data" from it.
* **Public.** Same posture as ``/api/options/chain``: no ``get_current_user``
  dependency. Upstream failures become a structured 503, never a bare 500.
* **Priced by fan-out.** A cold build constructs one chain per requested expiry
  (each ~8-10 upstream calls), so it spends one rate-limit token per expiry.
  Warm reads cost nothing. Cap: 30 tokens/minute/client.
* **Browser cache mirrors the server cache.** A successful response carries
  ``Cache-Control: private, max-age=<server TTL>`` and a body-derived strong
  ``ETag``; ``If-None-Match`` revalidation answers 304. ``private`` keeps the
  quote-derived payload out of shared proxies; a browser cache is safe (and
  bounded to the server's own TTL) in every session state, including
  ``quotesLive=False``. Error/rate-limit responses carry none of these headers.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import json
import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from api._bounded_cache import BoundedTTLCache, TrackedLock, prune_locks
from api.options_conventions import (
    ANALYTICS_DEFAULT_EXPIRIES,
    ANALYTICS_MAX_EXPIRIES,
    GAMMA_COVERAGE_FLOOR,
    IV_COVERAGE_FLOOR,
    NEAR_ATM_BAND_PCT,
)
from api.options_iv import atm_iv, gamma_coverage, leg_points, otm_points, smile_metrics
from api.options_underlying import (
    _cache,
    _cached,
    _contract_rows,
    _listing,
    _now,
    _resolve_instrument,
    _session_flags,
    _session_state_now,
    _shape,
    _spot,
)
from api.rate_limit import RATE_LIMIT_DETAIL, analytics_limiter

router = APIRouter(prefix="/api/options", tags=["options"])
log = logging.getLogger(__name__)

#: Analytics is a derived read over the chain cache; a slightly wider window
#: than the chain's 5s/60s so a poll burst does not recompute the smile ladder.
ANALYTICS_TTL_OPEN_SEC = 45.0
ANALYTICS_TTL_CLOSED_SEC = 60.0
_ANALYTICS_KEY_PREFIX = "option-analytics:"

#: Cold reads build up to six chains, each an upstream call. A thread semaphore
#: (acquired off the event loop) bounds this across loops as well: TestClient
#: and multiple uvicorn workers must not each get their own quota. Warm reads
#: never touch it — they return straight from the cache.
COLD_BUILD_CONCURRENCY = 4
COLD_BUILD_WAIT_SEC = 30.0
_cold_build_slots = threading.BoundedSemaphore(COLD_BUILD_CONCURRENCY)

ANALYTICS_UNAVAILABLE_DETAIL = "Option analytics are temporarily unavailable. Retry shortly."

#: The P2 engines are best-effort: a missing module, a broken call or an odd
#: return value degrades one block to ``null`` and never fails the ladder.
RV_UNAVAILABLE_WARNING = "rv_unavailable"
RND_SMILE_FALLBACK_WARNING = "used_smile_fallback"
RV_CACHE_TTL_SEC = 900.0
#: One cone per caller-supplied symbol; cap it and sweep expired cones so a
#: symbol sweep cannot grow the public cache without bound. Values stay the
#: ``(monotonic ts, cone|None)`` tuples the read/write sites already expect.
RV_CACHE_MAX = 512
_rv_cache = BoundedTTLCache(
    RV_CACHE_MAX,
    ts_getter=lambda value: value[0],
    ttl_getter=RV_CACHE_TTL_SEC,
)
#: One single-flight guard per symbol. ``TrackedLock`` exposes ``locked()`` so
#: pruning never drops a guard another worker thread is still holding.
_rv_locks: dict[str, TrackedLock] = {}
_rv_locks_guard = threading.Lock()

#: RV builds run on a dedicated pool, not asyncio's default executor. Same-symbol
#: waiters block on the single-flight lock above; on the default pool they could
#: occupy every worker and starve unrelated ``to_thread`` work (token lookups,
#: instrument resolution, cold-build semaphore acquisition). A small dedicated
#: pool keeps that contention isolated. It is intentionally 2: the lock already
#: serialises a given symbol, so more workers only buy parallel *symbols*.
RV_EXECUTOR_WORKERS = 2
_rv_executor = ThreadPoolExecutor(
    max_workers=RV_EXECUTOR_WORKERS, thread_name_prefix="analytics-rv"
)


def _rv_lock_for(symbol: str) -> TrackedLock:
    """Return the symbol's guard; creation and pruning are one atomic step."""
    with _rv_locks_guard:
        lock = _rv_locks.setdefault(symbol, TrackedLock())
        prune_locks(_rv_locks, RV_CACHE_MAX, keep=(symbol,))
        return lock

# Coverage floors and expiry limits are owned by :mod:`api.options_conventions`
# and imported above; warning codes below stay verbatim (the UI maps them).


# ---------------------------------------------------------------------------
# Response models (camelCase field names are the wire contract)
# ---------------------------------------------------------------------------

class ChainIvRow(BaseModel):
    strike: Optional[float] = None
    ceIv: Optional[float] = None
    peIv: Optional[float] = None
    ceDelta: Optional[float] = None
    peDelta: Optional[float] = None
    ceOi: Optional[float] = None
    peOi: Optional[float] = None


class ExpiryMetrics(BaseModel):
    rr25: Optional[float] = None
    fly25: Optional[float] = None
    slope: Optional[float] = None
    r2: Optional[float] = None
    n: Optional[int] = None


class ExpiryAnalytics(BaseModel):
    date: str
    dteDays: Optional[int] = None
    spot: Optional[float] = None
    atmIv: Optional[float] = None
    iv: list[ChainIvRow] = Field(default_factory=list)
    metrics: ExpiryMetrics = Field(default_factory=ExpiryMetrics)
    levels: Optional[dict[str, Any]] = None
    positioning: Optional[dict[str, Any]] = None
    dealer: Optional[dict[str, Any]] = None
    liquidity: Optional[dict[str, Any]] = None
    rnd: Optional[dict[str, Any]] = None


class OptionsAnalyticsResponse(BaseModel):
    symbol: str
    asOf: Optional[str] = None
    spot: Optional[float] = None
    marketState: Optional[str] = None
    quotesLive: Optional[bool] = None
    sessionDate: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)
    expiries: list[ExpiryAnalytics] = Field(default_factory=list)
    rv: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Pure shaping helpers
# ---------------------------------------------------------------------------

def _finite(value: Any) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _spot_or_none(value: Any) -> Optional[float]:
    """A zero spot is an unavailable quote, not a ₹0 price."""
    out = _finite(value)
    return out if out is not None and out > 0.0 else None


def _json_safe(value: Any) -> Any:
    """Strip non-finite numbers and unsupported objects before JSON encoding.

    Starlette encodes with ``allow_nan=False``: one NaN from an engine would
    otherwise turn the whole response into a 500 instead of a null block.
    """
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "item"):  # numpy scalar
        try:
            return _json_safe(value.item())
        except Exception:
            return None
    return None


def _engine_call(module_name: str, func_name: str, *args: Any) -> Any:
    """Call an optional P2 engine, returning ``None`` if it is absent/broken.

    The import stays lazy so a missing engine cannot break importing this
    router, and so tests can inject fakes through ``sys.modules``.
    """
    try:
        func = getattr(importlib.import_module(module_name), func_name)
        return func(*args) if callable(func) else None
    except Exception as exc:
        log.warning("analytics engine %s.%s failed: %s", module_name, func_name, exc)
        return None


def _engine_block(module_name: str, func_name: str, *args: Any) -> Optional[dict]:
    """One per-expiry engine block, normalised to a JSON-safe dict or ``null``."""
    value = _engine_call(module_name, func_name, *args)
    return _json_safe(value) if isinstance(value, dict) else None


def _rv_block(symbol: str, expiries: list[dict]) -> tuple[Optional[dict], bool]:
    """Cone cached per symbol; IV-vs-RV read recomputed from ``expiries``.

    ``(None, True)`` = unavailable. Only the cone (and its failed flag, stored
    as ``None``) is cached: the comparison depends on the current expiry list,
    so caching it would leak a stale row count across differing ``?expiries=``
    requests for the same symbol.
    """
    now = time.monotonic()
    cached = _rv_cache.get(symbol)
    if cached is not None and now - cached[0] < RV_CACHE_TTL_SEC:
        cone = cached[1]
        if cone is None:
            return None, True
        return _rv_finish(cone, expiries)

    # A cold cone costs one provider daily-history fetch. Serialise the
    # miss→fill per symbol so a burst of analytics requests pays for one.
    with _rv_lock_for(symbol):
        now = time.monotonic()
        cached = _rv_cache.get(symbol)
        if cached is not None and now - cached[0] < RV_CACHE_TTL_SEC:
            cone = cached[1]
            if cone is None:
                return None, True
        else:
            cone = _json_safe(_engine_call("api.options_rv", "realized_vol_cone", symbol))
            cone_warnings = cone.get("warnings") if isinstance(cone, dict) else None
            # The RV engine degrades to a warning-carrying cone instead of raising; a
            # provider failure is still a failed RV read for this endpoint's contract.
            rv_failed = (
                cone is None or cone == {} or cone == []
                or (
                    isinstance(cone_warnings, list)
                    and any(
                        str(w).startswith("provider_unavailable") or w == "empty_series"
                        for w in cone_warnings
                    )
                )
            )
            if rv_failed:
                log.warning("analytics RV unavailable for %s", symbol)
                _rv_cache[symbol] = (now, None)
                return None, True
            _rv_cache[symbol] = (now, cone)
        return _rv_finish(cone, expiries)


def _rv_finish(cone: Any, expiries: list[dict]) -> tuple[dict, bool]:
    """Compare a (cached or freshly built) cone against the current expiry list."""
    comparison = _json_safe(_engine_call("api.options_rv", "iv_vs_rv", expiries, cone))
    return {"cone": cone, "ivVsRv": comparison}, False


def _leg_md(leg: Any) -> dict:
    if not isinstance(leg, dict):
        return {}
    value = leg.get("market_data")
    return value if isinstance(value, dict) else {}


def _leg_greeks(leg: Any) -> dict:
    if not isinstance(leg, dict):
        return {}
    value = leg.get("option_greeks")
    return value if isinstance(value, dict) else {}


def _iv_or_none(leg: Any) -> Optional[float]:
    if not isinstance(leg, dict):
        return None
    if leg.get("iv_valid") is False:
        return None
    return _finite(_leg_greeks(leg).get("iv"))


@dataclass(frozen=True)
class _ChainView:
    """Every analytics shape derived from one expiry's raw chain, built once.

    ``iv_rows`` feeds the IV helpers, ``grid`` is the payload's ``iv`` block, and
    the leg counters reproduce the warnings' IV-coverage read. Building all of
    them in a single traversal keeps the nested leg parsing out of the warning,
    grid and expiry-entry paths.
    """

    iv_rows: list[dict]
    grid: list[ChainIvRow]
    leg_total: int
    leg_covered: int
    missing_greeks: bool


def _grid_from_rows(rows: list[dict]) -> list[ChainIvRow]:
    """Payload IV grid from already-flattened rows, sorted by strike."""
    out = [
        ChainIvRow(
            strike=row["strike"],
            ceIv=row["ce"]["iv"],
            peIv=row["pe"]["iv"],
            ceDelta=row["ce"]["delta"],
            peDelta=row["pe"]["delta"],
            ceOi=row["ce"]["oi"],
            peOi=row["pe"]["oi"],
        )
        for row in rows
    ]
    out.sort(key=lambda r: r.strike if r.strike is not None else -math.inf)
    return out


def _chain_view(chain: list[dict]) -> _ChainView:
    """Flatten one raw chain once; derive every analytics view from that pass.

    The leg counters deliberately read the raw ``iv_valid``/``option_greeks``
    fields rather than the flattened IVs: a truthy ``iv_valid`` with a missing
    IV print is still "covered" for the warning, and a leg with no greeks is a
    distinct signal from a non-finite delta. Rows without a finite strike are
    excluded from the IV views but still counted, matching the old leg pass.
    """
    iv_rows: list[dict] = []
    leg_total = 0
    leg_covered = 0
    missing_greeks = False
    for row in chain or []:
        if not isinstance(row, dict):
            continue
        for side in ("ce", "pe"):
            leg = row.get(side)
            if not isinstance(leg, dict):
                continue
            leg_total += 1
            if leg.get("iv_valid"):
                leg_covered += 1
            greeks = leg.get("option_greeks")
            if not greeks or _finite(greeks.get("delta")) is None:
                missing_greeks = True

        strike = _finite(row.get("strike"))
        if strike is None:
            continue
        flat = {}
        for side in ("ce", "pe"):
            leg = row.get(side)
            greeks = _leg_greeks(leg)
            md = _leg_md(leg)
            flat[side] = {
                "ltp": _finite(md.get("ltp")),
                "iv": _iv_or_none(leg),
                "delta": _finite(greeks.get("delta")),
                "gamma": _finite(greeks.get("gamma")),
                "oi": _finite(md.get("oi")),
            }
        iv_rows.append({"strike": strike, "ce": flat["ce"], "pe": flat["pe"]})

    return _ChainView(
        iv_rows=iv_rows,
        grid=_grid_from_rows(iv_rows),
        leg_total=leg_total,
        leg_covered=leg_covered,
        missing_greeks=missing_greeks,
    )


def _warnings(quotes_live: bool, chains: list[dict], views: list[_ChainView]) -> list[str]:
    out: list[str] = []
    if not quotes_live:
        out.append("quotes_not_live")

    total = 0
    covered = 0
    gex_degraded = False
    gamma_low = False
    thin = False
    missing_greeks = False
    for payload, view in zip(chains, views):
        levels = payload.get("levels") or {}
        gex = levels.get("gex") or {}
        gex_degraded = gex_degraded or bool(gex.get("degraded"))
        coverage = gamma_coverage(
            view.iv_rows,
            payload.get("spot"),
            band_pct=NEAR_ATM_BAND_PCT,
        )
        if coverage is not None and coverage < GAMMA_COVERAGE_FLOOR:
            gamma_low = True
        thin = thin or bool(levels.get("thin"))
        total += view.leg_total
        covered += view.leg_covered
        missing_greeks = missing_greeks or view.missing_greeks

    if total and covered / total < IV_COVERAGE_FLOOR:
        out.append("iv_coverage_below_60pct")
    if gex_degraded or gamma_low:
        out.append("gex_degraded")
    if thin:
        out.append("thin_chain")
    if missing_greeks:
        out.append("missing_greeks")
    return out


def _rnd_warnings(entries: list[ExpiryAnalytics]) -> list[str]:
    """Lift the RND model caveat into the ladder's single warnings list."""
    for entry in entries:
        rnd = entry.rnd or {}
        engine_warnings = rnd.get("warnings") if isinstance(rnd, dict) else None
        if isinstance(engine_warnings, list) and RND_SMILE_FALLBACK_WARNING in engine_warnings:
            return [RND_SMILE_FALLBACK_WARNING]
    return []


def _expiry_entry(expiry: dict, payload: dict, view: _ChainView) -> ExpiryAnalytics:
    spot = _spot_or_none(payload.get("spot"))
    chain = payload.get("chain") or []
    iv_rows = view.iv_rows
    levels = payload.get("levels") or {}
    step = _finite(levels.get("step"))

    # ATM is the one read that must see the ATM strike's own CE and PE quotes;
    # otm_points drops that strike for the smile, so read it from leg_points.
    atm = atm_iv(leg_points(iv_rows), spot, step=step)
    metrics = smile_metrics(otm_points(iv_rows, spot), spot, atm=atm)

    coverage = gamma_coverage(iv_rows, spot, band_pct=NEAR_ATM_BAND_PCT)
    gex = dict(levels.get("gex") or {})
    gex["gamma_coverage"] = coverage
    levels_out = {**levels, "gex": gex}

    # Every engine consumes the chain already fetched — no extra upstream call.
    # RND gets the raw rows too: LTP is its first choice, IV only its fallback.
    dte_days = _finite(expiry.get("dte_days"))
    dte_years = dte_days / 365.0 if dte_days is not None and dte_days > 0.0 else None
    positioning = _engine_block("api.options_positioning", "positioning_block", chain, spot)
    dealer = _engine_block("api.options_dealer", "dealer_block", chain, spot, dte_years)
    liquidity = _engine_block("api.options_liquidity", "liquidity_block", chain)
    rnd = _engine_block("api.options_rnd", "risk_neutral_density", chain, spot, dte_days)

    return ExpiryAnalytics(
        date=str(expiry.get("date") or ""),
        dteDays=expiry.get("dte_days"),
        spot=spot,
        atmIv=atm,
        iv=view.grid,
        metrics=ExpiryMetrics(
            rr25=metrics.get("rr25") if metrics else None,
            fly25=metrics.get("fly25") if metrics else None,
            slope=metrics.get("slope_atm") if metrics else None,
            r2=metrics.get("r2") if metrics else None,
            n=metrics.get("n") if metrics else None,
        ),
        levels=levels_out,
        positioning=positioning,
        dealer=dealer,
        liquidity=liquidity,
        rnd=rnd,
    )


# ---------------------------------------------------------------------------
# Cache loaders
# ---------------------------------------------------------------------------

def clear_analytics_cache() -> None:
    """Drop analytics entries only (tests / after a broker reconnect)."""
    _cache.pop_where(lambda k: k.startswith(_ANALYTICS_KEY_PREFIX))
    _rv_cache.clear()
    with _rv_locks_guard:
        _rv_locks.clear()


def _analytics_is_warm(key: str) -> bool:
    """Match ``_cached``'s freshness test without spending a rate-limit token."""
    entry = _cache.get(key)
    return bool(entry) and time.monotonic() - entry["ts"] < entry["ttl"]


async def _build_chain_limited(builder, symbol: str, date: str, session_state: str) -> dict:
    """One cold chain build, holding a global slot for its whole lifetime."""
    acquired = await asyncio.to_thread(
        _cold_build_slots.acquire, True, COLD_BUILD_WAIT_SEC
    )
    if not acquired:
        log.warning("analytics: timed out waiting for a cold build slot for %s/%s", symbol, date)
        raise _unavailable()
    try:
        return await builder(symbol, date, session_state)
    finally:
        _cold_build_slots.release()


async def _underlying_payload(symbol: str) -> dict:
    """E1's payload without its auth dependency, reusing the same cache key."""
    instrument_key, exchange = await asyncio.to_thread(_resolve_instrument, symbol)

    async def _load() -> dict:
        rows = await _contract_rows(instrument_key)
        spot = await _spot(instrument_key) if rows else 0.0
        return {
            "instrument_key": instrument_key,
            "exchange": exchange,
            "fno": bool(rows),
            "spot": spot,
            "listing": _listing(rows),
        }

    data = await _cached(symbol, _load)
    now = _now()
    cash_open, holiday = await asyncio.to_thread(_session_flags, now)
    return _shape(
        symbol=symbol,
        exchange=data["exchange"],
        instrument_key=data["instrument_key"],
        fno=data["fno"],
        spot=data["spot"],
        listing=data["listing"],
        now=now,
        cash_open=cash_open,
        holiday=holiday,
    )


def _unavailable() -> HTTPException:
    """Fixed client detail; the real cause is logged server-side only."""
    return HTTPException(
        status_code=503,
        detail={"code": "analytics_unavailable", "detail": ANALYTICS_UNAVAILABLE_DETAIL},
    )


async def _load_analytics(symbol: str, expiries: int, session_state: str) -> dict:
    from api.options import (
        CHAIN_TTL_CLOSED_SEC,
        CHAIN_TTL_OPEN_SEC,
        _build_chain_response,
        _chain_cache_key,
    )

    underlying = await _underlying_payload(symbol)
    listing = sorted(underlying.get("expiries") or [], key=lambda e: str(e.get("date") or ""))
    if not underlying.get("fno") or not listing:
        log.warning("analytics: no listed options for %s", symbol)
        raise _unavailable()

    chain_payloads: list[dict] = []
    views: list[_ChainView] = []
    entries: list[ExpiryAnalytics] = []
    for expiry in listing[:expiries]:
        date = str(expiry.get("date") or "")
        if not date:
            continue
        try:
            payload = await _cached(
                _chain_cache_key(symbol, date, session_state),
                lambda d=date: _build_chain_limited(
                    _build_chain_response, symbol, d, session_state
                ),
                ttl_open=CHAIN_TTL_OPEN_SEC,
                ttl_closed=CHAIN_TTL_CLOSED_SEC,
                session_state=session_state,
            )
        except HTTPException:
            raise
        except Exception as exc:
            log.warning("analytics chain build failed for %s/%s: %s", symbol, date, exc)
            raise _unavailable()
        if not payload or not payload.get("chain"):
            log.warning("analytics chain empty for %s/%s", symbol, date)
            raise _unavailable()
        chain_payloads.append(payload)
        view = _chain_view(payload.get("chain") or [])
        views.append(view)
        entries.append(_expiry_entry(expiry, payload, view))

    if not entries:
        log.warning("analytics: no expiries resolved for %s", symbol)
        raise _unavailable()

    first = chain_payloads[0]
    warnings = _warnings(bool(underlying.get("quotes_live")), chain_payloads, views)
    warnings.extend(_rnd_warnings(entries))
    # A cold RV read fetches provider daily history over the network. That fetch
    # is synchronous, so keep it (and the rest of the RV block) off the event
    # loop — otherwise one slow upstream stalls every other analytics request.
    # Use the dedicated pool rather than the default executor: same-symbol
    # waiters block on the single-flight lock, and parking them on the default
    # pool would starve unrelated ``to_thread`` work.
    rv_args = [entry.model_dump() for entry in entries]
    loop = asyncio.get_running_loop()
    rv, rv_failed = await loop.run_in_executor(_rv_executor, _rv_block, symbol, rv_args)
    if rv_failed:
        warnings.append(RV_UNAVAILABLE_WARNING)

    return OptionsAnalyticsResponse(
        symbol=symbol,
        asOf=first.get("data_as_of"),
        spot=_spot_or_none(first.get("spot")),
        marketState=session_state,
        quotesLive=bool(underlying.get("quotes_live")),
        sessionDate=first.get("session_date"),
        warnings=warnings,
        expiries=entries,
        rv=rv,
    ).model_dump()


# ---------------------------------------------------------------------------
# HTTP cache headers (browser side; independent of the server cache keys/TTLs)
# ---------------------------------------------------------------------------

def _browser_ttl(session_state: str) -> int:
    """Mirror the server cache TTL so a browser copy is never older than the server's."""
    return int(
        ANALYTICS_TTL_OPEN_SEC if session_state == "open" else ANALYTICS_TTL_CLOSED_SEC
    )


def _response_etag(data: dict) -> str:
    """Strong ETag over the exact bytes FastAPI would send for ``data``.

    ``model_dump()`` already produced plain JSON types; ``jsonable_encoder``
    mirrors FastAPI's own serialisation, so the digest changes only when the
    response body actually changes, not when the cache entry is merely rebuilt.
    """
    body = json.dumps(
        jsonable_encoder(data),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )
    return '"' + hashlib.sha256(body.encode("utf-8")).hexdigest() + '"'


def _if_none_match_matches(header: Optional[str], etag: str) -> bool:
    """RFC 9110 conditional GET: ``*`` or any listed (possibly weak) tag matches."""
    if not header:
        return False
    if header.strip() == "*":
        return True
    for token in header.split(","):
        candidate = token.strip()
        if candidate.startswith("W/"):
            candidate = candidate[2:].strip()
        if candidate == etag:
            return True
    return False


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get(
    "/analytics/{underlying}",
    response_model=OptionsAnalyticsResponse,
    summary="Multi-expiry option analytics: ATM IV, 25-delta skew, smile fit and levels",
)
async def get_options_analytics(
    underlying: str,
    request: Request,
    response: Response,
    expiries: int = Query(
        ANALYTICS_DEFAULT_EXPIRIES,
        ge=1,
        le=ANALYTICS_MAX_EXPIRIES,
        description="Number of nearest expiries (1-6)",
    ),
):
    """Nearest ``expiries`` expiries of one underlying, from cache only.

    Reads the expiry ladder from the underlying cache and each chain from the
    chain cache, so a poll burst adds no Upstox calls. Any upstream/derivation
    failure is a structured ``503 analytics_unavailable``.

    Successful responses carry a browser cache window equal to the server TTL
    and a body-derived ETag; a matching ``If-None-Match`` revalidation answers
    304 without a body. The rate-limit and server-cache paths run before this,
    so both cold (charged) and warm (free) request budgets are unchanged.
    """
    symbol = str(underlying or "").strip().upper()
    session_state = await _session_state_now()
    key = f"{_ANALYTICS_KEY_PREFIX}{symbol}:{expiries}:{session_state}"

    # A warm read costs no upstream call, so it must never be throttled. A cold
    # build constructs one chain per expiry (each ~8-10 upstream calls), so the
    # charge is one token per requested expiry rather than a flat one — cap and
    # retry contract below are unchanged.
    if not _analytics_is_warm(key):
        client_ip = request.client.host if request.client else "unknown"
        allowed, retry_after = analytics_limiter.check(client_ip, cost=expiries)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail={"code": "rate_limited", "detail": RATE_LIMIT_DETAIL},
                headers={"Retry-After": str(retry_after)},
            )

    try:
        data = await _cached(
            key,
            lambda: _load_analytics(symbol, expiries, session_state),
            ttl_open=ANALYTICS_TTL_OPEN_SEC,
            ttl_closed=ANALYTICS_TTL_CLOSED_SEC,
            session_state=session_state,
        )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("analytics build failed for %s: %s", symbol, exc)
        raise _unavailable()

    headers = {
        "Cache-Control": f"private, max-age={_browser_ttl(session_state)}",
        "ETag": _response_etag(data),
    }
    if _if_none_match_matches(request.headers.get("if-none-match"), headers["ETag"]):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return data

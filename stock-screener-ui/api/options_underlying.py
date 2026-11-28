"""
Underlying metadata for the option chain (E1).

One call answers "what can I trade on this symbol, and which expiry is live":
the instrument key, whether the name has listed options at all, the real
exchange expiry listing with lot/tick sizes, the spot, the expiry a chain
should open on, and whether the F&O session is running.

The lot size exists only on ``/v2/option/contract`` (the chain contract has
none), so the payoff/greeks maths depends on this endpoint rather than on the
chain payload. Upstox reports ``tick_size`` in paise; E1 divides by 100 and
publishes rupees, because a 5-paise tick rendered as "5" rounds every price.

Symbols with no listed options answer ``200 {"fno": false}`` — an empty chain
and a dead market are then distinguishable, which the old ``NSE_INDEX|<symbol>``
fallback in ``api.options.get_instrument_key`` made impossible.

E1 takes no expiry argument. E2's optional ``expiry_date`` query parameter must
reject anything that is not ``YYYY-MM-DD`` with a 400 (Upstox's relative
keywords resolve server-side and can disagree with the label the client shows).
"""

import asyncio
import logging
import time
from datetime import datetime, time as dtime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import config
from api._bounded_cache import BoundedTTLCache, prune_locks
from api.auth import get_current_user
from db.models import User
from trading.utils import (
    DERIVATIVES_CLOSE,
    MARKET_CLOSE,
    MARKET_OPEN,
    PRE_MARKET,
    is_market_open,
    is_trading_holiday,
)

router = APIRouter(prefix="/api/options", tags=["options"])
log = logging.getLogger(__name__)

#: Fixed client-facing detail: upstream bodies/exception strings can carry
#: internal URLs and tokens, so they are logged here instead.
UPSTREAM_UNAVAILABLE_DETAIL = "Upstream option data is temporarily unavailable. Retry shortly."
#: Fixed Retry-After on upstream 429s. No upstream text (which may carry
#: internal URLs or tokens) is echoed back — only a constant delay is sent.
UPSTREAM_429_RETRY_AFTER_SEC = 5


async def fetch_upstox(endpoint: str, params: Optional[dict] = None) -> dict:
    """Proxy to the single Upstox client in :mod:`api.options`.

    Imported on call, not at module load: ``api.options`` builds its public
    underlyings table from this module's registry, so importing it back here
    at module scope would be circular. Kept at module scope so tests can
    monkeypatch ``ou.fetch_upstox``.
    """
    from api.options import fetch_upstox as _fetch_upstox

    return await _fetch_upstox(endpoint, params)


def get_instrument_key(underlying: str) -> str:
    """Proxy to :func:`api.options.get_instrument_key` (lazy: see above)."""
    from api.options import get_instrument_key as _get_instrument_key

    return _get_instrument_key(underlying)


#: Index underlyings whose Upstox key is not derivable from the equity map.
#: ``symbol -> (instrument_key, exchange)``.
INDEX_ALIASES: dict[str, tuple[str, str]] = {
    "NIFTY": ("NSE_INDEX|Nifty 50", "NSE"),
    "BANKNIFTY": ("NSE_INDEX|Nifty Bank", "NSE"),
    "FINNIFTY": ("NSE_INDEX|Nifty Fin Service", "NSE"),
    "MIDCPNIFTY": ("NSE_INDEX|NIFTY MID SELECT", "NSE"),
    "SENSEX": ("BSE_INDEX|SENSEX", "BSE"),
}

#: Display name + contract metadata for every INDEX_ALIASES symbol, keyed by the
#: same symbol. This is the sole owner of the index lot/tick literals; the public
#: ``api.options.AVAILABLE_UNDERLYINGS`` table is derived from it so the two
#: registries cannot drift. NIFTY's 65 is what GEX already computes with (23
#: consecutive exchange prints were exact multiples of 65; it was 25).
#: Index option premiums tick at ₹0.05 for all these symbols; the 0.05/0.10/0.20
#: ladder applies to index FUTURES only (NSE/FAOP/73928; BSE SENSEX OPTIONS spec).
INDEX_CONTRACT_META: dict[str, dict] = {
    "NIFTY": {"name": "Nifty 50", "lot_size": 65, "tick_size": 0.05},
    "BANKNIFTY": {"name": "Nifty Bank", "lot_size": 15, "tick_size": 0.05},
    "FINNIFTY": {"name": "Nifty Fin Service", "lot_size": 25, "tick_size": 0.05},
    "MIDCPNIFTY": {"name": "NIFTY MID SELECT", "lot_size": 50, "tick_size": 0.05},
    "SENSEX": {"name": "BSE Sensex", "lot_size": 20, "tick_size": 0.05},
}


def index_lot_size(symbol: str) -> int:
    """Canonical contract lot for ``symbol``; ``KeyError`` when unlisted.

    Consumers with a legacy single-symbol name keep that name as an alias of
    this accessor instead of restating the lot as a second literal.
    """
    key = str(symbol or "").strip().upper()
    return int(INDEX_CONTRACT_META[key]["lot_size"])


#: A contract listing only changes when the exchange rolls an expiry, so a
#: short TTL while the session runs is enough; closed, the listing is static.
CACHE_TTL_OPEN_SEC = 300.0
CACHE_TTL_CLOSED_SEC = 6 * 3600.0

#: After the derivatives close an expiry-day contract no longer trades, so the
#: default must roll forward instead of opening a dead chain with live greeks.
EXPIRY_ROLLOVER = dtime(*DERIVATIVES_CLOSE)


class ExpiryInfo(BaseModel):
    date: str
    weekly: bool
    dte_days: int
    lot_size: int
    tick_size: float = Field(
        description=(
            "Minimum price increment in **rupees** (Upstox reports paise; divided by 100 "
            "here). NSE uses ₹0.05 at/above ₹250 and ₹0.01 below."
        )
    )


class UnderlyingInfo(BaseModel):
    symbol: str
    exchange: str
    fno: bool
    instrument_key: str
    spot: float
    expiries: list[ExpiryInfo]
    default_expiry: Optional[str] = None
    market_state: str
    quotes_live: bool = Field(
        description=(
            "True only while `market_state == \"open\"`. When false, chain LTPs are the "
            "last session's prints (a pre-open chain shows the previous close), not live prices."
        )
    )


#: symbol/chain-key -> {"ts": monotonic, "ttl": seconds, "data": upstream-derived
#: payload}. Only the parts that come from Upstox are cached; ``dte_days``/
#: ``default_expiry``/``market_state`` are recomputed per request so a 15:40
#: rollover is not delayed by a cache window that started before it. Public
#: callers supply the symbol, so the cache is LRU-capped and expiry-swept.
_CACHE_MAX = 512
_locks: dict[str, asyncio.Lock] = {}


def _drop_lock(key: str) -> None:
    """Release the guard for a cache key that was evicted/cleared.

    A guard still held by an in-flight fetch is left in place; ``prune_locks``
    collects it once it goes idle.
    """
    lock = _locks.get(key)
    if lock is not None and not lock.locked():
        _locks.pop(key, None)


_cache = BoundedTTLCache(
    _CACHE_MAX,
    ttl_getter=lambda value: value["ttl"],
    on_evict=_drop_lock,
)


def _resolve_instrument(symbol: str) -> tuple[str, str]:
    """``(instrument_key, exchange)`` for ``symbol``; 404 when unknown.

    ``get_instrument_key`` fabricates ``NSE_INDEX|<symbol>`` for an unknown
    stock, which Upstox answers with an empty chain. Treat that shape as
    unresolvable instead of sending it upstream.
    """
    up = str(symbol or "").strip().upper()
    alias = INDEX_ALIASES.get(up)
    if alias:
        return alias

    key = str(get_instrument_key(up) or "")
    if not key or key.startswith("NSE_INDEX|"):
        raise HTTPException(
            status_code=404,
            detail={"code": "not_fno", "detail": f"Unknown underlying: {symbol}"},
        )
    return key, "NSE"


async def _contract_rows(instrument_key: str) -> list[dict]:
    """Raw ``/option/contract`` rows; upstream auth/availability errors are
    mapped to structured 401/429/503 so a token problem never reads as a 500."""
    try:
        payload = await fetch_upstox("/option/contract", {"instrument_key": instrument_key})
    except HTTPException as exc:
        if exc.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "upstox_auth_required",
                    "detail": "Upstox access token missing or expired. Reconnect Upstox in Settings.",
                },
            )
        if exc.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail={"code": "rate_limited", "detail": "Upstox rate limit reached, retry shortly."},
                headers={"Retry-After": str(UPSTREAM_429_RETRY_AFTER_SEC)},
            )
        log.warning("option contract listing failed for %s: %s", instrument_key, exc.detail)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "upstream_unavailable",
                "detail": UPSTREAM_UNAVAILABLE_DETAIL,
            },
        )
    except Exception as exc:  # httpx/JSON-level failure — never a bare 500
        log.warning("option contract listing failed for %s: %s", instrument_key, exc)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "upstream_unavailable",
                "detail": UPSTREAM_UNAVAILABLE_DETAIL,
            },
        )

    rows = payload.get("data") if isinstance(payload, dict) else None
    return [row for row in (rows or []) if isinstance(row, dict)]


async def _spot(instrument_key: str) -> float:
    """Last price for the underlying; 0.0 when the quote is unavailable."""
    try:
        payload = await fetch_upstox("/market-quote/ltp", {"instrument_key": instrument_key})
    except Exception:
        return 0.0
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return 0.0
    for quote in data.values():
        if not isinstance(quote, dict):
            continue
        if str(quote.get("instrument_token") or "") == instrument_key:
            return float(quote.get("last_price") or 0.0)
    first = next((v for v in data.values() if isinstance(v, dict)), None)
    return float((first or {}).get("last_price") or 0.0)


def _listing(rows: list[dict]) -> list[dict]:
    """One entry per expiry, keeping the contract's own lot/tick and weekly flag."""
    by_expiry: dict[str, dict] = {}
    for row in rows:
        expiry = str(row.get("expiry") or "").strip()
        if not expiry:
            continue
        entry = by_expiry.setdefault(
            expiry,
            {
                "date": expiry,
                "weekly": bool(row.get("weekly", False)),
                "lot_size": int(row.get("lot_size") or 0),
                "tick_size": float(row.get("tick_size") or 0.0),
            },
        )
        # Rows for one expiry agree; fill any field a sparse row left empty.
        if not entry["lot_size"]:
            entry["lot_size"] = int(row.get("lot_size") or 0)
        if not entry["tick_size"]:
            entry["tick_size"] = float(row.get("tick_size") or 0.0)
    return sorted(by_expiry.values(), key=lambda e: e["date"])


def _session_state(now: datetime, cash_open: bool, holiday: bool) -> str:
    """``open`` / ``closed`` / ``pre_open`` for the F&O session.

    ``cash_open`` is ``trading.utils.is_market_open`` (09:15–15:30); derivatives
    keep trading to 15:40, so the last ten minutes are still "open" here.
    """
    if now.weekday() >= 5 or holiday:
        return "closed"
    t = now.time()
    if t < dtime(*PRE_MARKET):
        return "closed"
    if t < dtime(*MARKET_OPEN):
        return "pre_open"
    if t < dtime(*MARKET_CLOSE):
        return "open" if cash_open else "closed"
    if t < EXPIRY_ROLLOVER:
        return "open"
    return "closed"


def _now() -> datetime:
    """IST now — module-level so tests can freeze the session clock."""
    return datetime.now(config.IST)


def _session_flags(now: datetime) -> tuple[bool, bool]:
    """``(cash_open, holiday)``; both read SQLite, so callers use ``to_thread``."""
    return is_market_open(now), is_trading_holiday(now)


def _paise_to_rupees(value: float) -> float:
    """Upstox ``tick_size`` is in paise; E1 exposes rupees.

    NIFTY/RELIANCE report ``5.0`` (₹0.05) and ONGC/IRFC report ``1.0`` (₹0.01).
    A UI that renders the raw number rounds tree prices to whole rupees.
    """
    return float(value or 0.0) / 100.0


def _shape(
    symbol: str,
    exchange: str,
    instrument_key: str,
    fno: bool,
    spot: float,
    listing: list[dict],
    now: datetime,
    cash_open: bool,
    holiday: bool,
) -> dict:
    """Attach the request-time fields (DTE, default expiry, session state)."""
    today = now.date()
    expiries = [
        {
            "date": row["date"],
            "weekly": row["weekly"],
            "dte_days": (datetime.strptime(row["date"], "%Y-%m-%d").date() - today).days,
            "lot_size": row["lot_size"],
            "tick_size": _paise_to_rupees(row["tick_size"]),
        }
        for row in listing
        if (datetime.strptime(row["date"], "%Y-%m-%d").date() - today).days >= 0
    ]

    default_expiry = None
    for expiry in expiries:
        if expiry["dte_days"] == 0 and now.time() >= EXPIRY_ROLLOVER:
            continue
        default_expiry = expiry["date"]
        break

    market_state = _session_state(now, cash_open, holiday)

    return {
        "symbol": symbol,
        "exchange": exchange,
        "fno": fno,
        "instrument_key": instrument_key,
        "spot": spot,
        "expiries": expiries,
        "default_expiry": default_expiry,
        "market_state": market_state,
        "quotes_live": market_state == "open",
    }


async def _session_state_now() -> str:
    """Session state for building a cache key that cannot cross a close/open."""
    now = _now()
    cash_open, holiday = await asyncio.to_thread(_session_flags, now)
    return _session_state(now, cash_open, holiday)


async def _cached(
    symbol_key: str,
    loader,
    *,
    ttl_open: float | None = None,
    ttl_closed: float | None = None,
    bypass: bool = False,
    session_state: str | None = None,
):
    """Single-flight: concurrent tabs on one symbol cost one upstream fetch.

    ``ttl_open``/``ttl_closed`` let a quote-level payload (the option chain) use
    a seconds-scale window while the contract listing keeps its minutes-scale
    one, without a second cache. ``bypass`` re-fetches and replaces the entry —
    the manual-refresh path. ``session_state`` is an already-computed value the
    caller needed for its key; passing it saves a second holiday query.
    """
    lock = _locks.setdefault(symbol_key, asyncio.Lock())
    prune_locks(_locks, _CACHE_MAX, keep=(symbol_key,))
    try:
        async with lock:
            entry = _cache.get(symbol_key)
            if not bypass and entry and time.monotonic() - entry["ts"] < entry["ttl"]:
                return entry["data"]
            data = await loader()
            state = session_state or await _session_state_now()
            _cache[symbol_key] = {
                "ts": time.monotonic(),
                "ttl": (
                    (ttl_open if ttl_open is not None else CACHE_TTL_OPEN_SEC)
                    if state == "open"
                    else (ttl_closed if ttl_closed is not None else CACHE_TTL_CLOSED_SEC)
                ),
                "data": data,
            }
            return data
    finally:
        # The guard just went idle; collect stale idle locks on every path.
        # Keep the current key: another tab may already be waiting on it.
        prune_locks(_locks, _CACHE_MAX, keep=(symbol_key,))


def clear_underlying_cache() -> None:
    """Drop every cached listing (tests / after a broker reconnect)."""
    _cache.clear()


@router.get(
    "/underlying/{symbol}",
    response_model=UnderlyingInfo,
    summary="Underlying metadata for the option chain (expiries, lots, default expiry)",
)
async def get_underlying_info(symbol: str, user: User = Depends(get_current_user)):
    """Instrument key, F&O eligibility, real expiries and the expiry to open on.

    ``default_expiry`` is the first expiry on or after today, except on expiry
    day after 15:40 IST where it rolls to the next one (today stays listed).

    ``quotes_live`` is true only while the F&O session is ``open``; pre-open and
    closed chains carry the previous session's LTPs.
    """
    up = str(symbol or "").strip().upper()
    if not up:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_fno", "detail": "Unknown underlying: empty symbol"},
        )

    instrument_key, exchange = await asyncio.to_thread(_resolve_instrument, up)

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

    data = await _cached(up, _load)

    # Session fields come from the clock *after* the fetch: a request that
    # straddles 15:40 must roll its default expiry, not replay the pre-close
    # answer from a cache entry written seconds earlier.
    now = _now()
    cash_open, holiday = await asyncio.to_thread(_session_flags, now)

    return _shape(
        symbol=up,
        exchange=data["exchange"],
        instrument_key=data["instrument_key"],
        fno=data["fno"],
        spot=data["spot"],
        listing=data["listing"],
        now=now,
        cash_open=cash_open,
        holiday=holiday,
    )

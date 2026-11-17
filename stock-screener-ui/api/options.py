"""
Options API - FastAPI endpoints for options trading

Provides secure proxy to Upstox Options API with caching and error handling.
Includes server-side quantitative analysis (Expected Move, Max Pain, Sentiment).
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import asyncio
import logging
import httpx
import os
import json
import math
import time
from datetime import datetime
from pathlib import Path

import config
from api._bounded_cache import BoundedTTLCache
from api.fyers_options import resolve_fyers_option_symbol
from api.options_snapshots import mark_captured, record_chain_snapshot, should_capture
from api.positioning import compute_positioning
from api.options_underlying import INDEX_ALIASES, INDEX_CONTRACT_META
from api.options_conventions import IV_MAX

router = APIRouter(prefix="/api/options", tags=["options"])

UPSTOX_BASE = "https://api.upstox.com/v2"
# Must match api/brokers.py (the OAuth writer), which uses config.BASE_DIR. This
# previously used a hand-counted chain of `.parent`s that resolved to
# /home/mysyntax/Documents, so this reader picked up a stale .upstox_token.json
# living OUTSIDE the repo. The reader and the writer never agreed, so a missing
# DB connection silently fell back to a months-old token instead of reporting
# "not connected".
PROJECT_ROOT = Path(config.BASE_DIR)


class OptionGreeks(BaseModel):
    delta: float
    gamma: float
    vega: float
    theta: float
    iv: float
    pop: float = 0.0


class MarketData(BaseModel):
    ltp: float
    volume: int
    oi: int
    bid_price: float
    ask_price: float
    prev_oi: int
    close_price: float = 0.0
    bid_qty: int = 0
    ask_qty: int = 0


class OptionContract(BaseModel):
    instrument_key: str
    trading_symbol: str
    strike_price: float
    expiry: str
    instrument_type: str
    lot_size: int
    tick_size: float
    weekly: bool
    market_data: Optional[MarketData] = None
    option_greeks: Optional[OptionGreeks] = None
    sentiment: Optional[Dict[str, str]] = None


# --- Quantitative Utilities ---

def get_option_sentiment(price_change: float, oi_change: int) -> Dict[str, str]:
    """Interpret market sentiment based on price and OI changes."""
    if abs(oi_change) < 100:
        return {"type": "Neutral", "color": "gray", "label": "Neutral"}

    if price_change > 0 and oi_change > 0:
        return {"type": "Long Buildup", "color": "green", "label": "LB"}
    elif price_change < 0 and oi_change > 0:
        return {"type": "Short Buildup", "color": "red", "label": "SB"}
    elif price_change > 0 and oi_change < 0:
        return {"type": "Short Covering", "color": "cyan", "label": "SC"}
    elif price_change < 0 and oi_change < 0:
        return {"type": "Long Unwinding", "color": "orange", "label": "LU"}
    
    return {"type": "Neutral", "color": "gray", "label": "Neutral"}


def calculate_expected_move(spot: float, iv: float, dte: int) -> Optional[Dict[str, float]]:
    """Calculate 1-Standard Deviation expected move based on IV.

    ``None`` when there is no spot or no IV - the caller must not read a
    0.0 expected move out of "unknown".
    """
    if spot <= 0 or iv <= 0:
        return None
    
    annual_iv = iv / 100
    time_factor = math.sqrt(max(dte, 1) / 365)
    move = spot * annual_iv * time_factor
    
    return {
        "upper": round(spot + move, 2),
        "lower": round(spot - move, 2),
        "range": round(move, 2)
    }


def calculate_max_pain(strike_matrix: List[Dict[str, Any]]) -> float:
    """Calculate Max Pain strike (level where option writers lose the least)."""
    if not strike_matrix:
        return 0
    
    min_loss = float('inf')
    max_pain_strike = 0
    
    # We'll test strikes within a reasonable range near spot
    strikes = [row["strike"] for row in strike_matrix]
    
    for test_strike in strikes:
        current_loss = 0
        for row in strike_matrix:
            strike = row["strike"]
            ce_oi = row.get("ce", {}).get("market_data", {}).get("oi", 0) if row.get("ce") else 0
            pe_oi = row.get("pe", {}).get("market_data", {}).get("oi", 0) if row.get("pe") else 0
            
            if test_strike > strike:
                current_loss += (test_strike - strike) * ce_oi
            if test_strike < strike:
                current_loss += (strike - test_strike) * pe_oi
                
        if current_loss < min_loss:
            min_loss = current_loss
            max_pain_strike = test_strike
            
    return max_pain_strike


# Derived from the single index registry so symbols, instrument keys and
# lot/tick sizes cannot drift between the two tables (name/lot/tick live in
# options_underlying.INDEX_CONTRACT_META; keys/exchange in INDEX_ALIASES).
AVAILABLE_UNDERLYINGS = [
    {
        "symbol": symbol,
        "name": INDEX_CONTRACT_META[symbol]["name"],
        "instrument_key": INDEX_ALIASES[symbol][0],
        "lot_size": INDEX_CONTRACT_META[symbol]["lot_size"],
        "tick_size": INDEX_CONTRACT_META[symbol]["tick_size"],
    }
    for symbol in INDEX_ALIASES
]


def get_instrument_key(underlying: str) -> str:
    up = str(underlying or "").upper()
    for u in AVAILABLE_UNDERLYINGS:
        if u["symbol"] == up:
            return u["instrument_key"]
    # F&O stocks: the option chain takes the UNDERLYING equity key
    # (NSE_EQ|ISIN), not a synthetic NSE_INDEX|RELIANCE.
    stock = _stock_instrument_map().get(up)
    if stock:
        return stock
    return f"NSE_INDEX|{underlying}"


#: ``trading_symbol``/company name -> NSE_EQ instrument key. Lazy, 1h TTL.
_STOCK_MAP: dict = {"ts": 0.0, "map": {}}


def _stock_instrument_map() -> dict:
    now = time.monotonic()
    if _STOCK_MAP["map"] and now - _STOCK_MAP["ts"] < 3600:
        return _STOCK_MAP["map"]
    path = PROJECT_ROOT.parent / "upstox_trader" / "config_and_utils" / "nse_instruments.json"
    mapping: dict[str, str] = {}
    try:
        if path.exists():
            with open(path) as fh:
                data = json.load(fh)
            for item in data:
                if item.get("segment") != "NSE_EQ" or item.get("instrument_type") != "EQ":
                    continue
                key = item.get("instrument_key")
                if not key:
                    continue
                sym = str(item.get("trading_symbol") or "").upper()
                if sym:
                    mapping[sym] = key
                name = str(item.get("name") or "").upper()
                if name:
                    mapping.setdefault(name, key)
    except Exception:
        return _STOCK_MAP["map"]
    _STOCK_MAP["map"] = mapping
    _STOCK_MAP["ts"] = now
    return mapping


#: Token lookups are a synchronous SQLite round-trip. One Nifty tape tick used
#: to make 13 of them (chain, expiries, spot, Sensex, VIX, pivots, ...), and
#: every one of those blocked the event loop for the duration of the query.
#: Under write contention that is 5s per lookup (SQLAlchemy's SQLite
#: ``busy_timeout``) — measured as the repeated /api/health timeouts. The
#: token only changes on OAuth reconnect, so a short TTL is safe and keeps a
#: reconnect visible within seconds. Resolution now lives in
#: :mod:`api.upstox_token` (DB -> token file; no env fallback).
_TOKEN_TTL_SEC = 30.0


def clear_upstox_token_cache() -> None:
    """Drop the cached token (call after an OAuth connect/disconnect)."""
    from api.upstox_token import clear_upstox_token_cache as _clear

    _clear()
    # A chain fetched with the old token belongs to the old connection; a
    # reconnect is exactly when the operator expects fresh quotes.
    clear_option_chain_cache()
    # The chain is not the only derived cache built from the old token's
    # spot/IV: analytics payloads, the analytics RV cone and the RV daily-close
    # series all outlive the chain's short TTL (45-900s). A reconnect must drop
    # every one of them or it serves stale spot/IV until those TTLs lapse.
    # Imports stay local: both modules reach back into api.options, so a
    # module-level import here would close an import cycle.
    from api.options_analytics import clear_analytics_cache
    from api.options_rv import clear_rv_cache

    clear_analytics_cache()  # analytics payloads + the analytics cone cache
    clear_rv_cache()         # the provider daily-close series cache


def get_upstox_token() -> str:
    """Get Upstox access token from DB or token file (30s in-process cache).

    Resolution order: DB (OAuth) -> token file. Environment variable
    fallback is intentionally not used so that disconnect properly clears
    the connection state. Tokens should be managed via the OAuth flow
    (stored in DB). Raises HTTPException(401) when no token is configured.
    """
    from api.upstox_token import require_upstox_token

    return require_upstox_token(use_env=False, cache_ttl=_TOKEN_TTL_SEC)


#: Hard ceiling for a single Upstox REST call. The chain/contract endpoints
#: normally answer in 0.1-0.5s; anything near this means the upstream (or the
#: network) is wedged and the tick must move on instead of stalling the loop.
UPSTOX_TIMEOUT_SEC = 12.0


async def fetch_upstox(endpoint: str, params: Optional[dict] = None) -> dict:
    # The token comes from SQLite. A cache hit is cheap, but a miss (or the
    # 30s refresh) is a synchronous query that must never run on the event
    # loop — under write contention that was a 5s freeze per call.
    from api.options import get_upstox_token as _get_token
    token = await asyncio.to_thread(_get_token)
    url = f"{UPSTOX_BASE}{endpoint}"

    # Two layers on purpose:
    #  - httpx's timeout bounds connect/read per phase;
    #  - ``asyncio.wait_for`` bounds the WHOLE call (DNS + pool + retries), so
    #    a wedged connection can never outlive the caller's budget.
    # The synchronous token lookup is pushed to a thread: it is a SQLite query
    # and must never run on the event loop.
    timeout = httpx.Timeout(UPSTOX_TIMEOUT_SEC, connect=5.0)

    async def _get() -> dict:
        async with httpx.AsyncClient(timeout=timeout) as client:
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            }
            response = await client.get(url, headers=headers, params=params or {})

            if response.status_code == 401:
                raise HTTPException(status_code=401, detail="Upstox token expired or invalid")
            elif response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Upstox API error: {response.text}"
                )

            return response.json()

    try:
        return await asyncio.wait_for(_get(), timeout=UPSTOX_TIMEOUT_SEC + 1.0)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Upstox {endpoint} timed out after {UPSTOX_TIMEOUT_SEC:.0f}s",
        )


@router.get("/health")
async def options_health():
    """Health check for options API."""
    return {"status": "ok", "service": "options-api"}


@router.get("/underlyings")
async def get_underlyings():
    """Get list of available underlying instruments for options trading."""
    return {"underlyings": AVAILABLE_UNDERLYINGS}


#: A real ``/option/contract`` listing only changes when the exchange rolls an
#: expiry, so it is cached for a few minutes. The previous implementation made
#: this call on EVERY report build (and again for Sensex) and, on any failure,
#: silently invented "next Thursday" dates. Those synthetic expiries do not
#: exist upstream: ``/option/chain`` answers ``status:success, data:[]`` for
#: them, which is exactly how an empty chain (strikes=[], net_gex=0,
#: regime="flat", max_pain=0) got persisted to the snapshot log.
_EXPIRIES_TTL_SEC = 300.0
#: Public route keyed by a caller-supplied underlying; bound it and sweep stale
#: listings so repeated symbol keys cannot grow the cache without limit.
_EXPIRIES_CACHE_MAX = 512
_expiries_cache = BoundedTTLCache(_EXPIRIES_CACHE_MAX, ttl_getter=_EXPIRIES_TTL_SEC)


@router.get("/expiries/{underlying}")
async def get_expiries(underlying: str):
    """Get available expiry dates for an underlying instrument.

    Returns ``{"underlying", "expiries"}`` with the real exchange listing,
    cached for ``_EXPIRIES_TTL_SEC``. A failure returns the last good listing
    (stale but real) and never fabricates dates — a synthetic expiry makes the
    option chain come back empty, which callers cannot distinguish from a
    genuinely empty market.
    """
    now = time.monotonic()
    cached = _expiries_cache.get(underlying)
    if cached and now - cached["ts"] < _EXPIRIES_TTL_SEC:
        return {"underlying": underlying, "expiries": cached["expiries"]}

    today = datetime.now(config.IST)
    expiries = []

    try:
        instrument_key = get_instrument_key(underlying)
        data = await fetch_upstox("/option/contract", {"instrument_key": instrument_key})

        if data.get("status") == "success" and data.get("data"):
            seen_dates = set()
            for contract in data["data"]:
                expiry_str = contract.get("expiry")
                if expiry_str and expiry_str not in seen_dates:
                    seen_dates.add(expiry_str)
                    # Calendar days via date arithmetic: subtracting a tz-aware
                    # `today` from a midnight expiry truncates the partial day
                    # (3 instead of 4), and a naive expiry would raise TypeError.
                    expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
                    days = (expiry_date - today.date()).days
                    if days >= 0:
                        expiries.append({
                            "date": expiry_str,
                            "weekly": contract.get("weekly", False),
                            "days_to_expiry": days
                        })

            expiries.sort(key=lambda x: x["date"])
    except Exception:
        expiries = []

    if expiries:
        _expiries_cache[underlying] = {"ts": now, "expiries": expiries}
        return {"underlying": underlying, "expiries": expiries}

    # Upstream failed/empty: serve the last real listing when we have one.
    # Never invent a date — an invented expiry yields an empty chain.
    if cached:
        return {"underlying": underlying, "expiries": cached["expiries"]}

    return {"underlying": underlying, "expiries": []}


@router.get("/fyers-symbol")
async def get_fyers_symbol(
    underlying: str = Query(..., description="Underlying symbol, e.g. NIFTY"),
    expiry: str = Query(..., description="Expiry date in YYYY-MM-DD format"),
    strike: float = Query(..., description="Strike price"),
    option_type: str = Query(..., description="CE or PE"),
):
    """Resolve the Fyers-native contract symbol for an option leg.

    The option chain served here is Upstox-native (``NSE_FO|...`` keys) which
    the Fyers feeds cannot resolve, so Order Flow Options mode asks for the
    Fyers symbol (``NSE:NIFTY26SEP23400CE``) before subscribing. Returns
    ``{"symbol", "fyToken", "oi", "oich"}`` or 404 when the contract is not
    on the Fyers chain. Never changes the ``/chain`` response shape.
    """
    result = await asyncio.to_thread(
        resolve_fyers_option_symbol, underlying, expiry, strike, option_type
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No Fyers contract for {underlying} {strike:g} "
                f"{(option_type or '').upper()} @ {expiry}"
            ),
        )
    return result


def _num(value: Any, default: float = 0.0) -> float:
    """``float(value)`` or ``default`` — upstream may send ``None``/garbage."""
    if value is None or isinstance(value, bool):
        return default
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def transform_option_contract(option_data: dict, strike: float, option_type: str) -> Optional[dict]:
    """Transform Upstox option data to flat contract structure with sentiment."""
    if not option_data:
        return None

    market_data = option_data.get("market_data") or {}
    greeks = option_data.get("option_greeks") or {}

    ltp = _num(market_data.get("ltp"))
    oi = _num(market_data.get("oi"))
    prev_oi = _num(market_data.get("prev_oi"))
    bid = _num(market_data.get("bid_price"))
    close_price = _num(market_data.get("close_price"))

    oi_change = int(oi - prev_oi)
    # Price change is measured against the PREVIOUS CLOSE, not the bid.
    # ``ltp - bid`` is the bid-ask spread (>= 0 almost always), so the Short
    # Buildup / Long Unwinding quadrants could never fire and every leg read
    # as Long Buildup or Short Covering. The Nifty report
    # (``reports_api/nifty.build_leg``) has always used ``ltp - close_price``;
    # this keeps both paths on ONE convention. With no previous close the
    # direction is unknown, so the old bid-relative read is kept rather than
    # inventing one.
    price_change = (ltp - close_price) if close_price else (ltp - bid)

    sentiment = get_option_sentiment(price_change, oi_change)

    # Upstox sometimes sends a non-finite/absurd IV (117) with a tradable LTP,
    # and omits it entirely on other legs. Keep the raw value for display, but
    # publish a validity flag so consumers never chart or annualise a bad IV.
    # The 100-point cap is shared with analytics (api.options_conventions);
    # a 60-point cap silently invalidated genuine 79-83 prints on high-vol stocks.
    raw_iv = greeks.get("iv")
    try:
        iv_number = float(raw_iv)
        iv_valid = math.isfinite(iv_number) and 0 < iv_number <= IV_MAX
    except (TypeError, ValueError):
        iv_valid = False

    return {
        "instrument_key": option_data.get("instrument_key", ""),
        "trading_symbol": option_data.get("trading_symbol", ""),
        "strike_price": strike,
        "expiry": option_data.get("expiry", ""),
        "instrument_type": option_type,
        "market_data": {
            "ltp": market_data.get("ltp", 0),
            "volume": market_data.get("volume", 0),
            "oi": market_data.get("oi", 0),
            "bid_price": market_data.get("bid_price", 0),
            "ask_price": market_data.get("ask_price", 0),
            "prev_oi": market_data.get("prev_oi", 0),
            "close_price": market_data.get("close_price", 0),
            "bid_qty": market_data.get("bid_qty", 0),
            "ask_qty": market_data.get("ask_qty", 0),
        },
        "iv_valid": iv_valid,
        "option_greeks": {
            "delta": greeks.get("delta", 0),
            "gamma": greeks.get("gamma", 0),
            "vega": greeks.get("vega", 0),
            "theta": greeks.get("theta", 0),
            "iv": greeks.get("iv", 0),
            "iv_valid": iv_valid,
            "pop": greeks.get("pop", 0),
        } if greeks else None,
        "sentiment": sentiment
    }


async def _fetch_chain_rows(underlying: str, expiry: str):
    """Fetch Upstox chain and return (rows, spot).

    Shared by /chain and /positioning so both see identical rows/spot.
    """
    instrument_key = get_instrument_key(underlying)
    data = await fetch_upstox("/option/chain", {
        "instrument_key": instrument_key,
        "expiry_date": expiry
    })

    contracts = data.get("data", [])
    # Reliability fix: Fallback for spot price
    spot_price = data.get("underlying_spot_price", 0)
    if not spot_price:
        spot_price = contracts[0].get("underlying_spot_price", 0) if contracts else 0

    # Third-level fallback: Fetch from OHLC if still 0
    if not spot_price:
        try:
            spot_data = await get_spot_price(underlying)
            spot_price = spot_data.get("spot", 0)
        except Exception:
            pass

    strike_map = {}
    for item in contracts:
        strike = item.get("strike_price")
        if strike not in strike_map:
            strike_map[strike] = {"strike": strike, "ce": None, "pe": None, "pcr": item.get("pcr")}

        if item.get("call_options"):
            # Reliability fix: some fields might be at parent level in some API versions
            call_data = item["call_options"]
            if not call_data.get("trading_symbol"):
                call_data["trading_symbol"] = f"{underlying}{expiry.replace('-','')}{strike}CE"
            if not call_data.get("expiry"):
                call_data["expiry"] = expiry

            ce_contract = transform_option_contract(call_data, strike, "CE")
            strike_map[strike]["ce"] = ce_contract

        if item.get("put_options"):
            put_data = item["put_options"]
            if not put_data.get("trading_symbol"):
                put_data["trading_symbol"] = f"{underlying}{expiry.replace('-','')}{strike}PE"
            if not put_data.get("expiry"):
                put_data["expiry"] = expiry

            pe_contract = transform_option_contract(put_data, strike, "PE")
            strike_map[strike]["pe"] = pe_contract

    chain = sorted(strike_map.values(), key=lambda x: x["strike"])
    return chain, spot_price


def _validate_expiry(expiry: str) -> str:
    """``YYYY-MM-DD`` or a 400 — a malformed expiry must not reach Upstox
    (it used to come back as a 500 from ``strptime`` deep inside the route)."""
    text = str(expiry or "").strip()
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=f"bad expiry: {expiry!r}, want YYYY-MM-DD",
        )
    # Canonical ISO: Upstox is given "2026-03-07", never "2026-3-7".
    return parsed.strftime("%Y-%m-%d")


#: The chain is a quote-level payload with two consumers: the dock (15s poll)
#: and the options recorder, which writes a 10s chain series. The window must
#: stay below the recorder's cadence or it would duplicate a tick, so 5s — long
#: enough to collapse concurrent tabs, an expiry switch and the report route onto
#: one upstream call, and well inside the UI's 30s STALE threshold
#: (``CHAIN_STALE_AFTER_MS``). Closed, nothing changes until the next session, so
#: the window is wider — but not hours, so a reconnect still surfaces the last
#: prints promptly.
CHAIN_TTL_OPEN_SEC = 5.0
CHAIN_TTL_CLOSED_SEC = 60.0

#: Every key the chain cache owns; keeps ``clear_option_chain_cache`` from
#: touching the contract-listing entries that share the same store.
_CHAIN_KEY_PREFIX = "option-chain:"


def _chain_cache_key(underlying: str, expiry: str, session_state: str) -> str:
    """Session state belongs in the key: a chain fetched while open carries
    live LTPs and live greeks, one fetched after the close carries the last
    session's prints. Replaying the former after the close would mislabel it.
    """
    return f"{_CHAIN_KEY_PREFIX}{underlying.strip().upper()}:{expiry}:{session_state}"


def clear_option_chain_cache() -> None:
    """Drop cached chains only (tests / after a broker reconnect)."""
    from api.options_underlying import _cache

    _cache.pop_where(lambda k: k.startswith(_CHAIN_KEY_PREFIX))


def _chain_now() -> datetime:
    """IST clock for the chain's freshness fields.

    Delegates to the same (test-freezable) clock the cache key's session state
    uses, so a cached frame's freshness fields always agree with the session it
    was fetched under.
    """
    from api.options_underlying import _now

    return _now()


def _prints_session_date(now: datetime, market_state: str) -> str:
    """IST date of the session the chain's prints belong to.

    Live prints belong to the current session; pre-open and closed chains carry
    the last completed session's prints (Friday on a weekend, the previous
    trading day on a holiday).
    """
    if market_state == "open":
        return now.date().isoformat()
    from chart_patterns.candles import _last_completed_session

    return _last_completed_session(now).isoformat()


async def _build_chain_response(underlying: str, expiry: str, market_state: str) -> dict:
    """Upstream rows + the derived analytics, as the route returns them.

    Cached whole (not just the rows) so the analysis is not recomputed on every
    poll, ``levels`` travel inside the frame, and ``timestamp``/``data_as_of``
    describe the fetch, not the time a later hit was served.
    """
    chain, spot_price = await _fetch_chain_rows(underlying, expiry)

    from api.options_levels import build_levels

    levels = build_levels(chain, spot_price)

    total_ce_oi = 0
    total_pe_oi = 0
    atm_iv = 0
    closest_strike_diff = float('inf')

    for row in chain:
        strike = row["strike"]
        ce_contract = row.get("ce")
        if ce_contract:
            total_ce_oi += ce_contract["market_data"]["oi"]

            # Check for ATM IV
            diff = abs(strike - spot_price)
            if diff < closest_strike_diff:
                iv = ce_contract["option_greeks"]["iv"] if ce_contract.get("option_greeks") else 0
                if iv > 0:
                    closest_strike_diff = diff
                    atm_iv = iv

        pe_contract = row.get("pe")
        if pe_contract:
            total_pe_oi += pe_contract["market_data"]["oi"]

            # Check for ATM IV (only if CE didn't give us a better one)
            diff = abs(strike - spot_price)
            if diff < closest_strike_diff:
                iv = pe_contract["option_greeks"]["iv"] if pe_contract.get("option_greeks") else 0
                if iv > 0:
                    closest_strike_diff = diff
                    atm_iv = iv

    # Calculate DS Summary
    expiry_date = datetime.strptime(expiry, "%Y-%m-%d").replace(tzinfo=config.IST)
    dte = (expiry_date - datetime.now(config.IST)).days + 1

    expected_move = calculate_expected_move(spot_price, atm_iv, dte)
    # Legacy contract: summary.max_pain stays a bare number (0 when absent) so
    # existing consumers do not break, but the authoritative level is levels.
    pain = levels.get("max_pain")
    max_pain = pain["strike"] if pain else 0
    pcr = total_pe_oi / total_ce_oi if total_ce_oi > 0 else 0

    now = _chain_now()
    quotes_live = market_state == "open"
    session_date = _prints_session_date(now, market_state)
    data_as_of = (
        now.isoformat() if quotes_live else
        f"{session_date} — last completed session; quotes are not live "
        f"(market_state={market_state})"
    )

    return {
        "status": "ok",
        "underlying": underlying,
        "expiry": expiry,
        "spot": spot_price,
        "timestamp": now.isoformat(),
        "market_state": market_state,
        "quotes_live": quotes_live,
        "session_date": session_date,
        "data_as_of": data_as_of,
        "levels": levels,
        "chain": chain,
        "summary": {
            "pcr": round(pcr, 2),
            "max_pain": max_pain,
            "expected_move": expected_move,
            "total_ce_oi": total_ce_oi,
            "total_pe_oi": total_pe_oi,
            "dte": dte,
            "atm_iv": atm_iv
        }
    }


#: Process-local capture throttle. The chain cache serves the same payload for
#: seconds, so without a per-minute (or per-session) key every poll would
#: schedule a redundant write. The DB's natural key makes a duplicate harmless;
#: this map exists to avoid the write, not to guarantee correctness.
_snapshot_last: dict = {}
_SNAPSHOT_LOG = logging.getLogger(__name__)


def _write_snapshot_safely(payload: dict) -> None:
    """Background writer: a DB failure must never reach the HTTP response.

    Starlette runs this sync callable in a threadpool after the response has
    been sent, so neither the SQLite write nor its latency is on the request
    path.
    """
    try:
        record_chain_snapshot(payload)
    except Exception:
        _SNAPSHOT_LOG.warning("option chain snapshot write failed", exc_info=True)


def _queue_snapshot(payload: Any, background_tasks: Optional[BackgroundTasks]) -> None:
    """Throttle and schedule one fire-and-forget snapshot for a fresh chain."""
    # Direct coroutine calls (tests, in-process callers) have no request scope.
    if background_tasks is None:
        return
    try:
        if should_capture(payload, _snapshot_last):
            mark_captured(payload, _snapshot_last)
            background_tasks.add_task(_write_snapshot_safely, payload)
    except Exception:
        _SNAPSHOT_LOG.warning("option chain snapshot scheduling failed", exc_info=True)


@router.get("/chain/{underlying}")
async def get_option_chain(
    underlying: str,
    expiry: str = Query(..., description="Expiry date in YYYY-MM-DD format"),
    refresh: bool = Query(False, description="Bypass the short-TTL chain cache"),
    background_tasks: BackgroundTasks = None,
):
    """Get complete option chain with server-side analysis.

    Served from a single-flight short-TTL cache keyed on underlying + expiry +
    session state. Upstream failures are never cached — the loader raises before
    anything is written, so a 401/429 is retried on the next request.

    A cache hit returns the cached ``timestamp``, not a refreshed one: the field
    describes when the quotes were actually read, and the UI's LIVE/STALE badge
    derives from it. Restamping a served-stale chain would claim a freshness the
    prices do not have.
    """
    expiry = _validate_expiry(expiry)
    # Canonical case here, not only in the key: the payload echoes the symbol,
    # so a lowercase request served from an uppercase entry (or vice versa)
    # would report a different ``underlying`` than the one it was cached under.
    symbol = str(underlying or "").strip().upper()
    # options_underlying owns the chain cache and session clock; these private
    # helpers are pulled in at call time, like the other late imports here.
    from api.options_underlying import _cached, _session_state_now

    # A direct call (tests, in-process callers) skips FastAPI's dependency
    # resolution, so ``refresh`` can still be the ``Query`` default object.
    bypass = refresh is True

    session_state = await _session_state_now()
    try:
        payload = await _cached(
            _chain_cache_key(symbol, expiry, session_state),
            lambda: _build_chain_response(symbol, expiry, session_state),
            ttl_open=CHAIN_TTL_OPEN_SEC,
            ttl_closed=CHAIN_TTL_CLOSED_SEC,
            bypass=bypass,
            session_state=session_state,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch option chain: {str(e)}")

    # Fire-and-forget: the response and its cache entry are already decided.
    # Errors here (throttle or writer) are swallowed inside the helpers.
    _queue_snapshot(payload, background_tasks)
    return payload


@router.get("/positioning/{underlying}")
async def get_positioning(
    underlying: str,
    expiry: str = Query(..., description="Expiry date in YYYY-MM-DD format"),
    mode: str = Query("since_open", description="Baseline mode (v1: only 'since_open')"),
):
    """Delta-weighted positioning: who initiated today (writers vs buyers).

    v1 note: ``mode`` is echoed back but does not change the numbers —
    Upstox ``prev_oi`` is the prior-session close OI, so "since open"
    ≈ "vs prev close". A second baseline mode may arrive in v2.
    """
    expiry = _validate_expiry(expiry)
    try:
        chain, spot_price = await _fetch_chain_rows(underlying, expiry)
        lot_size = next(
            (u["lot_size"] for u in AVAILABLE_UNDERLYINGS if u["symbol"] == underlying),
            1,
        )
        pos = compute_positioning(chain, spot_price, lot_size)
        return {
            "status": "ok",
            "underlying": underlying,
            "expiry": expiry,
            "mode": mode,
            "spot": spot_price,
            "lot_size": lot_size,
            "timestamp": datetime.now(config.IST).isoformat(),
            "baseline": "prev_close_oi",
            "baseline_note": "Upstox prev_oi is prior-session close OI; 'since open' ≈ 'vs prev close'.",
            **pos,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch positioning: {str(e)}")


def _fetch_spot_history_sync(underlying: str):
    """Synchronous helper for fetching spot history via yfinance."""
    import yfinance as yf

    symbol_map = {
        "NIFTY": "^NSEI",
        "BANKNIFTY": "^NSEBANK",
        "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
        "MIDCPNIFTY": "^NSEMDCP50"
    }

    yf_symbol = symbol_map.get(underlying, f"{underlying}.NS")

    ticker = yf.Ticker(yf_symbol)
    hist = ticker.history(period="1d", interval="5m")

    if hist.empty:
        return {"status": "error", "message": "No history found"}

    candles = [{"time": ts.isoformat(), "price": round(float(row["Close"]), 2)}
               for ts, row in hist.iterrows()]

    return {
        "status": "ok",
        "underlying": underlying,
        "history": candles[-50:]
    }


@router.get("/spot-history/{underlying}")
async def get_spot_history(underlying: str):
    """Get intraday historical spot price for charting."""
    try:
        return await asyncio.to_thread(_fetch_spot_history_sync, underlying)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {str(e)}")


@router.get("/positions")
async def get_option_positions():
    """Get user's open option positions from portfolio."""
    try:
        data = await fetch_upstox("/portfolio/short-term-positions")
        positions = data.get("data", [])
        option_positions = [p for p in positions if p.get("instrument_type") in ["CE", "PE"]]
        return {"status": "ok", "positions": option_positions}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch positions: {str(e)}")


@router.get("/spot/{underlying}")
async def get_spot_price(underlying: str):
    """Get current spot price for underlying."""
    instrument_key = get_instrument_key(underlying)
    try:
        data = await fetch_upstox("/market-quote/ohlc", {"instrument_key": instrument_key, "interval": "1d"})
        spot = 0
        if data.get("status") == "success" and data.get("data"):
            key = list(data["data"].keys())[0]
            spot = data["data"][key].get("last_price", 0)
        
        return {"status": "ok", "underlying": underlying, "spot": spot}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch spot: {str(e)}")

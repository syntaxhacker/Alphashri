"""Premium candles for a single option contract.

The option chain publishes a contract's ``instrument_key``; a contract chart
needs that contract's own minute bars, and Upstox exposes candles per instrument
rather than per underlying. Only traded minutes exist in the series, so a
contract that has not printed yet answers an empty list — that is a valid
answer (``empty_reason: "no_trades"``), not an error.

Two upstream calls feed one response: ``/historical-candle/intraday/...`` for
the running session and ``/historical-candle/...`` for the preceding sessions.
The responses are newest-first and overlap on the current session, so bars are
deduplicated by timestamp and sorted ascending before they leave this module.
A failure on either call fails the request: a half-merged series would silently
mislead the chart.
"""

import asyncio
import logging
import math
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Optional, Union
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

import config
from api._bounded_cache import BoundedTTLCache, prune_locks
from api.options import get_upstox_token
from trading.utils import is_market_open

router = APIRouter(prefix="/api/options", tags=["options"])
log = logging.getLogger(__name__)

#: V3 is where the minute-candle endpoints live; ``api.options`` owns the v2
#: base used by the chain, so this module cannot borrow that constant.
UPSTOX_V3_BASE = "https://api.upstox.com/v3"

UPSTOX_TIMEOUT_SEC = 12.0
UPSTREAM_429_RETRY_AFTER_SEC = 5

INTERVAL_UNITS: dict[str, str] = {"1m": "1", "5m": "5", "15m": "15"}
DEFAULT_INTERVAL = "1m"
DEFAULT_DAYS = 2
MIN_DAYS = 1
MAX_DAYS = 3

#: One calendar week comfortably covers ``days - 1`` prior sessions even across
#: a long weekend plus a trading holiday; the merge trims to the requested
#: session count, so the wider window costs no extra request.
HISTORY_LOOKBACK_DAYS = 7

#: Contract keys are exchange-scoped: only an NSE F&O key is a listed contract,
#: and anything else (index keys, equities, path characters) is a caller error.
INSTRUMENT_KEY_PATTERN = re.compile(r"^NSE_FO\|[A-Za-z0-9]+$")

AUTH_REQUIRED_DETAIL = "upstox_auth_required"
UNAVAILABLE_DETAIL = "options_contract_chart_unavailable"
TIMEOUT_DETAIL = "options_contract_chart_timeout"
RATE_LIMITED_DETAIL = "upstox_rate_limited"

INVALID_INSTRUMENT_KEY_DETAIL = "invalid_instrument_key"
INVALID_INTERVAL_DETAIL = "invalid_interval"
INVALID_DAYS_DETAIL = "invalid_days"

CACHE_TTL_OPEN_SEC = 30.0
CACHE_TTL_CLOSED_SEC = 300.0
CACHE_MAX = 512


class ContractCandle(BaseModel):
    t: str = Field(description="Bar open time, IST ISO-8601.")
    o: float
    h: float
    l: float
    c: float
    v: Union[int, float] = Field(default=0, description="Traded quantity in the minute.")
    oi: Optional[Union[int, float]] = Field(default=None, description="Open interest after the bar.")


class ContractChartResponse(BaseModel):
    instrument_key: str
    interval: str
    candles: list[ContractCandle] = Field(default_factory=list)
    source: str = "upstox"
    cached: bool = False
    empty_reason: Optional[str] = Field(
        default=None,
        description="`no_trades` when the contract simply has no prints in the window.",
    )


def _now() -> datetime:
    """IST now — module-level so tests can freeze the session clock."""
    return datetime.now(config.IST)


def _session_open() -> bool:
    return is_market_open(_now())


_locks: dict[tuple[str, str, str], asyncio.Lock] = {}
_locks_guard = threading.Lock()


def _drop_lock(key: tuple[str, str, str]) -> None:
    """Release the guard for a cache key that was evicted/cleared."""
    lock = _locks.get(key)
    if lock is not None and not lock.locked():
        _locks.pop(key, None)


_cache = BoundedTTLCache(
    CACHE_MAX,
    ttl_getter=lambda value: value["ttl"],
    on_evict=_drop_lock,
)


def _lock_for(key: tuple[str, str, str]) -> asyncio.Lock:
    with _locks_guard:
        lock = _locks.setdefault(key, asyncio.Lock())
        prune_locks(_locks, CACHE_MAX, keep=(key,))
        return lock


def _number(value: Any) -> Optional[Union[int, float]]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def _parse_candle(row: Any) -> Optional[tuple[datetime, str, dict]]:
    """``(bar time, session date, wire candle)`` or ``None`` for a bad row.

    Upstox sends ``[ts, o, h, l, c, volume, oi]``; volume/OI are optional so a
    provider change drops one field instead of the whole series.
    """
    if not isinstance(row, (list, tuple)) or len(row) < 5:
        return None
    try:
        ts = datetime.fromisoformat(str(row[0]))
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=config.IST)
    ts = ts.astimezone(config.IST)

    try:
        o, h, l, c = (float(row[i]) for i in range(1, 5))
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (o, h, l, c)):
        return None

    volume = _number(row[5]) if len(row) > 5 else 0
    oi = _number(row[6]) if len(row) > 6 else None
    return ts, ts.date().isoformat(), {
        "t": ts.isoformat(),
        "o": o,
        "h": h,
        "l": l,
        "c": c,
        "v": volume if volume is not None else 0,
        "oi": oi,
    }


def _merge(rows: list[Any], days: int) -> list[dict]:
    """Deduplicate by bar time, sort ascending, keep the newest ``days`` sessions."""
    by_ts: dict[datetime, tuple[datetime, str, dict]] = {}
    for row in rows:
        parsed = _parse_candle(row)
        if parsed is not None:
            by_ts[parsed[0]] = parsed

    ordered = [by_ts[key] for key in sorted(by_ts)]
    sessions = sorted({item[1] for item in ordered})
    keep = set(sessions[-days:])
    return [item[2] for item in ordered if item[1] in keep]


async def _get_json(url: str) -> Any:
    try:
        token = await asyncio.to_thread(get_upstox_token)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=AUTH_REQUIRED_DETAIL)
        raise

    timeout = httpx.Timeout(UPSTOX_TIMEOUT_SEC, connect=5.0)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    async def _get() -> httpx.Response:
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.get(url, headers=headers)

    try:
        response = await asyncio.wait_for(_get(), timeout=UPSTOX_TIMEOUT_SEC + 1.0)
    except (asyncio.TimeoutError, httpx.TimeoutException):
        log.warning("contract chart timed out: %s", url)
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=TIMEOUT_DETAIL)
    except httpx.HTTPError as exc:
        log.warning("contract chart transport failure: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNAVAILABLE_DETAIL)

    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=AUTH_REQUIRED_DETAIL)
    if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=RATE_LIMITED_DETAIL,
            headers={"Retry-After": str(UPSTREAM_429_RETRY_AFTER_SEC)},
        )
    if response.status_code != status.HTTP_200_OK:
        log.warning("contract chart upstream %s: %s", response.status_code, response.text[:200])
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNAVAILABLE_DETAIL)

    try:
        payload = response.json()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNAVAILABLE_DETAIL)

    if isinstance(payload, dict) and payload.get("status") not in (None, "success"):
        log.warning("contract chart upstream status=%s", payload.get("status"))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNAVAILABLE_DETAIL)
    return payload


async def _fetch_candles(url: str) -> list:
    payload = await _get_json(url)
    data = payload.get("data") if isinstance(payload, dict) else None
    candles = data.get("candles") if isinstance(data, dict) else None
    if not isinstance(candles, list):
        log.warning("contract chart payload had no candle list: %s", url)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=UNAVAILABLE_DETAIL)
    return candles


def _intraday_url(instrument_key: str, unit: str) -> str:
    return f"{UPSTOX_V3_BASE}/historical-candle/intraday/{quote(instrument_key, safe='')}/minutes/{unit}"


def _historical_url(instrument_key: str, unit: str, to_date: str, from_date: str) -> str:
    encoded = quote(instrument_key, safe="")
    return f"{UPSTOX_V3_BASE}/historical-candle/{encoded}/minutes/{unit}/{to_date}/{from_date}"


async def _collect(instrument_key: str, interval: str, days: int) -> list[dict]:
    unit = INTERVAL_UNITS[interval]
    rows: list[Any] = []

    if days > MIN_DAYS:
        today = _now().date()
        from_date = (today - timedelta(days=HISTORY_LOOKBACK_DAYS)).isoformat()
        rows.extend(await _fetch_candles(_historical_url(instrument_key, unit, today.isoformat(), from_date)))

    # Intraday is appended last so a timestamp present in both responses keeps
    # the running-session bar instead of the historical copy.
    rows.extend(await _fetch_candles(_intraday_url(instrument_key, unit)))
    return _merge(rows, days)


def _response(
    instrument_key: str,
    interval: str,
    candles: list[dict],
    *,
    cached: bool,
    empty_reason: Optional[str],
) -> ContractChartResponse:
    return ContractChartResponse(
        instrument_key=instrument_key,
        interval=interval,
        candles=candles,
        source="upstox",
        cached=cached,
        empty_reason=empty_reason,
    )


@router.get(
    "/contract-chart",
    response_model=ContractChartResponse,
    summary="Minute premium candles for one option contract",
    description=(
        "Read-only OHLCV + open-interest series for the contract whose `instrument_key` "
        "the option chain published (for example `NSE_FO|106407`). The current session "
        "comes from Upstox's intraday endpoint and the prior `days - 1` sessions from the "
        "historical one. Serialisation always deduplicates and sorts ascending; an empty "
        "series is a successful answer with `empty_reason: \"no_trades\"`."
    ),
    responses={
        400: {"description": "Malformed instrument key, interval or `days`."},
        401: {"description": "Upstox token missing, expired or rejected."},
        502: {"description": "Upstox candle data unavailable."},
        504: {"description": "Upstox candle request timed out."},
    },
)
async def get_contract_chart(
    instrument_key: str = Query(..., description="NSE F&O contract key from the option chain."),
    interval: str = Query(DEFAULT_INTERVAL, description="Bar size: `1m`, `5m` or `15m`."),
    days: int = Query(DEFAULT_DAYS, description="Sessions to return, today included (1-3)."),
):
    if not INSTRUMENT_KEY_PATTERN.match(instrument_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_INSTRUMENT_KEY_DETAIL)
    if interval not in INTERVAL_UNITS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_INTERVAL_DETAIL)
    if not MIN_DAYS <= days <= MAX_DAYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_DAYS_DETAIL)

    # The session date is part of the key: a cache entry built just before the
    # 15:30 rollover must not serve the next session's first request.
    key = (instrument_key, interval, _now().date().isoformat())

    cached = _cache.get(key)
    if cached is not None and time.monotonic() - cached["ts"] < cached["ttl"]:
        return _response(
            instrument_key,
            interval,
            cached["candles"],
            cached=True,
            empty_reason=cached["empty_reason"],
        )

    async with _lock_for(key):
        cached = _cache.get(key)
        if cached is not None and time.monotonic() - cached["ts"] < cached["ttl"]:
            return _response(
                instrument_key,
                interval,
                cached["candles"],
                cached=True,
                empty_reason=cached["empty_reason"],
            )

        candles = await _collect(instrument_key, interval, days)
        ttl = CACHE_TTL_OPEN_SEC if await asyncio.to_thread(_session_open) else CACHE_TTL_CLOSED_SEC
        empty_reason = None if candles else "no_trades"
        _cache[key] = {
            "ts": time.monotonic(),
            "ttl": ttl,
            "candles": candles,
            "empty_reason": empty_reason,
        }
        return _response(
            instrument_key,
            interval,
            candles,
            cached=False,
            empty_reason=empty_reason,
        )

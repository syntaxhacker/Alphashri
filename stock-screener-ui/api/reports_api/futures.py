"""Current-month NIFTY futures minute series for the Index Report.

The NIFTY index has neither volume nor OI, so a +50-point move means nothing
on its own: +50 on +102k OI is a long build-up, +50 on -80k OI is short
covering. This module resolves the near NIFTY futures contract and returns its
intraday 1-minute close/OI/volume series plus the 15-minute regime read.

Read-only (GETs only). The report build calls it lazily and caches the result
for 30 s while the derivatives session is open / 300 s otherwise, so the 20 s
snapshot loop costs at most one search + one intraday call per cache window —
including a cached ``None``, which is what keeps a dead token from adding its
timeout to every build. Never raises.
"""

from __future__ import annotations

import asyncio
import logging
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import config
import httpx

from api.reports_api._numeric import safe_float, safe_int
from api.reports_api._time import today_str

# The shared, already-tested symbol pickers live with the futures RVOL probe;
# the BANKNIFTY/FINNIFTY/NIFTYNXT50 prefix trap is encoded there once.
from scripts.futures_volume import (
    is_nifty_futures_symbol,
    parse_search_payload,
    pick_current_month,
)

logger = logging.getLogger(__name__)

UPSTOX_V2_BASE = "https://api.upstox.com/v2"
UPSTOX_V3_BASE = "https://api.upstox.com/v3"

#: Whole-block budget. A wedged upstream must never hold the report past this.
BUILD_TIMEOUT_SEC = 5.0
HTTP_TIMEOUT_SEC = 4.0
OPEN_TTL_SEC = 30.0
CLOSED_TTL_SEC = 300.0
COMPARE_MINUTES = 15
SEARCH_PARAMS = {
    "query": "NIFTY",
    "segments": "FO",
    "instrument_types": "FUT",
    "records": 10,
}

_CACHE: dict[str, Any] = {"day": None, "ttl": 0.0, "ts": 0.0, "value": None}
_CONTRACT_CACHE: dict[str, Any] = {"day": None, "contract": None}


def clear_cache() -> None:
    _CACHE.update(day=None, ttl=0.0, ts=0.0, value=None)
    _CONTRACT_CACHE.update(day=None, contract=None)


def _session_open() -> bool:
    try:
        from trading.utils import is_derivatives_open

        return bool(is_derivatives_open())
    except Exception:
        return 9 <= datetime.now(config.IST).hour <= 15


async def _json(url: str, params: Optional[dict] = None) -> dict:
    """One authorised Upstox GET. Token resolution is the shared one."""
    from api.options import get_upstox_token

    token = await asyncio.to_thread(get_upstox_token)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    timeout = httpx.Timeout(HTTP_TIMEOUT_SEC, connect=2.0)

    async def _get() -> dict:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, headers=headers, params=params or {})
            if response.status_code != 200:
                raise RuntimeError(
                    f"upstox {response.status_code} for {url.split('?')[0]}")
            return response.json()

    return await asyncio.wait_for(_get(), timeout=HTTP_TIMEOUT_SEC + 1.0)


def _expiry_date(row: dict) -> Optional[str]:
    """Contract expiry as ``YYYY-MM-DD`` from the ISO field or epoch millis."""
    raw = str(row.get("expiry") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10]).isoformat()
    except ValueError:
        pass
    if raw.isdigit():
        millis = float(raw) / (1000.0 if len(raw) > 11 else 1.0)
        try:
            return datetime.fromtimestamp(millis, tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    return None


def _candidates(payload: Any) -> list[dict]:
    out: list[dict] = []
    for row in parse_search_payload(payload):
        if not is_nifty_futures_symbol(row.get("trading_symbol")):
            continue
        expiry = _expiry_date(row)
        if expiry:
            out.append({**row, "expiry": expiry})
    return out


def _iso_ist(value: Any) -> Optional[str]:
    if not isinstance(value, str) or len(value) < 16:
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=config.IST)
    return stamp.astimezone(config.IST).isoformat()


def _parse_dt(value: Any) -> datetime:
    stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=config.IST)
    return stamp


def parse_series(payload: Any, session_date: Optional[str] = None) -> list[dict]:
    """V3 intraday candles -> ascending ``[{t, close, oi, volume}]``.

    Rows are ``[ts, o, h, l, c, volume, oi]`` and arrive newest-first. A bar
    outside ``session_date`` is dropped: a cold/after-close intraday fetch
    returns the PREVIOUS session, and shipping that as today's futures series
    is exactly the fabrication this guard exists to stop.
    """
    data = (payload or {}).get("data") if isinstance(payload, dict) else None
    candles = data.get("candles") if isinstance(data, dict) else None
    if not isinstance(candles, list):
        return []
    by_time: dict[str, dict] = {}
    for row in candles:
        if not isinstance(row, (list, tuple)) or len(row) < 5:
            continue
        t = _iso_ist(row[0])
        close = safe_float(row[4])
        if not t or close <= 0:
            continue
        if session_date and t[:10] != session_date:
            continue
        by_time[t] = {
            "t": t,
            "close": round(close, 2),
            "oi": safe_int(row[6]) if len(row) > 6 else 0,
            "volume": safe_int(row[5]) if len(row) > 5 else 0,
        }
    return [by_time[t] for t in sorted(by_time)]


def _bar_ago(series: list[dict], minutes: int) -> dict:
    last = series[-1]
    try:
        target = _parse_dt(last["t"]) - timedelta(minutes=minutes)
        return min(series, key=lambda r: abs(
            (_parse_dt(r["t"]) - target).total_seconds()))
    except (TypeError, ValueError):
        return series[max(0, len(series) - 1 - minutes)]


def regime(change_pts: float, oi_change: int) -> str:
    if change_pts > 0 and oi_change > 0:
        return "long_buildup"
    if change_pts < 0 and oi_change > 0:
        return "short_buildup"
    if change_pts < 0 and oi_change < 0:
        return "long_unwinding"
    if change_pts > 0 and oi_change < 0:
        return "short_covering"
    return "neutral"


def _block(contract: dict, series: list[dict],
           minutes: int = COMPARE_MINUTES) -> dict:
    last = series[-1]
    base = _bar_ago(series, minutes)
    change_pts = round(last["close"] - base["close"], 2)
    oi_change = int(last["oi"]) - int(base["oi"])
    return {
        "symbol": "NIFTY",
        "instrument_key": contract.get("instrument_key", ""),
        "expiry": contract.get("expiry", ""),
        "series": series,
        "change_pts": change_pts,
        "oi_change": oi_change,
        "regime": regime(change_pts, oi_change),
        "as_of": last["t"],
    }


async def _resolve_contract(day: str) -> Optional[dict]:
    if _CONTRACT_CACHE["day"] == day and _CONTRACT_CACHE["contract"]:
        return _CONTRACT_CACHE["contract"]
    payload = await _json(f"{UPSTOX_V2_BASE}/instruments/search", SEARCH_PARAMS)
    contract = pick_current_month(_candidates(payload), day)
    if contract:
        _CONTRACT_CACHE.update(day=day, contract=contract)
    return contract


async def _build(day: str) -> Optional[dict]:
    contract = await _resolve_contract(day)
    if not contract:
        return None
    key = urllib.parse.quote(str(contract["instrument_key"]), safe="")
    payload = await _json(
        f"{UPSTOX_V3_BASE}/historical-candle/intraday/{key}/minutes/1")
    series = parse_series(payload, day)
    if not series:
        return None
    return _block(contract, series)


async def get_nifty_futures_block(session_date: Optional[str] = None,
                                  *, is_open: Optional[bool] = None,
                                  ) -> Optional[dict]:
    """Futures series + 15-minute regime for ``session_date`` (today only).

    ``None`` for any other date: the feed is intraday-only, so a replay/as-of
    request must carry ``null`` rather than today's curve.
    """
    day = session_date or today_str()
    if day != today_str():
        return None
    open_now = _session_open() if is_open is None else bool(is_open)
    ttl = OPEN_TTL_SEC if open_now else CLOSED_TTL_SEC
    now = time.monotonic()
    hit = _CACHE
    if (hit["day"] == day and hit["ttl"] == ttl
            and now - float(hit["ts"] or 0.0) < ttl):
        return hit["value"]
    try:
        value = await asyncio.wait_for(_build(day), timeout=BUILD_TIMEOUT_SEC)
    except Exception as exc:
        logger.warning("nifty futures block unavailable: %s", exc)
        value = None
    _CACHE.update(day=day, ttl=ttl, ts=now, value=value)
    return value

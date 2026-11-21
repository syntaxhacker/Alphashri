"""
Fyers v3 HTTP bridge for the Order Flow tab.

Exposes three JSON endpoints consumed by order-flow's ``http`` provider:

    GET /api/fyers-bridge/expiries?symbol=...
    GET /api/fyers-bridge/chain?symbol=...&expiry=YYYY-MM-DD
    GET /api/fyers-bridge/futures?symbol=...&session=YYYY-MM-DD

All calls go through the Fyers v3 REST SDK
(``fyers_apiv3.fyersModel.FyersModel``) authenticated via
``recorder_token("fyers_tbt")`` (the combined ``"APP_ID:ACCESS_TOKEN"`` string,
split into ``client_id``/``token`` for the SDK).

Every endpoint degrades to an empty payload with HTTP 200 on a missing token,
SDK absence, network failure, or unknown symbol — never a 500.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

import config
from fastapi import APIRouter

from api.fyers_options import fyers_underlying_symbol
from api.orderflow_recorder import recorder_token
from api.orderflow_symbols import fyers_symbol

logger = logging.getLogger("fyers.bridge")

router = APIRouter(prefix="/api/fyers-bridge", tags=["fyers-bridge"])

#: Option-chain strikecount: minimal for expiries, Fyers server-cap max (50) for a chain.
_STRIKECOUNT_EXPIRIES = 1
_STRIKECOUNT_CHAIN = 50

#: Lookback window (days) for the daily candle used to derive prevClose/prevOi.
_FUTURES_DAILY_LOOKBACK_DAYS = 10


# --------------------------------------------------------------------------- rate limit

import time as _time

#: Simple token bucket: Fyers allows ~5 req/s; stay well under.
_FYERS_RATE_LIMIT = 5.0  # requests per second
_fyers_last_call = 0.0


def _rate_limit():
    """Ensure we don't exceed Fyers' rate limit on rapid sequential calls."""
    global _fyers_last_call
    min_interval = 1.0 / _FYERS_RATE_LIMIT
    elapsed = _time.monotonic() - _fyers_last_call
    if elapsed < min_interval:
        _time.sleep(min_interval - elapsed)
    _fyers_last_call = _time.monotonic()

#: Cached FyersModel instance (token is resolved once, reused until stale).
_fyers_client_cache: dict[str, object] = {}


def _fyers_client():
    """Build/cache a FyersModel from the recorder token, or None when unconfigured."""
    import time as _time

    combined = recorder_token("fyers_tbt")
    if not combined:
        return None
    app_id, sep, access_token = combined.partition(":")
    if not sep or not app_id.strip() or not access_token.strip():
        return None
    cache_key = f"{app_id.strip()}:{access_token.strip()[:8]}"
    now = _time.monotonic()
    cached = _fyers_client_cache.get(cache_key)
    if cached and now - cached["ts"] < 300:  # 5-minute client cache
        return cached["client"]
    try:
        from fyers_apiv3.fyersModel import FyersModel

        client = FyersModel(client_id=app_id.strip(), token=access_token.strip())
    except Exception:  # SDK missing / misconfigured
        logger.warning("fyers bridge: FyersModel unavailable", exc_info=True)
        return None
    _fyers_client_cache[cache_key] = {"client": client, "ts": now}
    # Keep cache small
    if len(_fyers_client_cache) > 4:
        _fyers_client_cache.pop(next(iter(_fyers_client_cache)))
    return client


def _optionchain(client, fyers_symbol: str, strikecount: int,
                 timestamp: Optional[int] = None, greeks: bool = False):
    """Call Fyers optionchain; return the ``data`` dict or None on any failure."""
    _rate_limit()
    data = {"symbol": fyers_symbol, "strikecount": int(strikecount)}
    if timestamp is not None:
        data["timestamp"] = str(int(timestamp))
    if greeks:
        data["greeks"] = "1"
    for attempt in range(2):
        try:
            resp = client.optionchain(data=data)
        except Exception:
            logger.warning("fyers bridge: optionchain call failed", exc_info=True)
            if attempt == 0:
                _time.sleep(1.0)
                continue
            return None
        try:
            if not isinstance(resp, dict) or str(resp.get("s", "")).lower() != "ok":
                if attempt == 0:
                    _time.sleep(1.0)
                    continue
                return None
            out = resp.get("data")
            return out if isinstance(out, dict) else None
        except Exception:
            return None


def _history(client, symbol: str, resolution: str, range_from: str,
             range_to: str, oi_flag: bool = False):
    """Call Fyers /data/history; return candles (positional rows) or ``[]``."""
    _rate_limit()
    data = {
        "symbol": symbol, "resolution": resolution, "date_format": "1",
        "range_from": range_from, "range_to": range_to, "cont_flag": "1",
    }
    if oi_flag:
        data["oi_flag"] = "1"
    try:
        resp = client.history(data=data)
    except Exception:
        logger.warning("fyers bridge: history call failed for %s", symbol, exc_info=True)
        return []
    try:
        if not isinstance(resp, dict) or str(resp.get("s", "")).lower() != "ok":
            return []
        candles = resp.get("candles")
        return candles if isinstance(candles, list) else []
    except Exception:
        return []


# --------------------------------------------------------------------------- helpers


def _num(value):
    """``float(value)`` or ``None`` when absent / unparseable."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _epoch_ms(seconds) -> int:
    """Epoch seconds -> epoch ms int (0 on failure)."""
    try:
        return int(float(seconds) * 1000)
    except (TypeError, ValueError):
        return 0


def _fyers_underlying(symbol: str) -> Optional[str]:
    """Resolve a Fyers underlying symbol for an app symbol.

    Indices -> ``NSE:NIFTY50-INDEX`` style (via _FYERS_UNDERLYINGS).
    Stocks  -> ``NSE:RELIANCE-EQ`` style (via fyers_symbol).
    Returns None when neither mapping applies.
    """
    idx = fyers_underlying_symbol(symbol)
    if idx:
        return idx
    eq = fyers_symbol(symbol)
    return eq if ":" in eq else None


def _ymd_to_epoch_ms(iso: str) -> int:
    """YYYY-MM-DD -> epoch ms int at 15:30 IST (Fyers expiry epoch convention)."""
    try:
        y, m, d = (int(part) for part in iso.split("-"))
        return int(datetime(y, m, d, 15, 30, 0, tzinfo=config.IST).timestamp() * 1000)
    except Exception:
        return 0


def _ymd_from_fyers_date(raw) -> Optional[str]:
    """Fyers DD-MM-YYYY -> YYYY-MM-DD (None on failure)."""
    try:
        d, m, y = (int(part) for part in str(raw).split("-"))
        return date(y, m, d).isoformat()
    except Exception:
        return None


def _ymd_from_epoch(epoch_seconds) -> Optional[str]:
    try:
        return datetime.fromtimestamp(float(epoch_seconds), tz=config.IST).date().isoformat()
    except Exception:
        return None


# --------------------------------------------------------------------------- endpoints


@router.get("/expiries/{symbol}")
@router.get("/expiries")
def expiries(symbol: Optional[str] = None):
    """List option expiries for an underlying, YYYY-MM-DD ascending."""
    symbol = (symbol or "").strip()
    if not symbol:
        return {"expiries": []}
    client = _fyers_client()
    if client is None:
        return {"expiries": []}
    fyers_symbol = _fyers_underlying(symbol)
    if not fyers_symbol:
        return {"expiries": []}
    chain_data = _optionchain(client, fyers_symbol, _STRIKECOUNT_EXPIRIES)
    if not chain_data:
        return {"expiries": []}
    dates = []
    for row in chain_data.get("expiryData") or []:
        if not isinstance(row, dict):
            continue
        iso = _ymd_from_fyers_date(row.get("date")) or _ymd_from_epoch(row.get("expiry"))
        if iso:
            dates.append(iso)
    return {"expiries": sorted(set(dates))}


@router.get("/chain/{symbol}")
@router.get("/chain")
def chain(symbol: Optional[str] = None, expiry: Optional[str] = None):
    """Option chain for an underlying/expiry, grouped by strike."""
    symbol = (symbol or "").strip()
    if not symbol:
        return {"expiry": expiry, "at": 0, "spot": 0.0, "strikes": []}
    client = _fyers_client()
    if client is None:
        return {"expiry": expiry, "at": 0, "spot": 0.0, "strikes": []}
    fyers_symbol = _fyers_underlying(symbol)
    if not fyers_symbol:
        return {"expiry": expiry, "at": 0, "spot": 0.0, "strikes": []}

    at_ms = _ymd_to_epoch_ms(expiry) if expiry else 0

    chain_data = _optionchain(client, fyers_symbol, _STRIKECOUNT_CHAIN,
                              greeks=True)
    if not chain_data:
        return {"expiry": expiry, "at": at_ms, "spot": 0.0, "strikes": []}

    spot = _num(chain_data.get("spot")) or 0.0
    prev_close = None

    ces, pes = {}, {}
    for leg in chain_data.get("optionsChain") or []:
        if not isinstance(leg, dict):
            continue
        opt = str(leg.get("option_type", "")).strip().upper()
        # Spot row: option_type == "" and strike_price == -1 — read spot and prevClose from it.
        if opt == "":
            try:
                if float(leg.get("strike_price", -1)) < 0:
                    spot = _num(leg.get("ltp")) or 0.0
                    ltpch = _num(leg.get("ltpch"))
                    if spot and ltpch is not None:
                        prev_close = round(spot - ltpch, 2)
            except (TypeError, ValueError):
                pass
            continue
        if opt not in ("CE", "PE"):
            continue
        try:
            strike = float(leg.get("strike_price"))
        except (TypeError, ValueError):
            continue
        row = {
            "ltp": _num(leg.get("ltp")),
            "prevClose": _num(leg.get("prev_close_price") or leg.get("prevClose")),
            "oi": _num(leg.get("oi")),
            "prevOi": _num(leg.get("prev_oi") or leg.get("prevOi")),
            "volume": _num(leg.get("volume") or leg.get("vol")),
            "prevVolume": _num(leg.get("prev_volume") or leg.get("prevVolume")),
            "avgPrice": _num(leg.get("avg_price") or leg.get("avgPrice")),
            "iv": _num(leg.get("iv")),
            "bid": _num(leg.get("bid")),
            "ask": _num(leg.get("ask")),
            "bidQty": _num(leg.get("bidqty") or leg.get("bidQty")),
            "askQty": _num(leg.get("askqty") or leg.get("askQty")),
            "dayHigh": _num(leg.get("day_high") or leg.get("dayHigh")),
            "dayLow": _num(leg.get("day_low") or leg.get("dayLow")),
            "lastTradeAt": _epoch_ms(leg.get("last_traded_time")),
            "delta": _num(leg.get("delta")),
        }
        if opt == "CE":
            ces[strike] = row
        else:
            pes[strike] = row

    strikes = [{"strike": k, "call": ces.get(k), "put": pes.get(k)}
               for k in sorted(set(ces) | set(pes))]
    return {"expiry": expiry, "at": at_ms, "spot": spot, "prevClose": prev_close, "strikes": strikes}


@router.get("/futures/{symbol}")
@router.get("/futures")
def futures(symbol: Optional[str] = None, session: Optional[str] = None):
    """Futures contract candles for a session (nearest contract used directly)."""
    symbol = (symbol or "").strip()
    today_iso = datetime.now(config.IST).date().isoformat()
    empty = {"date": today_iso, "prevClose": 0.0, "prevOi": 0.0, "candles": []}
    if not symbol:
        return empty
    client = _fyers_client()
    if client is None:
        return empty
    try:
        session_date = datetime.strptime(session, "%Y-%m-%d").date() if session else datetime.now(config.IST).date()
    except ValueError:
        session_date = datetime.now(config.IST).date()
    session_iso = session_date.isoformat()

    # 1-minute candles for the session.
    candles_raw = _history(client, symbol, "1", session_iso, session_iso, oi_flag=True)
    candles = [
        {"at": _epoch_ms(c[0]), "close": _num(c[4]), "oi": _num(c[6]) if len(c) > 6 else 0.0}
        for c in candles_raw
        if isinstance(c, (list, tuple)) and len(c) > 4
    ]

    # prevClose / prevOi from the most recent daily candle before the session.
    prev_close, prev_oi = None, None
    to_date = (session_date - timedelta(days=1)).isoformat()
    from_date = (session_date - timedelta(days=_FUTURES_DAILY_LOOKBACK_DAYS)).isoformat()
    daily = _history(client, symbol, "1D", from_date, to_date, oi_flag=True)
    if daily:
        last = daily[-1]
        if isinstance(last, (list, tuple)) and len(last) > 4:
            prev_close = _num(last[4])
        if isinstance(last, (list, tuple)) and len(last) > 6:
            prev_oi = _num(last[6])

    return {
        "date": session_iso,
        "prevClose": prev_close if prev_close is not None else 0.0,
        "prevOi": prev_oi if prev_oi is not None else 0.0,
        "candles": candles,
    }
